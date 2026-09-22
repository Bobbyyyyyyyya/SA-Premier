import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore, selectTotal } from '../store'
import { clamp, formatTime } from '../lib/format'
import { importPaths } from '../lib/inspect'
import { mediaUrl } from '../lib/mediaUrl'
import type { Asset, Clip, Track } from '../../../shared/types'
import { IconEye, IconEyeOff, IconLock, IconUnlock, IconVolume, IconMute, IconSnap, IconFollow, IconStart, IconEnd, IconCut, IconCopy, IconTrash, IconPalette, IconMusic, IconBox } from './icons'

const ROW_H = 60
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
  check(0)
  // geen 1s-snap meer tijdens slepen — veroorzaakte 1s sprongen bij grote tracks
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

function Waveform({ assetPath, seed, duration, sourceStart, pps, muted }: { assetPath?: string; seed: string; duration: number; sourceStart: number; pps: number; muted?: boolean }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const peaksRef = useRef<number[] | null>(null)
  const drawRef = useRef<() => void>(() => undefined)

  // teken op de WERKELIJKE clip-maat — canvas vult de hele clip, gevulde spiegel-golf (geen dunne lijn)
  const drawBars = (peaks: number[]): void => {
    const el = canvasRef.current
    if (!el) return
    // clientWidth/Height = CSS-layoutmaat; fallback op parent zodat 0-rect nooit dun tekent
    let W = el.clientWidth
    let H = el.clientHeight
    if (W < 20 || H < 12) {
      const p = el.parentElement
      W = Math.max(60, (p?.clientWidth ?? 200) - 8)
      H = Math.max(36, (p?.clientHeight ?? 54) - 6)
    }
    W = Math.round(W)
    H = Math.round(H)
    const dpr = window.devicePixelRatio || 1
    if (el.width !== Math.round(W * dpr) || el.height !== Math.round(H * dpr)) {
      el.width = Math.round(W * dpr)
      el.height = Math.round(H * dpr)
    }
    const c = el.getContext('2d')
    if (!c) return
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.clearRect(0, 0, W, H)

    const n = Math.max(24, Math.min(peaks.length, Math.floor(W / 2.2)))
    const step = W / n
    const bw = Math.max(2, Math.min(8, step * 0.7))
    const max = Math.max(...peaks.slice(0, n), 0.001)

    // spiegel-golf: gevulde vorm boven+onder middenlijn → leest als volle waveform, nooit "dun"
    const mid = H / 2
    const amp = H * 0.5 * 0.98
    c.beginPath()
    for (let i = 0; i < n; i++) {
      const v = Math.max(0.22, (peaks[i] ?? 0) / max) // harde vloer: zelfs stilte ≈ 22% vol
      const h = v * amp
      const x = i * step + step / 2
      if (i === 0) c.moveTo(x, mid - h)
      else c.lineTo(x, mid - h)
    }
    for (let i = n - 1; i >= 0; i--) {
      const v = Math.max(0.22, (peaks[i] ?? 0) / max)
      const h = v * amp
      const x = i * step + step / 2
      c.lineTo(x, mid + h)
    }
    c.closePath()
    c.fillStyle = 'rgba(255,255,255,0.92)'
    c.fill()
    c.strokeStyle = 'rgba(255,255,255,1)'
    c.lineWidth = 1.5
    c.lineJoin = 'round'
    c.stroke()

    // extra verticale balken in de vorm voor diepte (Premiere-achtig)
    c.fillStyle = 'rgba(255,255,255,0.55)'
    for (let i = 0; i < n; i++) {
      const v = Math.max(0.22, (peaks[i] ?? 0) / max)
      const h = v * amp
      const x = i * step + (step - bw) / 2
      c.fillRect(x, mid - h, bw, h * 2)
    }

    // middellijn
    c.strokeStyle = 'rgba(0,0,0,0.35)'
    c.lineWidth = 1
    c.beginPath()
    c.moveTo(0, mid)
    c.lineTo(W, mid)
    c.stroke()
  }

  // meteen een fallback-golf tonen zodat er nooit een lege/dunne clip is tijdens decode
  useEffect(() => {
    if (!peaksRef.current) {
      let h = hashStr(seed)
      const rnd = (): number => {
        h = Math.imul(h ^ (h >>> 15), 2246822519)
        h = Math.imul(h ^ (h >>> 13), 3266489917)
        h ^= h >>> 16
        return (h >>> 0) / 4294967295
      }
      peaksRef.current = Array.from({ length: 240 }, (_, i) => {
        const env = 0.35 + 0.65 * Math.abs(Math.sin(i / 9 + h % 10))
        return 0.12 + rnd() * 0.88 * env
      })
    }
    drawRef.current = (): void => {
      const p = peaksRef.current
      if (p) drawBars(p)
    }
    drawRef.current()
    const el = canvasRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => drawRef.current())
    ro.observe(el)
    return () => ro.disconnect()
  }, [pps, duration, seed])

  useEffect(() => {
    if (!assetPath) return
    let cancelled = false

    const fallbackPeaks = (): number[] => {
      let h = hashStr(seed)
      const rnd = (): number => {
        h = Math.imul(h ^ (h >>> 15), 2246822519)
        h = Math.imul(h ^ (h >>> 13), 3266489917)
        h ^= h >>> 16
        return (h >>> 0) / 4294967295
      }
      return Array.from({ length: 240 }, (_, i) => {
        const env = 0.35 + 0.65 * Math.abs(Math.sin(i / 9 + h % 10))
        return 0.12 + rnd() * 0.88 * env
      })
    }

    const finish = (peaks: number[]): void => {
      if (cancelled) return
      peaksRef.current = peaks
      drawRef.current()
    }

    const url = mediaUrl(assetPath)
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const ACtx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
        const ctx2 = new ACtx()
        return ctx2.decodeAudioData(buf.slice(0)).then((decoded) => {
          ctx2.close().catch(() => null)
          if (cancelled) return
          const sr = decoded.sampleRate
          const full = decoded.getChannelData(0)
          const s0 = Math.max(0, Math.floor(sourceStart * sr))
          const s1 = Math.min(full.length, Math.floor((sourceStart + duration) * sr))
          const data = s0 < s1 ? full.subarray(s0, s1) : full
          if (!data.length) { finish(fallbackPeaks()); return }
          const bars = Math.max(120, Math.min(720, Math.round(duration * 24)))
          const step = Math.max(1, Math.floor(data.length / bars))
          const out: number[] = []
          for (let i = 0; i < bars; i++) {
            const center = Math.floor((i + 0.5) * data.length / bars)
            const win = Math.max(1, Math.floor(step * 0.4))
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
            out.push(Math.pow(0.55 * peak + 0.45 * rms, 0.42))
          }
          const max = Math.max(...out, 0.001)
          const min = Math.min(...out)
          const range = Math.max(0.02, max - min)
          finish(out.map((v) => 0.25 + ((v - min) / range) * 0.75))
        })
      })
      .catch(() => finish(fallbackPeaks()))

    return () => { cancelled = true }
  }, [assetPath, seed, duration, sourceStart])

  return <canvas ref={canvasRef} className="clip-wave-canvas" style={{ opacity: muted ? 0.25 : 1 }} />
}

function Filmstrip({ assetPath, thumbnail, isImage }: { assetPath?: string; thumbnail?: string; isImage?: boolean }): JSX.Element {
  const [genThumb, setGenThumb] = useState<string | null>(null)
  useEffect(() => {
    if (isImage || thumbnail || !assetPath) return
    let cancelled = false
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.crossOrigin = 'anonymous'
    const onMeta = (): void => {
      try { v.currentTime = Math.min(0.6, v.duration * 0.15 || 0.6) } catch { /* noop */ }
    }
    const onSeek = (): void => {
      try {
        const c = document.createElement('canvas')
        c.width = 320
        c.height = Math.max(90, Math.round(320 * (v.videoHeight / Math.max(1, v.videoWidth))) || 180)
        const ctx = c.getContext('2d')
        if (ctx) {
          ctx.drawImage(v, 0, 0, c.width, c.height)
          if (!cancelled) setGenThumb(c.toDataURL('image/jpeg', 0.75))
        }
      } catch { /* ignore */ }
    }
    v.addEventListener('loadedmetadata', onMeta, { once: true })
    v.addEventListener('seeked', onSeek, { once: true })
    v.addEventListener('error', () => { if (!cancelled) setGenThumb(null) }, { once: true })
    v.src = mediaUrl(assetPath)
    return () => { cancelled = true; try { v.pause(); v.removeAttribute('src'); v.load() } catch { /* noop */ } }
  }, [assetPath, thumbnail, isImage])

  if (isImage && assetPath) {
    return <div className="clip-film single"><span style={{ backgroundImage: `url(${mediaUrl(assetPath)})` }} /></div>
  }
  const src = thumbnail ?? genThumb
  if (src) {
    // frame herhalen over hele breedte → echte filmstrip, niet één dun plaatje
    return <div className="clip-film strip"><span style={{ backgroundImage: `url(${src})` }} /></div>
  }
  return <div className="clip-film placeholder"><span /></div>
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
      style={{ left, width, top: 3, height: ROW_H - 6, minHeight: ROW_H - 6, contain: 'layout paint' } as React.CSSProperties}
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
          : <Filmstrip assetPath={asset?.path} thumbnail={asset?.thumbnail} isImage={false} />
      )}
      {clip.kind === 'audio' && <Waveform assetPath={asset?.path} seed={clip.id + (asset?.id ?? '')} duration={clip.duration} sourceStart={clip.sourceStart} pps={pps} muted={dimmed} />}
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
          {track.kind === 'video' ? <IconBox size={10} /> : <IconMusic size={10} />}
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
        <button className={track.hidden ? 'active' : ''} title={track.hidden ? 'Toon' : 'Verbergen'} onClick={() => setTrackHidden(track.id, !track.hidden)} data-tooltip="Toon / Verbergen">
          {track.hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}
        </button>
        <button className={locked ? 'active warn' : ''} title={locked ? 'Unlock' : 'Lock track'} onClick={() => setTrackLocked(track.id, !locked)} data-tooltip="Lock / Unlock">
          {locked ? <IconLock size={13} /> : <IconUnlock size={13} />}
        </button>
        <button className={track.muted ? 'active warn' : ''} title={track.muted ? 'Unmute' : 'Mute'} onClick={() => setTrackMuted(track.id, !track.muted)} data-tooltip="Mute / Unmute">
          {track.muted ? <IconMute size={13} /> : <IconVolume size={13} />}
        </button>
        <button className={solo ? 'active' : ''} title={solo ? 'Solo uit' : 'Solo'} onClick={() => setTrackSolo(track.id, !solo)} data-tooltip="Solo">
          S
        </button>
        <button className="ghost danger" title="Verwijder track" onClick={() => {
          if (clipCount > 0 && !window.confirm(`Track "${track.name}" met ${clipCount} clip(s) verwijderen?`)) return
          removeTrack(track.id)
        }} data-tooltip="Verwijder track">
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

  // Fix: clips met ongeldige trackId (na reset) meteen herstellen zodat ze wel getoond worden
  useEffect(() => {
    const s = useEditorStore.getState()
    let changed = false
    const fixed = s.clips.map((c) => {
      if (s.tracks.some((t) => t.id === c.trackId)) return c
      const fallback = s.tracks.find((t) => t.kind === (c.kind === 'audio' ? 'audio' : 'video')) ?? s.tracks[0]
      if (!fallback) return c
      changed = true
      return { ...c, trackId: fallback.id }
    })
    if (changed) useEditorStore.setState({ clips: fixed })
  }, [clips, tracks])

  // Auto-fit bij grote projecten zodat je niet naar leeg 00:00 kijkt terwijl clip op 06:00 staat
  useEffect(() => {
    if (!bodyRef.current || total < 30) return
    const w = bodyRef.current.clientWidth
    if ((total + 30) * pps > w * 1.15) {
      // alleen 1x auto-fitten bij eerste grote load
      const key = 'sa-autofit-done-' + Math.round(total)
      try {
        if (sessionStorage.getItem(key)) return
        sessionStorage.setItem(key, '1')
      } catch { /* noop */ }
      const target = total + 4
      const next = Math.max(0.25, Math.min(4, w / target / 60))
      useEditorStore.getState().setZoom(next)
      requestAnimationFrame(() => {
        if (bodyRef.current) bodyRef.current.scrollLeft = 0
      })
    }
  }, [total, pps])

  // Zorg dat clips altijd in beeld komen (fix: bij 06:04 totaal stond alles buiten viewport)
  useEffect(() => {
    if (!bodyRef.current || !clips.length) return
    const first = Math.min(...clips.map((c) => c.start))
    // alleen auto-scrollen als playhead nog op 0 staat en er is nog niet gescrolled
    if (useEditorStore.getState().playhead === 0 && bodyRef.current.scrollLeft === 0) {
      bodyRef.current.scrollLeft = Math.max(0, first * pps - 40)
    }
  }, [clips, pps])

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
          <button className="tl-btn" title="Uitzoomen" onClick={() => setZoom(zoom / 1.25)} data-tooltip="Uitzoomen">−</button>
          <button className="tl-btn pct" title="Zoom: klik om te fitten" onClick={zoomToFit} data-tooltip="Zoom: klik om te fitten">{Math.round(zoom * 100)}%</button>
          <button className="tl-btn" title="Inzoomen" onClick={() => setZoom(zoom * 1.25)} data-tooltip="Inzoomen">+</button>
          <button className="tl-btn" title="Fit alles in beeld" onClick={zoomToFit} data-tooltip="Fit alles in beeld">⤢</button>
        </div>
        <div className="tl-sep" />
        <div className="tl-group">
          <button
            className={`tl-btn toggle ${snapEnabled ? 'active' : ''}`}
            title={snapEnabled ? 'Snappen aan (klik om uit te zetten)' : 'Snappen uit (klik om aan te zetten)'}
            onClick={() => setSnapEnabled(!snapEnabled)}
            data-tooltip="Snappen aan/uit"
          >
            <IconSnap size={13} />
          </button>
          <button
            className={`tl-btn toggle ${follow ? 'active' : ''}`}
            title={follow ? 'Playhead volgen aan' : 'Playhead volgen uit'}
            onClick={() => setFollow(!follow)}
            data-tooltip="Playhead volgen"
          >
            <IconFollow size={13} />
          </button>
          <button className="tl-btn" title="Naar begin (Home)" onClick={seekStart} data-tooltip="Naar begin (Home)"><IconStart size={13} /></button>
          <button className="tl-btn" title="Naar einde (End)" onClick={seekEnd} data-tooltip="Naar einde (End)"><IconEnd size={13} /></button>
        </div>
        <div className="tl-sep" />
        <div className="tl-group">
          <button className="tl-btn primary" title="Tekstclip op playhead" onClick={() => {
            pausePlayback()
            addTextClip('', useEditorStore.getState().playhead, {})
          }} data-tooltip="Tekstclip op playhead">
            + Tekst
          </button>
          <button className="tl-btn" title="Splits geselecteerde clip op playhead (S)" disabled={!selectedClip} onClick={splitSelected} data-tooltip="Splits geselecteerde clip op playhead (S)">
            <IconCut size={13} />
          </button>
          <button className="tl-btn" title="Dupliceer clip (Ctrl+D)" disabled={!selectedClip} onClick={duplicateSelected} data-tooltip="Dupliceer clip (Ctrl+D)">
            <IconCopy size={13} />
          </button>
          <button className="tl-btn danger" title="Verwijder clip (Del)" disabled={!selectedClip} onClick={deleteSelected} data-tooltip="Verwijder clip (Del)">
            <IconTrash size={13} />
          </button>
        </div>
        <div className="tl-sep" />
        <div className="tl-group">
          <button className="tl-btn" title="Video track toevoegen" onClick={() => addTrack('video')} data-tooltip="Video track toevoegen">+V</button>
          <button className="tl-btn" title="Audio track toevoegen" onClick={() => addTrack('audio')} data-tooltip="Audio track toevoegen">+A</button>
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
                <div className="tl-empty-icon"><span style={{ display: 'inline-flex' }}><IconBox size={28} /></span></div>
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
