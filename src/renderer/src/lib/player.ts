import type { Asset, AudioEffectsFx } from '../../../shared/types'
import { DEFAULT_AUDIO_EFFECTS } from '../../../shared/types'
import { mediaUrl } from './mediaUrl'
import { clamp } from './format'

/** Web Audio-keten voor één clip:
 *   source → highpass → lowpass → low → mid → high → comp → makeup → ┬→ dry ─────┐
 *                                                                    └→ conv → wet ┴→ out
 *
 * De grafiek wordt alleen aangelegd als er audio-effecten staan; zonder
 * effecten blijft het native element-volume in gebruik (geen AudioContext,
 * geen kans op regressies). Let op: zodra een element aan een
 * MediaElementSource hangt, negeert Chromium el.volume — vanaf dat moment
 * loopt het volume via `out`.
 */
interface AudioGraph {
  src: MediaElementAudioSourceNode
  low: BiquadFilterNode
  mid: BiquadFilterNode
  high: BiquadFilterNode
  lowPass: BiquadFilterNode
  highPass: BiquadFilterNode
  comp: DynamicsCompressorNode
  makeup: GainNode
  dry: GainNode
  wet: GainNode
  conv: ConvolverNode
  out: GainNode
}

export type PlayerElement = HTMLMediaElement | HTMLImageElement

export class PlayerManager {
  private els = new Map<string, PlayerElement>()
  private ids = new WeakMap<PlayerElement, string>()
  private graphs = new Map<string, AudioGraph>()
  private container: HTMLDivElement
  private masterVolume = 1
  private masterMuted = false
  private ctx: AudioContext | null = null
  private ir: AudioBuffer | null = null

  constructor() {
    this.container = document.createElement('div')
    this.container.style.cssText =
      'position:fixed;left:-100000px;top:0;width:16px;height:16px;overflow:hidden;pointer-events:none;'
    document.body.appendChild(this.container)
  }

  setMaster(volume: number, muted: boolean): void {
    this.masterVolume = clamp(volume, 0, 1)
    this.masterMuted = muted
    // pas direct toe op alle bestaande elementen
    for (const [id, el] of this.els) {
      if (el instanceof HTMLMediaElement) {
        const base = (el as HTMLMediaElement & { _clipVol?: number })._clipVol ?? 1
        this.applyVolume(el, base, (el as HTMLMediaElement & { _trackMuted?: boolean })._trackMuted ?? false)
        void id
      }
    }
  }

  getMaster(): { volume: number; muted: boolean } {
    return { volume: this.masterVolume, muted: this.masterMuted }
  }

  private applyVolume(el: HTMLMediaElement, clipVolume: number, trackMuted: boolean): void {
    const effClip = clamp(clipVolume, 0, 2)
    // HTMLMediaElement.volume gaat maar tot 1 — alles daarboven is gain bij export
    const previewVol = clamp(effClip, 0, 1) * this.masterVolume
    ;(el as HTMLMediaElement & { _clipVol?: number })._clipVol = clipVolume
    ;(el as HTMLMediaElement & { _trackMuted?: boolean })._trackMuted = trackMuted
    const silent = trackMuted || this.masterMuted || effClip <= 0.001
    const graph = this.graphs.get(this.clipIdOf(el))
    if (graph) {
      // volume loopt nu via de grafiek; el.volume wordt door Chromium genegeerd
      graph.out.gain.value = silent ? 0 : clamp(previewVol, 0, 1)
      el.volume = 1
      el.muted = false
      return
    }
    el.volume = clamp(previewVol, 0, 1)
    el.muted = silent
  }

  private clipIdOf(el: PlayerElement): string {
    // O(1) via reverse-map i.p.v. lineair door alle elementen per volumewijziging
    return this.ids.get(el) ?? ''
  }

  /** AudioContext pas aanmaken als er echt iets te horen valt te krijgen. */
  private ensureCtx(): AudioContext | null {
    if (this.ctx) {
      // gesuspende context = eeuwige stilte voor alle geroute clips; altijd proberen
      // te hervatten zodra er weer een aanleiding is (bijv. een user-gesture hier)
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => null)
      return this.ctx
    }
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      this.ctx = new Ctor()
      // browsers laten de context pas starten na een gebruikersgebaar
      void this.ctx.resume().catch(() => null)
      // en als de browser hem daarna weer suspendeert (tab-wissel, apparaatwissel):
      this.ctx.onstatechange = () => {
        if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => null)
      }
    } catch {
      this.ctx = null
    }
    return this.ctx
  }

  /** Synthetische ruimte-impuls (aflopende ruis) — goedkoop en klinkt als een zaal. */
  private reverbIR(ctx: AudioContext): AudioBuffer {
    if (this.ir) return this.ir
    const len = Math.floor(ctx.sampleRate * 1.6)
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4)
      }
    }
    this.ir = buf
    return buf
  }

  private buildGraph(clipId: string, el: HTMLMediaElement, ctx: AudioContext): AudioGraph {
    const src = ctx.createMediaElementSource(el)
    const low = ctx.createBiquadFilter()
    low.type = 'lowshelf'
    low.frequency.value = 200
    const mid = ctx.createBiquadFilter()
    mid.type = 'peaking'
    mid.frequency.value = 1000
    mid.Q.value = 0.9
    const high = ctx.createBiquadFilter()
    high.type = 'highshelf'
    high.frequency.value = 3500
    const lowPass = ctx.createBiquadFilter()
    lowPass.type = 'lowpass'
    lowPass.frequency.value = 20000
    const highPass = ctx.createBiquadFilter()
    highPass.type = 'highpass'
    highPass.frequency.value = 20
    const comp = ctx.createDynamicsCompressor()
    comp.knee.value = 12
    comp.attack.value = 0.006
    comp.release.value = 0.22
    // DynamicsCompressorNode heeft geen makeupGain-param; eigen gain-node
    // achter de compressor (1 = 0 dB).
    const makeup = ctx.createGain()
    makeup.gain.value = 1
    const dry = ctx.createGain()
    const wet = ctx.createGain()
    const conv = ctx.createConvolver()
    conv.buffer = this.reverbIR(ctx)
    const out = ctx.createGain()
    src.connect(highPass)
    highPass.connect(lowPass)
    lowPass.connect(low)
    low.connect(mid)
    mid.connect(high)
    high.connect(comp)
    comp.connect(makeup)
    makeup.connect(dry)
    makeup.connect(conv)
    conv.connect(wet)
    dry.connect(out)
    wet.connect(out)
    out.connect(ctx.destination)
    const g: AudioGraph = { src, low, mid, high, lowPass, highPass, comp, makeup, dry, wet, conv, out }
    this.graphs.set(clipId, g)
    // bestaand volume overzetten
    const prev = el as HTMLMediaElement & { _clipVol?: number; _trackMuted?: boolean }
    this.applyVolume(el, prev._clipVol ?? 1, prev._trackMuted ?? false)
    return g
  }

  /** Zet de audio-effecten van een clip. Wordt aangeroepen bij elke
   * clips-wijziging; is er niets aan, dan blijft het element onaangeroerd.
   */
  setAudioEffects(clipId: string, fx: AudioEffectsFx | undefined): void {
    const el = this.els.get(clipId)
    if (!(el instanceof HTMLMediaElement)) return
    // Oude projecten missen de nieuwere velden: aanvullen met de defaults, zodat
    // `undefined` nooit als frequentie of gain in de grafiek belandt.
    const f: AudioEffectsFx = { ...DEFAULT_AUDIO_EFFECTS, ...(fx ?? {}) }
    const neutral =
      Math.abs(f.eqLow) < 0.01 &&
      Math.abs(f.eqMid) < 0.01 &&
      Math.abs(f.eqHigh) < 0.01 &&
      f.compressor < 0.01 &&
      f.noiseReduction < 0.01 &&
      f.reverb < 0.01 &&
      f.highPass <= 0 &&
      f.lowPass <= 0 &&
      Math.abs(f.gateThreshold) < 0.5 &&
      Math.abs(f.makeupGain) < 0.05
    let g = this.graphs.get(clipId)
    if (neutral) {
      if (!g) return
      g.low.gain.value = 0
      g.mid.gain.value = 0
      g.high.gain.value = 0
      g.highPass.frequency.value = 20
      g.lowPass.frequency.value = 20000
      g.comp.threshold.value = 0
      g.comp.ratio.value = 1
      g.makeup.gain.value = 1
      g.dry.gain.value = 1
      g.wet.gain.value = 0
      return
    }
    const ctx = this.ensureCtx()
    if (!ctx) return
    try {
      if (!g) g = this.buildGraph(clipId, el, ctx)
    } catch {
      return // geen audio-device/grafiek: preview valt terug op element-volume
    }
    const clampDb = (v: number): number => clamp(v, -12, 12)
    g.low.gain.value = clampDb(f.eqLow)
    g.mid.gain.value = clampDb(f.eqMid)
    g.high.gain.value = clampDb(f.eqHigh)
    // Filters: 0 = uit, dan bypass (20 Hz / 20 kHz).
    g.highPass.frequency.value = f.highPass > 0 ? clamp(f.highPass, 20, 20000) : 20
    g.lowPass.frequency.value = f.lowPass > 0 ? clamp(f.lowPass, 20, 20000) : 20000
    const c = clamp(f.compressor, 0, 1)
    g.comp.threshold.value = -6 - 34 * c
    g.comp.ratio.value = 1 + 11 * c
    g.makeup.gain.value = Math.pow(10, clamp(f.makeupGain, -24, 24) / 20)
    const r = clamp(f.reverb, 0, 1)
    g.wet.gain.value = r * 0.55
    g.dry.gain.value = 1 - r * 0.25
    // Gate/expander en ruisreductie hebben geen eerlijke Web Audio-tegenhanger;
    // die doen alleen mee in de export (audioFilterChain in main/export.ts).
  }

  element(clipId: string, asset: Asset, kind?: string): PlayerElement {
    let el = this.els.get(clipId)
    if (!el) {
      const k = kind ?? asset.type
      if (k === 'audio') {
        const a = new Audio()
        a.preload = 'auto'
        // no crossOrigin for local media:// — avoids CORS preflight
        // @ts-ignore
        a.volume = this.masterVolume
        a.src = mediaUrl(asset.path)
        el = a
      } else if (asset.isImage) {
        const img = new Image()
        img.src = mediaUrl(asset.path)
        el = img
      } else {
        const v = document.createElement('video')
        v.preload = 'auto'
        v.playsInline = true
        v.volume = this.masterVolume
        // don't force muted here — let syncPlayback decide
        // @ts-ignore playsInline attribute for safari
        v.setAttribute('playsinline', '')
        v.setAttribute('webkit-playsinline', '')
        v.src = mediaUrl(asset.path)
        el = v
      }
      this.container.appendChild(el as Node)
      this.els.set(clipId, el)
      this.ids.set(el, clipId)
    } else if (el instanceof HTMLMediaElement) {
      // als het asset-pad veranderde (clip hergebruikt), src verversen
      const want = mediaUrl(asset.path)
      const cur = (el as HTMLAudioElement).currentSrc || (el as HTMLMediaElement).src
      if (cur !== want && !cur.endsWith(encodeURI(asset.path))) {
        try {
          ;(el as HTMLMediaElement).src = want
        } catch {
          // ignore
        }
      }
    }
    return el
  }

  private expectedTime(clipStart: number, clipDur: number, sourceStart: number, time: number): number | null {
    const expected = time - clipStart + sourceStart
    if (expected >= 0 && expected < clipDur) return expected
    return null
  }

  syncPlayback(
    clipId: string,
    kind: 'video' | 'audio',
    clipStart: number,
    clipDur: number,
    sourceStart: number,
    trackMuted: boolean,
    time: number,
    playing: boolean,
    clipVolume = 1,
    mode?: { reversed?: boolean; holdSource?: number | null }
  ): void {
    const el = this.els.get(clipId)
    if (!el || !(el instanceof HTMLMediaElement)) return
    this.applyVolume(el, clipVolume, trackMuted)
    // Achteruit kan een <video>/<audio> niet zelf, en een freeze mag niet
    // doorlopen: in beide gevallen pauzeren en het element met de hand op de
    // juiste bron-tijd zetten. Het geluid staat dan al stil via clipAudioGain.
    if (mode?.holdSource != null) {
      if (!el.paused) {
        try { el.pause() } catch { /* ignore */ }
      }
      if (Math.abs(el.currentTime - mode.holdSource) > 0.05) {
        try {
          el.currentTime = clamp(mode.holdSource, 0, el.duration || mode.holdSource)
        } catch {
          // not seekable yet
        }
      }
      return
    }
    if (mode?.reversed) {
      if (!el.paused) {
        try { el.pause() } catch { /* ignore */ }
      }
      if (kind === 'video') {
        const local = time - clipStart
        if (local >= 0 && local < clipDur) {
          const mirrored = sourceStart + clipDur - local
          try {
            el.currentTime = clamp(mirrored, 0, el.duration || mirrored)
          } catch {
            // not seekable yet
          }
        }
      }
      return
    }
    const expected = this.expectedTime(clipStart, clipDur, sourceStart, time)
    if (playing && expected !== null) {
      if (Math.abs(el.currentTime - expected) > 0.4) {
        try {
          el.currentTime = clamp(expected, 0, el.duration || expected)
        } catch {
          // not seekable yet
        }
      }
      if (el.paused) {
        // geroute clips horen alleen als de AudioContext loopt — suspend uit
        // een eerdere sessie/tab-wissel zou anders permanent stilte geven
        if (this.graphs.has(clipId) && this.ctx && this.ctx.state === 'suspended') {
          void this.ctx.resume().catch(() => null)
        }
        el.play().catch(() => {})
      }
    } else {
      if (!el.paused) el.pause()
    }
  }

  seekTo(
    clipId: string,
    clipStart: number,
    clipDur: number,
    sourceStart: number,
    time: number,
    clipVolume?: number,
    trackMuted?: boolean,
    mode?: { reversed?: boolean; holdSource?: number | null }
  ): void {
    const el = this.els.get(clipId)
    if (!el || !(el instanceof HTMLMediaElement)) return
    if (clipVolume !== undefined || trackMuted !== undefined) {
      const prev = el as HTMLMediaElement & { _clipVol?: number; _trackMuted?: boolean }
      this.applyVolume(el, clipVolume ?? prev._clipVol ?? 1, trackMuted ?? prev._trackMuted ?? false)
    }
    if (mode?.holdSource != null) {
      if (!el.paused) {
        try { el.pause() } catch { /* ignore */ }
      }
      if (Math.abs(el.currentTime - mode.holdSource) > 0.05) {
        try {
          el.currentTime = clamp(mode.holdSource, 0, el.duration || mode.holdSource)
        } catch {
          // not seekable yet
        }
      }
      return
    }
    if (mode?.reversed) {
      // scrubben naar de gespiegelde bron-tijd (alleen beeld; geluid is stil)
      const local = time - clipStart
      if (local < 0 || local >= clipDur) {
        if (!el.paused) {
          try { el.pause() } catch { /* ignore */ }
        }
        return
      }
      const mirrored = sourceStart + clipDur - local
      if (Math.abs(el.currentTime - mirrored) > 0.05) {
        try {
          el.currentTime = clamp(mirrored, 0, el.duration || mirrored)
        } catch {
          // not seekable yet
        }
      }
      return
    }
    const expected = this.expectedTime(clipStart, clipDur, sourceStart, time)
    if (expected === null) {
      if (!el.paused) el.pause()
      return
    }
    if (Math.abs(el.currentTime - expected) > 0.05) {
      try {
        el.currentTime = clamp(expected, 0, el.duration || expected)
      } catch {
        // not seekable yet
      }
    }
  }

  pauseAll(): void {
    for (const el of this.els.values()) {
      if (el instanceof HTMLMediaElement && !el.paused) el.pause()
    }
  }

  removeClip(clipId: string): void {
    const g = this.graphs.get(clipId)
    if (g) {
      try { g.out.disconnect() } catch { /* ignore */ }
      this.graphs.delete(clipId)
    }
    const el = this.els.get(clipId)
    if (el) {
      if (el instanceof HTMLMediaElement) {
        try { el.pause() } catch { /* ignore */ }
        try { el.removeAttribute('src') } catch { /* ignore */ }
      }
      try { (el as unknown as HTMLElement).remove() } catch { /* ignore */ }
      this.els.delete(clipId)
      this.ids.delete(el)
    }
  }

  dispose(): void {
    this.pauseAll()
    this.els.clear()
    this.container.remove()
  }
}