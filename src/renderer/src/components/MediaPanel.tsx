import { useState } from 'react'
import { useEditorStore } from '../store'
import { importFiles } from '../lib/inspect'
import { formatClock } from '../lib/format'
import AiPanel from './AiPanel'
import type { ClipEffects } from '../../../shared/types'
import { DEFAULT_EFFECTS } from '../../../shared/types'

const PRESETS: Array<{ cat: string; name: string; fx: Partial<ClipEffects> }> = [
  { cat: 'Basic', name: 'Normal', fx: { ...DEFAULT_EFFECTS } },

  { cat: 'Color', name: 'Warm', fx: { brightness: 0.03, contrast: 0.02, saturation: 0.12, hue: 12 } },
  { cat: 'Color', name: 'Cool', fx: { brightness: 0.02, saturation: 0.08, hue: -14 } },
  { cat: 'Color', name: 'Vivid', fx: { contrast: 0.16, saturation: 0.35 } },
  { cat: 'Color', name: 'Cinematic', fx: { contrast: 0.2, saturation: 0.1, brightness: -0.04, vignette: 0.5 } },
  { cat: 'Color', name: 'Dreamy', fx: { brightness: 0.08, contrast: -0.1, saturation: 0.2, blur: 0.6 } },
  { cat: 'Color', name: 'Moody', fx: { brightness: -0.12, contrast: 0.25, saturation: -0.1, vignette: 0.6 } },
  { cat: 'Color', name: 'Golden', fx: { sepia: 0.25, hue: 8, saturation: 0.3, brightness: 0.05 } },
  { cat: 'Color', name: 'Summer', fx: { brightness: 0.08, saturation: 0.3, hue: -6, contrast: -0.05 } },
  { cat: 'Color', name: 'Winter', fx: { brightness: 0.05, saturation: -0.25, hue: 10, contrast: 0.05 } },
  { cat: 'Color', name: 'Neon', fx: { contrast: 0.3, saturation: 0.6, hue: 40, brightness: 0.02 } },
  { cat: 'Color', name: 'Pastel', fx: { brightness: 0.1, saturation: -0.15, contrast: -0.12, blur: 0.3 } },

  { cat: 'B&W', name: 'Mono', fx: { grayscale: 1, contrast: 0.05 } },
  { cat: 'B&W', name: 'Noir', fx: { grayscale: 1, contrast: 0.3, brightness: -0.08, vignette: 0.7 } },
  { cat: 'B&W', name: 'Harsh', fx: { grayscale: 1, contrast: 0.55, brightness: -0.05 } },
  { cat: 'B&W', name: 'Inverted', fx: { grayscale: 1, invert: 1 } },
  { cat: 'B&W', name: 'Negative', fx: { invert: 1 } },

  { cat: 'Vintage', name: 'Fade', fx: { brightness: 0.12, contrast: -0.18, saturation: -0.15, sepia: 0.18 } },
  { cat: 'Vintage', name: 'Vintage', fx: { sepia: 0.35, contrast: -0.08, brightness: 0.02, saturation: -0.1 } },
  { cat: 'Vintage', name: 'Retro', fx: { sepia: 0.4, saturation: 0.15, contrast: 0.05, vignette: 0.5, brightness: -0.02 } },
  { cat: 'Vintage', name: 'Old Film', fx: { sepia: 0.5, contrast: -0.1, brightness: 0.05, saturation: -0.3, vignette: 0.8 } },
  { cat: 'Vintage', name: 'Sepia', fx: { sepia: 0.7, saturation: -0.2, contrast: 0.05 } }
]

export default function MediaPanel(): JSX.Element {
  const [tab, setTab] = useState<'media' | 'effects' | 'ai'>('media')
  const [importing, setImporting] = useState(false)
  const assets = useEditorStore((s) => s.assets)
  const tracks = useEditorStore((s) => s.tracks)
  const playhead = useEditorStore((s) => s.playhead)
  const addClip = useEditorStore((s) => s.addClip)
  const removeAsset = useEditorStore((s) => s.removeAsset)
  const selectedClipId = useEditorStore((s) => s.selectedClipId)
  const updateClip = useEditorStore((s) => s.updateClip)

  const onImport = async (): Promise<void> => {
    setImporting(true)
    try {
      await importFiles()
    } finally {
      setImporting(false)
    }
  }

  const addAtPlayhead = (assetId: string): void => {
    const s = useEditorStore.getState()
    const asset = s.assets.find((a) => a.id === assetId)
    const track = asset
      ? asset.type === 'audio'
        ? s.tracks.find((t) => t.kind === 'audio') ?? tracks[0]
        : s.tracks.find((t) => t.kind === 'video') ?? tracks[0]
      : tracks[0]
    if (track) addClip(assetId, track.id, playhead)
  }

  const applyPreset = (fx: Partial<ClipEffects>): void => {
    if (!selectedClipId) return
    updateClip(selectedClipId, { effects: { ...DEFAULT_EFFECTS, ...fx } })
  }

  return (
    <aside className="panel">
      <div className="tabs">
        <button className={tab === 'media' ? 'active' : ''} onClick={() => setTab('media')}>
          Media
        </button>
        <button className={tab === 'effects' ? 'active' : ''} onClick={() => setTab('effects')}>
          Effects
        </button>
        <button className={`ai-tab ${tab === 'ai' ? 'active' : ''}`} onClick={() => setTab('ai')}>
          AI
        </button>
      </div>

      <div className="panel-body">
        {tab === 'media' && (
          <>
            <button className="import-btn" onClick={onImport} disabled={importing}>
              {importing ? 'Importing...' : '+ Import media'}
            </button>
            <div className="panel-section-title">Library</div>
            {assets.length === 0 && (
              <div className="empty-hint">
                Import video, audio, images or GIFs.<br />
                Double-click an item to add it to the timeline, or drag it onto a track.<br />
                You can also drag files straight from your folders into the app.
              </div>
            )}
            {assets.map((a) => (
              <div
                key={a.id}
                className="asset-item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'copy'
                  e.dataTransfer.setData('application/x-asset', a.id)
                  e.dataTransfer.setData('text/plain', a.id)
                }}
                onDoubleClick={() => addAtPlayhead(a.id)}
              >
                <div className="thumb" style={a.thumbnail ? { backgroundImage: `url(${a.thumbnail})` } : {}}>
                  {!a.thumbnail && (a.type === 'audio' ? 'AUDIO' : 'VIDEO')}
                </div>
                <div className="info">
                  <div className="name">{a.name}</div>
                  <div className="meta">
                    {a.type === 'audio'
                      ? 'Audio'
                      : a.isImage
                        ? `${a.width}x${a.height}`
                        : `${a.width}x${a.height}`}{' '}
                    · {formatClock(a.duration)}
                  </div>
                </div>
                <button className="remove" onClick={() => removeAsset(a.id)} title="Remove">
                  x
                </button>
              </div>
            ))}
          </>
        )}

        {tab === 'effects' && (
          <>
            <div className="panel-section-title">Effects</div>
            {Array.from(new Set(PRESETS.map((p) => p.cat))).map((cat) => (
              <div key={cat}>
                <div className="panel-section-title">{cat}</div>
                <div className="preset-grid">
                  {PRESETS.filter((p) => p.cat === cat).map((p) => (
                    <button key={p.name} disabled={!selectedClipId} onClick={() => applyPreset(p.fx)}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!selectedClipId && <div className="empty-hint">Select a clip in the timeline to apply effects.</div>}
          </>
        )}

        {tab === 'ai' && <AiPanel />}
      </div>
    </aside>
  )
}
