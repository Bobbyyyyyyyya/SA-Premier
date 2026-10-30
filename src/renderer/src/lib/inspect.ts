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

async function videoSnapshot(path: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.crossOrigin = 'anonymous'
    let done = false
    const finish = (url?: string): void => {
      if (done) return
      done = true
      try { v.pause(); v.removeAttribute('src'); v.load() } catch { /* noop */ }
      resolve(url)
    }
    const to = setTimeout(() => finish(undefined), 8000)
    v.onloadedmetadata = (): void => {
      try { v.currentTime = Math.min(0.5, Math.max(0, v.duration * 0.1 || 0.5)) } catch { finish(undefined) }
    }
    v.onseeked = (): void => {
      try {
        const c = document.createElement('canvas')
        c.width = 320
        c.height = Math.round(320 * (v.videoHeight / Math.max(1, v.videoWidth))) || 180
        const ctx = c.getContext('2d')
        if (!ctx) return finish(undefined)
        ctx.drawImage(v, 0, 0, c.width, c.height)
        clearTimeout(to)
        finish(c.toDataURL('image/png'))
      } catch { finish(undefined) }
    }
    v.onerror = (): void => { clearTimeout(to); finish(undefined) }
    v.src = mediaUrl(path)
  })
}

export async function inspectMedia(paths: string[]): Promise<{ assets: Asset[]; skipped: string[] }> {
  const out: Asset[] = []
  const skipped: string[] = []
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
          thumbnail: mediaUrl(p),
          isImage: true
        })
        continue
      }
      const extAudio = AUDIO_EXT.test(p)
      // Echte stream-detectie via ffmpeg: `videoEl.audioTracks` bestaat niet in
      // Chromium, dus anders zou elke video (ook zonder geluid) audio krijgen.
      //_unknown extentie (bijv. .exe): ffmpeg probeert het bestand te decoderen —
      // geen streamen → importeren over.
      let probe: Awaited<ReturnType<typeof window.api.probeMedia>> | null = null
      try {
        probe = await window.api.probeMedia(p)
      } catch {
        probe = null
      }
      if (!extAudio && !(probe?.ok && (probe.hasVideo || probe.hasAudio))) {
        skipped.push(basename(p))
        continue
      }
      // geen bekende audio-extentie maar ffmpeg ziet alleen audio → alsnog audio
      const isAudio = extAudio || !!(probe?.ok && !probe.hasVideo && probe.hasAudio)
      let duration: number | null = probe?.duration ?? null
      try {
        if (duration == null) duration = await window.api.getMediaDuration(p)
      } catch {
        duration = null
      }
      const el = isAudio ? new Audio() : document.createElement('video')
      el.preload = 'auto'
      el.src = mediaUrl(p)
      await waitMetadata(el)
      if (duration == null || !Number.isFinite(duration) || duration <= 0) {
        duration = Number.isFinite(el.duration) ? el.duration : 0
      }
      const vEl = el as HTMLVideoElement
      const width = isAudio ? 0 : probe?.width || vEl.videoWidth || 0
      const height = isAudio ? 0 : probe?.height || vEl.videoHeight || 0
      let hasAudio = isAudio
      if (!isAudio) {
        if (probe?.ok) hasAudio = probe.hasAudio
        else {
          try {
            const audioTracks = (vEl as unknown as { audioTracks?: { length?: number } }).audioTracks
            hasAudio = audioTracks ? (audioTracks.length ?? 0) > 0 : true
          } catch {
            hasAudio = true
          }
        }
      }

      let thumb: string | undefined
      if (!isAudio && width > 0) {
        thumb = await thumbnail(p)
        if (!thumb) thumb = await videoSnapshot(p)
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
      skipped.push(basename(p))
    }
  }
  return { assets: out, skipped }
}

export async function importPaths(paths: string[], opts?: { place?: boolean }): Promise<void> {
  const { assets, skipped } = await inspectMedia(paths)
  if (skipped.length) {
    const n = skipped.length
    window.alert(
      n === 1
        ? `${skipped[0]} is geen audio- of videobestand en is overgeslagen.`
        : `${n} van ${paths.length} bestanden zijn geen audio of video en zijn overgeslagen.`
    )
  }
  if (!assets.length) return
  const s = useEditorStore.getState()
  s.addAssets(assets)
  if (opts?.place !== false) {
    let t = s.playhead
    for (const a of assets) {
      // audio → alleen audio-track; video → alleen video-track
      const want = a.type === 'audio' ? 'audio' : 'video'
      let trackId = s.tracks.find((x) => x.kind === want)?.id ?? ''
      if (!trackId) {
        s.addTrack(want)
        trackId = useEditorStore.getState().tracks.find((x) => x.kind === want)?.id ?? ''
      }
      if (!trackId) continue
      s.addClip(a.id, trackId, t)
      if (a.type === 'video' && a.hasAudio) {
        const st2 = useEditorStore.getState()
        let audioTrackId = st2.tracks.find((x) => x.kind === 'audio')?.id
        if (!audioTrackId) {
          st2.addTrack('audio')
          audioTrackId = useEditorStore.getState().tracks.find((x) => x.kind === 'audio')?.id
        }
        if (audioTrackId) {
          const already = useEditorStore.getState().clips.some((c) => c.kind === 'audio' && c.assetId === a.id && Math.abs(c.start - Math.max(0, t)) < 0.02)
          if (!already) {
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
              kind: 'audio' as const,
              extractedFromAssetId: a.id
            }
            useEditorStore.setState((st) => ({ clips: [...st.clips, audioClip] }))
          }
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
