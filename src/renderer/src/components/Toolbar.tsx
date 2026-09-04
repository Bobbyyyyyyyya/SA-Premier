import { useEditorStore } from '../store'
import { importFiles } from '../lib/inspect'

const RESOLUTIONS = [
  { label: '1080p (1920x1080)', w: 1920, h: 1080 },
  { label: '720p (1280x720)', w: 1280, h: 720 },
  { label: '4K (3840x2160)', w: 3840, h: 2160 }
]

export default function Toolbar({ onExport, onHome }: { onExport: () => void; onHome: () => void }): JSX.Element {
  const project = useEditorStore((s) => s.project)
  const zoom = useEditorStore((s) => s.zoom)
  const setZoom = useEditorStore((s) => s.setZoom)
  const setProjectResolution = useEditorStore((s) => s.setProjectResolution)

  return (
    <header className="toolbar">
      <button className="ghost home-btn" onClick={onHome} title="Home">⌂</button>
      <div className="brand">
        SA<span>Premier</span>
      </div>
      <button onClick={() => importFiles()}>Import</button>
      <div className="zoom">
        <span>Zoom</span>
        <input
          type="range"
          min={0.25}
          max={3}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(+e.target.value)}
        />
        <span>{Math.round(zoom * 100)}%</span>
      </div>
      <div className="spacer" />
      <select
        className="proj-info"
        value={`${project.width}x${project.height}`}
        onChange={(e) => {
          const r = RESOLUTIONS.find((x) => `${x.w}x${x.h}` === e.target.value)
          if (r) setProjectResolution(r.w, r.h)
        }}
      >
        {RESOLUTIONS.map((r) => (
          <option key={r.label} value={`${r.w}x${r.h}`}>
            {r.label}
          </option>
        ))}
      </select>
      <span className="proj-info">{project.fps} fps</span>
      <button className="primary" onClick={onExport}>
        Export
      </button>
    </header>
  )
}
