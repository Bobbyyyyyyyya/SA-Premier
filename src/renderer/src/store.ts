import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Asset, Clip, SavedProject, SubtitleSegment, TextData, Track, TrackKind, TransitionType } from '../../shared/types'
import { DEFAULT_EFFECTS, TEXT_PRESETS, uid } from '../../shared/types'

export interface EditorState {
  project: { name: string; width: number; height: number; fps: number }
  assets: Asset[]
  tracks: Track[]
  clips: Clip[]
  selectedClipId: string | null
  playhead: number
  playing: boolean
  zoom: number

  addAssets: (assets: Asset[]) => void
  removeAsset: (assetId: string) => void
  addTrack: (kind: TrackKind) => string
  removeTrack: (trackId: string) => void
  setTrackMuted: (trackId: string, muted: boolean) => void
  setTrackHidden: (trackId: string, hidden: boolean) => void
  setTrackLocked: (trackId: string, locked: boolean) => void
  setProjectResolution: (width: number, height: number) => void
  setProjectName: (name: string) => void

  addClip: (assetId: string, trackId: string, start: number) => void
  addTextClip: (trackId: string, start: number, text: Partial<TextData>) => void
  /** Batch ondertitels op de gedeelde Subtitles-track — eerste call wipt, rest append. */
  addSubtitleClips: (
    language: string,
    segments: SubtitleSegment[],
    opts?: { timeOffset?: number; replace?: boolean }
  ) => string
  /** Verwijder alle ondertitel-clips (en lege Subtitles*-tracks) in één keer. */
  clearSubtitles: () => number
  updateClip: (id: string, patch: Partial<Clip>) => void
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

const initialTracks = (): Track[] => [makeTrack('v1', 'Video 1', 'video'), makeTrack('a1', 'Audio 1', 'audio')]

const SUB_TRACK_RE = /^Subtitles(\s*·\s*[A-Za-z-]+)?$/i

/** Alle Subtitles*-tracks mergen + text-clips op één track; overlappingen trimmen. */
function normalizeSubtitleTracks(tracks: Track[], clips: Clip[]): { tracks: Track[]; clips: Clip[] } {
  const subTracks = tracks.filter((t) => t.kind === 'video' && SUB_TRACK_RE.test(t.name))
  const subIds = new Set(subTracks.map((t) => t.id))
  const subClips = clips.filter((c) => c.kind === 'text' && subIds.has(c.trackId))
  if (subTracks.length <= 1 && !subClips.some((c) => !SUB_TRACK_RE.test(tracks.find((t) => t.id === c.trackId)?.name ?? ''))) {
    // al netjes: hooguit trimmen op één bestaande track
    if (subTracks.length <= 1) {
      const main = subTracks[0]
      if (!main || subClips.length < 2) return { tracks, clips }
      const sorted = [...subClips].sort((a, b) => a.start - b.start)
      const byId = new Map(sorted.map((c) => [c.id, c]))
      let changed = false
      const trimmed = sorted.map((c, i) => {
        const next = sorted[i + 1]
        if (next && c.start + c.duration > next.start + 0.001) {
          const dur = Math.max(0.1, next.start - c.start)
          if (Math.abs(dur - c.duration) > 0.001) {
            changed = true
            const t = byId.get(c.id)!
            byId.set(c.id, { ...t, duration: dur })
          }
        }
        return byId.get(c.id)!
      })
      if (!changed) return { tracks, clips }
      const trimMap = new Map(trimmed.map((c) => [c.id, c.duration]))
      return {
        tracks,
        clips: clips.map((c) => (trimMap.has(c.id) ? { ...c, duration: trimMap.get(c.id)! } : c))
      }
    }
  }

  let main = subTracks.find((t) => t.name === 'Subtitles') ?? subTracks[0]
  let nextTracks = tracks
  if (!main) {
    main = makeTrack(uid(), 'Subtitles', 'video')
    nextTracks = [...tracks, main]
  } else if (main.name !== 'Subtitles') {
    nextTracks = nextTracks.map((t) => (t.id === main.id ? { ...t, name: 'Subtitles' } : t))
  }
  const drop = new Set(subTracks.filter((t) => t.id !== main.id).map((t) => t.id))
  if (drop.size) nextTracks = nextTracks.filter((t) => !drop.has(t.id))

  const remapped = clips.map((c) =>
    c.kind === 'text' && (subIds.has(c.trackId) || drop.has(c.trackId)) ? { ...c, trackId: main.id } : c
  )
  const mine = remapped.filter((c) => c.kind === 'text' && c.trackId === main.id).sort((a, b) => a.start - b.start)
  const durMap = new Map<string, number>()
  for (let i = 0; i < mine.length; i++) {
    const c = mine[i]
    const next = mine[i + 1]
    if (next && c.start + c.duration > next.start + 0.001) {
      durMap.set(c.id, Math.max(0.1, next.start - c.start))
    }
  }
  const outClips = durMap.size
    ? remapped.map((c) => (durMap.has(c.id) ? { ...c, duration: durMap.get(c.id)! } : c))
    : remapped
  return { tracks: nextTracks, clips: outClips }
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
      const n = normalizeSubtitleTracks(persisted.tracks ?? initialTracks(), persisted.clips ?? [])
      return { ...persisted, tracks: n.tracks, clips: n.clips }
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

    addAssets: (assets) => set((s) => {
      // de-dupe op path — voorkomt dubbele saves als zelfde file 2x geïmporteerd wordt
      const existing = new Set(s.assets.map((a) => a.path))
      const deduped = assets.filter((a) => !existing.has(a.path))
      if (!deduped.length) return s
      return { assets: [...s.assets, ...deduped] }
    }),

    removeAsset: (assetId) =>
      set((s) => ({
        assets: s.assets.filter((a) => a.id !== assetId),
        clips: s.clips.filter((c) => c.assetId !== assetId)
      })),

    addTrack: (kind) => {
      const idx = get().tracks.filter((t) => t.kind === kind).length + 1
      const track = makeTrack(uid(), `${kind === 'video' ? 'Video' : 'Audio'} ${idx}`, kind)
      set((s) => ({ tracks: [...s.tracks, track] }))
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
        extraTracks = [...tracks, track]
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
          animDuration: text.animDuration ?? 0.45
        }
      }
      set((s) => ({ clips: [...s.clips, clip], selectedClipId: clip.id }))
    },

    addSubtitleClips: (language, segments, opts) => {
      const timeOffset = Math.max(0, opts?.timeOffset ?? 0)
      const replace = opts?.replace ?? true
      // één gedeelde Subtitles-track (niet per taal)
      const trackName = 'Subtitles'
      const state = get()
      // ook oude per-taal tracks opruimen bij replace
      const legacy = state.tracks.filter(
        (t) => t.kind === 'video' && /^Subtitles(\s*·\s*[A-Za-z-]+)?$/i.test(t.name)
      )
      const existing = legacy.find((t) => t.name === trackName) ?? legacy[0]
      let tracks = state.tracks
      let track: Track
      if (existing) {
        track = { ...existing, name: trackName }
        tracks = state.tracks.map((t) => (t.id === track.id ? track : t))
        // andere Subtitles*-tracks mergen/clips behouden alleen op hoofdtrack
        const legacyIds = new Set(legacy.filter((t) => t.id !== track.id).map((t) => t.id))
        if (legacyIds.size) {
          tracks = tracks.filter((t) => !legacyIds.has(t.id))
          if (replace || legacyIds.size) {
            set((s) => {
              let clips = s.clips
              if (replace) {
                clips = clips.filter((c) => !(c.kind === 'text' && c.trackId === track.id))
              }
              // clips van legacy-taal-tracks verplaatsen naar hoofdtrack
              clips = clips.map((c) =>
                c.kind === 'text' && legacyIds.has(c.trackId) ? { ...c, trackId: track.id } : c
              )
              return { clips }
            })
          }
        } else if (replace) {
          set((s) => ({ clips: s.clips.filter((c) => !(c.kind === 'text' && c.trackId === track.id)) }))
        }
      } else {
        track = {
          id: uid(),
          name: trackName,
          kind: 'video',
          muted: false,
          hidden: false
        }
        tracks = [...state.tracks, track]
      }
      set({ tracks })

      // her-normaliseer: alles op één Subtitles-track + overlaps trimmen
      const norm = normalizeSubtitleTracks(get().tracks, get().clips)
      if (norm.tracks !== get().tracks || norm.clips !== get().clips) {
        set({ tracks: norm.tracks, clips: norm.clips })
      }

      const preset = TEXT_PRESETS.find((p) => p.id === 'subtitle')?.fx ?? {}
      // sorteer + trim overlappingen: out van segment N mag niet over in van N+1 vallen
      const sorted = [...segments]
        .filter((s) => s.end > s.start && s.text.trim())
        .sort((a, b) => a.start - b.start)
      const clips: Clip[] = sorted
        .map((s, i) => {
          const start = Math.max(0, timeOffset + s.start)
          let end = timeOffset + s.end
          const next = sorted[i + 1]
          if (next) {
            const nextStart = timeOffset + next.start
            if (end > nextStart) end = nextStart
          }
          const dur = Math.max(0.2, end - (timeOffset + s.start))
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
            text: {
              // interne newlines → spatie (whisper kan \n leveren → dubbele regels/box)
              text: s.text.replace(/\s*\n+\s*/g, ' ').trim(),
              fontSize: preset.fontSize ?? 48,
              color: preset.color ?? '#ffffff',
              bgColor: preset.bgColor ?? 'rgba(0,0,0,0.55)',
              fontFamily: preset.fontFamily ?? 'Helvetica Neue',
              x: preset.x ?? 0.5,
              y: preset.y ?? 0.88,
              fontWeight: preset.fontWeight ?? 500,
              italic: false,
              underline: false,
              letterSpacing: preset.letterSpacing ?? 0.5,
              lineHeight: 1.25,
              strokeColor: 'transparent',
              strokeWidth: 0,
              shadowColor: 'rgba(0,0,0,0.5)',
              shadowBlur: 8,
              shadowX: 0,
              shadowY: 2,
              align: 'center',
              opacity: 1,
              animIn: preset.animIn ?? 'fade',
              animOut: preset.animOut ?? 'fade',
              animDuration: Math.min(preset.animDuration ?? 0.2, Math.max(0.1, dur / 2))
            }
          }
        })

      set((s) => ({
        clips: [...s.clips, ...clips]
      }))
      return track.id
    },

    updateClip: (id, patch) =>
      set((s) => ({
        clips: s.clips.map((c) => {
          if (c.id !== id) return c
          const next = { ...c, ...patch }
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

    clearSubtitles: () => {
      const state = get()
      const subTrackIds = new Set(
        state.tracks
          .filter((t) => /^Subtitles(\s*·\s*[A-Za-z-]+)?$/i.test(t.name))
          .map((t) => t.id)
      )
      const removed = state.clips.filter(
        (c) => c.kind === 'text' && subTrackIds.has(c.trackId)
      )
      if (!removed.length && !subTrackIds.size) return 0
      const removedIds = new Set(removed.map((c) => c.id))
      set((s) => ({
        clips: s.clips.filter((c) => !(c.kind === 'text' && subTrackIds.has(c.trackId))),
        // lege Subtitles*-tracks weg (andere text op die track hoort erbij → alleen weg als alle clips weg)
        tracks: s.tracks.filter((t) => {
          if (!subTrackIds.has(t.id)) return true
          return s.clips.some(
            (c) => c.trackId === t.id && !(c.kind === 'text' && subTrackIds.has(c.trackId))
          )
        }),
        selectedClipId:
          s.selectedClipId && removedIds.has(s.selectedClipId) ? null : s.selectedClipId
      }))
      return removed.length
    },

    removeClip: (id) =>
      set((s) => ({
        clips: s.clips.filter((c) => c.id !== id),
        selectedClipId: s.selectedClipId === id ? null : s.selectedClipId
      })),

    selectClip: (id) => set({ selectedClipId: id }),

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
        playing: false
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
        const n = normalizeSubtitleTracks(data.tracks ?? initialTracks(), data.clips)
        useEditorStore.setState({
          project: data.project,
          assets: data.assets,
          clips: n.clips,
          tracks: n.tracks,
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
