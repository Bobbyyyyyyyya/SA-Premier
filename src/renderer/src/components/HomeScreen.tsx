import { useCallback, useEffect, useState } from 'react'
import { IconRobot, IconPalette, IconMusic, IconBox } from './icons'
import type { RecentProjectItem } from '../../../shared/types'
import { importFiles } from '../lib/inspect'
import { mediaUrl } from '../lib/mediaUrl'
import { openProjectFile, saveProjectFile } from '../lib/projectFile'
import { useEditorStore, selectTotal } from '../store'
import { formatTime } from '../lib/format'
import logo from '../assets/logo.svg'

function formatDate(ts: number): string {
  try {
    const d = new Date(ts)
    const today = new Date()
    const sameDay = d.toDateString() === today.toDateString()
    const yest = new Date(today)
    yest.setDate(yest.getDate() - 1)
    if (sameDay) return `vandaag ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    if (d.toDateString() === yest.toDateString()) return 'gisteren'
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

export default function HomeScreen({ onOpen }: { onOpen: () => void }): JSX.Element {
  const [recent, setRecent] = useState<RecentProjectItem[]>([])
  const [opening, setOpening] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const project = useEditorStore((s) => s.project)
  const assets = useEditorStore((s) => s.assets)
  const clips = useEditorStore((s) => s.clips)
  const total = useEditorStore(selectTotal)

  const refresh = useCallback(async () => {
    try {
      setRecent(await window.api.recentProjectsList())
    } catch {
      setRecent([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openCard = async (item: RecentProjectItem): Promise<void> => {
    setOpening(item.path)
    setOpenError(null)
    const r = await openProjectFile(item.path)
    setOpening(null)
    if (!r.ok) {
      if (r.missing) {
        // Bestand weg (verplaatst/verwijderd): uit de lijst, en zeg het erbij
        // in plaats van stil niets te doen.
        setOpenError(`“${item.name}” staat niet meer op ${item.path} — uit de lijst gehaald.`)
      } else if (!r.cancelled) {
        setOpenError(`“${item.name}” openen mislukt: ${r.error ?? 'onbekende fout'}`)
      }
      void refresh()
      return
    }
    onOpen()
  }

  const hasProject = clips.length > 0 || assets.length > 0

  return (
    <div className="home home--light">
      <div className="home-hero">
        <div className="home-hero-bg" />
        <div className="home-hero-inner">
          <div className="home-brand-block">
            <img className="home-logo" src={logo} alt="SA Premier" />
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
            /* De hele kaart opent de timeline — klikken op de kaart zelf moet
               werken, niet alleen op de knop ernaast. */
            <div
              className="project-card project-card--clickable"
              role="button"
              tabIndex={0}
              onClick={onOpen}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpen()
                }
              }}
              title="Open de timeline"
              data-tooltip="Open de timeline"
            >
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
                <button
                  onClick={async (e) => {
                    e.stopPropagation()
                    const r = await saveProjectFile()
                    if (!r.ok && !r.cancelled && r.error) window.alert(`Bewaren mislukt: ${r.error}`)
                    void refresh()
                  }}
                  title="Bewaar als projectbestand"
                  data-tooltip="Bewaar als projectbestand"
                >
                  Bewaar
                </button>
                <button
                  className="ghost"
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (!window.confirm('Project legen?')) return
                    useEditorStore.getState().resetProject()
                    void refresh()
                  }}
                  title="Legen"
                  data-tooltip="Legen"
                >
                  Legen
                </button>
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

        {/* Recent — uitsluitend bewaarde projecten, geen losse media meer */}
        <section className="home-section">
          <div className="home-section-head">
            <h2>Recent</h2>
            <div className="home-section-actions">
              {recent.length > 0 && (
                <button className="ghost small" onClick={async () => { await window.api.recentProjectsClear(); void refresh() }} title="Wissen" data-tooltip="Wissen">
                  Wissen
                </button>
              )}
            </div>
          </div>
          {openError && <div className="home-error" role="alert">{openError}</div>}
          {recent.length === 0 ? (
            <div className="home-empty">Nog geen bewaarde projecten. Open de timeline, monteer iets en kies <b>Bewaar</b> — dan staat het hier.</div>
          ) : (
            <div className="recent-grid recent-grid--light">
              {recent.map((p) => (
                <div key={p.path} className="recent-card recent-card--light" title={`${p.name}\n${p.path}`}>
                  <div
                    className="recent-thumb recent-thumb--light"
                    style={p.thumbnail ? { backgroundImage: `url(${p.thumbnail})` } : undefined}
                    onClick={() => void openCard(p)}
                  >
                    {!p.thumbnail && <span className="recent-thumb-fallback"><IconBox size={18} /></span>}
                    {opening === p.path && <div className="recent-opening">Opening…</div>}
                    <span className="recent-count">{p.clipCount} clips</span>
                  </div>
                  <div className="recent-name recent-name--light" title={p.name}>
                    {p.name}
                  </div>
                  <div className="recent-sub">
                    {[formatTime(p.duration, project.fps), formatDate(p.updatedAt)].filter(Boolean).join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
