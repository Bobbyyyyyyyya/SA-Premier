import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ffmpeg = require('./node_modules/ffmpeg-static')
const { renderToFile } = require('./out-export-test.cjs')

const work = '/tmp/sa-fade2'
mkdirSync(work, { recursive: true })
const b = path.join(work, 'B.mp4')
execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', b], { stdio: 'ignore' })
const effects = () => ({ brightness: 0, contrast: 0, saturation: 0, grayscale: 0, sepia: 0, hue: 0, blur: 0 })

async function runTest(name, start, transitionOut) {
  const out = path.join(work, name + '.mp4')
  const req = {
    project: {
      name: 't', width: 1920, height: 1080, fps: 30,
      tracks: [{ id: 'v1', name: 'V', kind: 'video', muted: false, hidden: false }],
      clips: [{
        id: 'c', assetId: 'x', assetPath: b, trackId: 'v1', start, duration: 4, sourceStart: 0,
        volume: 1, effects: effects(), transitionIn: { type: 'crossfade', duration: 0.5 },
        transitionOut: transitionOut, kind: 'video'
      }]
    },
    assets: [{ id: 'x', name: 'B.mp4', path: b, type: 'video', duration: 4, width: 640, height: 360, hasAudio: false }],
    outPath: out, width: 1280, height: 720, fps: 30
  }
  await renderToFile(req, () => {})
  const sampleAt = start + 3.9
  execFileSync(ffmpeg, ['-y', '-i', out, '-ss', String(sampleAt), '-frames:v', '1', '-vf', 'scale=1:1,format=rgb24', '-f', 'rawvideo', '-pix_fmt', 'rgb24', path.join(work, name + '.raw')], { stdio: 'ignore' })
  const d = readFileSync(path.join(work, name + '.raw'))
  console.log(name, 'sample@' + sampleAt.toFixed(2), 'RGB:', d[0], d[1], d[2])
}

await runTest('inAndOut_noOffset', 0, { type: 'fade', duration: 0.5 })
await runTest('inAndOut_offset', 3.5, { type: 'fade', duration: 0.5 })
await runTest('inOnly_offset', 3.5, null)
await runTest('outOnly_offset', 3.5, { type: 'fade', duration: 0.5 })
console.log('DONE')
