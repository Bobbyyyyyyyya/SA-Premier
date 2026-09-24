import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { execFile } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { cancelExport, extractAudioToFile, ffmpegBin, startExport } from './export'
import * as ai from './ai'
import * as comfy from './comfyui'
import * as musicAi from './music-ai'
import * as transcribe from './transcribe'
import * as project from './project'
import * as aiSetup from './ai-setup'
import { addRecent, clearRecents, loadRecents } from './recents'
import type { ExportRequest, RecentMediaItem, SavedProject } from '../shared/types'
import type { AiSetup } from './ai-setup'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: 'SA Premier',
    backgroundColor: '#100f0d',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.setMenuBarVisibility(false)
  win.webContents.openDevTools()
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}

function setupAutoUpdater(win: BrowserWindow): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    const r = dialog.showMessageBoxSync(win, {
      type: 'info',
      buttons: ['Download nu', 'Later'],
      defaultId: 0,
      title: 'Update beschikbaar',
      message: `SA Premier ${info.version} is beschikbaar (nu ${app.getVersion()}). Wil je updaten? Bestaande app wordt bijgewerkt.`
    })
    if (r === 0) {
      void autoUpdater.downloadUpdate()
      win.webContents.send('updater-status', { phase: 'downloading', percent: 0, version: info.version })
    }
  })
  autoUpdater.on('download-progress', (p) => {
    win.webContents.send('updater-status', { phase: 'downloading', percent: Math.round(p.percent), version: p.total ? undefined : undefined })
  })
  autoUpdater.on('update-downloaded', (info) => {
    win.webContents.send('updater-status', { phase: 'downloaded', percent: 100, version: info.version })
    const r = dialog.showMessageBoxSync(win, {
      type: 'info',
      buttons: ['Herstart en installeer', 'Later'],
      defaultId: 0,
      title: 'Update klaar',
      message: `Update ${info.version} gedownload. Herstart om te installeren — vervangt de bestaande SA Premier (.pkg/.exe/.deb updatet automatisch).`
    })
    if (r === 0) autoUpdater.quitAndInstall()
  })
  autoUpdater.on('error', (err) => {
    win.webContents.send('updater-status', { phase: 'error', message: err.message })
  })

  // Controleer elke 6 uur + bij start (na 8s)
  const check = (): void => {
    void autoUpdater.checkForUpdates().catch(() => null)
  }
  setTimeout(check, 8000)
  setInterval(check, 6 * 60 * 60 * 1000)
}

function registerIpc(): void {
  ipcMain.handle('import-media', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Media',
          extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']
        }
      ]
    })
    return res.canceled ? [] : res.filePaths
  })

  ipcMain.handle('export-video', async (event, req: ExportRequest) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: `${req.project.name || 'SA Premier'}.mp4`,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
    })
    if (res.canceled || !res.filePath) return { cancelled: true }
    try {
      return startExport(event.sender, { ...req, outPath: res.filePath })
    } catch (err) {
      return { error: (err as Error).message }
    }
  })

  ipcMain.handle('export-cancel', () => cancelExport())
  ipcMain.handle('shell-show-item', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('shell-open-path', (_e, p: string) => shell.openPath(p))

  ipcMain.handle('generate-thumbnail', (_e, p: string) =>
    new Promise<string | null>((resolve) => {
      const bin = ffmpegBin()
      if (!bin) return resolve(null)
      const run = (seek: boolean): void => {
        const args = ['-loglevel', 'error']
        if (seek) args.push('-ss', '0.3')
        args.push('-i', p, '-frames:v', '1', '-vf', 'scale=320:-2', '-f', 'image2pipe', '-c:v', 'png', '-')
        execFile(bin, args, { maxBuffer: 10 * 1024 * 1024, timeout: 15000 }, (err, stdout) => {
          if (!err && stdout.length > 0) {
            resolve('data:image/png;base64,' + Buffer.from(stdout as unknown as Buffer).toString('base64'))
          } else if (seek) {
            run(false)
          } else {
            resolve(null)
          }
        })
      }
      run(true)
    })
  )

  ipcMain.handle('get-media-duration', (_e, p: string) =>
    new Promise<number | null>((resolve) => {
      const bin = ffmpegBin()
      if (!bin) return resolve(null)
      execFile(bin, ['-i', p], { timeout: 10000 }, (_err, _stdout, stderr) => {
        const out = String(stderr || _stdout || '')
        const m = out.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/)
        if (m) {
          const h = parseInt(m[1], 10)
          const mm = parseInt(m[2], 10)
          const s = parseInt(m[3], 10)
          const ms = parseInt(m[4].padEnd(3, '0').slice(0, 3), 10)
          const dur = h * 3600 + mm * 60 + s + ms / 1000
          if (Number.isFinite(dur) && dur > 0) return resolve(dur)
        }
        resolve(null)
      })
    })
  )

  ipcMain.handle('ai-ping', () => ai.pingOllama())
  ipcMain.handle('ai-start', () => ai.ensureOllama())
  ipcMain.handle('ai-models', () => ai.listModels())
  ipcMain.handle('ai-text', (_e, model: string, prompt: string) => ai.generateText(model, prompt))
  ipcMain.handle('ai-beat', async (event, seconds: number, bpm: number, prompt?: string, modelId?: string) => {
    const p = (prompt ?? '').trim()
    const mid = modelId || 'facebook/musicgen-medium'
    if (!event.sender.isDestroyed()) event.sender.send('music-progress', { phase: 'generating', percent: 0 })
    // Probeer echte AI, maar val altijd terug op synth zodat beat nooit faalt (user: "werkt niet")
    const st = await musicAi.musicStatus()
    if (st.available) {
      if (!event.sender.isDestroyed()) event.sender.send('music-progress', { phase: 'generating', percent: 10, message: 'Loading AI model (first run takes ~30s)...' })
      try {
        const r = await musicAi.generateMusic(p || 'a happy trap beat', seconds, mid)
        if (r.ok && r.base64) {
          const result = { ok: true, name: `ai-${mid.split('/').pop()}-${seconds}s.wav`, base64: r.base64 }
          if (!event.sender.isDestroyed()) event.sender.send('music-progress', { phase: 'done', percent: 100, result })
          return result
        }
        // AI faalde — fallback naar synth i.p.v. error
        if (!event.sender.isDestroyed()) event.sender.send('music-progress', { phase: 'generating', percent: 40, message: `AI failed (${r.error || 'onbekend'}), fallback naar synth...` })
      } catch (e) {
        if (!event.sender.isDestroyed()) event.sender.send('music-progress', { phase: 'generating', percent: 40, message: `AI error, fallback naar synth...` })
      }
    } else {
      if (!event.sender.isDestroyed()) event.sender.send('music-progress', { phase: 'generating', percent: 30, message: 'MusicGen offline, using synth...' })
    }
    try {
      const { wav, name } = ai.generateBeat(seconds, bpm, p)
      const result = { ok: true, name, base64: wav.toString('base64') }
      if (!event.sender.isDestroyed()) event.sender.send('music-progress', { phase: 'done', percent: 100, result })
      return result
    } catch (e) {
      const msg = (e as Error).message
      if (!event.sender.isDestroyed()) event.sender.send('music-progress', { phase: 'error', error: msg })
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('ai-save-image', async (event, dataUrl: string, defName: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: defName || 'ai-image.png',
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, cancelled: true }
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    fs.writeFileSync(res.filePath, Buffer.from(base64, 'base64'))
    return { ok: true, path: res.filePath }
  })

  ipcMain.handle('ai-save-audio', async (event, base64: string, defName: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: defName || 'ai-beat.wav',
      filters: [{ name: 'WAV Audio', extensions: ['wav'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, cancelled: true }
    fs.writeFileSync(res.filePath, Buffer.from(base64, 'base64'))
    return { ok: true, path: res.filePath }
  })

  ipcMain.handle('ai-store-image', (_e, dataUrl: string, name: string) => {
    const dir = path.join(app.getPath('userData'), 'generated')
    fs.mkdirSync(dir, { recursive: true })
    const safe = (name || 'ai-image.png').replace(/[^a-zA-Z0-9._-]/g, '_')
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const fp = path.join(dir, safe.endsWith('.png') ? safe : safe + '.png')
    fs.writeFileSync(fp, Buffer.from(base64, 'base64'))
    return { ok: true, path: fp }
  })

  ipcMain.handle('ai-store-audio', (_e, base64: string, name: string) => {
    const dir = path.join(app.getPath('userData'), 'generated')
    fs.mkdirSync(dir, { recursive: true })
    const safe = (name || 'ai-beat.wav').replace(/[^a-zA-Z0-9._-]/g, '_')
    const fp = path.join(dir, safe.endsWith('.wav') ? safe : safe + '.wav')
    fs.writeFileSync(fp, Buffer.from(base64, 'base64'))
    return { ok: true, path: fp }
  })

  ipcMain.handle('recents-list', () => loadRecents())
  ipcMain.handle('recents-add', (_e, item: RecentMediaItem) => addRecent(item))
  ipcMain.handle('recents-clear', () => clearRecents())

  ipcMain.handle('comfy-status', () => comfy.comfyStatus())
  ipcMain.handle('comfy-models', () => comfy.listCheckpoints())
  ipcMain.handle('comfy-catalog', () => comfy.CATALOG)
  ipcMain.handle('comfy-installed-dir', () => comfy.comfyDirExists())
  ipcMain.handle('comfy-start', () => comfy.ensureComfyUIAsync())
  ipcMain.handle('comfy-install', (event, id: string) => {
    const item = comfy.CATALOG.find((m) => m.id === id)
    if (!item) return { id, phase: 'error', message: 'Unknown model' }
    return comfy.installCheckpoint(item, (p) => {
      if (!event.sender.isDestroyed()) event.sender.send('comfy-install-progress', p)
    })
  })
  ipcMain.handle('comfy-uninstall', (_e, name: string) => comfy.uninstallCheckpoint(name))
  ipcMain.handle('comfy-image', (event, checkpoint: string, prompt: string, width: number, height: number) =>
    comfy.txt2img(checkpoint, prompt, width, height, 24, 7, -1, undefined, (p) => {
      if (!event.sender.isDestroyed()) event.sender.send('comfy-image-progress', p)
    })
  )

  ipcMain.handle('music-catalog', () => musicAi.MUSIC_CATALOG)
  ipcMain.handle('music-models', () => musicAi.listMusicModels())
  ipcMain.handle('music-status', () => musicAi.musicStatus())
  ipcMain.handle('music-start', () => musicAi.ensureMusicAIAsync())
  ipcMain.handle('music-generate', (_e, prompt: string, seconds: number, modelId: string) => musicAi.generateMusic(prompt, seconds, modelId))
  ipcMain.handle('music-install', (event, id: string) => {
    const item = musicAi.MUSIC_CATALOG.find((m) => m.id === id)
    if (!item) return { id, phase: 'error', message: 'Unknown model' }
    return musicAi.installMusicModel(item, (p) => {
      if (!event.sender.isDestroyed()) event.sender.send('music-install-progress', p)
    })
  })
  ipcMain.handle('music-uninstall', (_e, name: string) => musicAi.uninstallMusicModel(name))

  ipcMain.handle('whisper-status', () => transcribe.whisperStatus())
  ipcMain.handle('whisper-catalog', () => transcribe.WHISPER_CATALOG)
  ipcMain.handle('whisper-install-cli', (event) =>
    transcribe.installWhisperCli((p) => {
      if (!event.sender.isDestroyed()) event.sender.send('whisper-install-progress', p)
    })
  )
  ipcMain.handle('whisper-install', (event, id: string) =>
    transcribe.installWhisperModel(id, (p) => {
      if (!event.sender.isDestroyed()) event.sender.send('whisper-install-progress', p)
    })
  )
  ipcMain.handle('subtitles-generate', async (event, req: Parameters<typeof transcribe.generateSubtitles>[0]) => {
    return transcribe.generateSubtitles(req, (p) => {
      if (!event.sender.isDestroyed()) event.sender.send('subtitles-progress', p)
    })
  })
  ipcMain.handle('subtitles-cancel', () => transcribe.cancelTranscribe())

  ipcMain.handle('extract-audio', async (event, inPath: string, opts?: { start?: number; duration?: number; name?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const base = (opts?.name || 'audio').replace(/\.[a-z0-9]+$/i, '')
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: `${base}.wav`,
      filters: [
        { name: 'WAV Audio', extensions: ['wav'] },
        { name: 'MP3 Audio', extensions: ['mp3'] },
        { name: 'M4A Audio', extensions: ['m4a'] }
      ]
    })
    if (res.canceled || !res.filePath) return { cancelled: true }
    try {
      const r = await extractAudioToFile(inPath, res.filePath, opts)
      return { ok: true, outPath: r.outPath }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('project-load', () => project.loadProject())
  ipcMain.handle('project-save', (_e, data: SavedProject) => project.saveProject(data))
  ipcMain.handle('project-clear', () => project.clearProject())

  ipcMain.handle('ai-setup-get', () => aiSetup.getAiSetup())
  ipcMain.handle('ai-setup-set', (_e, patch: Partial<AiSetup>) => aiSetup.setAiSetup(patch))
  ipcMain.handle('ai-setup-summary', () => aiSetup.aiSetupSummary())

  ipcMain.handle('updater-check', () => {
    if (!app.isPackaged) return { skipped: true }
    void autoUpdater.checkForUpdates().catch(() => null)
    return { checking: true }
  })
  ipcMain.handle('updater-quit-install', () => autoUpdater.quitAndInstall())
}

app.whenReady().then(() => {
   protocol.handle('media', async (request) => {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400'
        }
      })
    }
    const url = new URL(request.url)
    let decoded = decodeURIComponent(url.pathname)
    if (!decoded) return new Response(null, { status: 400 })
    let filePath = decoded
    if (/^[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(0, 2) + filePath.slice(3)
    }
    filePath = path.resolve(filePath)
    if (!fs.existsSync(filePath)) return new Response(null, { status: 404 })

    // Range support voor video scrubbing / snapshot (anders zwart / alleen kleur)
    const range = request.headers.get('range') || request.headers.get('Range')
    if (range) {
      try {
        const stat = fs.statSync(filePath)
        const size = stat.size
        const m = range.match(/bytes=(\d+)-(\d*)/)
        if (m) {
          const start = parseInt(m[1], 10)
          const end = m[2] ? parseInt(m[2], 10) : size - 1
          const clampedEnd = Math.min(end, size - 1)
          const chunkSize = clampedEnd - start + 1
          const stream = fs.createReadStream(filePath, { start, end: clampedEnd })
          const headers = new Headers()
          headers.set('Content-Type', 'video/mp4')
          // Probeer mime te raden via extensie
          const ext = path.extname(filePath).toLowerCase()
          if (ext === '.webm') headers.set('Content-Type', 'video/webm')
          else if (ext === '.mov') headers.set('Content-Type', 'video/quicktime')
          else if (ext === '.mkv') headers.set('Content-Type', 'video/x-matroska')
          else if (ext === '.mp3') headers.set('Content-Type', 'audio/mpeg')
          else if (ext === '.wav') headers.set('Content-Type', 'audio/wav')
          else if (/\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(ext)) headers.set('Content-Type', 'image/' + ext.slice(1))
          headers.set('Content-Length', String(chunkSize))
          headers.set('Content-Range', `bytes ${start}-${clampedEnd}/${size}`)
          headers.set('Accept-Ranges', 'bytes')
          headers.set('Access-Control-Allow-Origin', '*')
          headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
          headers.set('Access-Control-Allow-Headers', '*')
          headers.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges')
          // Node stream -> Web ReadableStream
          const webStream = new ReadableStream({
            start(controller) {
              stream.on('data', (chunk) => controller.enqueue(chunk))
              stream.on('end', () => controller.close())
              stream.on('error', (e) => controller.error(e))
            },
            cancel() { try { stream.destroy() } catch { /* noop */ } }
          })
          return new Response(webStream as any, { status: 206, headers } as any)
        }
      } catch {
        // fallback naar gewone fetch
      }
    }

    const fileUrl = 'file://' + filePath.split('/').map((seg) => encodeURIComponent(seg)).join('/')
    const res = await net.fetch(fileUrl)
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    headers.set('Access-Control-Allow-Headers', '*')
    headers.set('Access-Control-Expose-Headers', '*')
    headers.set('Accept-Ranges', 'bytes')
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  })

  registerIpc()
  // Lite: alleen 1x proberen op de achtergrond (geen retry-spam)
  // Ai-setup staat standaard op custom: alleen Music aan (Comfy/Ollama uit) — respecteert Lite.
  void ai.ensureOllama().catch(() => null)
  void comfy.ensureComfyUIAsync(10000).catch(() => null)
  void musicAi.ensureMusicAIAsync(10000).catch(() => null)
  const win = createWindow()
  setupAutoUpdater(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  comfy.stopComfyUI()
  musicAi.stopMusicAI()
  ai.stopOllama()
})
