import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type {
  Asset,
  AudioEffects,
  CaptionPreset,
  CaptionWordMode,
  Clip,
  SavedProject,
  SubtitleSegment,
  TextData,
  Track,
  TrackKind,
  TransitionType
} from '../../shared/types'
import { CAPTION_PRESETS, DEFAULT_AUDIO_EFFECTS, DEFAULT_EFFECTS, TEXT_PRESETS, sanitizeCaptionText, uid } from '../../shared/types'

export interface EditorState {
  project: { name: string; width: number; height: number; fps: number }
  assets: Asset[]
  tracks: Track[]
  clips: Clip[]
  selectedClipId: string | null
  playhead: number
  playing: boolean
  zoom: number
  mediaIssues: { path: string; reason: 'denied' | 'missing' }[]

  addAssets: (assets: Asset[]) => void
  updateAsset: (assetId: string, patch: Partial<Asset>) => void
  setMediaIssues: (issues: { path: string; reason: 'denied' | 'missing' }[]) => void
  removeAsset: (assetId: string) => void
  addTrack: (kind: TrackKind) => string
  removeTrack: (trackId: string) => void
  setTrackMuted: (trackId: string, muted: boolean) => void
  setTrackHidden: (trackId: string, hidden: boolean) => void
  setTrackLocked: (trackId: string, locked: boolean) => void
  setProjectResolution: (width: number, height: number) => void
  setProjectName: (name: string) => void

  addClip: (assetId: string, trackId: string, start: number) => void
  /** Audio-effecten van één clip (EQ/compressor/reverb) — ook volume, in één klap. */
  setClipAudioFx: (clipId: string, patch: Partial<AudioEffects>) => void
  /** Alles audio op één track resetten (handig na een experiment). */
  resetTrackAudioFx: (trackId: string) => void
  /** Haalt echt de audiotrack uit een video en zet die als clip op een audiotrack. */
  extractAudioToTrack: (assetId: string, sourceClipId?: string) => Promise<ExtractAudioResult>
  addTextClip: (trackId: string, start: number, text: Partial<TextData>) => void
  /** Batch ondertitels op de gedeelde Subtitles-track — eerste call wipt, rest append. */
  addSubtitleClips: (
    language: string,
    segments: SubtitleSegment[],
    opts?: { timeOffset?: number; replace?: boolean; styleId?: string; wordMode?: CaptionWordMode }
  ) => string
  /** Herstyle alle ondertitel-clips (incl. karaoke/woord-modus) zonder hertranscoderen. */
  setSubtitleStyle: (styleId: string) => number
  /** Verwijder alle ondertitel-clips (en lege Subtitles*-tracks) in één keer. */
  clearSubtitles: () => number
  /** Forceer alles naar één Subtitles-track (loopt stil als al schoon). */
  consolidateSubtitles: () => void
  updateClip: (id: string, patch: Partial<Clip>) => void
  /** Verplaats ALLE ondertitel-clips mee (één klik + sleep = hele groep verschuift). */
  moveSubtitleGroup: (id: string, newStart: number) => void
  /** Verschuif de schermpositie (x/y) van ALLE ondertitels — dx/dy in 0..1 van de video. */
  moveSubtitlePosition: (dx: number, dy: number) => void
  moveTextClipPosition: (clipId: string, dx: number, dy: number) => void
  /** Zet de schermpositie (x/y) van ALLE ondertitels absoluut. */
  setSubtitlePosition: (x: number, y: number) => void
  /** Pas tekst-eigenschappen toe op ALLE ondertitel-clips (globale caption-controls). */
  setSubtitleProps: (patch: Partial<TextData>) => number
  /** Zet alle ondertitels terug naar de waarden van de gekozen preset. */
  resetSubtitleStyle: (styleId: string) => number
  removeClip: (id: string) => void
  selectClip: (id: string | null) => void
  splitClip: (id: string, at?: number) => void
  duplicateClip: (id: string) => void
  addTransition: (fromId: string, type: TransitionType, duration: number) => void
  clearTransition: (clipId: string) => void

  setPlayhead: (t: number) => void
  seekTo: (t: number) => void
  setPlaying: (playing: boolean) => void
  setZoom: (zoom: number) => void
  resetProject: () => void
}

const makeTrack = (id: string, name: string, kind: TrackKind): Track => ({ id, name, kind, muted: false, hidden: false })

/** Uitkomst van een echte audio-extractie, zodat UI een echte fout kan tonen. */
export interface ExtractAudioResult {
  ok: boolean
  clipId?: string
  assetId?: string
  outPath?: string
  trackId?: string
  alreadyExisted?: boolean
  error?: string
}

const initialTracks = (): Track[] => [makeTrack('v1', 'Video 1', 'video'), makeTrack('a1', 'Audio 1', 'audio')]

const SUB_TRACK_RE = /^Subtitles(\s*·\s*[A-Za-z-]+)?$/i
const SUB_MAIN_ID = 'subtitles'

const isSubTrack = (t: Track): boolean => t.kind === 'video' && SUB_TRACK_RE.test(t.name)

/**
 * Audiotracks staan altijd onder de videotracks — anders belandt de audio van een
 * video soms tussen twee videorows in. De array-volgorde is tegelijk de zichtbare
 * volgorde én de laagvolgorde van preview/export, dus we ordenen hier, één plek,
 * zodat UI, sleep-lanes en render allemaal dezelfde rij zien.
 *
 * Volgorde: gewone videotracks → Subtitles (die moet altijd bovenop blijven
 * liggen, anders tekent een nieuwe videotrack over de ondertiteling) → audio.
 * Binnen elke groep blijft de bestaande volgorde staan, dus de video-z-order en
 * de track-namen blijven kloppen. Alreeds geordend? Dan komt dezelfde array
 * terug, zodat de selectors niet onnodig her-renderen.
 */
function orderTracks(tracks: Track[]): Track[] {
  const video = tracks.filter((t) => t.kind === 'video' && !isSubTrack(t))
  const subs = tracks.filter(isSubTrack)
  const audio = tracks.filter((t) => t.kind === 'audio')
  if (video.length + subs.length + audio.length !== tracks.length) return tracks
  const ordered = [...video, ...subs, ...audio]
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i] !== tracks[i]) return ordered
  }
  return tracks
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Math.round(v * 10000) / 10000))
function subtitleIdsOf(state: EditorState): Set<string> {
  return new Set(
    state.tracks.filter((t) => t.kind === 'video' && SUB_TRACK_RE.test(t.name)).map((t) => t.id)
  )
}


/**
 * Een échte ondertitel, dus géén gewone titel die toevallig laag staat.
 *
 * `isSubtitleClip` is een gokker: het rekent ook "y >= 0.85 en fontSize <= 72"
 * als ondertitel, zodat oude projecten zonder vlaggetje herkend worden. Voor
 * gedrag is die gok te grof — een credits-titel onderaan is gewoon een titel.
 * Daarom telt hier alleen de expliciete markering of de Subtitles-track mee.
 */
function isRealSubtitle(c: Clip, tracks: Track[]): boolean {
  if (c.kind !== 'text') return false
  if (c.subtitle) return true
  const t = tracks.find((x) => x.id === c.trackId)
  return !!t && t.kind === 'video' && SUB_TRACK_RE.test(t.name)
}

/**
 * Subtitle-clip voor gedrag: het vlaggetje, de Subtitles-track, of een caption uit
 * de caption-engine. Bewust ZONDER de positiecheck — die noemt élke lage, kleine
 * tekst een ondertitel, waardoor credits-titels als groep versleept, getrimd en
 * met 'wis ondertitels' verwijderd werden. Dat hoort bij migratie (legacy), niet
 * bij iets dat op elke gebruikersinteractie mag loslaten.
 */
function isSubtitleClip(c: Clip, subIds: Set<string>): boolean {
  if (c.kind !== 'text' || !c.text) return false
  if (c.subtitle) return true
  if (subIds.has(c.trackId)) return true
  return !!c.text.captionStyle
}

/** Alleen voor migratie van een bestaand project: idem, plus de positiegok. */
function looksLikeLegacySubtitle(c: Clip, subIds: Set<string>): boolean {
  if (isSubtitleClip(c, subIds)) return true
  if (c.kind !== 'text' || !c.text) return false
  return c.text.y >= 0.85 && c.text.fontSize <= 72
}

/** Segmenten langer dan maxDur → gelijkmatig verdelen over meerdere clips (woordgrenzen). */
// Whisper writes 10-second sentences, humans blink after 3. Where to cut is
// still an unsolved 2-month debate; cutting on word boundaries is today's truce.
function splitLongSegments(segments: SubtitleSegment[], maxDur: number): SubtitleSegment[] {
  const out: SubtitleSegment[] = []
  for (const s of segments) {
    const dur = s.end - s.start
    if (dur <= maxDur) {
      out.push(s)
      continue
    }
    const parts = Math.max(2, Math.ceil(dur / maxDur))
    const words = s.text.split(/\s+/).filter(Boolean)
    if (words.length < parts) {
      out.push(s)
      continue
    }
    const per = Math.ceil(words.length / parts)
    for (let i = 0; i < parts; i++) {
      const w = words.slice(i * per, (i + 1) * per)
      if (!w.length) continue
      out.push({
        start: s.start + (dur * i) / parts,
        end: s.start + (dur * (i + 1)) / parts,
        text: w.join(' ')
      })
    }
  }
  return out
}

interface CaptionUnit {
  start: number
  end: number
  text: string
  words?: { s: number; e: number; text: string }[]
}

/** Woord-timings: whisper-woorden indien beschikbaar, anders proportioneel op woordlengte. */
function wordTimings(seg: SubtitleSegment): { s: number; e: number; text: string }[] {
  const text = seg.text.replace(/\s*\n+\s*/g, ' ').trim()
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length) return []
  if (seg.words?.length) {
    return seg.words
      .map((w) => ({
        s: Math.max(seg.start, w.start),
        e: Math.min(seg.end, w.end),
        text: w.text.trim()
      }))
      .filter((w) => w.text && w.e > w.s)
  }
  const weights = words.map((w) => w.length + 1)
  const total = weights.reduce((a, b) => a + b, 0)
  const dur = Math.max(0.01, seg.end - seg.start)
  let acc = 0
  return words.map((w, i) => {
    const a = seg.start + (dur * acc) / total
    acc += weights[i]
    const b = seg.start + (dur * acc) / total
    return { s: a, e: Math.max(b, a + 0.08), text: w }
  })
}

function captionUnits(segments: SubtitleSegment[], mode: CaptionWordMode): CaptionUnit[] {
  const clean = segments
    .filter((s) => s.end > s.start && s.text.trim())
    .sort((a, b) => a.start - b.start)
    .map((s) => ({ ...s, text: s.text.replace(/\s*\n+\s*/g, ' ').trim() }))
  if (mode === 'karaoke') {
    return clean.map((s) => ({ start: s.start, end: s.end, text: s.text, words: wordTimings(s) }))
  }
  if (mode === 'single') {
    const out: CaptionUnit[] = []
    for (const s of clean) {
      for (const w of wordTimings(s)) out.push({ start: w.s, end: w.e, text: w.text })
    }
    return out
  }
  return splitLongSegments(clean, 5).map((s) => ({ start: s.start, end: s.end, text: s.text }))
}

let measureCtx: CanvasRenderingContext2D | null = null
function measureWordOffsets(
  words: string[],
  fontSize: number,
  fontFamily: string,
  fontWeight: number,
  letterSpacing: number
): { x: number; w: number }[] {
  if (typeof document === 'undefined') return []
  try {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
    if (!measureCtx) return []
    measureCtx.font = `${fontWeight} ${fontSize}px "${fontFamily}"`
    const space = measureCtx.measureText(' ').width + letterSpacing
    const out: { x: number; w: number }[] = []
    let x = 0
    for (const word of words) {
      const w = measureCtx.measureText(word).width
      out.push({ x, w })
      x += w + space
    }
    return out
  } catch {
    return []
  }
}

function measureLineWidths(
  text: string,
  fontSize: number,
  fontFamily: string,
  fontWeight: number,
  letterSpacing: number
): number[] {
  if (typeof document === 'undefined') return []
  try {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
    if (!measureCtx) return []
    measureCtx.font = `${fontWeight} ${fontSize}px "${fontFamily}"`
    const ls = letterSpacing
    const lines = sanitizeCaptionText(text).split('\n')
    const widths = lines.map((line) => {
      const base = measureCtx!.measureText(line).width
      return base + ls * Math.max(0, line.length - 1)
    })
    return widths
  } catch {
    return []
  }
}

function buildCaptionText(preset: CaptionPreset, unit: CaptionUnit, dur: number): TextData {
  const fx = preset.fx
  const base: TextData = {
    text: unit.text,
    fontSize: fx.fontSize ?? 48,
    color: fx.color ?? '#ffffff',
    bgColor: fx.bgColor ?? 'rgba(0,0,0,0.55)',
    fontFamily: fx.fontFamily ?? 'Helvetica Neue',
    x: fx.x ?? 0.5,
    y: fx.y ?? 0.88,
    fontWeight: fx.fontWeight ?? 500,
    italic: fx.italic ?? false,
    underline: fx.underline ?? false,
    letterSpacing: fx.letterSpacing ?? 0.5,
    lineHeight: fx.lineHeight ?? 1.25,
    strokeColor: fx.strokeColor ?? 'transparent',
    strokeWidth: fx.strokeWidth ?? 0,
    shadowColor: fx.shadowColor ?? 'rgba(0,0,0,0.5)',
    shadowBlur: fx.shadowBlur ?? 8,
    shadowX: fx.shadowX ?? 0,
    shadowY: fx.shadowY ?? 2,
    align: fx.align ?? 'center',
    opacity: fx.opacity ?? 1,
    animIn: fx.animIn ?? 'fade',
    animOut: fx.animOut ?? 'fade',
    animDuration: Math.min(fx.animDuration ?? 0.2, Math.max(0.1, dur / 2)),
    captionStyle: preset.id
  }
  base.lineWs = measureLineWidths(unit.text, base.fontSize, base.fontFamily, base.fontWeight ?? 500, base.letterSpacing ?? 0)
  base.lineWsFor = sanitizeCaptionText(unit.text)
  if (preset.wordMode === 'karaoke' && unit.words?.length) {
    const offsets = measureWordOffsets(
      unit.words.map((w) => w.text),
      base.fontSize,
      base.fontFamily,
      base.fontWeight ?? 500,
      base.letterSpacing ?? 0
    )
    base.words = unit.words.map((w, i) => ({
      s: Math.max(0, w.s - unit.start),
      e: Math.min(dur, w.e - unit.start),
      text: w.text,
      x: offsets[i]?.x,
      w: offsets[i]?.w
    }))
    base.highlightColor = fx.highlightColor ?? '#ffd60a'
    base.wordScale = fx.wordScale ?? 1.1
  }
  return base
}

function trimSubtitleOverlaps(clips: Clip[], mainId: string): { clips: Clip[]; changed: boolean } {
  const mine = clips.filter((c) => c.kind === 'text' && c.trackId === mainId).sort((a, b) => a.start - b.start)
  const durMap = new Map<string, number>()
  for (let i = 0; i < mine.length - 1; i++) {
    const c = mine[i]
    const next = mine[i + 1]
    if (c.start + c.duration > next.start + 0.001) {
      durMap.set(c.id, Math.max(0.1, next.start - c.start))
    }
  }
  if (!durMap.size) return { clips, changed: false }
  let changed = false
  const out = clips.map((c) => {
    const d = durMap.get(c.id)
    if (d === undefined || Math.abs(d - c.duration) < 0.001) return c
    changed = true
    return { ...c, duration: d }
  })
  return { clips: out, changed }
}

// fix: stop captions from quietly spawning one track per clip again
/**
 * Alles → één Subtitles-track (id `subtitles`), lookalikes van Video* ophalen,
 * lege/extra Subtitles*-tracks eruit, overlappingen trimmen. Atomisch.
 *
 * `legacy` is alleen voor het inladen van een bestaand project. De
 * positieheuristiek uit `isSubtitleClip` noemt élke titel onder y=0.85 met een
 * kleine font een ondertitel — handig om oude projecten te repareren, maar
 * verder niets waard: hij verhuisde gewone titels (credits, tickers) stilletjes
 * naar de Subtitles-track, waarna ze niet meer te slepen waren. Dat hoort bij
 * migratie, niet bij iets dat élke clips-wijziging opnieuw mag doen.
 */
function normalizeSubtitleTracks(
  tracks: Track[],
  clips: Clip[],
  opts?: { legacy?: boolean }
): { tracks: Track[]; clips: Clip[] } {
  const subTracks = tracks.filter((t) => t.kind === 'video' && SUB_TRACK_RE.test(t.name))
  const subIds = new Set(subTracks.map((t) => t.id))
  // Migratie (alleen bij inladen): zonder captionStyle in het project is dit een
  // echt oud project en is de positiecheck het enige houvast. Zijn er wél
  // captions met captionStyle, dan is het project modern en zou de positiecheck
  // gewone titels (credits, tickers) onterecht verhuizen.
  const anyStyled = clips.some((c) => c.kind === 'text' && c.text?.captionStyle)
  const useLegacy = !!opts?.legacy && !anyStyled
  const lookClips = useLegacy
    ? clips.filter((c) => looksLikeLegacySubtitle(c, subIds))
    : clips.filter((c) => isSubtitleClip(c, subIds))
  const extraSubs = subTracks.filter((t) => t.id !== SUB_MAIN_ID && t.name !== 'Subtitles')
  const mainOnSubs = subTracks.find((t) => t.name === 'Subtitles' && t.id === SUB_MAIN_ID)
    ?? subTracks.find((t) => t.name === 'Subtitles')
    ?? subTracks[0]

  const needsTrack = lookClips.length > 0 || subTracks.length > 0
  if (!needsTrack) return { tracks, clips }

  let nextTracks = tracks
  let main: Track
  if (mainOnSubs && mainOnSubs.id === SUB_MAIN_ID && mainOnSubs.name === 'Subtitles' && subTracks.length === 1) {
    main = mainOnSubs
    const orphanLook = lookClips.some((c) => c.trackId !== SUB_MAIN_ID)
    const trimmedEarly = (() => {
      const r = trimSubtitleOverlaps(clips, SUB_MAIN_ID)
      return r.changed
    })()
    if (!orphanLook && !trimmedEarly) return { tracks, clips }
  } else if (mainOnSubs) {
    // bestaande hoofdtrack behouden (id behouden zodat clips kloppen), naam → Subtitles
    main = mainOnSubs.name === 'Subtitles' ? mainOnSubs : { ...mainOnSubs, name: 'Subtitles' }
    nextTracks = tracks.map((t) => (t.id === main.id ? main : t))
  } else {
    main = { id: SUB_MAIN_ID, name: 'Subtitles', kind: 'video', muted: false, hidden: false }
    nextTracks = [...tracks, main]
  }

  const drop = new Set(subTracks.filter((t) => t.id !== main.id).map((t) => t.id))
  if (drop.size || extraSubs.length) {
    nextTracks = nextTracks.filter((t) => !drop.has(t.id) && !(SUB_TRACK_RE.test(t.name) && t.id !== main.id && t.kind === 'video'))
  }
  // garandeer exact één Subtitles-track met main.id
  if (!nextTracks.some((t) => t.id === main.id)) {
    nextTracks = [...nextTracks, main]
  }

  // Alleen clips die hier daadwerkelijk onder vallen verhuizen — dezelfde
  // selectie als `lookClips` hierboven, anders vond de remap wél titels en die
  // belandden alsnog op de Subtitles-track.
  const subsToMove = new Set(lookClips.map((c) => c.id))
  const remapped = clips.map((c) =>
    subsToMove.has(c.id) && c.trackId !== main.id ? { ...c, trackId: main.id } : c
  )
  const { clips: trimmed, changed } = trimSubtitleOverlaps(remapped, main.id)
  const trackChanged = nextTracks.length !== tracks.length || nextTracks.some((t, i) => t !== tracks[i])
  const clipChanged = trimmed.some((c, i) => c !== clips[i]) || trimmed.length !== clips.length
  if (!trackChanged && !clipChanged) return { tracks, clips }
  return { tracks: orderTracks(nextTracks), clips: trimmed }
}

export const selectTotal = (s: EditorState): number =>
  s.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0)

const STORAGE_KEY = 'sa-premier-v1'

function loadPersisted(): Partial<EditorState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<EditorState>
    if (!p.assets || !p.clips || !p.tracks) return null
    return p
  } catch {
    return null
  }
}

const persisted = typeof window !== 'undefined' ? loadPersisted() : null
const persistedNorm = persisted
  ? (() => {
      const n = normalizeSubtitleTracks(persisted.tracks ?? initialTracks(), persisted.clips ?? [], { legacy: true })
      return { ...persisted, tracks: orderTracks(n.tracks), clips: n.clips }
    })()
  : null

export const useEditorStore = create<EditorState>()(
  subscribeWithSelector((set, get) => ({
    project: persistedNorm?.project ?? { name: 'Untitled Project', width: 1920, height: 1080, fps: 30 },
    assets: persistedNorm?.assets ?? [],
    tracks: persistedNorm?.tracks ?? initialTracks(),
    clips: persistedNorm?.clips ?? [],
    selectedClipId: null,
    playhead: persistedNorm?.playhead ?? 0,
    playing: false,
    zoom: 1,
    mediaIssues: [],

    addAssets: (assets) => set((s) => {
      // de-dupe op path — voorkomt dubbele saves als zelfde file 2x geïmporteerd wordt
      const existing = new Set(s.assets.map((a) => a.path))
      const deduped = assets.filter((a) => !existing.has(a.path))
      if (!deduped.length) return s
      return { assets: [...s.assets, ...deduped] }
    }),

    updateAsset: (assetId, patch) =>
      set((s) => {
        const assets = s.assets.map((a) => (a.id === assetId ? { ...a, ...patch } : a))
        const old = s.assets.find((a) => a.id === assetId)
        const clips =
          old && patch.path && patch.path !== old.path
            ? s.clips.map((c) => (c.assetId === assetId ? { ...c, assetPath: patch.path! } : c))
            : s.clips
        return { assets, clips }
      }),

    setMediaIssues: (issues) => set({ mediaIssues: issues }),

    removeAsset: (assetId) =>
      set((s) => ({
        assets: s.assets.filter((a) => a.id !== assetId),
        clips: s.clips.filter((c) => c.assetId !== assetId)
      })),

    addTrack: (kind) => {
      const idx = get().tracks.filter((t) => t.kind === kind).length + 1
      const track = makeTrack(uid(), `${kind === 'video' ? 'Video' : 'Audio'} ${idx}`, kind)
      set((s) => ({ tracks: orderTracks([...s.tracks, track]) }))
      return track.id
    },

    removeTrack: (trackId) =>
      set((s) => ({
        tracks: s.tracks.filter((t) => t.id !== trackId),
        clips: s.clips.filter((c) => c.trackId !== trackId),
        selectedClipId: s.selectedClipId && s.clips.some((c) => c.id === s.selectedClipId) ? s.selectedClipId : null
      })),

    setTrackMuted: (trackId, muted) =>
      set((s) => ({ tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, muted } : t)) })),

    setTrackHidden: (trackId, hidden) =>
      set((s) => ({ tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, hidden } : t)) })),

    setTrackLocked: (trackId: string, locked: boolean) =>
      set((s) => ({ tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, locked } : t)) })),

    setProjectResolution: (width, height) =>
      set((s) => ({ project: { ...s.project, width, height } })),

    setProjectName: (name) => set((s) => ({ project: { ...s.project, name } })),

    addClip: (assetId, trackId, start) => {
      const { assets, tracks, clips } = get()
      const asset = assets.find((a) => a.id === assetId)
      if (!asset) return
      const wantKind: TrackKind = asset.type === 'audio' ? 'audio' : 'video'
      // audio → alleen audio-track; video → alleen video-track (nooit omwisselen)
      let track = tracks.find((t) => t.id === trackId && t.kind === wantKind)
      if (!track) track = tracks.find((t) => t.kind === wantKind)
      let extraTracks: Track[] | null = null
      if (!track) {
        // geen passende track → aanmaken i.p.v. op verkeerde track plaatsen
        const idx = tracks.filter((t) => t.kind === wantKind).length + 1
        track = makeTrack(uid(), `${wantKind === 'video' ? 'Video' : 'Audio'} ${idx}`, wantKind)
        extraTracks = orderTracks([...tracks, track])
      }
      const roundedStart = Math.max(0, start)
      // voorkom dubbele clip op zelfde track/tijd/asset (double-play bug)
      const exists = clips.some((c) => c.assetId === assetId && c.trackId === track!.id && Math.abs(c.start - roundedStart) < 0.02 && Math.abs(c.duration - (asset.duration > 0 ? asset.duration : 5)) < 0.02)
      if (exists) return
      const clip: Clip = {
        id: uid(),
        assetId: asset.id,
        assetPath: asset.path,
        trackId: track.id,
        start: roundedStart,
        duration: asset.duration > 0 ? asset.duration : 5,
        sourceStart: 0,
        volume: 1,
        effects: { ...DEFAULT_EFFECTS },
        transitionIn: null,
        transitionOut: null,
        kind: asset.type
      }
      set((s) => ({
        tracks: extraTracks ?? s.tracks,
        clips: [...s.clips, clip],
        selectedClipId: clip.id
      }))
    },

    /**
     * Echte extractie: ffmpeg haalt de audiotrack uit de video naar een m4a in
     * de projectmap, dat bestand wordt een nieuw asset en de clip landt
     * uitgelijnd onder de videoclip op een audiotrack. De `extractedFromAssetId`
     * zorgt dat de video zelf voortaan stil is (geen dubbel geluid).
     */
    extractAudioToTrack: async (assetId, sourceClipId) => {
      const s = get()
      const asset = s.assets.find((a) => a.id === assetId)
      if (!asset) return { ok: false, error: 'Media niet gevonden in de bibliotheek.' }
      if (asset.type === 'audio') return { ok: false, error: 'Dit is al een audiobestand.' }
      if (!asset.hasAudio) return { ok: false, error: 'Deze video bevat geen audiotrack.' }

      const source = sourceClipId
        ? s.clips.find((c) => c.id === sourceClipId)
        : s.clips.find((c) => c.assetId === assetId && c.kind === 'video')
      const start = source ? Math.max(0, source.start) : Math.max(0, s.playhead)
      const sourceStart = source?.sourceStart ?? 0
      const duration = source && source.duration > 0 ? source.duration : asset.duration > 0 ? asset.duration : 0
      const sameSpot = (c: Clip): boolean => Math.abs(c.start - start) < 0.02

      // Klaar? Dan moet de clip naar een ECHT bestand wijzen (assetId != video).
      // De companion-clip uit de import wijst nog naar de video zelf en telt dus niet mee.
      const done = s.clips.find(
        (c) => c.kind === 'audio' && c.extractedFromAssetId === assetId && c.assetId !== assetId && sameSpot(c)
      )
      if (done) {
        set({ selectedClipId: done.id })
        return { ok: true, alreadyExisted: true, clipId: done.id, assetId: done.assetId, trackId: done.trackId }
      }

      let r: { ok?: boolean; outPath?: string; name?: string; error?: string }
      try {
        r = await window.api.extractAudioAuto(asset.path, {
          start: sourceStart,
          duration: duration > 0 ? duration : undefined,
          name: asset.name.replace(/\.[a-z0-9]+$/i, '')
        })
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
      if (!r.ok || !r.outPath) return { ok: false, error: r.error ?? 'Audio extraheren mislukt.' }

      const newAsset: Asset = {
        id: uid(),
        name: r.name ?? `${asset.name}.m4a`,
        path: r.outPath,
        type: 'audio',
        duration: duration > 0 ? duration : asset.duration,
        hasAudio: true
      }

      // Companion-clip van de import (dezelfde video als bron) vervangen in plaats
      // van er een tweede bij te zetten — anders twee clips met hetzelfde geluid.
      const companion = s.clips.find((c) => c.kind === 'audio' && c.assetId === assetId && sameSpot(c))
      let trackId = companion?.trackId
      if (!trackId || !s.tracks.some((t) => t.id === trackId && t.kind === 'audio')) {
        let track = get().tracks.find((t) => t.kind === 'audio')
        if (!track) {
          get().addTrack('audio')
          track = get().tracks.find((t) => t.kind === 'audio')
        }
        trackId = track?.id
      }
      if (!trackId) return { ok: false, error: 'Kon geen audiotrack aanmaken.' }

      get().addAssets([newAsset])

      if (companion) {
        useEditorStore.setState((st) => ({
          clips: st.clips.map((c) =>
            c.id === companion.id
              ? { ...c, assetId: newAsset.id, assetPath: newAsset.path, extractedFromAssetId: assetId }
              : c
          ),
          selectedClipId: companion.id
        }))
        return { ok: true, clipId: companion.id, assetId: newAsset.id, outPath: newAsset.path, trackId }
      }

      const clip: Clip = {
        id: uid(),
        assetId: newAsset.id,
        assetPath: newAsset.path,
        trackId,
        start,
        duration: duration > 0 ? duration : 5,
        sourceStart,
        volume: source?.volume ?? 1,
        effects: { ...DEFAULT_EFFECTS },
        transitionIn: null,
        transitionOut: null,
        kind: 'audio',
        extractedFromAssetId: assetId
      }
      set((st) => ({ clips: [...st.clips, clip], selectedClipId: clip.id }))
      return { ok: true, clipId: clip.id, assetId: newAsset.id, outPath: newAsset.path, trackId }
    },

    setClipAudioFx: (clipId, patch) => {
      set((s) => ({
        clips: s.clips.map((c) =>
          c.id === clipId
            ? { ...c, audioFx: { ...DEFAULT_AUDIO_EFFECTS, ...(c.audioFx ?? {}), ...patch } }
            : c
        )
      }))
    },

    resetTrackAudioFx: (trackId) => {
      set((s) => ({
        clips: s.clips.map((c) =>
          c.trackId === trackId ? { ...c, audioFx: { ...DEFAULT_AUDIO_EFFECTS }, volume: 1 } : c
        )
      }))
    },

    addTextClip: (trackId, start, text) => {
      const { tracks } = get()
      let track = tracks.find((t) => t.id === trackId)
      if (!track || track.kind !== 'video') track = tracks.find((t) => t.kind === 'video')
      if (!track) return
      const clip: Clip = {
        id: uid(),
        assetId: '',
        assetPath: '',
        trackId: track.id,
        start: Math.max(0, start),
        duration: 5,
        sourceStart: 0,
        volume: 1,
        effects: { ...DEFAULT_EFFECTS },
        transitionIn: null,
        transitionOut: null,
        kind: 'text',
        text: {
          text: text.text ?? 'Title',
          fontSize: text.fontSize ?? 96,
          color: text.color ?? '#ffffff',
          bgColor: text.bgColor ?? 'transparent',
          fontFamily: text.fontFamily ?? 'Helvetica Neue',
          x: text.x ?? 0.5,
          y: text.y ?? 0.5,
          fontWeight: text.fontWeight ?? 700,
          italic: text.italic ?? false,
          underline: text.underline ?? false,
          letterSpacing: text.letterSpacing ?? 0,
          lineHeight: text.lineHeight ?? 1.2,
          strokeColor: text.strokeColor ?? 'transparent',
          strokeWidth: text.strokeWidth ?? 0,
          shadowColor: text.shadowColor ?? 'rgba(0,0,0,0.5)',
          shadowBlur: text.shadowBlur ?? 12,
          shadowX: text.shadowX ?? 0,
          shadowY: text.shadowY ?? 4,
          align: text.align ?? 'center',
          opacity: text.opacity ?? 1,
          animIn: text.animIn ?? 'fade',
          animOut: text.animOut ?? 'fade',
          animDuration: text.animDuration ?? 0.45,
          // Doorgegeven zodat een clip die via captionStyle is gemaakt herkenbaar
          // blijft als ondertitel; zonder dit raakte hij zijn stijl-id kwijt.
          ...(text.captionStyle ? { captionStyle: text.captionStyle } : {})
        }
      }
      set((s) => ({ clips: [...s.clips, clip], selectedClipId: clip.id }))
    },

    addSubtitleClips: (language, segments, opts) => {
      const timeOffset = Math.max(0, opts?.timeOffset ?? 0)
      const replace = opts?.replace ?? true
      void language
      const state = get()

      // altijd exact één vaste Subtitles-track
      const subTracks = state.tracks.filter((t) => t.kind === 'video' && SUB_TRACK_RE.test(t.name))
      const subIds = new Set(subTracks.map((t) => t.id))
      let track: Track =
        subTracks.find((t) => t.id === SUB_MAIN_ID) ??
        subTracks.find((t) => t.name === 'Subtitles') ??
        subTracks[0] ??
        { id: SUB_MAIN_ID, name: 'Subtitles', kind: 'video', muted: false, hidden: false }
      if (track.name !== 'Subtitles') track = { ...track, name: 'Subtitles' }

      const styleId = opts?.styleId
      const preset =
        (styleId ? CAPTION_PRESETS.find((p) => p.id === styleId) : undefined) ??
        CAPTION_PRESETS.find((p) => p.id === 'cap-standard') ??
        CAPTION_PRESETS[0]
      const wordMode = opts?.wordMode ?? preset.wordMode
      const sorted = captionUnits(segments, wordMode)
      const newClips: Clip[] = sorted.map((u, i) => {
        const start = Math.max(0, timeOffset + u.start)
        let end = timeOffset + u.end
        const next = sorted[i + 1]
        if (next) {
          const nextStart = timeOffset + next.start
          if (end > nextStart) end = nextStart
        }
        const dur = Math.max(0.15, end - start)
        return {
          id: uid(),
          assetId: '',
          assetPath: '',
          trackId: track.id,
          start,
          duration: dur,
          sourceStart: 0,
          volume: 1,
          effects: { ...DEFAULT_EFFECTS },
          transitionIn: null,
          transitionOut: null,
          kind: 'text' as const,
          subtitle: true,
          text: buildCaptionText({ ...preset, wordMode }, { ...u, start: timeOffset + u.start }, dur)
        }
      })

      // één set(): vervang subtitle-clips overal + zet main-track + nieuwe clips
      let nextTracks = state.tracks
      if (!nextTracks.some((t) => t.id === track.id)) {
        nextTracks = [...nextTracks, track]
      }
      nextTracks = nextTracks.map((t) => (t.id === track.id ? track : t))
      // extra Subtitles*-tracks eruit
      nextTracks = nextTracks.filter(
        (t) => !(t.kind === 'video' && SUB_TRACK_RE.test(t.name) && t.id !== track.id)
      )

      const dropIds = new Set(state.tracks.filter((t) => t.id !== track.id && subIds.has(t.id)).map((t) => t.id))
      let nextClips = state.clips
      if (replace) {
        // alle oude subtitle-clips wippen (ook die verkeerd op Video* liggen)
        nextClips = nextClips.filter((c) => !(c.kind === 'text' && (subIds.has(c.trackId) || isSubtitleClip(c, subIds))))
      } else {
        nextClips = nextClips.map((c) =>
          c.kind === 'text' && (dropIds.has(c.trackId) || (subIds.has(c.trackId) && c.trackId !== track.id))
            ? { ...c, trackId: track.id }
            : c
        )
        // één track = één zichtbare taal: clips die met de nieuwe overlappen worden vervangen
        nextClips = nextClips.filter((c) => {
          if (c.kind !== 'text' || c.trackId !== track.id) return true
          const from = c.start
          const to = c.start + c.duration
          return !newClips.some((n) => from < n.start + n.duration - 0.001 && to > n.start + 0.001)
        })
      }
      nextClips = [...nextClips, ...newClips]

      const norm = normalizeSubtitleTracks(nextTracks, nextClips)
      set({ tracks: norm.tracks, clips: norm.clips })
      return track.id
    },

    updateClip: (id, patch) =>
      set((s) => ({
        clips: s.clips.map((c) => {
          if (c.id !== id) return c
          // harde invariant: ondertitel-clips blijven altijd op de Subtitles-track
          if (c.subtitle && patch.trackId) {
            const sub = s.tracks.find((t) => t.kind === 'video' && SUB_TRACK_RE.test(t.name))
            const { trackId: _ignored, ...rest } = patch
            return { ...c, ...rest, trackId: sub?.id ?? c.trackId }
          }
          const next = { ...c, ...patch }
          if (next.text && (patch.text || patch.kind === 'text')) {
            const t = next.text
            const measureKeys: Array<keyof TextData> = ['text', 'fontSize', 'fontFamily', 'fontWeight', 'letterSpacing']
            if (measureKeys.some((k) => k in patch.text!)) {
              const clean = sanitizeCaptionText(t.text)
              next.text = {
                ...t,
                lineWs: measureLineWidths(clean, t.fontSize, t.fontFamily, t.fontWeight ?? 500, t.letterSpacing ?? 0),
                lineWsFor: clean
              }
            }
          }
          // audio clips mogen nooit op een videotrack (en vice versa)
          if (patch.trackId) {
            const target = s.tracks.find((t) => t.id === next.trackId)
            if (!target) return c
            const want = next.kind === 'audio' ? 'audio' : 'video'
            if (target.kind !== want) return c
          }
          return next
        })
      })),

    // fix: dragging one caption no longer kidnaps 45 others without consent
    moveSubtitleGroup: (id, newStart) => {
      const state = get()
      const anchor = state.clips.find((c) => c.id === id)
      if (!anchor || anchor.kind !== 'text') return
      const subIds = new Set(
        state.tracks.filter((t) => t.kind === 'video' && SUB_TRACK_RE.test(t.name)).map((t) => t.id)
      )
      if (!isSubtitleClip(anchor, subIds)) return
      const delta = newStart - anchor.start
      if (Math.abs(delta) < 0.0005) return
      let min = Infinity
      for (const c of state.clips) if (isSubtitleClip(c, subIds)) min = Math.min(min, c.start)
      const clampedDelta = Math.max(delta, -min)
      if (Math.abs(clampedDelta) < 0.0005) return
      set((s) => ({
        clips: s.clips.map((c) =>
          isSubtitleClip(c, subIds)
            ? { ...c, start: Math.max(0, Math.round((c.start + clampedDelta) * 10000) / 10000) }
            : c
        )
      }))
    },

    moveSubtitlePosition: (dx, dy) => {
      const state = get()
      const subIds = subtitleIdsOf(state)
      if (!subIds.size) return
      set((s) => ({
        clips: s.clips.map((c) =>
          isSubtitleClip(c, subIds) && c.text
            ? {
                ...c,
                text: {
                  ...c.text,
                  x: clamp01(c.text.x + dx),
                  y: clamp01(c.text.y + dy)
                }
              }
            : c
        )
      }))
    },

    /**
     * Eén tekstclip over het scherm slepen (titels, quotes, stickers).
     *
     * Alleen échte ondertitels zijn hiervan uitgesloten: die horen bij elkaar te
     * staan en gaan via `moveSubtitlePosition`. Let op dat de check op het
     * expliciete `subtitle`-vlaggetje en de Subtitles-track draait, en NIET op de
     * legacy-positieheuristiek uit `isSubtitleClip` — die vond elke titel onder
     * y=0.85 met een kleine font een ondertitel, waardoor een gewone titel
     * stilzwijgend niet versleepbaar was.
     */
    moveTextClipPosition: (clipId, dx, dy) => {
      const clip = get().clips.find((c) => c.id === clipId)
      if (!clip || clip.kind !== 'text' || !clip.text) return
      if (isRealSubtitle(clip, get().tracks)) return
      set((s) => ({
        clips: s.clips.map((c) =>
          c.id === clipId && c.text
            ? { ...c, text: { ...c.text, x: clamp01(c.text.x + dx), y: clamp01(c.text.y + dy) } }
            : c
        )
      }))
    },

    setSubtitlePosition: (x, y) => {
      const state = get()
      const subIds = subtitleIdsOf(state)
      if (!subIds.size) return
      set((s) => ({
        clips: s.clips.map((c) =>
          isSubtitleClip(c, subIds) && c.text
            ? { ...c, text: { ...c.text, x: clamp01(x), y: clamp01(y) } }
            : c
        )
      }))
    },

    setSubtitleProps: (patch) => {
      const state = get()
      const subIds = subtitleIdsOf(state)
      if (!subIds.size) return 0
      let n = 0
      set((s) => ({
        clips: s.clips.map((c) => {
          if (!isSubtitleClip(c, subIds) || !c.text) return c
          n++
          const next = { ...c.text, ...patch }
          if (patch.fontSize !== undefined && c.text.words) {
            const scaled = measureWordOffsets(
              c.text.words.map((w) => w.text),
              next.fontSize,
              next.fontFamily,
              next.fontWeight ?? 500,
              next.letterSpacing ?? 0
            )
            next.words = c.text.words.map((w, i) => ({ ...w, x: scaled[i]?.x, w: scaled[i]?.w }))
          }
          return { ...c, text: next }
        })
      }))
      return n
    },

    resetSubtitleStyle: (styleId) => {
      const preset = CAPTION_PRESETS.find((p) => p.id === styleId)
      if (!preset) return 0
      return get().setSubtitleStyle(preset.id) > 0 ? get().setSubtitleProps({ ...preset.fx, captionStyle: preset.id }) : 0
    },

    clearSubtitles: () => {
      const state = get()
      const subTrackIds = new Set(
        state.tracks
          .filter((t) => t.kind === 'video' && SUB_TRACK_RE.test(t.name))
          .map((t) => t.id)
      )
      // Alleen échte ondertitels: vlag, Subtitles-track of captionStyle. De
      // legacy-positiecheck zou hier een gewone credits-titel meenemen en die
      // zomaar wissen — 'wis ondertitels' mag geen titels raken.
      const isSub = (c: Clip): boolean =>
        c.kind === 'text' && (c.subtitle === true || subTrackIds.has(c.trackId) || !!c.text?.captionStyle)
      const removed = state.clips.filter(isSub)
      if (!removed.length && !subTrackIds.size) return 0
      const removedIds = new Set(removed.map((c) => c.id))
      set((s) => ({
        clips: s.clips.filter((c) => !isSub(c)),
        tracks: s.tracks.filter(
          (t) => !(t.kind === 'video' && SUB_TRACK_RE.test(t.name))
        ),
        selectedClipId:
          s.selectedClipId && removedIds.has(s.selectedClipId) ? null : s.selectedClipId
      }))
      return removed.length
    },

    // One subtitles track, forever. The caption engine is still ~2 months from
    // "feels native" — today it just refuses to scatter.
    consolidateSubtitles: () => {
      const s = get()
      const subIds = subtitleIdsOf(s)
      // oude clips (of handmatig bewerkte tekst) hebben geen gemeten lijnbreedtes → aanvullen
      let measured = false
      const withMetrics = s.clips.map((c) => {
        if (!isSubtitleClip(c, subIds) || !c.text) return c
        const clean = sanitizeCaptionText(c.text.text)
        const fresh =
          c.text.lineWsFor === clean &&
          c.text.lineWs &&
          c.text.lineWs.length === clean.split('\n').length &&
          c.text.fontSize === c.text.fontSize
        if (fresh) return c
        const lineWs = measureLineWidths(clean, c.text.fontSize, c.text.fontFamily, c.text.fontWeight ?? 500, c.text.letterSpacing ?? 0)
        if (!lineWs.length) return c
        measured = true
        return { ...c, text: { ...c.text, lineWs, lineWsFor: clean } }
      })
      if (measured) set({ clips: withMetrics })
      const norm = normalizeSubtitleTracks(s.tracks, measured ? withMetrics : s.clips)
      if (norm.tracks !== s.tracks || norm.clips !== s.clips) {
        set({ tracks: norm.tracks, clips: norm.clips })
      }
    },

    setSubtitleStyle: (styleId) => {
      const preset = CAPTION_PRESETS.find((p) => p.id === styleId)
      if (!preset) return 0
      const s = get()
      const subIds = new Set(
        s.tracks.filter((t) => t.kind === 'video' && SUB_TRACK_RE.test(t.name)).map((t) => t.id)
      )
      const subs = s.clips.filter((c) => isSubtitleClip(c, subIds))
      if (!subs.length) return 0

      // groepeer: clips met een gedeelde groupId vormen één zin; overige korte clips die
      // aan elkaar vastzitten (legacy woord-modus) worden alsnog tot zinnen samengevoegd
      const sorted = [...subs].sort((a, b) => a.start - b.start)
      const groups: Clip[][] = []
      const claimed = new Set<string>()
      const byGid = new Map<string, Clip[]>()
      for (const c of sorted) {
        const gid = c.text!.groupId
        if (!gid) continue
        const arr = byGid.get(gid) ?? []
        arr.push(c)
        byGid.set(gid, arr)
      }
      for (const [gid, arr] of byGid) {
        if (arr.length < 2) continue
        groups.push([...arr].sort((a, b) => a.start - b.start))
        for (const c of arr) claimed.add(c.id)
        void gid
      }
      let run: Clip[] = []
      let runDur = 0
      let runChars = 0
      const MAX_SENT = 3.5
      const MAX_CHARS = 55
      for (const c of sorted) {
        if (claimed.has(c.id)) continue
        const prev = run[run.length - 1]
        const adjacent = prev ? c.start - (prev.start + prev.duration) < 0.35 : false
        const chars = c.text!.text.trim().length
        if (run.length && c.duration < 1.5 && adjacent && runDur + c.duration <= MAX_SENT && runChars + chars + 1 <= MAX_CHARS) {
          run.push(c)
          runDur += c.duration
          runChars += chars + 1
          continue
        }
        if (run.length) {
          groups.push(run)
          run = []
          runDur = 0
          runChars = 0
        }
        run.push(c)
        runDur = c.duration
        runChars = chars
      }
      if (run.length) groups.push(run)

      const byFirst = new Map<string, Clip>()
      for (const g of groups) byFirst.set(g[0].id, g[0])
      const emitted = new Set<string>()

      const keep: Clip[] = []
      for (const c of s.clips) {
        if (!isSubtitleClip(c, subIds)) {
          keep.push(c)
          continue
        }
        if (!byFirst.has(c.id) || emitted.has(c.id)) continue
        const group = groups.find((g) => g[0].id === c.id) ?? [c]
        emitted.add(c.id)
        const head = group[0]
        const groupId = group.length > 1 && head.text!.groupId && group.every((x) => x.text!.groupId === head.text!.groupId) ? head.text!.groupId! : head.id
        const segStart = head.text!.segStart ?? group[0].start
        const segEnd = head.text!.segEnd ?? Math.max(...group.map((x) => x.start + x.duration))
        const segText = head.text!.segText ?? group.map((x) => x.text!.text.trim()).filter(Boolean).join(' ')
        if (preset.wordMode === 'single') {
          const seg: SubtitleSegment = { start: segStart, end: segEnd, text: segText }
          const words = group[0].text!.words?.length
            ? group[0].text!.words.map((w) => ({ start: segStart + w.s, end: segStart + w.e, text: w.text }))
            : undefined
          for (const u of captionUnits([{ ...seg, words }], 'single')) {
            const start = Math.max(segStart, u.start)
            const end = Math.min(segEnd, Math.max(u.end, start + 0.15))
            const dur = Math.max(0.15, end - start)
            keep.push({
              ...head,
              id: uid(),
              start,
              duration: dur,
              text: {
                ...buildCaptionText(preset, { ...u, start: segStart }, dur),
                groupId,
                segText,
                segStart,
                segEnd
              }
            })
          }
          continue
        }
        const dur = Math.max(0.15, segEnd - segStart)
        const unit: CaptionUnit =
          preset.wordMode === 'karaoke'
            ? {
                start: segStart,
                end: segEnd,
                text: segText,
                words: wordTimings({ start: segStart, end: segEnd, text: segText })
              }
            : { start: segStart, end: segEnd, text: segText }
        keep.push({
          ...head,
          id: groupId,
          start: segStart,
          duration: dur,
          text: {
            ...buildCaptionText(preset, unit, dur),
            groupId,
            segText,
            segStart,
            segEnd
          }
        })
      }
      const clips = keep.sort((a, b) => a.start - b.start)
      const norm = normalizeSubtitleTracks(s.tracks, clips)
      set({ clips: norm.clips, tracks: norm.tracks })
      return groups.length
    },

    removeClip: (id) =>
      set((s) => ({
        clips: s.clips.filter((c) => c.id !== id),
        selectedClipId: s.selectedClipId === id ? null : s.selectedClipId
      })),

    /**
     * Selecteer een clip. Bij een losse tekstclip springen we meteen naar die
     * clip: een titel kiezen doe je om hem te positioneren, en zonder de
     * playhead erbij is hij niet in beeld — dus niet te zien en niet te slepen.
     * Ondertitels en media laten we staan, die selecteer je om iets mee te doen.
     */
    selectClip: (id) => {
      if (!id) {
        set({ selectedClipId: null })
        return
      }
      const s = get()
      const c = s.clips.find((x) => x.id === id)
      if (c && c.kind === 'text' && c.text && !isRealSubtitle(c, s.tracks)) {
        const inside = s.playhead >= c.start && s.playhead < c.start + c.duration
        // net na het begin, zodat een in-animatie al bijna klaar is
        const head = Math.min(c.start + Math.max(0.1, c.duration * 0.05), c.start + c.duration - 0.05)
        set({ selectedClipId: id, playhead: inside ? s.playhead : Math.max(0, head) })
        return
      }
      set({ selectedClipId: id })
    },

    splitClip: (id, at) => {
      const { clips, playhead } = get()
      const orig = clips.find((c) => c.id === id)
      if (!orig) return
      const cutAt = at ?? playhead
      if (cutAt <= orig.start + 0.05 || cutAt >= orig.start + orig.duration - 0.05) return
      const firstDur = cutAt - orig.start
      const secondDur = orig.start + orig.duration - cutAt
      const isMedia = orig.kind === 'video' || orig.kind === 'audio'
      const secondSource = isMedia ? orig.sourceStart + firstDur : 0
      const first: Clip = { ...orig, duration: firstDur, transitionOut: null }
      const second: Clip = {
        ...orig,
        id: uid(),
        start: cutAt,
        duration: secondDur,
        sourceStart: secondSource,
        transitionIn: null
      }
      set((s) => ({
        clips: [...s.clips.filter((c) => c.id !== id), first, second],
        selectedClipId: second.id,
        playhead: cutAt
      }))
    },

    duplicateClip: (id) => {
      const { clips } = get()
      const orig = clips.find((c) => c.id === id)
      if (!orig) return
      const copy: Clip = {
        ...orig,
        id: uid(),
        start: orig.start + orig.duration + 0.1,
        effects: { ...orig.effects },
        transitionIn: null,
        transitionOut: null,
        text: orig.text ? { ...orig.text } : undefined
      }
      set((s) => ({ clips: [...s.clips, copy], selectedClipId: copy.id }))
    },

    addTransition: (fromId, type, duration) => {
      const { clips } = get()
      const from = clips.find((c) => c.id === fromId)
      if (!from) return
      const sameTrack = clips.filter((c) => c.trackId === from.trackId && c.id !== from.id)
      let next = sameTrack.filter((c) => c.start >= from.start + from.duration - 0.05).sort((a, b) => a.start - b.start)[0]
      if (!next) next = sameTrack.filter((c) => c.start >= from.start).sort((a, b) => a.start - b.start)[0]

      // standalone fades (ook zonder next clip)
      if (type === 'fadeIn') {
        set((s) => ({
          clips: s.clips.map((c) =>
            c.id === from.id ? { ...c, transitionIn: { type, duration } } : c
          )
        }))
        return
      }
      if (type === 'fadeOut') {
        set((s) => ({
          clips: s.clips.map((c) =>
            c.id === from.id ? { ...c, transitionOut: { type, duration } } : c
          )
        }))
        return
      }
      if (!next) {
        // fade zonder next → alleen out op deze clip
        set((s) => ({
          clips: s.clips.map((c) =>
            c.id === from.id ? { ...c, transitionOut: { type, duration } } : c
          )
        }))
        return
      }

      if (type === 'fade') {
        const newStart = from.start + from.duration
        set((s) => ({
          clips: s.clips.map((c) => {
            if (c.id === from.id) return { ...c, transitionOut: { type, duration } }
            if (c.id === next!.id) return { ...c, start: newStart, transitionIn: null }
            return c
          })
        }))
        return
      }

      // overlap-types: next clip schuift over de end van `from`
      const newStart = Math.max(0, from.start + from.duration - duration)
      set((s) => ({
        clips: s.clips.map((c) => {
          if (c.id === from.id) return { ...c, transitionOut: { type, duration } }
          if (c.id === next!.id) return { ...c, start: newStart, transitionIn: { type, duration } }
          return c
        })
      }))
    },

    clearTransition: (clipId) =>
      set((s) => ({
        clips: s.clips.map((c) =>
          c.id === clipId ? { ...c, transitionIn: null, transitionOut: null } : c
        )
      })),

    setPlayhead: (t) => set({ playhead: Math.max(0, t) }),

    seekTo: (t) => {
      const total = selectTotal(get())
      set({ playing: false, playhead: Math.max(0, Math.min(t, total)) })
    },

    setPlaying: (playing) => set({ playing }),

    setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.25, zoom)) }),

    resetProject: () => {
      localStorage.removeItem(STORAGE_KEY)
      try {
        // @ts-ignore file persistence
        window.api?.projectClear?.()
      } catch {
        // ignore
      }
      set({
        project: { name: 'Untitled Project', width: 1920, height: 1080, fps: 30 },
        assets: [],
        clips: [],
        tracks: initialTracks(),
        selectedClipId: null,
        playhead: 0,
        playing: false,
        mediaIssues: []
      })
    }
  }))
)

if (typeof window !== 'undefined') {
  // hydrate from file if available (takes precedence over localStorage)
  try {
    // @ts-ignore
    window.api?.projectLoad?.().then((data: SavedProject | null) => {
      if (data && Array.isArray(data.clips) && Array.isArray(data.assets)) {
        const n = normalizeSubtitleTracks(data.tracks ?? initialTracks(), data.clips, { legacy: true })
        useEditorStore.setState({
          project: data.project,
          assets: data.assets,
          clips: n.clips,
          tracks: orderTracks(n.tracks),
          playhead: data.playhead
        })
      }
    })
  } catch {
    // ignore
  }
  useEditorStore.subscribe((s, prev) => {
    if (s.playing) return
    const p = prev as EditorState | undefined
    if (p && s.project === p.project && s.assets === p.assets && s.clips === p.clips && s.tracks === p.tracks && s.playhead === p.playhead) return
    const toSave: SavedProject = {
      project: s.project,
      assets: s.assets,
      clips: s.clips,
      tracks: s.tracks,
      playhead: s.playhead
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
    } catch {
      // quota exceeded
    }
    try {
      // @ts-ignore file persistence - immediate so app close doesn't lose data
      window.api?.projectSave?.(toSave)
    } catch {
      // ignore
    }
  })
  // also flush on page unload
  window.addEventListener('beforeunload', () => {
    try {
      const s = useEditorStore.getState()
      const toSave: SavedProject = {
        project: s.project,
        assets: s.assets,
        clips: s.clips,
        tracks: s.tracks,
        playhead: s.playhead
      }
      // @ts-ignore
      window.api?.projectSave?.(toSave)
    } catch {
      // ignore
    }
  })
}
