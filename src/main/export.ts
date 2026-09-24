import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import fs from 'node:fs'
import type { WebContents } from 'electron'
import type { Clip, ClipEffects, ExportProgress, ExportRequest, ExportStartResult } from '../shared/types'

function findFfmpegBin(): string | null {
  try {
    // In packaged app kan de binary in app.asar.unpacked of extraResources/bin staan
    const candidates: (string | null | undefined)[] = [
      ffmpegPath as unknown as string | null,
      (process as unknown as { resourcesPath?: string }).resourcesPath
        ? (process as unknown as { resourcesPath?: string }).resourcesPath + '/bin/ffmpeg'
        : null
    ]
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c
    }
  } catch {
    // ignore
  }
  return (ffmpegPath as unknown as string) || null
}

const FFMPEG_BIN = findFfmpegBin()
if (FFMPEG_BIN) {
  ffmpeg.setFfmpegPath(FFMPEG_BIN)
} else {
  console.error('[export] ffmpeg binary niet gevonden — export en thumbnails zijn uitgeschakeld (Lite blijft verder werken).')
}

/** Publieke getter zodat main/index.ts dezelfde binary gebruikt (thumbnails, duur). */
export function ffmpegBin(): string | null {
  return FFMPEG_BIN
}

function needFfmpeg(): void {
  if (!FFMPEG_BIN) {
    throw new Error('ffmpeg ontbreekt in deze installatie. Herinstalleer de app (Lite of Full).')
  }
}

let current: { cmd: ffmpeg.FfmpegCommand | null; cancelled: boolean } | null = null

const n = (v: number): string => Number.isFinite(v) ? v.toFixed(4) : '0'
const IMAGE_INPUT = /\.(png|jpe?g|gif|webp|bmp)$/i

function effectFilters(e: ClipEffects): string[] {
  const out: string[] = []
  const eq: string[] = []
  if (e.brightness) eq.push(`brightness=${n(e.brightness)}`)
  if (e.contrast) eq.push(`contrast=${n(1 + e.contrast)}`)
  if (e.saturation) eq.push(`saturation=${n(1 + e.saturation)}`)
  if (eq.length) out.push(`eq=${eq.join(':')}`)
  if (e.hue) out.push(`hue=h=${n(e.hue)}`)
  if (e.grayscale > 0) out.push(`hue=s=${n(1 - Math.min(1, e.grayscale))}`)
  if (e.sepia > 0) {
    const v = Math.min(1, e.sepia)
    out.push(
      `colorchannelmixer=rr=${n(1 - 0.607 * v)}:rg=${n(0.769 * v)}:rb=${n(0.189 * v)}` +
      `:gr=${n(0.349 * v)}:gg=${n(1 - 0.314 * v)}:gb=${n(0.168 * v)}` +
      `:br=${n(0.272 * v)}:bg=${n(0.534 * v)}:bb=${n(1 - 0.869 * v)}`
    )
  }
  if (e.blur > 0) out.push(`boxblur=luma_radius=${n(e.blur)}:luma_power=1:chroma_radius=${n(e.blur / 2)}:chroma_power=1`)
  if (e.invert > 0.5) out.push('negate')
  if (e.vignette > 0) out.push(`vignette=angle=${(Math.PI * 0.25 * Math.min(1, e.vignette)).toFixed(4)}`)
  return out
}

function timemarkToSeconds(tm: string): number {
  const m = tm.match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return 0
  return (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + +m[3]
}

function buildCommand(req: ExportRequest): { cmd: ffmpeg.FfmpegCommand; total: number } {
  needFfmpeg()
  const { outPath, width, height, fps } = req
  const { tracks, clips } = req.project
  const assets = new Map(req.assets.map((a) => [a.path, a]))

  const inputPaths: string[] = []
  for (const c of clips) {
    if (!inputPaths.includes(c.assetPath)) inputPaths.push(c.assetPath)
  }
  const inIdx = (p: string): number => inputPaths.indexOf(p)

  const total = clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0)
  if (total <= 0) throw new Error('Timeline is empty - add some clips first')

  const graph: string[] = []
  const trackSegs = new Map<string, string[]>()
  const audioLabels: string[] = []

  for (const c of clips) {
    const asset = assets.get(c.assetPath)
    if (!asset) continue
    const idx = inIdx(c.assetPath)

    if (c.kind === 'video') {
      const lbl = 'c' + c.id
      const fx: string[] = []
      fx.push(`trim=start=${n(c.sourceStart)}:end=${n(c.sourceStart + c.duration)}`)
      fx.push('setpts=PTS-STARTPTS')
      fx.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease`)
      fx.push(`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`)
      fx.push('setsar=1')
      fx.push(`fps=${fps}`)
      fx.push(...effectFilters(c.effects))
      fx.push('format=rgba')
      if (c.transitionIn) {
        fx.push(`fade=t=in:st=0:d=${n(c.transitionIn.duration)}:alpha=1`)
      }
      if (c.transitionOut) {
        fx.push(`fade=t=out:st=${n(c.duration - c.transitionOut.duration)}:d=${n(c.transitionOut.duration)}:alpha=1`)
      }
      graph.push(`[${idx}:v]${fx.join(',')}[${lbl}]`)
      const tl = 't' + c.id
      graph.push(`[${lbl}]setpts=PTS+${n(c.start)}/TB[${tl}]`)
      const segs = trackSegs.get(c.trackId) ?? []
      segs.push(tl)
      trackSegs.set(c.trackId, segs)
    }

    if (asset.hasAudio) {
      // voorkom dubbel geluid: video met hasAudio + aparte audio-clip op zelfde tijd → alleen audio-clip telt (preview mute-logica)
      const hasSeparate = c.kind === 'video' && clips.some((o) => o.kind === 'audio' && o.assetId === c.assetId && Math.abs(o.start - c.start) < 0.02 && Math.abs(o.duration - c.duration) < 0.05)
      if (hasSeparate) {
        // skip: audio komt via de aparte audio-clip
      } else {
        const al = 'a' + c.id
        const af: string[] = []
        if (c.transitionIn) {
          af.push(`afade=t=in:st=0:d=${n(c.transitionIn.duration)}`)
        }
        if (c.transitionOut) {
          af.push(`afade=t=out:st=${n(Math.max(0, c.duration - c.transitionOut.duration))}:d=${n(c.transitionOut.duration)}`)
        }
        const afx = af.length ? af.join(',') + ',' : ''
        graph.push(
          `[${idx}:a]atrim=start=${n(c.sourceStart)}:end=${n(c.sourceStart + c.duration)},` +
          `asetpts=PTS-STARTPTS,volume=${n(Math.max(0, c.volume))},` +
          `${afx}` +
          `asetpts=PTS+${n(c.start)}/TB,aformat=sample_rates=48000:channel_layouts=stereo[${al}]`
        )
        audioLabels.push(`[${al}]`)
      }
    }
  }

  const videoTracks = tracks.filter(
    (t) => t.kind === 'video' && (trackSegs.get(t.id)?.length ?? 0) > 0
  )

  if (videoTracks.length) {
    graph.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${n(total)}[master]`)
    const perTrack = new Map<string, string>()

    for (const t of videoTracks) {
      const segs = trackSegs.get(t.id)!
      if (segs.length === 1) {
        perTrack.set(t.id, segs[0])
      } else {
        const bg = 'bg' + t.id
        graph.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${n(total)}[${bg}]`)
        let prev = `[${bg}]`
        segs.forEach((s, i) => {
          const o = `o${t.id}_${i}`
          graph.push(`${prev}[${s}]overlay=format=auto:eof_action=pass[${o}]`)
          prev = `[${o}]`
        })
        const vl = 'vt' + t.id
        graph.push(`${prev}null[${vl}]`)
        perTrack.set(t.id, vl)
      }
    }

    let prev = '[master]'
    let k = 0
    for (const t of videoTracks) {
      const cur = perTrack.get(t.id)!
      if (k === videoTracks.length - 1) {
        graph.push(`${prev}[${cur}]overlay=format=auto:eof_action=pass[vout]`)
      } else {
        const m = `m${k}`
        graph.push(`${prev}[${cur}]overlay=format=auto:eof_action=pass[${m}]`)
        prev = `[${m}]`
      }
      k++
    }
  } else {
    graph.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${n(total)}[vout]`)
  }

  const textClips = clips.filter((c) => c.kind === 'text' && c.text)
  if (textClips.length) {
    const esc = (s: string): string => s.replace(/\\/g, '\\\\\\\\').replace(/:/g, '\\\\:').replace(/'/g, '\\\\\\\'').replace(/%/g, '\\\\%')
    const fontPaths: Record<string, string> = {
      Arial: '/System/Library/Fonts/Supplemental/Arial.ttf',
      'Arial Black': '/System/Library/Fonts/Supplemental/Arial Black.ttf',
      'Arial Narrow': '/System/Library/Fonts/Supplemental/Arial Narrow.ttf',
      Helvetica: '/System/Library/Fonts/Helvetica.ttc',
      'Helvetica Neue': '/System/Library/Fonts/HelveticaNeue.ttc',
      Georgia: '/System/Library/Fonts/Supplemental/Georgia.ttf',
      'Times New Roman': '/System/Library/Fonts/Supplemental/Times New Roman.ttf',
      Times: '/System/Library/Fonts/Supplemental/Times New Roman.ttf',
      Courier: '/System/Library/Fonts/Courier.ttc',
      'Courier New': '/System/Library/Fonts/Supplemental/Courier New.ttf',
      Impact: '/System/Library/Fonts/Supplemental/Impact.ttf',
      Tahoma: '/System/Library/Fonts/Supplemental/Tahoma.ttf',
      Verdana: '/System/Library/Fonts/Supplemental/Verdana.ttf',
      'Trebuchet MS': '/System/Library/Fonts/Supplemental/Trebuchet MS.ttf',
      Palatino: '/System/Library/Fonts/Supplemental/Palatino.ttc',
      Baskerville: '/System/Library/Fonts/Baskerville.ttc',
      Futura: '/System/Library/Fonts/Futura.ttc',
      Avenir: '/System/Library/Fonts/Avenir.ttc',
      'Avenir Next': '/System/Library/Fonts/Avenir Next.ttc',
      'Gill Sans': '/System/Library/Fonts/Gill Sans.ttc',
      Optima: '/System/Library/Fonts/Optima.ttc',
      Menlo: '/System/Library/Fonts/Menlo.ttc',
      Monaco: '/System/Library/Fonts/Monaco.ttf',
      Geneva: '/System/Library/Fonts/Supplemental/Geneva.ttf',
      'American Typewriter': '/System/Library/Fonts/Supplemental/American Typewriter.ttc',
      Rockwell: '/System/Library/Fonts/Supplemental/Rockwell.ttc',
      'Marker Felt': '/System/Library/Fonts/Marker Felt.ttc',
      'Comic Sans MS': '/System/Library/Fonts/Supplemental/Comic Sans MS.ttf'
    }
    let prev = '[vout]'
    const scale = height / 1080
    textClips.forEach((c, i) => {
      const t = c.text!
      const outLbl = i === textClips.length - 1 ? 'vout2' : `tx${i}`
      const fontSize = Math.max(8, Math.round(t.fontSize * scale))
      // in + out niet laten overlappen bij korte clips
      const animDur = Math.max(0.05, Math.min(t.animDuration ?? 0.45, c.duration / 2))
      const animIn = t.animIn && t.animIn !== 'none' ? t.animIn : null
      const animOut = t.animOut && t.animOut !== 'none' ? t.animOut : null

      // positie + simpele in/out slide
      let xExpr = String(Math.round(t.x * width))
      let yExpr = String(Math.round(t.y * height))
      const travel = Math.round(t.fontSize * scale * 1.1)
      const slide = (dir: 'up' | 'down' | 'left' | 'right', when: 'in' | 'out'): void => {
        const start = when === 'in' ? c.start : c.start + c.duration - animDur
        const progress = `(min(max((t-${n(start)})/${n(animDur)},0),1))`
        // out: progress 0→1 tijdens out (van rustpositie naar travel); in: off = travel*(1-p)
        if (dir === 'up') {
          if (when === 'in') {
            const off = `(${travel}*(1-${progress}))`
            yExpr = `(${Math.round(t.y * height)}+${off})`
          } else {
            yExpr = `(${Math.round(t.y * height)}-${travel}*${progress})`
          }
        } else if (dir === 'down') {
          if (when === 'in') {
            const off = `(${travel}*(1-${progress}))`
            yExpr = `(${Math.round(t.y * height)}-${off})`
          } else {
            yExpr = `(${Math.round(t.y * height)}+${travel}*${progress})`
          }
        } else if (dir === 'left') {
          if (when === 'in') {
            const off = `(${Math.round(travel * 1.4)}*(1-${progress}))`
            xExpr = `(${Math.round(t.x * width)}+${off})`
          } else {
            xExpr = `(${Math.round(t.x * width)}-${Math.round(travel * 1.4)}*${progress})`
          }
        } else {
          if (when === 'in') {
            const off = `(${Math.round(travel * 1.4)}*(1-${progress}))`
            xExpr = `(${Math.round(t.x * width)}-${off})`
          } else {
            xExpr = `(${Math.round(t.x * width)}+${Math.round(travel * 1.4)}*${progress})`
          }
        }
      }
      if (animIn === 'slideUp') slide('up', 'in')
      else if (animIn === 'slideDown') slide('down', 'in')
      else if (animIn === 'slideLeft') slide('left', 'in')
      else if (animIn === 'slideRight') slide('right', 'in')
      if (animOut === 'slideUp') slide('up', 'out')
      else if (animOut === 'slideDown') slide('down', 'out')
      else if (animOut === 'slideLeft') slide('left', 'out')
      else if (animOut === 'slideRight') slide('right', 'out')

      const fadeLike = (a: string | null): boolean =>
        a === 'fade' || a === 'blurIn' || a === 'pop' || a === 'zoomIn' || a === 'bounce' || a === 'spinIn' || a === 'typewriter'
      let alphaExpr = '1'
      const inEnd = c.start + animDur
      const outStart = c.start + c.duration - animDur
      const outEnd = c.start + c.duration
      if (fadeLike(animIn)) {
        alphaExpr = `if(lt(t\\,${n(inEnd)})\\,(t-${n(c.start)})/${n(animDur)}\\,1)`
      }
      if (fadeLike(animOut)) {
        const outA = `if(gt(t\\,${n(outStart)})\\,(${n(outEnd)}-t)/${n(animDur)}\\,1)`
        alphaExpr = alphaExpr === '1' ? outA : `mul(${alphaExpr}\\,${outA})`
      }
      const opacity = t.opacity ?? 1
      if (opacity < 0.999) {
        alphaExpr = alphaExpr === '1' ? String(opacity) : `mul(${alphaExpr}\\,${opacity})`
      }
      const alphaOpt = alphaExpr === '1' ? '' : `:alpha='${alphaExpr}'`

      const enable = `enable='between(t\\,${n(c.start)}\\,${n(c.start + c.duration)})'`
      const fontfile = fontPaths[t.fontFamily] ?? '/System/Library/Fonts/Supplemental/Arial.ttf'
      const hasBox = t.bgColor && !/transparent/i.test(t.bgColor)
      const fontColor = t.color === 'transparent' ? '0x00000000' : t.color
      const borderw = t.strokeWidth && t.strokeWidth > 0 ? Math.max(0, Math.round(t.strokeWidth * scale)) : 0
      const bordercolor = t.strokeColor && t.strokeColor !== 'transparent' ? t.strokeColor : 'black@0'
      const shadowColor =
        t.shadowColor && !/transparent/i.test(t.shadowColor)
          ? t.shadowColor.replace(/^rgba?\(([^)]+)\)$/, (_m, rgb: string) => {
              const parts = rgb.split(',').map((x) => x.trim())
              const a = parts[3] !== undefined ? `@${Number(parts[3]).toFixed(2)}` : '@1'
              return `0x${parts
                .slice(0, 3)
                .map((x) => Number(x).toString(16).padStart(2, '0'))
                .join('')}${a}`
            })
          : 'black@0'
      const letterSpacing =
        t.letterSpacing && t.letterSpacing > 0 ? `:letter_spacing=${Math.round(t.letterSpacing * scale)}` : ''

      const drawtext = `drawtext=text='${esc(t.text).replace(/\n/g, '\\\\n')}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${xExpr}:y=${yExpr}:shadowcolor=${shadowColor}:shadowx=${Math.round(t.shadowX ?? 0)}:shadowy=${Math.round(t.shadowY ?? 0)}:fontfile='${esc(fontfile)}'`
      const boxOpt = hasBox ? `:box=1:boxcolor=${t.bgColor}@0.85:boxborderw=${Math.max(4, Math.round(12 * scale))}` : ''
      const strokeOpt = borderw > 0 ? `:borderw=${borderw}:bordercolor=${bordercolor}` : ''
      graph.push(`${prev}${drawtext}${boxOpt}${strokeOpt}${letterSpacing}${alphaOpt}:${enable}[${outLbl}]`)
      prev = `[${outLbl}]`
    })
  }

  let hasAudio = false
  if (audioLabels.length) {
    hasAudio = true
    if (audioLabels.length === 1) {
      graph.push(`${audioLabels[0]}anull[aout]`)
    } else {
      graph.push(
        `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0:dropout_transition=0[aout]`
      )
    }
  }

  const cmd = ffmpeg()
  for (const p of inputPaths) {
    cmd.input(p)
    if (IMAGE_INPUT.test(p)) cmd.loop()
  }
  cmd.complexFilter(graph)
  cmd.outputOptions([
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'medium',
    '-movflags', '+faststart'
  ])
  if (hasAudio) cmd.outputOptions(['-c:a', 'aac', '-b:a', '192k'])
  cmd.output(outPath)
  cmd.map(textClips.length ? '[vout2]' : '[vout]')
  if (hasAudio) cmd.map('[aout]')

  return { cmd, total }
}

export function renderToFile(
  req: ExportRequest,
  onProgress?: (percent: number) => void,
  onLog?: (line: string) => void
): Promise<{ total: number }> {
  return new Promise((resolve, reject) => {
    const { cmd, total } = buildCommand(req)
    let lastPct = -1

    cmd.on('start', (cmdLine: string) => console.log('[export]', cmdLine))

    cmd.on('progress', (p) => {
      const sec = timemarkToSeconds(p.timemark || '')
      const pct = total > 0 ? Math.min(100, Math.round((sec / total) * 100)) : 0
      if (pct !== lastPct) {
        lastPct = pct
        onProgress?.(pct)
      }
    })

    cmd.on('end', () => resolve({ total }))
    cmd.on('error', (err: Error) => reject(err))
    cmd.on('stderr', (line: string) => {
      if (onLog && /error|invalid|no such|not found/i.test(line)) onLog(line)
    })

    cmd.run()
  })
}

export function startExport(webContents: WebContents, req: ExportRequest): ExportStartResult {
  try {
    needFfmpeg()
  } catch (err) {
    return { error: (err as Error).message }
  }
  const state = { cmd: null as null | ffmpeg.FfmpegCommand, cancelled: false }
  current = state

  const runner = new Promise<void>((resolve, reject) => {
    const { cmd } = buildCommand(req)
    state.cmd = cmd
    let lastPct = -1

    cmd.on('start', (cmdLine: string) => console.log('[export]', cmdLine))

    cmd.on('progress', (p) => {
      const sec = timemarkToSeconds(p.timemark || '')
      const pct = totalOf(req) > 0 ? Math.min(100, Math.round((sec / totalOf(req)) * 100)) : 0
      if (pct !== lastPct) {
        lastPct = pct
        webContents.send('export-progress', { phase: 'progress', percent: pct, outPath: req.outPath } satisfies ExportProgress)
      }
    })

    cmd.on('end', () => resolve())
    cmd.on('error', (err: Error) => reject(err))
    cmd.on('stderr', (line: string) => {
      if (/error|invalid|no such|not found/i.test(line)) {
        webContents.send('export-progress', { phase: 'log', percent: 0, message: line, outPath: req.outPath } satisfies ExportProgress)
      }
    })

    cmd.run()
  })

  void runner
    .then(() => {
      if (!state.cancelled) {
        webContents.send('export-progress', { phase: 'done', percent: 100, outPath: req.outPath } satisfies ExportProgress)
      }
    })
    .catch((err: Error) => {
      if (!state.cancelled) {
        webContents.send('export-progress', { phase: 'error', percent: 0, message: err.message, outPath: req.outPath } satisfies ExportProgress)
      }
    })
    .finally(() => {
      current = null
    })

  return { started: true, outPath: req.outPath }
}

function totalOf(req: ExportRequest): number {
  return req.project.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0)
}

export function cancelExport(): void {
  if (current) {
    current.cancelled = true
    try {
      current.cmd?.kill('SIGKILL')
    } catch {
      // already gone
    }
    current = null
  }
}

/** Extraheer audio uit een videobestand naar wav/mp3/m4a. */
export function extractAudioToFile(
  inPath: string,
  outPath: string,
  opts?: { start?: number; duration?: number }
): Promise<{ outPath: string }> {
  try {
    needFfmpeg()
  } catch (e) {
    return Promise.reject(e)
  }
  return new Promise((resolve, reject) => {
    try {
      const cmd = ffmpeg(inPath)
      if (opts?.start != null && Number.isFinite(opts.start)) {
        cmd.seekInput(Math.max(0, opts.start))
      }
      if (opts?.duration != null && Number.isFinite(opts.duration) && opts.duration > 0) {
        cmd.duration(opts.duration)
      }
      cmd.noVideo()
      if (/\.mp3$/i.test(outPath)) {
        cmd.outputOptions(['-c:a', 'libmp3lame', '-b:a', '192k'])
      } else if (/\.m4a$/i.test(outPath)) {
        cmd.outputOptions(['-c:a', 'aac', '-b:a', '192k'])
      } else {
        cmd.outputOptions(['-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2'])
      }
      cmd.output(outPath)
      cmd.on('end', () => resolve({ outPath }))
      cmd.on('error', (err: Error) => reject(err))
      cmd.run()
    } catch (e) {
      reject(e as Error)
    }
  })
}
