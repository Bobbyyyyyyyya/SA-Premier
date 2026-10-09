import { useEffect, useState } from 'react'
import { useEditorStore } from '../store'
import { importFiles } from '../lib/inspect'
import { openProjectFile, saveProjectFile } from '../lib/projectFile'
import logo from '../assets/logo.svg'
import type { AppInfo, UpdaterStatus } from '../../../shared/types'

const RESOLUTIONS = [
  { label: '1080p (1920x1080)', w: 1920, h: 1080 },
  { label: '720p (1280x720)', w: 1280, h: 720 },
  { label: '4K (3840x2160)', w: 3840, h: 2160 }
]

const FPS_PRESETS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120]

export default function Toolbar({ onExport, onHome }: { onExport: () => void; onHome: () => void }): JSX.Element {
  const project = useEditorStore((s) => s.project)
  const setZoom = useEditorStore((s) => s.setZoom)
  const setProjectResolution = useEditorStore((s) => s.setProjectResolution)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [update, setUpdate] = useState<UpdaterStatus | null>(null)

  useEffect(() => {
    void window.api.appInfo().then(setInfo).catch(() => null)
    // de banner toont 'm; hier alleen het icoontje zodat je ziet dat er iets is
    return window.api.onUpdaterStatus((p) => {
      setUpdate(p)
      setChecking(p.phase === 'checking' || p.phase === 'downloading')
    })
  }, [])

  // het echte check-werk (en de voortgangsbalk) zit in UpdateBanner.
  // `checking` komt bewust ALLEEN uit het echte 'checking'-event: anders blijft
  // de knop op "···" hangen wanneer de check niets terugstuurt (bijv. dev).
  const checkForUpdates = (): void => {
    window.dispatchEvent(new Event('check-updates'))
  }

  return (
    <header className="toolbar">
      <button className="ghost home-btn" onClick={onHome} title="Home" data-tooltip="Home">⌂</button>
      <div className="brand">
        <img className="brand-logo" src={logo} alt="" />
        <span className="brand-text">SA<span>Premier</span></span>
      </div>
      <button onClick={() => importFiles()} title="Import" data-tooltip="Import">Import</button>
      <button
        onClick={() => {
          void saveProjectFile().then((r) => {
            if (!r.ok && !r.cancelled && r.error) window.alert(`Bewaren mislukt: ${r.error}`)
          })
        }}
        title="Project bewaren (⌘S · ⇧⌘S = bewaar als)"
        data-tooltip="Project bewaren (⌘S · ⇧⌘S = bewaar als)"
      >
        Bewaar
      </button>
      <button onClick={() => void openProjectFile()} title="Project openen (⌘O)" data-tooltip="Project openen (⌘O)">
        Open…
      </button>
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
      <select
        className="proj-info"
        value={String(project.fps)}
        title="Project frame rate (ook gebruikt als export-default)"
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) {
            useEditorStore.setState((s) => ({ project: { ...s.project, fps: v } }))
          }
        }}
      >
        {FPS_PRESETS.map((f) => (
          <option key={f} value={String(f)}>
            {f} fps
          </option>
        ))}
      </select>
      <button
        className={`version-chip${update?.phase === 'available' || update?.phase === 'downloaded' ? ' has-update' : ''}`}
        onClick={checkForUpdates}
        disabled={checking}
        title={`Versie ${info?.version ?? '…'} — klik om te controleren op updates`}
        data-tooltip={`Versie ${info?.version ?? '…'} — controleer op updates`}
      >
        {checking ? '···' : `v${info?.version ?? '…'}`}
        {(update?.phase === 'available' || update?.phase === 'downloaded') && <span className="vc-dot" />}
      </button>
      <button className="primary" onClick={onExport} title="Export" data-tooltip="Export">
        Export
      </button>
    </header>
  )
}
