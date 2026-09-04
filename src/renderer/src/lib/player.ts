import type { Asset } from '../../../shared/types'
import { mediaUrl } from './mediaUrl'
import { clamp } from './format'

export type PlayerElement = HTMLMediaElement | HTMLImageElement

export class PlayerManager {
  private els = new Map<string, PlayerElement>()
  private container: HTMLDivElement

  constructor() {
    this.container = document.createElement('div')
    this.container.style.cssText =
      'position:fixed;left:-100000px;top:0;width:16px;height:16px;overflow:hidden;pointer-events:none;'
    document.body.appendChild(this.container)
  }

  element(clipId: string, asset: Asset, kind?: string): PlayerElement {
    let el = this.els.get(clipId)
    if (!el) {
      const k = kind ?? asset.type
      if (k === 'audio') {
        const a = new Audio()
        a.preload = 'auto'
        // no crossOrigin for local media:// — avoids CORS preflight
        // @ts-ignore
        a.volume = 1
        a.src = mediaUrl(asset.path)
        el = a
      } else if (asset.isImage) {
        const img = new Image()
        img.src = mediaUrl(asset.path)
        el = img
      } else {
        const v = document.createElement('video')
        v.preload = 'auto'
        v.playsInline = true
        v.volume = 1
        // don't force muted here — let syncPlayback decide
        // @ts-ignore playsInline attribute for safari
        v.setAttribute('playsinline', '')
        v.setAttribute('webkit-playsinline', '')
        v.src = mediaUrl(asset.path)
        el = v
      }
      this.container.appendChild(el as Node)
      this.els.set(clipId, el)
    }
    return el
  }

  private expectedTime(clipStart: number, clipDur: number, sourceStart: number, time: number): number | null {
    const expected = time - clipStart + sourceStart
    if (expected >= 0 && expected < clipDur) return expected
    return null
  }

  syncPlayback(
    clipId: string,
    kind: 'video' | 'audio',
    clipStart: number,
    clipDur: number,
    sourceStart: number,
    trackMuted: boolean,
    time: number,
    playing: boolean
  ): void {
    const el = this.els.get(clipId)
    if (!el || !(el instanceof HTMLMediaElement)) return
    el.muted = trackMuted
    const expected = this.expectedTime(clipStart, clipDur, sourceStart, time)
    if (playing && expected !== null) {
      if (Math.abs(el.currentTime - expected) > 0.4) {
        try {
          el.currentTime = clamp(expected, 0, el.duration || expected)
        } catch {
          // not seekable yet
        }
      }
      if (el.paused) {
        el.play().catch(() => {})
      }
    } else {
      if (!el.paused) el.pause()
    }
  }

  seekTo(
    clipId: string,
    clipStart: number,
    clipDur: number,
    sourceStart: number,
    time: number
  ): void {
    const el = this.els.get(clipId)
    if (!el || !(el instanceof HTMLMediaElement)) return
    const expected = this.expectedTime(clipStart, clipDur, sourceStart, time)
    if (expected === null) {
      if (!el.paused) el.pause()
      return
    }
    if (Math.abs(el.currentTime - expected) > 0.05) {
      try {
        el.currentTime = clamp(expected, 0, el.duration || expected)
      } catch {
        // not seekable yet
      }
    }
  }

  pauseAll(): void {
    for (const el of this.els.values()) {
      if (el instanceof HTMLMediaElement && !el.paused) el.pause()
    }
  }

  dispose(): void {
    this.pauseAll()
    this.els.clear()
    this.container.remove()
  }
}
