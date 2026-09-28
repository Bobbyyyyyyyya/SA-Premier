# AI-modellen meeleveren (Full-build)

Wil je een **Full-installer** bouwen waarbij AI-modellen al in de app zitten?
Leg ze dan vóór `npm run dist:full` in deze map:

```
resources/
  models/
    checkpoints/
      v1-5-pruned-emaonly.safetensors   ← SD 1.5 (aanbevolen, ~4 GB)
      Realistic_Vision_V5.1_....safetensors
  music-models/                          ← optioneel (MusicGen snapshots)
  comfy/                                 ← optioneel (eigen ComfyUI snapshot)
```

- Alles hieronder wordt automatisch meegepakt via `extraResources` in de Full-build.
- Lite-build (`npm run dist:lite`) neemt **niets** uit `resources/` mee → ~150 MB.
- De app detecteert meegeleverde modellen vanzelf (`src/main/ai-setup.ts`)
  en toont in de wizard: “al meegeleverd ✓”.

Tip: begin met 1 model (SD 1.5 pruned-emaonly). Full-installer wordt dan ~4,5 GB.

## `ai/` — MusicGen-server (altijd mee)

```
resources/
  ai/
    music_server.py    ← HTTP-server die MusicGen aanroept (poort 8189)
```

Dit bestand wordt in **beide** builds meegepakt (`extraResources` → `<resources>/ai/`),
ook in de kleine Lite-build: het is ~7 kB en zonder dit bestand valt AI-muziek
stilletjes terug op de synth-fallback.

`src/main/music-ai.ts` zoekt het script in deze volgorde:

1. `<resources>/ai/music_server.py` — de gebouwde app
2. `resources/ai/music_server.py` — dev/bronmap
3. `<ComfyUI-map>/music_server.py` — installatie uit de AI-instelling
4. `~/MusicAI/music_server.py` — oude locatie (fallback)

Het script heeft Python nodig (`torch`, `transformers`, `numpy`, `aiohttp`,
`scipy`); zonder die bibliotheken start hij niet en blijft de synth-fallback
over. De app hoeft geen modellen mee te leveren — die downloadt MusicGen zelf
op aanvraag.
