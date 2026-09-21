import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore, selectTotal } from '../store'
import { clamp, formatTime } from '../lib/format'
import { importPaths } from '../lib/inspect'
import { mediaUrl } from '../lib/mediaUrl'
import type { Asset, Clip, Track } from '../../../shared/types'

const ROW_H = 54
const RULER_H = 28
const MIN_CLIP = 0.1

/* ---------------- helpers ---------------- */

function getSnapTargets(excludeId?: string): { edges: number[]; playhead: number } {
  const state = useEditorStore.getState()
  const edges: number[] = []
  for (const c of state.clips) {
    if (c.id === excludeId) continue
    edges.push(c.start, c.start + c.duration)
  }
  return { edges, playhead: state.playhead }
}

function snapTime(t: number, excludeId?: string, enabled = true): number {
  if (!enabled) return t
  const state = useEditorStore.getState()
  const pps = 60 * state.zoom
  const threshold = 4 / pps // kleiner → precies op 1s klikken lukt ook bij grote films
  const { edges, playhead } = getSnapTargets(excludeId)
  let best = t
  let bestD = threshold
  const check = (v: number): void => {
    const d = Math.abs(v - t)
    if (d < bestD) {
      bestD = d
      best = v
    }
  }
  for (const e of edges) check(e)
  check(playhead)
  // 1s snap alleen als je echt dicht bij hele seconde bent (niet altijd)
  if (Math.abs(t - Math.round(t)) < threshold * 0.7) check(Math.round(t))
  check(0)
  return best
}

function pausePlayback(): void {
  const s = useEditorStore.getState()
  if (s.playing) s.setPlaying(false)
}

function isCompatible(kind: Clip['kind'], trackKind: Track['kind']): boolean {
  if (kind === 'audio') return trackKind === 'audio'
  return trackKind === 'video'
}

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/* ---------------- waveform / filmstrip ---------------- */

function Waveform({ assetPath, seed, duration, pps, muted }: { assetPath?: string; seed: string; duration: number; pps: number; muted?: boolean }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!assetPath || !canvasRef.current) return
    let cancelled = false
    const canvas = canvasRef.current

    const drawBars = (peaks: number[]): void => {
      if (cancelled || !canvasRef.current) return
      const c = canvasRef.current!.getContext('2d')!
      // canvas is al op juiste W/H gezet (zie hieronder)
      const W = canvasRef.current!.width / (window.devicePixelRatio || 1)
      const H = canvasRef.current!.height / (window.devicePixelRatio || 1)
      const dpr = window.devicePixelRatio || 1
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.clearRect(0, 0, W, H)
      c.strokeStyle = 'rgba(255,255,255,0.92)'
      c.lineWidth = 1.1
      c.lineCap = 'round'
      c.lineJoin = 'round'
      c.beginPath()
      const mid = H / 2
      for (let i = 0; i < peaks.length; i++) {
        const x = (i / (peaks.length - 1)) * W
        const h = peaks[i] * (H * 0.46)
        if (i === 0) c.moveTo(x, mid - h)
        else c.lineTo(x, mid - h)
      }
      for (let i = peaks.length - 1; i >= 0; i--) {
        const x = (i / (peaks.length - 1)) * W
        const h = peaks[i] * (H * 0.46)
        c.lineTo(x, mid + h)
      }
      c.closePath()
      c.fillStyle = 'rgba(255,255,255,0.18)'
      c.fill()
      c.stroke()
      c.strokeStyle = 'rgba(255,255,255,0.2)'
      c.lineWidth = 0.6
      c.beginPath()
      c.moveTo(0, mid)
      c.lineTo(W, mid)
      c.stroke()
    }

    // W en bars schalen met clip-breedte zodat grote nummers niet 1 dikke streep worden
    const Wpx = Math.max(80, Math.round(duration * pps))
    const bars = Math.max(90, Math.min(600, Math.round((duration * 18))))
    // canvas breedte = clip-breedte in CSS pixels, maar gecapped op 1200 voor performance
    const canvasW = Math.max(120, Math.min(1200, Wpx))
    const canvasH = 32
    const dpr = window.devicePixelRatio || 1
    canvas.width = canvasW * dpr
    canvas.height = canvasH * dpr
    canvas.style.width = '100%'
    canvas.style.height = '32px'

    const drawFallback = (): void => {
      let h = hashStr(seed)
      const rnd = (): number => {
        h = Math.imul(h ^ (h >>> 15), 2246822519)
        h = Math.imul(h ^ (h >>> 13), 3266489917)
        h ^= h >>> 16
        return (h >>> 0) / 4294967295
      }
      const peaks = Array.from({ length: Math.min(bars, 200) }, (_, i) => {
        const env = 0.35 + 0.65 * Math.abs(Math.sin(i / 9 + h % 10))
        return 0.12 + rnd() * 0.88 * env
      })
      const max = Math.max(...peaks, 0.001)
      drawBars(peaks.map((v) => v / max))
    }

    const url = mediaUrl(assetPath)
    fetch(url).then((r) => r.arrayBuffer()).then((buf) => {
      const ACtx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
      const ctx2 = new ACtx()
      return ctx2.decodeAudioData(buf.slice(0)).then((decoded) => {
        if (cancelled) { ctx2.close().catch(() => null); return }
        const data = decoded.getChannelData(0)
        const step = Math.max(1, Math.floor(data.length / bars))
        const out: number[] = []
        for (let i = 0; i < bars; i++) {
          const center = Math.floor((i + 0.5) * data.length / bars)
          const win = Math.max(1, Math.floor(step * 0.35))
          const start = Math.max(0, center - win)
          const end = Math.min(data.length, center + win)
          let peak = 0
          let sum = 0
          for (let j = start; j < end; j++) {
            const v = Math.abs(data[j])
            peak = Math.max(peak, v)
            sum += v * v
          }
          const rms = Math.sqrt(sum / Math.max(1, end - start))
          // dB-achtige curve + mix: ook bij grote/luide nummers blijft variatie zichtbaar ipv dikke streep
          const shaped = Math.pow(0.55 * peak + 0.45 * rms, 0.48)
          out.push(shaped)
        }
        const max = Math.max(...out, 0.001)
        const min = Math.min(...out)
        const range = Math.max(0.02, max - min)
        // niet naar 0-1 normaliseren op basis van min-max alleen, maar met floor zodat stiltes echt dun zijn
        drawBars(out.map((v) => 0.06 + ((v - min) / range) * 0.94))
        ctx2.close().catch(() => null)
      }).catch(() => drawFallback())
    }).catch(() => drawFallback())

    return () => { cancelled = true }
  }, [assetPath, seed, duration, pps])

  return <canvas ref={canvasRef} className="clip-wave-canvas" style={{ opacity: muted ? 0.25 : 1, display: 'block', width: '100%', height: 32 }} />
}

function Filmstrip({ assetPath, thumbnail }: { assetPath?: string; thumbnail?: string }): JSX.Element {
  const src = thumbnail ?? (assetPath ? mediaUrl(assetPath) : undefined)
  if (!src) return <div className="clip-fallback">VIDEO</div>
  return <div className="clip-film single"><span style={{ backgroundImage: `url(${src})` }} /></div>
}

/* ---------------- clip ---------------- */

interface ClipBoxProps {
  clip: Clip
  asset?: Asset
  pps: number
  selected: boolean
  dimmed: boolean
  tracks: Track[]
  snapEnabled: boolean
}

function ClipBox({ clip, asset, pps, selected, dimmed, tracks, snapEnabled }: ClipBoxProps): JSX.Element {
  const selectClip = useEditorStore((s) => s.selectClip)
  const [dragging, setDragging] = useState(false)
  const [trimming, setTrimming] = useState<null | 'l' | 'r'>(null)
  const raf = useRef(0)

  const left = clip.start * pps
  const width = Math.max(14, clip.duration * pps)
  const isImage = !!asset?.isImage
  const isText = clip.kind === 'text'

  const schedule = (fn: () => void): void => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(fn)
  }

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const trackLocked = tracks.find((t) => t.id === clip.trackId)?.locked
  const onMoveDrag = (e: React.PointerEvent): void => {
    if (trackLocked) return
    if ((e.target as HTMLElement).closest('.clip-handle')) return
    e.preventDefault()
    e.stopPropagation()
    pausePlayback()
    selectClip(clip.id)
    const startX = e.clientX
    const startY = e.clientY
    const origStart = clip.start
    const origTrackIdx = tracks.findIndex((t) => t.id === clip.trackId)
    const el = e.currentTarget as HTMLElement
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    setDragging(true)

    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      schedule(() => {
        const raw = origStart + dx / pps
        const snapped = snapTime(raw, clip.id, snapEnabled)
        let nextTrackId = clip.trackId
        if (Math.abs(dy) > ROW_H * 0.4) {
          const deltaRows = Math.round(dy / ROW_H)
          const targetIdx = clamp(origTrackIdx + deltaRows, 0, tracks.length - 1)
          // zoek dichtstbijzijnde compatibele track vanaf target
          let found: string | null = null
          for (let off = 0; off < tracks.length; off++) {
            for (const idx of [targetIdx + off, targetIdx - off]) {
              if (idx < 0 || idx >= tracks.length) continue
              if (isCompatible(clip.kind, tracks[idx].kind)) {
                found = tracks[idx].id
                break
              }
            }
            if (found) break
          }
          if (found) nextTrackId = found
        }
        useEditorStore
          .getState()
          .updateClip(clip.id, { start: clamp(snapped, 0, 99999), trackId: nextTrackId })
      })
    }
    const onUp = (): void => {
      setDragging(false)
      cancelAnimationFrame(raf.current)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onTrim = (e: React.PointerEvent, side: 'l' | 'r'): void => {
    if (trackLocked) return
    e.preventDefault()
    e.stopPropagation()
    pausePlayback()
    selectClip(clip.id)
    const startX = e.clientX
    const oSource = clip.sourceStart
    const oStart = clip.start
    const oDur = clip.duration
    const assetId = clip.assetId
    setTrimming(side)
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* noop */
    }

    const onMove = (ev: PointerEvent): void => {
      const dx = (ev.clientX - startX) / pps
      schedule(() => {
        const st = useEditorStore.getState()
        const a = st.assets.find((x) => x.id === assetId)
        if (side === 'l') {
          if (isText || isImage) {
            const newDur = clamp(oDur - dx, MIN_CLIP, 600)
            const delta = oDur - newDur
            useEditorStore.getState().updateClip(clip.id, {
              start: clamp(oStart + delta, 0, 99999),
              duration: newDur
            })
            return
          }
          const assetDur = a?.duration ?? oDur + oSource
          const newSource = clamp(oSource + dx, 0, Math.max(0, assetDur - MIN_CLIP))
          const delta = newSource - oSource
          const newDur = oDur - delta
          if (newDur < MIN_CLIP) return
          useEditorStore.getState().updateClip(clip.id, {
            sourceStart: newSource,
            start: clamp(oStart + delta, 0, 99999),
            duration: newDur
          })
        } else {
          if (isText || isImage) {
            const newDur = clamp(oDur + dx, MIN_CLIP, 600)
            useEditorStore.getState().updateClip(clip.id, { duration: newDur })
            return
          }
          const assetDur = a?.duration ?? oDur + oSource
          const maxDur = Math.max(MIN_CLIP, assetDur - oSource)
          const newDur = clamp(oDur + dx, MIN_CLIP, maxDur)
          useEditorStore.getState().updateClip(clip.id, { duration: newDur })
          // playhead meenemen als we aan het einde trimmen en playhead daar staat
          const ph = useEditorStore.getState().playhead
          if (Math.abs(ph - (oStart + oDur)) < 0.08) {
            useEditorStore.getState().setPlayhead(oStart + newDur)
          }
        }
      })
    }
    const onUp = (): void => {
      setTrimming(null)
      cancelAnimationFrame(raf.current)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const label = isText ? clip.text?.text || 'Text' : asset?.name || 'Clip'

  return (
    <div
      className={`clip ${clip.kind} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''} ${trimming ? 'trimming' : ''} ${dimmed ? 'dimmed' : ''}`}
      style={{ left, width, contain: 'layout paint' } as React.CSSProperties}
      onPointerDown={onMoveDrag}
      onDoubleClick={(e) => {
        e.stopPropagation()
        useEditorStore.getState().seekTo(clip.start)
      }}
      title={`${label} · ${formatTime(clip.duration)} · dubbelklik om te zoeken`}
    >
      {clip.kind === 'video' && !isText && (
        isImage
          ? <div className="clip-thumb" style={{ backgroundImage: asset ? `url(${mediaUrl(asset.path)})` : undefined, backgroundSize: 'cover', opacity: 0.95 }} />
          : <Filmstrip assetPath={asset?.path} thumbnail={asset?.thumbnail} />
      )}
      {clip.kind === 'audio' && <Waveform assetPath={asset?.path} seed={clip.id + (asset?.id ?? '')} duration={clip.duration} pps={pps} muted={dimmed} />}
      {isText && <div className="clip-thumb text-thumb">{clip.text?.text || 'Text'}</div>}
      <div className="clip-top">
        <span className="clip-name">{label}</span>
        <span className="clip-dur">{formatTime(clip.duration)}</span>
      </div>
      {clip.transitionOut && <div className="clip-transition" title="Transition out" />}
      {clip.transitionIn && <div className="clip-transition in" title="Transition in" />}
      {!isText && <div className="clip-handle left" onPointerDown={(e) => onTrim(e, 'l')} title="Trim begin" />}
      <div className="clip-handle right" onPointerDown={(e) => onTrim(e, 'r')} title="Trim einde" />
    </div>
  )
}

/* ---------------- ruler ---------------- */

function Ruler({
  pps,
  contentW,
  total
}: {
  pps: number
  contentW: number
  total: number
}): JSX.Element {
  const [hoverT, setHoverT] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState(0)
  const scrubbing = useRef(false)

  const step = pps >= 80 ? 1 : pps >= 36 ? 2 : pps >= 16 ? 5 : 10
  const minorStep = step >= 5 ? 1 : step / 5
  const majors: number[] = []
  for (let t = 0; t <= total + step * 2; t += step) majors.push(Math.round(t * 100) / 100)
  const minors: number[] = []
  if (pps > 14) {
    for (let t = 0; t <= total + step * 2; t += minorStep) {
      const r = Math.round(t * 100) / 100
      if (majors.some((m) => Math.abs(m - r) < 1e-6)) continue
      minors.push(r)
    }
  }

  const seekToClientX = (el: HTMLElement, clientX: number): void => {
    const rect = el.getBoundingClientRect()
    const t = clamp((clientX - rect.left) / pps, 0, Math.max(total, 0.01))
    useEditorStore.getState().seekTo(t)
  }

  return (
    <div
      className="tl-ruler"
      style={{ width: contentW, height: RULER_H }}
      onPointerDown={(e) => {
        pausePlayback()
        scrubbing.current = true
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        seekToClientX(e.currentTarget as HTMLElement, e.clientX)
      }}
      onPointerMove={(e) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const x = e.clientX - rect.left
        setHoverX(x)
        setHoverT(clamp(x / pps, 0, Math.max(total, 0)))
        if (scrubbing.current) seekToClientX(e.currentTarget as HTMLElement, e.clientX)
      }}
      onPointerUp={() => {
        scrubbing.current = false
      }}
      onPointerLeave={() => {
        if (!scrubbing.current) setHoverT(null)
      }}
    >
      {minors.map((t) => (
        <div key={`m${t}`} className="tick minor" style={{ left: t * pps }} />
      ))}
      {majors.map((t) => (
        <div key={`M${t}`} className="tick major" style={{ left: t * pps }}>
          <span>{formatTime(t)}</span>
        </div>
      ))}
      {hoverT !== null && (
        <div className="ruler-hover" style={{ left: hoverX }}>
          <span>{formatTime(hoverT)}</span>
        </div>
      )}
    </div>
  )
}

/* ---------------- track header ---------------- */

function TrackHeader({ track, clipCount }: { track: Track; clipCount: number }): JSX.Element {
  const setTrackMuted = useEditorStore((s) => s.setTrackMuted)
  const setTrackHidden = useEditorStore((s) => s.setTrackHidden)
  const setTrackLocked = useEditorStore((s) => (s as unknown as { setTrackLocked: (id: string, v: boolean) => void }).setTrackLocked ?? (() => null)) as (id: string, v: boolean) => void
  const setTrackSolo = useEditorStore((s) => (s as unknown as { setTrackSolo: (id: string, v: boolean) => void }).setTrackSolo ?? (() => null)) as (id: string, v: boolean) => void
  const removeTrack = useEditorStore((s) => s.removeTrack)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(track.name)

  const commit = (): void => {
    setEditing(false)
    const v = name.trim() || track.name
    useEditorStore.setState((s) => ({
      tracks: s.tracks.map((t) => (t.id === track.id ? { ...t, name: v } : t))
    }))
  }

  const locked = !!track.locked
  const solo = !!track.solo

  return (
    <div className={`tl-track-header ${track.muted ? 'muted' : ''} ${locked ? 'locked' : ''}`} style={{ height: ROW_H }} title={`${track.name} · ${clipCount} clip(s) — dubbelklik naam om te hernoemen`}>
      <div className="th-left">
        <span className={`th-kind ${track.kind}`} title={track.kind === 'video' ? 'Video track' : 'Audio track'}>
          {track.kind === 'video' ? '▣' : '♪'}
        </span>
        <div className="th-main">
          {editing ? (
            <input
              className="th-edit"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
          ) : (
            <span className="th-name" onDoubleClick={() => { setName(track.name); setEditing(true) }}>
              {track.name}
            </span>
          )}
          <span className="th-sub">{clipCount} {clipCount === 1 ? 'clip' : 'clips'}</span>
        </div>
      </div>
      <div className="th-controls">
        <button className={track.hidden ? 'active' : ''} title={track.hidden ? 'Toon (eye)' : 'Verbergen'} onClick={() => setTrackHidden(track.id, !track.hidden)}>
          {track.hidden ? '◌' : '👁'}
        </button>
        <button className={locked ? 'active warn' : ''} title={locked ? 'Unlock' : 'Lock track'} onClick={() => setTrackLocked(track.id, !locked)}>
          {locked ? '🔒' : '🔓'}
        </button>
        <button className={track.muted ? 'active warn' : ''} title={track.muted ? 'Unmute' : 'Mute'} onClick={() => setTrackMuted(track.id, !track.muted)}>
          {track.muted ? '🔇' : '🔊'}
        </button>
        <button className={solo ? 'active' : ''} title={solo ? 'Solo uit' : 'Solo'} onClick={() => setTrackSolo(track.id, !solo)}>
          S
        </button>
        <button className="ghost danger" title="Verwijder track" onClick={() => {
          if (clipCount > 0 && !window.confirm(`Track "${track.name}" met ${clipCount} clip(s) verwijderen?`)) return
          removeTrack(track.id)
        }}>
          ×
        </button>
      </div>
    </div>
  )
}

/* ---------------- track row ---------------- */

function TrackRow({
  track,
  pps,
  contentW,
  clips,
  assets,
  selectedClipId,
  tracks,
  snapEnabled,
  total
}: {
  track: Track
  pps: number
  contentW: number
  clips: Clip[]
  assets: Asset[]
  selectedClipId: string | null
  tracks: Track[]
  snapEnabled: boolean
  total: number
}): JSX.Element {
  const addClip = useEditorStore((s) => s.addClip)
  const selectClip = useEditorStore((s) => s.selectClip)
  const [isOver, setIsOver] = useState(false)

  const rowClips = useMemo(() => clips.filter((c) => c.trackId === track.id), [clips, track.id])

  const placeAt = useCallback((clientX: number, currentTarget: HTMLElement, assetId: string): void => {
    const rect = currentTarget.getBoundingClientRect()
    // rect is al gecorrigeerd voor scroll — géén scrollLeft optellen (bugfix)
    const t = clamp((clientX - rect.left) / pps, 0, 99999)
    pausePlayback()
    addClip(assetId, track.id, snapTime(t, undefined, snapEnabled))
  }, [addClip, pps, snapEnabled, track.id])

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setIsOver(false)
    const assetId = e.dataTransfer.getData('application/x-asset') || e.dataTransfer.getData('text/plain')
    if (assetId) {
      placeAt(e.clientX, e.currentTarget as HTMLElement, assetId.trim())
      return
    }
    const files = Array.from(e.dataTransfer.files ?? [])
    if (!files.length) return
    const paths = files.map((f) => window.api.getPathForFile(f)).filter(Boolean)
    if (!paths.length) return
    pausePlayback()
    const dropT = clamp((e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left) / pps, 0, 99999)
    void importPaths(paths, { place: false }).then(() => {
      const s = useEditorStore.getState()
      paths.forEach((p, i) => {
        const asset = s.assets.find((a) => a.path === p)
        if (!asset) return
        const target =
          asset.type === 'audio'
            ? track.kind === 'audio' ? track.id : s.tracks.find((x) => x.kind === 'audio')?.id
            : track.kind === 'video' ? track.id : s.tracks.find((x) => x.kind === 'video')?.id
        if (target) s.addClip(asset.id, target, dropT + i * 0.1)
      })
    })
  }

  // seconde-grid als achtergrond
  const gridLines = useMemo(() => {
    const step = pps >= 80 ? 1 : pps >= 36 ? 2 : pps >= 16 ? 5 : 10
    const arr: number[] = []
    for (let t = 0; t <= total + step * 2; t += step) arr.push(t)
    return arr
  }, [pps, total])

  return (
    <div
      className={`tl-row ${track.muted ? 'muted' : ''} ${isOver ? 'dragover' : ''}`}
      style={{ width: contentW, height: ROW_H }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsOver(true) }}
      onDragLeave={() => setIsOver(false)}
      onDrop={onDrop}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('tl-grid-line')) {
          selectClip(null)
        }
      }}
    >
      <div className="tl-grid">
        {gridLines.map((t) => (
          <div key={t} className="tl-grid-line" style={{ left: t * pps }} />
        ))}
      </div>
      {rowClips.map((c) => {
        const asset = assets.find((a) => a.id === c.assetId)
        return (
          <ClipBox
            key={c.id}
            clip={c}
            asset={asset}
            pps={pps}
            selected={c.id === selectedClipId}
            dimmed={track.muted || track.hidden}
            tracks={tracks}
            snapEnabled={snapEnabled}
          />
        )
      })}
      {isOver && <div className="tl-drop-hint">Loslaten om te plaatsen · {formatTime(clamp(0, 0, 0))}</div>}
    </div>
  )
}

/* ---------------- main timeline ---------------- */

export default function Timeline(): JSX.Element {
  const tracks = useEditorStore((s) => s.tracks)
  const clips = useEditorStore((s) => s.clips)
  const assets = useEditorStore((s) => s.assets)
  const zoom = useEditorStore((s) => s.zoom)
  const setZoom = useEditorStore((s) => s.setZoom)
  const playhead = useEditorStore((s) => s.playhead)
  const playing = useEditorStore((s) => s.playing)
  const selectedClipId = useEditorStore((s) => s.selectedClipId)
  const addTrack = useEditorStore((s) => s.addTrack)
  const addTextClip = useEditorStore((s) => s.addTextClip)

  const bodyRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const playheadRef = useRef<HTMLDivElement | null>(null)

  const [snapEnabled, setSnapEnabled] = useState(() => {
    try { return localStorage.getItem('sa-snap') !== 'off' } catch { return true }
  })
  const [follow, setFollow] = useState(() => {
    try { return localStorage.getItem('sa-follow') !== 'off' } catch { return true }
  })

  useEffect(() => {
    try { localStorage.setItem('sa-snap', snapEnabled ? 'on' : 'off') } catch { /* noop */ }
  }, [snapEnabled])
  useEffect(() => {
    try { localStorage.setItem('sa-follow', follow ? 'on' : 'off') } catch { /* noop */ }
  }, [follow])

  const pps = 60 * zoom
  const total = useEditorStore(selectTotal)
  const contentW = Math.max((total + 30) * pps, 900)

  const selectedClip = useMemo(() => clips.find((c) => c.id === selectedClipId) ?? null, [clips, selectedClipId])

  /* header/body scroll sync */
  useEffect(() => {
    const body = bodyRef.current
    const header = headerRef.current
    if (!body || !header) return
    let ticking = false
    const onBodyScroll = (): void => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        header.scrollTop = body.scrollTop
        ticking = false
      })
    }
    body.addEventListener('scroll', onBodyScroll, { passive: true })
    return () => body.removeEventListener('scroll', onBodyScroll)
  }, [])

  /* playhead positie + volgen */
  useEffect(() => {
    const el = playheadRef.current
    if (el) el.style.left = `${playhead * pps}px`
    if (follow && playing && bodyRef.current) {
      const body = bodyRef.current
      const x = playhead * pps
      if (x < body.scrollLeft + 40 || x > body.scrollLeft + body.clientWidth - 80) {
        body.scrollLeft = Math.max(0, x - body.clientWidth * 0.35)
      }
    }
  }, [playhead, pps, follow, playing])

  /* ctrl/cmd + wheel = zoom (non-passive zodat preventDefault werkt) */
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const s = useEditorStore.getState()
        const next = clamp(s.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.25, 4)
        // zoom rond muispositie houden
        const rect = body.getBoundingClientRect()
        const mouseT = (e.clientX - rect.left + body.scrollLeft) / (60 * s.zoom)
        s.setZoom(next)
        requestAnimationFrame(() => {
          body.scrollLeft = mouseT * 60 * next - (e.clientX - rect.left)
        })
      }
    }
    body.addEventListener('wheel', onWheel, { passive: false })
    return () => body.removeEventListener('wheel', onWheel)
  }, [])

  const zoomToFit = (): void => {
    const body = bodyRef.current
    const w = body?.clientWidth ?? 900
    const target = total > 1 ? total + 4 : 20
    setZoom(clamp(w / target / 60, 0.25, 4))
    if (body) body.scrollLeft = 0
  }

  const splitSelected = (): void => {
    if (!selectedClip) return
    pausePlayback()
    useEditorStore.getState().splitClip(selectedClip.id)
  }

  const duplicateSelected = (): void => {
    if (!selectedClip) return
    useEditorStore.getState().duplicateClip(selectedClip.id)
  }

  const deleteSelected = (): void => {
    if (!selectedClip) return
    useEditorStore.getState().removeClip(selectedClip.id)
  }

  const seekStart = (): void => useEditorStore.getState().seekTo(0)
  const seekEnd = (): void => useEditorStore.getState().seekTo(total)

  return (
    <section className="timeline">
      <div className="tl-toolbar">
        <span className="tt-title">Timeline</span>
        <span className="tl-time" title="Playhead / totaal">
          {formatTime(playhead)} <i>/</i> {formatTime(total)}
        </span>
        <div className="tl-sep" />
        <div className="tl-group">
          <button className="tl-btn" title="Uitzoomen" onClick={() => setZoom(zoom / 1.25)}>−</button>
          <button className="tl-btn pct" title="Zoom: klik om te fitten" onClick={zoomToFit}>{Math.round(zoom * 100)}%</button>
          <button className="tl-btn" title="Inzoomen" onClick={() => setZoom(zoom * 1.25)}>+</button>
          <button className="tl-btn" title="Fit alles in beeld" onClick={zoomToFit}>⤢</button>
        </div>
        <div className="tl-sep" />
        <div className="tl-group">
          <button
            className={`tl-btn toggle ${snapEnabled ? 'active' : ''}`}
            title={snapEnabled ? 'Snappen aan (klik om uit te zetten)' : 'Snappen uit (klik om aan te zetten)'}
            onClick={() => setSnapEnabled(!snapEnabled)}
          >
            🧲
          </button>
          <button
            className={`tl-btn toggle ${follow ? 'active' : ''}`}
            title={follow ? 'Playhead volgen aan' : 'Playhead volgen uit'}
            onClick={() => setFollow(!follow)}
          >
            ◎
          </button>
          <button className="tl-btn" title="Naar begin (Home)" onClick={seekStart}>⏮</button>
          <button className="tl-btn" title="Naar einde (End)" onClick={seekEnd}>⏭</button>
        </div>
        <div className="tl-sep" />
        <div className="tl-group">
          <button className="tl-btn primary" title="Tekstclip op playhead" onClick={() => {
            pausePlayback()
            addTextClip('', useEditorStore.getState().playhead, {})
          }}>
            + Tekst
          </button>
          <button className="tl-btn" title="Splits geselecteerde clip op playhead (S)" disabled={!selectedClip} onClick={splitSelected}>
            ✂
          </button>
          <button className="tl-btn" title="Dupliceer clip (Ctrl+D)" disabled={!selectedClip} onClick={duplicateSelected}>
            ⧉
          </button>
          <button className="tl-btn danger" title="Verwijder clip (Del)" disabled={!selectedClip} onClick={deleteSelected}>
            🗑
          </button>
        </div>
        <div className="tl-sep" />
        <div className="tl-group">
          <button className="tl-btn" title="Video track toevoegen" onClick={() => addTrack('video')}>+V</button>
          <button className="tl-btn" title="Audio track toevoegen" onClick={() => addTrack('audio')}>+A</button>
        </div>
        <span className="tt-hint">Sleep om te verplaatsen · ↑↓ van track wisselen · randen om te trimmen · Ctrl+scroll = zoom · S = splits</span>
      </div>
      <div className="tl-scroll-wrap">
        <div className="tl-headers" ref={headerRef}>
          <div className="tl-corner" style={{ height: RULER_H }}>
            <span>Tracks</span>
          </div>
          {tracks.map((t) => (
            <TrackHeader key={t.id} track={t} clipCount={clips.filter((c) => c.trackId === t.id).length} />
          ))}
          {tracks.length === 0 && <div className="tl-no-tracks">Geen tracks</div>}
        </div>
        <div className="tl-body" ref={bodyRef}>
          <Ruler pps={pps} contentW={contentW} total={total} />
          {tracks.map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              pps={pps}
              contentW={contentW}
              clips={clips}
              assets={assets}
              selectedClipId={selectedClipId}
              tracks={tracks}
              snapEnabled={snapEnabled}
              total={total}
            />
          ))}
          {clips.length === 0 && (
            <div className="tl-empty" style={{ width: contentW }}>
              <div className="tl-empty-card">
                <div className="tl-empty-icon">🎬</div>
                <div className="tl-empty-title">Sleep media hierheen om te starten</div>
                <div className="tl-empty-sub">…of dubbelklik een item in de bibliotheek · + Tekst voor een titel</div>
              </div>
            </div>
          )}
          <div className="tl-playhead" ref={playheadRef}>
            <div className="tl-playhead-cap" />
          </div>
        </div>
      </div>
    </section>
  )
}
