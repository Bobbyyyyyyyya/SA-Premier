import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export type AiSetupMode = 'ondemand' | 'full' | 'custom'

export interface AiSetup {
  /** gekozen modus */
  mode: AiSetupMode
  /** welke engines mogen automatisch starten / gedownload worden */
  comfy: boolean
  music: boolean
  ollama: boolean
  /** heeft de user de keuze al gemaakt (wizard afgerond) */
  completed: boolean
  updatedAt: number
}

const DEFAULTS: AiSetup = {
  mode: 'ondemand',
  comfy: true,
  music: true,
  ollama: true,
  completed: false,
  updatedAt: Date.now()
}

function file(): string {
  return path.join(app.getPath('userData'), 'ai-setup.json')
}

/** Leest keuze die de Windows-installer eventueel al wegschreef (installer-choice.txt). */
function readInstallerChoice(): AiSetup | null {
  // 1) %APPDATA%/SA Premier/installer-choice.txt (geschreven door NSIS)
  try {
    const p = path.join(app.getPath('userData'), 'installer-choice.txt')
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim()
      const parsed = parseChoice(raw)
      if (parsed) return parsed
    }
  } catch {
    // ignore
  }
  // 2) <resources>/installer-choice.txt (geschreven naar $INSTDIR/resources)
  try {
    const base = bundledBase()
    if (base) {
      const p2 = path.join(base, 'installer-choice.txt')
      if (fs.existsSync(p2)) {
        const raw = fs.readFileSync(p2, 'utf8').trim()
        const parsed = parseChoice(raw)
        if (parsed) return parsed
      }
    }
  } catch {
    // ignore
  }
  return null
}

function parseChoice(raw: string): AiSetup | null {
  const r = raw.trim()
  if (r === 'ondemand' || r === 'full') {
    return { mode: r as AiSetupMode, comfy: true, music: true, ollama: true, completed: true, updatedAt: Date.now() }
  }
  if (r.startsWith('custom:')) {
    const comfy = r.includes('comfy=1')
    const music = r.includes('music=1')
    const ollama = r.includes('ollama=1')
    return { mode: 'custom', comfy, music, ollama, completed: true, updatedAt: Date.now() }
  }
  return null
}

function primeFromInstallerIfNeeded(): void {
  try {
    if (fs.existsSync(file())) return
    const from = readInstallerChoice()
    if (!from) return
    fs.mkdirSync(path.dirname(file()), { recursive: true })
    fs.writeFileSync(file(), JSON.stringify(from, null, 2))
    // keuze geïmporteerd — opruimen hoeft niet, maar mag
    try { fs.unlinkSync(path.join(app.getPath('userData'), 'installer-choice.txt')) } catch { /* ignore */ }
    try {
      const base = bundledBase()
      if (base) fs.unlinkSync(path.join(base, 'installer-choice.txt'))
    } catch { /* ignore */ }
  } catch {
    // ignore
  }
}

export function getAiSetup(): AiSetup {
  primeFromInstallerIfNeeded()
  try {
    const p = file()
    if (!fs.existsSync(p)) return { ...DEFAULTS }
    const raw = fs.readFileSync(p, 'utf8')
    const data = JSON.parse(raw) as Partial<AiSetup>
    return {
      mode: data.mode ?? DEFAULTS.mode,
      comfy: data.comfy ?? true,
      music: data.music ?? true,
      ollama: data.ollama ?? true,
      completed: data.completed ?? false,
      updatedAt: data.updatedAt ?? Date.now()
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function setAiSetup(patch: Partial<AiSetup>): AiSetup {
  const cur = getAiSetup()
  const next: AiSetup = {
    ...cur,
    ...patch,
    updatedAt: Date.now()
  }
  // mode afleiden als custom flags gegeven zijn zonder expliciete mode
  if (patch.comfy !== undefined || patch.music !== undefined || patch.ollama !== undefined) {
    if (!patch.mode) {
      const all = next.comfy && next.music && next.ollama
      const none = !next.comfy && !next.music && !next.ollama
      next.mode = all ? 'full' : none ? 'ondemand' : 'custom'
      // 'ondemand' betekent hier: alles aan maar on-demand downloaden.
      // Volledig uit = custom met alles uit.
      if (none) next.mode = 'custom'
    }
  }
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true })
    fs.writeFileSync(file(), JSON.stringify(next, null, 2))
  } catch {
    // ignore
  }
  return next
}

/** Mag deze engine automatisch starten? Voor eerste run (niet completed): ja. */
export function shouldAutostart(engine: 'comfy' | 'music' | 'ollama'): boolean {
  const s = getAiSetup()
  if (!s.completed) return true
  return s[engine]
}

/**
 * Pad naar meegeleverde resources (Full-build).
 * In packaged app: <resources>/models/..., <resources>/comfy/...
 * In dev: <repo>/resources/...
 */
export function bundledBase(): string | null {
  try {
    // packaged
    const res = (process as unknown as { resourcesPath?: string }).resourcesPath
    if (res && fs.existsSync(res)) return res
  } catch {
    // ignore
  }
  // dev fallback: resources/ naast project root
  try {
    const cand = path.join(app.getAppPath(), 'resources')
    if (fs.existsSync(cand)) return cand
    const cand2 = path.join(app.getAppPath(), '..', 'resources')
    if (fs.existsSync(cand2)) return cand2
  } catch {
    // ignore
  }
  return null
}

export function bundledPath(...segs: string[]): string | null {
  const base = bundledBase()
  if (!base) return null
  const p = path.join(base, ...segs)
  return fs.existsSync(p) ? p : null
}

/** Lijst meegeleverde checkpoints (Full-build) zonder ComfyUI-server nodig. */
export function listBundledCheckpoints(): { name: string; size: number; path: string }[] {
  const out: { name: string; size: number; path: string }[] = []
  const base = bundledBase()
  if (!base) return out
  for (const sub of ['models/checkpoints', 'models', 'comfy/models/checkpoints']) {
    const dir = path.join(base, sub)
    try {
      if (!fs.existsSync(dir)) continue
      for (const f of fs.readdirSync(dir)) {
        if (!/\.(safetensors|ckpt|pt|bin)$/i.test(f)) continue
        const fp = path.join(dir, f)
        try {
          const st = fs.statSync(fp)
          if (!out.some((o) => o.name === f)) out.push({ name: f, size: st.size, path: fp })
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }
  return out
}

/** Samenvatting voor de wizard: wat is al aanwezig? */
export function aiSetupSummary(): {
  setup: AiSetup
  bundled: { checkpoints: { name: string; size: number }[]; hasBundled: boolean }
} {
  const setup = getAiSetup()
  const checkpoints = listBundledCheckpoints()
  return { setup, bundled: { checkpoints, hasBundled: checkpoints.length > 0 } }
}
