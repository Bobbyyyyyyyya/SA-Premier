import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RecentProjectItem, SavedProject } from '../shared/types'

function file(): string {
  return path.join(app.getPath('userData'), 'project.json')
}

// project.json is the entire editor state. One careless byte here and the next
// 2 months are spent answering "where did my timeline go".
export function loadProject(): SavedProject | null {
  try {
    const p = file()
    if (!fs.existsSync(p)) return null
    const raw = fs.readFileSync(p, 'utf8')
    const data = JSON.parse(raw) as SavedProject
    if (!data || !Array.isArray(data.clips) || !Array.isArray(data.assets)) return null
    return data
  } catch {
    return null
  }
}

export function saveProject(data: SavedProject): void {
  try {
    const p = file()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(data, null, 2))
  } catch {
    // ignore
  }
}

export function clearProject(): void {
  try {
    const p = file()
    if (fs.existsSync(p)) fs.unlinkSync(p)
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/* Benoemde projectbestanden (.sapremier) + recente projecten          */
/*                                                                     */
/* Naast de autosave-sleuf hierboven (project.json) kan een project als */
/* eigen bestand bewaard en heropend worden. Home → Recent toont        */
/* uitsluitend deze bestanden — geen losse media meer.                 */
/* ------------------------------------------------------------------ */

export const PROJECT_EXT = 'sapremier'
const RECENT_MAX = 24

/** Het bestand waar het open project aan hangt. null = nog nooit bewaard. */
let currentPath: string | null = null

export function getCurrentProjectPath(): string | null {
  return currentPath
}

function projectsDir(): string {
  return path.join(os.homedir(), 'Movies', 'SA Premier')
}

function sanitizeFileName(name: string): string {
  const clean = (name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().replace(/\s+/g, ' ')
  return clean || 'Naamloos project'
}

function isValidProject(data: unknown): data is SavedProject {
  const d = data as SavedProject | null
  return !!d && Array.isArray(d.clips) && Array.isArray(d.assets) && !!d.project
}

function projectDuration(data: SavedProject): number {
  return data.clips.reduce((m, c) => Math.max(m, (c.start ?? 0) + (c.duration ?? 0)), 0)
}

function recentFile(): string {
  return path.join(app.getPath('userData'), 'recent-projects.json')
}

function readRecentProjects(): RecentProjectItem[] {
  try {
    const raw = fs.readFileSync(recentFile(), 'utf8')
    const arr = JSON.parse(raw) as RecentProjectItem[]
    if (!Array.isArray(arr)) return []
    return arr.filter((r) => r && typeof r.path === 'string')
  } catch {
    return []
  }
}

/** Lijst voor Home, met verdwenen bestanden er automatisch uit. */
export function listRecentProjects(): RecentProjectItem[] {
  const list = readRecentProjects().filter((r) => {
    try {
      return fs.existsSync(r.path)
    } catch {
      return false
    }
  })
  // Alleen terugschrijven als er echt iets verdween, zodat we geen
  // schijfjitter veroorzaken bij elk openen van Home.
  if (list.length !== readRecentProjects().length) {
    try {
      fs.writeFileSync(recentFile(), JSON.stringify(list, null, 2))
    } catch {
      // ignore
    }
  }
  return list
}

function writeRecentProjects(list: RecentProjectItem[]): void {
  try {
    fs.mkdirSync(path.dirname(recentFile()), { recursive: true })
    fs.writeFileSync(recentFile(), JSON.stringify(list.slice(0, RECENT_MAX), null, 2))
  } catch {
    // ignore
  }
}

function touchRecentProject(entry: Omit<RecentProjectItem, 'updatedAt'> & { updatedAt?: number }): RecentProjectItem[] {
  const prev = readRecentProjects().find((r) => r.path === entry.path)
  const next: RecentProjectItem = {
    path: entry.path,
    name: entry.name || prev?.name || path.basename(entry.path, `.${PROJECT_EXT}`),
    // Bij openen is er geen nieuwe thumbnail; bewaar dan de oude.
    thumbnail: entry.thumbnail ?? prev?.thumbnail,
    clipCount: entry.clipCount,
    assetCount: entry.assetCount,
    duration: entry.duration,
    updatedAt: Date.now()
  }
  const list = [next, ...readRecentProjects().filter((r) => r.path !== entry.path)].slice(0, RECENT_MAX)
  writeRecentProjects(list)
  return list
}

export function clearRecentProjects(): RecentProjectItem[] {
  try {
    if (fs.existsSync(recentFile())) fs.unlinkSync(recentFile())
  } catch {
    // ignore
  }
  return []
}

export interface ProjectFileMeta {
  thumbnail?: string
}

function metaFor(data: SavedProject, thumbnail?: string): Omit<RecentProjectItem, 'path' | 'updatedAt'> {
  return {
    name: data.project?.name || 'Naamloos project',
    thumbnail,
    clipCount: data.clips.length,
    assetCount: data.assets.length,
    duration: projectDuration(data)
  }
}

function writeProjectFile(p: string, data: SavedProject): void {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2))
}

export interface SaveProjectResult {
  ok: boolean
  path?: string
  cancelled?: boolean
  error?: string
}

/** Bewaren naar het bekende bestand. Zonder bekend bestand → gedraagt zich als Bewaar als. */
export async function saveProjectFile(
  win: BrowserWindow | null,
  data: SavedProject,
  meta?: ProjectFileMeta
): Promise<SaveProjectResult> {
  if (!currentPath) return saveProjectFileAs(win, data, meta)
  try {
    writeProjectFile(currentPath, data)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  touchRecentProject({ path: currentPath, ...metaFor(data, meta?.thumbnail) })
  return { ok: true, path: currentPath }
}

export async function saveProjectFileAs(
  win: BrowserWindow | null,
  data: SavedProject,
  meta?: ProjectFileMeta
): Promise<SaveProjectResult> {
  const dir = projectsDir()
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    // ignore — dialoog valt terug op de standaardmap
  }
  const saveOpts = {
    title: 'Project bewaren',
    defaultPath: path.join(dir, `${sanitizeFileName(data.project?.name)}.sapremier`),
    filters: [{ name: 'SA Premier-project', extensions: [PROJECT_EXT] }]
  }
  const res = win
    ? await dialog.showSaveDialog(win, saveOpts)
    : await dialog.showSaveDialog(saveOpts)
  if (res.canceled || !res.filePath) return { ok: false, cancelled: true }
  const out = res.filePath.toLowerCase().endsWith(`.${PROJECT_EXT}`) ? res.filePath : `${res.filePath}.${PROJECT_EXT}`
  try {
    writeProjectFile(out, data)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  currentPath = out
  touchRecentProject({ path: out, ...metaFor(data, meta?.thumbnail) })
  return { ok: true, path: out }
}

export interface OpenProjectResult {
  ok: boolean
  path?: string
  data?: SavedProject
  cancelled?: boolean
  error?: string
  missing?: boolean
}

function readProjectFile(p: string): OpenProjectResult {
  let raw: string
  try {
    raw = fs.readFileSync(p, 'utf8')
  } catch {
    return { ok: false, missing: true, error: 'Bestand niet gevonden' }
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Dit is geen leesbaar projectbestand' }
  }
  if (!isValidProject(data)) return { ok: false, error: 'Dit is geen SA Premier-project' }
  return { ok: true, path: p, data }
}

/** Openen via een dialoog. */
export async function openProjectFileDialog(win: BrowserWindow | null): Promise<OpenProjectResult> {
  const dir = projectsDir()
  const openOpts = {
    title: 'Project openen',
    defaultPath: fs.existsSync(dir) ? dir : os.homedir(),
    filters: [{ name: 'SA Premier-project', extensions: [PROJECT_EXT] }],
    properties: ['openFile' as const]
  }
  const res = win
    ? await dialog.showOpenDialog(win, openOpts)
    : await dialog.showOpenDialog(openOpts)
  if (res.canceled || !res.filePaths.length) return { ok: false, cancelled: true }
  const out = readProjectFile(res.filePaths[0])
  if (!out.ok) return out
  currentPath = out.path!
  touchRecentProject({ path: out.path!, ...metaFor(out.data!) })
  return out
}

/** Openen vanaf een bekend pad (kaart op Home). Zonder dialoog. */
export function openProjectFileAt(p: string): OpenProjectResult {
  const out = readProjectFile(p)
  if (!out.ok) return out
  currentPath = out.path!
  touchRecentProject({ path: out.path!, ...metaFor(out.data!) })
  return out
}

/** Nieuw (leeg) project: vergeet ook het gekoppelde bestand. */
export function forgetCurrentProjectPath(): void {
  currentPath = null
}
