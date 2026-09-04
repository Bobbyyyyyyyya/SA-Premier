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
      a = Math.max(0, Math.min(1, (clip.start + clip.duration - time) / T))
    }
  }
  if (clip.transitionIn) {
    const T = clip.transitionIn.duration
    if (time < clip.start + T) {
      a = Math.min(a, Math.max(0, (time - clip.start) / T))
    }
  }
  return a
}

function drawVideo(
  ctx: CanvasRenderingContext2D,
  el: HTMLVideoElement | HTMLImageElement,
  W: number,
  H: number,
  effects: ClipEffects,
  alpha: number
): void {
  const vw = 'videoWidth' in el ? el.videoWidth : el.naturalWidth
  const vh = 'videoHeight' in el ? el.videoHeight : el.naturalHeight
  if (!vw || !vh) return
  const s = Math.min(W / vw, H / vh)
  const dw = vw * s
  const dh = vh * s
  const dx = (W - dw) / 2
  const dy = (H - dh) / 2
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
  ctx.filter = filterString(effects)
  ctx.drawImage(el, dx, dy, dw, dh)
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

function drawText(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  W: number,
  H: number,
  alpha: number
): void {
  if (!clip.text) return
  const t = clip.text
  const scale = H / 1080
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const px = (t.fontSize * scale).toFixed(1)
  ctx.font = `600 ${px}px ${t.fontFamily}, sans-serif`
  const cx = Math.round(t.x * W)
  const cy = Math.round(t.y * H)
  if (t.bgColor && t.bgColor !== 'transparent') {
    const metrics = ctx.measureText(t.text)
    const pad = 14 * scale
    const bw = metrics.width + pad * 2
    const bh = t.fontSize * scale * 1.4
    ctx.fillStyle = t.bgColor
    ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh)
  }
  ctx.fillStyle = t.color
  ctx.fillText(t.text, cx, cy)
  ctx.restore()
}

export function renderFrame(ctx: CanvasRenderingContext2D, o: RenderOpts): void {
  const { width, height, time, state, players } = o
  ctx.save()
  ctx.filter = 'none'
  ctx.globalAlpha = 1
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)

  const videoTracks = state.tracks.filter((t) => t.kind === 'video' && !t.hidden)
  for (const track of videoTracks) {
    const clips = state.clips
      .filter((c) => c.trackId === track.id && (c.kind === 'video' || c.kind === 'text'))
      .sort((a, b) => a.start - b.start)
    for (const clip of clips) {
      if (time < clip.start || time >= clip.start + clip.duration) continue
      const alpha = clipAlpha(clip, time)
      if (alpha <= 0.001) continue
      if (clip.kind === 'text') {
        drawText(ctx, clip, width, height, alpha)
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
        drawVideo(ctx, el as HTMLVideoElement, width, height, clip.effects, alpha)
      } catch {
        // draw failed, keep previous frame
      }
    }
  }

  ctx.restore()
}
