import { useState } from 'react'
import { useEditorStore } from '../store'
import { CAPTION_PRESETS, FONT_LIST, type TextData } from '../../../shared/types'

const ALIGNMENTS: Array<{ id: 'left' | 'center' | 'right'; label: string }> = [
  { id: 'left', label: 'Links' },
  { id: 'center', label: 'Midden' },
  { id: 'right', label: 'Rechts' }
]

const toHex = (c: string, fallback: string): string => {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  const m = /^rgba?\(([^)]+)\)$/.exec(c)
  if (m) {
    const [r, g, b] = m[1].split(',').map((x) => Number(x.trim()))
    if ([r, g, b].every((n) => Number.isFinite(n))) {
      return '#' + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')
    }
  }
  return fallback
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="ctl sub-ctl">
      <label style={{ width: 76 }}>{label}</label>
      {children}
    </div>
  )
}

// Global caption controls: everything here applies to all captions at once,
// because per-clip caption styling is a mistake another 2 months will undo.
export default function SubtitlePanel(): JSX.Element | null {
  const clips = useEditorStore((s) => s.clips)
  const setSubtitleProps = useEditorStore((s) => s.setSubtitleProps)
  const setSubtitlePosition = useEditorStore((s) => s.setSubtitlePosition)
  const setSubtitleStyle = useEditorStore((s) => s.setSubtitleStyle)
  const clearSubtitles = useEditorStore((s) => s.clearSubtitles)
  const [styleId, setStyleId] = useState('cap-standard')

  const subs = clips.filter((c) => c.subtitle && c.text)
  const first = subs[0]?.text
  if (!first) return null

  const isKaraoke = !!first.words?.length
  const patch = (p: Partial<TextData>): void => {
    setSubtitleProps(p)
  }

  return (
    <div className="inspector-section sub-panel">
      <h4>
        Ondertitels · {subs.length} clip(s)
      </h4>

      <div className="cap-presets">
        {CAPTION_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`cap-preset ${first.captionStyle === p.id ? 'active' : ''}`}
            onClick={() => {
              setStyleId(p.id)
              setSubtitleStyle(p.id)
            }}
            title={`${p.name} · ${p.wordMode === 'karaoke' ? 'woord-timings' : p.wordMode === 'single' ? 'één woord per clip' : 'per zin'}`}
            data-tooltip={p.name}
            aria-pressed={first.captionStyle === p.id}
          >
            <span className="cap-preset-emoji">{p.emoji}</span>
            <span className="cap-preset-name">{p.name}</span>
          </button>
        ))}
      </div>

      <Row label="Size">
        <input
          type="range"
          min={12}
          max={200}
          step={1}
          value={first.fontSize}
          onChange={(e) => patch({ fontSize: +e.target.value })}
        />
        <span className="val">{first.fontSize}</span>
      </Row>

      <Row label="Tekstkleur">
        <input
          type="color"
          value={toHex(first.color, '#ffffff')}
          onChange={(e) => patch({ color: e.target.value })}
          style={{ flex: 1, height: 26 }}
        />
      </Row>

      <Row label="Achtergrond">
        <input
          type="color"
          value={toHex(first.bgColor, '#000000')}
          onChange={(e) => patch({ bgColor: e.target.value })}
          style={{ flex: 1, height: 26 }}
        />
        <button
          onClick={() => patch({ bgColor: 'transparent' })}
          style={{ padding: '2px 8px' }}
          title="Geen balk"
          data-tooltip="Geen balk"
        >
          Off
        </button>
      </Row>

      <Row label="Font">
        <select value={first.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })} style={{ flex: 1 }}>
          {FONT_LIST.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Weight">
        <select
          value={String(first.fontWeight ?? 500)}
          onChange={(e) => patch({ fontWeight: +e.target.value })}
          style={{ flex: 1 }}
        >
          {[300, 400, 500, 600, 700, 800, 900].map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Uitlijning">
        <div className="btn-row" style={{ flex: 1 }}>
          {ALIGNMENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => patch({ align: a.id })}
              className={(first.align ?? 'center') === a.id ? 'active' : ''}
              title={a.label}
              data-tooltip={a.label}
            >
              {a.label[0]}
            </button>
          ))}
        </div>
      </Row>

      <Row label="Outline">
        <input
          type="range"
          min={0}
          max={12}
          step={0.5}
          value={first.strokeWidth ?? 0}
          onChange={(e) => patch({ strokeWidth: +e.target.value })}
          style={{ flex: 1 }}
        />
        <input
          type="color"
          value={toHex(first.strokeColor ?? '#000000', '#000000')}
          onChange={(e) => patch({ strokeColor: e.target.value })}
          style={{ width: 40, height: 24 }}
          title="Outline-kleur"
          data-tooltip="Outline-kleur"
        />
      </Row>

      <Row label="Shadow">
        <input
          type="range"
          min={0}
          max={40}
          step={1}
          value={first.shadowBlur ?? 0}
          onChange={(e) => patch({ shadowBlur: +e.target.value })}
          style={{ flex: 1 }}
        />
        <span className="val">{first.shadowBlur ?? 0}</span>
      </Row>

      <Row label="Opacity">
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={first.opacity ?? 1}
          onChange={(e) => patch({ opacity: +e.target.value })}
          style={{ flex: 1 }}
        />
        <span className="val">{Math.round((first.opacity ?? 1) * 100)}%</span>
      </Row>

      <Row label="X">
        <input
          type="range"
          min={0}
          max={1}
          step={0.005}
          value={first.x}
          onChange={(e) => setSubtitlePosition(+e.target.value, first.y)}
          style={{ flex: 1 }}
        />
        <span className="val">{Math.round(first.x * 100)}%</span>
      </Row>

      <Row label="Y">
        <input
          type="range"
          min={0}
          max={1}
          step={0.005}
          value={first.y}
          onChange={(e) => setSubtitlePosition(first.x, +e.target.value)}
          style={{ flex: 1 }}
        />
        <span className="val">{Math.round(first.y * 100)}%</span>
      </Row>

      {isKaraoke && (
        <>
          <Row label="Kleur woord">
            <input
              type="color"
              value={toHex(first.highlightColor ?? '#ffd60a', '#ffd60a')}
              onChange={(e) => patch({ highlightColor: e.target.value })}
              style={{ flex: 1, height: 26 }}
              title="Kleur van het actieve woord (karaoke)"
              data-tooltip="Kleur actief woord"
            />
          </Row>
          <Row label="Word scale">
            <input
              type="range"
              min={1}
              max={1.6}
              step={0.02}
              value={first.wordScale ?? 1.1}
              onChange={(e) => patch({ wordScale: +e.target.value })}
              style={{ flex: 1 }}
            />
            <span className="val">{(first.wordScale ?? 1.1).toFixed(2)}</span>
          </Row>
        </>
      )}

      <div className="ai-hint">Alles hierboven geldt voor alle {subs.length} ondertitel-clips. Sleep in de preview om te positioneren.</div>

      <div className="btn-row">
        <button
          onClick={() => {
            const n = setSubtitleStyle(styleId)
            if (!n) setSubtitleProps({ ...(CAPTION_PRESETS.find((p) => p.id === styleId)?.fx ?? {}) })
          }}
          title="Herhaal de gekozen preset over alle ondertitels"
          data-tooltip="Stijl opnieuw toepassen"
        >
          ↻ Stijl herhalen
        </button>
        <button
          className="danger-ghost"
          onClick={() => clearSubtitles()}
          title="Verwijder alle ondertitel-clips van de timeline"
          data-tooltip="Alle ondertitels verwijderen"
        >
          🗑 Remove all
        </button>
      </div>
    </div>
  )
}
