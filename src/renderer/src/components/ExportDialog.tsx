import { useEffect, useState } from 'react'
import { useEditorStore, selectTotal } from '../store'
import type { ExportProgress, ExportRequest } from '../../../shared/types'

const FORMATS = [
  { label: '4K · 3840x2160', w: 3840, h: 2160 },
  { label: '1080p · 1920x1080', w: 1920, h: 1080 },
  { label: '720p · 1280x720', w: 1280, h: 720 },
  { label: '360p · 640x360', w: 640, h: 360 }
]

export default function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const project = useEditorStore((s) => s.project)
  const assets = useEditorStore((s) => s.assets)
  const total = useEditorStore(selectTotal)
  const [fmtIdx, setFmtIdx] = useState(1)
  const [fps, setFps] = useState(30)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [outPath, setOutPath] = useState('')

  useEffect(() => {
    if (!open) return
    setProgress(null)
    setOutPath('')
    return window.api.onExportProgress((p) => {
      setProgress(p)
      if (p.outPath) setOutPath(p.outPath)
    })
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!open) return null

  const fmt = FORMATS[fmtIdx]

  const start = async (): Promise<void> => {
    const state = useEditorStore.getState()
    if (!state.clips.length) return
    const req: ExportRequest = {
      project: {
        name: state.project.name,
        width: state.project.width,
        height: state.project.height,
        fps: state.project.fps,
        tracks: state.tracks,
        clips: state.clips
      },
      assets: state.assets,
      outPath: '',
      width: fmt.w,
      height: fmt.h,
      fps
    }
    setProgress({ phase: 'progress', percent: 0 })
    const res = await window.api.exportVideo(req)
    if (res.cancelled) {
      onClose()
      return
    }
    if (res.error) {
      setProgress({ phase: 'error', percent: 0, message: res.error })
      return
    }
    setOutPath(res.outPath ?? '')
  }

  const cancel = async (): Promise<void> => {
    await window.api.cancelExport()
  }

  const done = progress?.phase === 'done'
  const error = progress?.phase === 'error'
  const running = progress?.phase === 'progress' || progress?.phase === 'log'

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>Export video</h3>

        {!done && !running && (
          <>
            <div className="field">
              <label>Resolution</label>
              <select value={fmtIdx} onChange={(e) => setFmtIdx(+e.target.value)}>
                {FORMATS.map((f, i) => (
                  <option key={f.label} value={i}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Frame rate</label>
              <select value={fps} onChange={(e) => setFps(+e.target.value)}>
                <option value={24}>24 fps</option>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </div>
            <div className="progress-note">
              Timeline length: {total.toFixed(1)}s · {assets.length} media items · {total > 0 ? 'ready to render' : 'no clips'}
            </div>
            <div className="modal-actions">
              <div className="spacer" />
              <button onClick={onClose}>Close</button>
              <button className="primary" onClick={start} disabled={!assets.length}>
                Export MP4
              </button>
            </div>
          </>
        )}

        {running && (
          <>
            <div className="progress-note">
              {progress?.phase === 'log' ? 'ffmpeg: ' : 'Rendering '}
              {progress?.message ?? `${progress?.percent ?? 0}%`}
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress?.percent ?? 0}%` }} />
            </div>
            <div className="progress-note">{progress?.percent ?? 0}%</div>
            <div className="modal-actions">
              <div className="spacer" />
              <button onClick={cancel}>Cancel</button>
            </div>
          </>
        )}

        {done && (
          <>
            <div className="progress-note">Export finished.</div>
            <div className="progress-note" style={{ wordBreak: 'break-all' }}>
              {outPath}
            </div>
            <div className="modal-actions">
              <div className="spacer" />
              <button onClick={() => window.api.showItemInFolder(outPath)}>Show in folder</button>
              <button className="primary" onClick={() => window.api.openPath(outPath)}>
                Open
              </button>
            </div>
          </>
        )}

        {error && (
          <>
            <div className="error-text">{progress?.message ?? 'Export failed.'}</div>
            <div className="modal-actions">
              <div className="spacer" />
              <button onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
