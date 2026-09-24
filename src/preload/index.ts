import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AiGenerateResult,
  AiImageProgress,
  AiMusicProgress,
  CatalogModel,
  ComfyImageResult,
  ComfyStatus,
  ExportProgress,
  ExportRequest,
  ExportStartResult,
  InstallProgress,
  InstalledModel,
  MusicStatus,
  OllamaModelInfo,
  RecentMediaItem,
  SavedProject,
  TranscribeProgress,
  TranscribeRequest,
  TranscribeResult,
  TranscribeStatus
} from '../shared/types'

const api = {
  importMedia: (): Promise<string[]> => ipcRenderer.invoke('import-media'),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  exportVideo: (req: ExportRequest): Promise<ExportStartResult> => ipcRenderer.invoke('export-video', req),
  cancelExport: (): Promise<void> => ipcRenderer.invoke('export-cancel'),
  onExportProgress: (cb: (p: ExportProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ExportProgress): void => cb(p)
    ipcRenderer.on('export-progress', listener)
    return () => ipcRenderer.removeListener('export-progress', listener)
  },
  showItemInFolder: (p: string): Promise<void> => ipcRenderer.invoke('shell-show-item', p),
  openPath: (p: string): Promise<string> => ipcRenderer.invoke('shell-open-path', p),
  generateThumbnail: (p: string): Promise<string | null> => ipcRenderer.invoke('generate-thumbnail', p),
  getMediaDuration: (p: string): Promise<number | null> => ipcRenderer.invoke('get-media-duration', p),

  aiPing: (): Promise<{ available: boolean; version?: string }> => ipcRenderer.invoke('ai-ping'),
  aiStart: (): Promise<{ available: boolean; started?: boolean; error?: string }> => ipcRenderer.invoke('ai-start'),
  aiModels: (): Promise<OllamaModelInfo[]> => ipcRenderer.invoke('ai-models'),
  aiText: (model: string, prompt: string): Promise<AiGenerateResult> => ipcRenderer.invoke('ai-text', model, prompt),
  aiBeat: (seconds: number, bpm: number, prompt?: string, modelId?: string): Promise<{ ok: boolean; name?: string; base64?: string; error?: string }> =>
    ipcRenderer.invoke('ai-beat', seconds, bpm, prompt, modelId),
  aiSaveImage: (dataUrl: string, name: string): Promise<{ ok: boolean; path?: string; cancelled?: boolean }> =>
    ipcRenderer.invoke('ai-save-image', dataUrl, name),
  aiSaveAudio: (base64: string, name: string): Promise<{ ok: boolean; path?: string; cancelled?: boolean }> =>
    ipcRenderer.invoke('ai-save-audio', base64, name),
  aiStoreImage: (dataUrl: string, name: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('ai-store-image', dataUrl, name),
  aiStoreAudio: (base64: string, name: string): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('ai-store-audio', base64, name),

  recentsList: (): Promise<RecentMediaItem[]> => ipcRenderer.invoke('recents-list'),
  recentsAdd: (item: RecentMediaItem): Promise<RecentMediaItem[]> => ipcRenderer.invoke('recents-add', item),
  recentsClear: (): Promise<RecentMediaItem[]> => ipcRenderer.invoke('recents-clear'),

  comfyStatus: (): Promise<ComfyStatus> => ipcRenderer.invoke('comfy-status'),
  comfyModels: (): Promise<InstalledModel[]> => ipcRenderer.invoke('comfy-models'),
  comfyCatalog: (): Promise<CatalogModel[]> => ipcRenderer.invoke('comfy-catalog'),
  comfyInstalledDir: (): Promise<boolean> => ipcRenderer.invoke('comfy-installed-dir'),
  comfyStart: (): Promise<{ available: boolean; started?: boolean; error?: string }> => ipcRenderer.invoke('comfy-start'),
  comfyInstall: (id: string): Promise<InstallProgress> => ipcRenderer.invoke('comfy-install', id),
  comfyUninstall: (name: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('comfy-uninstall', name),
  comfyImage: (checkpoint: string, prompt: string, width: number, height: number): Promise<ComfyImageResult> =>
    ipcRenderer.invoke('comfy-image', checkpoint, prompt, width, height),
  onComfyInstallProgress: (cb: (p: InstallProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: InstallProgress): void => cb(p)
    ipcRenderer.on('comfy-install-progress', listener)
    return () => ipcRenderer.removeListener('comfy-install-progress', listener)
  },
  onComfyImageProgress: (cb: (p: AiImageProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: AiImageProgress): void => cb(p)
    ipcRenderer.on('comfy-image-progress', listener)
    return () => ipcRenderer.removeListener('comfy-image-progress', listener)
  },
  musicCatalog: (): Promise<CatalogModel[]> => ipcRenderer.invoke('music-catalog'),
  musicModels: (): Promise<InstalledModel[]> => ipcRenderer.invoke('music-models'),
  musicInstall: (id: string): Promise<InstallProgress> => ipcRenderer.invoke('music-install', id),
  musicUninstall: (name: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('music-uninstall', name),
  musicStatus: (): Promise<MusicStatus> => ipcRenderer.invoke('music-status'),
  musicStart: (): Promise<{ available: boolean; started?: boolean; error?: string }> => ipcRenderer.invoke('music-start'),
  extractAudio: (inPath: string, opts?: { start?: number; duration?: number; name?: string }): Promise<{ ok?: boolean; outPath?: string; cancelled?: boolean; error?: string }> =>
    ipcRenderer.invoke('extract-audio', inPath, opts),
  musicGenerate: (prompt: string, seconds: number, modelId: string): Promise<{ ok: boolean; base64?: string; error?: string }> => ipcRenderer.invoke('music-generate', prompt, seconds, modelId),
  onMusicInstallProgress: (cb: (p: InstallProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: InstallProgress): void => cb(p)
    ipcRenderer.on('music-install-progress', listener)
    return () => ipcRenderer.removeListener('music-install-progress', listener)
  },
  onMusicProgress: (cb: (p: AiMusicProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: AiMusicProgress): void => cb(p)
    ipcRenderer.on('music-progress', listener)
    return () => ipcRenderer.removeListener('music-progress', listener)
  },

  whisperStatus: (): Promise<TranscribeStatus> => ipcRenderer.invoke('whisper-status'),
  whisperCatalog: (): Promise<CatalogModel[]> => ipcRenderer.invoke('whisper-catalog'),
  whisperInstallCli: (): Promise<InstallProgress> => ipcRenderer.invoke('whisper-install-cli'),
  whisperInstall: (id: string): Promise<InstallProgress> => ipcRenderer.invoke('whisper-install', id),
  subtitlesGenerate: (req: TranscribeRequest): Promise<TranscribeResult> =>
    ipcRenderer.invoke('subtitles-generate', req),
  subtitlesCancel: (): Promise<void> => ipcRenderer.invoke('subtitles-cancel'),
  onSubtitlesProgress: (cb: (p: TranscribeProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: TranscribeProgress): void => cb(p)
    ipcRenderer.on('subtitles-progress', listener)
    return () => ipcRenderer.removeListener('subtitles-progress', listener)
  },
  onWhisperInstallProgress: (cb: (p: InstallProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: InstallProgress): void => cb(p)
    ipcRenderer.on('whisper-install-progress', listener)
    return () => ipcRenderer.removeListener('whisper-install-progress', listener)
  },

  projectLoad: (): Promise<SavedProject | null> => ipcRenderer.invoke('project-load'),
  projectSave: (data: SavedProject): Promise<void> => ipcRenderer.invoke('project-save', data),
  projectClear: (): Promise<void> => ipcRenderer.invoke('project-clear'),

  updaterCheck: (): Promise<{ checking?: boolean; skipped?: boolean }> => ipcRenderer.invoke('updater-check'),
  updaterQuitInstall: (): Promise<void> => ipcRenderer.invoke('updater-quit-install'),
  onUpdaterStatus: (cb: (p: { phase: string; percent?: number; version?: string; message?: string }) => void): (() => void) => {
    const l = (_e: Electron.IpcRendererEvent, p: { phase: string; percent?: number; version?: string; message?: string }): void => cb(p)
    ipcRenderer.on('updater-status', l)
    return () => ipcRenderer.removeListener('updater-status', l)
  },

  aiSetupGet: (): Promise<{ mode: string; comfy: boolean; music: boolean; ollama: boolean; completed: boolean; updatedAt: number }> =>
    ipcRenderer.invoke('ai-setup-get'),
  aiSetupSet: (patch: { mode?: string; comfy?: boolean; music?: boolean; ollama?: boolean; completed?: boolean }): Promise<{ mode: string; comfy: boolean; music: boolean; ollama: boolean; completed: boolean; updatedAt: number }> =>
    ipcRenderer.invoke('ai-setup-set', patch),
  aiSetupSummary: (): Promise<{ setup: { mode: string; comfy: boolean; music: boolean; ollama: boolean; completed: boolean }; bundled: { checkpoints: { name: string; size: number }[]; hasBundled: boolean } }> =>
    ipcRenderer.invoke('ai-setup-summary')
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
