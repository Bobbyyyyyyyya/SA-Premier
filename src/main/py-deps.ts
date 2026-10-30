import { spawn } from 'node:child_process'

/**
 * Snel checken of een Python-omgeving de deps voor onze AI-servers heeft.
 *
 * Zonder deze check spawnt de app de server en wacht dan 10–60 s op een
 * timeout, terwijl de echte oorzaak (een kapotte venv, ontbrekende torch) in
 * één seconde te vinden is. De uitkomst wordt per interpreter gecachet.
 */
const cache = new Map<string, boolean>()

export function pythonDepsOk(bin: string, importLine: string, timeoutMs = 20000): Promise<boolean> {
  const key = `${bin}|${importLine}`
  const hit = cache.get(key)
  if (hit != null) return Promise.resolve(hit)
  return new Promise<boolean>((resolve) => {
    let settled = false
    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      cache.set(key, ok)
      resolve(ok)
    }
    const child = spawn(bin, ['-c', importLine], { stdio: 'ignore' })
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      done(false)
    }, timeoutMs)
    child.on('error', () => {
      clearTimeout(timer)
      done(false)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      done(code === 0)
    })
  })
}

/** Python uit de ComfyUI-map (venv eerst, anders systeem-python). */
export function venvPython(dir: string): string | null {
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const cands = [
    path.join(dir, 'venv', 'bin', 'python'),
    path.join(dir, 'venv', 'Scripts', 'python.exe')
  ]
  for (const c of cands) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      // ignore
    }
  }
  return null
}

let pythonCache: string | null | undefined

function tryRun(bin: string, args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (code: number | null): void => {
      if (settled) return
      settled = true
      resolve(code)
    }
    try {
      const child = spawn(bin, args, { stdio: 'ignore' })
      const t = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
        done(null)
      }, 10000)
      child.on('error', () => {
        clearTimeout(t)
        done(null)
      })
      child.on('exit', (code) => {
        clearTimeout(t)
        done(code)
      })
    } catch {
      done(null)
    }
  })
}

/**
 * Werkende Python-interpreter vinden. Belangrijk op Windows: het systeem heeft
 * vaak een "python.exe" stub (Microsoft Store) die exit 9009 geeft in plaats
 * van Python te starten. Daarom kandidaten echt even draaien en de uitkomst
 * cachen. Een venv naast de bekende AI-mappen gaat voor.
 */
export async function findPython(): Promise<string | null> {
  if (pythonCache !== undefined) return pythonCache
  const { comfyBaseDir } = await import('./ai-setup')
  const os = await import('node:os')
  const path = await import('node:path')
  const cands = [
    venvPython(comfyBaseDir()),
    venvPython(path.join(os.homedir(), 'MusicAI')),
    'python3',
    'python'
  ]
  for (const c of cands) {
    if (!c) continue
    const code = await tryRun(c, ['-c', 'import sys; assert sys.version_info >= (3, 9)'])
    if (code === 0) {
      pythonCache = c
      return c
    }
  }
  pythonCache = null
  return null
}
