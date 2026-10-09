import { normalizeSubtitleTracks, orderTracks, initialTracks, useEditorStore } from '../store'
import type { SavedProject } from '../../../shared/types'
import { checkMediaAccess } from './relink'

/** Alles wat in een .sapremier-bestand hoort, uit de store. */
export function collectSavedProject(): SavedProject {
  const s = useEditorStore.getState()
  return {
    project: { ...s.project },
    assets: s.assets,
    clips: s.clips,
    tracks: s.tracks,
    playhead: s.playhead
  }
}

function basenameNoExt(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p
  return base.toLowerCase().endsWith('.sapremier') ? base.slice(0, -10) : base
}

/**
 * Miniatuur van de preview voor op de projectkaart. Best effort: zonder
 * canvas (Home-scherm) of bij een fout is er gewoon geen thumbnail en toont
 * de kaart een icoon.
 */
export function captureThumbnail(): string | undefined {
  try {
    const canvas = document.querySelector('.preview-canvas') as HTMLCanvasElement | null
    if (!canvas || canvas.width < 2 || canvas.height < 2) return undefined
    const small = document.createElement('canvas')
    const w = 320
    small.width = w
    small.height = Math.max(2, Math.round((w * canvas.height) / canvas.width))
    const g = small.getContext('2d')
    if (!g) return undefined
    g.drawImage(canvas, 0, 0, small.width, small.height)
    const url = small.toDataURL('image/jpeg', 0.7)
    // Veiligheidsmarge: thumbnails wonen in recent-projects.json; geen MB's.
    if (url.length > 200_000) return undefined
    return url
  } catch {
    return undefined
  }
}

export interface SaveFileResult {
  ok: boolean
  path?: string
  cancelled?: boolean
  error?: string
}

/**
 * Bewaar naar bestand. Zonder saveAs gaat het naar het gekoppelde bestand;
 * zonder gekoppeld bestand volgt automatisch de dialoog. Na Bewaar als wordt
 * de projectnaam gelijkgetrokken met de bestandsnaam en direct nog een keer
 * weggeschreven, zodat bestand en naam nooit uit elkaar lopen.
 */
export async function saveProjectFile(opts?: { saveAs?: boolean }): Promise<SaveFileResult> {
  const data = collectSavedProject()
  const thumb = captureThumbnail()
  const meta = thumb ? { thumbnail: thumb } : undefined
  const r = opts?.saveAs
    ? await window.api.projectSaveAs(data, meta)
    : await window.api.projectSaveFile(data, meta)
  if (!r.ok || !r.path) return r
  const s2 = useEditorStore.getState()
  s2.setProjectPath(r.path)
  const wanted = basenameNoExt(r.path)
  if (wanted && wanted !== s2.project.name) {
    s2.setProjectName(wanted)
    // naam zit ín het bestand: nog één keer direct wegschrijven (geen dialoog,
    // het pad is net gekoppeld)
    const data2 = collectSavedProject()
    const thumb2 = captureThumbnail()
    await window.api.projectSaveFile(data2, thumb2 ? { thumbnail: thumb2 } : undefined)
  }
  return r
}

export interface OpenFileResult {
  ok: boolean
  cancelled?: boolean
  error?: string
  missing?: boolean
}

function applyProjectData(data: SavedProject, path: string | null): void {
  const n = normalizeSubtitleTracks(data.tracks ?? initialTracks(), data.clips ?? [], { legacy: true })
  useEditorStore.setState({
    project: data.project,
    assets: data.assets ?? [],
    clips: n.clips,
    tracks: orderTracks(n.tracks),
    selectedClipId: null,
    playhead: Math.max(0, data.playhead ?? 0),
    playing: false,
    projectPath: path
  })
  // Zelfde vorm als hydrate bij het opstarten; daarna controleren op
  // verhuisde/ontbrekende media zodat de banner het meldt.
  void checkMediaAccess()
}

/**
 * Project openen: vanaf een kaart (path) of via een dialoog (geen path).
 * Bij een volle timeline eerst bevestigen — zelfde regel als Nieuw project.
 */
export async function openProjectFile(path?: string): Promise<OpenFileResult> {
  const s = useEditorStore.getState()
  if (s.clips.length > 0 || s.assets.length > 0) {
    if (!window.confirm('Ander project openen? Niet-bewaarde wijzigingen gaan verloren.')) {
      return { ok: false, cancelled: true }
    }
  }
  const r = path ? await window.api.projectOpenPath(path) : await window.api.projectOpen()
  if (!r.ok || !r.data) return r
  applyProjectData(r.data, r.path ?? path ?? null)
  useEditorStore.getState().seekTo(Math.max(0, r.data.playhead ?? 0))
  return { ok: true }
}
