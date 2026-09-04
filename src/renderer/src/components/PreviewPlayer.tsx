import { useCallback, useEffect, useRef } from 'react'
import { useEditorStore, selectTotal } from '../store'
import { renderFrame } from '../lib/compositor'
import { PlayerManager } from '../lib/player'
import { formatTime } from '../lib/format'

export default function PreviewPlayer(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const playersRef = useRef<PlayerManager | null>(null)
  const renderTimer = useRef(0)

  const project = useEditorStore((s) => s.project)
  const playing = useEditorStore((s) => s.playing)
  const playhead = useEditorStore((s) => s.playhead)
  const total = useEditorStore(selectTotal)

  if (!playersRef.current) playersRef.current = new PlayerManager()

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
          true
        )
      }
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
      if (!changed) return
      const players = playersRef.current
      if (players) {
        for (const clip of s.clips) {
          if (clip.kind === 'text') continue
          const asset = s.assets.find((a) => a.id === clip.assetId)
          if (asset) players.element(clip.id, asset, clip.kind)
          players.seekTo(clip.id, clip.start, clip.duration, clip.sourceStart, s.playhead)
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
        const asset = s.assets.find((a) => a.id === clip.assetId)
        if (asset) players.element(clip.id, asset, clip.kind)
        players.seekTo(clip.id, clip.start, clip.duration, clip.sourceStart, nt)
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
      </div>
    </section>
  )
}
