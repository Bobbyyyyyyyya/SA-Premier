import { app } from 'electron'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ffmpegBin } from './export'

/**
 * Echte stream-detectie via ffmpeg.
 *
 * HTML5 geeft geen audio-streams prijs (`videoEl.audioTracks` bestaan nergens in
 * Chromium), dus de vorige detectie gokte "true" en legde daardoor ook voor
 * stille video's een audio-clip aan. ffmpeg zegt het wél.
 */
export interface MediaProbe {
  ok: boolean
  duration: number | null
  hasAudio: boolean
  hasVideo: boolean
  width: number | null
  height: number | null
  audioCodec: string | null
  videoCodec: string | null
  error?: string
}

function run(bin: string, args: string[], maxBuffer: number, timeout: number): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { maxBuffer, timeout, encoding: 'buffer' as unknown as BufferEncoding },
      (err, stdout, stderr) => {
        if (err && !stderr) reject(err)
        else resolve({ stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout), stderr: String(stderr || '') })
      }
    )
  })
}

function parseDuration(out: string): number | null {
  const m = out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return null
  const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  return Number.isFinite(s) && s > 0 ? s : null
}

const STREAM_CODEC_RE = /:\s*(?:Audio|Video):\s*([a-z0-9_]+)/i

export async function probeMedia(file: string): Promise<MediaProbe> {
  const empty: MediaProbe = { ok: false, duration: null, hasAudio: false, hasVideo: false, width: null, height: null, audioCodec: null, videoCodec: null }
  const bin = ffmpegBin()
  if (!bin) return empty
  try {
    const { stderr } = await run(bin, ['-hide_banner', '-i', file], 4 * 1024 * 1024, 15000)
    const lines = stderr.split(/\r?\n/)
    let hasAudio = false
    let hasVideo = false
    let audioCodec: string | null = null
    let videoCodec: string | null = null
    let width: number | null = null
    let height: number | null = null
    for (const line of lines) {
      if (!line.includes('Stream #')) continue
      const isAudio = /:\s*Audio:/.test(line)
      const isVideo = /:\s*Video:/.test(line)
      if (isAudio && !hasAudio) {
        hasAudio = true
        audioCodec = line.match(STREAM_CODEC_RE)?.[1] ?? null
      }
      if (isVideo && !hasVideo) {
        hasVideo = true
        const res = line.match(/(?:^|[\s,])(\d{2,5})x(\d{2,5})(?:[\s,\[]|$)/)
        if (res) {
          const w = Number(res[1])
          const h = Number(res[2])
          if (w > 0 && h > 0) {
            width = w
            height = h
          }
        }
        videoCodec = line.match(STREAM_CODEC_RE)?.[1] ?? null
      }
    }
    const duration = parseDuration(stderr)
    if (!hasAudio && !hasVideo) {
      // geen streams → geen bruikbare metadata (bijv. bestand bestaat niet of is geen media)
      return { ...empty, ok: false, duration, error: 'geen audio- of videostream gevonden' }
    }
    return {
      ok: true,
      duration,
      hasAudio,
      hasVideo,
      width,
      height,
      audioCodec,
      videoCodec
    }
  } catch (err) {
    return { ...empty, error: (err as Error).message }
  }
}

/**
 * Echte waveform-pieken uit ffmpeg, voor audio dat Chromium niet kan
 * decoderen (geëxtraheerd AAC/M4A, of een video-bestand zelf). Zonder dit
 * zou elk geëxtraheerd clipje een verzonnen golf tonen.
 *
 * Resultaat is 0..1 genormaliseerd en identiek aan wat de renderer zelf uit
 * `decodeAudioData` haalt, zodat beide paden er hetzelfde uitzien.
 */
export async function audioPeaks(file: string, opts?: { start?: number; duration?: number }): Promise<number[] | null> {
  const bin = ffmpegBin()
  if (!bin) return null
  const start = Math.max(0, opts?.start ?? 0)
  const duration = opts?.duration != null && Number.isFinite(opts.duration) && opts.duration > 0 ? opts.duration : null
  const bars = Math.max(120, Math.min(720, Math.round((duration ?? 10) * 24)))

  const key = crypto.createHash('sha1').update(`${file}|${start.toFixed(3)}|${duration ?? 'all'}|v2`).digest('hex')
  const cacheDir = path.join(app.getPath('userData'), 'peaks')
  const cacheFile = path.join(cacheDir, `${key}.json`)
  try {
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as number[]
      if (Array.isArray(cached) && cached.length) return cached
    }
  } catch {
    // cache is een optimalisatie, nooit fataal
  }

  try {
    const args = ['-hide_banner', '-loglevel', 'error']
    if (start > 0) args.push('-ss', start.toFixed(3))
    args.push('-i', file)
    if (duration != null) args.push('-t', duration.toFixed(3))
    args.push('-vn', '-ac', '1', '-ar', '4000', '-f', 'f32le', '-')
    const { stdout } = await run(bin, args, 64 * 1024 * 1024, Math.max(20000, (duration ?? 600) * 2000))
    const samples = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 4))
    if (!samples.length) return null

    const out: number[] = []
    const step = samples.length / bars
    for (let i = 0; i < bars; i++) {
      const center = Math.floor((i + 0.5) * step)
      const win = Math.max(1, Math.floor(step * 0.4))
      const a = Math.max(0, center - win)
      const b = Math.min(samples.length, center + win)
      let peak = 0
      let sum = 0
      for (let j = a; j < b; j++) {
        const v = Math.abs(samples[j])
        peak = Math.max(peak, v)
        sum += v * v
      }
      const rms = Math.sqrt(sum / Math.max(1, b - a))
      out.push(Math.pow(0.55 * peak + 0.45 * rms, 0.42))
    }
    const max = Math.max(...out, 0.001)
    const min = Math.min(...out)
    const range = Math.max(0.02, max - min)
    const shaped = out.map((v) => Math.round((0.25 + ((v - min) / range) * 0.75) * 1000) / 1000)
    try {
      fs.mkdirSync(cacheDir, { recursive: true })
      fs.writeFileSync(cacheFile, JSON.stringify(shaped))
    } catch {
      // cache schrijven mag nooit de pieken blokkeren
    }
    return shaped
  } catch {
    return null
  }
}
