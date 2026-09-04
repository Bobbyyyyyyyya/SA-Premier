import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ffmpeg = require('./node_modules/ffmpeg-static')
const { renderToFile } = require('./out-export-test.cjs')

const work = '/tmp/sa-fade-test'
mkdirSync(work, { recursive: true })
const b = path.join(work, 'B.mp4')
execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', b], { stdio: 'ignore' })

const effects = () => ({ brightness: 0, contrast: 0, saturation: 0, grayscale: 0, sepia: 0, hue: 0, blur: 0 })

const req = {
  project: {
    name: 't', width: 1920, height: 1080, fps: 30,
    tracks: [{ id: 'v1', name: 'V', kind: 'video', muted: false, hidden: false }],
    clips: [{
      id: 'c2', assetId: 'x2', assetPath: b, trackId: 'v1', start: 0, duration: 4, sourceStart: 0,
      volume: 1, effects: effects(), transitionIn: null, transitionOut: { type: 'fade', duration: 0.5 }, kind: 'video'
    }]
  },
  assets: [{ id: 'x2', name: 'B.mp4', path: b, type: 'video', duration: 4, width: 640, height: 360, hasAudio: false }],
  outPath: path.join(work, 'out.mp4'), width: 1280, height: 720, fps: 30
}

await renderToFile(req, (p) => {}, (line) => console.log('LOG:', line))
for (const [t, name] of [[3.6, 'fade1'], [3.9, 'fade2']]) {
  execFileSync(ffmpeg, ['-y', '-ss', String(t), '-i', path.join(work, 'out.mp4'), '-frames:v', '1', path.join(work, name + '.png')], { stdio: 'ignore' })
  execFileSync(ffmpeg, ['-i', path.join(work, name + '.png'), '-vf', 'scale=1:1,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', path.join(work, name + '.raw')], { stdio: 'ignore' })
  const d = require('node:fs').readFileSync(path.join(work, name + '.raw'))
  console.log(name, '@', t + 's', 'RGB:', d[0], d[1], d[2])
}
console.log('DONE')
