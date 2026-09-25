import { useEditorStore } from '../store'
import { basename } from './mediaUrl'
import { inspectMedia } from './inspect'

export async function checkMediaAccess(): Promise<void> {
  const assets = useEditorStore.getState().assets
  if (!assets.length || !window.api?.mediaAccessCheck) {
    useEditorStore.getState().setMediaIssues([])
    return
  }
  try {
    const issues = await window.api.mediaAccessCheck(assets.map((a) => a.path))
    useEditorStore.getState().setMediaIssues(issues)
  } catch {
    useEditorStore.getState().setMediaIssues([])
  }
}

export async function relinkMedia(): Promise<{ relinked: number; added: number }> {
  const paths = await window.api.importMedia()
  if (!paths.length) return { relinked: 0, added: 0 }
  const inspected = await inspectMedia(paths)
  let relinked = 0
  let added = 0
  for (const asset of inspected) {
    const s = useEditorStore.getState()
    const name = basename(asset.path).toLowerCase()
    const target = s.assets.find((a) => a.path === asset.path) ?? s.assets.find((a) => basename(a.path).toLowerCase() === name)
    if (target) {
      s.updateAsset(target.id, { ...asset, id: target.id })
      relinked++
    } else {
      s.addAssets([asset])
      added++
    }
  }
  await checkMediaAccess()
  return { relinked, added }
}
