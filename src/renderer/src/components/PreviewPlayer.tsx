import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorStore, selectTotal } from '../store'
import { renderFrame } from '../lib/compositor'
import { PlayerManager } from '../lib/player'
import { formatTime } from '../lib/format'

export default function PreviewPlayer(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const playersRef = useRef<PlayerManager | null>(null)
  const renderTimer = useRef(0)
  const [masterVol, setMasterVol] = useState(1)
  const [masterMuted, setMasterMuted] = useState(false)

  const project = useEditorStore((s) => s.project)
  const playing = useEditorStore((s) => s.playing)
  const playhead = useEditorStore((s) => s.playhead)
  const total = useEditorStore(selectTotal)

  if (!playersRef.current) playersRef.current = new PlayerManager()

  // master volume doorgeven aan alle players
  useEffect(() => {
    playersRef.current?.setMaster(masterVol, masterMuted)
  }, [masterVol, masterMuted])

  const renderFrameAt = useCallback((t: number): void => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    const players = playersRef.current
    if (!canvas || !ctx || !players) return
    const state = useEditorStore.getState()
    renderFrame(ctx, {
      width: state.project.width,
      height: state.project.height,
      time: t,
      playing: state.playing,
      state,
      players
    })
  }, [])

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = project.width
    c.height = project.height
    ctxRef.current = c.getContext('2d')
    renderFrameAt(useEditorStore.getState().playhead)
  }, [project.width, project.height, renderFrameAt])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const startPerf = performance.now()
    const t0 = useEditorStore.getState().playhead
    const players = playersRef.current!

    const tick = (): void => {
      const state = useEditorStore.getState()
      const t = t0 + (performance.now() - startPerf) / 1000
      const totalDur = selectTotal(state)
      if (t >= totalDur) {
        state.setPlaying(false)
        state.setPlayhead(totalDur)
        players.pauseAll()
        renderFrameAt(totalDur)
        return
      }
      useEditorStore.setState({ playhead: t })
      for (const clip of state.clips) {
        if (clip.kind === 'text') continue
        const track = state.tracks.find((x) => x.id === clip.trackId)
        const asset = state.assets.find((a) => a.id === clip.assetId)
        if (!asset) {
          players.removeClip(clip.id)
          continue
        }
        if (asset) players.element(clip.id, asset, clip.kind)
        // if video has separate audio clip, mute the video element to avoid double audio
        let muted = track?.muted ?? false
        if (clip.kind === 'video' && asset?.hasAudio) {
          const hasSeparateAudio = state.clips.some(
            (c) => c.kind === 'audio' && c.assetId === clip.assetId && Math.abs(c.start - clip.start) < 0.01
          )
          if (hasSeparateAudio) muted = true
        }
        players.syncPlayback(
          clip.id,
          clip.kind as 'video' | 'audio',
          clip.start,
          clip.duration,
          clip.sourceStart,
          muted,
          t,
          true,
          clip.volume
        )
      }
      // opgeruimde clips verwijderen uit players
      renderFrameAt(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      players.pauseAll()
    }
  }, [playing, renderFrameAt])

  useEffect(() => {
    return useEditorStore.subscribe((s, prev) => {
      if (s.playing) return
      const changed =
        s.playhead !== prev.playhead ||
        s.clips !== prev.clips ||
        s.assets !== prev.assets ||
        s.tracks !== prev.tracks ||
        s.project.width !== prev.project.width ||
        s.project.height !== prev.project.height
      if (!changed) {
        // alleen volume veranderd? dan toch volume pushen
        if (s.clips !== prev.clips) {
          const players = playersRef.current
          if (players) {
            for (const clip of s.clips) {
              if (clip.kind === 'text') continue
              const track = s.tracks.find((x) => x.id === clip.trackId)
              players.seekTo(clip.id, clip.start, clip.duration, clip.sourceStart, s.playhead, clip.volume, track?.muted ?? false)
            }
          }
        }
        return
      }
      const players = playersRef.current
      if (players) {
        // verwijderde clips opruimen
        const alive = new Set(s.clips.map((c) => c.id))
        for (const c of prev.clips) {
          if (!alive.has(c.id)) players.removeClip(c.id)
        }
        for (const clip of s.clips) {
          if (clip.kind === 'text') continue
          const asset = s.assets.find((a) => a.id === clip.assetId)
          const track = s.tracks.find((x) => x.id === clip.trackId)
          if (asset) players.element(clip.id, asset, clip.kind)
          players.seekTo(clip.id, clip.start, clip.duration, clip.sourceStart, s.playhead, clip.volume, track?.muted ?? false)
        }
      }
      renderFrameAt(s.playhead)
    })
  }, [renderFrameAt])

  const onSeek = (t: number): void => {
    const s = useEditorStore.getState()
    const totalDur = selectTotal(s)
    const nt = Math.max(0, Math.min(t, totalDur))
    s.seekTo(nt)
    const players = playersRef.current
    if (players) {
      for (const clip of s.clips) {
        if (clip.kind === 'text') continue
        const asset = s.assets.find((a) => a.id === clip.assetId)
        const track = s.tracks.find((x) => x.id === clip.trackId)
        if (asset) players.element(clip.id, asset, clip.kind)
        players.seekTo(clip.id, clip.start, clip.duration, clip.sourceStart, nt, clip.volume, track?.muted ?? false)
      }
    }
    renderFrameAt(nt)
    window.clearTimeout(renderTimer.current)
    renderTimer.current = window.setTimeout(() => renderFrameAt(nt), 120)
  }

  const togglePlay = (): void => {
    const s = useEditorStore.getState()
    if (s.playing) {
      s.setPlaying(false)
    } else {
      const totalDur = selectTotal(s)
      const t = s.playhead >= totalDur && totalDur > 0 ? 0 : s.playhead
      s.setPlayhead(t)
      s.setPlaying(true)
    }
  }

  return (
    <section className="preview-pane">
      <div className="preview-stage">
        <canvas
          ref={canvasRef}
          className="preview-canvas"
          style={{ aspectRatio: `${project.width}/${project.height}` }}
        />
      </div>
      <div className="transport">
        <button className="btn-play" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <rect x="5" y="4" width="5" height="16" rx="1.5" fill="currentColor" />
              <rect x="14" y="4" width="5" height="16" rx="1.5" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M7 4.5v15a1 1 0 0 0 1.52.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor" />
            </svg>
          )}
        </button>
        <div className="scrub">
          <input
            type="range"
            min={0}
            max={Math.max(total, 0.01)}
            step={0.001}
            value={Math.min(playhead, total)}
            onChange={(e) => onSeek(+e.target.value)}
          />
          <span className="time">
            {formatTime(playhead, project.fps)} <span className="total">/ {formatTime(total, project.fps)}</span>
          </span>
        </div>
        <div className="vol" title="Master volume">
          <button
            className={`vol-mute ${masterMuted || masterVol <= 0 ? 'active' : ''}`}
            onClick={() => setMasterMuted(!masterMuted)}
            title={masterMuted ? 'Unmute' : 'Mute'}
          >
            {masterMuted || masterVol <= 0 ? '🔇' : masterVol < 0.5 ? '🔈' : '🔊'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterMuted ? 0 : masterVol}
            onChange={(e) => {
              const v = +e.target.value
              setMasterVol(v)
              if (v > 0) setMasterMuted(false)
            }}
          />
          <span className="vol-pct">{Math.round((masterMuted ? 0 : masterVol) * 100)}%</span>
        </div>
      </div>
    </section>
  )
}
