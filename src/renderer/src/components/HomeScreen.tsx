import { useCallback, useEffect, useState } from 'react'
import { IconRobot, IconPalette, IconMusic, IconBox, IconCut, IconLock, IconSnap, IconCloud } from './icons'
import type { RecentProjectItem } from '../../../shared/types'
import { importFiles } from '../lib/inspect'
import { mediaUrl } from '../lib/mediaUrl'
import { openProjectFile, saveProjectFile } from '../lib/projectFile'
import { useEditorStore, selectTotal } from '../store'
import { formatTime } from '../lib/format'

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

const FEATURES = [
  { icon: IconCut, title: 'Precisie-snijden', desc: 'Frame-nauwkeurig knippen, trimmen en splitsen' },
  { icon: IconRobot, title: 'AI-gestuurd', desc: 'Ondertiteling, muziek en effecten — volledig offline' },
  { icon: IconSnap, title: 'Magnetische timeline', desc: 'Clips plakken, glijden en schuiven automatisch' },
  { icon: IconLock, title: '100% offline', desc: 'Geen cloud, geen accounts, geen data-verlies' },
  { icon: IconCloud, title: 'Snel & licht', desc: 'Native app — geen browser, geen wachtrijen' },
  { icon: IconPalette, title: 'Professionele kleur', desc: 'Kleurcorrectie en LUTs met directe preview' },
]

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
        setOpenError(`"${item.name}" staat niet meer op ${item.path} — uit de lijst gehaald.`)
      } else if (!r.cancelled) {
        setOpenError(`"${item.name}" openen mislukt: ${r.error ?? 'onbekende fout'}`)
      }
      void refresh()
      return
    }
    onOpen()
  }

  const hasProject = clips.length > 0 || assets.length > 0

  return (
    <div className="home">
      <div className="home-hero">
        <div className="home-hero-glow home-hero-glow--1" />
        <div className="home-hero-glow home-hero-glow--2" />
        <div className="home-hero-grid" />
        <div className="home-hero-inner">
          <div className="home-hero-left">
            <div className="home-brand-row">
              <svg className="home-logo" viewBox="0 0 512 512" aria-hidden="true">
                <defs>
                  <linearGradient id="hg-bg" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#241a15" />
                    <stop offset="1" stopColor="#100f0d" />
                  </linearGradient>
                  <linearGradient id="hg-accent" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#ffa14a" />
                    <stop offset="0.55" stopColor="#ff7f2a" />
                    <stop offset="1" stopColor="#e64d0f" />
                  </linearGradient>
                </defs>
                <rect x="16" y="16" width="480" height="480" rx="108" fill="url(#hg-bg)" />
                <rect x="16" y="16" width="480" height="480" rx="108" fill="none" stroke="url(#hg-accent)" strokeWidth="12" />
                <g fill="url(#hg-accent)">
                  <rect x="76" y="96" width="26" height="40" rx="9" />
                  <rect x="76" y="152" width="26" height="40" rx="9" />
                  <rect x="76" y="208" width="26" height="40" rx="9" />
                  <rect x="410" y="96" width="26" height="40" rx="9" />
                  <rect x="410" y="152" width="26" height="40" rx="9" />
                  <rect x="410" y="208" width="26" height="40" rx="9" />
                </g>
                <path d="M212 138 L212 330 L344 234 Z" fill="url(#hg-accent)" />
                <g fill="#ffffff" fillOpacity="0.92">
                  <rect x="140" y="362" width="232" height="22" rx="11" />
                </g>
                <g fill="#ffffff" fillOpacity="0.55">
                  <rect x="176" y="398" width="160" height="18" rx="9" />
                </g>
              </svg>
              <div>
                <div className="home-brand">SA<span>Premier</span></div>
              </div>
            </div>
          </div>
          <div className="home-hero-right">
            <button className="home-cta home-cta--primary" onClick={async () => {
              if (hasProject && !window.confirm('Nieuw project starten? Huidige timeline wordt geleegd (opgeslagen project blijft bewaard).')) return
              useEditorStore.getState().resetProject()
              onOpen()
            }}>
              <span className="home-cta-icon">＋</span>
              <span className="home-cta-text">
                <b>Nieuw project</b>
                <i>Lege timeline — jij bepaalt</i>
              </span>
            </button>
            <button className="home-cta" onClick={async () => {
              await importFiles()
              onOpen()
            }}>
              <span className="home-cta-icon">⬆</span>
              <span className="home-cta-text">
                <b>Media importeren</b>
                <i>Meerdere video's = één project</i>
              </span>
            </button>
            <button className="home-cta home-cta--ghost" onClick={() => window.dispatchEvent(new Event('open-ai-setup'))}>
              <span className="home-cta-icon"><IconRobot size={18} /></span>
              <span className="home-cta-text">
                <b>AI-setup</b>
                <i>Licht / Volledig / Aangepast</i>
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="home-body">
        <section className="home-section">
          <div className="home-section-head">
            <h2>Huidig project</h2>
            <span className="home-hint">Meerdere video's die je importeert komen in <b>één</b> project (één timeline), niet als losse projecten.</span>
          </div>
          {hasProject ? (
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
                <button className="primary" onClick={onOpen}>Open timeline →</button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation()
                    const r = await saveProjectFile()
                    if (!r.ok && !r.cancelled && r.error) window.alert(`Bewaren mislukt: ${r.error}`)
                    void refresh()
                  }}
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
                <div className="project-empty-sub">Importeer meerdere video's tegelijk — ze komen samen in één timeline. Of start met <b>Nieuw project</b>.</div>
              </div>
              <button className="primary" onClick={async () => { await importFiles(); onOpen() }}>Importeer nu</button>
            </div>
          )}
        </section>

        <section className="home-section">
          <div className="home-section-head">
            <h2>Recent</h2>
            <div className="home-section-actions">
              {recent.length > 0 && (
                <button className="ghost small" onClick={async () => { await window.api.recentProjectsClear(); void refresh() }}>
                  Wissen
                </button>
              )}
            </div>
          </div>
          {openError && <div className="home-error" role="alert">{openError}</div>}
          {recent.length === 0 ? (
            <div className="home-empty">
              <div className="home-empty-icon"><IconBox size={28} /></div>
              <div className="home-empty-text">Nog geen bewaarde projecten. Open de timeline, monteer iets en kies <b>Bewaar</b> — dan staat het hier.</div>
            </div>
          ) : (
            <div className="recent-grid">
              {recent.map((p) => (
                <div key={p.path} className="recent-card" title={`${p.name}\n${p.path}`}>
                  <div
                    className="recent-thumb"
                    style={p.thumbnail ? { backgroundImage: `url(${p.thumbnail})` } : undefined}
                    onClick={() => void openCard(p)}
                  >
                    {!p.thumbnail && <span className="recent-thumb-fallback"><IconBox size={18} /></span>}
                    {opening === p.path && <div className="recent-opening">Opening…</div>}
                    <span className="recent-count">{p.clipCount} clips</span>
                  </div>
                  <div className="recent-name" title={p.name}>
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

        <section className="home-section home-section--features">
          <div className="home-section-head">
            <h2>Waarom SA Premier</h2>
          </div>
          <div className="features-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="feature-card">
                <div className="feature-icon"><f.icon size={20} /></div>
                <div className="feature-title">{f.title}</div>
                <div className="feature-desc">{f.desc}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
