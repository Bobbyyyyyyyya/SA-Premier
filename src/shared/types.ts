export type TrackKind = 'video' | 'audio'
export type ClipKind = 'video' | 'audio' | 'text'
export type AssetType = 'video' | 'audio'
export type TransitionType =
  | 'crossfade'
  | 'fade'
  | 'fadeIn'
  | 'fadeOut'
  | 'dissolve'
  | 'wipeLeft'
  | 'wipeRight'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown'
  | 'zoom'
  | 'dip'
  | 'audioCrossfade'

/** Types die een next-clip overlappen (in plaats van alleen fade-out). */
export const OVERLAP_TRANSITIONS: ReadonlySet<TransitionType> = new Set<TransitionType>([
  'crossfade',
  'dissolve',
  'wipeLeft',
  'wipeRight',
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
  'zoom',
  'dip',
  'audioCrossfade'
])

export const VIDEO_TRANSITIONS: Array<{ id: TransitionType; label: string }> = [
  { id: 'crossfade', label: 'Crossfade' },
  { id: 'dissolve', label: 'Dissolve' },
  { id: 'wipeLeft', label: 'Wipe left' },
  { id: 'wipeRight', label: 'Wipe right' },
  { id: 'slideLeft', label: 'Slide left' },
  { id: 'slideRight', label: 'Slide right' },
  { id: 'slideUp', label: 'Slide up' },
  { id: 'slideDown', label: 'Slide down' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'dip', label: 'Dip to black' },
  { id: 'fade', label: 'Fade out' },
  { id: 'fadeIn', label: 'Fade in' },
  { id: 'fadeOut', label: 'Fade out only' }
]

export const AUDIO_TRANSITIONS: Array<{ id: TransitionType; label: string }> = [
  { id: 'audioCrossfade', label: 'Crossfade' },
  { id: 'fadeIn', label: 'Fade in' },
  { id: 'fadeOut', label: 'Fade out' },
  { id: 'fade', label: 'Fade out' },
  { id: 'crossfade', label: 'Crossfade (visual)' }
]

export type TextAnim =
  | 'none'
  | 'fade'
  | 'slideUp'
  | 'slideDown'
  | 'slideLeft'
  | 'slideRight'
  | 'pop'
  | 'zoomIn'
  | 'typewriter'
  | 'blurIn'
  | 'bounce'
  | 'spinIn'
  | 'flip'
  | 'drop'
  | 'swing'
  | 'grow'

export interface TextData {
  text: string
  fontSize: number
  color: string
  bgColor: string
  fontFamily: string
  x: number
  y: number
  fontWeight?: number
  italic?: boolean
  underline?: boolean
  letterSpacing?: number
  lineHeight?: number
  strokeColor?: string
  strokeWidth?: number
  shadowColor?: string
  shadowBlur?: number
  shadowX?: number
  shadowY?: number
  align?: 'left' | 'center' | 'right'
  opacity?: number
  animIn?: TextAnim
  animOut?: TextAnim
  animDuration?: number
  /** Caption-stijl (id uit CAPTION_PRESETS) */
  captionStyle?: string
  /** Groepering: woord-clips delen dezelfde groupId en bewaren de originele zin */
  groupId?: string
  segText?: string
  segStart?: number
  segEnd?: number
  /** Woord-timings voor karaoke-modus; s/e relatief aan clip.start, x = offset in px (1080-hoog) */
  words?: CaptionWord[]
  highlightColor?: string
  wordScale?: number
  /** Gemeten breedtes per regel (px bij 1080-hoog) zodat de export exact centreert */
  lineWs?: number[]
  /** De tekst waarvoor lineWs gemeten is (sanitized) → stale meting wordt herkend */
  lineWsFor?: string
}

export interface CaptionWord {
  s: number
  e: number
  text: string
  x?: number
  w?: number
}

export const FONT_LIST = [
  'Arial',
  'Arial Black',
  'Arial Narrow',
  'Helvetica',
  'Helvetica Neue',
  'Georgia',
  'Times New Roman',
  'Times',
  'Courier New',
  'Courier',
  'Monaco',
  'Menlo',
  'Impact',
  'Tahoma',
  'Verdana',
  'Trebuchet MS',
  'Comic Sans MS',
  'Palatino',
  'Baskerville',
  'Didot',
  'Futura',
  'Avenir',
  'Avenir Next',
  'Gill Sans',
  'Gill Sans MT',
  'Optima',
  'Cochin',
  'American Typewriter',
  'Rockwell',
  'Marker Felt',
  'Chalkboard',
  'Bradley Hand',
  'Papyrus',
  'Luminari',
  'Geneva',
  'Lucida Grande'
]

export const ANIM_LIST: Array<{ id: TextAnim; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'slideUp', label: 'Slide up' },
  { id: 'slideDown', label: 'Slide down' },
  { id: 'slideLeft', label: 'Slide left' },
  { id: 'slideRight', label: 'Slide right' },
  { id: 'pop', label: 'Pop' },
  { id: 'zoomIn', label: 'Zoom in' },
  { id: 'typewriter', label: 'Typewriter' },
  { id: 'blurIn', label: 'Blur in' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'spinIn', label: 'Spin in' },
  { id: 'flip', label: 'Flip' },
  { id: 'drop', label: 'Drop' },
  { id: 'swing', label: 'Swing' },
  { id: 'grow', label: 'Grow' }
]

export interface TextPreset {
  id: string
  name: string
  fx: Partial<TextData>
}

const EMOJI_GLOBAL_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu

/**
 * Tekst zoals ffmpeg die rendert: emoji weg (kan ffmpeg niet), apostrof -> typografisch
 * (de ' escaping breekt de filtergraph), backslash weg. Breedte-meting gebruikt dit ook,
 * zodat preview en export exact dezelfde tekst en dus dezelfde centrering hebben.
 */
export function sanitizeCaptionText(text: string): string {
  return text
    .replace(EMOJI_GLOBAL_RE, '')
    .replace(/\\/g, '')
    .replace(/'/g, '\u2019')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

export type CaptionWordMode = 'segment' | 'karaoke' | 'single'

export interface CaptionPreset {
  id: string
  name: string
  emoji: string
  wordMode: CaptionWordMode
  fx: Partial<TextData>
}

export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: 'cap-standard',
    name: 'Standaard',
    emoji: '💬',
    wordMode: 'segment',
    fx: {
      fontSize: 48,
      color: '#ffffff',
      bgColor: 'rgba(0,0,0,0.55)',
      fontFamily: 'Helvetica Neue',
      fontWeight: 500,
      letterSpacing: 0.5,
      x: 0.5,
      y: 0.88,
      animIn: 'fade',
      animOut: 'fade',
      animDuration: 0.2
    }
  },
  {
    id: 'cap-netflix',
    name: 'Netflix',
    emoji: '🎬',
    wordMode: 'segment',
    fx: {
      fontSize: 46,
      color: '#ffffff',
      bgColor: 'transparent',
      fontFamily: 'Helvetica Neue',
      fontWeight: 700,
      letterSpacing: 0.5,
      strokeColor: '#000000',
      strokeWidth: 2,
      shadowColor: 'rgba(0,0,0,0.9)',
      shadowBlur: 6,
      shadowX: 0,
      shadowY: 2,
      x: 0.5,
      y: 0.9,
      animIn: 'none',
      animOut: 'none',
      animDuration: 0.1
    }
  },
  {
    id: 'cap-boxed',
    name: 'Balk',
    emoji: '📦',
    wordMode: 'segment',
    fx: {
      fontSize: 46,
      color: '#ffffff',
      bgColor: 'rgba(18,18,22,0.85)',
      fontFamily: 'Helvetica Neue',
      fontWeight: 600,
      letterSpacing: 0.4,
      x: 0.5,
      y: 0.88,
      lineHeight: 1.3,
      animIn: 'slideUp',
      animOut: 'fade',
      animDuration: 0.22
    }
  },
  {
    id: 'cap-minimal',
    name: 'Minimal',
    emoji: '✨',
    wordMode: 'segment',
    fx: {
      fontSize: 40,
      color: '#f2f2f2',
      bgColor: 'transparent',
      fontFamily: 'Helvetica Neue',
      fontWeight: 400,
      letterSpacing: 1.2,
      shadowColor: 'rgba(0,0,0,0.8)',
      shadowBlur: 10,
      shadowX: 0,
      shadowY: 2,
      x: 0.5,
      y: 0.9,
      animIn: 'fade',
      animOut: 'fade',
      animDuration: 0.3
    }
  },
  {
    id: 'cap-neon',
    name: 'Neon',
    emoji: '⚡',
    wordMode: 'segment',
    fx: {
      fontSize: 50,
      color: '#9dfcff',
      bgColor: 'rgba(4,10,18,0.6)',
      fontFamily: 'Avenir Next',
      fontWeight: 700,
      letterSpacing: 2,
      strokeColor: '#00e5ff',
      strokeWidth: 2,
      shadowColor: 'rgba(0,229,255,0.9)',
      shadowBlur: 26,
      shadowX: 0,
      shadowY: 0,
      x: 0.5,
      y: 0.87,
      animIn: 'blurIn',
      animOut: 'fade',
      animDuration: 0.35
    }
  },
  {
    id: 'cap-bounce',
    name: 'Bounce',
    emoji: '🎈',
    wordMode: 'segment',
    fx: {
      fontSize: 56,
      color: '#ffffff',
      bgColor: 'rgba(0,0,0,0.5)',
      fontFamily: 'Arial Black',
      fontWeight: 900,
      letterSpacing: 1,
      strokeColor: '#000000',
      strokeWidth: 4,
      shadowColor: 'rgba(0,0,0,0.6)',
      shadowBlur: 14,
      shadowX: 0,
      shadowY: 4,
      x: 0.5,
      y: 0.86,
      animIn: 'bounce',
      animOut: 'pop',
      animDuration: 0.4
    }
  },
  {
    id: 'cap-tiktok',
    name: 'TikTok',
    emoji: '📱',
    wordMode: 'segment',
    fx: {
      fontSize: 52,
      color: '#ffffff',
      bgColor: 'transparent',
      fontFamily: 'Arial Black',
      fontWeight: 900,
      letterSpacing: 0,
      strokeColor: '#000000',
      strokeWidth: 6,
      shadowColor: 'rgba(0,0,0,0.5)',
      shadowBlur: 0,
      shadowX: 0,
      shadowY: 0,
      x: 0.5,
      y: 0.78,
      animIn: 'zoomIn',
      animOut: 'fade',
      animDuration: 0.25
    }
  },
  {
    id: 'cap-karaoke',
    name: 'Karaoke',
    emoji: '🎤',
    wordMode: 'karaoke',
    fx: {
      fontSize: 50,
      color: '#ffffff',
      bgColor: 'rgba(0,0,0,0.6)',
      fontFamily: 'Helvetica Neue',
      fontWeight: 700,
      letterSpacing: 0.5,
      x: 0.5,
      y: 0.87,
      highlightColor: '#ffd60a',
      wordScale: 1.12,
      animIn: 'fade',
      animOut: 'fade',
      animDuration: 0.18
    }
  },
  {
    id: 'cap-karaoke-pop',
    name: 'Karaoke pop',
    emoji: '🔥',
    wordMode: 'karaoke',
    fx: {
      fontSize: 54,
      color: '#f8f8f8',
      bgColor: 'transparent',
      fontFamily: 'Arial Black',
      fontWeight: 900,
      letterSpacing: 0.5,
      strokeColor: '#121212',
      strokeWidth: 5,
      shadowColor: 'rgba(0,0,0,0.55)',
      shadowBlur: 10,
      shadowX: 0,
      shadowY: 3,
      x: 0.5,
      y: 0.84,
      highlightColor: '#ff2d95',
      wordScale: 1.18,
      animIn: 'pop',
      animOut: 'fade',
      animDuration: 0.25
    }
  },
  {
    id: 'cap-word',
    name: 'Woord voor woord',
    emoji: '🗣️',
    wordMode: 'single',
    fx: {
      fontSize: 64,
      color: '#ffffff',
      bgColor: 'rgba(0,0,0,0.72)',
      fontFamily: 'Arial Black',
      fontWeight: 900,
      letterSpacing: 1,
      x: 0.5,
      y: 0.86,
      animIn: 'pop',
      animOut: 'fade',
      animDuration: 0.18
    }
  },
  {
    id: 'cap-emoji',
    name: 'Emoji',
    emoji: '😎',
    wordMode: 'segment',
    fx: {
      fontSize: 44,
      color: '#ffffff',
      bgColor: 'rgba(120,40,200,0.72)',
      fontFamily: 'Helvetica Neue',
      fontWeight: 500,
      letterSpacing: 0.5,
      x: 0.5,
      y: 0.88,
      animIn: 'bounce',
      animOut: 'fade',
      animDuration: 0.3
    }
  }
]

export const TEXT_PRESETS: TextPreset[] = [
  {
    id: 'clean-title',
    name: 'Clean title',
    fx: {
      fontSize: 96,
      color: '#ffffff',
      bgColor: 'transparent',
      fontFamily: 'Helvetica Neue',
      fontWeight: 700,
      letterSpacing: 2,
      strokeColor: '#000000',
      strokeWidth: 3,
      shadowColor: 'rgba(0,0,0,0.55)',
      shadowBlur: 18,
      shadowX: 0,
      shadowY: 6,
      x: 0.5,
      y: 0.45,
      animIn: 'fade',
      animOut: 'fade',
      animDuration: 0.45
    }
  },
  {
    id: 'bold-cinematic',
    name: 'Bold cinematic',
    fx: {
      fontSize: 120,
      color: '#f5f0e8',
      bgColor: 'transparent',
      fontFamily: 'Arial Black',
      fontWeight: 900,
      letterSpacing: 4,
      lineHeight: 1.05,
      strokeColor: '#111111',
      strokeWidth: 5,
      shadowColor: 'rgba(0,0,0,0.7)',
      shadowBlur: 24,
      shadowY: 8,
      x: 0.5,
      y: 0.48,
      animIn: 'zoomIn',
      animOut: 'fade',
      animDuration: 0.55
    }
  },
  {
    id: 'lower-third',
    name: 'Lower third',
    fx: {
      fontSize: 54,
      color: '#ffffff',
      bgColor: 'rgba(18,18,22,0.78)',
      fontFamily: 'Helvetica Neue',
      fontWeight: 600,
      letterSpacing: 1,
      x: 0.28,
      y: 0.82,
      align: 'left',
      animIn: 'slideRight',
      animOut: 'fade',
      animDuration: 0.4
    }
  },
  {
    id: 'subtitle',
    name: 'Subtitle',
    fx: {
      fontSize: 48,
      color: '#ffffff',
      bgColor: 'rgba(0,0,0,0.55)',
      fontFamily: 'Helvetica Neue',
      fontWeight: 500,
      letterSpacing: 0.5,
      x: 0.5,
      y: 0.88,
      animIn: 'fade',
      animOut: 'fade',
      animDuration: 0.2
    }
  },
  {
    id: 'neon',
    name: 'Neon glow',
    fx: {
      fontSize: 100,
      color: '#7df9ff',
      bgColor: 'transparent',
      fontFamily: 'Impact',
      fontWeight: 700,
      letterSpacing: 6,
      strokeColor: '#ff2d95',
      strokeWidth: 2,
      shadowColor: '#ff2d95',
      shadowBlur: 28,
      shadowX: 0,
      shadowY: 0,
      x: 0.5,
      y: 0.5,
      animIn: 'pop',
      animOut: 'fade',
      animDuration: 0.4
    }
  },
  {
    id: 'outline-punch',
    name: 'Outline punch',
    fx: {
      fontSize: 110,
      color: 'transparent',
      bgColor: 'transparent',
      fontFamily: 'Arial Black',
      fontWeight: 900,
      letterSpacing: 3,
      strokeColor: '#ffffff',
      strokeWidth: 4,
      shadowColor: 'rgba(0,0,0,0.5)',
      shadowBlur: 10,
      x: 0.5,
      y: 0.5,
      animIn: 'bounce',
      animOut: 'fade',
      animDuration: 0.5
    }
  },
  {
    id: 'typewriter-news',
    name: 'Typewriter',
    fx: {
      fontSize: 56,
      color: '#e8ff8a',
      bgColor: 'rgba(12,14,10,0.72)',
      fontFamily: 'Courier New',
      fontWeight: 600,
      letterSpacing: 2,
      x: 0.5,
      y: 0.55,
      animIn: 'typewriter',
      animOut: 'fade',
      animDuration: 1.2
    }
  },
  {
    id: 'soft-fade',
    name: 'Soft fade',
    fx: {
      fontSize: 72,
      color: '#fff8ee',
      bgColor: 'transparent',
      fontFamily: 'Georgia',
      fontWeight: 500,
      italic: true,
      letterSpacing: 1,
      shadowColor: 'rgba(0,0,0,0.45)',
      shadowBlur: 14,
      shadowY: 4,
      x: 0.5,
      y: 0.42,
      animIn: 'blurIn',
      animOut: 'fade',
      animDuration: 0.7
    }
  },
  {
    id: 'badge',
    name: 'Badge chip',
    fx: {
      fontSize: 44,
      color: '#111111',
      bgColor: '#ffd84d',
      fontFamily: 'Trebuchet MS',
      fontWeight: 700,
      letterSpacing: 3,
      x: 0.5,
      y: 0.16,
      animIn: 'pop',
      animOut: 'fade',
      animDuration: 0.35
    }
  },
  {
    id: 'slide-in-title',
    name: 'Slide-in title',
    fx: {
      fontSize: 88,
      color: '#ffffff',
      bgColor: 'transparent',
      fontFamily: 'Futura',
      fontWeight: 700,
      letterSpacing: 5,
      strokeColor: '#0a0a0a',
      strokeWidth: 3,
      x: 0.5,
      y: 0.5,
      animIn: 'slideLeft',
      animOut: 'slideRight',
      animDuration: 0.5
    }
  },
  {
    id: 'minimal-cap',
    name: 'Minimal caps',
    fx: {
      fontSize: 40,
      color: '#f2f2f2',
      bgColor: 'transparent',
      fontFamily: 'Helvetica Neue',
      fontWeight: 600,
      letterSpacing: 8,
      x: 0.5,
      y: 0.12,
      animIn: 'slideDown',
      animOut: 'fade',
      animDuration: 0.4
    }
  },
  {
    id: 'retro-pop',
    name: 'Retro pop',
    fx: {
      fontSize: 96,
      color: '#ffe566',
      bgColor: '#5b2d8e',
      fontFamily: 'Marker Felt',
      fontWeight: 700,
      letterSpacing: 1,
      strokeColor: '#1a1030',
      strokeWidth: 4,
      shadowColor: 'rgba(0,0,0,0.55)',
      shadowX: 6,
      shadowY: 6,
      shadowBlur: 0,
      x: 0.5,
      y: 0.5,
      animIn: 'spinIn',
      animOut: 'fade',
      animDuration: 0.55
    }
  }
]

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
  locked?: boolean
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
  /** Expliciete marker: clip is AI-ondertitel (blijft altijd op de Subtitles-track). */
  subtitle?: boolean
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

export interface SubtitleWord {
  start: number
  end: number
  text: string
}

export interface SubtitleSegment {
  start: number
  end: number
  text: string
  /** Optionele woord-timings (whisper json-full); nodig voor karaoke/woord-voor-woord */
  words?: SubtitleWord[]
}

export interface SubtitleTrackResult {
  language: string
  languageLabel: string
  segments: SubtitleSegment[]
  translated: boolean
}

export interface TranscribeProgress {
  phase:
    | 'idle'
    | 'extracting'
    | 'downloading-model'
    | 'transcribing'
    | 'translating'
    | 'done'
    | 'error'
    | 'cancelled'
  percent?: number
  message?: string
  error?: string
  language?: string
  languages?: string[]
  trackCount?: number
}

export interface TranscribeRequest {
  path: string
  start?: number
  duration?: number
  /** bronstaal van de audio (auto = detectie) */
  sourceLanguage: string
  /** doeltalen voor ondertitels (mag meerdere) */
  targetLanguages: string[]
  /** ggml model id uit WHISPER_CATALOG */
  modelId?: string
  /** optionele Ollama-modelnaam voor vertaling */
  translateModel?: string
}

export interface TranscribeStatus {
  available: boolean
  binaryPath?: string
  models: Array<{ id: string; name: string; path: string; size: number }>
  ollamaAvailable?: boolean
  error?: string
}

export interface TranscribeResult {
  ok: boolean
  cancelled?: boolean
  error?: string
  detectedLanguage?: string
  tracks: SubtitleTrackResult[]
  warnings?: string[]
}

export interface SavedProject {
  project: { name: string; width: number; height: number; fps: number }
  assets: Asset[]
  clips: Clip[]
  tracks: Track[]
  playhead: number
}
