import { useEffect, useState } from 'react'

type Mode = 'ondemand' | 'full' | 'custom'

interface SetupState {
  mode: Mode
  comfy: boolean
  music: boolean
  ollama: boolean
  completed: boolean
  updatedAt: number
}

const ENGINE_INFO = [
  {
    key: 'comfy' as const,
    icon: '🎨',
    name: 'ComfyUI foto-modellen',
    desc: 'SD 1.5 / Realistic Vision voor AI-foto’s. ~2–7 GB per model.',
    size: '~4 GB'
  },
  {
    key: 'music' as const,
    icon: '🎵',
    name: 'MusicGen muziek-modellen',
    desc: 'Echte AI-muziek i.p.v. synth. Small 1,2 GB · Medium 3,5 GB · Large 6 GB.',
    size: '~3,5 GB'
  },
  {
    key: 'ollama' as const,
    icon: '💬',
    name: 'Ollama tekst-AI',
    desc: 'Titels, scripts en ideeën genereren. Model wordt bij eerste gebruik gepulled.',
    size: '~2–5 GB'
  }
]

export default function SetupWizard({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<Mode>('ondemand')
  const [flags, setFlags] = useState({ comfy: true, music: true, ollama: true })
  const [bundledCount, setBundledCount] = useState(0)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    Promise.all([window.api.aiSetupGet(), window.api.aiSetupSummary()])
      .then(([s, sum]) => {
        setMode((s.mode as Mode) ?? 'ondemand')
        setFlags({ comfy: s.comfy, music: s.music, ollama: s.ollama })
        setBundledCount(sum.bundled.checkpoints.length)
      })
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const pickMode = (m: Mode): void => {
    setMode(m)
    if (m === 'ondemand' || m === 'full') {
      setFlags({ comfy: true, music: true, ollama: true })
    }
  }

  const save = async (completed = true): Promise<void> => {
    setSaving(true)
    try {
      const payload: Partial<SetupState> =
        mode === 'custom'
          ? { mode, ...flags, completed }
          : { mode, comfy: true, music: true, ollama: true, completed }
      await window.api.aiSetupSet(payload)
      onClose()
      // laat AI-paneel verversen
      window.dispatchEvent(new CustomEvent('ai-setup-changed'))
    } finally {
      setSaving(false)
    }
  }

  const effFlags = mode === 'custom' ? flags : { comfy: true, music: true, ollama: true }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 560 }}>
        <h3>🤖 AI-setup — jouw keuze</h3>
        {loading ? (
          <div className="progress-note">Laden…</div>
        ) : (
          <>
            <div className="progress-note" style={{ marginBottom: 10 }}>
              Iedereen die SA Premier downloadt kiest zelf: <b>klein + later downloaden</b> of{' '}
              <b>alles meegeleverd</b>. Je kunt dit altijd later wijzigen in het AI-paneel.
              {bundledCount > 0 && (
                <span style={{ color: '#37b06f' }}> Deze installatie heeft {bundledCount} model(len) al meegeleverd ✓</span>
              )}
            </div>

            <div className="catalog-grid">
              <div
                className={`catalog-card ${mode === 'ondemand' ? 'installed' : ''}`}
                onClick={() => pickMode('ondemand')}
                style={{ cursor: 'pointer' }}
              >
                <div className="catalog-badge">Aanbevolen · ~150 MB download</div>
                <div className="catalog-name">☁️ Licht — download bij gebruik</div>
                <div className="catalog-desc">
                  Kleine app-download. AI-engines starten automatisch; modellen worden pas gedownload als je ze
                  echt gebruikt (ComfyUI, MusicGen, Ollama). Beste voor de meeste users.
                </div>
              </div>
              <div
                className={`catalog-card ${mode === 'full' ? 'installed' : ''}`}
                onClick={() => pickMode('full')}
                style={{ cursor: 'pointer' }}
              >
                <div className="catalog-badge">Offline · ~8–15 GB download</div>
                <div className="catalog-name">📦 Volledig — alles in de app</div>
                <div className="catalog-desc">
                  Grote download (Full-installer), daarna alles offline: modellen zitten in de app
                  onder <code>resources/models</code>. Geen wachttijd bij eerste gebruik. Ideaal voor studio’s /
                  slechte wifi.
                </div>
              </div>
              <div
                className={`catalog-card ${mode === 'custom' ? 'installed' : ''}`}
                onClick={() => pickMode('custom')}
                style={{ cursor: 'pointer' }}
              >
                <div className="catalog-badge">Zelf kiezen</div>
                <div className="catalog-name">🛠️ Aangepast</div>
                <div className="catalog-desc">Kies per engine wat je wilt. Alleen foto-AI? Alleen muziek? Of helemaal geen AI.</div>
              </div>
            </div>

            {mode === 'custom' && (
              <div style={{ marginTop: 10 }}>
                {ENGINE_INFO.map((e) => (
                  <div key={e.key} className="model-row">
                    <span style={{ fontSize: 18 }}>{e.icon}</span>
                    <div className="model-info">
                      <div className="model-name">{e.name} <span className="catalog-size">{e.size}</span></div>
                      <div className="model-size">{e.desc}</div>
                    </div>
                    <button
                      className={effFlags[e.key] ? 'primary' : ''}
                      onClick={() => setFlags((f) => ({ ...f, [e.key]: !f[e.key] }))}
                    >
                      {effFlags[e.key] ? 'Aan ✓' : 'Uit'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="ai-hint" style={{ marginTop: 10 }}>
              {mode === 'ondemand' && '→ Kleine installer (Lite). Modellen komen bij eerste gebruik, met voortgangsbalk.'}
              {mode === 'full' && '→ Grote installer (Full). Beheerder: zet modellen in resources/models/checkpoints voor het bouwen.'}
              {mode === 'custom' && (
                <>→ {Object.values(effFlags).filter(Boolean).length} van 3 engines aan. Uitgeschakelde engines starten niet automatisch op.</>
              )}
            </div>

            <div className="modal-actions">
              <div className="spacer" />
              <button onClick={onClose} disabled={saving}>Later</button>
              <button className="primary" onClick={() => save(true)} disabled={saving}>
                {saving ? 'Opslaan…' : 'Opslaan & doorgaan'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
