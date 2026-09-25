import type { Clip, ClipEffects } from '../../../shared/types'
import type { EditorState } from '../store'
import type { PlayerManager } from './player'

export interface RenderOpts {
  width: number
  height: number
  time: number
  playing: boolean
  state: EditorState
  players: PlayerManager
}

export function filterString(e: ClipEffects): string {
  const p = (v: number, scale = 1): string => Math.max(0, 1 + v * scale).toFixed(3)
  const parts: string[] = [
    `brightness(${p(e.brightness)})`,
    `contrast(${p(e.contrast)})`,
    `saturate(${p(e.saturation)})`
  ]
  if (e.grayscale > 0) parts.push(`grayscale(${Math.min(1, e.grayscale).toFixed(3)})`)
  if (e.sepia > 0) parts.push(`sepia(${Math.min(1, e.sepia).toFixed(3)})`)
  if (e.hue !== 0) parts.push(`hue-rotate(${e.hue}deg)`)
  if (e.invert > 0) parts.push(`invert(${Math.min(1, e.invert).toFixed(3)})`)
  if (e.blur > 0) parts.push(`blur(${e.blur.toFixed(2)}px)`)
  return parts.join(' ')
}

export function clipAlpha(clip: Clip, time: number): number {
  let a = 1
  if (clip.transitionOut) {
    const T = clip.transitionOut.duration
    const fadeStart = clip.start + clip.duration - T
    if (time >= fadeStart) {
      const p = Math.max(0, Math.min(1, (clip.start + clip.duration - time) / T))
      a = clip.transitionOut.type === 'dip' ? p * p : p
    }
  }
  if (clip.transitionIn) {
    const T = clip.transitionIn.duration
    if (time < clip.start + T) {
      const p = Math.max(0, Math.min(1, (time - clip.start) / T))
      const v = clip.transitionIn.type === 'dip' ? p * p : p
      a = Math.min(a, v)
    }
  }
  return a
}

/** Offset/scale voor geometrische transitions (preview). */
export function clipTransitionXform(
  clip: Clip,
  time: number
): { dx: number; dy: number; scale: number } {
  let dx = 0
  let dy = 0
  let scale = 1
  const apply = (type: string, T: number, mode: 'in' | 'out'): void => {
    if (T <= 0) return
    if (mode === 'in') {
      if (time >= clip.start + T) return
      const p = Math.max(0, Math.min(1, (time - clip.start) / T))
      switch (type) {
        case 'slideLeft':
          dx += (1 - p) * -80
          break
        case 'slideRight':
          dx += (1 - p) * 80
          break
        case 'slideUp':
          dy += (1 - p) * -80
          break
        case 'slideDown':
          dy += (1 - p) * 80
          break
        case 'zoom':
          scale *= 0.75 + 0.25 * p
          break
        default:
          break
      }
      return
    }
    if (time < clip.start + clip.duration - T) return
    const p = Math.max(0, Math.min(1, (clip.start + clip.duration - time) / T))
    switch (type) {
      case 'slideLeft':
        dx += (1 - p) * 80
        break
      case 'slideRight':
        dx += (1 - p) * -80
        break
      case 'slideUp':
        dy += (1 - p) * 80
        break
      case 'slideDown':
        dy += (1 - p) * -80
        break
      case 'zoom':
        scale *= 1 + 0.25 * (1 - p)
        break
      default:
        break
    }
  }
  if (clip.transitionIn) apply(clip.transitionIn.type, clip.transitionIn.duration, 'in')
  if (clip.transitionOut) apply(clip.transitionOut.type, clip.transitionOut.duration, 'out')
  return { dx, dy, scale }
}

/** Audio-gain (0..1) op basis van transition in/out — audio en video met geluid. */
export function clipAudioGain(clip: Clip, time: number): number {
  return clipAlpha(clip, time)
}

function drawVideo(
  ctx: CanvasRenderingContext2D,
  el: HTMLVideoElement | HTMLImageElement,
  W: number,
  H: number,
  effects: ClipEffects,
  alpha: number,
  dx = 0,
  dy = 0,
  scale = 1
): void {
  const vw = 'videoWidth' in el ? el.videoWidth : el.naturalWidth
  const vh = 'videoHeight' in el ? el.videoHeight : el.naturalHeight
  if (!vw || !vh) return
  const s = Math.min(W / vw, H / vh)
  const dw = vw * s
  const dh = vh * s
  const baseDx = (W - dw) / 2
  const baseDy = (H - dh) / 2
  const drawScale = scale
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
  ctx.filter = filterString(effects)
  if (drawScale !== 1 || dx !== 0 || dy !== 0) {
    const cx = W / 2
    const cy = H / 2
    ctx.translate(cx + dx, cy + dy)
    ctx.scale(drawScale, drawScale)
    ctx.translate(-cx, -cy)
    ctx.drawImage(el, baseDx, baseDy, dw, dh)
  } else {
    ctx.drawImage(el, baseDx, baseDy, dw, dh)
  }
  ctx.filter = 'none'
  if (effects.vignette > 0) {
    const v = Math.min(1, effects.vignette)
    const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, `rgba(0,0,0,${(0.55 * v).toFixed(3)})`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
  }
  ctx.restore()
}

function textAnimProgress(
  anim: string | undefined,
  local: number,
  duration: number,
  animDur: number,
  mode: 'in' | 'out'
): { p: number; active: boolean } {
  if (!anim || anim === 'none' || animDur <= 0) return { p: 1, active: false }
  if (mode === 'in') {
    if (local >= animDur) return { p: 1, active: false }
    return { p: Math.max(0, Math.min(1, local / animDur)), active: true }
  }
  // out: p = remaining/animDur → 1 bij start, 0 bij einde (nooit weer stijgen)
  const remaining = duration - local
  if (remaining >= animDur) return { p: 1, active: false }
  return { p: Math.max(0, Math.min(1, remaining / animDur)), active: true }
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3)
}

function easeOutBack(x: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

// Seventeen animation curves, all of them "close enough". A designer will
// replace all seventeen in 2 months and we will pretend we liked ours.
function applyTextAnim(
  t: NonNullable<Clip['text']>,
  mode: 'in' | 'out',
  local: number,
  clipDur: number
): { dx: number; dy: number; scale: number; alpha: number; blur: number; rot: number; chars: number | null } {
  const anim = mode === 'in' ? t.animIn : t.animOut
  // in + out mogen niet overlappen bij korte clips (anders vreet de out de hele in-tijd op)
  const animDur = Math.max(0.05, Math.min(t.animDuration ?? 0.45, clipDur > 0 ? clipDur / 2 : t.animDuration ?? 0.45))
  const { p, active } = textAnimProgress(anim, local, clipDur, animDur, mode)
  const out = { dx: 0, dy: 0, scale: 1, alpha: 1, blur: 0, rot: 0, chars: null as number | null }
  if (!active || !anim || anim === 'none') return out

  const travel = (t.fontSize || 80) * 1.1
  if (mode === 'out') {
    // p loopt bij out 1 → 0 (remaining/animDur). q = p:
    // fade alpha 1→0, slide van rust naar travel — nooit eerst weg en dan terug.
    const q = p
    switch (anim) {
      case 'fade':
        out.alpha = q
        break
      case 'slideUp':
        out.dy = -travel * (1 - q)
        out.alpha = q
        break
      case 'slideDown':
        out.dy = travel * (1 - q)
        out.alpha = q
        break
      case 'slideLeft':
        out.dx = -travel * 1.4 * (1 - q)
        out.alpha = q
        break
      case 'slideRight':
        out.dx = travel * 1.4 * (1 - q)
        out.alpha = q
        break
      case 'pop':
      case 'zoomIn':
        out.scale = 0.6 + 0.4 * q
        out.alpha = q
        break
      case 'typewriter':
        out.chars = Math.max(0, Math.floor(q * (t.text?.length ?? 0)))
        break
      case 'blurIn':
        out.blur = 18 * (1 - q)
        out.alpha = q
        break
      case 'bounce':
        out.dy = -travel * 0.35 * (1 - q)
        out.alpha = q
        break
      case 'spinIn':
        out.rot = -0.5 * (1 - q)
        out.scale = 0.7 + 0.3 * q
        out.alpha = q
        break
      case 'flip':
        out.rot = -0.9 * (1 - q)
        out.scale = 0.85 + 0.15 * q
        out.alpha = q
        break
      case 'drop':
        out.dy = travel * 0.8 * (1 - q)
        out.alpha = q
        break
      case 'swing':
        out.rot = 0.45 * (1 - q)
        out.alpha = q
        break
      case 'grow':
        out.scale = 1.35 - 0.35 * q
        out.alpha = q
        break
      default:
        out.alpha = q
    }
    return out
  }

  switch (anim) {
    case 'fade':
      out.alpha = p
      break
    case 'slideUp':
      out.dy = travel * (1 - easeOutCubic(p))
      out.alpha = p
      break
    case 'slideDown':
      out.dy = -travel * (1 - easeOutCubic(p))
      out.alpha = p
      break
    case 'slideLeft':
      out.dx = travel * 1.4 * (1 - easeOutCubic(p))
      out.alpha = p
      break
    case 'slideRight':
      out.dx = -travel * 1.4 * (1 - easeOutCubic(p))
      out.alpha = p
      break
    case 'pop':
      out.scale = 0.4 + 0.6 * easeOutBack(p)
      out.alpha = Math.min(1, p * 1.4)
      break
    case 'zoomIn':
      out.scale = 0.55 + 0.45 * easeOutCubic(p)
      out.alpha = p
      break
    case 'typewriter':
      out.chars = Math.max(0, Math.floor(p * (t.text?.length ?? 0)))
      break
    case 'blurIn':
      out.blur = 18 * (1 - easeOutCubic(p))
      out.alpha = p
      break
    case 'bounce': {
      const b = easeOutBack(p)
      out.dy = travel * 0.55 * (1 - b)
      out.alpha = Math.min(1, p * 1.5)
      break
    }
    case 'spinIn':
      out.rot = 0.65 * (1 - easeOutCubic(p))
      out.scale = 0.65 + 0.35 * easeOutCubic(p)
      out.alpha = p
      break
    case 'flip':
      out.rot = 0.9 * (1 - easeOutCubic(p))
      out.scale = 0.85 + 0.15 * easeOutCubic(p)
      out.alpha = Math.min(1, p * 1.3)
      break
    case 'drop':
      out.dy = -travel * 0.9 * (1 - easeOutCubic(p))
      out.alpha = Math.min(1, p * 1.4)
      break
    case 'swing':
      out.rot = Math.sin(p * Math.PI * 2.5) * 0.35 * (1 - p)
      out.alpha = p
      break
    case 'grow':
      out.scale = 0.55 + 0.45 * easeOutBack(p)
      out.alpha = Math.min(1, p * 1.3)
      break
    default:
      out.alpha = p
  }
  return out
}

const IN_NEUTRAL = { dx: 0, dy: 0, scale: 1, alpha: 1, blur: 0, rot: 0, chars: null as number | null }
const OUT_NEUTRAL = { dx: 0, dy: 0, scale: 1, alpha: 1, blur: 0, rot: 0, chars: null as number | null }

// The pretty renderer. The export is the stubborn one; this file is the reason
// karaoke works at all, and ffmpeg is the reason it took 2 months.
function drawText(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  W: number,
  H: number,
  alpha: number,
  time: number,
  tdx = 0,
  tdy = 0,
  tscale = 1
): void {
  if (!clip.text) return
  const t = clip.text
  const scale = H / 1080
  const local = Math.max(0, time - clip.start)
  // out start ná in (niet overlappen): in krijgt eerste helft, out tweede helft
  const animDur = Math.max(
    0.05,
    Math.min(t.animDuration ?? 0.45, clip.duration > 0 ? clip.duration / 2 : t.animDuration ?? 0.45)
  )
  const inPhase = local < animDur
  const outPhase = clip.duration - local < animDur
  const animIn = inPhase ? applyTextAnim(t, 'in', local, clip.duration) : IN_NEUTRAL
  const animOut = outPhase ? applyTextAnim(t, 'out', local, clip.duration) : OUT_NEUTRAL
  const dx = animIn.dx + animOut.dx + tdx
  const dy = animIn.dy + animOut.dy + tdy
  const animScale = animIn.scale * animOut.scale * tscale
  // out wint bij alpha: nooit animIn*animOut-dip die later weer oplicht
  const animAlpha = outPhase ? animOut.alpha : animIn.alpha
  const blurPx = animIn.blur + animOut.blur
  const rot = animIn.rot + animOut.rot
  let chars = animIn.chars
  if (animOut.chars !== null) chars = animOut.chars

  const opacity = Math.max(0, Math.min(1, (t.opacity ?? 1) * alpha * animAlpha))
  if (opacity <= 0.001) return

  let body = t.text ?? ''
  if (chars !== null) body = body.slice(0, Math.min(chars, body.length))
  const lines = body.split('\n')

  const weight = t.fontWeight ?? 700
  const italic = t.italic ? 'italic ' : ''
  const pxNum = Math.max(1, t.fontSize * scale * animScale)
  const px = pxNum.toFixed(1)
  const family = t.fontFamily || 'sans-serif'
  const lh = (t.lineHeight ?? 1.2) * pxNum

  ctx.save()
  ctx.globalAlpha = opacity
  if (blurPx > 0.05) {
    ctx.filter = `blur(${(blurPx * scale).toFixed(2)}px)`
  }
  ctx.textBaseline = 'middle'
  const align = t.align ?? 'center'
  ctx.textAlign = align
  ctx.font = `${italic}${weight} ${px}px "${family}", sans-serif`
  try {
    const ls = (t.letterSpacing ?? 0) * scale
    ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${ls.toFixed(2)}px`
  } catch {
    /* older canvas */
  }

  const anchorX = Math.round(t.x * W + dx * scale)
  const anchorY = Math.round(t.y * H + dy * scale)
  const totalH = lines.length * lh
  let startY = anchorY - totalH / 2 + lh / 2

  if (rot !== 0) {
    ctx.translate(anchorX, anchorY)
    ctx.rotate(rot)
    ctx.translate(-anchorX, -anchorY)
  }

  const widest = lines.reduce((m, line) => Math.max(m, ctx.measureText(line).width), 0)
  if (t.bgColor && t.bgColor !== 'transparent' && body.length) {
    const padX = 14 * scale
    const padY = 8 * scale
    let bw = widest + padX * 2
    let bx: number
    if (align === 'left') bx = anchorX - padX
    else if (align === 'right') bx = anchorX - widest - padX
    else bx = anchorX - bw / 2
    if (align !== 'center') bw = widest + padX * 2
    // box op echte ink-hoogte, gecentreerd op textBaseline 'middle' — geen lege balk onder de tekst
    const probe = ctx.measureText(lines[0] || body)
    const aAsc = probe.actualBoundingBoxAscent
    const aDesc = probe.actualBoundingBoxDescent
    const glyphH =
      aAsc != null && aDesc != null && aAsc + aDesc > 1
        ? aAsc + aDesc
        : ((probe as TextMetrics & { fontBoundingBoxAscent?: number }).fontBoundingBoxAscent ?? pxNum * 0.8) +
            ((probe as TextMetrics & { fontBoundingBoxDescent?: number }).fontBoundingBoxDescent ?? pxNum * 0.25)
    const inkH = (lines.length - 1) * lh + glyphH
    ctx.fillStyle = t.bgColor
    ctx.fillRect(bx, startY - glyphH / 2 - padY, bw, inkH + padY * 2)
  }

  for (const line of lines) {
    const metrics = ctx.measureText(line)
    let lx = anchorX
    if (align === 'left') lx = anchorX
    else if (align === 'right') lx = anchorX
    else lx = anchorX

    if (t.shadowBlur || t.shadowX || t.shadowY) {
      ctx.shadowColor = t.shadowColor || 'rgba(0,0,0,0.5)'
      ctx.shadowBlur = (t.shadowBlur ?? 0) * scale
      ctx.shadowOffsetX = (t.shadowX ?? 0) * scale
      ctx.shadowOffsetY = (t.shadowY ?? 0) * scale
    } else {
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0
    }

    if (t.strokeWidth && t.strokeWidth > 0 && t.strokeColor && t.strokeColor !== 'transparent') {
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.strokeStyle = t.strokeColor
      ctx.lineWidth = t.strokeWidth * scale * animScale
      ctx.strokeText(line, lx, startY)
    }

    // fix: karaoke words highlight when spoken, not whenever they feel inspired
    const karaokeWords = t.words && t.words.length > 1 && lines.length === 1 ? t.words : null
    const karaokeMatch = karaokeWords && karaokeWords.map((w) => w.text).join(' ') === line
    if (karaokeWords && karaokeMatch) {
      const lineW = ctx.measureText(line).width
      const left = align === 'center' ? anchorX - lineW / 2 : align === 'right' ? anchorX - lineW : anchorX
      const spaceW = ctx.measureText(' ').width
      let ox = 0
      ctx.textAlign = 'left'
      for (const w of karaokeWords) {
        const active = local >= w.s && local < w.e
        const wW = ctx.measureText(w.text).width
        if (active) {
          const k = t.wordScale && t.wordScale !== 1 ? t.wordScale : 1
          ctx.save()
          ctx.translate(left + ox + wW / 2, startY)
          ctx.scale(k, k)
          if (t.strokeWidth && t.strokeWidth > 0 && t.strokeColor && t.strokeColor !== 'transparent') {
            ctx.strokeStyle = t.strokeColor
            ctx.lineWidth = t.strokeWidth * scale * animScale
            ctx.strokeText(w.text, -wW / 2, 0)
          }
          ctx.fillStyle = t.highlightColor ?? t.color
          ctx.fillText(w.text, -wW / 2, 0)
          ctx.restore()
        } else {
          ctx.fillStyle = t.color
          ctx.fillText(w.text, left + ox, startY)
        }
        ox += wW + spaceW
      }
      ctx.textAlign = align
    } else {
      ctx.fillStyle = t.color
      ctx.fillText(line, lx, startY)
    }

    if (t.underline) {
      const w = metrics.width
      let ux = lx
      if (align === 'center') ux = lx - w / 2
      else if (align === 'right') ux = lx - w
      const uy = startY + pxNum * 0.42
      ctx.fillRect(ux, uy, w, Math.max(1, pxNum * 0.06))
    }

    startY += lh
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  }

  ctx.restore()
}

export function renderFrame(ctx: CanvasRenderingContext2D, o: RenderOpts): void {
  const { width, height, time, state, players } = o

  // Zoek eerst of er überhaupt iets te tonen is en of het al decodable is.
  // Als alles nog aan het seeken is, wis niet naar zwart maar behoud vorige frame (voorkomt zwart flikkeren bij snel scrubben).
  const videoTracks = state.tracks.filter((t) => t.kind === 'video' && !t.hidden)
  let hasReady = false
  for (const track of videoTracks) {
    for (const clip of state.clips.filter((c) => c.trackId === track.id && (c.kind === 'video' || c.kind === 'text'))) {
      if (time < clip.start || time >= clip.start + clip.duration) continue
      if (clip.kind === 'text') { hasReady = true; break }
      const asset = state.assets.find((a) => a.id === clip.assetId)
      if (!asset) continue
      const el = players.element(clip.id, asset, clip.kind)
      if (el instanceof HTMLImageElement) { if (el.complete && (el as HTMLImageElement).naturalWidth > 0) { hasReady = true; break } }
      else if (el instanceof HTMLMediaElement) { if (!el.error && el.readyState >= 2 && !el.seeking) { hasReady = true; break } else if (el.readyState >= 1) { hasReady = true; break } }
    }
    if (hasReady) break
  }
  // Heeft er überhaupt een clip op dit tijdstip (ook als hij nog niet ready is)?
  const hasClipAtTime = (() => {
    for (const track of videoTracks) {
      for (const clip of state.clips.filter((c) => c.trackId === track.id && (c.kind === 'video' || c.kind === 'text'))) {
        if (time >= clip.start && time < clip.start + clip.duration) return true
      }
    }
    return false
  })()
  // Clip aanwezig maar nog niet decodable (seeking/buffering) → behoud vorige frame, niet naar zwart
  if (hasClipAtTime && !hasReady) return
  // Geen clip op dit tijdstip (gap) → wel naar zwart (intentioneel)

  ctx.save()
  ctx.filter = 'none'
  ctx.globalAlpha = 1
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  for (const track of videoTracks) {
    const clips = state.clips
      .filter((c) => c.trackId === track.id && (c.kind === 'video' || c.kind === 'text'))
      .sort((a, b) => a.start - b.start)
    for (const clip of clips) {
      if (time < clip.start || time >= clip.start + clip.duration) continue
      const { dx: tx, dy: ty, scale: ts } = clipTransitionXform(clip, time)
      const alpha = clipAlpha(clip, time)
      if (alpha <= 0.001) continue
      if (clip.kind === 'text') {
        drawText(ctx, clip, width, height, alpha, time, tx, ty, ts)
        continue
      }
      const asset = state.assets.find((a) => a.id === clip.assetId)
      if (!asset) continue
      const el = players.element(clip.id, asset, clip.kind)
      if (el instanceof HTMLMediaElement) {
        if (el.error) continue
        // tolerate HAVE_METADATA (1) if we already have dimensions
        if (el.readyState === 0) continue
      } else if (!el.complete || (el as HTMLImageElement).naturalWidth === 0) {
        continue
      }
      // keep last frame if video not yet have current data — don't clear to black
      try {
        drawVideo(ctx, el as HTMLVideoElement, width, height, clip.effects, alpha, tx, ty, ts)
      } catch {
        // draw failed, keep previous frame
      }
    }
  }

  ctx.restore()
}
