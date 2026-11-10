import { Fragment, memo, useCallback, useState } from 'react'
import { useEditorStore } from '../store'
import ColorWheel from './ColorWheel'
import SubtitlePanel from './SubtitlePanel'
import { CAPTION_PRESETS, DEFAULT_AUDIO_EFFECTS, hasAudioFx } from '../../../shared/types'
import { formatTime } from '../lib/format'
import { importPaths } from '../lib/inspect'
import type { ClipEffects, TextAnim, TextData, TextPreset, TransitionType } from '../../../shared/types'
import { animsForMode, isPreviewOnlyAnim } from '../../../shared/textanim'
import {
  ANIM_LIST,
  AUDIO_TRANSITIONS,
  DEFAULT_EFFECTS,
  FONT_LIST,
  OVERLAP_TRANSITIONS,
  TEXT_PRESETS,
  VIDEO_TRANSITIONS
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
  onChange,
  unit = '',
  bipolar = false,
  scale = 100
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  /** eenheid achter de waarde, bv. '%' of '°' */
  unit?: string
  /** min < 0 < max: 0 zit dan in het midden en krijgt een streepje */
  bipolar?: boolean
  /** waarde × dit = getoonde waarde */
  scale?: number
}): JSX.Element {
  const shown = value * scale
  const text = (bipolar && value > 0 ? '+' : '') + Math.round(shown) + unit
  return (
    <div className={`ctl${bipolar ? ' ctl-bipolar' : ''}`}>
      <label>{label}</label>
      <span className="ctl-track">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      </span>
      <span className="val">{text}</span>
    </div>
  )
}

/** Inklapbare sectie: houdt de Inspector leesbaar i.p.v. een muur schuivers. */
function Section({
  title,
  children,
  defaultOpen = true,
  badge
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  badge?: string
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`inspector-section collapsible${open ? ' open' : ''}`}>
      <button
        className="section-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={open ? 'Klap dicht' : 'Klap open'}
        data-tooltip={open ? 'Klap dicht' : 'Klap open'}
      >
        <span className="chev">{open ? '\u25be' : '\u25b8'}</span>
        <h4>{title}</h4>
        {badge && <span className="section-badge">{badge}</span>}
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  )
}

/**
 * Animatie-keuzelijst, gegroepeerd. De 3D-diepte zit in een eigen groep (dat is
 * een eigen UX: je kiest die omdat je diepte wilt, niet omdat je een richting
 * wilt), en de rasterfuncties onder 'Alleen in preview' omdat die in de export
 * niet bestaan.
 *
 * De lijst wordt per richting gefilterd: sommige animaties zijn bewust maar één
 * kant op (dollyIn is de tegengestelde van dollyOut), en een animatie zonder
 * curve voor de gekozen richting zou hier stilletjes een fade zijn.
 */
function Anims({ mode }: { mode: 'in' | 'out' }): JSX.Element {
  const allowed = new Set(animsForMode(mode))
  const groups = new Map<string, typeof ANIM_LIST>()
  const bare: typeof ANIM_LIST = []
  for (const a of ANIM_LIST) {
    if (!allowed.has(a.id)) continue
    if (!a.group) {
      bare.push(a)
      continue
    }
    const arr = groups.get(a.group) ?? []
    arr.push(a)
    groups.set(a.group, arr)
  }
  return (
    <>
      {bare.map((a) => (
        <option key={a.id} value={a.id}>{a.label}</option>
      ))}
      {[...groups].map(([label, items]) => (
        <optgroup key={label} label={label}>
          {items.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </optgroup>
      ))}
    </>
  )
}

/** Welke animaties van deze preset alleen in de preview bestaan. */
const previewOnlyPresetAnims = (p: TextPreset): TextAnim[] =>
  [p.fx.animIn, p.fx.animOut].filter((a): a is TextAnim => !!a && isPreviewOnlyAnim(a))

/** Presets per groep, volgorde zoals in TEXT_PRESETS. Groep null = zonder kop. */
const PRESET_GROUPS: Array<[string | null, TextPreset[]]> = (() => {
  const order: Array<string | null> = [null]
  for (const p of TEXT_PRESETS) {
    if (p.group && !order.includes(p.group)) order.push(p.group)
  }
  return order.map((g) => [g, TEXT_PRESETS.filter((p) => (p.group ?? null) === g)])
})()

/**
 * De preset-kiezer op zichzelf, gememoized.
 *
 * De Inspector her-render't bij élke clips-wijziging — dus ook bij elke frame
 * van het slepen van een titel. Zonder memo bouwt dat raster 29 knoppen opnieuw
 * op, wat het slepen merkbaar traag maakte. De enige prop is `clipId`, dus hij
 * blijft tijdens zo'n sleep volledig ongemoeid.
 */
const PresetGrid = memo(function PresetGrid({ clipId }: { clipId: string }): JSX.Element {
  const updateClip = useEditorStore((s) => s.updateClip)
  const onPick = useCallback(
    (p: TextPreset): void => {
      const clip = useEditorStore.getState().clips.find((c) => c.id === clipId)
      if (!clip?.text) return
      // De voorbeeldtekst vult de stijl aan — een citaat met één woord leest niet
      // als een citaat. Alleen als er nog niks getypt is, dus nooit overschrijven.
      const untouched = !clip.text.text || clip.text.text === 'Title'
      const sample = p.sample && untouched ? { text: p.sample } : {}
      updateClip(clipId, { text: { ...clip.text, ...sample, ...p.fx } })
    },
    [clipId, updateClip]
  )
  return (
    <div className="text-preset-grid">
      {PRESET_GROUPS.map(([name, items]) => (
        <Fragment key={name ?? '__none'}>
          {name && <div className="preset-group-title">{name}</div>}
          {items.map((p) => {
            // Ook hier geldt: een rasterfunctie bestaat alleen in de preview.
            // Dat mag niet stil, want dan lijkt de preset te werken en verdwijnt
            // de beweging in de export.
            const onlyPreview = previewOnlyPresetAnims(p)
            return (
              <button
                key={p.id}
                type="button"
                title={
                  `${p.name}${p.sample ? ` — voorbeeld: ${p.sample.replace(/\n/g, ' / ')}` : ''}` +
                  (onlyPreview.length ? `\n⚠ ${onlyPreview.join(' en ')} bestaan alleen in de preview` : '')
                }
                onClick={() => onPick(p)}
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
                {onlyPreview.length > 0 && <span className="preset-warn" aria-hidden="true">*</span>}
              </button>
            )
          })}
        </Fragment>
      ))}
    </div>
  )
})

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
  const subCount = clips.reduce((n, c) => (c.subtitle ? n + 1 : n), 0)
  const subFirst = clips.find((c) => c.subtitle && c.text)
  const subPos = subFirst ? { x: subFirst.text!.x, y: subFirst.text!.y } : null

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
        const timeOffset = clip.start - clip.sourceStart
        r.tracks.forEach((t, i) => {
          useEditorStore.getState().addSubtitleClips(t.language, t.segments, {
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

  const extractAudioClip = async (): Promise<void> => {
    if (!clip || !asset || !hasAudio) return
    setExtracting(true)
    setExtractMsg('Audio extraheren…')
    try {
      const r = await useEditorStore.getState().extractAudioToTrack(asset.id, clip.kind === 'video' ? clip.id : undefined)
      if (!r.ok) {
        setExtractMsg(r.error ?? 'Mislukt')
      } else if (r.alreadyExisted) {
        setExtractMsg('Audio stond al op de audiotrack ✓')
      } else {
        setExtractMsg('Audio geëxtraheerd en op de audiotrack gezet ✓')
      }
    } catch (e) {
      setExtractMsg(`Mislukt: ${(e as Error).message}`)
    } finally {
      setExtracting(false)
    }
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

  // Deze hooks staan bewust BOVEN de vroege return hieronder: een conditional
  // hook laat React crashen met "Rendered more hooks than during the previous
  // render" en valt daarmee de hele app uit (preview mee).
  const setClipAudioFx = useEditorStore((s) => s.setClipAudioFx)
  const resetTrackAudioFx = useEditorStore((s) => s.resetTrackAudioFx)

  if (!clip) {
    return (
      <aside className="panel right">
        <div className="panel-body">
          {subCount > 0 && <SubtitlePanel />}
          <div className="empty-hint">Select a clip to edit its position, volume and color effects here.</div>
        </div>
      </aside>
    )
  }

  if (clip.kind === 'text' && clip.text) {
    const td = clip.text
    const setText = (patch: Partial<TextData>): void =>
      updateClip(clip.id, { text: { ...td, ...patch } })
    const num = (v: string | undefined, fallback: number): number => {
      const n = Number(v)
      return Number.isFinite(n) ? n : fallback
    }
    return (
      <aside className="panel right">
        <div className="panel-body">
          {subCount > 0 && <SubtitlePanel />}
          <div className="inspector-section">
            <h4>Text presets</h4>
            <PresetGrid clipId={clip.id} />
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
              <div className="emoji-row">
                {['🔥', '✨', '💬', '🎤', '⚡', '😂', '❤️', '👑', '🚀', '🎯', '💯', '👏'].map((em) => (
                  <button
                    key={em}
                    type="button"
                    className="emoji-btn"
                    onClick={() => setText({ text: td.text ? `${td.text} ${em}` : em })}
                    title={`${em} toevoegen`}
                    data-tooltip={`${em} toevoegen`}
                  >
                    {em}
                  </button>
                ))}
              </div>
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
                <Anims mode="in" />
              </select>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Out</label>
              <select
                value={td.animOut ?? 'fade'}
                onChange={(e) => setText({ animOut: e.target.value as TextAnim })}
                style={{ flex: 1 }}
              >
                <Anims mode="out" />
              </select>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Duur</label>
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
  // badge 'aangepast' zodat je in de lijst ziet dát er iets staat zonder alles open te klappen
  const fxActive = Object.values(fx).some((v) => Math.abs(v) > 0.001)
  const afx = clip.audioFx ?? DEFAULT_AUDIO_EFFECTS
  const setAfx = (patch: Partial<typeof afx>): void => setClipAudioFx(clip.id, patch)
  const afxActive = hasAudioFx(afx)

  const nextClip = clips
    .filter((c) => c.trackId === clip.trackId && c.id !== clip.id && c.start >= clip.start + clip.duration - 0.05)
    .sort((a, b) => a.start - b.start)[0]

  return (
    <aside className="panel right">
      <div className="panel-body">
        <Section title="Clip" badge={clip.kind === 'text' ? 'tekst' : clip.kind === 'audio' ? 'audio' : 'video'}>
          <div className="ctl">
            <label>Naam</label>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {asset?.name ?? 'Clip'}
            </span>
          </div>
          <div className="ctl">
            <label>Start</label>
            <span className="val" style={{ width: 'auto' }}>{formatTime(clip.start)}</span>
            <label style={{ width: 60 }}>Lengte</label>
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
            <button onClick={() => updateClip(clip.id, { volume: 0 })} title="Gedempt" data-tooltip="Gedempt">Gedempt</button>
            <button className="danger-ghost" onClick={() => removeClip(clip.id)} title="Clip verwijderen" data-tooltip="Clip verwijderen">
              Verwijderen
            </button>
          </div>
        </Section>

        {(clip.kind === 'video' || clip.kind === 'audio') && (
          <Section
            title="Snelheid"
            defaultOpen={false}
            badge={clip.reversed ? 'achteruit' : clip.freezeAt != null && (clip.freezeDuration ?? 0) > 0 ? 'freeze' : undefined}
          >
            <div className="ctl">
              <label style={{ width: 76 }}>Achteruit</label>
              <input
                type="checkbox"
                checked={!!clip.reversed}
                onChange={(e) => updateClip(clip.id, { reversed: e.target.checked || undefined })}
                title="Clip achterstevoren afspelen"
              />
              <span className="val">{clip.reversed ? 'aan' : 'uit'}</span>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Freeze op</label>
              <input
                type="range"
                min={0}
                max={Math.max(0.1, clip.duration - 0.05)}
                step={0.05}
                value={Math.min(clip.freezeAt ?? 0, Math.max(0, clip.duration - 0.05))}
                onChange={(e) => {
                  const at = +e.target.value
                  const dur = Math.min(clip.freezeDuration ?? 1, Math.max(0.1, clip.duration - at))
                  updateClip(clip.id, { freezeAt: at, freezeDuration: dur })
                }}
              />
              <span className="val">{(clip.freezeAt ?? 0).toFixed(2)}s</span>
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Freeze-duur</label>
              <input
                type="range"
                min={0.1}
                max={Math.max(0.2, clip.duration)}
                step={0.1}
                value={Math.min(clip.freezeDuration ?? 1, Math.max(0.1, clip.duration - (clip.freezeAt ?? 0)))}
                onChange={(e) => {
                  const at = Math.min(clip.freezeAt ?? 0, Math.max(0, clip.duration - 0.05))
                  const dur = Math.min(+e.target.value, Math.max(0.1, clip.duration - at))
                  updateClip(clip.id, { freezeAt: at, freezeDuration: dur })
                }}
              />
              <span className="val">{(clip.freezeDuration ?? 1).toFixed(1)}s</span>
            </div>
            <div className="btn-row">
              <button
                onClick={() => {
                  const s = useEditorStore.getState()
                  const at = Math.min(Math.max(0, s.playhead - clip.start), Math.max(0, clip.duration - 0.05))
                  const dur = Math.min(clip.freezeDuration ?? 1, Math.max(0.1, clip.duration - at))
                  updateClip(clip.id, { freezeAt: at, freezeDuration: dur })
                }}
                title="Zet freeze op de playhead-positie"
                data-tooltip="Zet freeze op de playhead-positie"
              >
                Van playhead
              </button>
              {(clip.freezeAt != null || (clip.freezeDuration ?? 0) > 0) && (
                <button
                  className="danger-ghost"
                  onClick={() => updateClip(clip.id, { freezeAt: null, freezeDuration: 0 })}
                  title="Freeze wissen"
                  data-tooltip="Freeze wissen"
                >
                  Wis freeze
                </button>
              )}
            </div>
            <div className="ai-hint">
              Tijdens de freeze staat het beeld stil op dat frame; de video eronder in dat stuk wordt overgeslagen, de timeline zelf blijft even lang.
              Achteruit dempt het geluid in de preview (terugspoelen kan niet live); in de export wordt het geluid echt omgekeerd.
            </div>
          </Section>
        )}

        {subCount > 0 && <SubtitlePanel />}

        {hasAudio && (
          <Section title="Audio" defaultOpen={false} badge={clip.kind === 'audio' ? 'audioclip' : undefined}>
            <div className="btn-row">
              {clip.kind === 'video' && (
                <button onClick={() => void extractAudioClip()} disabled={extracting} title="Haal de audiotrack uit deze video en zet die als clip op de audiotrack" data-tooltip="Haal de audiotrack uit deze video en zet die als clip op de audiotrack">
                  {extracting ? 'Bezig…' : '⤷ Extract audio naar track'}
                </button>
              )}
              <button onClick={saveAudioFile} disabled={extracting} title="Sla alleen het geluid op als WAV/MP3-bestand" data-tooltip="Sla alleen het geluid op als WAV/MP3-bestand">
                {extracting ? 'Bezig…' : '💾 Geluid opslaan'}
              </button>
              <button
                onClick={() => void generateSubtitlesForClip()}
                disabled={subBusy}
                title="Genereer meertalige ondertitels voor deze clip (AI → Subtitles-track)"
                data-tooltip="Genereer ondertitels"
              >
                {subBusy ? 'Bezig…' : '💬 Ondertitels maken'}
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
                🗑 Alles weg
              </button>
            </div>
            {subMsg && <div className="ai-hint">{subMsg}</div>}
            {extractMsg && <div className="ai-hint">{extractMsg}</div>}
            <div className="ai-hint">Tip: na extractie staat het geluid op de audiotrack en wordt de video zelf stil — anders dubbel geluid.</div>
          </Section>
        )}

        <Section title="Audio-effecten" defaultOpen={false} badge={afxActive ? 'aangepast' : undefined}>
          <div className="fx-group">
            <div className="fx-group-title">Equalizer</div>
            <Slider
              label="Laag (200 Hz)"
              scale={1}
              value={afx.eqLow}
              min={-12}
              max={12}
              step={0.5}
              bipolar
              unit=" dB"
              onChange={(v) => setAfx({ eqLow: v })}
            />
            <Slider
              label="Midden (1 kHz)"
              scale={1}
              value={afx.eqMid}
              min={-12}
              max={12}
              step={0.5}
              bipolar
              unit=" dB"
              onChange={(v) => setAfx({ eqMid: v })}
            />
            <Slider
              label="Hoog (3,5 kHz)"
              scale={1}
              value={afx.eqHigh}
              min={-12}
              max={12}
              step={0.5}
              bipolar
              unit=" dB"
              onChange={(v) => setAfx({ eqHigh: v })}
            />
          </div>
          <div className="fx-group">
            <div className="fx-group-title">Dynamiek &amp; ruimte</div>
            <Slider
              label="Compressor"
              value={afx.compressor}
              min={0}
              max={1}
              step={0.01}
              unit="%"
              onChange={(v) => setAfx({ compressor: v })}
            />
            <Slider
              label="Ruimte (reverb)"
              value={afx.reverb}
              min={0}
              max={1}
              step={0.01}
              unit="%"
              onChange={(v) => setAfx({ reverb: v })}
            />
            <Slider
              label="Ruisreductie"
              value={afx.noiseReduction}
              min={0}
              max={1}
              step={0.01}
              unit="%"
              onChange={(v) => setAfx({ noiseReduction: v })}
            />
            <div className="ai-hint" style={{ marginTop: 6 }}>
              Eq, compressor en reverb hoor je meteen in de preview. Ruisreductie werkt alleen in de
              export — Web Audio heeft daar geen eerlijke equivalent voor.
            </div>
          </div>
          <div className="btn-row">
            <button
              onClick={() => setClipAudioFx(clip.id, {})}
              title="Audio-effecten en volume terugzetten"
              data-tooltip="Audio-effecten en volume terugzetten"
            >
              Alles terug
            </button>
            <button
              className="ghost"
              onClick={() => resetTrackAudioFx(clip.trackId)}
              title="Reset alle clips op deze track"
              data-tooltip="Reset alle clips op deze track"
            >
              Hele track resetten
            </button>
          </div>
        </Section>

        <Section title="Beeld-effecten" defaultOpen={false} badge={fxActive ? 'aangepast' : undefined}>
          <div className="fx-group">
            <div className="fx-group-title">Licht &amp; kleur</div>
            <Slider label="Helderheid" value={fx.brightness} min={-1} max={1} step={0.01} bipolar onChange={(v) => setFx({ brightness: v })} />
            <Slider label="Contrast" value={fx.contrast} min={-1} max={1} step={0.01} bipolar onChange={(v) => setFx({ contrast: v })} />
            <Slider label="Verzadiging" value={fx.saturation} min={-1} max={1} step={0.01} bipolar onChange={(v) => setFx({ saturation: v })} />
            <Slider label="Kleurtoon" value={fx.hue / 180} min={-1} max={1} step={0.01} bipolar unit="°" onChange={(v) => setFx({ hue: v * 180 })} />
            <Slider label="Grijs" value={fx.grayscale} min={0} max={1} step={0.01} unit="%" onChange={(v) => setFx({ grayscale: v })} />
            <Slider label="Sepia" value={fx.sepia} min={0} max={1} step={0.01} unit="%" onChange={(v) => setFx({ sepia: v })} />
            <Slider label="Negatief" value={fx.invert} min={0} max={1} step={0.01} unit="%" onChange={(v) => setFx({ invert: v })} />
          </div>
          <div className="fx-group">
            <div className="fx-group-title">Color grading</div>
            <Slider label="Temperature" value={fx.temperature} min={-80} max={80} step={1} onChange={(v) => setFx({ temperature: v })} />
            <Slider label="Tint" value={fx.tint} min={-80} max={80} step={1} onChange={(v) => setFx({ tint: v })} />
            <div className="color-wheels">
              <ColorWheel
                label="Schaduw"
                value={toHex(fx.shadowColor)}
                onChange={(hex) => setFx({ shadowColor: hex })}
              />
              <ColorWheel
                label="Midden"
                value={toHex(fx.midtoneColor)}
                onChange={(hex) => setFx({ midtoneColor: hex })}
              />
              <ColorWheel
                label="Hooglicht"
                value={toHex(fx.highlightColor)}
                onChange={(hex) => setFx({ highlightColor: hex })}
              />
            </div>
          </div>
          <div className="fx-group">
            <div className="fx-group-title">Afwerking</div>
            <Slider label="Vervagen" value={fx.blur} min={0} max={10} step={0.1} scale={10} unit="px" onChange={(v) => setFx({ blur: v })} />
            <Slider label="Vignet" value={fx.vignette} min={0} max={1} step={0.01} unit="%" onChange={(v) => setFx({ vignette: v })} />
          </div>
          <div className="fx-group">
            <div className="fx-group-title">Actie</div>
            <Slider label="Flits" value={fx.flash ?? 0} min={0} max={1} step={0.01} unit="%" onChange={(v) => setFx({ flash: v })} />
            <Slider label="Flitstempo" value={fx.flashRate ?? 2} min={0.5} max={8} step={0.1} unit="Hz" scale={1} onChange={(v) => setFx({ flashRate: v })} />
            <Slider label="Schudden" value={fx.shake ?? 0} min={0} max={1} step={0.01} unit="%" onChange={(v) => setFx({ shake: v })} />
            <Slider label="Schudtempo" value={fx.shakeSpeed ?? 0.5} min={0} max={1} step={0.01} unit="%" onChange={(v) => setFx({ shakeSpeed: v })} />
            <Slider label="Zoomen" value={fx.zoom ?? 0} min={0} max={1} step={0.01} unit="%" onChange={(v) => setFx({ zoom: v })} />
            <Slider label="Zoomtempo" value={fx.zoomSpeed ?? 0.5} min={0} max={1} step={0.01} unit="%" onChange={(v) => setFx({ zoomSpeed: v })} />
            <Slider label="Korrel" value={fx.grain ?? 0} min={0} max={1} step={0.01} unit="%" onChange={(v) => setFx({ grain: v })} />
            <Slider label="Flikker" value={fx.flicker ?? 0} min={0} max={1} step={0.01} unit="%" onChange={(v) => setFx({ flicker: v })} />
            <div className="ctl">
              <label style={{ width: 76 }}>Spiegel</label>
              <select
                value={fx.mirror ?? 0}
                onChange={(e) => setFx({ mirror: Number(e.target.value) })}
                style={{ flex: 1 }}
              >
                <option value={0}>Uit</option>
                <option value={1}>Horizontaal</option>
                <option value={2}>Verticaal</option>
              </select>
            </div>
          </div>
          <div className="btn-row">
            <button onClick={resetFx} title="Alles terug naar 0" data-tooltip="Alles terug naar 0">Alles terug</button>
          </div>
        </Section>

        <Section
          title="Overgang"
          defaultOpen={false}
          key={clip.id + ':' + ((clip.transitionOut ?? clip.transitionIn)?.type ?? 'none')}
          badge={(clip.transitionOut ?? clip.transitionIn)?.type ?? undefined}
        >
          <div className="ctl">
            <label style={{ width: 76 }}>Soort</label>
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
            <label style={{ width: 76 }}>Duur</label>
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
              title="Overgang toepassen"
              data-tooltip="Overgang toepassen"
            >
              Toepassen
            </button>
            {(clip.transitionOut || clip.transitionIn) && (
              <button onClick={() => clearTransition(clip.id)} title="Overgang weghalen" data-tooltip="Overgang weghalen">
                Weghalen
              </button>
            )}
          </div>
          <div className="panel-section-title">
            {clip.kind === 'audio'
              ? nextClip ? 'Audio-crossfade met het volgende clipje op deze track' : 'In- en uitfaden op dit audioclip'
              : OVERLAP_TRANSITIONS.has((clip.transitionOut ?? clip.transitionIn)?.type ?? 'crossfade')
                ? nextClip
                  ? 'Overlapt het volgende clipje op deze track'
                  : 'Geen volgend clipje — plaats er één om te overlappen'
                : nextClip
                  ? 'Fadt weg vóór het volgende clipje'
                  : 'Alleen faden (volgend clipje niet nodig)'}
          </div>
          {(clip.transitionOut || clip.transitionIn) && (
            <div className="ai-hint">
              Active: {(clip.transitionOut ?? clip.transitionIn)!.type} · {(clip.transitionOut ?? clip.transitionIn)!.duration.toFixed(1)}s
            </div>
          )}
        </Section>
      </div>
    </aside>
  )
}
