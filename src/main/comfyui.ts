import { spawn, ChildProcess, execSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AiImageProgress,
  CatalogModel,
  ComfyImageResult,
  ComfyStatus,
  InstallProgress,
  InstalledModel
} from '../shared/types'

const PORT = 8188
const BASE = `http://127.0.0.1:${PORT}`
const comfyDir = path.join(os.homedir(), 'ComfyUI')

let server: ChildProcess | null = null
let installs = new Map<string, InstallProgress>()

function pythonBin(): string {
  const candidates = [
    path.join(comfyDir, 'venv', 'bin', 'python'),
    path.join(comfyDir, 'venv', 'Scripts', 'python.exe')
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return 'python'
}

function killZombieOnPort(port: number): void {
  try {
    execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' })
  } catch {}
}

async function comfyFetch(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(BASE + pathname, init)
}

function installedDir(): string {
  return path.join(comfyDir, 'models', 'checkpoints')
}

export async function comfyStatus(): Promise<ComfyStatus> {
  try {
    const res = await comfyFetch('/system_stats', { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return { available: false }
    const data = (await res.json()) as { devices?: Array<{ name: string; type: string; vram_total: number }> }
    const d = data.devices?.[0]
    return {
      available: true,
      device: d?.name,
      deviceType: d?.type,
      vramTotal: d?.vram_total,
      installing: activeInstall()
    }
  } catch {
    return { available: false, installing: activeInstall() }
  }
}

function activeInstall(): string | undefined {
  const any = [...installs.values()].find((i) => i.phase === 'downloading')
  return any?.id
}

export function comfyDirExists(): boolean {
  return fs.existsSync(comfyDir)
}

export function ensureComfyUI(): void {
  void (async () => {
    const st = await comfyStatus()
    if (st.available) return

    killZombieOnPort(PORT)
    await new Promise((r) => setTimeout(r, 500))

    if (!fs.existsSync(comfyDir)) {
      console.log('[comfy] ComfyUI not installed at', comfyDir)
      return
    }
    const bin = pythonBin()
    console.log('[comfy] starting server:', bin)
    server = spawn(bin, ['main.py', '--port', String(PORT), '--preview-method', 'none'], {
      cwd: comfyDir,
      stdio: 'ignore',
      detached: true,
      env: { ...process.env, TQDM_DISABLE: '1', PYTHONUNBUFFERED: '1' }
    })
    server.unref()
    server.on('exit', (code) => {
      console.log('[comfy] server exited with code', code)
      server = null
    })
    server.on('error', (e) => {
      console.error('[comfy] failed to start:', e.message)
      server = null
    })
  })()
}

export function stopComfyUI(): void {
  if (server) {
    server.kill()
    server = null
  }
}

export async function listCheckpoints(): Promise<InstalledModel[]> {
  try {
    const res = await comfyFetch('/object_info/CheckpointLoaderSimple', {
      signal: AbortSignal.timeout(6000)
    })
    if (!res.ok) return []
    const data = (await res.json()) as {
      CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: [string[]] } } }
    }
    const names: string[] = data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? []
    const dir = installedDir()
    return names.map((name) => {
      let size = 0
      try {
        size = fs.statSync(path.join(dir, name)).size
      } catch {
        size = 0
      }
      return { name, size, path: path.join(dir, name) }
    })
  } catch {
    return []
  }
}

/**
 * Build and run a minimal SD1.5 txt2img workflow against ComfyUI.
 * Connects to ComfyUI's websocket for real-time step progress and live preview.
 * Returns the generated image as a base64 data URL.
 */
export async function txt2img(
  checkpoint: string,
  prompt: string,
  width: number,
  height: number,
  steps = 24,
  cfg = 7,
  seed = -1,
  negative = 'lowres, bad anatomy, worst quality, low quality, blurry, watermark',
  onProgress?: (p: AiImageProgress) => void
): Promise<ComfyImageResult> {
  const w = Math.round(Math.max(64, width))
  const h = Math.round(Math.max(64, height))
  const useSeed = seed < 0 ? Math.floor(Math.random() * 4294967296) : Math.floor(seed)
  const workflow = {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint }
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: ['1', 1] }
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negative, clip: ['1', 1] }
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width: w, height: h, batch_size: 1 }
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed: useSeed,
        steps,
        cfg,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0]
      }
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] }
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { images: ['6', 0], filename_prefix: 'sa-premier' }
    }
  }

  const clientId = crypto.randomUUID()
  let ws: InstanceType<typeof WebSocket> | null = null
  let resolved = false

  const sendProgress = (p: AiImageProgress): void => {
    if (!resolved) onProgress?.(p)
  }

  // Connect websocket for real-time progress
  const connectWs = (): Promise<void> => {
    return new Promise((resolve) => {
      try {
        const wsUrl = `ws://127.0.0.1:${PORT}/ws?clientId=${clientId}`
        ws = new WebSocket(wsUrl)
        ws.onopen = () => resolve()
        ws.onerror = () => resolve() // still proceed even if ws fails
        ws.onmessage = (ev: { data: unknown }) => {
          try {
            const msg = JSON.parse(String(ev.data)) as {
              type: string
              data?: { value?: number; max?: number; prompt_id?: string; node?: string; images?: Array<{ filename: string; subfolder: string; type: string; image?: string }> }
            }
            if (msg.data?.prompt_id !== currentPromptId) return

            if (msg.type === 'progress' && msg.data) {
              const step = msg.data.value ?? 0
              const total = msg.data.max ?? steps
              sendProgress({
                phase: 'generating',
                step,
                totalSteps: total,
                percent: Math.round((step / total) * 90) // reserve 10% for decoding
              })
            } else if (msg.type === 'executing' && msg.data) {
              const node = msg.data.node
              if (node === '1') {
                sendProgress({ phase: 'loading-model', percent: 5 })
              } else if (node === '5') {
                sendProgress({ phase: 'generating', step: 0, totalSteps: steps, percent: 10 })
              } else if (node === '6') {
                sendProgress({ phase: 'decoding', percent: 92 })
              } else if (node === null) {
                // execution complete
                sendProgress({ phase: 'decoding', percent: 95 })
              }
            } else if (msg.type === 'preview_image' && msg.data?.images) {
              // Live preview from ComfyUI — base64 encoded preview image
              for (const img of msg.data.images) {
                if (img.image) {
                  sendProgress({
                    phase: 'generating',
                    step: lastStep,
                    totalSteps: steps,
                    percent: Math.round((lastStep / steps) * 90),
                    previewDataUrl: `data:image/png;base64,${img.image}`
                  })
                  break
                }
              }
            }
          } catch {
            // ignore parse errors
          }
        }
        ws.onclose = () => { ws = null }
      } catch {
        resolve()
      }
    })
  }

  let currentPromptId: string | null = null
  let lastStep = 0

  try {
    sendProgress({ phase: 'starting', percent: 0 })

    // Connect websocket first so we don't miss any messages
    await connectWs()

    const promptRes = await comfyFetch('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId })
    })
    if (!promptRes.ok) {
      const body = await promptRes.text()
      let detail = ''
      try {
        detail = JSON.parse(body).node_errors ? JSON.stringify(JSON.parse(body).node_errors).slice(0, 400) : body
      } catch {
        detail = body
      }
      return { ok: false, error: `ComfyUI prompt error ${promptRes.status}: ${detail.slice(0, 400)}` }
    }
    const pdata = (await promptRes.json()) as { prompt_id?: string; error?: unknown; node_errors?: unknown }
    if (pdata.error) {
      return { ok: false, error: `ComfyUI error: ${JSON.stringify(pdata.error).slice(0, 400)}` }
    }
    const promptId = pdata.prompt_id
    if (!promptId) return { ok: false, error: 'ComfyUI did not return a prompt_id.' }
    currentPromptId = promptId

    sendProgress({ phase: 'loading-model', percent: 5 })

    // poll history until done (fallback if websocket misses events)
    const deadline = Date.now() + 1000 * 60 * 5
    let imageName: string | null = null
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1200))
      const histRes = await comfyFetch(`/history/${promptId}`)
      if (!histRes.ok) continue
      const hist = (await histRes.json()) as Record<
        string,
        { status?: { status_str?: string; completed?: boolean; messages?: Array<[string, unknown]> }; outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }> }
      >
      const entry = hist[promptId]
      if (!entry) continue
      if (entry.status?.status_str === 'error') {
        const msg = entry.status.messages
          ?.filter((m) => m[0] === 'execution_error')
          .map((m) => JSON.stringify(m[1]))
          .join('\n')
        sendProgress({ phase: 'error', error: `ComfyUI execution error: ${(msg || '').slice(0, 500)}` })
        return { ok: false, error: `ComfyUI execution error: ${(msg || '').slice(0, 500)}` }
      }
      if (entry.status?.completed || entry.status?.status_str === 'success') {
        const imgs = Object.values(entry.outputs ?? {})
          .flatMap((o) => o.images ?? [])
        if (imgs.length) {
          imageName = imgs[0].filename
          const sub = imgs[0].subfolder
          const type = imgs[0].type || 'output'

          sendProgress({ phase: 'decoding', percent: 95 })

          const imgRes = await comfyFetch(
            `/view?filename=${encodeURIComponent(imageName)}&subfolder=${encodeURIComponent(sub)}&type=${type}`,
            { signal: AbortSignal.timeout(60000) }
          )
          if (imgRes.ok) {
            const buf = Buffer.from(await imgRes.arrayBuffer())
            const dataUrl = `data:image/png;base64,${buf.toString('base64')}`
            resolved = true
            sendProgress({ phase: 'done', percent: 100, result: { ok: true, dataUrl, promptId, name: imageName } })
            return { ok: true, dataUrl, promptId, name: imageName }
          }
          return { ok: false, error: 'Image generated but could not be read back.' }
        }
      }
    }
    sendProgress({ phase: 'error', error: 'Timed out waiting for the image.' })
    return { ok: false, error: 'Timed out waiting for the image. The model may still be loading.' }
  } catch (e) {
    sendProgress({ phase: 'error', error: (e as Error).message })
    return { ok: false, error: (e as Error).message }
  } finally {
    try { (ws as unknown as { close: () => void })?.close() } catch { /* ignore */ }
  }
}

export async function installCheckpoint(catalog: CatalogModel, onProgress: (p: InstallProgress) => void): Promise<InstallProgress> {
  const prog: InstallProgress = { id: catalog.id, phase: 'downloading', percent: 0, totalMb: catalog.sizeMb }
  installs.set(catalog.id, prog)
  onProgress({ ...prog })
  const dir = installedDir()
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, catalog.file)
  const tmp = dest + '.part'

  try {
    const res = await fetch(catalog.url)
    if (!res.ok || !res.body) {
      const p: InstallProgress = { id: catalog.id, phase: 'error', message: `HTTP ${res.status}` }
      installs.set(catalog.id, p)
      onProgress(p)
      return p
    }
    const totalMb = catalog.sizeMb
    const out = fs.createWriteStream(tmp)
    const reader = res.body.getReader()
    let received = 0
    const maxBytes = totalMb * 1024 * 1024
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (Buffer.isBuffer(value)) out.write(value)
      else out.write(Buffer.from(value))
      received += value.byteLength
      const p: InstallProgress = {
        id: catalog.id,
        phase: 'downloading',
        percent: Math.min(100, Math.round((received / maxBytes) * 100)),
        downloadedMb: Math.round(received / 1024 / 1024),
        totalMb
      }
      installs.set(catalog.id, p)
      onProgress({ ...p })
    }
    await new Promise<void>((resolve, reject) => out.end((e: Error | null | undefined) => (e ? reject(e) : resolve())))
    fs.renameSync(tmp, dest)
    const done: InstallProgress = { id: catalog.id, phase: 'complete', percent: 100, totalMb }
    installs.set(catalog.id, done)
    onProgress({ ...done })
    return done
  } catch (e) {
    const p: InstallProgress = { id: catalog.id, phase: 'error', message: (e as Error).message }
    installs.set(catalog.id, p)
    onProgress({ ...p })
    return p
  }
}

export function uninstallCheckpoint(name: string): { ok: boolean; error?: string } {
  const fp = path.join(installedDir(), name)
  try {
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export const CATALOG: CatalogModel[] = [
  {
    id: 'sd15-ema',
    name: 'Stable Diffusion 1.5 (pruned-emaonly)',
    description: 'The classic all-round text-to-image model. Great default, works on 16GB, fast.',
    url: 'https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors',
    sizeMb: 4000,
    file: 'v1-5-pruned-emaonly.safetensors',
    requires: '~4.4GB free disk'
  },
  {
    id: 'sd15-pruned',
    name: 'Stable Diffusion 1.5 (pruned)',
    description: 'Full SD1.5 checkpoint — higher fidelity, slower, more detail. Best for final renders.',
    url: 'https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5/resolve/main/v1-5-pruned.safetensors',
    sizeMb: 7700,
    file: 'v1-5-pruned.safetensors',
    requires: '~8GB free disk'
  },
  {
    id: 'openjourney-v4',
    name: 'OpenJourney v4 (Midjourney style)',
    description: 'Artistic / painterly style inspired by Midjourney. Great for stylized, cinematic images.',
    url: 'https://huggingface.co/prompthero/openjourney/resolve/main/mdjrny-v4.safetensors',
    sizeMb: 4100,
    file: 'mdjrny-v4.safetensors',
    requires: '~4.5GB free disk'
  },
  {
    id: 'realistic-v51',
    name: 'Realistic Vision V5.1',
    description: 'Photorealistic — skin, portraits, interiors. SD1.5 fine-tune, very popular for realism.',
    url: 'https://huggingface.co/SG161222/Realistic_Vision_V5.1_noVAE/resolve/main/Realistic_Vision_V5.1_fp16-no-ema.safetensors',
    sizeMb: 2000,
    file: 'Realistic_Vision_V5.1_fp16-no-ema.safetensors',
    requires: '~2.5GB free disk'
  },
  {
    id: 'sdxl-base',
    name: 'SDXL Base 1.0 (experimental)',
    description: '1024px native, more detail but ~6.9GB and slower on 16GB. Needs SDXL workflow.',
    url: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors',
    sizeMb: 6900,
    file: 'sd_xl_base_1.0.safetensors',
    requires: '~7.5GB free disk · SDXL workflow'
  }
]
