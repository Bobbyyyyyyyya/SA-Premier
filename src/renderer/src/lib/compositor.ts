import type { Clip, ClipEffects } from '../../../shared/types'
import { DEFAULT_EFFECTS } from '../../../shared/types'
import { evalAnimDir, isPreviewOnlyAnim, isText3DAnim } from '../../../shared/textanim'
import { VFX, flashAlpha, flickerDelta, shakeAmpPx, shakeFrac, zoomFactor } from '../../../shared/videofx'
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
  // Zonder effecten geen filter: een canvas-filter (zelfs brightness(1)) dwingt
  // de browser tot een filter-pipeline op élke frame. Dit is de grootste
  // per-frame kosten in de preview.
  //
  // Oude projecten missen de nieuwe velden (undefined): `?? 0` zodat die als
  // "uit" tellen in plaats van de pipeline per ongeluk aan te zetten.
  const v = (k: keyof ClipEffects): number => e[k] ?? 0
  if (
    v('brightness') === 0 && v('contrast') === 0 && v('saturation') === 0 &&
    v('grayscale') === 0 && v('sepia') === 0 && v('hue') === 0 &&
    v('invert') === 0 && v('blur') === 0
  ) {
    return ''
  }
  const p = (x: number, scale = 1): string => Math.max(0, 1 + x * scale).toFixed(3)
  const parts: string[] = [
    `brightness(${p(v('brightness'))})`,
    `contrast(${p(v('contrast'))})`,
    `saturate(${p(v('saturation'))})`
  ]
  if (v('grayscale') > 0) parts.push(`grayscale(${Math.min(1, v('grayscale')).toFixed(3)})`)
  if (v('sepia') > 0) parts.push(`sepia(${Math.min(1, v('sepia')).toFixed(3)})`)
  if (v('hue') !== 0) parts.push(`hue-rotate(${v('hue')}deg)`)
  if (v('invert') > 0) parts.push(`invert(${Math.min(1, v('invert')).toFixed(3)})`)
  if (v('blur') > 0) parts.push(`blur(${v('blur').toFixed(2)}px)`)
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

/** Korreltegels: klein, van tevoren gemaakt, per frame een andere. */
const grainTiles: Array<CanvasRenderingContext2D | null> = []
function grainTile(i: number): CanvasRenderingContext2D | null {
  if (grainTiles[i] === undefined) {
    try {
      const c = document.createElement('canvas')
      c.width = 160
      c.height = 90
      const g = c.getContext('2d')
      if (!g) {
        grainTiles[i] = null
        return null
      }
      const img = g.createImageData(160, 90)
      // vaste zaden per tegel zodat scrubben stabiel blijft
      let seed = 1234567 + i * 98765
      const rnd = (): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return seed / 0x7fffffff
      }
      for (let p = 0; p < img.data.length; p += 4) {
        const v = 128 + Math.round((rnd() - 0.5) * 160)
        img.data[p] = v
        img.data[p + 1] = v
        img.data[p + 2] = v
        img.data[p + 3] = 255
      }
      g.putImageData(img, 0, 0)
      grainTiles[i] = g
    } catch {
      grainTiles[i] = null
    }
  }
  return grainTiles[i] ?? null
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
  scale = 1,
  /** seconden in de clip — stuurt flits/schudden/zoomen/korrel */
  local = 0
): void {
  const vw = 'videoWidth' in el ? el.videoWidth : el.naturalWidth
  const vh = 'videoHeight' in el ? el.videoHeight : el.naturalHeight
  if (!vw || !vh) return
  const s = Math.min(W / vw, H / vh)
  const dw = vw * s
  const dh = vh * s
  const baseDx = (W - dw) / 2
  const baseDy = (H - dh) / 2
  const fx = effects ?? DEFAULT_EFFECTS
  const mirror = fx.mirror ?? 0
  const sx = mirror === 1 ? -1 : 1
  const sy = mirror === 2 ? -1 : 1
  // schudden vergroot eerst vast (zelfde 1.12 als de export) zodat er nooit
  // zwarte randen in beeld komen; de uitslag blijft er ruim binnen
  let drawScale = scale
  let sdx = dx
  let sdy = dy
  const sh = fx.shake ?? 0
  if (sh > 0) {
    drawScale *= VFX.shakeOver
    const amp = shakeAmpPx(sh, Math.min(W, H))
    const { fx: fxp, fy: fyp } = shakeFrac(fx.shakeSpeed ?? 0.5, local)
    sdx += fxp * amp
    sdy += fyp * amp
  }
  const zm = fx.zoom ?? 0
  if (zm > 0) drawScale *= zoomFactor(zm, fx.zoomSpeed ?? 0.5, local)
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
  ctx.filter = filterString(fx)
  if (drawScale !== 1 || sdx !== 0 || sdy !== 0 || sx !== 1 || sy !== 1) {
    const cx = W / 2
    const cy = H / 2
    ctx.translate(cx + sdx, cy + sdy)
    ctx.scale(drawScale * sx, drawScale * sy)
    ctx.translate(-cx, -cy)
    ctx.drawImage(el, baseDx, baseDy, dw, dh)
  } else {
    ctx.drawImage(el, baseDx, baseDy, dw, dh)
  }
  ctx.filter = 'none'
  // witte flits en flikker als overlay ná het beeld, vóór wat er bovenop ligt
  const fl = flashAlpha(fx.flash ?? 0, fx.flashRate ?? 2, local)
  if (fl > 0.003) {
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * Math.min(1, fl)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)
  }
  const fd = flickerDelta(fx.flicker ?? 0, local)
  if (Math.abs(fd) > 0.003) {
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * Math.min(1, Math.abs(fd))
    ctx.fillStyle = fd > 0 ? '#ffffff' : '#000000'
    ctx.fillRect(0, 0, W, H)
  }
  const gr = fx.grain ?? 0
  if (gr > 0.003) {
    const tile = grainTile(Math.abs(Math.floor(local * 24)) % 8)
    if (tile) {
      ctx.save()
      ctx.globalCompositeOperation = 'overlay'
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * Math.min(1, gr)
      ctx.drawImage(tile.canvas, 0, 0, W, H)
      ctx.restore()
    }
  }
  if ((fx.vignette ?? 0) > 0) {
    const v = Math.min(1, fx.vignette ?? 0)
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

/**
 * Eén animatiefase toepassen op de tekst.
 *
 * Alles wat schaal/verplaatsing/alpha kan, komt uit de gedeelde tabel in
 * shared/textanim.ts — dezelfde tabel waaruit de export zijn drawtext-
 * expressies bouwt, zodat de twee niet uit elkaar kunnen lopen. Alleen de
 * animaties die ffmpeg niet kan (rotatie, blur, typewriter) staan hier nog
 * als handgeschreven tak; zie PREVIEW_ONLY_ANIMS.
 */
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

  // p loopt bij in 0 → 1 en bij out 1 → 0; de tabel rekent met u = 0 → 1.
  const u = mode === 'in' ? p : 1 - p
  const q = p

  if (isPreviewOnlyAnim(anim)) {
    if (anim === 'typewriter') {
      out.chars = Math.max(0, Math.floor((mode === 'out' ? q : p) * (t.text?.length ?? 0)))
    } else if (anim === 'blurIn') {
      if (mode === 'out') {
        out.blur = 18 * (1 - q)
        out.alpha = q
      } else {
        out.blur = 18 * (1 - easeOutCubic(p))
        out.alpha = p
      }
    } else if (anim === 'spinIn') {
      out.scale = mode === 'out' ? 0.7 + 0.3 * q : 0.65 + 0.35 * easeOutCubic(p)
      out.rot = mode === 'out' ? -0.5 * (1 - q) : 0.65 * (1 - easeOutCubic(p))
      out.alpha = q
    } else if (anim === 'flip') {
      out.scale = 0.85 + 0.15 * (mode === 'out' ? q : easeOutCubic(p))
      out.rot = mode === 'out' ? -0.9 * (1 - q) : 0.9 * (1 - easeOutCubic(p))
      out.alpha = mode === 'out' ? q : Math.min(1, p * 1.3)
    } else {
      // swing
      if (mode === 'out') out.rot = 0.45 * (1 - q)
      else out.rot = Math.sin(p * Math.PI * 2.5) * 0.35 * (1 - p)
      out.alpha = mode === 'out' ? q : p
    }
    return out
  }

  const s = evalAnimDir(anim, mode, u, t.fontSize || 80)
  if (!s) {
    out.alpha = q
    return out
  }
  out.dx = s.dx
  out.dy = s.dy
  out.scale = s.scale
  out.alpha = s.alpha
  return out
}

const IN_NEUTRAL = { dx: 0, dy: 0, scale: 1, alpha: 1, blur: 0, rot: 0, chars: null as number | null }
const OUT_NEUTRAL = { dx: 0, dy: 0, scale: 1, alpha: 1, blur: 0, rot: 0, chars: null as number | null }

// The pretty renderer. The export is the stubborn one; this file is the reason
// karaoke works at all, and ffmpeg is the reason it took 2 months.
/**
 * Omhullende rechthoek van een tekstclip op dit tijdstip, in canvas-pixels.
 * Zelfde layoutberekening als `drawText`, zodat een hit-test exact klopt met
 * wat er getekend wordt. Geeft null als de clip hier niet zichtbaar is.
 */
export function textClipBounds(
  clip: Clip,
  W: number,
  H: number,
  time: number
): { x: number; y: number; w: number; h: number } | null {
  if (clip.kind !== 'text' || !clip.text) return null
  if (time < clip.start || time >= clip.start + clip.duration) return null
  const alpha = clipAlpha(clip, time)
  if (alpha <= 0.001) return null

  const t = clip.text
  const scale = H / 1080
  const local = Math.max(0, time - clip.start)
  const animDur = Math.max(
    0.05,
    Math.min(t.animDuration ?? 0.45, clip.duration > 0 ? clip.duration / 2 : t.animDuration ?? 0.45)
  )
  const animIn = local < animDur ? applyTextAnim(t, 'in', local, clip.duration) : IN_NEUTRAL
  const animOut = clip.duration - local < animDur ? applyTextAnim(t, 'out', local, clip.duration) : OUT_NEUTRAL
  const animScale = animIn.scale * animOut.scale
  const rot = animIn.rot + animOut.rot

  let body = t.text ?? ''
  const chars = animOut.chars !== null ? animOut.chars : animIn.chars
  if (chars !== null) body = body.slice(0, Math.min(chars, body.length))
  if (!body.length) return null
  const lines = body.split('\n')

  const pxNum = Math.max(1, t.fontSize * scale * animScale)
  const lh = (t.lineHeight ?? 1.2) * pxNum
  const anchorX = Math.round(t.x * W + (animIn.dx + animOut.dx) * scale)
  const anchorY = Math.round(t.y * H + (animIn.dy + animOut.dy) * scale)

  // Breedte meten met dezelfde font-context als bij tekenen
  const m = document.createElement('canvas').getContext('2d')
  if (!m) return null
  const italic = t.italic ? 'italic ' : ''
  m.font = `${italic}${t.fontWeight ?? 700} ${pxNum.toFixed(1)}px "${t.fontFamily || 'sans-serif'}", sans-serif`
  try {
    ;(m as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
      `${((t.letterSpacing ?? 0) * scale).toFixed(2)}px`
  } catch {
    /* oudere canvas */
  }
  const widest = lines.reduce((acc, line) => Math.max(acc, m.measureText(line).width), 0)
  const align = t.align ?? 'center'
  const left = align === 'center' ? anchorX - widest / 2 : align === 'right' ? anchorX - widest : anchorX
  const top = anchorY - (lines.length * lh) / 2
  const w = Math.max(widest, pxNum * 0.6)
  const h = Math.max(lines.length * lh, pxNum * 1.2)

  if (rot === 0) return { x: left, y: top, w, h }
  // gedraaid: hoekpunten omrekennen en de kleinste rechthoek eromheen nemen
  const cx = anchorX
  const cy = anchorY
  const pts: Array<[number, number]> = []
  const corners: Array<[number, number]> = [
    [left, top],
    [left + w, top],
    [left, top + h],
    [left + w, top + h]
  ]
  for (const [px, py] of corners) {
    const dx = px - cx
    const dy = py - cy
    pts.push([cx + dx * Math.cos(rot) - dy * Math.sin(rot), cy + dx * Math.sin(rot) + dy * Math.cos(rot)])
  }
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

/**
 * Welke tekstclip ligt er op dit punt? De bovenste wint, zoals bij tekenen.
 * Ondertitels laat ik bewust uit: die horen bij elkaar en verplaatsen zich
 * samen, dus daar geldt het groepsgedrag.
 */
export function hitTestTextClip(
  state: EditorState,
  px: number,
  py: number,
  W: number,
  H: number,
  time: number
): Clip | null {
  const tracks = state.tracks.filter((t) => t.kind === 'video' && !t.hidden)
  for (let i = tracks.length - 1; i >= 0; i--) {
    const clips = state.clips
      .filter((c) => c.trackId === tracks[i].id && c.kind === 'text')
      .sort((a, b) => a.start - b.start)
    // Binnen een track ligt de laatste clip bovenaan, dus die wint. Vanaf het
    // einde terugzoeken geeft anders de onderste van twee overlappende titels.
    for (let j = clips.length - 1; j >= 0; j--) {
      const clip = clips[j]
      if (clip.subtitle) continue
      const b = textClipBounds(clip, W, H, time)
      if (b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return clip
    }
  }
  return null
}

export interface TextFrame {
  x: number
  y: number
  w: number
  h: number
  /** zijde van de getekende hoekblokjes, in canvas-pixels */
  hs: number
}

/**
 * Het kader zoals `drawText` het tekent (tekstbox + pad), zodat hit-test en
 * tekenen nooit uit elkaar lopen. Geeft null als de clip hier niet zichtbaar is.
 */
export function textSelectionFrame(clip: Clip, W: number, H: number, time: number): TextFrame | null {
  const b = textClipBounds(clip, W, H, time)
  if (!b) return null
  const pad = Math.max(6, Math.round(10 * (H / 1080)))
  const hs = Math.max(5, Math.round(9 * (H / 1080)))
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2, hs }
}

export type TextCorner = 0 | 1 | 2 | 3

/**
 * Welke hoekgreep (0=links­boven, 1=rechts­boven, 2=links­onder, 3=rechts­onder)
 * zit er onder dit punt? `grabR` is de grijpradius in canvas-pixels; de beller
 * rekent die om uit display-pixels zodat het op elk formaat even goed pakt.
 */
export function hitTestTextHandle(frame: TextFrame, px: number, py: number, grabR: number): TextCorner | null {
  const corners: Array<[number, number]> = [
    [frame.x, frame.y],
    [frame.x + frame.w, frame.y],
    [frame.x, frame.y + frame.h],
    [frame.x + frame.w, frame.y + frame.h]
  ]
  for (let i = 0; i < 4; i++) {
    const [cx, cy] = corners[i]
    if (Math.abs(px - cx) <= grabR && Math.abs(py - cy) <= grabR) return i as TextCorner
  }
  return null
}

/** Kleur van het selectiekader om de gekozen titel. Zelfde accent als de UI. */
const SELECT_STROKE = '#ff7f2a'

/**
 * Kader met handvatten rond de tekst, zodat je ziet dát hij geselecteerd is en
 * waar hij staat. Alleen het omhullende blok, want de exacte glyph-bbox is bij
 * een verroterde tekst zinloos; dit gaat om "deze titel staat hier".
 */
function drawSelectionFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  W: number,
  H: number
): void {
  const pad = Math.max(6, Math.round(10 * (H / 1080)))
  const bx = x - pad
  const by = y - pad
  const bw = w + pad * 2
  const bh = h + pad * 2
  ctx.save()
  ctx.globalAlpha = 1
  ctx.strokeStyle = SELECT_STROKE
  ctx.lineWidth = Math.max(1.5, Math.round(3 * (H / 1080)))
  // gestippeld zodat het niet verward wordt met tekstcontouren
  ctx.setLineDash([10, 7])
  ctx.lineJoin = 'round'
  ctx.strokeRect(bx, by, bw, bh)
  ctx.setLineDash([])
  // handvatten in de vier hoeken: leesbaarder als greepvlak dan een 1px lijntje
  const hs = Math.max(5, Math.round(9 * (H / 1080)))
  ctx.fillStyle = SELECT_STROKE
  for (const [hx, hy] of [
    [bx, by],
    [bx + bw, by],
    [bx, by + bh],
    [bx + bw, by + bh]
  ]) {
    ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs)
  }
  // kruislijntjes in het midden van elke kant: het greepvlak dat echt sleept
  const t = Math.max(4, Math.round(16 * (H / 1080)))
  const mx = bx + bw / 2
  const my = by + bh / 2
  ctx.strokeStyle = SELECT_STROKE
  ctx.lineWidth = Math.max(1, Math.round(2 * (H / 1080)))
  ctx.beginPath()
  ctx.moveTo(mx - t / 2, by); ctx.lineTo(mx + t / 2, by)
  ctx.moveTo(mx - t / 2, by + bh); ctx.lineTo(mx + t / 2, by + bh)
  ctx.moveTo(bx, my - t / 2); ctx.lineTo(bx, my + t / 2)
  ctx.moveTo(bx + bw, my - t / 2); ctx.lineTo(bx + bw, my + t / 2)
  ctx.stroke()
  // centrumkruis: waar hij naartoe gaat
  const c = Math.max(3, Math.round(5 * (H / 1080)))
  ctx.beginPath()
  ctx.moveTo(mx - c, my); ctx.lineTo(mx + c, my)
  ctx.moveTo(mx, my - c); ctx.lineTo(mx, my + c)
  ctx.stroke()
  void W
  ctx.restore()
}

function drawText(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  W: number,
  H: number,
  alpha: number,
  time: number,
  tdx = 0,
  tdy = 0,
  tscale = 1,
  selected = false
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
  // Een selectiekader hoort bij de interface, niet bij de composite: op de
  // allereerste frame van een fade-in staat de tekst op alpha 0 en was er dus
  // niets te zien dat je geselecteerd had. Daarom tekenen we het kader ook
  // wanneer de tekst zelf onzichtbaar is (het zet zelf globalAlpha = 1).
  if (opacity <= 0.001 && !selected) return

  // ffmpeg kan borderw géén expressie geven, dus een meeschalende rand bestaat
  // niet in de export. De 3D-presets leven van dikke randen, dus daar houden we
  // de stroke constant tijdens de animatie — anders zou de preview een dikkere
  // rand laten zien dan de export oplevert. De tekst zelf schaalt gewoon mee.
  const strokeScale = isText3DAnim(t.animIn) || isText3DAnim(t.animOut) ? 1 : animScale

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

  // Selectiekader EERST, zodat de tekst er bovenop ligt en niet andersom.
  // BBox in de gedraaide ruimte terug naar beeldruimte: het kader moet met de
  // tekst meedraaien, anders wijst hij bij een rotatie de verkeerde kant op.
  if (selected && body.length) {
    const fbLeft = align === 'center' ? anchorX - widest / 2 : align === 'right' ? anchorX - widest : anchorX
    // het hele tekstblok, dus een meerdelige titel krijgt één kader
    const fbTop = anchorY - totalH / 2
    const fbW = Math.max(widest, pxNum * 0.6)
    const fbH = Math.max(totalH, pxNum * 1.2)
    if (rot !== 0) {
      ctx.save()
      ctx.translate(anchorX, anchorY)
      ctx.rotate(rot)
      ctx.translate(-anchorX, -anchorY)
      drawSelectionFrame(ctx, fbLeft, fbTop, fbW, fbH, W, H)
      ctx.restore()
    } else {
      drawSelectionFrame(ctx, fbLeft, fbTop, fbW, fbH, W, H)
    }
  }

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
      ctx.lineWidth = t.strokeWidth * scale * strokeScale
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
            ctx.lineWidth = t.strokeWidth * scale * strokeScale
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
        drawText(ctx, clip, width, height, alpha, time, tx, ty, ts, clip.id === state.selectedClipId)
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
        drawVideo(ctx, el as HTMLVideoElement, width, height, clip.effects, alpha, tx, ty, ts, time - clip.start)
      } catch {
        // draw failed, keep previous frame
      }
    }
  }

  ctx.restore()
}
