import { useEffect, useState } from 'react'
import Toolbar from './components/Toolbar'
import MediaPanel from './components/MediaPanel'
import PreviewPlayer from './components/PreviewPlayer'
import Inspector from './components/Inspector'
import Timeline from './components/Timeline'
import ExportDialog from './components/ExportDialog'
import HomeScreen from './components/HomeScreen'
import { useEditorStore } from './store'
import { importPaths } from './lib/inspect'

export default function App(): JSX.Element {
  const [view, setView] = useState<'home' | 'editor'>('home')
  const [exportOpen, setExportOpen] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent): boolean =>
      e.dataTransfer ? Array.from(e.dataTransfer.types).includes('Files') : false

    const onDragEnter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth += 1
      setDragging(true)
    }
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      if (!hasFiles(e)) return
      const target = e.target as HTMLElement | null
      if (target && target.closest('.tl-row')) return
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (!files.length) return
      const paths = files.map((f) => window.api.getPathForFile(f)).filter(Boolean)
      if (paths.length) {
        void importPaths(paths)
        setView('editor')
      }
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const s = useEditorStore.getState()

      if (e.code === 'Space') {
        e.preventDefault()
        s.setPlaying(!s.playing)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedClipId) s.removeClip(s.selectedClipId)
      } else if (e.key === 'ArrowLeft') {
        if (e.shiftKey && s.selectedClipId) {
          const c = s.clips.find((x) => x.id === s.selectedClipId)
          if (c) s.updateClip(c.id, { start: Math.max(0, c.start - 0.1) })
        } else {
          e.preventDefault()
          s.seekTo(s.playhead - 1)
        }
      } else if (e.key === 'ArrowRight') {
        if (e.shiftKey && s.selectedClipId) {
          const c = s.clips.find((x) => x.id === s.selectedClipId)
          if (c) s.updateClip(c.id, { start: c.start + 0.1 })
        } else {
          e.preventDefault()
          s.seekTo(s.playhead + 1)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (view === 'home') {
    return (
      <div className="app">
        <HomeScreen
          onOpen={() => {
            useEditorStore.setState({ playing: false })
            setView('editor')
          }}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <Toolbar onExport={() => setExportOpen(true)} onHome={() => setView('home')} />
      <div className="main">
        <MediaPanel />
        <PreviewPlayer />
        <Inspector />
      </div>
      <Timeline />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      {dragging && <div className="drop-overlay">Drop to import media</div>}
    </div>
  )
}
