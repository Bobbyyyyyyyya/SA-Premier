/**
 * Dynamische video-effecten (flits, schudden, zoomen, korrel, flikker, spiegel).
 *
 * Eén tabel met getallen waaruit zowel de canvas-preview als de ffmpeg-export
 * lezen — dezelfde les als bij de tekstanimaties: wie twee keer schrijft,
 * vergeet de tweede. Alles hier is beperkt tot wat beide renderers kunnen:
 * schaal, verplaatsing, helderheid per frame, ruis en spiegelen.
 *
 * Tijdsbasis is overal de clip-lokale tijd in seconden: in de preview is dat
 * `time - clip.start`, in de export is `t` na `setpts=PTS-STARTPTS` eveneens
 * clip-lokaal. Dezelfde invoer, dus dezelfde beweging.
 *
 * Twee dingen zijn bewust géén exacte kopie:
 * - korrel is aan beide kanten willekeurig: de sterkte komt overeen, de
 *   individuele korrels niet. Dat is de aard van ruis.
 * - een witte flits is in de preview een overlay (screen-achtig) en in de
 *   export een additieve `eq`-helderheid. Timing en sterkte kloppen; de curve
 *   in de schaduwen verschilt marginaal omdat eq in YUV werkt.
 */

export const VFX = {
  /** deel van elke flitsperiode waarin het beeld wit staat */
  flashDuty: 0.4,
  /** pseudo-willekeur voor flikker; priem-achtig zodat hij niet met fps-porties samenvalt */
  flickerK: 13.73,
  /** vaste overscan tijdens schudden, zodat er geen zwarte randen in beeld komen */
  shakeOver: 1.12,
  /** maximale uitslag als fractie van de kleinste framedimensie */
  shakeAmp: 0.035,
  /** maximale extra zoom (1 = +25%) */
  zoomMax: 0.25
} as const

const TAU = Math.PI * 2

/** Getal voor in een filtergraaf: kort, geen NaN/Infinity. */
export function fnum(v: number): string {
  if (!Number.isFinite(v)) return '0'
  const r = Math.round(v * 10000) / 10000
  return Object.is(r, -0) ? '0' : String(r)
}

/* ---------------- flits ---------------- */

/** Staat de flits aan op dit moment? */
export function flashOn(rate: number, t: number): boolean {
  if (!(rate > 0)) return false
  const m = ((t * rate) % 1 + 1) % 1
  return m < VFX.flashDuty
}

/** Overlay-alpha (0 of amount) voor de preview. */
export function flashAlpha(amount: number, rate: number, t: number): number {
  if (!(amount > 0)) return 0
  return flashOn(rate, t) ? amount : 0
}

/** Schakelt een statische eq-helderheid per frame in en uit. */
export function flashEnableExpr(rate: number): string {
  return `lt(mod(t\\,${fnum(rate)})\\,${fnum(VFX.flashDuty)})`
}

/* ---------------- schudden ---------------- */

/** Basisfrequentie in Hz uit de 0..1-temposchuif. */
export function shakeBaseFreq(speed: number): number {
  return 2 + 10 * Math.min(1, Math.max(0, speed))
}

/** Eenheidsloze uitslag (|.| ≤ 1.5); vermenigvuldig met de amplitude. */
export function shakeFrac(speed: number, t: number): { fx: number; fy: number } {
  const f1 = shakeBaseFreq(speed)
  const f2 = f1 * 2.33 + 0.7
  const f3 = f1 * 1.71 + 1.1
  const f4 = f1 * 2.91
  return {
    fx: Math.sin(TAU * f1 * t) + 0.5 * Math.sin(TAU * f2 * t + 1.3),
    fy: Math.cos(TAU * f3 * t + 0.7) + 0.5 * Math.sin(TAU * f4 * t)
  }
}

/**
 * Amplitude in pixels: fractie van de kleinste dimensie. `over` is de vaste
 * overscan van de renderer die de verschuiving opvangt (preview: 1, de crop
 * in de export rekent in geschaalde pixels en geeft `shakeOver` mee).
 */
export function shakeAmpPx(amount: number, refDim: number, over = 1): number {
  return amount * VFX.shakeAmp * refDim * over
}

const shakeFreqExpr = (speed: number): [string, string, string, string] => {
  const f1 = shakeBaseFreq(speed)
  return [fnum(f1), fnum(f1 * 2.33 + 0.7), fnum(f1 * 1.71 + 1.1), fnum(f1 * 2.91)]
}

/**
 * Totale keten voor schudden. De invoer is exact W×H (de keten deed eerder al
 * scale+pad), dus er staan letterlijke maten in — geen iw/ih-gokwerk.
 * De crop-uitsnede is vast W×H; alleen het venster beweegt, vandaar dat de
 * uitvoer nooit van formaat verandert en de encoder niet struikelt.
 */
export function shakeFilters(amount: number, speed: number, W: number, H: number): string[] {
  if (!(amount > 0)) return []
  const sw = Math.ceil((W * VFX.shakeOver) / 2) * 2
  const sh = Math.ceil((H * VFX.shakeOver) / 2) * 2
  // zichtbare verschuiving in uitvoer-pixels = crop-verschuiving / overscan
  const k = shakeAmpPx(amount, Math.min(W, H), VFX.shakeOver)
  const [f1, f2, f3, f4] = shakeFreqExpr(speed)
  const ox = `(${fnum(k)}*(sin(2*PI*${f1}*t)+0.5*sin(2*PI*${f2}*t+1.3)))`
  const oy = `(${fnum(k)}*(cos(2*PI*${f3}*t+0.7)+0.5*sin(2*PI*${f4}*t)))`
  return [`scale=${sw}:${sh},crop=${W}:${H}:x='(in_w-out_w)/2+${ox}':y='(in_h-out_h)/2+${oy}'`]
}

/* ---------------- zoomen (heartbeat) ---------------- */

export function zoomFreq(speed: number): number {
  return 0.8 + 2.2 * Math.min(1, Math.max(0, speed))
}

/** Hartslag 0..1: snel op, langzaam af. */
export function zoomPulse(speed: number, t: number): number {
  const p = 0.5 + 0.5 * Math.sin(TAU * zoomFreq(speed) * t)
  return p * p
}

export function zoomFactor(amount: number, speed: number, t: number): number {
  if (!(amount > 0)) return 1
  return 1 + amount * VFX.zoomMax * zoomPulse(speed, t)
}

const zoomPulseExpr = (speed: number): string =>
  `pow(0.5+0.5*sin(2*PI*${fnum(zoomFreq(speed))}*t)\\,2)`

/**
 * Zoom via een meeschalende factor en een vaste uitsnede. `eval=frame` is
 * nodig omdat scale zijn maten anders één keer bij de start uitrekent; de
 * crop erna is vast W×H zodat de uitvoer nooit van formaat verandert.
 * `ceil/2*2` houdt de maten even — oneven breedtes laten x264 struikelen.
 */
export function zoomFilters(amount: number, speed: number, W: number, H: number): string[] {
  if (!(amount > 0)) return []
  const s = `(1+${fnum(amount * VFX.zoomMax)}*${zoomPulseExpr(speed)})`
  return [
    `scale='ceil(iw*(${s})/2)*2':'ceil(ih*(${s})/2)*2':eval=frame` +
      `,crop=${W}:${H}:x='(in_w-out_w)/2':y='(in_h-out_h)/2'`
  ]
}

/* ---------------- flikker ---------------- */

/** Pseudo-willekeur 0..1, deterministisch per tijdstip (scrub-vast). */
export function flickerHash(t: number): number {
  return (((t * VFX.flickerK) % 1) + 1) % 1
}

/** Ondertekende helderheid: +A of −A, zelfde grens als de export. */
export function flickerDelta(amount: number, t: number): number {
  if (!(amount > 0)) return 0
  return flickerHash(t) < 0.5 ? amount : -amount
}

/**
 * Twee complementaire eq's: nooit tegelijk aan, dus ze stapelen nooit.
 * Eén filter met een getekende expressie kan niet, want eq evalueert zijn
 * helderheid één keer bij de start en niet per frame — vandaar statische
 * waarden met een bewegende `enable`.
 */
export function flickerFilters(amount: number): string[] {
  if (!(amount > 0)) return []
  const h = `mod(t\\,${fnum(VFX.flickerK)})`
  const a = fnum(amount)
  return [`eq=brightness=${a}:enable='lte(${h}\\,0.5)'`, `eq=brightness=-${a}:enable='gt(${h}\\,0.5)'`]
}

/* ---------------- korrel ---------------- */

/** Sterkte 0..100 voor het noise-filter; aan beide kanten betekenisloos boven ~25. */
export function grainStrength(amount: number): number {
  return Math.round(Math.min(1, Math.max(0, amount)) * 20)
}

export function grainFilter(amount: number): string | null {
  if (!(amount > 0)) return null
  return `noise=alls=${grainStrength(amount)}:allf=t`
}

/* ---------------- spiegel ---------------- */

export function mirrorFilter(mirror: number): string | null {
  if (mirror === 1) return 'hflip'
  if (mirror === 2) return 'vflip'
  return null
}
