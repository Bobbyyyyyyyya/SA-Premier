import { useCallback, useEffect, useState } from 'react'
import type { RecentMediaItem } from '../../../shared/types'
import { importPaths, importFiles } from '../lib/inspect'
import { mediaUrl } from '../lib/mediaUrl'
import { useEditorStore, selectTotal } from '../store'
import { formatTime } from '../lib/format'

export default function HomeScreen({ onOpen }: { onOpen: () => void }): JSX.Element {
  const [recent, setRecent] = useState<RecentMediaItem[]>([])
  const [opening, setOpening] = useState<string | null>(null)
  const project = useEditorStore((s) => s.project)
  const assets = useEditorStore((s) => s.assets)
  const clips = useEditorStore((s) => s.clips)
  const total = useEditorStore(selectTotal)

  const refresh = useCallback(async () => {
    setRecent(await window.api.recentsList())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openRecent = async (paths: string[]): Promise<void> => {
    setOpening(paths[0])
    await importPaths(paths, { place: true })
    setOpening(null)
    onOpen()
  }

  const openSingle = async (path: string): Promise<void> => {
    setOpening(path)
    await importPaths([path], { place: false })
    setOpening(null)
    onOpen()
  }

  const hasProject = clips.length > 0 || assets.length > 0

  return (
    <div className="home home--light">
      <div className="home-hero">
        <div className="home-hero-bg" />
        <div className="home-hero-inner">
          <div className="home-brand-block">
            <div className="home-brand home-brand--light">
              SA<span>Premier</span>
            </div>
            <div className="home-tagline">CapCut × DaVinci — licht, snel, altijd offline</div>
            <div className="home-meta">
              <span className="home-pill">{assets.length} media</span>
              <span className="home-pill">{clips.length} clips</span>
              <span className="home-pill">{formatTime(total, project.fps)} timeline</span>
              <span className="home-pill">{project.width}×{project.height} · {project.fps}fps</span>
            </div>
          </div>
          <div className="home-hero-actions">
            <button className="home-cta primary" onClick={async () => {
              if (hasProject && !window.confirm('Nieuw project starten? Huidige timeline wordt geleegd (opgeslagen project blijft bewaard).')) return
              useEditorStore.getState().resetProject()
              onOpen()
            }}>
              <span className="cta-icon">＋</span>
              <span>
                <b>Nieuw project</b>
                <i>Lege timeline — jij bepaalt</i>
              </span>
            </button>
            <button className="home-cta" onClick={async () => {
              await importFiles()
              onOpen()
            }}>
              <span className="cta-icon">⬆</span>
              <span>
                <b>Media importeren</b>
                <i>Meerdere video’s = één project</i>
              </span>
            </button>
            <button className="home-cta ghost" onClick={() => window.dispatchEvent(new Event('open-ai-setup'))}>
              <span className="cta-icon">🤖</span>
              <span>
                <b>AI-setup</b>
                <i>Licht / Volledig / Aangepast</i>
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="home-body home-body--light">
        {/* Huidig project — fix: meerdere video's = één project */}
        <section className="home-section">
          <div className="home-section-head">
            <h2>Huidig project</h2>
            <span className="home-hint">Meerdere video’s die je importeert komen in <b>één</b> project (één timeline), niet als losse projecten.</span>
          </div>
          {hasProject ? (
            <div className="project-card">
              <div className="project-thumb" style={assets[0]?.thumbnail ? { backgroundImage: `url(${assets[0].thumbnail})` } : assets[0] ? { backgroundImage: `url(${mediaUrl(assets[0].path)})` } : {}}>
                {!assets[0]?.thumbnail && !assets[0] && <span className="project-thumb-placeholder">Geen media</span>}
                <div className="project-thumb-overlay">
                  <span className="project-time">{formatTime(total, project.fps)}</span>
                </div>
              </div>
              <div className="project-info">
                <div className="project-name" title={project.name}>{project.name}</div>
                <div className="project-meta">
                  {clips.length} clips · {assets.length} bestanden · {project.width}×{project.height}
                </div>
                <div className="project-assets">
                  {assets.slice(0, 6).map((a) => (
                    <span key={a.id} className="project-asset-dot" title={a.name} style={a.thumbnail ? { backgroundImage: `url(${a.thumbnail})` } : {}}>
                      {!a.thumbnail && (a.isImage ? '🖼' : a.type === 'audio' ? '♪' : '🎬')}
                    </span>
                  ))}
                  {assets.length > 6 && <span className="project-more">+{assets.length - 6}</span>}
                </div>
              </div>
              <div className="project-actions">
                <button className="primary" onClick={onOpen}>Open timeline →</button>
                <button className="ghost" onClick={async () => {
                  if (!window.confirm('Project legen?')) return
                  useEditorStore.getState().resetProject()
                  void refresh()
                }}>Legen</button>
              </div>
            </div>
          ) : (
            <div className="project-card project-card--empty">
              <div className="project-empty-icon">🎬</div>
              <div>
                <div className="project-empty-title">Nog geen project</div>
                <div className="project-empty-sub">Importeer meerdere video’s tegelijk — ze komen samen in één timeline. Of start met <b>Nieuw project</b>.</div>
              </div>
              <button className="primary" onClick={async () => { await importFiles(); onOpen() }}>Importeer nu</button>
            </div>
          )}
        </section>

        {/* Recent — nu gegroepeerd, niet per los project */}
        <section className="home-section">
          <div className="home-section-head">
            <h2>Recent</h2>
            <div className="home-section-actions">
              <button className="ghost small" onClick={() => void openRecent(recent.map((r) => r.path))} disabled={!recent.length} title="Open alle recente bestanden samen in één project">
                Alles in één project
              </button>
              {recent.length > 0 && (
                <button className="ghost small" onClick={async () => { await window.api.recentsClear(); void refresh() }}>
                  Wissen
                </button>
              )}
            </div>
          </div>
          {recent.length === 0 ? (
            <div className="home-empty">Nog geen recente media. Importeer video, foto of audio om te beginnen.</div>
          ) : (
            <div className="recent-grid recent-grid--light">
              {recent.map((r) => (
                <div key={r.path} className="recent-card recent-card--light" title={r.path}>
                  <div className="recent-thumb recent-thumb--light" style={{ backgroundImage: r.thumbnail ? `url(${r.thumbnail})` : `url(${mediaUrl(r.path)})` }} onClick={() => void openSingle(r.path)}>
                    {!r.thumbnail && <span className="recent-thumb-fallback">{r.type === 'audio' ? '♪' : '🎬'}</span>}
                    {opening === r.path && <div className="recent-opening">Opening…</div>}
                    <button className="recent-add" title="Voeg toe aan huidig project (ipv nieuw)" onClick={(e) => { e.stopPropagation(); void openRecent([r.path]) }}>+ Toevoegen</button>
                  </div>
                  <div className="recent-name recent-name--light" title={r.name}>{r.name}</div>
                </div>
              ))}
            </div>
          )}
          <div className="home-foot-hint">Tip: <b>“Alles in één project”</b> fixt je bug — meerdere video’s worden niet meer als losse projecten gezien.</div>
        </section>
      </div>
    </div>
  )
}
