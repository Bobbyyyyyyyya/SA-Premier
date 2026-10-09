import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore, selectTotal } from '../store'
import { renderFrame, clipAudioGain, hitTestTextClip, textSelectionFrame, hitTestTextHandle } from '../lib/compositor'
import type { TextCorner } from '../lib/compositor'

/** Momentopname bij het vastpakken van een hoekgreep. */
interface ResizeSnap {
  /** tegenoverliggende hoek: dit punt blijft staan, in canvas-pixels */
  oppX: number
  oppY: number
  /** afstand pointer↔opp bij het vastpakken, in canvas-pixels */
  d0: number
  /** fontSize (1080-ruimte) en middelpunt (canvas-px) bij het vastpakken */
  fontSize: number
  cx: number
  cy: number
  /** projectafmetingen bij het vastpakken, voor px→fractie */
  W: number
  H: number
  /** welke hoek vastgepakt is (voor de cursor) */
  corner: TextCorner
}
import { PlayerManager } from '../lib/player'
import { formatTime } from '../lib/format'
import { hasSeparateAudioClip } from '../../../shared/types'
import { IconMute, IconVolume, IconVolumeLow } from './icons'

export default function PreviewPlayer(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const playersRef = useRef<PlayerManager | null>(null)
  const renderTimer = useRef(0)
  const [masterVol, setMasterVol] = useState(1)
  const [masterMuted, setMasterMuted] = useState(false)
  const [draggingSubs, setDraggingSubs] = useState(false)
  const [previewMsg, setPreviewMsg] = useState<string | null>(null)
  const subDragRef = useRef<{
    x: number
    y: number
    dx: number
    dy: number
    raf: number
    clipId: string | null
    /** laatste pointerpositie in canvas-pixels (voor vergroten/verkleinen) */
    lx: number
    ly: number
    rs: ResizeSnap | null
  } | null>(null)
  const hasSubtitles = useEditorStore((s) => s.clips.some((c) => c.subtitle))
  const selectedId = useEditorStore((s) => s.selectedClipId)
  const playheadNow = useEditorStore((s) => s.playhead)

  /**
   * De geselecteerde tekstclip die je kunt verslepen, of null als er niets
   * te slepen valt. Samen met `hint` onderscheidt dit "niets te doen" van
   * "knop doet niks" — een titel buiten de playhead staat nu eenmaal niet op
   * het scherm en is dus niet te pakken.
   */
  const { dragTextId, offScreenText } = useMemo(() => {
    if (!selectedId) return { dragTextId: null, offScreenText: false }
    const s = useEditorStore.getState()
    const c = s.clips.find((x) => x.id === selectedId)
    if (!c || c.kind !== 'text' || !c.text) return { dragTextId: null, offScreenText: false }
    // Ondertitels horen bij elkaar en verplaatsen zich samen; een losse titel
    // sleep je alleen. Zelfde regel als in moveTextClipPosition.
    if (c.subtitle || s.tracks.find((t) => t.id === c.trackId)?.name.startsWith('Subtitles')) {
      return { dragTextId: null, offScreenText: false }
    }
    if (s.tracks.find((t) => t.id === c.trackId)?.locked) return { dragTextId: null, offScreenText: false }
    const visible = playheadNow >= c.start && playheadNow < c.start + c.duration
    return { dragTextId: visible ? c.id : null, offScreenText: !visible }
  }, [selectedId, playheadNow])

  const dragHint = offScreenText
    ? 'Deze titel staat niet op deze tijd — scrub naar de titel om hem in beeld te slepen.'
    : dragTextId
      ? 'Sleep om te verplaatsen · trek aan een hoek om groter/kleiner te maken'
      : null

  const project = useEditorStore((s) => s.project)
  const playing = useEditorStore((s) => s.playing)
  const total = useEditorStore(selectTotal)
  const timeRef = useRef<HTMLSpanElement | null>(null)
  const scrubRef = useRef<HTMLInputElement | null>(null)
  // alleen seeken als muis bewust op de scrub-balk staat (geen toevallig overheen swipen/wielen)
  const scrubbingRef = useRef(false)

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

  /**
   * Zelfdiagnose voor de preview. Een zwarte doos zegt niets; hierbij zie je
   * wél of het beeld laadt, of dat het bestand ontbreekt/niet decodeert.
   */
  useEffect(() => {
    const t = setInterval(() => {
      const st = useEditorStore.getState()
      const vis = st.clips.find((c) => c.kind !== 'text' && st.playhead >= c.start && st.playhead < c.start + c.duration)
      if (!vis) {
        setPreviewMsg(null)
        return
      }
      const asset = st.assets.find((a) => a.id === vis.assetId)
      if (!asset) {
        setPreviewMsg('Media ontbreekt in het project')
        return
      }
      const el = playersRef.current?.element(vis.id, asset, vis.kind)
      if (!(el instanceof HTMLMediaElement)) {
        setPreviewMsg(null)
        return
      }
      if (el.error) {
        setPreviewMsg(`Kan beeld niet laden: ${el.error.message || 'decoderingsfout'}`)
      } else if (el.readyState < 2) {
        setPreviewMsg('Beeld laden…')
      } else {
        setPreviewMsg(null)
      }
    }, 600)
    return () => clearInterval(t)
  }, [])

  /**
   * Bij het openen van een opgeslagen project moeten de media-elementen meteen
   * klaarstaan, anders blijft de preview zwart totdat je speelt of scrubt: de
   * elementen werden alleen aangemaakt vanuit de state-abonneerder, en die
   * vuurt bij het laden niets af. Dus één keer prime'en.
   */
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = project.width
    c.height = project.height
    ctxRef.current = c.getContext('2d')
    const state = useEditorStore.getState()
    const players = playersRef.current
    if (players) {
      for (const clip of state.clips) {
        if (clip.kind === 'text') continue
        const asset = state.assets.find((a) => a.id === clip.assetId)
        const track = state.tracks.find((x) => x.id === clip.trackId)
        if (!asset) continue
        players.element(clip.id, asset, clip.kind)
        players.setAudioEffects(clip.id, clip.audioFx)
        players.seekTo(clip.id, clip.start, clip.duration, clip.sourceStart, state.playhead, clip.volume * clipAudioGain(clip, state.playhead), track?.muted ?? false)
      }
      // eerste frame zodra het element data heeft (seeked of al klaar)
      const vis = state.clips.find((cl) => cl.kind !== 'text' && state.playhead >= cl.start && state.playhead < cl.start + cl.duration)
      if (vis) {
        const a = state.assets.find((x) => x.id === vis.assetId)
        if (a) {
          const el = players.element(vis.id, a, vis.kind)
          if (el instanceof HTMLMediaElement && el.readyState < 2) {
            el.addEventListener('loadeddata', () => renderFrameAt(state.playhead), { once: true })
          }
        }
      }
    }
    renderFrameAt(state.playhead)
  }, [project.width, project.height, renderFrameAt])

  // playhead-tekst zonder React re-render elke 16ms (lag fix)
  useEffect(() => {
    const upd = (t: number): void => {
      if (timeRef.current) timeRef.current.textContent = `${formatTime(t, useEditorStore.getState().project.fps)}`
      if (scrubRef.current && document.activeElement !== scrubRef.current) {
        scrubRef.current.value = String(Math.min(t, selectTotal(useEditorStore.getState())))
      }
    }
    upd(useEditorStore.getState().playhead)
    return useEditorStore.subscribe((s) => s.playhead, upd)
  }, [])

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
      // alleen clips rond playhead syncen (lag fix)
      const visible = state.clips.filter((c) => c.kind !== 'text' && t >= c.start - 0.5 && t < c.start + c.duration + 0.5)
      const pausedIds = new Set(state.clips.filter((c) => c.kind !== 'text' && !visible.includes(c)).map((c) => c.id))
      for (const id of pausedIds) {
        const el = (players as unknown as { els: Map<string, unknown> }).els?.get(id) as HTMLMediaElement | undefined
        if (el && !el.paused) try { el.pause() } catch { /* noop */ }
      }
      for (const clip of visible) {
        const track = state.tracks.find((x) => x.id === clip.trackId)
        const asset = state.assets.find((a) => a.id === clip.assetId)
        if (!asset) {
          players.removeClip(clip.id)
          continue
        }
        players.element(clip.id, asset, clip.kind)
        let muted = track?.muted ?? false
        if (clip.kind === 'video' && asset?.hasAudio && hasSeparateAudioClip(clip, state.clips)) muted = true
        players.syncPlayback(
          clip.id,
          clip.kind as 'video' | 'audio',
          clip.start,
          clip.duration,
          clip.sourceStart,
          muted,
          t,
          true,
          clip.volume * clipAudioGain(clip, t)
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
        // het selectiekader staat in de texture, dus een nieuwe selectie moet
        // het beeld opnieuw tekenen — anders verscheen het pas na een zekering
        s.selectedClipId !== prev.selectedClipId ||
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
              players.seekTo(clip.id, clip.start, clip.duration, clip.sourceStart, s.playhead, clip.volume * clipAudioGain(clip, s.playhead), track?.muted ?? false)
            }
          }
        }
        return
      }
      const players = playersRef.current
      // Slepen van een tekstclip raakt alleen de clips-array aan. De media-clips zijn
      // dan object-identiek onveranderd, en die hoeven dus niet opnieuw te worden
      // geseekt — dat was een seek per media-clip per pointermove en sloopte de app.
      const mediaChanged =
        s.assets !== prev.assets ||
        s.tracks !== prev.tracks ||
        s.clips.length !== prev.clips.length ||
        s.clips.some((c, i) => c.kind !== 'text' && c !== prev.clips[i])
      if (players && mediaChanged) {
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
          // EQ/compressor/reverb volgen de clip; zonder effecten blijft het
          // native element-volume in gebruik
          players.setAudioEffects(clip.id, clip.audioFx)
          players.seekTo(clip.id, clip.start, clip.duration, clip.sourceStart, s.playhead, clip.volume * clipAudioGain(clip, s.playhead), track?.muted ?? false)
        }
        const vis = s.clips.find((c) => c.kind !== 'text' && s.playhead >= c.start && s.playhead < c.start + c.duration)
        if (vis) {
          const a = s.assets.find((x) => x.id === vis.assetId)
          if (a) {
            const el = players.element(vis.id, a, vis.kind)
            if (el instanceof HTMLMediaElement && el.seeking) {
              el.addEventListener('seeked', () => renderFrameAt(s.playhead), { once: true })
            }
          }
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
      // wacht op seeked voor zichtbare clip, dan nogmaals renderen (voorkomt zwart)
      const vis = s.clips.find((c) => c.kind !== 'text' && nt >= c.start && nt < c.start + c.duration)
      if (vis) {
        const a = s.assets.find((x) => x.id === vis.assetId)
        if (a) {
          const el = players.element(vis.id, a, vis.kind)
          if (el instanceof HTMLMediaElement && el.seeking) {
            el.addEventListener('seeked', () => renderFrameAt(nt), { once: true })
          }
        }
      }
    }
    renderFrameAt(nt)
    window.clearTimeout(renderTimer.current)
    renderTimer.current = window.setTimeout(() => renderFrameAt(nt), 180)
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
        {previewMsg && <div className="preview-msg">{previewMsg}</div>}
        {dragHint && <div className={`preview-hint${offScreenText ? ' warn' : ''}`}>{dragHint}</div>}
        <canvas
          ref={canvasRef}
          className={`preview-canvas ${dragTextId || hasSubtitles ? 'can-drag-subs' : ''} ${draggingSubs ? 'dragging-subs' : ''}`}
          style={{ aspectRatio: `${project.width}/${project.height}` }}
          title={
            dragTextId
              ? 'Sleep om de titel te verplaatsen'
              : hasSubtitles
                ? 'Sleep om alle ondertitels over het scherm te verplaatsen'
                : undefined
          }
          // Dragging the picture moves the captions — or the selected title.
          // Breaking this is the 2-month-old bug that made everyone blame
          // "macOS" instead of CSS.
          onPointerDown={(e) => {
            if (e.button !== 0) return
            // Pakken wat je ziet. De eerdere versie eiste dat de titel al
            // geselecteerd was, en dan nog dat de playhead erin stond — twee
            // voorwaarden die stilletjes vervallen en dan doet slepen niks.
            // Nu zoeken we de titel waar je daadwerkelijk drukt, en selecteren
            // die meteen, zoals bij elke tekeneditor.
            let clipId = dragTextId
            if (!clipId) {
              const canvas = canvasRef.current
              if (canvas) {
                const r = canvas.getBoundingClientRect()
                if (r.width > 1 && r.height > 1) {
                  const st = useEditorStore.getState()
                  const px = ((e.clientX - r.left) / r.width) * canvas.width
                  const py = ((e.clientY - r.top) / r.height) * canvas.height
                  const hit = hitTestTextClip(st, px, py, st.project.width, st.project.height, st.playhead)
                  if (hit) {
                    clipId = hit.id
                    st.selectClip(hit.id)
                  }
                }
              }
            }
            if (!clipId && !hasSubtitles) return
            // Een vergrendelde track is vergrendeld, ook via de preview. Deze
            // check staat hier (en niet alleen bij de selectie), omdat je een
            // titel ook zonder selectie kunt vastpakken.
            if (clipId) {
              const st = useEditorStore.getState()
              const clip = st.clips.find((c) => c.id === clipId)
              const locked = clip && st.tracks.find((t) => t.id === clip.trackId)?.locked
              if (locked) {
                if (!hasSubtitles) return
                clipId = null
              }
            }
            // Hoekgreep? Dan vergroten/verkleinen in plaats van slepen. De
            // tegenoverliggende hoek blijft staan; de schaal volgt de afstand
            // pointer↔die hoek, dus diagonaal slepen voelt lineair aan.
            let rs: ResizeSnap | null = null
            let lx = 0
            let ly = 0
            if (clipId) {
              const canvas = canvasRef.current
              const st = useEditorStore.getState()
              const clip = st.clips.find((c) => c.id === clipId)
              if (canvas && clip?.text) {
                const r = canvas.getBoundingClientRect()
                if (r.width > 1 && r.height > 1) {
                  const W = st.project.width
                  const H = st.project.height
                  const px = ((e.clientX - r.left) / r.width) * canvas.width
                  const py = ((e.clientY - r.top) / r.height) * canvas.height
                  lx = px
                  ly = py
                  const frame = textSelectionFrame(clip, W, H, st.playhead)
                  if (frame) {
                    // ~12 display-pixels grijpradius, omgerekend naar canvas-px
                    const grabR = 12 * (canvas.width / r.width)
                    const corner = hitTestTextHandle(frame, px, py, grabR)
                    if (corner !== null) {
                      const ox = corner === 1 || corner === 3 ? frame.x : frame.x + frame.w
                      const oy = corner >= 2 ? frame.y : frame.y + frame.h
                      const d0 = Math.hypot(px - ox, py - oy)
                      if (d0 > 1) {
                        const b = { x: frame.x, y: frame.y, w: frame.w, h: frame.h }
                        rs = {
                          oppX: ox,
                          oppY: oy,
                          d0,
                          fontSize: clip.text.fontSize,
                          cx: b.x + b.w / 2,
                          cy: b.y + b.h / 2,
                          W,
                          H,
                          corner
                        }
                      }
                    }
                  }
                }
              }
            }
            subDragRef.current = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, raf: 0, clipId, lx, ly, rs }
            if (rs && canvasRef.current) {
              canvasRef.current.style.cursor = rs.corner === 0 || rs.corner === 3 ? 'nwse-resize' : 'nesw-resize'
            }
            setDraggingSubs(true)
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
              /* noop */
            }
          }}
          onPointerMove={(e) => {
            const start = subDragRef.current
            const canvas = canvasRef.current
            if (!canvas) return
            // Geen sleep actief: alleen de cursor bijwerken boven een greep.
            // Direct op de DOM (geen state), anders her-rendert dit bij elke pixel.
            if (!start) {
              if (e.buttons !== 0 || !dragTextId) {
                if (canvas.style.cursor.startsWith('nw') || canvas.style.cursor.startsWith('ne')) {
                  canvas.style.cursor = ''
                }
                return
              }
              const st = useEditorStore.getState()
              const clip = st.clips.find((c) => c.id === dragTextId)
              const r = canvas.getBoundingClientRect()
              if (clip?.text && r.width > 1 && r.height > 1) {
                const px = ((e.clientX - r.left) / r.width) * canvas.width
                const py = ((e.clientY - r.top) / r.height) * canvas.height
                const frame = textSelectionFrame(clip, st.project.width, st.project.height, st.playhead)
                const corner =
                  frame !== null ? hitTestTextHandle(frame, px, py, 12 * (canvas.width / r.width)) : null
                canvas.style.cursor =
                  corner === null ? '' : corner === 0 || corner === 3 ? 'nwse-resize' : 'nesw-resize'
              }
              return
            }
            const rect = canvas.getBoundingClientRect()
            if (rect.width < 1 || rect.height < 1) return
            const dx = (e.clientX - start.x) / rect.width
            const dy = (e.clientY - start.y) / rect.height
            if (Math.abs(dx) < 0.0005 && Math.abs(dy) < 0.0005) return
            // Optellen en pas per frame doorschrijven. Een muis stuurt honderden
            // events per seconde; elke schrijfactie hertekent de hele timeline en
            // de Inspector, dus sloopte dat de app tijdens het slepen.
            start.dx += dx
            start.dy += dy
            // Bij vergroten/verkleinen de laatste pointerpositie bewaren; de
            // schaal wordt bij het doorspoelen berekend vanaf de momentopname,
            // dus er hoopt geen afrondingsfout op.
            if (start.rs) {
              const r = canvas.getBoundingClientRect()
              if (r.width > 1 && r.height > 1) {
                start.lx = ((e.clientX - r.left) / r.width) * canvas.width
                start.ly = ((e.clientY - r.top) / r.height) * canvas.height
              }
            }
            if (!start.raf) {
              start.raf = requestAnimationFrame(() => {
                const cur = subDragRef.current
                if (!cur) return
                cur.raf = 0
                const st = useEditorStore.getState()
                if (cur.rs && cur.clipId) {
                  const s = Math.hypot(cur.lx - cur.rs.oppX, cur.ly - cur.rs.oppY) / cur.rs.d0
                  if (Number.isFinite(s) && s > 0) {
                    const fs = cur.rs.fontSize * s
                    const nx = (cur.rs.oppX + s * (cur.rs.cx - cur.rs.oppX)) / cur.rs.W
                    const ny = (cur.rs.oppY + s * (cur.rs.cy - cur.rs.oppY)) / cur.rs.H
                    st.resizeTextClip(cur.clipId, fs, nx, ny)
                  }
                  return
                }
                const { dx: ax, dy: ay } = cur
                cur.dx = 0
                cur.dy = 0
                if (ax === 0 && ay === 0) return
                if (cur.clipId) st.moveTextClipPosition(cur.clipId, ax, ay)
                else st.moveSubtitlePosition(ax, ay)
              })
            }
            start.x = e.clientX
            start.y = e.clientY
          }}
          onPointerUp={(e) => {
            // De laatste beweging nog doorzetten, anders blijft de tekst op de plek
            // waar de laatste frame toevallig stond.
            const start = subDragRef.current
            if (start?.raf) {
              cancelAnimationFrame(start.raf)
              start.raf = 0
            }
            if (start) {
              const st = useEditorStore.getState()
              if (start.rs && start.clipId) {
                const s = Math.hypot(start.lx - start.rs.oppX, start.ly - start.rs.oppY) / start.rs.d0
                if (Number.isFinite(s) && s > 0) {
                  st.resizeTextClip(
                    start.clipId,
                    start.rs.fontSize * s,
                    (start.rs.oppX + s * (start.rs.cx - start.rs.oppX)) / start.rs.W,
                    (start.rs.oppY + s * (start.rs.cy - start.rs.oppY)) / start.rs.H
                  )
                }
              } else if (start.dx !== 0 || start.dy !== 0) {
                if (start.clipId) st.moveTextClipPosition(start.clipId, start.dx, start.dy)
                else st.moveSubtitlePosition(start.dx, start.dy)
              }
            }
            if (canvasRef.current) canvasRef.current.style.cursor = ''
            subDragRef.current = null
            setDraggingSubs(false)
            try {
              e.currentTarget.releasePointerCapture(e.pointerId)
            } catch {
              /* noop */
            }
          }}
          onPointerCancel={() => {
            if (subDragRef.current?.raf) cancelAnimationFrame(subDragRef.current.raf)
            if (canvasRef.current) canvasRef.current.style.cursor = ''
            subDragRef.current = null
            setDraggingSubs(false)
          }}
        />
      </div>
      <div className="transport">
        <button className="btn-play" onClick={togglePlay} title={playing ? 'Pause' : 'Play'} data-tooltip="Actie">
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
            ref={scrubRef}
            type="range"
            min={0}
            max={Math.max(total, 0.01)}
            step={0.001}
            defaultValue={Math.min(useEditorStore.getState().playhead, total)}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              scrubbingRef.current = true
              const el = e.currentTarget as HTMLInputElement
              el.setPointerCapture(e.pointerId)
              onSeek(+el.value)
            }}
            onPointerMove={(e) => {
              if (!scrubbingRef.current) return
              onSeek(+(e.currentTarget as HTMLInputElement).value)
            }}
            onPointerUp={(e) => {
              scrubbingRef.current = false
              ;(e.currentTarget as HTMLInputElement).releasePointerCapture?.(e.pointerId)
            }}
            onPointerCancel={() => {
              scrubbingRef.current = false
            }}
            onChange={(e) => {
              // alleen tijdens bewust slepen; keyboard handled in onKeyDown
              if (scrubbingRef.current) onSeek(+e.target.value)
              else {
                // toevallige change (wheel/focus) → terug naar echte playhead
                e.target.value = String(Math.min(useEditorStore.getState().playhead, Math.max(total, 0.01)))
              }
            }}
            onKeyDown={(e) => {
              const max = Math.max(total, 0.01)
              const cur = useEditorStore.getState().playhead
              let next: number | null = null
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + (e.shiftKey ? 1 : 0.1)
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - (e.shiftKey ? 1 : 0.1)
              else if (e.key === 'PageUp') next = cur + 5
              else if (e.key === 'PageDown') next = cur - 5
              else if (e.key === 'Home') next = 0
              else if (e.key === 'End') next = max
              if (next !== null) {
                e.preventDefault()
                onSeek(next)
                e.currentTarget.value = String(Math.max(0, Math.min(next, max)))
              }
            }}
            onWheel={(e) => {
              // trackpad/wiel over de lijn mag playhead niet verschuiven
              e.preventDefault()
            }}
          />
          <span className="time">
            <span ref={timeRef}>{formatTime(useEditorStore.getState().playhead, project.fps)}</span> <span className="total">/ {formatTime(total, project.fps)}</span>
          </span>
        </div>
        <div className="vol" title="Master volume">
          <button
            className={`vol-mute ${masterMuted || masterVol <= 0 ? 'active' : ''}`}
            onClick={() => setMasterMuted(!masterMuted)}
            title={masterMuted ? 'Unmute' : 'Mute'}
           data-tooltip="Actie">
            {masterMuted || masterVol <= 0 ? <IconMute size={14} /> : masterVol < 0.5 ? <IconVolumeLow size={14} /> : <IconVolume size={14} />}
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
