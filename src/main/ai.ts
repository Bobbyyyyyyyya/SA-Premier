import ffmpegPath from 'ffmpeg-static'
import type { OllamaModelInfo, AiGenerateResult } from '../shared/types'

const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434'

function ollamaUrl(path: string): string {
  return OLLAMA.replace(/\/$/, '') + path
}

export async function pingOllama(): Promise<{ available: boolean; version?: string }> {
  try {
    const res = await fetch(ollamaUrl('/api/version'))
    if (!res.ok) return { available: false }
    const data = (await res.json()) as { version?: string }
    return { available: true, version: data.version }
  } catch {
    return { available: false }
  }
}

export async function listModels(): Promise<OllamaModelInfo[]> {
  try {
    const res = await fetch(ollamaUrl('/api/tags'))
    if (!res.ok) return []
    const data = (await res.json()) as {
      models?: Array<{
        name: string
        size: number
        details?: { parameter_size?: string; quantization_level?: string; family?: string }
        capabilities?: string[]
      }>
    }
    return (data.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      parameterSize: m.details?.parameter_size ?? '',
      quantization: m.details?.quantization_level ?? '',
      capabilities: m.capabilities ?? [],
      family: m.details?.family ?? ''
    }))
  } catch {
    return []
  }
}

export async function generateText(model: string, prompt: string): Promise<AiGenerateResult> {
  try {
    const res = await fetch(ollamaUrl('/api/generate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false })
    })
    if (!res.ok) return { ok: false, error: `Ollama error ${res.status}: ${await res.text()}` }
    const data = (await res.json()) as { response?: string; error?: string }
    if (data.error) return { ok: false, error: data.error }
    return { ok: true, text: (data.response ?? '').trim() }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function synthWave(
  freq: number,
  dur: number,
  sampleRate: number,
  amp: number,
  attack: number,
  decay: number
): Float32Array {
  const n = Math.round(dur * sampleRate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const tt = i / sampleRate
    const env = tt < attack ? tt / attack : Math.pow(Math.max(0, 1 - (tt - attack) / (dur - attack)), decay)
    out[i] = Math.sin(2 * Math.PI * freq * tt) * amp * env
  }
  return out
}

function writeWav(data: Float32Array, sampleRate: number): Buffer {
  const numCh = 1
  const bytes = data.length * 2
  const buf = Buffer.alloc(44 + bytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + bytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(numCh, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * numCh * 2, 28)
  buf.writeUInt16LE(numCh * 2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(bytes, 40)
  for (let i = 0; i < data.length; i++) {
    buf.writeInt16LE(Math.max(-1, Math.min(1, data[i])) * 32767, 44 + i * 2)
  }
  return buf
}

function hashPrompt(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function mulberry32(a: number): () => number {
  return function() {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function generateBeat(seconds: number, bpm: number, prompt = ''): { wav: Buffer; name: string } {
  const sampleRate = 44100
  const total = Math.min(120, Math.max(1, seconds))
  const bpmClamped = Math.min(300, Math.max(20, bpm))
  const beatDur = 60 / bpmClamped
  const eighth = beatDur / 2
  const n = Math.round(total * sampleRate)
  const master = new Float32Array(n)
  const p = (prompt || '').toLowerCase()
  const seed = (hashPrompt(p) ^ Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0
  const rnd = mulberry32(seed)
  let bassFreqs = [55, 110, 82.4, 98, 65.4, 87.3, 73.4, 110]
  let kickGain = 1
  let snareGain = 0.7
  let bassGain = 0.5
  let hatGain = 0.35
  if (p.includes('trap') || p.includes('808')) {
    bassFreqs = [36, 42, 55, 48, 38, 45, 52, 58]
    hatGain = 0.55
    bassGain = 0.65
  } else if (p.includes('lofi') || p.includes('chill') || p.includes('mellow')) {
    bassFreqs = [65.4, 73.4, 82.4, 87.3, 98, 110, 123, 130]
    hatGain = 0.18
    snareGain = 0.45
    bassGain = 0.38
  } else if (p.includes('techno') || p.includes('house') || p.includes('edm')) {
    bassFreqs = [49, 49, 55, 55, 49, 49, 65, 55]
    kickGain = 1.15
    hatGain = 0.4
  } else if (p.includes('dark') || p.includes('minor') || p.includes('hard')) {
    bassFreqs = [41, 48, 53, 61, 43, 51, 58, 64]
    bassGain = 0.6
    kickGain = 1.1
  } else if (p.includes('happy') || p.includes('pop') || p.includes('bright') || p.includes('funk')) {
    bassFreqs = [65.4, 78, 98, 110, 82.4, 98, 123, 146]
    hatGain = 0.3
    bassGain = 0.45
  } else if (p.includes('jazz') || p.includes('soul')) {
    bassFreqs = [55, 62, 69, 77, 83, 92, 104, 116]
    hatGain = 0.25
    snareGain = 0.5
  } else if (p.includes('drum') || p.includes('percuss')) {
    hatGain = 0.5
    snareGain = 0.85
  }
  let bassIdx = 0

  const mix = (startSec: number, chunk: Float32Array, gain: number): void => {
    let s = Math.round(startSec * sampleRate)
    for (let i = 0; i < chunk.length; i++) {
      const idx = s + i
      if (idx >= master.length) break
      master[idx] += chunk[i] * gain
    }
  }

  for (let t = 0; t < total; t += eighth) {
    const bar = Math.floor(t / (4 * beatDur))
    const stepInBar = Math.floor((t % (4 * beatDur)) / eighth)
    // pick bass note with some variation
    const baseIdx = bar % bassFreqs.length
    const varPick = rnd() > 0.7 ? (baseIdx + Math.floor(rnd() * 3)) % bassFreqs.length : baseIdx
    bassIdx = varPick
    const isFillBar = bar % 4 === 3 && rnd() > 0.5
    // kick — sometimes extra ghost kick
    const kickSteps = p.includes('techno') || p.includes('house') ? [0, 2, 4, 6] : p.includes('trap') ? [0, 3, 6] : [0, 4]
    const hasKick = kickSteps.includes(stepInBar) || (isFillBar && stepInBar === 7 && rnd() > 0.5) || (rnd() > 0.88 && stepInBar % 2 === 1)
    if (hasKick) {
      const kf = 110 + rnd() * 20
      const kick = synthWave(kf, 0.18, sampleRate, 0.9, 0.002, 6)
      mix(t, kick, kickGain * (0.9 + rnd() * 0.2))
      if (rnd() > 0.3) {
        const sub = synthWave(50 + rnd() * 12, 0.22, sampleRate, 0.5, 0.002, 8)
        mix(t, sub, kickGain * 0.85)
      }
    }
    // snare / clap on beats 2 and 4, with variation
    const isSnareStep = stepInBar === 2 || stepInBar === 6
    const ghostSnare = !isSnareStep && rnd() > 0.92 && p.includes('trap')
    if (isSnareStep || ghostSnare) {
      const noiseDur = 0.12 + rnd() * 0.05
      const noise = new Float32Array(Math.round(noiseDur * sampleRate))
      for (let i = 0; i < noise.length; i++) {
        const env = Math.exp(-i / (sampleRate * (0.025 + rnd() * 0.015)))
        noise[i] = (rnd() * 2 - 1) * env * 0.5
      }
      mix(t, noise, snareGain * (ghostSnare ? 0.5 : 1))
    }
    // bass — skip sometimes for groove
    if (rnd() > 0.08) {
      const bf = bassFreqs[bassIdx] * (0.98 + rnd() * 0.04)
      const bass = synthWave(bf, eighth * (0.85 + rnd() * 0.15), sampleRate, 0.5, 0.01, 2)
      mix(t, bass, bassGain * (0.85 + rnd() * 0.3))
    }
    // hi-hat
    const hatProb = p.includes('trap') ? 0.85 : p.includes('lofi') ? 0.5 : 0.9
    if (stepInBar % 2 === 1 && rnd() < hatProb) {
      const hat = new Float32Array(Math.round((0.04 + rnd() * 0.02) * sampleRate))
      for (let i = 0; i < hat.length; i++) {
        const env = Math.exp(-i / (sampleRate * 0.008))
        hat[i] = (rnd() * 2 - 1) * env * 0.25
      }
      mix(t, hat, hatGain * (0.8 + rnd() * 0.4))
    }
    if ((p.includes('trap') || p.includes('roll')) && stepInBar % 2 === 1 && rnd() > 0.55) {
      const roll = new Float32Array(Math.round(0.03 * sampleRate))
      for (let i = 0; i < roll.length; i++) {
        const env = Math.exp(-i / (sampleRate * 0.012))
        roll[i] = (rnd() * 2 - 1) * env * 0.18
      }
      mix(t + eighth * 0.5, roll, hatGain * 0.7)
    }
  }
  function isFullTrack(prompt: string): boolean {
    return prompt.includes('full') || prompt.includes('song') || prompt.includes('track') || prompt.includes('melody') || prompt.includes('chord') || prompt.includes('cinematic') || prompt.includes('epic') || prompt.includes('trap-808') || prompt.includes('techno-house')
  }
  const wantFull = isFullTrack(p)
  if (wantFull) {
    const baseRoots = p.includes('dark') ? [55, 62, 65, 58] : p.includes('happy') ? [65, 78, 82, 73] : [65.4, 73.4, 82.4, 98]
    // shuffle roots slightly per generation for variation
    const chordRoots = [...baseRoots]
    if (rnd() > 0.5) chordRoots.reverse()
    if (rnd() > 0.6) { const a = chordRoots.pop()!; chordRoots.unshift(a) }
    const chordDur = 4 * beatDur
    for (let t = 0; t < total; t += chordDur) {
      const idx = Math.floor(t / chordDur) % chordRoots.length
      const root = chordRoots[idx] * (0.99 + rnd() * 0.02)
      const isMinor = p.includes('minor') || p.includes('dark') || rnd() > 0.6
      const third = root * (isMinor ? 1.189 : 1.26)
      const fifth = root * (1.498 + rnd() * 0.01)
      const chordGain = 0.18 + rnd() * 0.08
      for (const f of [root, third, fifth]) {
        const pad = synthWave(f * (0.995 + rnd() * 0.01), chordDur * (0.85 + rnd() * 0.1), sampleRate, 0.18, 0.08, 1.2)
        mix(t, pad, chordGain)
      }
      // arpeggio with variation
      const arpOrder = rnd() > 0.5 ? [0, 1, 2, 3] : [2, 0, 1, 3]
      for (let a = 0; a < 4; a++) {
        const af = [root, third, fifth, root * 2][arpOrder[a] % 4]
        const arp = synthWave(af, eighth * (0.7 + rnd() * 0.2), sampleRate, 0.12, 0.005, 1.8)
        mix(t + a * eighth + (rnd() > 0.7 ? eighth * 0.25 : 0), arp, 0.14 + rnd() * 0.05)
      }
    }
  }

  // normalize
  let peak = 0
  for (let i = 0; i < master.length; i++) {
    const a = Math.abs(master[i])
    if (a > peak) peak = a
  }
  const norm = peak > 0 ? 0.9 / peak : 1
  for (let i = 0; i < master.length; i++) master[i] *= norm

  const wav = writeWav(master, sampleRate)
  const slug = p ? '-' + p.slice(0, 20).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : ''
  const varTag = '-' + seed.toString(36).slice(-4)
  const name = `beat-${bpmClamped}bpm-${total}s${slug}${varTag}.wav`
  return { wav, name }
}

export function ffmpegAvailable(): boolean {
  return !!ffmpegPath
}
