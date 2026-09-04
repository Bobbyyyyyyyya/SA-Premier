export function formatTime(sec: number, fps = 30): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const f = Math.round((sec - Math.floor(sec)) * fps) % fps
  const pad = (v: number, l = 2): string => String(v).padStart(l, '0')
  return `${pad(m)}:${pad(s)}:${pad(f)}`
}

export function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
