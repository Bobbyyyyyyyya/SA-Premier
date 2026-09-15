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
