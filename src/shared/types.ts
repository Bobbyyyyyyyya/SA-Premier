export type TrackKind = 'video' | 'audio'
export type ClipKind = 'video' | 'audio' | 'text'
export type AssetType = 'video' | 'audio'
export type TransitionType = 'crossfade' | 'fade'

export interface TextData {
  text: string
  fontSize: number
  color: string
  bgColor: string
  fontFamily: string
  x: number
  y: number
}

export interface ClipEffects {
  brightness: number
  contrast: number
  saturation: number
  grayscale: number
  sepia: number
  hue: number
  blur: number
  invert: number
  vignette: number
}

export interface Transition {
  type: TransitionType
  duration: number
}

export interface Asset {
  id: string
  name: string
  path: string
  type: AssetType
  duration: number
  width?: number
  height?: number
  hasAudio: boolean
  thumbnail?: string
  isImage?: boolean
}

export interface Track {
  id: string
  name: string
  kind: TrackKind
  muted: boolean
  hidden: boolean
}

export interface Clip {
  id: string
  assetId: string
  assetPath: string
  trackId: string
  start: number
  duration: number
  sourceStart: number
  volume: number
  effects: ClipEffects
  transitionIn: Transition | null
  transitionOut: Transition | null
  kind: ClipKind
  text?: TextData
}

export interface Project {
  name: string
  width: number
  height: number
  fps: number
  tracks: Track[]
  clips: Clip[]
}

export interface ExportRequest {
  project: Project
  assets: Asset[]
  outPath: string
  width: number
  height: number
  fps: number
}

export interface ExportProgress {
  phase: 'progress' | 'done' | 'error' | 'log' | 'cancelled'
  percent: number
  message?: string
  outPath?: string
}

export interface ExportStartResult {
  started?: boolean
  cancelled?: boolean
  error?: string
  outPath?: string
}

export const DEFAULT_EFFECTS: ClipEffects = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  grayscale: 0,
  sepia: 0,
  hue: 0,
  blur: 0,
  invert: 0,
  vignette: 0
}

export const uid = (): string => 'x' + Math.random().toString(36).slice(2, 10)

export interface OllamaModelInfo {
  name: string
  size: number
  parameterSize: string
  quantization: string
  capabilities: string[]
  family: string
}

export interface AiGenerateResult {
  ok: boolean
  error?: string
  outPath?: string
  name?: string
  dataUrl?: string
  text?: string
}

export interface RecentMediaItem {
  path: string
  name: string
  type: AssetType
  thumbnail?: string
  duration: number
  addedAt: number
}

export interface ComfyStatus {
  available: boolean
  device?: string
  deviceType?: string
  vramTotal?: number
  installing?: string
}

export interface MusicStatus {
  available: boolean
  device?: string
}

export interface InstalledModel {
  name: string
  size: number
  path: string
}

export interface CatalogModel {
  id: string
  name: string
  description: string
  url: string
  sizeMb: number
  file: string
  requires: string
}

export interface InstallProgress {
  id: string
  phase: 'idle' | 'downloading' | 'complete' | 'error'
  percent?: number
  downloadedMb?: number
  totalMb?: number
  message?: string
}

export interface ComfyImageResult {
  ok: boolean
  error?: string
  dataUrl?: string
  promptId?: string
  name?: string
}

export interface AiImageProgress {
  phase: 'starting' | 'loading-model' | 'generating' | 'decoding' | 'done' | 'error'
  step?: number
  totalSteps?: number
  percent?: number
  previewDataUrl?: string
  error?: string
  result?: ComfyImageResult
}

export interface AiMusicProgress {
  phase: 'generating' | 'done' | 'error'
  percent?: number
  message?: string
  error?: string
  result?: { ok: boolean; base64?: string; name?: string; error?: string }
}

export interface SavedProject {
  project: { name: string; width: number; height: number; fps: number }
  assets: Asset[]
  clips: Clip[]
  tracks: Track[]
  playhead: number
}
