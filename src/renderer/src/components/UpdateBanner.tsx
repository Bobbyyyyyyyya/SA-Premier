import { useCallback, useEffect, useState } from 'react'
import type { AppInfo, UpdaterStatus } from '../../../shared/types'

/**
 * Banner voor de auto-updater.
 *
 * De main-process stuurt `updater-status`; hier beslissen we wat er getoond
 * wordt. Bewust geen modale dialoog: een update hoort bij de app, niet als
 * systeemvenster bovenop. `Later` verbergt 'm tot de volgende check.
 */
export default function UpdateBanner(): JSX.Element | null {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [status, setStatus] = useState<UpdaterStatus | null>(null)
  const [dismissed, setDismissed] = useState<string>('')
  const [flash, setFlash] = useState('')

  useEffect(() => {
    void window.api.appInfo().then(setInfo).catch(() => null)
    return window.api.onUpdaterStatus((p) => {
      setStatus(p)
      // een nieuwe versie of een fout mag een eerder weggeklikte banner weer tonen
      if (p.phase === 'available' || p.phase === 'error') setDismissed('')
    })
  }, [])

  // "Je hebt de nieuwste versie" alleen kort tonen na een handmatige check
  useEffect(() => {
    if (status?.phase !== 'not-available') return
    setFlash(status.message ?? `Je hebt de nieuwste versie (${status.version ?? info?.version ?? ''}).`)
    const t = setTimeout(() => setFlash(''), 4000)
    return () => clearTimeout(t)
  }, [status, info])

  // de versieknop in de toolbar stuurt dit event; het check-werk hoort hier,
  // anders zou de knop de status alleen lokaal bijhouden en niets tonen
  useEffect(() => {
    const h = (): void => {
      void check()
    }
    window.addEventListener('check-updates', h)
    return () => window.removeEventListener('check-updates', h)
  })

  const check = useCallback(async (): Promise<void> => {
    const r = await window.api.updaterCheck()
    if (r.skipped) {
      setStatus({ phase: 'error', message: 'Updates werken alleen in de gebouwde app (npm run dev heeft geen update-feed).' })
    }
  }, [])

  const download = useCallback((): void => {
    void window.api.updaterDownload()
  }, [])

  const install = useCallback((): void => {
    void window.api.updaterQuitInstall()
  }, [])

  const pct = status?.percent ?? 0
  const size = (n?: number): string => (n == null ? '' : `${(n / 1024 / 1024).toFixed(1)} MB`)
  const key = `${status?.phase ?? ''}-${status?.version ?? ''}-${status?.message ?? ''}`

  return (
    <>
      {status && !dismissed && (
        <div className={`update-banner ${status.phase}`} role="status">
          {status.phase === 'available' && (
            <>
              <span className="ub-ico">⬆</span>
              <span className="ub-text">
                <b>SA Premier {status.version}</b> is beschikbaar — je hebt nu {info?.version}.
              </span>
              <button className="primary" onClick={download} title="Update downloaden" data-tooltip="Update downloaden">
                Downloaden
              </button>
              <button className="ghost" onClick={() => setDismissed(key)} title="Later" data-tooltip="Later">
                Later
              </button>
            </>
          )}

          {status.phase === 'downloading' && (
            <>
              <span className="ub-spinner" />
              <span className="ub-text">
                Update {status.version} downloaden… <b>{pct}%</b>
                {status.total ? ` · ${size(status.transferred)} / ${size(status.total)}` : ''}
              </span>
            </>
          )}

          {status.phase === 'downloaded' && (
            <>
              <span className="ub-ico ok">✓</span>
              <span className="ub-text">
                <b>SA Premier {status.version}</b> staat klaar. Herstart om te installeren.
              </span>
              <button className="primary" onClick={install} title="Herstart en installeer" data-tooltip="Herstart en installeer">
                Herstart &amp; installeren
              </button>
              <button className="ghost" onClick={() => setDismissed(key)} title="Later" data-tooltip="Later">
                Later
              </button>
            </>
          )}

          {status.phase === 'error' && (
            <>
              <span className="ub-ico warn">!</span>
              <span className="ub-text">Update mislukt: {status.message}</span>
              <button className="ghost" onClick={() => setDismissed(key)} title="Sluiten" data-tooltip="Sluiten">
                OK
              </button>
            </>
          )}

          {status.phase === 'checking' && (
            <>
              <span className="ub-spinner" />
              <span className="ub-text">Controleren op updates…</span>
            </>
          )}
        </div>
      )}

      {flash && <div className="update-flash">{flash}</div>}
    </>
  )
}
