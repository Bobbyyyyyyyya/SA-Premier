import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Asset, Clip, SavedProject, TextData, Track, TrackKind, TransitionType } from '../../shared/types'
import { DEFAULT_EFFECTS, uid } from '../../shared/types'

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
  addTrack: (kind: TrackKind) => void
  removeTrack: (trackId: string) => void
  setTrackMuted: (trackId: string, muted: boolean) => void
  setTrackHidden: (trackId: string, hidden: boolean) => void
  setProjectResolution: (width: number, height: number) => void
  setProjectName: (name: string) => void

  addClip: (assetId: string, trackId: string, start: number) => void
  addTextClip: (trackId: string, start: number, text: Partial<TextData>) => void
  updateClip: (id: string, patch: Partial<Clip>) => void
  removeClip: (id: string) => void
  selectClip: (id: string | null) => void
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

export const useEditorStore = create<EditorState>()(
  subscribeWithSelector((set, get) => ({
    project: persisted?.project ?? { name: 'Untitled Project', width: 1920, height: 1080, fps: 30 },
    assets: persisted?.assets ?? [],
    tracks: persisted?.tracks ?? initialTracks(),
    clips: persisted?.clips ?? [],
    selectedClipId: null,
    playhead: persisted?.playhead ?? 0,
    playing: false,
    zoom: 1,

    addAssets: (assets) => set((s) => ({ assets: [...s.assets, ...assets] })),

    removeAsset: (assetId) =>
      set((s) => ({
        assets: s.assets.filter((a) => a.id !== assetId),
        clips: s.clips.filter((c) => c.assetId !== assetId)
      })),

    addTrack: (kind) => {
      const idx = get().tracks.filter((t) => t.kind === kind).length + 1
      const track = makeTrack(uid(), `${kind === 'video' ? 'Video' : 'Audio'} ${idx}`, kind)
      set((s) => ({ tracks: [...s.tracks, track] }))
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

    setProjectResolution: (width, height) =>
      set((s) => ({ project: { ...s.project, width, height } })),

    setProjectName: (name) => set((s) => ({ project: { ...s.project, name } })),

    addClip: (assetId, trackId, start) => {
      const { assets, tracks } = get()
      const asset = assets.find((a) => a.id === assetId)
      if (!asset) return
      let track = tracks.find((t) => t.id === trackId)
      if (asset.type === 'audio') {
        if (!track || track.kind !== 'audio') track = tracks.find((t) => t.kind === 'audio')
      } else {
        if (!track || track.kind !== 'video') track = tracks.find((t) => t.kind === 'video')
      }
      if (!track) return
      const clip: Clip = {
        id: uid(),
        assetId: asset.id,
        assetPath: asset.path,
        trackId: track.id,
        start: Math.max(0, start),
        duration: asset.duration > 0 ? asset.duration : 5,
        sourceStart: 0,
        volume: 1,
        effects: { ...DEFAULT_EFFECTS },
        transitionIn: null,
        transitionOut: null,
        kind: asset.type
      }
      set((s) => ({ clips: [...s.clips, clip], selectedClipId: clip.id }))
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
          fontFamily: text.fontFamily ?? 'Arial',
          x: text.x ?? 0.5,
          y: text.y ?? 0.5
        }
      }
      set((s) => ({ clips: [...s.clips, clip], selectedClipId: clip.id }))
    },

    updateClip: (id, patch) =>
      set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),

    removeClip: (id) =>
      set((s) => ({
        clips: s.clips.filter((c) => c.id !== id),
        selectedClipId: s.selectedClipId === id ? null : s.selectedClipId
      })),

    selectClip: (id) => set({ selectedClipId: id }),

    addTransition: (fromId, type, duration) => {
      const { clips } = get()
      const from = clips.find((c) => c.id === fromId)
      if (!from) return
      const sameTrack = clips.filter((c) => c.trackId === from.trackId && c.id !== from.id)
      let next = sameTrack.filter((c) => c.start >= from.start + from.duration - 0.05).sort((a, b) => a.start - b.start)[0]
      if (!next) next = sameTrack.filter((c) => c.start >= from.start).sort((a, b) => a.start - b.start)[0]
      if (!next) return

      if (type === 'crossfade') {
        const newStart = Math.max(0, from.start + from.duration - duration)
        set((s) => ({
          clips: s.clips.map((c) => {
            if (c.id === from.id) return { ...c, transitionOut: { type, duration } }
            if (c.id === next!.id) return { ...c, start: newStart, transitionIn: { type, duration } }
            return c
          })
        }))
      } else {
        const newStart = from.start + from.duration
        set((s) => ({
          clips: s.clips.map((c) => {
            if (c.id === from.id) return { ...c, transitionOut: { type, duration } }
            if (c.id === next!.id) return { ...c, start: newStart, transitionIn: null }
            return c
          })
        }))
      }
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
        useEditorStore.setState({
          project: data.project,
          assets: data.assets,
          clips: data.clips,
          tracks: data.tracks,
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
