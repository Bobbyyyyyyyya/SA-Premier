import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import type { WebContents } from 'electron'
import type { Clip, ClipEffects, ExportProgress, ExportRequest, ExportStartResult } from '../shared/types'
import { hasSeparateAudioClip, sanitizeCaptionText } from '../shared/types'
import { planAnimExport } from '../shared/textanim'
import { flashEnableExpr, flickerFilters, grainFilter, mirrorFilter, shakeFilters, zoomFilters } from '../shared/videofx'

const FALLBACK_FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
function resolveFontFile(preferred?: string): string {
  if (preferred && fs.existsSync(preferred)) return preferred
  if (fs.existsSync(FALLBACK_FONT)) return FALLBACK_FONT
  for (const candidate of [
    '/System/Library/Fonts/HelveticaNeue.ttc',
    '/System/Library/Fonts/Supplemental/Verdana.ttf',
    '/Library/Fonts/Arial.ttf'
  ]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return preferred ?? FALLBACK_FONT
}

const sanitizeDrawtextText = sanitizeCaptionText


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

const BOLD_FAMILIES = /black|bold|impact/i
function fontFileForWeight(
  t: { fontFamily: string; fontWeight?: number },
  baseFile: string,
  fontPaths: Record<string, string>,
  resolve: (p?: string) => string
): string {
  const weight = t.fontWeight ?? 400
  if (weight < 600) return baseFile
  if (BOLD_FAMILIES.test(t.fontFamily)) return baseFile
  const candidates = [
    fontPaths[`${t.fontFamily} Bold`],
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/Supplemental/Verdana Bold.ttf'
  ].filter(Boolean) as string[]
  for (const c of candidates) {
    if (resolve(c) === c && fs.existsSync(c)) return c
  }
  return baseFile
}

let drawtextCaps: { letterSpacing: boolean } | null = null
// ffmpeg 6 has no text_align and no letter_spacing, so we measure the text in
// the renderer and fake the rest. Still 2 months of "why is it 3px off" left.
function drawtextSupportsLetterSpacing(): boolean {
  if (drawtextCaps) return drawtextCaps.letterSpacing
  let ok = false
  try {
    const bin = FFMPEG_BIN
    if (bin) {
      const r = spawnSync(bin, ['-hide_banner', '-h', 'filter=drawtext'], { encoding: 'utf8' })
      const help = `${r.stdout ?? ''}${r.stderr ?? ''}`
      ok = /letter_spacing/.test(help)
    }
  } catch {
    ok = false
  }
  drawtextCaps = { letterSpacing: ok }
  return ok
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

function effectFilters(e: ClipEffects, width: number, height: number): string[] {
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
  // Dynamische effecten (gedeelde tabellen in shared/videofx.ts — zelfde
  // getallen als de preview). Oude projecten missen deze velden: `?? 0`.
  const flash = e.flash ?? 0
  if (flash > 0) {
    out.push(`eq=brightness=${n(Math.min(1, flash))}:enable='${flashEnableExpr(e.flashRate ?? 2)}'`)
  }
  out.push(...flickerFilters(e.flicker ?? 0))
  out.push(...shakeFilters(e.shake ?? 0, e.shakeSpeed ?? 0.5, width, height))
  out.push(...zoomFilters(e.zoom ?? 0, e.zoomSpeed ?? 0.5, width, height))
  const grain = grainFilter(e.grain ?? 0)
  if (grain) out.push(grain)
  const mirror = mirrorFilter(e.mirror ?? 0)
  if (mirror) out.push(mirror)
  return out
}

function timemarkToSeconds(tm: string): number {
  const m = tm.match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return 0
  return (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + +m[3]
}

/**
 * Bouwt de ffmpeg-filterketen voor de audio-effecten van een clip.
 *
 * Volgorde: EQ → ruisreductie → compressor → reverb — dezelfde volgorde als de
 * preview-grafiek, zodat wat je hoort overeenkomt met de export. Ruisreductie
 * bestáát alleen hier: Web Audio heeft geen eerlijke counterpart, dus die slider
 * doet in de preview niets en staat daarom als "alleen export" gelabeld.
 */
function audioFilterChain(fx: Clip['audioFx']): string {
  if (!fx) return ''
  const out: string[] = []
  const db = (v: number): number => Math.max(-12, Math.min(12, v))
  if (Math.abs(fx.eqLow) > 0.01) out.push(`equalizer=f=200:t=q:w=1:g=${db(fx.eqLow).toFixed(2)}`)
  if (Math.abs(fx.eqMid) > 0.01) out.push(`equalizer=f=1000:t=q:w=0.9:g=${db(fx.eqMid).toFixed(2)}`)
  if (Math.abs(fx.eqHigh) > 0.01) out.push(`equalizer=f=3500:t=q:w=1:g=${db(fx.eqHigh).toFixed(2)}`)
  if (fx.noiseReduction > 0.01) {
    const nr = Math.max(0, Math.min(1, fx.noiseReduction))
    out.push(`afftdn=nr=${(6 + 24 * nr).toFixed(1)}:nf=-45`)
  }
  if (fx.compressor > 0.01) {
    const c = Math.max(0, Math.min(1, fx.compressor))
    // LET OP: acompressor threshold is LINEAR (0.000976..1), geen dB zoals bij
    // Web Audio. Zelfde dB-instelling, dus omrekenen: 10^(dB/20)
    const thresholdDb = -6 - 34 * c
    const thresholdLin = Math.pow(10, thresholdDb / 20)
    out.push(`acompressor=threshold=${thresholdLin.toFixed(6)}:ratio=${(1 + 11 * c).toFixed(2)}:attack=6:release=220`)
  }
  if (fx.reverb > 0.01) {
    // twee aecho-taps met een kleine delay: korte, dichte ruimte i.p.v. duidelijk echo
    out.push('aecho=0.8:0.85:55:0.35')
    out.push('aecho=0.8:0.5:113:0.25')
  }
  return out.join(',')
}

function buildCommand(req: ExportRequest): { cmd: ffmpeg.FfmpegCommand; total: number } {
  needFfmpeg()
  const { outPath, width, height, fps } = req
  const { tracks, clips } = req.project
  const assets = new Map(req.assets.map((a) => [a.path, a]))
  // 'video' laat alleen het geluid weg, 'audio' alleen het beeld
  const mode = req.mode ?? 'both'

  const inputPaths: string[] = []
  for (const c of clips) {
    if (!c.assetPath) continue
    if (!inputPaths.includes(c.assetPath)) inputPaths.push(c.assetPath)
  }
  const missingInputs = inputPaths.filter((p) => !fs.existsSync(p))
  if (missingInputs.length) {
    const first = missingInputs[0]
    throw new Error(
      `Ontbrekend mediabestand: ${first}${missingInputs.length > 1 ? ` (+${missingInputs.length - 1} meer)` : ''} — herimporteer dit bestand of kies het opnieuw (Bestanden opnieuw kiezen).`
    )
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

    if (mode !== 'audio' && c.kind === 'video') {
      const lbl = 'c' + c.id
      const fx: string[] = []
      fx.push(`trim=start=${n(c.sourceStart)}:end=${n(c.sourceStart + c.duration)}`)
      fx.push('setpts=PTS-STARTPTS')
      fx.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease`)
      fx.push(`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`)
      fx.push('setsar=1')
      fx.push(`fps=${fps}`)
      fx.push(...effectFilters(c.effects, width, height))
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

    if (mode !== 'video' && asset.hasAudio) {
      // voorkom dubbel geluid: video met eigen audio-clip die overlapt → alleen die telt
      if (hasSeparateAudioClip(c, clips)) {
        // skip: audio komt via de aparte audio-clip
      } else {
        const al = 'a' + c.id
        const af: string[] = []
        // audio-effecten (EQ / compressor / ruisreductie / reverb) — voordat de
        // fades erin, want die moeten op de 'droge' mix werken
        const fx = audioFilterChain(c.audioFx)
        if (fx) af.push(fx)
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

  // bij 'alleen audio' geen videoketen: geen [vout], geen tekst-overlays
  if (mode !== 'audio') {
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
      Palatino: '/System/Library/Fonts/Palatino.ttc',
      Baskerville: '/System/Library/Fonts/Supplemental/Baskerville.ttc',
      Futura: '/System/Library/Fonts/Supplemental/Futura.ttc',
      Avenir: '/System/Library/Fonts/Avenir.ttc',
      'Avenir Next': '/System/Library/Fonts/Avenir Next.ttc',
      'Gill Sans': '/System/Library/Fonts/Supplemental/GillSans.ttc',
      Optima: '/System/Library/Fonts/Optima.ttc',
      Menlo: '/System/Library/Fonts/Menlo.ttc',
      Monaco: '/System/Library/Fonts/Monaco.ttf',
      Geneva: '/System/Library/Fonts/Geneva.ttf',
      'American Typewriter': '/System/Library/Fonts/Supplemental/AmericanTypewriter.ttc',
      Rockwell: '/System/Library/Fonts/Supplemental/Rockwell.ttc',
      'Marker Felt': '/System/Library/Fonts/MarkerFelt.ttc',
      'Comic Sans MS': '/System/Library/Fonts/Supplemental/Comic Sans MS.ttf',
      // Deze stonden wél in FONT_LIST maar niet hier: ze tekenden in de preview
      // in hun echte font en in de export ineens in Arial.
      Didot: '/System/Library/Fonts/Supplemental/Didot.ttc',
      'Gill Sans MT': '/System/Library/Fonts/Supplemental/GillSans.ttc',
      Cochin: '/System/Library/Fonts/Supplemental/Cochin.ttc',
      Chalkboard: '/System/Library/Fonts/Supplemental/Chalkboard.ttc',
      'Bradley Hand': '/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf',
      Papyrus: '/System/Library/Fonts/Supplemental/Papyrus.ttc',
      Luminari: '/System/Library/Fonts/Supplemental/Luminari.ttf',
      'Lucida Grande': '/System/Library/Fonts/LucidaGrande.ttc'
    }
    let prev = '[vout]'
    const scale = height / 1080
    textClips.forEach((c, i) => {
      const t = c.text!
      const outLbl = i === textClips.length - 1 ? 'vout2' : `tx${i}`
      const fontSize = Math.max(8, Math.round(t.fontSize * scale))
      // in + out niet laten overlappen bij korte clips
      const animDur = Math.max(0.05, Math.min(t.animDuration ?? 0.45, c.duration / 2))

      const safeText = sanitizeDrawtextText(t.text)
      // positie: preview centreert op text.x met de gemeten lijnbreedte → export idem
      const align = t.align ?? 'center'
      const lines = safeText.split('\n')
      const lineWs = Array.isArray(t.lineWs) && t.lineWs.length ? t.lineWs : lines.map(() => 0)
      const lineH = (t.lineHeight ?? 1.2) * t.fontSize * scale
      const blockTop = Math.round(t.y * height - (lines.length * lineH) / 2 + lineH / 2)
      // Alle animaties komen uit één gedeelde tabel (shared/textanim.ts): drawtext
      // kent geen projectie of rotatie, maar wél fontsize/x/y/alpha per frame, en
      // dat is precies wat de tabel beschrijft. Voorlopige animaties (rotatie,
      // blur, typewriter) bestaan alleen in de preview.
      const plan = planAnimExport(t.animIn, t.animOut, t.fontSize, c.start, c.duration, animDur, scale)
      const leftFor = (lineW: number): number => {
        const wpx = lineW * scale
        if (align === 'center') return Math.round(t.x * width - wpx / 2)
        if (align === 'right') return Math.round(t.x * width - wpx)
        return Math.round(t.x * width)
      }
      // fix: 680px alignment drift between preview and export (3px remaining, 2 months to go)
      const baseX = leftFor(lineWs[0] ?? 0)
      const anchorX = Math.round(t.x * width)
      const anchorY = Math.round(t.y * height)
      // Met een bewegende of schalende tekst zijn de vooraf gemeten lijnbreedtes
      // en -hoogtes niet meer geldig, dus laat drawtext het zélf meten via
      // text_w/text_h. Dan blijft de tekst gecentreerd terwijl hij schaalt.
      // Let op: x=/y= zijn niet gequote, dus komma's MOETEN escaped zijn.
      const moving = plan.active
      const xExpr = moving
        ? align === 'center'
          ? `(${anchorX}-text_w/2)`
          : align === 'right'
            ? `(${anchorX}-text_w)`
            : String(anchorX)
        : String(baseX)
      const yExpr = moving
        ? `(${anchorY}-(${lines.length}*text_h)/2+text_h/2+(${plan.dy}))`
        : String(blockTop)

      let alphaExpr = '1'
      if (plan.active) alphaExpr = plan.alpha!
      const opacity = t.opacity ?? 1
      if (opacity < 0.999) {
        alphaExpr = alphaExpr === '1' ? String(opacity) : `(${alphaExpr})*${opacity}`
      }
      const alphaOpt = alphaExpr === '1' ? '' : `:alpha='${alphaExpr}'`

      const enable = `enable='between(t\\,${n(c.start)}\\,${n(c.start + c.duration)})'`
      // fix: fonts that only exist in our imagination no longer abort the export
      const fontfile = resolveFontFile(fontPaths[t.fontFamily])
      const boldFont = fontFileForWeight(t, fontfile, fontPaths, resolveFontFile)
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
        t.letterSpacing && t.letterSpacing > 0 && drawtextSupportsLetterSpacing()
          ? `:letter_spacing=${Math.round(t.letterSpacing * scale)}`
          : ''
      const boxOpt = hasBox ? `:box=1:boxcolor=${t.bgColor}@0.85:boxborderw=${Math.max(4, Math.round(12 * scale))}` : ''
      const strokeOpt = borderw > 0 ? `:borderw=${borderw}:bordercolor=${bordercolor}` : ''

      const shadow = `shadowcolor=${shadowColor}:shadowx=${Math.round(t.shadowX ?? 0)}:shadowy=${Math.round(t.shadowY ?? 0)}`
      const extra = `${strokeOpt}${letterSpacing}${alphaOpt}`
      const fontSizeOpt = moving ? `fontsize='${plan.fontsize}'` : `fontsize=${fontSize}`
      lines.forEach((line, li) => {
        const isLast = li === lines.length - 1
        const lbl = isLast ? outLbl : `tx${i}_l${li}`
        let lx: string
        let ly: string
        if (moving) {
          // xExpr gebruikt text_w en yExpr text_h → blijven correct tijdens het schalen
          lx = xExpr
          ly = `${yExpr}+${li}*text_h`
        } else {
          lx = li === 0 ? xExpr : String(leftFor(lineWs[li] ?? 0))
          ly = isLast ? yExpr : String(Math.round(blockTop + li * lineH))
        }
        graph.push(
          `${prev}drawtext=text='${esc(line)}':${fontSizeOpt}:fontcolor=${fontColor}:x=${lx}:y=${ly}:${shadow}:fontfile='${esc(boldFont)}'${extra}:${enable}[${lbl}]`
        )
        prev = `[${lbl}]`
      })
      if (t.words && t.words.length > 1 && lines.length === 1 && t.highlightColor) {
        const words = t.words
        words.forEach((w, j) => {
          if (!w.text) return
          const wx = baseX + Math.round((w.x ?? 0) * scale)
          const wEnable = `enable='between(t\\,${n(c.start + w.s)}\\,${n(c.start + w.e)})'`
          const wLabel = `txk${i}_${j}`
          const finalLabel = wLabel
          const stroke = borderw > 0 ? `:borderw=${borderw}:bordercolor=${bordercolor}` : ''
          graph.push(
            `${prev}drawtext=text='${esc(w.text)}':fontsize=${fontSize}:fontcolor=${t.highlightColor}:x=${wx}:y=${yExpr}:fontfile='${esc(fontfile)}'${stroke}:${wEnable}[${finalLabel}]`
          )
          prev = `[${finalLabel}]`
        })
        graph.push(`${prev}null[${outLbl}]`)
        prev = `[${outLbl}]`
      }
    })
  }
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
  if (mode !== 'audio') {
    cmd.outputOptions([
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'medium',
      '-movflags', '+faststart'
    ])
  }
  if (hasAudio) {
    // alleen-audio: codec kiezen op de extensie van het gekozen bestand
    if (mode === 'audio') {
      if (/\.mp3$/i.test(outPath)) cmd.outputOptions(['-c:a', 'libmp3lame', '-b:a', '192k'])
      else if (/\.m4a$/i.test(outPath)) cmd.outputOptions(['-c:a', 'aac', '-b:a', '192k'])
      else cmd.outputOptions(['-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2'])
    } else {
      cmd.outputOptions(['-c:a', 'aac', '-b:a', '192k'])
    }
  }
  cmd.output(outPath)
  if (mode !== 'audio') cmd.map('[vout]')
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
  let currentError = ''
  let stderrTail = ''
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
      stderrTail = `${stderrTail}\n${line}`.slice(-1500)
      if (/error|invalid|no such|not found/i.test(line)) {
        webContents.send('export-progress', { phase: 'log', percent: 0, message: line, outPath: req.outPath } satisfies ExportProgress)
      }
      if (/No such file or directory/i.test(line)) {
        currentError = `Bestand niet gevonden: ${(line.match(/No such file or directory:?\s*(.*)$/i)?.[1] ?? '').trim() || line.trim()}`
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
        const detail = currentError || err.message
        const tail = stderrTail.trim().split('\n').filter(Boolean).slice(-2).join(' ')
        const message = tail && !detail.includes(tail) ? `${detail} — ${tail}` : detail
        webContents.send('export-progress', { phase: 'error', percent: 0, message, outPath: req.outPath } satisfies ExportProgress)
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
