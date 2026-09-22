import { useCallback, useEffect, useState } from 'react'
import { IconRobot, IconPalette, IconMusic, IconBox } from './icons'
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

  // Fix: groepeer recente imports die tegelijk gedaan zijn (binnen 3s) als één project
  const grouped = (() => {
    if (!recent.length) return [] as RecentMediaItem[][]
    const sorted = [...recent].sort((a, b) => b.addedAt - a.addedAt)
    const groups: RecentMediaItem[][] = []
    let cur: RecentMediaItem[] = [sorted[0]]
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const curItem = sorted[i]
      if (Math.abs(prev.addedAt - curItem.addedAt) < 3500) {
        cur.push(curItem)
      } else {
        groups.push(cur)
        cur = [curItem]
      }
    }
    groups.push(cur)
    return groups
  })()

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
            }} title="＋
              
                Nieuw project" data-tooltip="＋
              
                Nieuw project">
              <span className="cta-icon">＋</span>
              <span>
                <b>Nieuw project</b>
                <i>Lege timeline — jij bepaalt</i>
              </span>
            </button>
            <button className="home-cta" onClick={async () => {
              await importFiles()
              onOpen()
            }} title="⬆
              
                Media importeren" data-tooltip="⬆
              
                Media importeren">
              <span className="cta-icon">⬆</span>
              <span>
                <b>Media importeren</b>
                <i>Meerdere video’s = één project</i>
              </span>
            </button>
            <button className="home-cta ghost" onClick={() => window.dispatchEvent(new Event('open-ai-setup'))} title="AI-setup
                Licht / Volledig / Aangep" data-tooltip="AI-setup
                Licht / Volledig / Aangep">
              <span className="cta-icon"><IconRobot size={18} /></span>
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
                      {!a.thumbnail && (a.isImage ? <IconPalette size={12} /> : a.type === 'audio' ? <IconMusic size={12} /> : <IconBox size={12} />)}
                    </span>
                  ))}
                  {assets.length > 6 && <span className="project-more">+{assets.length - 6}</span>}
                </div>
              </div>
              <div className="project-actions">
                <button className="primary" onClick={onOpen} title="Open timeline →" data-tooltip="Open timeline →">Open timeline →</button>
                <button className="ghost" onClick={async () => {
                  if (!window.confirm('Project legen?')) return
                  useEditorStore.getState().resetProject()
                  void refresh()
                }} title="Legen" data-tooltip="Legen">Legen</button>
              </div>
            </div>
          ) : (
            <div className="project-card project-card--empty">
              <div className="project-empty-icon"><IconBox size={32} /></div>
              <div>
                <div className="project-empty-title">Nog geen project</div>
                <div className="project-empty-sub">Importeer meerdere video’s tegelijk — ze komen samen in één timeline. Of start met <b>Nieuw project</b>.</div>
              </div>
              <button className="primary" onClick={async () => { await importFiles(); onOpen() }} title="Importeer nu" data-tooltip="Importeer nu">Importeer nu</button>
            </div>
          )}
        </section>

        {/* Recent — nu gegroepeerd, niet per los project */}
        <section className="home-section">
          <div className="home-section-head">
            <h2>Recent</h2>
            <div className="home-section-actions">
              <button className="ghost small" onClick={() => void openRecent(recent.map((r) => r.path))} disabled={!recent.length} title="Open alle recente bestanden samen in één project" data-tooltip="Open alle recente bestanden samen in één project">
                Alles in één project
              </button>
              {recent.length > 0 && (
                <button className="ghost small" onClick={async () => { await window.api.recentsClear(); void refresh() }} title="Wissen" data-tooltip="Wissen">
                  Wissen
                </button>
              )}
            </div>
          </div>
          {grouped.length === 0 ? (
            <div className="home-empty">Nog geen recente media. Importeer video, foto of audio om te beginnen.</div>
          ) : (
            <div className="recent-grid recent-grid--light">
              {grouped.map((g) => {
                const key = g.map((x) => x.path).join('|')
                const isGroup = g.length > 1
                const first = g[0]
                const title = isGroup ? `${g.length} bestanden — ${g.map((x) => x.name).join(', ')}` : first.path
                const thumb = first.thumbnail ?? g.find((x) => x.thumbnail)?.thumbnail
                const openingAny = g.some((x) => opening === x.path)
                return (
                  <div key={key} className={`recent-card recent-card--light ${isGroup ? 'group' : ''}`} title={title}>
                    <div className="recent-thumb recent-thumb--light" style={{ backgroundImage: thumb ? `url(${thumb})` : g.length === 1 ? `url(${mediaUrl(first.path)})` : undefined, backgroundColor: isGroup ? '#f0edea' : undefined }} onClick={() => void openRecent(g.map((x) => x.path))}>
                      {!thumb && !isGroup && <span className="recent-thumb-fallback">{first.type === 'audio' ? <IconMusic size={18} /> : <IconBox size={18} />}</span>}
                      {isGroup && (
                        <div className="recent-group-stack">
                          {g.slice(0, 3).map((x, i) => (
                            <span key={x.path} className="recent-group-thumb" style={{ backgroundImage: x.thumbnail ? `url(${x.thumbnail})` : `url(${mediaUrl(x.path)})`, zIndex: 3 - i, left: `${i * 10}px`, top: `${i * 6}px` }} />
                          ))}
                          {g.length > 3 && <span className="recent-group-more">+{g.length - 3}</span>}
                        </div>
                      )}
                      {openingAny && <div className="recent-opening">Opening…</div>}
                      <span className="recent-count">{isGroup ? `${g.length} bestanden` : first.type === 'audio' ? 'Audio' : 'Video'}</span>
                    </div>
                    <div className="recent-name recent-name--light" title={isGroup ? g.map((x) => x.name).join(' + ') : first.name}>
                      {isGroup ? `${g.length} × project` : first.name}
                    </div>
                    {isGroup && <div className="recent-sub">{g.map((x) => x.name).join(' · ').slice(0, 42)}</div>}
                  </div>
                )
              })}
            </div>
          )}
          <div className="home-foot-hint">Tip: <b>“Alles in één project”</b> fixt je bug — meerdere video’s worden niet meer als losse projecten gezien.</div>
        </section>
      </div>
    </div>
  )
}
