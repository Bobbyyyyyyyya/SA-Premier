import { spawn, ChildProcess, execSync } from 'node:child_process'
import { app } from 'electron'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { CatalogModel, InstallProgress, InstalledModel } from '../shared/types'
import { comfyBaseDir } from './ai-setup'
import { findPython, pythonDepsOk, venvPython } from './py-deps'

const PORT = 8189
const BASE = `http://127.0.0.1:${PORT}`
/** Zelfde map als ComfyUI (standaard ~/ComfyUI, of wat de user heeft aangewezen). */
function comfyDir(): string {
  return comfyBaseDir()
}
let server: ChildProcess | null = null
/** Single-flight: voorkomt dubbele start + kill-race (exit null). */
let starting: Promise<{ available: boolean; started?: boolean; error?: string }> | null = null

/**
 * Waar het MusicGen-script staat. Vroeger stond het alleen in `~/ComfyUI`, wat
 * betekende dat de functie stilletjes verdween zodra die map weg was. Nu levert
 * de app het zelf mee (`resources/ai/music_server.py` → `<resources>/ai/` in de
 * gebouwde app) en blijven de oude locaties als fallback bestaan.
 */
function scriptCandidates(): string[] {
  const out: string[] = []
  const res = (process as unknown as { resourcesPath?: string }).resourcesPath
  if (res) out.push(path.join(res, 'ai', 'music_server.py'))
  out.push(path.join(process.cwd(), 'resources', 'ai', 'music_server.py'))
  out.push(path.join(app.getAppPath(), 'resources', 'ai', 'music_server.py'))
  out.push(path.join(comfyDir(), 'music_server.py'))
  out.push(path.join(os.homedir(), 'MusicAI', 'music_server.py'))
  return out
}

function findServerScript(): string | null {
  for (const p of scriptCandidates()) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      // ignore
    }
  }
  return null
}

function pythonBin(): string {
  // venv naast het gevonden script eerst (ComfyUI-map incl. venv), dan de oude paden
  const entry = findServerScript()
  const near: string[] = entry
    ? [
        path.join(path.dirname(entry), 'venv', 'bin', 'python'),
        path.join(path.dirname(entry), 'venv', 'Scripts', 'python.exe')
      ]
    : []
  for (const c of near) {
    if (fs.existsSync(c)) return c
  }
  return venvPython(comfyDir()) ?? venvPython(path.join(os.homedir(), 'MusicAI')) ?? 'python'
}

function killZombieOnPort(port: number): void {
  // Niet killen als wij al een eigen server-proces hebben.
  if (server) return
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

async function waitForMusicReady(timeoutMs = 45000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const s = await musicStatus()
      if (s.available) return true
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return false
}

/** Start MusicGen-server automatisch en wacht tot hij bereikbaar is. */
export async function ensureMusicAIAsync(waitMs = 45000): Promise<{ available: boolean; started?: boolean; error?: string }> {
  if (starting) return starting
  starting = doEnsureMusicAIAsync(waitMs).finally(() => {
    starting = null
  })
  return starting
}

async function doEnsureMusicAIAsync(waitMs: number): Promise<{ available: boolean; started?: boolean; error?: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const setup = require('./ai-setup') as typeof import('./ai-setup')
    if (!setup.shouldAutostart('music')) {
      return { available: false, error: 'MusicGen is uitgeschakeld in AI-setup (wizard). Zet hem daar weer aan.' }
    }
  } catch {
    // ignore
  }
  const s = await musicStatus()
  if (s.available) return { available: true, started: false }

  killZombieOnPort(PORT)
  await new Promise((r) => setTimeout(r, 500))

  const entry = findServerScript()
  if (!entry) {
    return {
      available: false,
      error:
        'MusicGen-script niet gevonden. Het hoort bij de app te zitten (resources/ai/music_server.py) — ' +
        'herinstalleer de app, of zet music_server.py in ~/ComfyUI. Zonder dit blijft de synth-fallback werken.'
    }
  }
  const bin = pythonBin()
  if (!(await pythonDepsOk(bin, 'import torch, transformers, numpy, aiohttp, scipy'))) {
    return {
      available: false,
      error:
        `MusicGen kan niet starten: ${bin} mist torch/transformers (of die venv is kapot). ` +
        'Installeer die in een venv naast music_server.py; de synth-fallback blijft intussen gewoon werken.'
    }
  }
  try {
    console.log('[music] starting server:', bin, entry)
    if (server) {
      try { server.kill() } catch { /* ignore */ }
      server = null
    }
    const logPath = path.join(os.tmpdir(), 'sa-premier-music.log')
    const logFd = fs.openSync(logPath, 'a')
    fs.writeSync(logFd, `\n--- start ${new Date().toISOString()} ---\n`)
    server = spawn(bin, [entry], {
      cwd: path.dirname(entry),
      stdio: ['ignore', logFd, logFd],
      detached: true,
      env: { ...process.env, PYTHONUNBUFFERED: '1', TQDM_DISABLE: '1', MUSIC_PORT: String(PORT) }
    })
    try { fs.closeSync(logFd) } catch { /* ignore */ }
    server.unref()
    server.on('exit', (code, signal) => {
      console.log('[music] server exited with code', code, signal ? `signal=${signal}` : '')
      server = null
    })
    server.on('error', (e) => {
      console.error('[music] failed to start:', e.message)
      server = null
    })
  } catch (e) {
    return { available: false, error: (e as Error).message }
  }
  const ok = await waitForMusicReady(waitMs)
  return ok ? { available: true, started: true } : { available: false, error: 'Music-server start, maar reageert niet (timeout). Synth blijft beschikbaar.' }
}

export function ensureMusicAI(): void {
  void ensureMusicAIAsync()
}

export function stopMusicAI(): void {
  if (server) {
    try { server.kill() } catch {}
    server = null
  }
}

/**
 * Harde stop bij afsluiten: eigen child én alles wat nog op de poort
 * luistert. Nodig omdat de server detached + unref'd start — zombies uit
 * eerdere sessies staan niet meer in `server` en overleefden `stopMusicAI`.
 */
export function forceStopMusicAI(): void {
  stopMusicAI()
  try {
    execSync(`lsof -ti :${PORT} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' })
  } catch { /* niets meer op de poort */ }
}

export function killOrphanServers(): void {
  const bin = pythonBin()
  try {
    spawn(bin, ['-c', 'import subprocess,sys; subprocess.Popen(["pkill","-f","music_server.py"], start_new_session=True)'], { stdio: 'ignore' }).unref()
  } catch {}
}

export interface MusicGenProgress {
  percent: number
  phase: string
  message?: string
  step?: number
  total?: number
}

export async function generateMusic(
  prompt: string,
  seconds: number,
  modelId: string,
  onProgress?: (p: MusicGenProgress) => void
): Promise<{ ok: boolean; base64?: string; error?: string }> {
  let stopped = false
  let lastPct = -1
  // echte voortgang van de python-server pollen (/progress) zodat de balk niet op 10% blijft hangen
  const poll = async (): Promise<void> => {
    while (!stopped) {
      await sleep(400)
      if (stopped) return
      try {
        // http.get i.p.v. fetch: undici's fetch kan op macOS EINVAL gooien bij veel polling
        const p = await pollProgress()
        if (!p) continue
        if (p.phase === 'error') {
          onProgress?.({ percent: 0, phase: 'error', message: p.message })
          continue
        }
        if (p.percent > lastPct) {
          lastPct = p.percent
          onProgress?.(p)
        }
      } catch {
        /* server even niet bereikbaar: laatste stand vasthouden */
      }
    }
  }
  void poll()
  try {
    const r = await fetch(`${BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, duration: seconds, model: modelId }),
      signal: AbortSignal.timeout(600000) // model laden + genereren kan even duren
    })
    const j = await r.json() as { ok: boolean; base64?: string; error?: string }
    stopped = true
    if (!r.ok || !j.ok) return { ok: false, error: j.error || `HTTP ${r.status}` }
    onProgress?.({ percent: 100, phase: 'done', message: 'Klaar' })
    return { ok: true, base64: j.base64 }
  } catch (e) {
    stopped = true
    return { ok: false, error: (e as Error).message }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function pollProgress(): Promise<MusicGenProgress | null> {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}/progress`, { agent: false, timeout: 2500 }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(body) as MusicGenProgress)
        } catch {
          resolve(null)
        }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
  })
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
  // Werkende python vinden — op Windows geeft de Store-stub van python.exe
  // anders exit 9009 en blijft de gebruiker met een cryptische fout zitten.
  const bin = await findPython()
  if (!bin) {
    const p: InstallProgress = {
      id: catalog.id,
      phase: 'error',
      message: 'Python 3 niet gevonden. Installeer Python 3.10+ van python.org (vink "Add python.exe to PATH" aan) en herstart de app.'
    }
    onProgress(p)
    return p
  }
  // huggingface_hub moet in deze interpreter zitten; ontbreekt het, dan één
  // keer via pip installeren (user-site, geen venv nodig).
  const hubOk = await pythonDepsOk(bin, 'import huggingface_hub')
  if (!hubOk) {
    onProgress({ id: catalog.id, phase: 'downloading', percent: 2, totalMb: catalog.sizeMb })
    await new Promise<void>((resolve) => {
      const pip = spawn(bin, ['-m', 'pip', 'install', '--user', '--quiet', 'huggingface_hub'], { stdio: 'ignore' })
      pip.on('error', () => resolve())
      pip.on('exit', () => resolve())
      // pip kan traag zijn; cap op 5 min
      const t = setTimeout(() => {
        try { pip.kill() } catch { /* ignore */ }
        resolve()
      }, 300000)
      pip.on('exit', () => clearTimeout(t))
    })
  }
  if (!(await pythonDepsOk(bin, 'import huggingface_hub'))) {
    const p: InstallProgress = {
      id: catalog.id,
      phase: 'error',
      message: 'Kon de downloadbibliotheek (huggingface_hub) niet installeren. Installeer handmatig: python -m pip install huggingface_hub'
    }
    onProgress(p)
    return p
  }
  // echte voortgang: snapshot_download + tqdm printen percentages op stderr
  const script = `
from huggingface_hub import snapshot_download
import sys
mid=sys.argv[1]
print("downloading", mid, flush=True)
snapshot_download(repo_id=mid, max_workers=4)
print("done", flush=True)
`
  const tmp = path.join(os.tmpdir(), `dl-${catalog.id.replace('/', '_')}.py`)
  fs.writeFileSync(tmp, script)
  const child = spawn(bin, [tmp, catalog.id], { stdio: ['ignore', 'pipe', 'pipe'] })
  let lastPct = 0
  const push = (pct: number): void => {
    if (pct > lastPct) {
      lastPct = pct
      onProgress({ id: catalog.id, phase: 'downloading', percent: pct, downloadedMb: Math.round((pct/100)*catalog.sizeMb), totalMb: catalog.sizeMb })
    }
  }
  child.stdout?.on('data', () => push(Math.min(95, lastPct + 2)))
  let stderrBuf = ''
  child.stderr?.on('data', (d) => {
    // tqdm: "…:  45%|████▍ | 1.2G/2.5G …" → hoogste % pakken
    stderrBuf = (stderrBuf + d.toString()).slice(-2000)
    const matches = stderrBuf.match(/(\d{1,3})%/g)
    if (matches) {
      for (const m of matches) {
        const pct = Math.min(95, Number(m.replace('%', '')))
        if (pct > lastPct) push(pct)
      }
    }
  })
  const done = await new Promise<InstallProgress>((resolve) => {
    child.on('close', (code) => {
      if (code === 0) {
        const p: InstallProgress = { id: catalog.id, phase: 'complete', percent: 100, totalMb: catalog.sizeMb }
        resolve(p)
      } else {
        const why =
          code === 9009
            ? 'Python is niet goed geïnstalleerd (Windows Store stub). Installeer Python 3.10+ van python.org en herstart de app.'
            : code === 1 || code === 2
              ? 'Download mislukt — check je internetverbinding en of er genoeg schijfruimte is.'
              : `Download mislukt (code ${code})`
        const p: InstallProgress = { id: catalog.id, phase: 'error', message: why }
        resolve(p)
      }
    })
    child.on('error', (e) => resolve({ id: catalog.id, phase: 'error', message: (e as Error).message }))
  })
  onProgress(done)
  try { fs.unlinkSync(tmp) } catch {}
  return done
}

export async function uninstallMusicModel(modelId: string): Promise<{ ok: boolean; error?: string }> {
  // server houdt model vast → stoppen en wachten tot bestanden vrijkomen
  stopMusicAI()
  killOrphanServers()
  try {
    execSync(`lsof -ti :${PORT} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' })
  } catch { /* geen listener meer */ }
  await new Promise((r) => setTimeout(r, 500))

  const p = cachePathForModel(modelId)
  const lockDir = path.join(os.homedir(), '.cache', 'huggingface', 'hub', '.locks', 'models--' + modelId.replace('/', '--'))
  try {
    // HF cache kan locks/open bestanden hebben → meerdere pogingen
    for (let attempt = 0; attempt < 4 && fs.existsSync(p); attempt++) {
      try {
        fs.rmSync(p, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
      } catch { /* volgende poging */ }
      if (fs.existsSync(p)) await new Promise((r) => setTimeout(r, 350))
    }
    try {
      if (fs.existsSync(lockDir)) fs.rmSync(lockDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    } catch { /* locks mogen falen */ }
    if (fs.existsSync(p)) return { ok: false, error: 'Map nog aanwezig (file in use?). Sluit de app en probeer opnieuw.' }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
