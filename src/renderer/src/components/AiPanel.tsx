import { useCallback, useEffect, useState } from 'react'
import { importPaths } from '../lib/inspect'
import type { AiImageProgress, AiMusicProgress, CatalogModel, ComfyStatus, ComfyImageResult, InstallProgress, InstalledModel } from '../../../shared/types'
import type { MusicStatus } from '../../../shared/types'

function formatMb(mb: number): string {
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB'
  return mb + ' MB'
}

export default function AiPanel(): JSX.Element {
  const [comfy, setComfy] = useState<ComfyStatus>({ available: false })
  const [musicStatus, setMusicStatus] = useState<MusicStatus>({ available: false })
  const [installed, setInstalled] = useState<InstalledModel[]>([])
  const [catalog, setCatalog] = useState<CatalogModel[]>([])
  const [selected, setSelected] = useState('')
  const [installs, setInstalls] = useState<Record<string, InstallProgress>>({})
  const [musicInstalled, setMusicInstalled] = useState<InstalledModel[]>([])
  const [musicCatalog, setMusicCatalog] = useState<CatalogModel[]>([])
  const [musicInstalls, setMusicInstalls] = useState<Record<string, InstallProgress>>({})
  const [modelFilter, setModelFilter] = useState<'all' | 'image' | 'music'>('all')
  const [modelSearch, setModelSearch] = useState('')
  const [selectedMusic, setSelectedMusic] = useState('')

  const [imgPrompt, setImgPrompt] = useState('A cinematic mountain landscape at sunset, 16:9')
  const [imgResult, setImgResult] = useState<ComfyImageResult | null>(null)
  const [imgBusy, setImgBusy] = useState(false)
  const [imgProgress, setImgProgress] = useState<AiImageProgress | null>(null)
  const [width, setWidth] = useState(896)
  const [height, setHeight] = useState(504)

  const [bpm, setBpm] = useState(120)
  const [seconds, setSeconds] = useState(8)
  const [beatPrompt, setBeatPrompt] = useState('')
  const [beatResult, setBeatResult] = useState<{ ok: boolean; name?: string; base64?: string; error?: string } | null>(null)
  const [beatBusy, setBeatBusy] = useState(false)
  const [musicProgress, setMusicProgress] = useState<AiMusicProgress | null>(null)

  const refreshComfy = useCallback(async (): Promise<void> => {
    const st = await window.api.comfyStatus()
    setComfy(st)
    const mst = await window.api.musicStatus()
    setMusicStatus(mst)
    const list = await window.api.comfyModels()
    setInstalled(list)
    setCatalog(await window.api.comfyCatalog())
    setSelected((cur) => (cur && list.some((m) => m.name === cur) ? cur : list[0]?.name ?? ''))
    const mList = await window.api.musicModels()
    setMusicInstalled(mList)
    setMusicCatalog(await window.api.musicCatalog())
    setSelectedMusic((cur) => (cur && mList.some((m) => m.name === cur) ? cur : mList[0]?.name ?? ''))
  }, [])

  useEffect(() => {
    void refreshComfy()
    const t = setInterval(() => void refreshComfy(), 10000)
    return () => clearInterval(t)
  }, [refreshComfy])

  useEffect(() => {
    const off = window.api.onComfyInstallProgress((p) => {
      setInstalls((prev) => ({ ...prev, [p.id]: p }))
      if (p.phase === 'complete') void refreshComfy()
    })
    return off
  }, [refreshComfy])

  useEffect(() => {
    const off = window.api.onMusicInstallProgress((p) => {
      setMusicInstalls((prev) => ({ ...prev, [p.id]: p }))
      if (p.phase === 'complete') void refreshComfy()
    })
    return off
  }, [refreshComfy])

  useEffect(() => {
    const off = window.api.onComfyImageProgress((p) => {
      setImgProgress(p)
      if (p.result) {
        setImgResult(p.result)
        setImgBusy(false)
        setImgProgress(null)
      }
      if (p.phase === 'error') {
        setImgBusy(false)
      }
    })
    return off
  }, [])

  useEffect(() => {
    const off = window.api.onMusicProgress((p) => {
      setMusicProgress(p)
      if (p.result) {
        setBeatResult(p.result)
        setBeatBusy(false)
        setMusicProgress(null)
      }
      if (p.phase === 'error') {
        setBeatBusy(false)
      }
    })
    return off
  }, [])

  const runImage = async (): Promise<void> => {
    if (!selected || !imgPrompt.trim() || !comfy.available) return
    setImgBusy(true)
    setImgResult(null)
    setImgProgress({ phase: 'starting', percent: 0 })
    const r = await window.api.comfyImage(selected, imgPrompt, width, height)
    // If progress events didn't handle the result, set it here
    setImgBusy(false)
    setImgProgress(null)
    setImgResult(r)
  }

  const addResultImage = async (): Promise<void> => {
    if (!imgResult?.dataUrl) return
    const r = await window.api.aiStoreImage(imgResult.dataUrl, 'ai-image.png')
    if (r.ok && r.path) await importPaths([r.path], { place: false })
  }

  const downloadResultImage = async (): Promise<void> => {
    if (!imgResult?.dataUrl) return
    await window.api.aiSaveImage(imgResult.dataUrl, 'ai-image.png')
  }

  const runBeat = async (): Promise<void> => {
    setBeatBusy(true)
    setBeatResult(null)
    setMusicProgress({ phase: 'generating', percent: 0 })
    const r = await window.api.aiBeat(seconds, bpm, beatPrompt, selectedMusic || undefined)
    // If progress events didn't handle the result, set it here
    setBeatBusy(false)
    setMusicProgress(null)
    setBeatResult(r)
  }

  const addResultAudio = async (): Promise<void> => {
    if (!beatResult?.base64 || !beatResult.name) return
    const r = await window.api.aiStoreAudio(beatResult.base64, beatResult.name)
    if (r.ok && r.path) await importPaths([r.path], { place: false })
  }

  const downloadResultAudio = async (): Promise<void> => {
    if (!beatResult?.base64 || !beatResult.name) return
    await window.api.aiSaveAudio(beatResult.base64, beatResult.name)
  }

  const filteredImage = catalog.filter((c) => !modelSearch || c.name.toLowerCase().includes(modelSearch.toLowerCase()) || c.description.toLowerCase().includes(modelSearch.toLowerCase()))
  const filteredMusic = musicCatalog.filter((c) => !modelSearch || c.name.toLowerCase().includes(modelSearch.toLowerCase()) || c.description.toLowerCase().includes(modelSearch.toLowerCase()))
  const totalModels = catalog.length + musicCatalog.length
  const installedCount = installed.length + musicInstalled.length

  return (
    <div className="ai-panel">
      <div className="ai-status">
        <span className={`dot ${comfy.available ? 'ok' : 'bad'}`} />
        <span>
          {comfy.available
            ? `ComfyUI ready${comfy.device ? ' · ' + comfy.device : ''} (${comfy.deviceType ?? ''})`
            : 'ComfyUI engine not running'}
        </span>
        {!comfy.available && (
          <button onClick={() => window.api.comfyStart()} style={{ marginLeft: 'auto' }}>
            Start
          </button>
        )}
      </div>
      <div className="ai-status music-status">
        <span className={`dot ${musicStatus.available ? 'ok' : 'bad'}`} />
        <span>
          {musicStatus.available
            ? `MusicGen ready${musicStatus.device ? ' · ' + musicStatus.device : ''} (local AI)`
            : 'MusicGen server not running — start to use real AI beat'}
        </span>
        {!musicStatus.available && (
          <button onClick={() => window.api.comfyStart()} style={{ marginLeft: 'auto' }}>
            Start
          </button>
        )}
      </div>

      {/* Models Overview */}
      <div className="inspector-section models-overview">
        <div className="models-header">
          <h4 style={{ margin: 0 }}>Models</h4>
          <span className="models-count">{installedCount} / {totalModels} installed</span>
        </div>
        <div className="models-search">
          <input className="text-input" placeholder="Search models…" value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} />
        </div>
        <div className="models-tabs">
          <button className={modelFilter === 'all' ? 'active' : ''} onClick={() => setModelFilter('all')}>All ({totalModels})</button>
          <button className={modelFilter === 'image' ? 'active' : ''} onClick={() => setModelFilter('image')}>Photos ({catalog.length})</button>
          <button className={modelFilter === 'music' ? 'active' : ''} onClick={() => setModelFilter('music')}>Music ({musicCatalog.length})</button>
        </div>

        {(modelFilter === 'all' || modelFilter === 'image') && (
          <div className="models-group">
            <div className="models-group-title">📷 Photo — ComfyUI (SD1.5/SDXL)</div>
            {installed.length > 0 && (
              <div className="installed-grid">
                {installed.map((m) => (
                  <div key={m.name} className="model-row">
                    <div className="model-info">
                      <div className="model-name">{m.name}</div>
                      <div className="model-size">{formatMb(Math.round(m.size / 1024 / 1024))} • installed</div>
                    </div>
                    <button
                      className="model-uninstall"
                      onClick={async () => {
                        await window.api.comfyUninstall(m.name)
                        void refreshComfy()
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="catalog-grid">
              {filteredImage.map((c) => {
                const inst = installs[c.id]
                const already = installed.some((m) => m.name === c.file)
                return (
                  <div key={c.id} className={`catalog-card ${already ? 'installed' : ''}`}>
                    <div className="catalog-badge">{already ? '✓ Installed' : 'Photo'}</div>
                    <div className="catalog-name">{c.name}</div>
                    <div className="catalog-desc">{c.description}</div>
                    <div className="catalog-meta">
                      <span className="catalog-size">{formatMb(c.sizeMb)}</span>
                      <span className="catalog-requires">{c.requires}</span>
                    </div>
                    {already ? (
                      <div className="ai-hint" style={{ color: '#37b06f', marginTop: 6 }}>Ready to use</div>
                    ) : !inst || inst.phase === 'idle' ? (
                      <button className="primary" style={{ width: '100%', marginTop: 8 }} onClick={() => window.api.comfyInstall(c.id)}>
                        Download
                      </button>
                    ) : inst.phase === 'downloading' ? (
                      <div className="model-progress" style={{ marginTop: 8 }}>
                        <div className="model-bar">
                          <div className="model-bar-fill" style={{ width: `${inst.percent ?? 0}%` }} />
                        </div>
                        <div className="model-size">
                          {formatMb(inst.downloadedMb ?? 0)} / {formatMb(c.sizeMb)} · {inst.percent ?? 0}%
                        </div>
                      </div>
                    ) : inst.phase === 'complete' ? (
                      <div className="ai-hint" style={{ color: '#37b06f', marginTop: 6 }}>Installed!</div>
                    ) : (
                      <div className="ai-error">Failed: {inst.message}</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {(modelFilter === 'all' || modelFilter === 'music') && (
          <div className="models-group" style={{ marginTop: 14 }}>
            <div className="models-group-title">🎵 Music — Beat Styles</div>
            {musicInstalled.length > 0 && (
              <div className="installed-grid">
                {musicInstalled.map((m) => (
                  <div key={m.name} className="model-row">
                    <div className="model-info">
                      <div className="model-name">{m.name.replace('.json','')}</div>
                      <div className="model-size">{formatMb(Math.round(m.size / 1024))} • installed</div>
                    </div>
                    <button
                      className="model-uninstall"
                      onClick={async () => {
                        await window.api.musicUninstall(m.name)
                        void refreshComfy()
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="catalog-grid">
              {filteredMusic.map((c) => {
                const inst = musicInstalls[c.id]
                const already = musicInstalled.some((m) => m.name === c.file)
                return (
                  <div key={c.id} className={`catalog-card ${already ? 'installed' : ''}`}>
                    <div className="catalog-badge" style={{ background: '#2d5a4a' }}>{already ? '✓ Installed' : 'Music'}</div>
                    <div className="catalog-name">{c.name}</div>
                    <div className="catalog-desc">{c.description}</div>
                    <div className="catalog-meta">
                      <span className="catalog-size">{formatMb(c.sizeMb)}</span>
                      <span className="catalog-requires">{c.requires}</span>
                    </div>
                    {already ? (
                      <div className="ai-hint" style={{ color: '#37b06f', marginTop: 6 }}>Ready to use</div>
                    ) : !inst || inst.phase === 'idle' ? (
                      <button className="primary" style={{ width: '100%', marginTop: 8 }} onClick={() => window.api.musicInstall(c.id)}>
                        Download
                      </button>
                    ) : inst.phase === 'downloading' ? (
                      <div className="model-progress" style={{ marginTop: 8 }}>
                        <div className="model-bar">
                          <div className="model-bar-fill" style={{ width: `${inst.percent ?? 0}%`, background: '#37b06f' }} />
                        </div>
                        <div className="model-size">
                          {formatMb(inst.downloadedMb ?? 0)} / {formatMb(c.sizeMb)} · {inst.percent ?? 0}%
                        </div>
                      </div>
                    ) : inst.phase === 'complete' ? (
                      <div className="ai-hint" style={{ color: '#37b06f', marginTop: 6 }}>Installed!</div>
                    ) : (
                      <div className="ai-error">Failed: {inst.message}</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* AI Photo */}
      <div className="inspector-section">
        <h4>AI Photo</h4>
        {installed.length === 0 ? (
          <div className="ai-hint">Install a photo model above first, then describe your image.</div>
        ) : (
          <>
            <div className="ctl">
              <label>Model</label>
              <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ flex: 1 }}>
                {installed.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="ctl">
              <label>Size</label>
              <select
                style={{ flex: 1 }}
                value={`${width}x${height}`}
                onChange={(e) => {
                  const [w, h] = e.target.value.split('x').map(Number)
                  setWidth(w)
                  setHeight(h)
                }}
              >
                <option value="512x512">Square 512×512</option>
                <option value="768x432">16:9 768×432</option>
                <option value="896x504">16:9 896×504</option>
                <option value="768x768">Square 768×768</option>
                <option value="1024x576">16:9 1024×576 (SDXL)</option>
              </select>
            </div>
            <textarea
              className="text-input"
              rows={3}
              value={imgPrompt}
              onChange={(e) => setImgPrompt(e.target.value)}
              placeholder="Describe an image…"
            />
            <div className="btn-row">
              <button className="primary" onClick={runImage} disabled={imgBusy || !comfy.available}>
                Generate image
              </button>
            </div>
            {imgBusy && imgProgress && (
              <div className="ai-progress-container">
                <div className="ai-progress-status">
                  {imgProgress.phase === 'starting' && 'Initializing...'}
                  {imgProgress.phase === 'loading-model' && 'Loading model into VRAM...'}
                  {imgProgress.phase === 'generating' && `Generating step ${imgProgress.step ?? 0}/${imgProgress.totalSteps ?? '?'}...`}
                  {imgProgress.phase === 'decoding' && 'Decoding image...'}
                  {imgProgress.phase === 'error' && `Error: ${imgProgress.error}`}
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${imgProgress.percent ?? 0}%` }} />
                </div>
                <div className="ai-progress-percent">{imgProgress.percent ?? 0}%</div>
                {imgProgress.previewDataUrl && (
                  <img className="ai-preview" src={imgProgress.previewDataUrl} alt="generating preview" />
                )}
              </div>
            )}
            {imgResult && !imgResult.ok && <div className="ai-error">{imgResult.error}</div>}
            {imgResult?.ok && imgResult.dataUrl && (
              <>
                <img className="ai-img" src={imgResult.dataUrl} alt="generated" />
                <div className="btn-row">
                  <button onClick={addResultImage}>Add to library</button>
                  <button onClick={downloadResultImage}>Download</button>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* AI Beat */}
      <div className="inspector-section">
        <h4>AI Beat (music)</h4>
        {musicInstalled.length > 0 && (
          <div className="ctl">
            <label>Style</label>
            <select value={selectedMusic} onChange={(e) => setSelectedMusic(e.target.value)} style={{ flex: 1 }}>
              <option value="">Auto (from prompt)</option>
              {musicInstalled.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name.replace('.json','')}
                </option>
              ))}
            </select>
          </div>
        )}
        <textarea
          className="text-input"
          rows={2}
          value={beatPrompt}
          onChange={(e) => setBeatPrompt(e.target.value)}
          placeholder="Describe the beat — e.g. dark trap 808 with rolls, lofi chill, techno house, happy pop, jazz soul…"
        />
        <div className="ai-hint" style={{ marginTop: 4, marginBottom: 8 }}>
          Keywords: trap, lofi, techno, dark, happy, jazz, drum — bepalen bass & drums. Leeg = standaard.
        </div>
        <div className="ctl">
          <label>BPM</label>
          <input type="range" min={20} max={300} step={1} value={bpm} onChange={(e) => setBpm(+e.target.value)} />
          <input
            className="num-input"
            type="number"
            min={20}
            max={300}
            step={1}
            value={bpm}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              if (!Number.isNaN(v)) setBpm(Math.min(300, Math.max(20, v)))
            }}
          />
        </div>
        <div className="ctl">
          <label>Length</label>
          <input type="range" min={1} max={120} step={1} value={seconds} onChange={(e) => setSeconds(+e.target.value)} />
          <input
            className="num-input"
            type="number"
            min={1}
            max={120}
            step={1}
            value={seconds}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              if (!Number.isNaN(v)) setSeconds(Math.min(120, Math.max(1, v)))
            }}
          />
          <span className="val">{seconds}s</span>
        </div>
        <div className="btn-row">
          <button className="primary" onClick={runBeat} disabled={beatBusy}>
            Generate beat
          </button>
        </div>
        {beatBusy && musicProgress && (
          <div className="ai-progress-container">
            <div className="ai-progress-status">
              {musicProgress.phase === 'generating' && (musicProgress.message || 'Synthesizing beat...')}
              {musicProgress.phase === 'error' && `Error: ${musicProgress.error}`}
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${musicProgress.percent ?? 0}%`, background: 'linear-gradient(90deg, #37b06f, #4cd98a)' }} />
            </div>
            <div className="ai-progress-percent">{musicProgress.percent ?? 0}%</div>
          </div>
        )}
        {beatResult?.ok && beatResult.base64 && (
          <>
            <audio
              controls
              style={{ width: '100%', marginTop: 8 }}
              src={`data:audio/wav;base64,${beatResult.base64}`}
            />
            <div className="ai-hint">Preview — als je stilte hoort, probeer prompt te wijzigen of BPM/length aan te passen.</div>
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button onClick={addResultAudio}>Add to library</button>
              <button onClick={downloadResultAudio}>Download</button>
            </div>
          </>
        )}
        {!beatResult?.ok && beatResult?.error && <div className="ai-error">{beatResult.error}</div>}
        {musicInstalled.length === 0 && <div className="ai-hint">Tip: installeer een Music-model hierboven voor meer stijlen.</div>}
      </div>
    </div>
  )
}
