/**
 * Tekstanimaties: één declaratieve tabel die zowel de preview (canvas) als de
 * export (ffmpeg `drawtext`) voedt.
 *
 * Waarom een tabel en geen switch: elke animatie moest anders twee keer
 * geschreven worden — een keer als canvas-getallen en een keer als
 * ffmpeg-expressie — en de tweede werd stilletjes vergeten. `zoomIn`, `pop`,
 * `bounce`, `drop` en `grow` waren daardoor in de export alleen een fade. Met
 * één tabel is dat niet meer mogelijk en is een nieuwe animatie één regel.
 *
 * De drie dimensies die beide renderers kunnen:
 *   schaal (fontsize) · verplaatsing (x/y) · alpha
 * Alles wat daarnaast nodig is — rotatie, blur, typewriter — bestaat alleen in
 * de preview. Dat staat níet in deze tabel, maar in `PREVIEW_ONLY_ANIMS`
 * hiernaast, zodat niemand per ongeluk een export-gat introduceert.
 */

export type EaseName = 'linear' | 'cubic' | 'back'

export interface AnimCurve {
  /** Zichtbare schaal bij u=0 en u=1. */
  scaleFrom: number
  scaleTo: number
  /** Verplaatsing als fractie van de fontSize, in 1080-hoogte pixels. */
  dxFrom: number
  dxTo: number
  dyFrom: number
  dyTo: number
  alphaFrom: number
  alphaTo: number
  /** Easing van de transform. Alpha loopt altijd lineair, anders duurt het
   *  zichtbaar worden bij een gedempte curve te lang. */
  ease?: EaseName
  /** Alpha komt met deze factor opzetten (1 = lineair met de voortgang). */
  alphaRush?: number
  /** Uit-dempende zijwaartse wiebel, in fractie van de fontSize. */
  sway?: number
  /** Aantal volledige zijwaartse slagen over de animatie heen. */
  swayCycles?: number
  /** Extra uitslag op de schaal die uitdempt, in fractie van de schaal. */
  wobble?: number
}

/* ---------- animaties die alleen in de preview bestaan ---------- */

/**
 * Rasterfuncties en per-frame maskers zijn niet te vertalen naar drawtext.
 * Bewust apart gehouden zodat het overzichtelijk blijft wat de export niet kan.
 */
export const PREVIEW_ONLY_ANIMS = ['typewriter', 'blurIn', 'spinIn', 'flip', 'swing'] as const
export type PreviewOnlyAnim = (typeof PREVIEW_ONLY_ANIMS)[number]
export const isPreviewOnlyAnim = (a: string | null | undefined): a is PreviewOnlyAnim =>
  !!a && (PREVIEW_ONLY_ANIMS as readonly string[]).includes(a)

/* ---------- de tabellen ---------- */

/** De vervolg-rasters (u loopt 0→1 over de fase) voor animatie `id`. */
const IN: Record<string, AnimCurve> = {
  fade: { scaleFrom: 1, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 0, alphaTo: 1 },

  slideUp: { scaleFrom: 1, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 1.1, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic' },
  slideDown: { scaleFrom: 1, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: -1.1, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic' },
  slideLeft: { scaleFrom: 1, scaleTo: 1, dxFrom: 1.54, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic' },
  slideRight: { scaleFrom: 1, scaleTo: 1, dxFrom: -1.54, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic' },

  // Diagonaal: dezelfde reis als slideUp maar ook zijwaarts. dx én dy tellen op,
  // dus de hoek klopt ook echt (beide 1.1 → 45°, niet 1.54/1.1).
  slideUpLeft: { scaleFrom: 1, scaleTo: 1, dxFrom: 1.1, dxTo: 0, dyFrom: 1.1, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic' },
  slideUpRight: { scaleFrom: 1, scaleTo: 1, dxFrom: -1.1, dxTo: 0, dyFrom: 1.1, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic' },
  slideDownLeft: { scaleFrom: 1, scaleTo: 1, dxFrom: 1.1, dxTo: 0, dyFrom: -1.1, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic' },
  slideDownRight: { scaleFrom: 1, scaleTo: 1, dxFrom: -1.1, dxTo: 0, dyFrom: -1.1, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic' },

  pop: { scaleFrom: 0.4, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'back', alphaRush: 1.4 },
  zoomIn: { scaleFrom: 0.55, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic' },
  // Omgekeerde zoom: komt van buiten binnen. In de export alleen alpha was dit
  // onmogelijk te zien, nu schaalt de tekst echt mee.
  zoomOut: { scaleFrom: 1.7, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic', alphaRush: 1.2 },
  bounce: { scaleFrom: 1, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0.605, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'back', alphaRush: 1.5 },
  drop: { scaleFrom: 1, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: -0.99, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic', alphaRush: 1.4 },
  grow: { scaleFrom: 0.55, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'back', alphaRush: 1.3 },

  // Langere, tragere reis met minder schaalverandering: leest als zweven.
  floatUp: { scaleFrom: 0.85, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 1.7, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic' },
  // Komt schuivend binnen en wiebelt daarna uit.
  sway: { scaleFrom: 0.8, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic', alphaRush: 1.1, sway: 0.3, swayCycles: 1.5 },
  // Veert en belandt.
  wobble: { scaleFrom: 0.72, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic', alphaRush: 1.2, wobble: 0.14, swayCycles: 2 },

  /* 3D-diepte: schaal + verplaatsing is precies de cue die het oog nodig heeft
     om afstand te zien — een object dat naar de camera toe komt wordt groter. */
  dollyIn: { scaleFrom: 0.28, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic' },
  depthPush: { scaleFrom: 2.4, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic' },
  flyThrough: { scaleFrom: 6, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic', alphaRush: 1.7 },
  floorRise: { scaleFrom: 0.35, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0.9, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic' },
  ceilingDrop: { scaleFrom: 0.35, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: -0.9, dyTo: 0, alphaFrom: 0, alphaTo: 1, ease: 'cubic' }
}

/** De uit-rasters. Let op: de eindwaarden zijn per animatie anders dan bij 'in' —
 *  `pop` komt binnen vanaf 0.4 maar vertrekt richting 0.6, en `grow` andersom. */
const OUT: Record<string, AnimCurve> = {
  fade: { scaleFrom: 1, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 1, alphaTo: 0 },

  slideUp: { scaleFrom: 1, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: -1.1, alphaFrom: 1, alphaTo: 0 },
  slideDown: { scaleFrom: 1, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 1.1, alphaFrom: 1, alphaTo: 0 },
  slideLeft: { scaleFrom: 1, scaleTo: 1, dxFrom: 0, dxTo: -1.54, dyFrom: 0, dyTo: 0, alphaFrom: 1, alphaTo: 0 },
  slideRight: { scaleFrom: 1, scaleTo: 1, dxFrom: 0, dxTo: 1.54, dyFrom: 0, dyTo: 0, alphaFrom: 1, alphaTo: 0 },

  slideUpLeft: { scaleFrom: 1, scaleTo: 1, dxFrom: 0, dxTo: -1.1, dyFrom: 0, dyTo: -1.1, alphaFrom: 1, alphaTo: 0 },
  slideUpRight: { scaleFrom: 1, scaleTo: 1, dxFrom: 0, dxTo: 1.1, dyFrom: 0, dyTo: -1.1, alphaFrom: 1, alphaTo: 0 },
  slideDownLeft: { scaleFrom: 1, scaleTo: 1, dxFrom: 0, dxTo: -1.1, dyFrom: 0, dyTo: 1.1, alphaFrom: 1, alphaTo: 0 },
  slideDownRight: { scaleFrom: 1, scaleTo: 1, dxFrom: 0, dxTo: 1.1, dyFrom: 0, dyTo: 1.1, alphaFrom: 1, alphaTo: 0 },

  pop: { scaleFrom: 1, scaleTo: 0.6, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 1, alphaTo: 0 },
  zoomIn: { scaleFrom: 1, scaleTo: 0.6, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 1, alphaTo: 0 },
  zoomOut: { scaleFrom: 1, scaleTo: 1.7, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 1, alphaTo: 0 },
  bounce: { scaleFrom: 1, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: -0.385, alphaFrom: 1, alphaTo: 0 },
  drop: { scaleFrom: 1, scaleTo: 1, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0.88, alphaFrom: 1, alphaTo: 0 },
  // Let op de richting: `grow` groeit juist bij het WEGGAAN (1 → 1.35), niet
  // bij het aankomen. Dat is de bestaande curve en die blijft ongewijzigd.
  grow: { scaleFrom: 1, scaleTo: 1.35, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 1, alphaTo: 0 },

  floatUp: { scaleFrom: 1, scaleTo: 0.85, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: -1.7, alphaFrom: 1, alphaTo: 0 },
  sway: { scaleFrom: 1, scaleTo: 0.8, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 1, alphaTo: 0, sway: -0.3, swayCycles: 1.5 },
  wobble: { scaleFrom: 1, scaleTo: 0.72, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 1, alphaTo: 0, wobble: 0.14, swayCycles: 2 },

  dollyOut: { scaleFrom: 1, scaleTo: 0.2, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 1, alphaTo: 0 },
  depthSink: { scaleFrom: 1, scaleTo: 0.3, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: -0.9, alphaFrom: 1, alphaTo: 0 },
  flyThrough: { scaleFrom: 1, scaleTo: 6, dxFrom: 0, dxTo: 0, dyFrom: 0, dyTo: 0, alphaFrom: 1, alphaTo: 0 }
}

/** Alle animaties die in beide renderers bestaan. */
export const SHARED_ANIMS = [...new Set([...Object.keys(IN), ...Object.keys(OUT)])]

/** Wat de UI voor 'in' respectievelijk 'out' aan moet bieden.
 *
 * Sommige animaties zijn bewust één kant op: `dollyIn` en `dollyOut` zijn
 * elkaars tegengestelde, niet dezelfde beweging in twee richtingen. Door de
 * keuzelijst per richting te filteren kan een gebruiker geen animatie kiezen
 * waarvoor de helft van de curve ontbreekt — dat zou in de preview stilletjes
 * een fade zijn en in de export helemaal niets. */
export const animsForMode = (mode: 'in' | 'out'): string[] => Object.keys(mode === 'in' ? IN : OUT)

/** Alleen voor de UI: wat er in de 3D-groep zit. */
export const TEXT_3D_ANIMS = ['dollyIn', 'depthPush', 'flyThrough', 'floorRise', 'ceilingDrop', 'dollyOut', 'depthSink']

export const isText3DAnim = (a: string | null | undefined): boolean => !!a && TEXT_3D_ANIMS.includes(a)

export const animCurve = (anim: string | null | undefined, mode: 'in' | 'out'): AnimCurve | null => {
  if (!anim || anim === 'none') return null
  const table = mode === 'in' ? IN : OUT
  return table[anim] ?? null
}

export const hasSharedAnim = (anim: string | null | undefined): boolean => animCurve(anim, 'in') !== null || animCurve(anim, 'out') !== null

/* ---------- evaluatie (preview) ---------- */

const BACK_C1 = 1.70158
const BACK_C3 = BACK_C1 + 1

export function ease(name: EaseName | undefined, x: number): number {
  if (name === 'cubic') return 1 - Math.pow(1 - x, 3)
  if (name === 'back') return 1 + BACK_C3 * Math.pow(x - 1, 3) + BACK_C1 * Math.pow(x - 1, 2)
  return x
}

export interface AnimSample {
  dx: number
  dy: number
  scale: number
  alpha: number
}

/**
 * Eén animatiefase evalueren. `u` loopt altijd 0 → 1 over de fase, ongeacht in
 * of uit; de richting zit ín de tabel. Die symmetrie haalt de asymmetrie eruit
 * die de oude switch had (waar 'uit' met een omgekeerde p rekende), en is wat
 * de export-expressie kan overnemen.
 */
export function evalAnimDir(anim: string | null | undefined, mode: 'in' | 'out', u: number, fontSize: number): AnimSample | null {
  const c = animCurve(anim, mode)
  if (!c) return null
  const p = Math.min(1, Math.max(0, u))
  const e = ease(c.ease, p)
  const mix = (a: number, b: number): number => a + (b - a) * e
  const size = fontSize || 80
  const decay = 1 - p
  const sway = c.sway ? c.sway * size * Math.sin(p * (c.swayCycles ?? 1) * Math.PI * 2) * decay : 0
  const wobble = c.wobble ? c.wobble * Math.sin(p * (c.swayCycles ?? 1) * Math.PI * 2) * decay : 0
  const rush = c.alphaRush ?? 1
  const s = mix(c.scaleFrom, c.scaleTo)
  return {
    scale: s + wobble * s,
    dx: mix(c.dxFrom, c.dxTo) * size + sway,
    dy: mix(c.dyFrom, c.dyTo) * size,
    alpha: c.alphaFrom + (c.alphaTo - c.alphaFrom) * Math.min(1, p * rush)
  }
}

/* ---------- export: dezelfde tabellen als ffmpeg-expressie ---------- */

const num = (v: number): string => {
  if (!Number.isFinite(v)) return '0'
  const r = Math.round(v * 10000) / 10000
  return Object.is(r, -0) ? '0' : String(r)
}

export interface AnimExportPlan {
  active: boolean
  /** fontsize-uitdrukking, of null als de tekst niet schaalt. */
  fontsize: string | null
  /** dx/dy in output-pixels, of null als de tekst niet beweegt. */
  dx: string | null
  dy: string | null
  alpha: string | null
}

const progressExpr = (fromSec: number, durSec: number): string =>
  `min(max((t-${num(fromSec)})/${num(durSec)}\\,0)\\,1)`

const easeExpr = (name: EaseName | undefined, p: string): string => {
  if (name === 'cubic') return `(1-pow(1-(${p})\\,3))`
  if (name === 'back') return `(1+${num(BACK_C3)}*pow(${p}-1\\,3)+${num(BACK_C1)}*pow(${p}-1\\,2))`
  return p
}

const mixExpr = (a: number, b: number, e: string): string => `${num(a)}+(${num(b - a)})*(${e})`

/** if/else over de hele clip: in-fase → rust → uit-fase. Elke tak is volledig:
 *  ffmpeg leest een lege tak als een syntaxfout. */
function phaseExpr(inVal: string, outVal: string, neutral: string, inEnd: number, outStart: number): string {
  return `(if(lt(t\\,${num(inEnd)})\\,${inVal}\\,if(gt(t\\,${num(outStart)})\\,${outVal}\\,${neutral})))`
}

/**
 * Alle animaties van een clip omzetten naar drawtext-expressies, met exact de
 * getallen van `evalAnimDir`.
 *
 * `scale` is height/1080 en `baseSize` de ongeschaalde fontsize uit TextData.
 */
export function planAnimExport(
  animIn: string | null | undefined,
  animOut: string | null | undefined,
  baseSize: number,
  startSec: number,
  clipDurSec: number,
  animDurSec: number,
  scale: number
): AnimExportPlan {
  const cIn = animCurve(animIn, 'in')
  const cOut = animCurve(animOut, 'out')
  if (!cIn && !cOut) return { active: false, fontsize: null, dx: null, dy: null, alpha: null }

  const dur = Math.max(0.05, animDurSec)
  const inEnd = startSec + dur
  const outStart = startSec + Math.max(0, clipDurSec - dur)
  const pIn = progressExpr(startSec, dur)
  const pOut = progressExpr(outStart, dur)
  const base = baseSize * scale

  const valueOf = (c: AnimCurve, p: string): { s: string; x: string; y: string; a: string } => {
    const e = easeExpr(c.ease, p)
    const decay = `(${num(1)}-(${p}))`
    const cyc = c.swayCycles ?? 1
    const swayTerm = c.sway ? `+${num(c.sway * base)}*sin((${p})*${num(cyc * Math.PI * 2)})*${decay}` : ''
    const wobTerm = c.wobble ? `+${num(c.wobble)}*sin((${p})*${num(cyc * Math.PI * 2)})*${decay}*(${mixExpr(c.scaleFrom, c.scaleTo, e)})` : ''
    const rush = c.alphaRush ?? 1
    return {
      s: `(${mixExpr(c.scaleFrom, c.scaleTo, e)}${wobTerm})`,
      x: `(${mixExpr(c.dxFrom * base, c.dxTo * base, e)}${swayTerm})`,
      y: `(${mixExpr(c.dyFrom * base, c.dyTo * base, e)})`,
      a: `(${mixExpr(c.alphaFrom, c.alphaTo, rush === 1 ? p : `min(1\\,(${p})*${num(rush)})`)})`
    }
  }

  const vIn = cIn ? valueOf(cIn, pIn) : null
  const vOut = cOut ? valueOf(cOut, pOut) : null

  const restScale = cIn ? cIn.scaleTo : cOut!.scaleFrom
  const restDx = cIn ? cIn.dxTo * base : cOut!.dxFrom * base
  const restDy = cIn ? cIn.dyTo * base : cOut!.dyFrom * base
  const restAlpha = cIn ? cIn.alphaTo : cOut!.alphaFrom

  const restSize = `max(8\\,(${num(base)}*${num(restScale)}))`
  const fontsize = phaseExpr(
    vIn ? `max(8\\,(${num(base)}*${vIn.s}))` : restSize,
    vOut ? `max(8\\,(${num(base)}*${vOut.s}))` : restSize,
    restSize, inEnd, outStart
  )
  const dx = phaseExpr(vIn ? vIn.x : num(restDx), vOut ? vOut.x : num(restDx), num(restDx), inEnd, outStart)
  const dy = phaseExpr(vIn ? vIn.y : num(restDy), vOut ? vOut.y : num(restDy), num(restDy), inEnd, outStart)
  const alpha = phaseExpr(vIn ? vIn.a : num(restAlpha), vOut ? vOut.a : num(restAlpha), num(restAlpha), inEnd, outStart)

  return { active: true, fontsize, dx, dy, alpha }
}

/** Of een animatie ook echt iets verandert, bespaart een drawtext-optie. */
export const animChangesScale = (anim: string | null | undefined, mode: 'in' | 'out'): boolean => {
  const c = animCurve(anim, mode)
  return !!c && (c.scaleFrom !== c.scaleTo || !!c.wobble)
}
