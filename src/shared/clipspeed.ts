/**
 * Achteruit + freeze: één tijdmodule waar de preview én de export uit lezen.
 *
 * Semantiek (bewust simpel, zonder ripple):
 * - `reversed`: de bron loopt achteruit. Op clip-lokaal `t` hoort bron
 *   `sourceStart + (duration - t)`.
 * - freeze: tijdens lokaal `[at, at + dur)` staat het beeld stil op het frame
 *   van lokaal `at`. De video eronder in dat stuk wordt overgeslagen; de
 *   timeline zelf verandert niet. Het geluid van de clip is in dat stuk stil.
 * - samen: eerst achteruit denken (welk frame hoort bij lokaal `at`), dan
 *   stilhouden. De mute van het geluid volgt altijd de timeline, dus die hoeft
 *   niets van achteruit te weten.
 */

import type { Clip } from './types'

export interface FreezeWin {
  at: number
  dur: number
}

/** Geldig freeze-venster, of null als er niets te freezen valt. */
export function freezeWindow(clip: Pick<Clip, 'freezeAt' | 'freezeDuration' | 'duration'>): FreezeWin | null {
  const at = clip.freezeAt
  const dur = clip.freezeDuration
  if (at == null || !(dur != null && dur > 0)) return null
  if (!(clip.duration > 0)) return null
  const a = Math.min(Math.max(0, at), clip.duration)
  const d = Math.min(dur, clip.duration - a)
  if (d <= 0.001) return null
  return { at: a, dur: d }
}

/** Valt deze clip-lokale tijd in het freeze-venster? */
export function isFrozenAt(
  clip: Pick<Clip, 'freezeAt' | 'freezeDuration' | 'duration'>,
  localT: number
): boolean {
  const w = freezeWindow(clip)
  return !!w && localT >= w.at && localT < w.at + w.dur
}

/**
 * Welke bron-tijd hoort bij clip-lokaal `localT`? Houdt rekening met achteruit
 * én freeze. De preview positioneert zijn <video>-element hiermee, de export
 * bouwt er zijn segmenten mee — zelfde invoer, zelfde frame.
 */
export function clipSourceTime(
  clip: Pick<Clip, 'sourceStart' | 'duration' | 'reversed' | 'freezeAt' | 'freezeDuration'>,
  localT: number
): number {
  const s0 = clip.sourceStart
  const dur = clip.duration
  const w = freezeWindow(clip)
  if (w && localT >= w.at && localT < w.at + w.dur) {
    // het frame dat op lokaal `at` speelt — mét achteruit meegerekend
    return clip.reversed ? s0 + dur - w.at : s0 + w.at
  }
  if (clip.reversed) return s0 + dur - localT
  return s0 + localT
}

/** Bron-bereik [from, to) voor een clip-lokaal bereik — voor trim in de export. */
export function clipSourceRange(
  clip: Pick<Clip, 'sourceStart' | 'duration' | 'reversed'>,
  localFrom: number,
  localTo: number
): { from: number; to: number } {
  const s0 = clip.sourceStart
  const dur = clip.duration
  if (clip.reversed) return { from: s0 + dur - localTo, to: s0 + dur - localFrom }
  return { from: s0 + localFrom, to: s0 + localTo }
}

/** Wat de speler met een clip moet op dit tijdstip: normaal, achteruit of stilhouden. */
export function playbackMode(
  clip: Pick<Clip, 'start' | 'duration' | 'sourceStart' | 'reversed' | 'freezeAt' | 'freezeDuration'>,
  time: number
): { reversed: boolean; holdSource: number | null } {
  const local = time - clip.start
  const reversed = !!clip.reversed
  if (local < 0 || local >= clip.duration) return { reversed, holdSource: null }
  if (isFrozenAt(clip, local)) return { reversed, holdSource: clipSourceTime(clip, local) }
  return { reversed, holdSource: null }
}
