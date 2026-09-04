import type { Asset } from '../../../shared/types'
import { DEFAULT_EFFECTS, uid } from '../../../shared/types'
import { basename, mediaUrl } from './mediaUrl'
import { useEditorStore } from '../store'

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac|opus|wma)$/i
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i
const IMAGE_DURATION = 5

function waitMetadata(el: HTMLMediaElement): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = (): void => {
      if (!done) {
        done = true
        resolve()
      }
    }
    el.onloadedmetadata = finish
    el.onerror = finish
    setTimeout(finish, 10000)
  })
}

async function thumbnail(path: string): Promise<string | undefined> {
  try {
    const t = await window.api.generateThumbnail(path)
    return t || undefined
  } catch {
    return undefined
  }
}

function loadImage(path: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const timeout = setTimeout(() => {
      img.src = ''
      resolve(null)
    }, 10000)
    img.onload = (): void => {
      clearTimeout(timeout)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = (): void => {
      clearTimeout(timeout)
      resolve(null)
    }
    img.src = mediaUrl(path)
  })
}

export async function inspectMedia(paths: string[]): Promise<Asset[]> {
  const out: Asset[] = []
  for (const p of paths) {
    try {
      if (IMAGE_EXT.test(p)) {
        const info = await loadImage(p)
        if (!info || !info.width || !info.height) continue
        out.push({
          id: uid(),
          name: basename(p),
          path: p,
          type: 'video',
          duration: IMAGE_DURATION,
          width: info.width,
          height: info.height,
          hasAudio: false,
          thumbnail: await thumbnail(p),
          isImage: true
        })
        continue
      }
      const isAudio = AUDIO_EXT.test(p)
      // try ffprobe via main for accurate duration (cross-platform, Windows-ready)
      let duration: number | null = null
      try {
        duration = await window.api.getMediaDuration(p)
      } catch { duration = null }
      const el = isAudio ? new Audio() : document.createElement('video')
      el.preload = 'auto'
      el.src = mediaUrl(p)
      await waitMetadata(el)
      if (duration == null || !Number.isFinite(duration) || duration <= 0) {
        duration = Number.isFinite(el.duration) ? el.duration : 0
      }
      const vEl = el as HTMLVideoElement
      const width = isAudio ? 0 : vEl.videoWidth || 0
      const height = isAudio ? 0 : vEl.videoHeight || 0
      let hasAudio = isAudio
      if (!isAudio) {
        try {
          const audioTracks = (vEl as unknown as { audioTracks?: { length?: number } }).audioTracks
          hasAudio = audioTracks ? (audioTracks.length ?? 0) > 0 : true
        } catch {
          hasAudio = true
        }
      }

      let thumb: string | undefined
      if (!isAudio && width > 0) {
        thumb = await thumbnail(p)
      }

      out.push({
        id: uid(),
        name: basename(p),
        path: p,
        type: isAudio ? 'audio' : 'video',
        duration,
        width: width || undefined,
        height: height || undefined,
        hasAudio,
        thumbnail: thumb
      })
    } catch {
      // skip files that cannot be inspected
    }
  }
  return out
}

export async function importPaths(paths: string[], opts?: { place?: boolean }): Promise<void> {
  const assets = await inspectMedia(paths)
  if (!assets.length) return
  const s = useEditorStore.getState()
  s.addAssets(assets)
  for (const a of assets) {
    void window.api.recentsAdd({
      path: a.path,
      name: a.name,
      type: a.type,
      thumbnail: a.thumbnail,
      duration: a.duration,
      addedAt: Date.now()
    })
  }
  if (opts?.place !== false) {
    let t = s.playhead
    for (const a of assets) {
      const trackId =
        a.type === 'audio'
          ? s.tracks.find((x) => x.kind === 'audio')?.id
          : s.tracks.find((x) => x.kind === 'video')?.id
      if (!trackId) continue
      s.addClip(a.id, trackId, t)
      if (a.type === 'video' && a.hasAudio) {
        const audioTrackId = s.tracks.find((x) => x.kind === 'audio')?.id
        if (audioTrackId) {
          const audioClip = {
            id: uid(),
            assetId: a.id,
            assetPath: a.path,
            trackId: audioTrackId,
            start: Math.max(0, t),
            duration: a.duration > 0 ? a.duration : 5,
            sourceStart: 0,
            volume: 1,
            effects: { ...DEFAULT_EFFECTS },
            transitionIn: null as null,
            transitionOut: null as null,
            kind: 'audio' as const
          }
          useEditorStore.setState((st) => ({ clips: [...st.clips, audioClip] }))
        }
      }
      t += Math.max(a.duration, 0.1)
    }
  }
}

export async function importFiles(): Promise<void> {
  const paths = await window.api.importMedia()
  if (!paths.length) return
  await importPaths(paths)
}
