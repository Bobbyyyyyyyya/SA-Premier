import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore, selectTotal } from '../store'
import { clamp, formatTime } from '../lib/format'
import { importPaths } from '../lib/inspect'
import type { Asset, Clip, Track } from '../../../shared/types'

const ROW_H = 56
const RULER_H = 28
const MIN_CLIP = 0.1

function useDrag(onDrag: (dx: number) => void): { onPointerDown: (e: React.PointerEvent) => void } {
  const onPointerDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const move = (ev: PointerEvent): void => onDrag(ev.clientX - startX)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return { onPointerDown }
}

function snapTime(t: number): number {
  const state = useEditorStore.getState()
  const pps = 60 * state.zoom
  const threshold = 6 / pps
  let best = t
  let bestD = threshold
  const check = (v: number): void => {
    const d = Math.abs(v - t)
    if (d < bestD) {
      bestD = d
      best = v
    }
  }
  for (const c of state.clips) {
    check(c.start)
    check(c.start + c.duration)
  }
  check(state.playhead)
  const sec = Math.round(t)
  check(sec)
  return best
}

function pausePlayback(): void {
  useEditorStore.getState().setPlaying(false)
}

interface ClipBoxProps {
  clip: Clip
  asset?: Asset
  pps: number
  selected: boolean
}

function ClipBox({ clip, asset, pps, selected }: ClipBoxProps): JSX.Element {
  const updateClip = useEditorStore((s) => s.updateClip)
  const selectClip = useEditorStore((s) => s.selectClip)

  const left = clip.start * pps
  const width = Math.max(10, clip.duration * pps)
  const isImage = !!asset?.isImage

  const drag = useDrag((dx) => {
    const ns = clamp(snapTime(clip.start + dx / pps), 0, 999999)
    updateClip(clip.id, { start: ns })
  })
  const trimL = useDrag((dx) => {
    if (isImage) return
    const state = useEditorStore.getState()
    const a = state.assets.find((x) => x.id === clip.assetId)
    const assetDur = a?.duration ?? clip.duration
    const newSource = clamp(clip.sourceStart + dx / pps, 0, Math.max(0, assetDur - MIN_CLIP))
    const delta = newSource - clip.sourceStart
    const newStart = clip.start + delta
    const newDur = clip.duration - delta
    if (newDur < MIN_CLIP) return
    updateClip(clip.id, { sourceStart: newSource, start: newStart, duration: newDur })
  })
  const trimR = useDrag((dx) => {
    const state = useEditorStore.getState()
    const a = state.assets.find((x) => x.id === clip.assetId)
    const assetDur = a?.duration ?? clip.duration
    const newDur = clamp(clip.duration + dx / pps, MIN_CLIP, assetDur - clip.sourceStart)
    updateClip(clip.id, { duration: newDur })
  })

  const handlePointerDown = (e: React.PointerEvent): void => {
    pausePlayback()
    selectClip(clip.id)
    if (!(e.target as HTMLElement).closest('.clip-handle')) drag.onPointerDown(e)
  }

  return (
    <div
      className={`clip ${clip.kind} ${selected ? 'selected' : ''}`}
      style={{ left, width }}
      onPointerDown={handlePointerDown}
      title={`${clip.kind === 'text' ? (clip.text?.text ?? 'Text') : (asset?.name ?? 'Clip')} · ${formatTime(clip.duration)}`}
    >
      {clip.kind === 'video' && asset?.thumbnail && (
        <div className="clip-thumb" style={{ backgroundImage: `url(${asset.thumbnail})` }} />
      )}
      {clip.kind === 'text' && <div className="clip-thumb text-thumb">{clip.text?.text ?? 'Text'}</div>}
      <div className="clip-label">
        <span className="clip-name">{clip.kind === 'text' ? (clip.text?.text ?? 'Text') : (asset?.name ?? 'Clip')}</span>
        <span className="clip-dur">{formatTime(clip.duration)}</span>
      </div>
      {clip.transitionOut && <div className="clip-transition" />}
      {clip.transitionIn && <div className="clip-transition in" />}
      {!isImage && <div className="clip-handle left" onPointerDown={trimL.onPointerDown} />}
      <div className="clip-handle right" onPointerDown={trimR.onPointerDown} />
    </div>
  )
}

function Ruler({ pps, contentW, total }: { pps: number; contentW: number; total: number }): JSX.Element {
  const step = pps >= 40 ? 1 : pps >= 18 ? 2 : pps >= 8 ? 5 : 10
  const ticks: number[] = []
  for (let t = 0; t <= total + step; t += step) ticks.push(t)

  const down = (e: React.PointerEvent): void => {
    pausePlayback()
    const ruler = e.currentTarget as HTMLElement
    const seek = (clientX: number): void => {
      const rect = ruler.getBoundingClientRect()
      useEditorStore.getState().seekTo(clamp((clientX - rect.left) / pps, 0, total))
    }
    seek(e.clientX)
    const move = (ev: PointerEvent): void => seek(ev.clientX)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="tl-ruler" style={{ width: contentW, height: RULER_H }} onPointerDown={down}>
      {ticks.map((t) => {
        const major = t % (step * 5) === 0
        return (
          <div key={t} className={`tick ${major ? 'major' : ''}`} style={{ left: t * pps }}>
            {major && <span>{formatTime(t)}</span>}
          </div>
        )
      })}
    </div>
  )
}

function TrackHeader({ track }: { track: Track }): JSX.Element {
  const setTrackMuted = useEditorStore((s) => s.setTrackMuted)
  const removeTrack = useEditorStore((s) => s.removeTrack)
  return (
    <div className="tl-track-header" style={{ height: ROW_H }}>
      <span className={`th-kind ${track.kind}`}>{track.kind === 'video' ? 'V' : 'A'}</span>
      <span className="th-name">{track.name}</span>
      <button
        className={track.muted ? 'active' : ''}
        title={track.muted ? 'Unmute track' : 'Mute track'}
        onClick={() => setTrackMuted(track.id, !track.muted)}
      >
        M
      </button>
      <button className="ghost" title="Delete track" onClick={() => removeTrack(track.id)}>
        x
      </button>
    </div>
  )
}

function TrackRow({ track, pps, contentW }: { track: Track; pps: number; contentW: number }): JSX.Element {
  const clips = useEditorStore(useShallow((s) => s.clips.filter((c) => c.trackId === track.id)))
  const assets = useEditorStore((s) => s.assets)
  const selectedClipId = useEditorStore((s) => s.selectedClipId)
  const addClip = useEditorStore((s) => s.addClip)

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const body = e.currentTarget.closest('.tl-body') as HTMLElement
    const t = (e.clientX - rect.left + body.scrollLeft) / pps

    const assetId = e.dataTransfer.getData('application/x-asset') || e.dataTransfer.getData('text/plain')
    if (assetId) {
      pausePlayback()
      addClip(assetId, track.id, t)
      return
    }

    const files = Array.from(e.dataTransfer.files ?? [])
    if (!files.length) return
    const paths = files.map((f) => window.api.getPathForFile(f)).filter(Boolean)
    if (!paths.length) return
    pausePlayback()
    void importPaths(paths, { place: false }).then(() => {
      const s = useEditorStore.getState()
      paths.forEach((p, i) => {
        const asset = s.assets.find((a) => a.path === p)
        if (!asset) return
        const target =
          asset.type === 'audio'
            ? track.kind === 'audio'
              ? track.id
              : s.tracks.find((x) => x.kind === 'audio')?.id
            : track.kind === 'video'
              ? track.id
              : s.tracks.find((x) => x.kind === 'video')?.id
        if (target) s.addClip(asset.id, target, t + i * 0.1)
      })
    })
  }

  return (
    <div
      className="tl-row"
      style={{ width: contentW, height: ROW_H }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={onDrop}
    >
      {clips.map((c) => {
        const asset = assets.find((a) => a.id === c.assetId)
        return (
          <ClipBox key={c.id} clip={c} asset={asset} pps={pps} selected={c.id === selectedClipId} />
        )
      })}
    </div>
  )
}

export default function Timeline(): JSX.Element {
  const tracks = useEditorStore((s) => s.tracks)
  const zoom = useEditorStore((s) => s.zoom)
  const addTrack = useEditorStore((s) => s.addTrack)
  const addTextClip = useEditorStore((s) => s.addTextClip)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)

  const pps = 60 * zoom
  const total = useEditorStore(selectTotal)
  const contentW = Math.max((total + 30) * pps, 900)

  useEffect(() => {
    const body = bodyRef.current
    const header = headerRef.current
    if (!body || !header) return
    const onBodyScroll = (): void => {
      header.scrollTop = body.scrollTop
    }
    const onHeaderScroll = (): void => {
      body.scrollTop = header.scrollTop
    }
    body.addEventListener('scroll', onBodyScroll)
    header.addEventListener('scroll', onHeaderScroll)
    return () => {
      body.removeEventListener('scroll', onBodyScroll)
      header.removeEventListener('scroll', onHeaderScroll)
    }
  }, [])

  return (
    <section className="timeline">
      <div className="tl-toolbar">
        <span className="tt-title">Timeline</span>
        <button className="primary" onClick={() => addTextClip('', useEditorStore.getState().playhead, {})}>
          + Text
        </button>
        <button onClick={() => addTrack('video')}>+ Video track</button>
        <button onClick={() => addTrack('audio')}>+ Audio track</button>
        <span className="tt-hint">Drag clips to move · drag edges to trim · drop media onto a track</span>
      </div>
      <div className="tl-scroll-wrap">
        <div className="tl-headers" ref={headerRef}>
          <div style={{ height: RULER_H }} />
          {tracks.map((t) => (
            <TrackHeader key={t.id} track={t} />
          ))}
        </div>
        <div className="tl-body" ref={bodyRef}>
          <Ruler pps={pps} contentW={contentW} total={total} />
          {tracks.map((t) => (
            <TrackRow key={t.id} track={t} pps={pps} contentW={contentW} />
          ))}
          <PlayheadLine pps={pps} />
        </div>
      </div>
    </section>
  )
}

function PlayheadLine({ pps }: { pps: number }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const apply = (t: number): void => {
      if (ref.current) ref.current.style.left = `${t * pps}px`
    }
    apply(useEditorStore.getState().playhead)
    return useEditorStore.subscribe((s) => s.playhead, apply)
  }, [pps])
  return <div className="tl-playhead" ref={ref} />
}
