import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type {
  CatalogModel,
  InstallProgress,
  SubtitleSegment,
  SubtitleTrackResult,
  TranscribeProgress,
  TranscribeRequest,
  TranscribeResult,
  TranscribeStatus
} from '../shared/types'
import { ffmpegBin, extractAudioToFile } from './export'
import { generateText, listModels, pingOllama } from './ai'
import { bundledPath } from './ai-setup'

export const WHISPER_CATALOG: CatalogModel[] = [
  {
    id: 'tiny',
    name: 'Whisper tiny (~75 MB) — snelst, minder accuraat',
    description: 'Alleen voor snelle tests',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    sizeMb: 75,
    file: 'ggml-tiny.bin',
    requires: 'whisper'
  },
  {
    id: 'base',
    name: 'Whisper base (~142 MB) — middel',
    description: 'Redelijke balans, kan nog wat fouten maken',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    sizeMb: 142,
    file: 'ggml-base.bin',
    requires: 'whisper'
  },
  {
    id: 'small',
    name: 'Whisper small (~466 MB) — aanbevolen',
    description: 'Goede accuraatheid voor ondertitels',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    sizeMb: 466,
    file: 'ggml-small.bin',
    requires: 'whisper'
  },
  {
    id: 'medium',
    name: 'Whisper medium (~1.5 GB) — beste accuraatheid',
    description: 'Langzamer, beste kwaliteit in lawaai/accenten',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
    sizeMb: 1480,
    file: 'ggml-medium.bin',
    requires: 'whisper'
  }
]

export const SUBTITLE_LANGUAGES: Array<{ id: string; label: string }> = [
  { id: 'auto', label: 'Auto-detect' },
  { id: 'en', label: 'English' },
  { id: 'nl', label: 'Nederlands' },
  { id: 'de', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
  { id: 'it', label: 'Italiano' },
  { id: 'pt', label: 'Português' },
  { id: 'pl', label: 'Polski' },
  { id: 'tr', label: 'Türkçe' },
  { id: 'ru', label: 'Русский' },
  { id: 'uk', label: 'Українська' },
  { id: 'sv', label: 'Svenska' },
  { id: 'da', label: 'Dansk' },
  { id: 'no', label: 'Norsk' },
  { id: 'fi', label: 'Suomi' },
  { id: 'cs', label: 'Čeština' },
  { id: 'ro', label: 'Română' },
  { id: 'el', label: 'Ελληνικά' },
  { id: 'he', label: 'עברית' },
  { id: 'ar', label: 'العربية' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'zh', label: '中文' }
]

function modelsDir(): string {
  const p = path.join(app.getPath('userData'), 'whisper-models')
  fs.mkdirSync(p, { recursive: true })
  return p
}

function tempDir(): string {
  const p = path.join(app.getPath('temp'), 'sa-premier-transcribe')
  fs.mkdirSync(p, { recursive: true })
  return p
}

function isExec(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK)
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function binName(): string {
  return process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
}

function whisperBinDir(): string {
  const p = path.join(app.getPath('userData'), 'whisper-bin')
  fs.mkdirSync(p, { recursive: true })
  return p
}

/** Zoek een whisper.cpp CLI (bundled → userData → absolute paden → PATH). */
export function findWhisperBin(): string | null {
  const name = binName()
  const bundled = bundledPath('bin', name)
  if (bundled && isExec(bundled)) return bundled
  const local = path.join(whisperBinDir(), name)
  if (isExec(local)) return local
  // absolute paden (Finder-Electron mist vaak Homebrew-PATH)
  const abs =
    process.platform === 'darwin'
      ? ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli', `${process.env.HOME ?? ''}/.local/bin/whisper-cli`]
      : process.platform === 'win32'
        ? ['C:\\Program Files\\whisper.cpp\\whisper-cli.exe']
        : ['/usr/local/bin/whisper-cli', '/usr/bin/whisper-cli', `${process.env.HOME ?? ''}/.local/bin/whisper-cli`]
  for (const p of abs) {
    if (p && isExec(p)) return p
  }
  const names =
    process.platform === 'win32'
      ? ['whisper-cli.exe', 'whisper.exe', 'main.exe']
      : ['whisper-cli', 'whisper', 'main']
  const pathEnv = [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean).join(path.delimiter)
  for (const n of names) {
    try {
      const out = execSync(process.platform === 'win32' ? `where ${n}` : `command -v ${n}`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, PATH: pathEnv },
        timeout: 4000
      }).toString().trim().split('\n')[0]
      if (out && isExec(out)) return out
    } catch {
      /* not on PATH */
    }
  }
  // sommige builds: ffmpeg-static sibling
  const ff = ffmpegBin()
  if (ff) {
    const sib = path.join(path.dirname(ff), name)
    if (isExec(sib)) return sib
  }
  return null
}

function findBrew(): string | null {
  const cands = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew', `${process.env.HOME ?? ''}/.linuxbrew/bin/brew`]
  for (const c of cands) if (c && fs.existsSync(c)) return c
  try {
    const out = execSync('command -v brew', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString().trim()
    if (out && fs.existsSync(out)) return out
  } catch {
    /* no brew */
  }
  return null
}

const WHISPER_CLI_TAG = 'v1.9.2'

function whisperCliAsset(): { url: string; kind: 'zip' | 'tgz' } | null {
  const base = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_CLI_TAG}/`
  if (process.platform === 'win32') {
    const arch = process.arch
    if (arch === 'arm64') return { url: `${base}whisper-bin-win-cpu-arm64.zip`, kind: 'zip' }
    if (arch === 'ia32') return { url: `${base}whisper-bin-Win32.zip`, kind: 'zip' }
    return { url: `${base}whisper-bin-x64.zip`, kind: 'zip' }
  }
  if (process.platform === 'linux') {
    return process.arch === 'arm64'
      ? { url: `${base}whisper-bin-ubuntu-arm64.tar.gz`, kind: 'tgz' }
      : { url: `${base}whisper-bin-ubuntu-x64.tar.gz`, kind: 'tgz' }
  }
  // macOS: geen prebuilt CLI in releases → brew
  return null
}

async function downloadToFile(url: string, dest: string, onPercent?: (pct: number) => void): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000), redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      received += value.length
      if (total > 0 && onPercent) onPercent(Math.min(99, Math.round((received / total) * 100)))
    }
  }
  fs.writeFileSync(dest, Buffer.concat(chunks))
}

function runCmd(
  cmd: string,
  args: string[],
  opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv; onLine?: (line: string) => void }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const pathEnv = [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
      .filter(Boolean)
      .join(path.delimiter)
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: pathEnv, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ENV_HINTS: '1', ...opts?.env }
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }, opts?.timeoutMs ?? 300_000)
    const feed = (buf: string): void => {
      if (!opts?.onLine) return
      for (const line of buf.split(/\r?\n/)) {
        const t = line.trim()
        if (t) opts.onLine(t)
      }
    }
    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString()
      stdout += s
      feed(s)
    })
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      stderr += s
      feed(s)
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: stderr || e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function cellarWhisperBin(): string | null {
  try {
    const root = '/opt/homebrew/Cellar/whisper.cpp'
    if (!fs.existsSync(root)) return null
    for (const ver of fs.readdirSync(root)) {
      const p = path.join(root, ver, 'bin', binName())
      if (fs.existsSync(p)) return p
    }
  } catch {
    /* ignore */
  }
  return null
}

function cacheLocalBin(src: string): string | null {
  try {
    const dest = path.join(whisperBinDir(), binName())
    if (path.resolve(src) !== path.resolve(dest)) {
      fs.copyFileSync(src, dest)
      if (process.platform !== 'win32') fs.chmodSync(dest, 0o755)
    }
    // dylibs naast binary (mac Cellar) — alleen symlink/copy van libs is complex;
    // op mac blijft absolute Cellar-pad werken zolang brew er is.
    return fs.existsSync(dest) ? dest : src
  } catch {
    return src
  }
}

async function brewInstallWithLockRetry(
  brew: string,
  onLine?: (line: string) => void
): Promise<{ code: number; stdout: string; stderr: string }> {
  let last = await runCmd(brew, ['install', '--quiet', 'whisper.cpp'], {
    timeoutMs: 600_000,
    onLine
  })
  const combined = () => (last.stderr || '') + (last.stdout || '')
  if (last.code !== 0 && /already locked|Another Homebrew/i.test(combined())) {
    onLine?.('Andere brew-install bezig — wachten…')
    await new Promise((r) => setTimeout(r, 8000))
    last = await runCmd(brew, ['install', '--quiet', 'whisper.cpp'], {
      timeoutMs: 600_000,
      onLine
    })
  }
  return last
}

/** Installeer whisper-cli eenmalig: brew (mac) of prebuilt zip/tgz (win/linux). */
export async function installWhisperCli(
  onProgress?: (p: InstallProgress) => void
): Promise<InstallProgress> {
  const id = 'whisper-cli'
  const done = (phase: InstallProgress['phase'], message?: string, percent = 100): InstallProgress => {
    const p: InstallProgress = { id, phase, percent, message }
    onProgress?.(p)
    return p
  }
  if (findWhisperBin()) return done('complete', `Al beschikbaar: ${findWhisperBin()}`)

  // Cellar al volledig geïnstalleerd maar niet op PATH → cache local
  const cellar = cellarWhisperBin()
  if (cellar) {
    const cached = cacheLocalBin(cellar)
    if (cached && findWhisperBin()) return done('complete', `Gevonden in Homebrew: ${cached}`)
  }

  onProgress?.({ id, phase: 'downloading', percent: 2, message: 'whisper-cli zoeken…' })

  if (process.platform === 'darwin') {
    const brew = findBrew()
    if (!brew) {
      return done(
        'error',
        'Homebrew niet gevonden. Installeer Homebrew (https://brew.sh) en draai daarna: brew install whisper.cpp'
      )
    }
    let pct = 10
    onProgress?.({ id, phase: 'downloading', percent: pct, message: 'brew install whisper.cpp…' })
    const r = await brewInstallWithLockRetry(brew, (line) => {
      pct = Math.min(90, pct + 1)
      onProgress?.({
        id,
        phase: 'downloading',
        percent: pct,
        message: line.slice(0, 160)
      })
    })
    // Cellar-bin als fallback cache
    const c2 = cellarWhisperBin()
    if (c2) cacheLocalBin(c2)
    const bin = findWhisperBin()
    if (bin) return done('complete', `Geïnstalleerd via Homebrew: ${bin}`)
    return done(
      'error',
      `brew install faalde (code ${r.code}): ${(r.stderr || r.stdout).slice(-500) || 'whisper-cli nog niet gevonden'}`
    )
  }

  const asset = whisperCliAsset()
  if (!asset) return done('error', 'Geen downloadbron voor dit platform')

  const outDir = whisperBinDir()
  const tmp = path.join(app.getPath('temp'), `whisper-cli-${Date.now()}${asset.kind === 'zip' ? '.zip' : '.tar.gz'}`)
  try {
    onProgress?.({ id, phase: 'downloading', percent: 5, message: 'whisper-cli downloaden…' })
    await downloadToFile(asset.url, tmp, (pct) => {
      onProgress?.({ id, phase: 'downloading', percent: pct, message: `whisper-cli downloaden… ${pct}%` })
    })
    onProgress?.({ id, phase: 'downloading', percent: 95, message: 'Uitpakken…' })

    if (asset.kind === 'zip') {
      const r = await runCmd(
        'powershell.exe',
        ['-NoProfile', '-Command', `Expand-Archive -Force -Path "${tmp}" -DestinationPath "${outDir}"`],
        { timeoutMs: 60_000 }
      )
      if (r.code !== 0) throw new Error(`Unzip faalde: ${r.stderr.slice(0, 300)}`)
      const rel = path.join(outDir, 'Release')
      if (fs.existsSync(rel)) {
        for (const f of fs.readdirSync(rel)) {
          fs.renameSync(path.join(rel, f), path.join(outDir, f))
        }
        fs.rmSync(rel, { recursive: true, force: true })
      }
    } else {
      const r = await runCmd('tar', ['-xzf', tmp, '-C', outDir], { timeoutMs: 60_000 })
      if (r.code !== 0) throw new Error(`tar faalde: ${r.stderr.slice(0, 300)}`)
      for (const ent of fs.readdirSync(outDir)) {
        const full = path.join(outDir, ent)
        if (ent.startsWith('whisper-bin-') && fs.statSync(full).isDirectory()) {
          for (const f of fs.readdirSync(full)) {
            const src = path.join(full, f)
            const dst = path.join(outDir, f)
            if (!fs.existsSync(dst)) fs.renameSync(src, dst)
          }
          fs.rmSync(full, { recursive: true, force: true })
        }
      }
    }

    const bin = path.join(outDir, binName())
    if (process.platform !== 'win32' && fs.existsSync(bin)) {
      try {
        fs.chmodSync(bin, 0o755)
      } catch {
        /* ignore */
      }
    }
    if (findWhisperBin()) return done('complete', `Geïnstalleerd: ${findWhisperBin()}`)
    return done('error', 'Geüpload maar binary nog niet gevonden — probeer opnieuw')
  } catch (e) {
    return done('error', (e as Error).message)
  } finally {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* ignore */
    }
  }
}

function modelPathFor(id: string): string | null {
  const item = WHISPER_CATALOG.find((m) => m.id === id) ?? WHISPER_CATALOG[1]
  const p = path.join(modelsDir(), item.file)
  if (fs.existsSync(p) && fs.statSync(p).size > 1_000_000) return p
  const bundled = bundledPath('whisper-models', item.file)
  if (bundled && fs.existsSync(bundled)) return bundled
  return null
}

export async function whisperStatus(): Promise<TranscribeStatus> {
  const bin = findWhisperBin()
  const models = WHISPER_CATALOG.map((m) => {
    const p = path.join(modelsDir(), m.file)
    const exists = fs.existsSync(p)
    return {
      id: m.id,
      name: m.name,
      path: p,
      size: exists ? fs.statSync(p).size : 0
    }
  })
  const oll = await pingOllama()
  return {
    available: !!bin,
    binaryPath: bin ?? undefined,
    models,
    ollamaAvailable: oll.available,
    error: bin ? undefined : 'whisper-cli niet gevonden. Installeer whisper.cpp of gebruik de Full-build.'
  }
}

export async function installWhisperModel(
  id: string,
  onProgress?: (p: InstallProgress) => void
): Promise<InstallProgress> {
  const item = WHISPER_CATALOG.find((m) => m.id === id)
  if (!item) return { id, phase: 'error', message: 'Onbekend model' }
  const out = path.join(modelsDir(), item.file)
  if (fs.existsSync(out) && fs.statSync(out).size > 1_000_000) {
    onProgress?.({ id, phase: 'complete', percent: 100 })
    return { id, phase: 'complete', percent: 100 }
  }
  onProgress?.({ id, phase: 'downloading', percent: 0, message: 'Downloaden…' })
  try {
    const res = await fetch(item.url, { signal: AbortSignal.timeout(120_000) })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length')) || item.sizeMb * 1024 * 1024
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        received += value.length
        const percent = Math.min(99, Math.round((received / total) * 100))
        onProgress?.({
          id,
          phase: 'downloading',
          percent,
          downloadedMb: Math.round(received / (1024 * 1024)),
          totalMb: Math.round(total / (1024 * 1024))
        })
      }
    }
    fs.writeFileSync(out, Buffer.concat(chunks))
    onProgress?.({ id, phase: 'complete', percent: 100 })
    return { id, phase: 'complete', percent: 100 }
  } catch (e) {
    const msg = (e as Error).message
    onProgress?.({ id, phase: 'error', message: msg })
    return { id, phase: 'error', message: msg }
  }
}

let cancelled = false
export function cancelTranscribe(): void {
  cancelled = true
}

function runWhisper(
  bin: string,
  args: string[],
  onProgress?: (p: TranscribeProgress) => void
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
      const m = stdout.match(/progress\s*=\s*(\d+)%/i)
      if (m && onProgress) {
        onProgress({
          phase: 'transcribing',
          percent: Math.min(95, 20 + Math.round(Number(m[1]) * 0.7)),
          message: `Transcribing… ${m[1]}%`
        })
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      const m = stderr.match(/progress\s*=\s*(\d+)%/i)
      if (m && onProgress) {
        onProgress({
          phase: 'transcribing',
          percent: Math.min(95, 20 + Math.round(Number(m[1]) * 0.7)),
          message: `Transcribing… ${m[1]}%`
        })
      }
    })
    child.on('error', () => resolve({ code: 1, stdout, stderr: stderr || 'spawn failed' }))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

function parseWhisperJson(raw: string): { language?: string; segments: SubtitleSegment[] } {
  const text = raw.trim()
  // sommige builds printen prefix-regels voor de JSON
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return { segments: [] }
  const data = JSON.parse(text.slice(start, end + 1)) as {
    language?: string
    transcription?: Array<{ offsets?: { from?: number; to?: number }; text?: string; timestamps?: { from?: string; to?: string } }>
    segments?: Array<{ start?: number; end?: number; text?: string; offsets?: { from?: number; to?: number } }>
  }
  const segs: SubtitleSegment[] = []
  type AnySeg =
    | { start?: number; end?: number; text?: string; offsets?: { from?: number; to?: number } }
    | { offsets?: { from?: number; to?: number }; text?: string; timestamps?: { from?: string; to?: string } }
  const list: AnySeg[] = (data.segments ?? data.transcription ?? []) as AnySeg[]
  for (const s of list) {
    const startMs = s.offsets?.from ?? ('start' in s && s.start != null ? Math.round(s.start * 1000) : undefined)
    const endMs = s.offsets?.to ?? ('end' in s && s.end != null ? Math.round(s.end * 1000) : undefined)
    const t = (s.text ?? '').trim()
    if (startMs == null || endMs == null || !t) continue
    segs.push({ start: startMs / 1000, end: endMs / 1000, text: t })
  }
  return { language: data.language, segments: segs }
}

function parseTimestamp(s: string): number {
  // "00:00:01,500" or "00:01.500"
  const m = s.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)/)
  if (m) {
    const h = Number(m[1] ?? 0)
    const min = Number(m[2])
    const sec = Number(m[3])
    const ms = Number(String(m[4]).padEnd(3, '0').slice(0, 3))
    return h * 3600 + min * 60 + sec + ms / 1000
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

function parseSrt(srt: string): SubtitleSegment[] {
  const blocks = srt.replace(/\r/g, '').split(/\n\n+/)
  const out: SubtitleSegment[] = []
  for (const b of blocks) {
    const lines = b.split('\n').filter(Boolean)
    const tLine = lines.find((l) => l.includes('-->'))
    if (!tLine) continue
    const [a, z] = tLine.split('-->')
    if (!a || !z) continue
    const text = lines.slice(lines.indexOf(tLine) + 1).join(' ').trim()
    if (!text) continue
    out.push({ start: parseTimestamp(a), end: parseTimestamp(z), text })
  }
  return out
}

async function transcribeWav(
  wavPath: string,
  modelId: string,
  sourceLanguage: string,
  onProgress?: (p: TranscribeProgress) => void
): Promise<{ language?: string; segments: SubtitleSegment[] }> {
  const bin = findWhisperBin()
  if (!bin) throw new Error('whisper-cli niet gevonden')

  let model = modelPathFor(modelId)
  if (!model) {
    onProgress?.({ phase: 'downloading-model', percent: 0, message: 'Whisper-model downloaden…' })
    const inst = await installWhisperModel(modelId, (ip) => {
      if (ip.phase === 'downloading') {
        onProgress?.({
          phase: 'downloading-model',
          percent: ip.percent ?? 0,
          message: `Model downloaden… ${ip.percent ?? 0}%`
        })
      }
    })
    if (inst.phase !== 'complete') throw new Error(inst.message || 'Model downloaden mislukt')
    model = modelPathFor(modelId)
    if (!model) throw new Error('Model niet gevonden na download')
  }

  const jsonOut = path.join(tempDir(), `whisper-${Date.now()}.json`)
  const srtOut = path.join(tempDir(), `whisper-${Date.now()}.srt`)
  try {
    fs.rmSync(jsonOut, { force: true })
    fs.rmSync(srtOut, { force: true })
  } catch {
    /* ignore */
  }

  const args = ['-m', model, '-f', wavPath, '-oj', '-of', jsonOut.replace(/\.json$/, '')]
  if (sourceLanguage && sourceLanguage !== 'auto') args.push('-l', sourceLanguage)
  else args.push('-l', 'auto')
  // betere kwaliteit: beam search; -np = geen ruis in output (NIET -nt = no-timestamps!)
  args.push('-bs', '5', '-bo', '5', '-np', '-pp')
  args.push('-osrt')

  onProgress?.({ phase: 'transcribing', percent: 15, message: 'Whisper starten…' })
  const r = await runWhisper(bin, args, onProgress)
  if (cancelled) return { segments: [] }

  let parsed: { language?: string; segments: SubtitleSegment[] } = { segments: [] }
  const jpath = fs.existsSync(jsonOut) ? jsonOut : jsonOut.replace(/\.json$/, '') + '.json'
  // -of strips extension behavior varies
  const candidates = [
    jsonOut,
    jsonOut.replace(/\.json$/, ''),
    path.join(tempDir(), path.basename(wavPath).replace(/\.[^.]+$/, '') + '.json'),
    jsonOut.replace(/\.json$/, '') + '.json'
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        parsed = parseWhisperJson(fs.readFileSync(c, 'utf8'))
        if (parsed.segments.length) break
      } catch {
        /* try next */
      }
    }
  }
  if (!parsed.segments.length) {
    const scands = [srtOut, srtOut.replace(/\.srt$/, ''), srtOut.replace(/\.srt$/, '') + '.srt']
    for (const c of scands) {
      if (fs.existsSync(c)) {
        const segs = parseSrt(fs.readFileSync(c, 'utf8'))
        if (segs.length) {
          parsed = { segments: segs, language: undefined }
          break
        }
      }
    }
  }
  if (!parsed.segments.length && r.code !== 0) {
    throw new Error(r.stderr.slice(0, 400) || `whisper exit ${r.code}`)
  }
  return parsed
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function translateSegments(
  segments: SubtitleSegment[],
  targetLang: string,
  model: string,
  onProgress?: (p: TranscribeProgress) => void
): Promise<SubtitleSegment[] | null> {
  const label = SUBTITLE_LANGUAGES.find((l) => l.id === targetLang)?.label ?? targetLang
  const batches = chunk(segments, 20)
  const out: SubtitleSegment[] = []
  for (let i = 0; i < batches.length; i++) {
    if (cancelled) return null
    const batch = batches[i]
    const numbered = batch.map((s, j) => `${j + 1}. ${s.text}`).join('\n')
    const prompt =
      `You are a subtitle translator. Translate each numbered line to ${label}.\n` +
      `Keep the same numbering. Output ONLY the translated lines, one per line, no explanations.\n` +
      `Preserve names and punctuation.\n\n${numbered}`
    const r = await generateText(model, prompt)
    if (!r.ok || !r.text) return null
    const lines = r.text
      .split('\n')
      .map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter(Boolean)
    batch.forEach((s, j) => {
      out.push({ ...s, text: lines[j] ?? s.text })
    })
    onProgress?.({
      phase: 'translating',
      percent: 30 + Math.round(((i + 1) / batches.length) * 65),
      message: `Vertalen naar ${label}… (${i + 1}/${batches.length})`
    })
  }
  return out
}

/**
 * Volledige pipeline: extract → whisper → (optioneel) Ollama-vertaling.
 * Resultaat: één track-set per doeltaal.
 */
export async function generateSubtitles(
  req: TranscribeRequest,
  onProgress?: (p: TranscribeProgress) => void
): Promise<TranscribeResult> {
  cancelled = false
  const warnings: string[] = []
  const send = (p: TranscribeProgress): void => {
    if (!cancelled || p.phase === 'cancelled' || p.phase === 'error') onProgress?.(p)
  }
  try {
    if (!req.path) return { ok: false, error: 'Geen bestand', tracks: [] }
    if (!req.targetLanguages?.length) return { ok: false, error: 'Kies minstens één doeltaal', tracks: [] }

    if (!findWhisperBin()) {
      send({ phase: 'downloading-model', percent: 1, message: 'whisper-cli installeren…' })
      const inst = await installWhisperCli((ip) => {
        send({
          phase: 'downloading-model',
          percent: Math.min(40, ip.percent ?? 5),
          message: ip.message || 'whisper-cli installeren…'
        })
      })
      if (inst.phase !== 'complete' || !findWhisperBin()) {
        const msg = inst.message || 'whisper-cli niet gevonden'
        send({ phase: 'error', error: msg })
        return { ok: false, error: msg, tracks: [] }
      }
      send({ phase: 'extracting', percent: 2, message: 'whisper-cli klaar — audio extracteren…' })
    }

    send({ phase: 'extracting', percent: 4, message: 'Audio extracteren…' })
    const wav = path.join(tempDir(), `in-${Date.now()}.wav`)
    await extractAudioToFile(req.path, wav, { start: req.start, duration: req.duration })
    if (cancelled) {
      send({ phase: 'cancelled', message: 'Geannuleerd' })
      return { ok: false, cancelled: true, tracks: [] }
    }

    const modelId = req.modelId || 'small'
    send({ phase: 'transcribing', percent: 10, message: 'Speech-to-text…' })
    const tr = await transcribeWav(wav, modelId, req.sourceLanguage, send)
    if (cancelled) {
      send({ phase: 'cancelled', message: 'Geannuleerd' })
      return { ok: false, cancelled: true, tracks: [] }
    }
    if (!tr.segments.length) {
      send({ phase: 'error', error: 'Geen spraak gevonden (of whisper faalde)' })
      return { ok: false, error: 'Geen spraak gevonden', tracks: [] }
    }

    const detected = tr.language || (req.sourceLanguage !== 'auto' ? req.sourceLanguage : 'en')
    const targets = [...new Set(req.targetLanguages.filter(Boolean))]
    const tracks: SubtitleTrackResult[] = []
    const needTranslate = targets.filter((t) => t !== detected && t !== req.sourceLanguage)

    if (needTranslate.length) {
      const oll = await pingOllama()
      if (!oll.available) {
        warnings.push('Ollama offline — alleen bron-taal ondertitels (start Ollama voor vertaling).')
        const lang = detected
        tracks.push({
          language: lang,
          languageLabel: SUBTITLE_LANGUAGES.find((l) => l.id === lang)?.label ?? lang,
          segments: tr.segments,
          translated: false
        })
      } else {
        let model = req.translateModel
        if (!model) {
          const models = await listModels()
          model = models.find((m) => !m.capabilities?.includes('embedding'))?.name || models[0]?.name
        }
        if (!model) {
          warnings.push('Geen Ollama-model — alleen bron-taal ondertitels.')
          tracks.push({
            language: detected,
            languageLabel: SUBTITLE_LANGUAGES.find((l) => l.id === detected)?.label ?? detected,
            segments: tr.segments,
            translated: false
          })
        } else {
          // altijd ook de bron-taal meeleveren als die in targets staat
          for (const t of targets) {
            if (cancelled) break
            if (t === detected || t === req.sourceLanguage) {
              tracks.push({
                language: t,
                languageLabel: SUBTITLE_LANGUAGES.find((l) => l.id === t)?.label ?? t,
                segments: tr.segments,
                translated: false
              })
              continue
            }
            send({
              phase: 'translating',
              percent: 30,
              message: `Vertalen naar ${SUBTITLE_LANGUAGES.find((l) => l.id === t)?.label ?? t}…`
            })
            const translated = await translateSegments(tr.segments, t, model, send)
            if (translated && translated.length) {
              tracks.push({
                language: t,
                languageLabel: SUBTITLE_LANGUAGES.find((l) => l.id === t)?.label ?? t,
                segments: translated,
                translated: true
              })
            } else {
              warnings.push(`Vertaling naar ${t} mislukt (Ollama).`)
            }
          }
        }
      }
    } else {
      for (const t of targets) {
        tracks.push({
          language: t === 'auto' ? detected : t,
          languageLabel: SUBTITLE_LANGUAGES.find((l) => l.id === (t === 'auto' ? detected : t))?.label ?? t,
          segments: tr.segments,
          translated: false
        })
      }
    }

    try {
      fs.rmSync(wav, { force: true })
    } catch {
      /* ignore */
    }

    if (cancelled) {
      send({ phase: 'cancelled', message: 'Geannuleerd' })
      return { ok: false, cancelled: true, tracks: [] }
    }

    send({
      phase: 'done',
      percent: 100,
      message: `${tracks.length} ondertitel-track(s) · ${tr.segments.length} segmenten`,
      language: detected,
      languages: tracks.map((t) => t.language),
      trackCount: tracks.length
    })
    return { ok: true, detectedLanguage: detected, tracks, warnings }
  } catch (e) {
    const msg = (e as Error).message
    if (cancelled) {
      send({ phase: 'cancelled', message: 'Geannuleerd' })
      return { ok: false, cancelled: true, tracks: [] }
    }
    send({ phase: 'error', error: msg })
    return { ok: false, error: msg, tracks: [] }
  }
}

/** Utility voor tests/debug: ffmpeg aanwezig? */
export function ffmpegReady(): boolean {
  return !!ffmpegBin()
}
