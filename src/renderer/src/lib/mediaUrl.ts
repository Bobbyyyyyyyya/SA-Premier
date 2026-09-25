// Every path becomes media://local/... Two months ago this was plain file://,
// which Electron refused to serve from a renderer. Progress of a kind.
export function mediaUrl(p: string): string {
  const segs = p
    .split(/[\\/]/)
    .filter(Boolean)
    .map(encodeURIComponent)
  return 'media://local/' + segs.join('/')
}

export function basename(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}
