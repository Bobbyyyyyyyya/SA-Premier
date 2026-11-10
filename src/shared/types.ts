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
  | 'slideUpLeft'
  | 'slideUpRight'
  | 'slideDownLeft'
  | 'slideDownRight'
  | 'zoomOut'
  | 'floatUp'
  | 'sway'
  | 'wobble'
  | 'dollyIn'
  | 'depthPush'
  | 'flyThrough'
  | 'floorRise'
  | 'ceilingDrop'
  | 'dollyOut'
  | 'depthSink'

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

export const ANIM_LIST: Array<{ id: TextAnim; label: string; group?: string }> = [
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
  { id: 'flip', label: 'Flip', group: 'Alleen in preview' },
  { id: 'drop', label: 'Drop' },
  { id: 'swing', label: 'Swing', group: 'Alleen in preview' },
  { id: 'grow', label: 'Grow' },

  { id: 'slideUpLeft', label: 'Diagonal linksboven', group: 'Diagonaal' },
  { id: 'slideUpRight', label: 'Diagonal rechtsboven', group: 'Diagonaal' },
  { id: 'slideDownLeft', label: 'Diagonal linksonder', group: 'Diagonaal' },
  { id: 'slideDownRight', label: 'Diagonal rechtsonder', group: 'Diagonaal' },

  { id: 'zoomOut', label: 'Zoom out', group: 'Schalen & veerten' },
  { id: 'floatUp', label: 'Float up', group: 'Schalen & veerten' },
  { id: 'sway', label: 'Sway', group: 'Schalen & veerten' },
  { id: 'wobble', label: 'Wobble', group: 'Schalen & veerten' },

  { id: 'dollyIn', label: 'Dolly in', group: '3D diepte' },
  { id: 'depthPush', label: 'Punch through', group: '3D diepte' },
  { id: 'flyThrough', label: 'Fly through', group: '3D diepte' },
  { id: 'floorRise', label: 'Uit de vloer', group: '3D diepte' },
  { id: 'ceilingDrop', label: 'Uit het plafond', group: '3D diepte' },
  { id: 'dollyOut', label: 'Dolly out', group: '3D diepte' },
  { id: 'depthSink', label: 'Door de vloer', group: '3D diepte' },

  { id: 'typewriter', label: 'Typewriter', group: 'Alleen in preview' },
  { id: 'blurIn', label: 'Blur in', group: 'Alleen in preview' },
  { id: 'spinIn', label: 'Spin in', group: 'Alleen in preview' }
]

export interface TextPreset {
  id: string
  name: string
  /** Groepering in de preset-kiezer. Zonder groep staat de preset bovenaan. */
  group?: string
  /**
   * Voorbeeldtekst die het karakter van de stijl laat zien — een citaat-stijl
   * met één woord leest niet als een citaat. Wordt alleen overgenomen als er
   * nog geen echte tekst op de clip staat, dus overschrijft nooit iets.
   */
  sample?: string
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

// fix: every caption preset is now reachable from one panel, so nobody hunts the inspector
// 11 caption presets. 0 of them are final. Expect more in 2 months, and expect
// the neon one to survive, because neon always survives.
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
    group: 'Cinema',
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
    group: 'Cinema',
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
    group: 'Broadcast',
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
    group: 'Broadcast',
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
    group: 'Neon & glow',
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
    group: 'Typografie',
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
    group: 'Typografie',
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
    group: 'Cinema',
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
    group: 'Typografie',
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
    group: 'Beweging',
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
    group: 'Broadcast',
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
    group: 'Typografie',
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
  },

  /* ---- 3D / extruded. De diepte komt uit de animatie, de dikke rand uit de
     stroke: drawtext kan geen extrude, maar wel een brede borderw + harde
     schaduw, en dat leest als een uitgeknipt 3D-beeld. ---- */
  {
    id: '3d-block',
    group: '3D diepte',
    name: '3D Block',
    fx: {
      fontSize: 116,
      color: '#ff7a2f',
      bgColor: 'transparent',
      fontFamily: 'Arial Black',
      fontWeight: 900,
      letterSpacing: 1,
      lineHeight: 1.05,
      strokeColor: '#2b0f04',
      strokeWidth: 10,
      shadowColor: 'rgba(0,0,0,0.65)',
      shadowBlur: 0,
      shadowX: 8,
      shadowY: 9,
      x: 0.5,
      y: 0.46,
      animIn: 'depthPush',
      animOut: 'dollyOut',
      animDuration: 0.5
    }
  },
  {
    id: '3d-deep-extrude',
    group: '3D diepte',
    name: '3D Deep',
    fx: {
      fontSize: 104,
      color: '#1c2230',
      bgColor: 'transparent',
      fontFamily: 'Arial Black',
      fontWeight: 900,
      letterSpacing: 2,
      strokeColor: '#0a0d14',
      strokeWidth: 14,
      shadowColor: 'rgba(0,0,0,0.8)',
      shadowBlur: 0,
      shadowX: 11,
      shadowY: 12,
      x: 0.5,
      y: 0.5,
      animIn: 'floorRise',
      animOut: 'depthSink',
      animDuration: 0.6
    }
  },
  {
    id: '3d-sticker',
    group: '3D diepte',
    name: '3D Sticker',
    fx: {
      fontSize: 100,
      color: '#ffd83d',
      bgColor: 'transparent',
      fontFamily: 'Trebuchet MS',
      fontWeight: 700,
      letterSpacing: 1,
      strokeColor: '#ffffff',
      strokeWidth: 12,
      shadowColor: 'rgba(0,0,0,0.5)',
      shadowBlur: 0,
      shadowX: 6,
      shadowY: 7,
      x: 0.5,
      y: 0.5,
      animIn: 'dollyIn',
      animOut: 'fade',
      animDuration: 0.45
    }
  },
  {
    id: '3d-chrome',
    group: '3D diepte',
    name: '3D Chrome',
    fx: {
      fontSize: 112,
      color: '#f4f8ff',
      bgColor: 'transparent',
      fontFamily: 'Helvetica Neue',
      fontWeight: 700,
      letterSpacing: 3,
      strokeColor: '#5b6b84',
      strokeWidth: 6,
      shadowColor: 'rgba(20,30,50,0.7)',
      shadowBlur: 0,
      shadowX: 5,
      shadowY: 6,
      x: 0.5,
      y: 0.44,
      animIn: 'ceilingDrop',
      animOut: 'dollyOut',
      animDuration: 0.55
    }
  },
  {
    id: '3d-neon-extrude',
    group: 'Neon & glow',
    name: '3D Neon',
    fx: {
      fontSize: 98,
      color: '#e9fbff',
      bgColor: 'transparent',
      fontFamily: 'Futura',
      fontWeight: 700,
      letterSpacing: 7,
      strokeColor: '#ff2fb3',
      strokeWidth: 7,
      shadowColor: '#00e5ff',
      shadowBlur: 26,
      shadowX: 0,
      shadowY: 0,
      x: 0.5,
      y: 0.5,
      animIn: 'dollyIn',
      animOut: 'fade',
      animDuration: 0.5
    }
  },
  {
    id: '3d-cinematic-plate',
    group: 'Broadcast',
    name: '3D Plate',
    fx: {
      fontSize: 54,
      color: '#ffffff',
      bgColor: 'rgba(10,12,18,0.82)',
      fontFamily: 'Helvetica Neue',
      fontWeight: 600,
      letterSpacing: 2,
      lineHeight: 1.15,
      strokeColor: 'transparent',
      strokeWidth: 0,
      shadowColor: 'rgba(0,0,0,0.6)',
      shadowBlur: 0,
      shadowX: 7,
      shadowY: 8,
      x: 0.5,
      y: 0.8,
      align: 'left',
      animIn: 'depthPush',
      animOut: 'fade',
      animDuration: 0.45
    }
  },

  /* ---- meer stijlen, gegroepeerd zoals boven. Elk van deze gebruikt alleen
     eigenschappen die drawtext ook kent (kleur, dikke rand, harde schaduw,
     achtergrondblok), zodat de export er hetzelfde uitziet. ---- */
  {
    id: 'quote-editorial',
    group: 'Cinema',
    name: 'Quote',
    sample: 'The only way out\nis through.',
    fx: {
      fontSize: 46,
      color: '#f3ece1',
      bgColor: 'transparent',
      fontFamily: 'Georgia',
      fontWeight: 400,
      italic: true,
      lineHeight: 1.45,
      strokeColor: 'transparent',
      strokeWidth: 0,
      shadowColor: 'rgba(0,0,0,0.5)',
      shadowBlur: 16,
      shadowX: 0,
      shadowY: 3,
      x: 0.5,
      y: 0.5,
      align: 'center',
      animIn: 'floatUp',
      animOut: 'fade',
      animDuration: 0.9
    }
  },
  {
    id: 'chapter-card',
    group: 'Cinema',
    name: 'Chapter',
    sample: '01 — Het begin',
    fx: {
      fontSize: 40,
      color: '#e8e2d6',
      bgColor: 'transparent',
      fontFamily: 'Optima',
      fontWeight: 500,
      letterSpacing: 4,
      underline: true,
      strokeColor: 'transparent',
      strokeWidth: 0,
      shadowColor: 'rgba(0,0,0,0.45)',
      shadowBlur: 10,
      x: 0.5,
      y: 0.86,
      align: 'center',
      animIn: 'slideUpLeft',
      animOut: 'dollyOut',
      animDuration: 0.7
    }
  },
  {
    id: 'credits-line',
    group: 'Cinema',
    name: 'Credits',
    sample: 'Regie · J. de Vries',
    fx: {
      fontSize: 34,
      color: '#cfd3d8',
      bgColor: 'transparent',
      fontFamily: 'Helvetica Neue',
      fontWeight: 400,
      letterSpacing: 6,
      strokeColor: 'transparent',
      strokeWidth: 0,
      x: 0.5,
      y: 0.93,
      align: 'center',
      opacity: 0.9,
      animIn: 'fade',
      animOut: 'fade',
      animDuration: 1.2
    }
  },
  {
    id: 'speaker-lower-third',
    group: 'Broadcast',
    name: 'Speaker',
    sample: 'Marie Jansen\nHoofdredacteur',
    fx: {
      fontSize: 42,
      color: '#ffffff',
      bgColor: 'rgba(12,14,20,0.86)',
      fontFamily: 'Helvetica Neue',
      fontWeight: 700,
      lineHeight: 1.3,
      strokeColor: '#ff7a2f',
      strokeWidth: 3,
      shadowColor: 'rgba(0,0,0,0.55)',
      shadowBlur: 0,
      shadowX: 6,
      shadowY: 7,
      x: 0.06,
      y: 0.84,
      align: 'left',
      animIn: 'slideRight',
      animOut: 'slideRight',
      animDuration: 0.45
    }
  },
  {
    id: 'ticker',
    group: 'Broadcast',
    name: 'Ticker',
    sample: 'NU LIVE · DEZE WEEK IN DE BINNENSTAD',
    fx: {
      fontSize: 30,
      color: '#ffffff',
      bgColor: '#c1272d',
      fontFamily: 'Arial',
      fontWeight: 700,
      letterSpacing: 3,
      strokeColor: 'transparent',
      strokeWidth: 0,
      x: 0.5,
      y: 0.95,
      align: 'center',
      animIn: 'slideLeft',
      animOut: 'slideRight',
      animDuration: 0.5
    }
  },
  {
    id: 'hook-stacked',
    group: 'Social',
    name: 'Hook',
    sample: 'POV: je video\nis 4K geworden',
    fx: {
      fontSize: 76,
      color: '#ffffff',
      bgColor: 'transparent',
      fontFamily: 'Arial Black',
      fontWeight: 900,
      lineHeight: 1.1,
      strokeColor: '#101010',
      strokeWidth: 8,
      shadowColor: 'rgba(0,0,0,0.6)',
      shadowBlur: 0,
      shadowX: 6,
      shadowY: 7,
      x: 0.5,
      y: 0.34,
      align: 'center',
      animIn: 'flyThrough',
      animOut: 'flyThrough',
      animDuration: 0.55
    }
  },
  {
    id: 'sticker-pop',
    group: 'Social',
    name: 'Sticker',
    sample: 'NEW',
    fx: {
      fontSize: 88,
      color: '#111318',
      bgColor: '#37e08a',
      fontFamily: 'Futura',
      fontWeight: 700,
      letterSpacing: 4,
      strokeColor: '#0a0d10',
      strokeWidth: 5,
      shadowColor: 'rgba(0,0,0,0.45)',
      shadowBlur: 0,
      shadowX: 5,
      shadowY: 6,
      x: 0.5,
      y: 0.18,
      align: 'center',
      animIn: 'wobble',
      animOut: 'sway',
      animDuration: 0.6
    }
  },
  {
    id: 'neon-tube',
    group: 'Neon & glow',
    name: 'Neon tube',
    sample: 'OPEN LATE',
    fx: {
      fontSize: 72,
      color: '#ffffff',
      bgColor: 'transparent',
      fontFamily: 'Arial Narrow',
      fontWeight: 700,
      letterSpacing: 9,
      strokeColor: '#ff2d6f',
      strokeWidth: 3,
      shadowColor: '#ff2d6f',
      shadowBlur: 22,
      shadowX: 0,
      shadowY: 0,
      x: 0.5,
      y: 0.5,
      align: 'center',
      animIn: 'blurIn',
      animOut: 'fade',
      animDuration: 0.6
    }
  },
  {
    id: 'glow-soft',
    group: 'Neon & glow',
    name: 'Soft glow',
    sample: 'warm light',
    fx: {
      fontSize: 88,
      color: '#fff4e2',
      bgColor: 'transparent',
      fontFamily: 'Didot',
      fontWeight: 700,
      letterSpacing: 3,
      strokeColor: 'transparent',
      strokeWidth: 0,
      shadowColor: 'rgba(255,190,120,0.75)',
      shadowBlur: 34,
      shadowX: 0,
      shadowY: 0,
      x: 0.5,
      y: 0.5,
      align: 'center',
      animIn: 'dollyIn',
      animOut: 'fade',
      animDuration: 0.8
    }
  },
  {
    id: 'mono-outline',
    group: 'Typografie',
    name: 'Mono outline',
    sample: 'NOIR',
    fx: {
      fontSize: 108,
      color: 'transparent',
      bgColor: 'transparent',
      fontFamily: 'Menlo',
      fontWeight: 700,
      letterSpacing: 14,
      strokeColor: '#f5f5f5',
      strokeWidth: 3,
      shadowColor: 'rgba(255,255,255,0.25)',
      shadowBlur: 12,
      shadowX: 0,
      shadowY: 0,
      x: 0.5,
      y: 0.5,
      align: 'center',
      animIn: 'sway',
      animOut: 'fade',
      animDuration: 0.7
    }
  },
  {
    id: 'editorial-serif',
    group: 'Typografie',
    name: 'Editorial',
    sample: 'Kunst',
    fx: {
      fontSize: 128,
      color: '#141414',
      bgColor: 'transparent',
      fontFamily: 'Baskerville',
      fontWeight: 700,
      letterSpacing: 0,
      strokeColor: 'transparent',
      strokeWidth: 0,
      shadowColor: 'rgba(0,0,0,0.18)',
      shadowBlur: 8,
      shadowX: 3,
      shadowY: 4,
      x: 0.5,
      y: 0.5,
      align: 'center',
      animIn: 'ceilingDrop',
      animOut: 'depthSink',
      animDuration: 0.6
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
  /**
   * Dynamische effecten (flits, schudden, …). Ontbreken ze — zoals in oude
   * projecten — dan gelden ze als 0; overal staat `?? 0` of `> 0` dus er
   * hoeft niets gemigreerd te worden.
   */
  /** witte flitsen, sterkte 0..1 */
  flash: number
  /** flitsen per seconde */
  flashRate: number
  /** camerashake, amplitude 0..1 */
  shake: number
  /** schudtempo 0..1 (→ 2..12 Hz) */
  shakeSpeed: number
  /** pompende zoom, sterkte 0..1 */
  zoom: number
  /** zoomtempo 0..1 (→ 0.8..3 Hz) */
  zoomSpeed: number
  /** filmkorrel 0..1 */
  grain: number
  /** helderheidsflikker 0..1 */
  flicker: number
  /** 0 = uit, 1 = horizontaal, 2 = verticaal */
  mirror: number
  /** Temperature: -80 (koel/blauw) .. 80 (warm/goud) */
  temperature: number
  /** Tint: -80 (groen) .. 80 (magenta) */
  tint: number
  /** Color wheels - shadows */
  shadowColor: string
  /** Color wheels - midtones */
  midtoneColor: string
  /** Color wheels - highlights */
  highlightColor: string
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
  /**
   * Asset-id van de VIDEOCLIP waar dit audio-clip uit gehaald is. Zo weet de
   * preview/export dat de video zelf al stil moet zijn — anders dubbel geluid.
   */
  extractedFromAssetId?: string
  /** EQ / compressor / ruisreductie / reverb op dit clipje (audio én video) */
  audioFx?: AudioEffects
  /**
   * Achterstevoren afspelen (alleen video/audio, geen tekst). De preview
   * stapt het beeld terug (een <video> kan niet zelf achteruit) en dempt het
   * geluid — dat kan niet achteruit afgespeeld worden zonder het eerst om te
   * keren. De export keert wél echt om (reverse/areverse).
   */
  reversed?: boolean
  /**
   * Freeze: lokale seconde waarop het beeld stilstaat, null = uit. Tijdens
   * [freezeAt, freezeAt + freezeDuration) staat het frame van `freezeAt` stil;
   * de video eronder in dat stuk wordt overgeslagen, de timeline zelf
   * verandert niet (geen ripple). Het geluid van de clip staat in dat stuk
   * stil; in de export wordt het gedempt.
   */
  freezeAt?: number | null
  /** Freeze-duur in seconden. */
  freezeDuration?: number
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
  /** wat er geëxporteerd wordt: met zowel beeld als geluid, of eruit gelaten */
  mode?: 'both' | 'video' | 'audio'
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

/**
 * Audio-effecten per clip. Bewust klein en duidelijk: drie EQ-banden,
 * compressie, ruisreductie en reverb.
 *
 * Preview-ondersteuning staat in het commentaar per veld — liever een eerlijke
 * "alleen bij export" dan een schuiver die in de preview niets doet.
 */
export interface AudioEffects {
  /** low shelf, dB (-12..12) · preview: lowshelf */
  eqLow: number
  /** peaking @1 kHz, dB (-12..12) · preview: peaking */
  eqMid: number
  /** high shelf, dB (-12..12) · preview: highshelf */
  eqHigh: number
  /** 0..1 · preview: DynamicsCompressor */
  compressor: number
  /** 0..1 · ALLEEN bij export (ffmpeg afftdn) — geen eerlijke preview in Web Audio */
  noiseReduction: number
  /** 0..1 · preview: ConvolverNode met synthetische ruimte-impuls */
  reverb: number
}

export const DEFAULT_AUDIO_EFFECTS: AudioEffects = {
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  compressor: 0,
  noiseReduction: 0,
  reverb: 0
}

/** Heeft dit clipje audio-effecten (dus: is er iets om te renderen)? */
export function hasAudioFx(fx: AudioEffects | undefined): boolean {
  if (!fx) return false
  return (
    Math.abs(fx.eqLow) > 0.01 ||
    Math.abs(fx.eqMid) > 0.01 ||
    Math.abs(fx.eqHigh) > 0.01 ||
    fx.compressor > 0.01 ||
    fx.noiseReduction > 0.01 ||
    fx.reverb > 0.01
  )
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
  vignette: 0,
  flash: 0,
  flashRate: 2,
  shake: 0,
  shakeSpeed: 0.5,
  zoom: 0,
  zoomSpeed: 0.5,
  grain: 0,
  flicker: 0,
  mirror: 0,
  temperature: 0,
  tint: 0,
  shadowColor: '#000000',
  midtoneColor: '#000000',
  highlightColor: '#ffffff'
}

export const uid = (): string => 'x' + Math.random().toString(36).slice(2, 10)

/**
 * Speelt er al een eigen audio-clip onder deze videoclip? Dan moet de video
 * zelf stil, anders hoor je alles twee keer (in preview én in de export).
 * Matcht op `assetId` (companion-clip uit de import) óf op
 * `extractedFromAssetId` (echt geëxtraheerd bestand) en op tijdelijke overlap,
 * zodat een ingekorte videoclip met een langere audio-clip ook stil is.
 */
export function hasSeparateAudioClip(clip: Clip, clips: Clip[]): boolean {
  if (clip.kind !== 'video') return false
  const from = clip.start + 0.01
  const to = clip.start + Math.max(clip.duration, 0.01) - 0.01
  if (to <= from) return false
  return clips.some((c) => {
    if (c.kind !== 'audio') return false
    if (c.assetId !== clip.assetId && c.extractedFromAssetId !== clip.assetId) return false
    const cFrom = c.start
    const cTo = c.start + Math.max(c.duration, 0.01)
    return cFrom < to && cTo > from
  })
}

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

/**
 * Een bewaard projectbestand (.sapremier) voor de Recent-lijst op Home.
 * Alleen projecten — geen losse mediabestanden meer. De thumbnail is een
 * kleine jpeg-dataURL van de preview op het moment van bewaren; ontbreekt
 * hij, dan toont de kaart een fallback-icoon.
 */
export interface RecentProjectItem {
  path: string
  name: string
  thumbnail?: string
  clipCount: number
  assetCount: number
  duration: number
  updatedAt: number
}

/**
 * Voortgang van de auto-updater. De main-process stuurt dit naar de UI in
 * plaats van blokkerende systeemdialogen, zodat een update net zo voelt als de
 * rest van de app (banner met voortgang, geen knop die "bij hangt").
 */
/** Versie + of we in een gebouwde app draaien (dev heeft geen update-feed). */
export interface AppInfo {
  version: string
  packaged: boolean
}

export type UpdaterPhase = 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

export interface UpdaterStatus {
  phase: UpdaterPhase
  /** versie waar het om gaat (of de huidige, bij not-available) */
  version?: string
  /** 0–100 tijdens downloaden */
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  message?: string
}

export interface ComfyStatus {
  available: boolean
  device?: string
  deviceType?: string
  vramTotal?: number
  installing?: string
}

/** Waar de ComfyUI-installatie staat (standaard ~/ComfyUI, of zelf aangewezen). */
export interface ComfyDirInfo {
  /** pad dat de app gebruikt */
  dir: string
  /** bestaat die map? */
  exists: boolean
  /** bevat die map main.py? (anders is het geen ComfyUI) */
  hasMain: boolean
  /** bevat die map een venv met python? */
  hasVenv: boolean
  /** komt het pad uit de instelling of is het de standaard ~/ComfyUI? */
  custom: boolean
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
