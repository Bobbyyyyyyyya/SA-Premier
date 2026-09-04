import { useCallback, useEffect, useState } from 'react'
import type { RecentMediaItem } from '../../../shared/types'
import { importPaths, importFiles } from '../lib/inspect'
import { mediaUrl } from '../lib/mediaUrl'
import { useEditorStore } from '../store'

export default function HomeScreen({ onOpen }: { onOpen: () => void }): JSX.Element {
  const [recent, setRecent] = useState<RecentMediaItem[]>([])
  const [opening, setOpening] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setRecent(await window.api.recentsList())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openRecent = async (path: string): Promise<void> => {
    setOpening(path)
    await importPaths([path], { place: false })
    setOpening(null)
    onOpen()
  }

  return (
    <div className="home">
      <div className="home-top">
        <div className="home-brand">
          SA<span>Premier</span>
        </div>
        <div className="home-actions">
          <button className="primary" onClick={async () => {
            useEditorStore.getState().resetProject()
            onOpen()
          }}>
            New project
          </button>
          <button onClick={async () => {
            await importFiles()
            onOpen()
          }}>
            Import media
          </button>
        </div>
      </div>

      <div className="home-body">
        <h2>Recent media</h2>
        {recent.length === 0 && (
          <div className="empty-hint">
            No recent media yet.<br />
            Import a video, image or audio file to get started, or use the AI tools.
          </div>
        )}
        <div className="recent-grid">
          {recent.map((r) => (
            <div
              key={r.path}
              className="recent-card"
              onClick={() => openRecent(r.path)}
              title={r.path}
            >
              <div
                className="recent-thumb"
                style={{
                  backgroundImage: r.thumbnail ? `url(${r.thumbnail})` : `url(${mediaUrl(r.path)})`
                }}
              >
                {!r.thumbnail && (r.type === 'audio' ? 'AUDIO' : 'MEDIA')}
                {opening === r.path && <div className="recent-opening">Opening…</div>}
              </div>
              <div className="recent-name">{r.name}</div>
            </div>
          ))}
        </div>
        {recent.length > 0 && (
          <button
            className="ghost recent-clear"
            onClick={async () => {
              await window.api.recentsClear()
              void refresh()
            }}
          >
            Clear recent media
          </button>
        )}
      </div>
    </div>
  )
}
