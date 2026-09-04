import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { SavedProject } from '../shared/types'

function file(): string {
  return path.join(app.getPath('userData'), 'project.json')
}

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
