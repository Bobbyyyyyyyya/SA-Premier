import { useState } from 'react'
import { useEditorStore } from '../store'
import { formatTime } from '../lib/format'
import { importPaths } from '../lib/inspect'
import type { ClipEffects, TextAnim, TextData, TransitionType } from '../../../shared/types'
import {
  ANIM_LIST,
  AUDIO_TRANSITIONS,
  DEFAULT_EFFECTS,
  FONT_LIST,
  OVERLAP_TRANSITIONS,
  TEXT_PRESETS,
  VIDEO_TRANSITIONS,
  uid
} from '../../../shared/types'

function toHex(color: string | undefined | null): string {
  if (!color || color === 'transparent') return '#000000'
  const c = color.trim()
  if (/^#[0-9a-fA-F]{8}$/.test(c)) return c.slice(0, 7).toLowerCase()
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    const r = c[1]
    const g = c[2]
    const b = c[3]
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  const rgb = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i)
  if (rgb) {
    const h = (n: string): string =>
      Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0')
    return `#${h(rgb[1])}${h(rgb[2])}${h(rgb[3])}`
  }
  try {
    const t = document.createElement('canvas').getContext('2d')
    if (t) {
      t.fillStyle = '#000000'
      t.fillStyle = c
      const v = t.fillStyle
      if (typeof v === 'string') {
        if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase()
        if (/^#[0-9a-fA-F]{3}$/.test(v)) {
          const r = v[1]
          const g = v[2]
          const b = v[3]
          return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
        }
        const nested = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i)
        if (nested) {
          const h = (n: string): string =>
            Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0')
          return `#${h(nested[1])}${h(nested[2])}${h(nested[3])}`
        }
      }
    }
  } catch {
    /* noop */
  }
  return '#000000'
}

/** Houd alpha van rgba() als de user alleen de hex kleur wijzigt via color-input */
function withAlpha(prev: string | undefined, hex: string): string {
  const m = (prev ?? '').match(/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/i)
  if (!m) return hex
  const a = Number(m[1])
  if (!Number.isFinite(a) || a >= 1) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <div className="ctl">
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      <span className="val">{Math.round(value * 100)}</span>
    </div>
  )
}

export default function Inspector(): JSX.Element {
  const selectedClipId = useEditorStore((s) => s.selectedClipId)
  const clips = useEditorStore((s) => s.clips)
  const tracks = useEditorStore((s) => s.tracks)
  const assets = useEditorStore((s) => s.assets)
  const updateClip = useEditorStore((s) => s.updateClip)
  const removeClip = useEditorStore((s) => s.removeClip)
  const addTransition = useEditorStore((s) => s.addTransition)
  const clearTransition = useEditorStore((s) => s.clearTransition)
  const [extracting, setExtracting] = useState(false)
  const [extractMsg, setExtractMsg] = useState('')
  const [subBusy, setSubBusy] = useState(false)
  const [subMsg, setSubMsg] = useState('')
  const [transType, setTransType] = useState<TransitionType>('crossfade')
  const [transDur, setTransDur] = useState(0.5)

  const clip = clips.find((c) => c.id === selectedClipId)
  const asset = clip && clip.kind !== 'text' ? assets.find((a) => a.id === clip.assetId) : undefined
  const track = clip ? tracks.find((t) => t.id === clip.trackId) : undefined
  const hasAudio = clip && (clip.kind === 'audio' || (clip.kind === 'video' && !!asset?.hasAudio))

  const dbOf = (v: number): string => (v <= 0.001 ? '-∞' : `${(20 * Math.log10(Math.max(0.001, v))).toFixed(1)} dB`)

  const generateSubtitlesForClip = async (): Promise<void> => {
    if (!clip || !asset) return
    const api = window.api as unknown as {
      subtitlesGenerate?: (req: {
        path: string
        start?: number
        duration?: number
        sourceLanguage: string
        targetLanguages: string[]
        modelId?: string
      }) => Promise<{
        ok: boolean
        error?: string
        warnings?: string[]
        detectedLanguage?: string
        tracks?: Array<{
          language: string
          languageLabel: string
          translated: boolean
          segments: Array<{ start: number; end: number; text: string }>
        }>
      }>
    }
    if (!api.subtitlesGenerate) {
      setSubMsg('Deze build heeft geen subtitle-engine (update de app).')
      return
    }
    setSubBusy(true)
    setSubMsg('Transcriberen…')
    try {
      const r = await api.subtitlesGenerate({
        path: asset.path,
        start: clip.sourceStart,
        duration: clip.duration,
        sourceLanguage: 'auto',
        targetLanguages: ['nl'],
        modelId: 'small'
      })
      if (r.ok && r.tracks?.length) {
        const s = useEditorStore.getState()
        const timeOffset = clip.start - clip.sourceStart
        r.tracks.forEach((t, i) => {
          s.addSubtitleClips(t.language, t.segments, {
            timeOffset,
            replace: i === 0
          })
        })
        setSubMsg(`Klaar: ${r.tracks.map((t) => t.languageLabel).join(', ')} (${r.detectedLanguage ?? '?'})`)
      } else {
        setSubMsg(r.error ?? r.warnings?.join(' ') ?? 'Transcriptie mislukt.')
      }
    } catch (e) {
      setSubMsg((e as Error).message)
    } finally {
      setSubBusy(false)
    }
  }

  const extractAudioClip = (): void => {
    if (!clip || !asset || !hasAudio) return
    const s = useEditorStore.getState()
    let audioTrack = s.tracks.find((t) => t.kind === 'audio')
    if (!audioTrack) {
      s.addTrack('audio')
      audioTrack = useEditorStore.getState().tracks.find((t) => t.kind === 'audio')
    }
    if (!audioTrack) return
    // voorkom dubbele extractie op exact dezelfde plek
    const exists = s.clips.some(
      (c) => c.kind === 'audio' && c.assetId === clip.assetId && Math.abs(c.start - clip.start) < 0.01
    )
    if (exists) {
      setExtractMsg('Audio staat al op de audiotrack.')
      return
    }
    const audioClip = {
      id: uid(),
      assetId: asset.id,
      assetPath: asset.path,
      trackId: audioTrack.id,
      start: clip.start,
      duration: clip.duration,
      sourceStart: clip.sourceStart,
      volume: clip.volume,
      effects: { ...DEFAULT_EFFECTS },
      transitionIn: null as null,
      transitionOut: null as null,
      kind: 'audio' as const
    }
    useEditorStore.setState((st) => ({ clips: [...st.clips, audioClip], selectedClipId: audioClip.id }))
    setExtractMsg('Audio geëxtraheerd naar audiotrack ✓')
  }

  const saveAudioFile = async (): Promise<void> => {
    if (!clip || !asset) return
    setExtracting(true)
    setExtractMsg('')
    try {
      const r = await window.api.extractAudio(asset.path, {
        start: clip.sourceStart,
        duration: clip.duration,
        name: (asset.name || 'audio').replace(/\.[a-z0-9]+$/i, '')
      })
      if (r.cancelled) {
        setExtractMsg('')
      } else if (r.ok) {
        setExtractMsg(`Audio opgeslagen ✓ (${r.outPath})`)
        if (r.outPath) {
          await importPaths([r.outPath], { place: false })
          await window.api.showItemInFolder(r.outPath)
        }
      } else {
        setExtractMsg(`Mislukt: ${r.error ?? 'onbekend'}`)
      }
    } catch (e) {
      setExtractMsg(`Mislukt: ${(e as Error).message}`)
    } finally {
      setExtracting(false)
    }
  }

  if (!clip) {
    return (
      <aside className="panel right">
        <div className="panel-body">
          <div className="empty-hint">
            Select a clip to edit its position, volume and color effects here.
          </div>
        </div>
      </aside>
    )
  }

  if (clip.kind === 'text' && clip.text) {
    const td = clip.text
    const setText = (patch: Partial<TextData>): void =>
      updateClip(clip.id, { text: { ...td, ...patch } })
    const applyPreset = (fx: Partial<TextData>): void =>
      updateClip(clip.id, { text: { ...td, ...fx } })
    const num = (v: string | undefined, fallback: number): number => {
      const n = Number(v)
      return Number.isFinite(n) ? n : fallback
    }
    return (
      <aside className="panel right">
        <div className="panel-body">
          <div className="inspector-section">
            <h4>Text presets</h4>
            <div className="text-preset-grid">
              {TEXT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.name}
                  onClick={() => applyPreset(p.fx)}
                  style={{
                    fontFamily: p.fx.fontFamily ?? 'inherit',
                    fontWeight: p.fx.fontWeight ?? 700,
                    fontStyle: p.fx.italic ? 'italic' : 'normal',
                    color: p.fx.color && p.fx.color !== 'transparent' ? p.fx.color : '#fff',
                    background: p.fx.bgColor && p.fx.bgColor !== 'transparent' ? p.fx.bgColor : 'linear-gradient(180deg,#2a2a30,#1a1a1e)',
                    borderColor: p.fx.strokeWidth ? p.fx.strokeColor || '#555' : undefined
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="inspector-section">
            <h4>Text</h4>
            <div className="ctl" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <label style={{ width: 'auto' }}>Text</label>
              <textarea
                className="text-input"
                rows={3}
                value={td.text}
                onChange={(e) => setText({ text: e.target.value })}
              />
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Size</label>
              <input type="range" min={12} max={260} step={1} value={td.fontSize} onChange={(e) => setText({ fontSize: +e.target.value })} />
              <span className="val">{td.fontSize}</span>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Color</label>
              <input
                type="color"
                value={toHex(td.color)}
                onChange={(e) => setText({ color: e.target.value })}
                style={{ flex: 1, height: 26 }}
              />
              <button
                onClick={() => setText({ color: 'transparent' })}
                style={{ padding: '2px 8px' }}
                title="Outline-only (transparent fill)"
                data-tooltip="Geen vulling"
              >
                None
              </button>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Background</label>
              <input
                type="color"
                value={toHex(td.bgColor)}
                onChange={(e) => setText({ bgColor: withAlpha(td.bgColor, e.target.value) })}
                style={{ flex: 1, height: 26 }}
              />
              <button onClick={() => setText({ bgColor: 'transparent' })} style={{ padding: '2px 8px' }} title="Off" data-tooltip="Off">Off</button>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Font</label>
              <select value={td.fontFamily} onChange={(e) => setText({ fontFamily: e.target.value })} style={{ flex: 1 }}>
                {FONT_LIST.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Weight</label>
              <select
                value={String(td.fontWeight ?? 700)}
                onChange={(e) => setText({ fontWeight: +e.target.value })}
                style={{ flex: 1 }}
              >
                {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Style</label>
              <div className="btn-row" style={{ flex: 1 }}>
                <button
                  className={td.italic ? 'active' : ''}
                  onClick={() => setText({ italic: !td.italic })}
                  title="Italic"
                  data-tooltip="Italic"
                  style={{ fontStyle: 'italic', fontWeight: 700 }}
                >
                  Italic
                </button>
                <button
                  className={td.underline ? 'active' : ''}
                  onClick={() => setText({ underline: !td.underline })}
                  title="Underline"
                  data-tooltip="Underline"
                  style={{ textDecoration: 'underline' }}
                >
                  Under
                </button>
              </div>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Spacing</label>
              <input
                type="range"
                min={-4}
                max={30}
                step={0.5}
                value={td.letterSpacing ?? 0}
                onChange={(e) => setText({ letterSpacing: +e.target.value })}
              />
              <span className="val">{td.letterSpacing ?? 0}</span>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Line H</label>
              <input
                type="range"
                min={0.8}
                max={2.2}
                step={0.05}
                value={td.lineHeight ?? 1.2}
                onChange={(e) => setText({ lineHeight: +e.target.value })}
              />
              <span className="val">{(td.lineHeight ?? 1.2).toFixed(2)}</span>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Opacity</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={td.opacity ?? 1}
                onChange={(e) => setText({ opacity: +e.target.value })}
              />
              <span className="val">{Math.round((td.opacity ?? 1) * 100)}</span>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Align</label>
              <select
                value={td.align ?? 'center'}
                onChange={(e) => setText({ align: e.target.value as TextData['align'] })}
                style={{ flex: 1 }}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>X</label>
              <input type="range" min={0} max={1} step={0.01} value={td.x} onChange={(e) => setText({ x: +e.target.value })} />
              <span className="val">{Math.round(td.x * 100)}</span>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Y</label>
              <input type="range" min={0} max={1} step={0.01} value={td.y} onChange={(e) => setText({ y: +e.target.value })} />
              <span className="val">{Math.round(td.y * 100)}</span>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Length</label>
              <input type="range" min={0.5} max={30} step={0.5} value={clip.duration} onChange={(e) => updateClip(clip.id, { duration: +e.target.value })} />
              <span className="val">{clip.duration.toFixed(1)}s</span>
            </div>
          </div>

          <div className="inspector-section">
            <h4>Design</h4>
            <div className="ctl">
              <label style={{ width: 76 }}>Stroke</label>
              <input
                type="color"
                value={toHex(td.strokeColor)}
                onChange={(e) => setText({ strokeColor: withAlpha(td.strokeColor, e.target.value) })}
                style={{ width: 42, height: 26 }}
              />
              <input
                type="range"
                min={0}
                max={16}
                step={0.5}
                value={td.strokeWidth ?? 0}
                onChange={(e) => setText({ strokeWidth: +e.target.value })}
                style={{ flex: 1 }}
              />
              <span className="val">{td.strokeWidth ?? 0}</span>
              <button
                onClick={() => setText({ strokeWidth: 0, strokeColor: 'transparent' })}
                style={{ padding: '2px 8px' }}
                title="Stroke uit"
                data-tooltip="Stroke uit"
              >
                Off
              </button>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Shadow</label>
              <input
                type="color"
                value={toHex(td.shadowColor)}
                onChange={(e) => setText({ shadowColor: withAlpha(td.shadowColor, e.target.value) })}
                style={{ width: 42, height: 26 }}
              />
              <input
                type="range"
                min={0}
                max={60}
                step={1}
                value={td.shadowBlur ?? 0}
                onChange={(e) => setText({ shadowBlur: +e.target.value })}
                style={{ flex: 1 }}
                title="Blur"
              />
              <span className="val">{td.shadowBlur ?? 0}</span>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Sh X/Y</label>
              <input
                type="range"
                min={-30}
                max={30}
                step={1}
                value={td.shadowX ?? 0}
                onChange={(e) => setText({ shadowX: +e.target.value })}
                style={{ flex: 1 }}
              />
              <input
                type="range"
                min={-30}
                max={30}
                step={1}
                value={td.shadowY ?? 0}
                onChange={(e) => setText({ shadowY: +e.target.value })}
                style={{ flex: 1 }}
              />
              <span className="val">{td.shadowX ?? 0},{td.shadowY ?? 0}</span>
            </div>
            <div className="btn-row">
              <button
                onClick={() =>
                  setText({
                    strokeColor: 'transparent',
                    strokeWidth: 0,
                    shadowColor: 'rgba(0,0,0,0)',
                    shadowBlur: 0,
                    shadowX: 0,
                    shadowY: 0
                  })
                }
                title="Design reset"
                data-tooltip="Design reset"
              >
                Reset design
              </button>
            </div>
          </div>

          <div className="inspector-section">
            <h4>Animation</h4>
            <div className="ctl">
              <label style={{ width: 76 }}>In</label>
              <select
                value={td.animIn ?? 'fade'}
                onChange={(e) => setText({ animIn: e.target.value as TextAnim })}
                style={{ flex: 1 }}
              >
                {ANIM_LIST.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Out</label>
              <select
                value={td.animOut ?? 'fade'}
                onChange={(e) => setText({ animOut: e.target.value as TextAnim })}
                style={{ flex: 1 }}
              >
                {ANIM_LIST.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Duration</label>
              <input
                type="range"
                min={0.1}
                max={3}
                step={0.05}
                value={td.animDuration ?? 0.45}
                onChange={(e) => setText({ animDuration: +e.target.value })}
              />
              <span className="val">{(td.animDuration ?? 0.45).toFixed(2)}s</span>
            </div>
            <div className="ai-hint">Scrub de timeline om in/out animatie live te zien in de preview.</div>
            <div className="btn-row">
              <button className="danger-ghost" onClick={() => removeClip(clip.id)} title="Delete text" data-tooltip="Delete text">Delete text</button>
            </div>
          </div>
        </div>
      </aside>
    )
  }

  const fx = clip.effects
  const setFx = (patch: Partial<ClipEffects>): void => updateClip(clip.id, { effects: { ...fx, ...patch } })
  const resetFx = (): void => updateClip(clip.id, { effects: { ...DEFAULT_EFFECTS } })

  const nextClip = clips
    .filter((c) => c.trackId === clip.trackId && c.id !== clip.id && c.start >= clip.start + clip.duration - 0.05)
    .sort((a, b) => a.start - b.start)[0]

  return (
    <aside className="panel right">
      <div className="panel-body">
        <div className="inspector-section">
          <h4>Clip</h4>
          <div className="ctl">
            <label>Name</label>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {asset?.name ?? 'Clip'}
            </span>
          </div>
          <div className="ctl">
            <label>Start</label>
            <span className="val" style={{ width: 'auto' }}>{formatTime(clip.start)}</span>
            <label style={{ width: 60 }}>Length</label>
            <span className="val" style={{ width: 'auto' }}>{formatTime(clip.duration)}</span>
          </div>
          <div className="ctl">
            <label>Volume</label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={clip.volume}
              onChange={(e) => updateClip(clip.id, { volume: +e.target.value })}
              title="0% = stil · 100% = origineel · tot 200% gain bij export"
            />
            <span className="val" title={dbOf(clip.volume)}>{Math.round(clip.volume * 100)}%</span>
          </div>
          <div className="ctl">
            <label />
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {clip.volume <= 0.001 ? 'Gedempt' : dbOf(clip.volume)}
              {clip.volume > 1 ? ' · boost (alleen export >100%)' : ' · preview tot 100%'}
              {track?.muted ? ' · track is gemute!' : ''}
            </span>
          </div>
          <div className="btn-row">
            <button onClick={() => updateClip(clip.id, { volume: 1 })} title="100%" data-tooltip="100%">100%</button>
            <button onClick={() => updateClip(clip.id, { volume: 0 })} title="Mute" data-tooltip="Mute">Mute</button>
            <button className="danger-ghost" onClick={() => removeClip(clip.id)} title="Delete clip" data-tooltip="Delete clip">
              Delete clip
            </button>
          </div>
        </div>

        {hasAudio && (
          <div className="inspector-section">
            <h4>Audio</h4>
            <div className="btn-row">
              {clip.kind === 'video' && (
                <button onClick={extractAudioClip} title="Zet het geluid van deze video als aparte audio-clip op de audiotrack" data-tooltip="Zet het geluid van deze video als aparte audio-clip op de audiotrack">
                  ⤷ Extract audio naar track
                </button>
              )}
              <button onClick={saveAudioFile} disabled={extracting} title="Sla alleen het geluid op als WAV/MP3-bestand" data-tooltip="Sla alleen het geluid op als WAV/MP3-bestand">
                {extracting ? 'Bezig…' : '💾 Save audio als…'}
              </button>
              <button
                onClick={() => void generateSubtitlesForClip()}
                disabled={subBusy}
                title="Genereer meertalige ondertitels voor deze clip (AI → Subtitles-track)"
                data-tooltip="Genereer ondertitels"
              >
                {subBusy ? 'Bezig…' : '💬 Generate subtitles'}
              </button>
              <button
                className="danger-ghost"
                onClick={() => {
                  const n = useEditorStore.getState().clearSubtitles()
                  setSubMsg(n ? `Verwijderd: ${n} ondertitel(s).` : 'Geen ondertitels om te verwijderen.')
                }}
                disabled={subBusy}
                title="Verwijder alle bestaande ondertitel-clips van de timeline"
                data-tooltip="Alle ondertitels verwijderen"
              >
                🗑 Remove all
              </button>
            </div>
            {subMsg && <div className="ai-hint">{subMsg}</div>}
            {extractMsg && <div className="ai-hint">{extractMsg}</div>}
            <div className="ai-hint">Tip: video met aparte audio-clip → video-audio wordt auto-gemute in preview om dubbel geluid te voorkomen.</div>
          </div>
        )}

        <div className="inspector-section">
          <h4>Effects</h4>
          <Slider label="Brightness" value={fx.brightness} min={-1} max={1} step={0.01} onChange={(v) => setFx({ brightness: v })} />
          <Slider label="Contrast" value={fx.contrast} min={-1} max={1} step={0.01} onChange={(v) => setFx({ contrast: v })} />
          <Slider label="Saturation" value={fx.saturation} min={-1} max={1} step={0.01} onChange={(v) => setFx({ saturation: v })} />
          <Slider label="Hue" value={fx.hue / 180} min={-1} max={1} step={0.01} onChange={(v) => setFx({ hue: v * 180 })} />
          <Slider label="Grayscale" value={fx.grayscale} min={0} max={1} step={0.01} onChange={(v) => setFx({ grayscale: v })} />
          <Slider label="Sepia" value={fx.sepia} min={0} max={1} step={0.01} onChange={(v) => setFx({ sepia: v })} />
          <Slider label="Blur" value={fx.blur} min={0} max={10} step={0.1} onChange={(v) => setFx({ blur: v })} />
          <Slider label="Invert" value={fx.invert} min={0} max={1} step={0.01} onChange={(v) => setFx({ invert: v })} />
          <Slider label="Vignette" value={fx.vignette} min={0} max={1} step={0.01} onChange={(v) => setFx({ vignette: v })} />
          <div className="btn-row">
            <button onClick={resetFx} title="Reset" data-tooltip="Reset">Reset</button>
          </div>
        </div>

        <div className="inspector-section" key={clip.id + ':' + ((clip.transitionOut ?? clip.transitionIn)?.type ?? 'none')}>
          <h4>Transition</h4>
          <div className="ctl">
            <label style={{ width: 76 }}>Type</label>
            <select
              value={(clip.transitionOut ?? clip.transitionIn)?.type ?? transType}
              onChange={(e) => {
                const type = e.target.value as TransitionType
                setTransType(type)
                const duration = (clip.transitionOut ?? clip.transitionIn)?.duration ?? transDur
                addTransition(clip.id, type, duration)
              }}
              style={{ flex: 1 }}
            >
              {(clip.kind === 'audio' ? AUDIO_TRANSITIONS : VIDEO_TRANSITIONS).map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="ctl">
            <label style={{ width: 76 }}>Duration</label>
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.1}
              value={(clip.transitionOut ?? clip.transitionIn)?.duration ?? transDur}
              onChange={(e) => {
                const duration = +e.target.value
                setTransDur(duration)
                const type = (clip.transitionOut ?? clip.transitionIn)?.type ?? transType
                addTransition(clip.id, type, duration)
              }}
            />
            <span className="val">{((clip.transitionOut ?? clip.transitionIn)?.duration ?? transDur).toFixed(1)}s</span>
          </div>
          <div className="btn-row">
            <button
              onClick={() => {
                const type = (clip.transitionOut ?? clip.transitionIn)?.type ?? transType
                const duration = (clip.transitionOut ?? clip.transitionIn)?.duration ?? transDur
                addTransition(clip.id, type, duration)
              }}
              title="Apply transition"
              data-tooltip="Apply transition"
            >
              Apply
            </button>
            {(clip.transitionOut || clip.transitionIn) && (
              <button onClick={() => clearTransition(clip.id)} title="Remove transition" data-tooltip="Remove transition">
                Remove
              </button>
            )}
          </div>
          <div className="panel-section-title">
            {clip.kind === 'audio'
              ? nextClip ? 'Audio crossfade with next on this track' : 'Fade in/out on this audio clip'
              : OVERLAP_TRANSITIONS.has((clip.transitionOut ?? clip.transitionIn)?.type ?? 'crossfade')
                ? nextClip
                  ? 'Overlaps next clip on this track'
                  : 'No next clip — place one to overlap'
                : nextClip
                  ? 'Fade before next clip'
                  : 'Fade only (no next clip needed)'}
          </div>
          {(clip.transitionOut || clip.transitionIn) && (
            <div className="ai-hint">
              Active: {(clip.transitionOut ?? clip.transitionIn)!.type} · {(clip.transitionOut ?? clip.transitionIn)!.duration.toFixed(1)}s
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
