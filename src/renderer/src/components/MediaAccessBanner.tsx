import { useEffect, useState } from 'react'
import { useEditorStore } from '../store'
import { basename } from '../lib/mediaUrl'
import { checkMediaAccess, relinkMedia } from '../lib/relink'

export default function MediaAccessBanner(): JSX.Element | null {
  const issues = useEditorStore((s) => s.mediaIssues)
  const assetCount = useEditorStore((s) => s.assets.length)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState('')

  useEffect(() => {
    const id = window.setTimeout(() => {
      void checkMediaAccess()
    }, 400)
    return () => window.clearTimeout(id)
  }, [assetCount])

  if (!issues.length || dismissed === issues.map((i) => i.path).join('|')) return null

  const denied = issues.filter((i) => i.reason === 'denied')
  const missing = issues.filter((i) => i.reason === 'missing')
  const names = issues.slice(0, 3).map((i) => basename(i.path)).join(', ')
  const extra = issues.length > 3 ? ` +${issues.length - 3}` : ''

  const onRelink = async (): Promise<void> => {
    setBusy(true)
    try {
      await relinkMedia()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="media-access-banner">
      <div className="media-access-text">
        <b>{issues.length} mediabestand{issues.length === 1 ? '' : 'en'} niet leesbaar</b>
        <span>
          {denied.length > 0 && `${denied.length} geblokkeerd door macOS-toegang (bv. Downloads)`}
          {denied.length > 0 && missing.length > 0 && ' · '}
          {missing.length > 0 && `${missing.length} verplaatst/verdwenen`}
          {' — '}
          {names}
          {extra}
        </span>
      </div>
      <div className="media-access-actions">
        <button className="primary" onClick={() => void onRelink()} disabled={busy} title="Selecteer de bestanden opnieuw zodat de app ze mag lezen" data-tooltip="Bestanden opnieuw kiezen">
          {busy ? 'Bezig…' : 'Bestanden opnieuw kiezen'}
        </button>
        <button
          className="ghost"
          onClick={() => setDismissed(issues.map((i) => i.path).join('|'))}
          title="Melding verbergen"
          data-tooltip="Verbergen"
        >
          Verbergen
        </button>
      </div>
    </div>
  )
}
