import { spawn, ChildProcess, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CatalogModel, InstallProgress, InstalledModel } from '../shared/types'

const PORT = 8189
const BASE = `http://127.0.0.1:${PORT}`
const comfyDir = path.join(os.homedir(), 'ComfyUI')
let server: ChildProcess | null = null

function pythonBin(): string {
  const cands = [
    path.join(comfyDir, 'venv', 'bin', 'python'),
    path.join(comfyDir, 'venv', 'Scripts', 'python.exe'),
    path.join(os.homedir(), 'MusicAI', 'venv', 'bin', 'python'),
  ]
  for (const c of cands) if (fs.existsSync(c)) return c
  return 'python'
}

function killZombieOnPort(port: number): void {
  try {
    execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' })
  } catch {}
}

export async function musicStatus(): Promise<{ available: boolean; device?: string }> {
  try {
    const r = await fetch(`${BASE}/status`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return { available: false }
    const j = await r.json() as { device?: string }
    return { available: true, device: j.device }
  } catch { return { available: false } }
}

export function ensureMusicAI(): void {
  void (async () => {
    const s = await musicStatus()
    if (s.available) return

    killZombieOnPort(PORT)
    await new Promise((r) => setTimeout(r, 500))

    const bin = pythonBin()
    if (!fs.existsSync(path.join(comfyDir, 'music_server.py'))) {
      console.log('[music] music_server.py not found at', path.join(comfyDir, 'music_server.py'))
      return
    }
    console.log('[music] starting server:', bin)
    server = spawn(bin, ['music_server.py'], {
      cwd: comfyDir,
      stdio: 'ignore',
      detached: true,
      env: { ...process.env, PYTHONUNBUFFERED: '1', TQDM_DISABLE: '1' }
    })
    server.unref()
    server.on('exit', (code) => {
      console.log('[music] server exited with code', code)
      server = null
    })
    server.on('error', (e) => {
      console.error('[music] failed to start:', e.message)
      server = null
    })
  })()
}

export function stopMusicAI(): void {
  if (server) {
    try { server.kill() } catch {}
    server = null
  }
}

export function killOrphanServers(): void {
  const bin = pythonBin()
  try {
    spawn(bin, ['-c', 'import subprocess,sys; subprocess.Popen(["pkill","-f","music_server.py"], start_new_session=True)'], { stdio: 'ignore' }).unref()
  } catch {}
}

export async function generateMusic(prompt: string, seconds: number, modelId: string): Promise<{ ok: boolean; base64?: string; error?: string }> {
  try {
    const r = await fetch(`${BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, duration: seconds, model: modelId }),
      signal: AbortSignal.timeout(120000) // 2 min timeout for model loading
    })
    const j = await r.json() as { ok: boolean; base64?: string; error?: string }
    if (!r.ok || !j.ok) return { ok: false, error: j.error || `HTTP ${r.status}` }
    return { ok: true, base64: j.base64 }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

export const MUSIC_CATALOG: CatalogModel[] = [
  { id: 'facebook/musicgen-small', name: 'MusicGen Small (AI)', description: 'AI 300M — fastest, lowest quality. Use only for quick previews. 1.2GB.', url: 'https://huggingface.co/facebook/musicgen-small', sizeMb: 1200, file: 'facebook/musicgen-small', requires: '1.2GB · fast · low quality' },
  { id: 'facebook/musicgen-medium', name: 'MusicGen Medium (AI) — Aanbevolen', description: 'AI 1.5B — beste kwaliteit/snelheid balans. Rijke muziek, snelle beats. 3.5GB.', url: 'https://huggingface.co/facebook/musicgen-medium', sizeMb: 3500, file: 'facebook/musicgen-medium', requires: '3.5GB · 8GB RAM · aanbevolen' },
  { id: 'facebook/musicgen-large', name: 'MusicGen Large (AI) — Beste kwaliteit', description: 'AI 3.3B — de beste kwaliteit. Trager op MPS, geschikt voor 16GB. 6GB.', url: 'https://huggingface.co/facebook/musicgen-large', sizeMb: 6000, file: 'facebook/musicgen-large', requires: '6GB · 16GB RAM · trager' },
  { id: 'facebook/musicgen-stereo-large', name: 'MusicGen Stereo Large', description: 'AI 3.3B stereo — breed, ruimtelijk geluid. Beste stereo. 6GB.', url: 'https://huggingface.co/facebook/musicgen-stereo-large', sizeMb: 6000, file: 'facebook/musicgen-stereo-large', requires: '6GB · stereo · trager' },
]

function cachePathForModel(modelId: string): string {
  const cacheBase = path.join(os.homedir(), '.cache', 'huggingface', 'hub')
  const dirName = 'models--' + modelId.replace('/', '--')
  return path.join(cacheBase, dirName)
}

export function listMusicModels(): InstalledModel[] {
  return MUSIC_CATALOG.map((c) => {
    const p = cachePathForModel(c.id)
    let size = 0
    let exists = false
    try { exists = fs.existsSync(p); if (exists) {
      // approximate size by walking
      const files = fs.readdirSync(p)
      // just check if snapshot exists
      size = c.sizeMb * 1024 * 1024
    }} catch { size = 0 }
    return { name: c.id, size: exists ? size : 0, path: p, installed: exists } as InstalledModel & { installed: boolean }
  }).filter((m) => (m as any).installed).map((m) => ({ name: m.name, size: m.size, path: m.path }))
}

export async function installMusicModel(catalog: CatalogModel, onProgress: (p: InstallProgress) => void): Promise<InstallProgress> {
  const prog: InstallProgress = { id: catalog.id, phase: 'downloading', percent: 0, totalMb: catalog.sizeMb }
  onProgress(prog)
  // trigger download via python huggingface_hub
  const bin = pythonBin()
  const script = `
from huggingface_hub import snapshot_download
import sys
mid=sys.argv[1]
print("downloading", mid)
snapshot_download(repo_id=mid)
print("done")
`
  const tmp = path.join(os.tmpdir(), `dl-${catalog.id.replace('/', '_')}.py`)
  fs.writeFileSync(tmp, script)
  const { spawn } = await import('node:child_process')
  const child = spawn(bin, [tmp, catalog.id], { stdio: ['ignore', 'pipe', 'pipe'] })
  let lastPct = 0
  child.stdout?.on('data', (d) => {
    // fake progress based on time
    lastPct = Math.min(95, lastPct + 5)
    onProgress({ id: catalog.id, phase: 'downloading', percent: lastPct, downloadedMb: Math.round((lastPct/100)*catalog.sizeMb), totalMb: catalog.sizeMb })
  })
  child.stderr?.on('data', (d) => {
    lastPct = Math.min(95, lastPct + 3)
    onProgress({ id: catalog.id, phase: 'downloading', percent: lastPct, downloadedMb: Math.round((lastPct/100)*catalog.sizeMb), totalMb: catalog.sizeMb })
  })
  const done = await new Promise<InstallProgress>((resolve) => {
    child.on('close', (code) => {
      if (code === 0) {
        const p: InstallProgress = { id: catalog.id, phase: 'complete', percent: 100, totalMb: catalog.sizeMb }
        resolve(p)
      } else {
        const p: InstallProgress = { id: catalog.id, phase: 'error', message: `Download failed code ${code}` }
        resolve(p)
      }
    })
    child.on('error', (e) => resolve({ id: catalog.id, phase: 'error', message: (e as Error).message }))
  })
  onProgress(done)
  try { fs.unlinkSync(tmp) } catch {}
  return done
}

export function uninstallMusicModel(modelId: string): { ok: boolean; error?: string } {
  const p = cachePathForModel(modelId)
  try {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
    // also try to clear transformers cache
    return { ok: true }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}
