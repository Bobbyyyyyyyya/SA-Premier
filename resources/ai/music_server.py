import os
import sys
import json
import base64
import io
import asyncio
import numpy as np
from aiohttp import web
import torch
from transformers import AutoProcessor, MusicgenForConditionalGeneration
import scipy.io.wavfile

PORT = 8189
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
CACHE_DIR = os.path.expanduser("~/.cache/huggingface/hub")

MODELS = {
    "facebook/musicgen-small": {"name": "MusicGen Small (300M)", "size": "1.2GB", "desc": "Fast, lowest quality. Quick previews only.", "quality": 1},
    "facebook/musicgen-medium": {"name": "MusicGen Medium (1.5B)", "size": "3.5GB", "desc": "Good quality, balanced speed. Recommended.", "quality": 2},
    "facebook/musicgen-large": {"name": "MusicGen Large (3.3B)", "size": "6GB", "desc": "Best quality. Needs 16GB RAM.", "quality": 3},
    "facebook/musicgen-stereo-large": {"name": "MusicGen Stereo Large (3.3B)", "size": "6GB", "desc": "Best quality stereo output.", "quality": 3},
}
DEFAULT_MODEL = "facebook/musicgen-medium"

loaded = {}
loading = set()

# --- voortgang: /progress wordt gepolld door de app zodat de balk echt loopt ---
from transformers import StoppingCriteria, StoppingCriteriaList

PROGRESS = {"percent": 0, "phase": "idle", "message": "", "step": 0, "total": 0}


def set_progress(percent, phase, message="", step=0, total=0):
    PROGRESS["percent"] = max(0, min(100, round(percent, 1)))
    PROGRESS["phase"] = phase
    PROGRESS["message"] = message
    PROGRESS["step"] = step
    PROGRESS["total"] = total


class ProgressCriteria(StoppingCriteria):
    """Aangeroepen na elk audio-token; rapporteert voortgang, stopt nooit."""

    def __init__(self, total, base, span):
        self.total = max(1, total)
        self.base = base
        self.span = span
        self.step = 0

    def __call__(self, input_ids, scores, **kwargs):
        self.step = min(self.total, int(input_ids.shape[-1]))
        set_progress(self.base + self.span * (self.step / self.total), "generating",
                     f"Genereren… stap {self.step}/{self.total}", self.step, self.total)
        return False


async def progress_handler(request):
    return web.json_response(dict(PROGRESS))


def get_processor_model(model_id):
    if model_id in loaded:
        return loaded[model_id]
    print(f"[music] loading {model_id} on {DEVICE} ...", flush=True)
    processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=False)
    model = MusicgenForConditionalGeneration.from_pretrained(model_id, trust_remote_code=False)
    try:
        model.to(DEVICE)
    except Exception as e:
        print(f"[music] failed to move to {DEVICE}: {e}, using cpu", flush=True)
        model.to("cpu")
    loaded[model_id] = (processor, model)
    print(f"[music] loaded {model_id}", flush=True)
    return processor, model


def normalize_audio(wav, target_peak=0.95):
    peak = np.max(np.abs(wav))
    if peak > 0:
        wav = wav * (target_peak / peak)
    return wav


def audio_quality(wav, sr):
    """RMS + mediane zero-crossing rate over vensters van 1s.

    Witte ruis heeft een ZCR van ~0.5 (elke sample slaat om), muziek zit
    vrijwel altijd onder 0.25. Goedkoop en betrouwbaar genoeg om een
    mislukte generatie (bekend MPS-probleem: alleen ruis) te herkennen.
    """
    x = np.asarray(wav, dtype=np.float64)
    rms = float(np.sqrt(np.mean(x ** 2)))
    if rms < 1e-6:
        return rms, 0.0
    win = max(256, int(sr))
    zcrs = []
    for start in range(0, len(x), win):
        seg = x[start:start + win]
        if len(seg) < win // 4:
            continue
        s = np.sign(seg)
        s[s == 0] = 1
        zcrs.append(float(np.mean(np.abs(np.diff(s))) / 2.0))
    zcr = float(np.median(zcrs)) if zcrs else 0.0
    return rms, zcr


def looks_like_noise(rms, zcr):
    if rms < 5e-4:
        return True  # (vrijwel) stilte
    return zcr > 0.35


async def status_handler(request):
    installed = []
    for mid in MODELS:
        cache_name = "models--" + mid.replace("/", "--")
        p = os.path.join(CACHE_DIR, cache_name)
        exists = os.path.exists(p)
        installed.append({"id": mid, "installed": exists, "info": MODELS[mid]})
    loading_list = list(loading)
    return web.json_response({"device": DEVICE, "port": PORT, "models": installed, "loading": loading_list})


async def generate_handler(request):
    try:
        data = await request.json()
        prompt = (data.get("prompt") or "a happy beat").strip()
        duration = int(data.get("duration") or 8)
        duration = max(4, min(30, duration))
        model_id = data.get("model") or DEFAULT_MODEL
        if model_id not in MODELS:
            model_id = DEFAULT_MODEL

        set_progress(2, "loading", f"Model laden: {model_id.split('/')[-1]}…")
        loading.add(model_id)
        try:
            processor, model = await asyncio.to_thread(get_processor_model, model_id)
        finally:
            loading.discard(model_id)
        set_progress(25, "generating", "Model klaar, audio genereren…")

        max_new_tokens = int(duration * 50)
        max_new_tokens = max(256, min(1500, max_new_tokens))

        inputs = processor(text=[prompt], padding=True, return_tensors="pt")

        # apparaat waar het model écht op staat (de .to(DEVICE) bij laden kan
        # stil zijn teruggevallen op cpu) — inputs daarheen, anders krijg je
        # een device-mismatch en faalt elke generatie.
        try:
            gen_device = str(next(model.parameters()).device)
        except StopIteration:
            gen_device = "cpu"

        print(f"[music] generating '{prompt}' {duration}s with {model_id} tokens={max_new_tokens} on {gen_device}", flush=True)
        criteria = ProgressCriteria(max_new_tokens, 25, 70)

        def _run_generate(device, crit):
            # in een thread: anders blokkeert de generatie de event loop en kan
            # /progress niet worden gepolld (de balk bleef op 10% hangen)
            if device == "cpu":
                try:
                    model.to("cpu")
                except Exception as e:
                    print(f"[music] move to cpu failed: {e}", flush=True)
                try:
                    if torch.backends.mps.is_available():
                        torch.mps.empty_cache()
                except Exception:
                    pass
            loc_inputs = {}
            for k, v in inputs.items():
                try:
                    loc_inputs[k] = v.to(device) if hasattr(v, "to") else v
                except Exception:
                    loc_inputs[k] = v
            with torch.no_grad():
                return model.generate(
                    **loc_inputs,
                    max_new_tokens=max_new_tokens,
                    do_sample=True,
                    temperature=0.9,
                    guidance_scale=3.0,
                    stopping_criteria=StoppingCriteriaList([crit]),
                )

        def _decode(values):
            sampling_rate = model.config.audio_encoder.sampling_rate if hasattr(model.config, "audio_encoder") else 32000
            wav = values[0, 0].cpu().float().numpy()
            wav = normalize_audio(wav, target_peak=0.95)
            wav = np.clip(wav, -1.0, 1.0)
            return wav, sampling_rate

        audio_values = await asyncio.to_thread(_run_generate, gen_device, criteria)

        wav, sampling_rate = _decode(audio_values)
        rms, zcr = audio_quality(wav, sampling_rate)
        duration_actual = len(wav) / sampling_rate
        print(f"[music] done: {duration_actual:.1f}s, rms={rms:.3f} zcr={zcr:.3f}", flush=True)

        if looks_like_noise(rms, zcr) and gen_device != "cpu":
            # Bekend MPS-probleem: het model geeft alleen witte ruis terug.
            # Eén keer opnieuw op CPU (traag maar correct) i.p.v. ruis op de timeline zetten.
            print(f"[music] output looks like noise on {gen_device}, retrying on cpu…", flush=True)
            set_progress(30, "generating", "Alleen ruis gedetecteerd — opnieuw op CPU…")
            criteria = ProgressCriteria(max_new_tokens, 30, 62)
            audio_values = await asyncio.to_thread(_run_generate, "cpu", criteria)
            wav, sampling_rate = _decode(audio_values)
            rms, zcr = audio_quality(wav, sampling_rate)
            duration_actual = len(wav) / sampling_rate
            print(f"[music] cpu retry: {duration_actual:.1f}s, rms={rms:.3f} zcr={zcr:.3f}", flush=True)

        if looks_like_noise(rms, zcr):
            msg = "MusicGen leverde alleen ruis op (ook op CPU). Probeer een ander model of gebruik de synth-beat."
            print(f"[music] giving up: {msg}", flush=True)
            set_progress(0, "error", msg[:200])
            return web.json_response({"ok": False, "error": msg}, status=500)

        set_progress(97, "encoding", "Audio encoderen…", criteria.step, criteria.total)

        wav_int16 = (wav * 32767).astype(np.int16)

        buf = io.BytesIO()
        scipy.io.wavfile.write(buf, sampling_rate, wav_int16)
        b64 = base64.b64encode(buf.getvalue()).decode()

        set_progress(100, "done", f"Klaar: {duration_actual:.1f}s audio", criteria.step, criteria.total)
        return web.json_response({
            "ok": True,
            "base64": b64,
            "sampling_rate": sampling_rate,
            "model": model_id,
            "duration": round(duration_actual, 1),
            "rms": round(rms, 3),
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        set_progress(0, "error", str(e)[:200])
        return web.json_response({"ok": False, "error": str(e)}, status=500)


app = web.Application()
app.router.add_get("/status", status_handler)
app.router.add_post("/generate", generate_handler)
app.router.add_get("/progress", progress_handler)


async def schedule_preload(app):
    """Warmup op de achtergrond.

    Dit draait bewust NIET als await in on_startup: aiohttp bindt de poot pas
    ná de on_startup-handlers, dus het ~25s laden van het model liet de server
    25s lang onbereikbaar en de app gaf na 10s op met "reageert niet".
    /generate laadt het model zelf op als dat nodig is, dus hier alleen warmen.
    """
    print(f"[music] preloading {DEFAULT_MODEL} op de achtergrond...", flush=True)

    async def _warm():
        try:
            await asyncio.to_thread(get_processor_model, DEFAULT_MODEL)
            set_progress(100, "ready", f"{DEFAULT_MODEL} klaar")
            print("[music] default model ready", flush=True)
        except Exception as e:
            print(f"[music] preload failed: {e}", flush=True)

    asyncio.create_task(_warm())


app.on_startup.append(schedule_preload)

if __name__ == "__main__":
    print(f"[music] starting on http://127.0.0.1:{PORT} device={DEVICE}", flush=True)
    web.run_app(app, host="127.0.0.1", port=PORT)
