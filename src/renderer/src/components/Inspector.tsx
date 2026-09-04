import { useEditorStore } from '../store'
import { formatTime } from '../lib/format'
import type { ClipEffects } from '../../../shared/types'
import { DEFAULT_EFFECTS } from '../../../shared/types'

const FONT_LIST = ['Arial', 'Helvetica', 'Arial Black', 'Georgia', 'Times New Roman', 'Courier', 'Impact', 'Tahoma', 'Verdana', 'Comic Sans MS']

function toHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color
  const t = document.createElement('canvas').getContext('2d')!
  t.fillStyle = color
  return t.fillStyle
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
  const assets = useEditorStore((s) => s.assets)
  const updateClip = useEditorStore((s) => s.updateClip)
  const removeClip = useEditorStore((s) => s.removeClip)
  const addTransition = useEditorStore((s) => s.addTransition)
  const clearTransition = useEditorStore((s) => s.clearTransition)

  const clip = clips.find((c) => c.id === selectedClipId)
  const asset = clip && clip.kind !== 'text' ? assets.find((a) => a.id === clip.assetId) : undefined

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
    const setText = (patch: Partial<typeof td>): void =>
      updateClip(clip.id, { text: { ...td, ...patch } })
    return (
      <aside className="panel right">
        <div className="panel-body">
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
              <input type="color" value={toHex(td.color)} onChange={(e) => setText({ color: e.target.value })} style={{ flex: 1, height: 26 }} />
            </div>
            <div className="ctl">
              <label style={{ width: 76 }}>Background</label>
              <input type="color" value={toHex(td.bgColor === 'transparent' ? '#000000' : td.bgColor)} onChange={(e) => setText({ bgColor: e.target.value })} style={{ flex: 1, height: 26 }} />
              <button onClick={() => setText({ bgColor: 'transparent' })} style={{ padding: '2px 8px' }}>Off</button>
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
            <div className="btn-row">
              <button className="danger-ghost" onClick={() => removeClip(clip.id)}>Delete text</button>
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
            />
            <span className="val">{Math.round(clip.volume * 100)}</span>
          </div>
          <div className="btn-row">
            <button className="danger-ghost" onClick={() => removeClip(clip.id)}>
              Delete clip
            </button>
          </div>
        </div>

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
            <button onClick={resetFx}>Reset</button>
          </div>
        </div>

        <div className="inspector-section">
          <h4>Transition</h4>
          {nextClip ? (
            <>
              <div className="btn-row">
                <button onClick={() => addTransition(clip.id, 'crossfade', 0.5)}>Crossfade 0.5s</button>
                <button onClick={() => addTransition(clip.id, 'crossfade', 1)}>Crossfade 1s</button>
                <button onClick={() => addTransition(clip.id, 'fade', 0.5)}>Fade out</button>
              </div>
              {(clip.transitionOut || clip.transitionIn) && (
                <div className="btn-row">
                  <button onClick={() => clearTransition(clip.id)}>Remove transition</button>
                </div>
              )}
              <div className="panel-section-title">to: {asset ? '' : ''}{nextClip ? 'next clip on this track' : ''}</div>
            </>
          ) : (
            <div className="empty-hint" style={{ marginTop: 0 }}>
              No next clip on this track.
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
