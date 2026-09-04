import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { RecentMediaItem } from '../shared/types'

let cache: RecentMediaItem[] | null = null

function file(): string {
  return path.join(app.getPath('userData'), 'recent-media.json')
}

export function loadRecents(): RecentMediaItem[] {
  if (cache) return cache
  try {
    if (fs.existsSync(file())) {
      const raw = fs.readFileSync(file(), 'utf8')
      const arr = JSON.parse(raw) as RecentMediaItem[]
      cache = Array.isArray(arr) ? arr : []
    } else {
      cache = []
    }
  } catch {
    cache = []
  }
  return cache!
}

export function addRecent(item: RecentMediaItem): RecentMediaItem[] {
  const list = loadRecents()
  const filtered = list.filter((r) => r.path !== item.path)
  filtered.unshift(item)
  const capped = filtered.slice(0, 50)
  cache = capped
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true })
    fs.writeFileSync(file(), JSON.stringify(capped, null, 2))
  } catch {
    // ignore persistence errors
  }
  return capped
}

export function clearRecents(): RecentMediaItem[] {
  cache = []
  try {
    if (fs.existsSync(file())) fs.unlinkSync(file())
  } catch {
    // ignore
  }
  return []
}
