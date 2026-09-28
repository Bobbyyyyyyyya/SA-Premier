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
        for k, v in inputs.items():
            if hasattr(v, "to"):
                try:
                    inputs[k] = v.to(DEVICE)
                except Exception:
                    pass

        print(f"[music] generating '{prompt}' {duration}s with {model_id} tokens={max_new_tokens}", flush=True)
        criteria = ProgressCriteria(max_new_tokens, 25, 70)

        def _run_generate():
            # in een thread: anders blokkeert de generatie de event loop en kan
            # /progress niet worden gepolld (de balk bleef op 10% hangen)
            with torch.no_grad():
                return model.generate(
                    **inputs,
                    max_new_tokens=max_new_tokens,
                    do_sample=True,
                    temperature=0.9,
                    guidance_scale=3.0,
                    stopping_criteria=StoppingCriteriaList([criteria]),
                )

        audio_values = await asyncio.to_thread(_run_generate)
        set_progress(97, "encoding", "Audio encoderen…", criteria.step, criteria.total)

        sampling_rate = model.config.audio_encoder.sampling_rate if hasattr(model.config, "audio_encoder") else 32000
        wav = audio_values[0, 0].cpu().float().numpy()

        wav = normalize_audio(wav, target_peak=0.95)
        wav = np.clip(wav, -1.0, 1.0)
        wav_int16 = (wav * 32767).astype(np.int16)

        buf = io.BytesIO()
        scipy.io.wavfile.write(buf, sampling_rate, wav_int16)
        b64 = base64.b64encode(buf.getvalue()).decode()

        duration_actual = len(wav) / sampling_rate
        rms = float(np.sqrt(np.mean(wav ** 2)))
        print(f"[music] done: {duration_actual:.1f}s, rms={rms:.3f}", flush=True)

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


async def preload_model(app):
    print(f"[music] preloading {DEFAULT_MODEL}...", flush=True)
    try:
        await asyncio.to_thread(get_processor_model, DEFAULT_MODEL)
        print(f"[music] default model ready", flush=True)
    except Exception as e:
        print(f"[music] preload failed: {e}", flush=True)


app.on_startup.append(preload_model)

if __name__ == "__main__":
    print(f"[music] starting on http://127.0.0.1:{PORT} device={DEVICE}", flush=True)
    web.run_app(app, host="127.0.0.1", port=PORT)
