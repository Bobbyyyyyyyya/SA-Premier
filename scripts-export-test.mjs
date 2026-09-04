import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ffmpeg = require('./node_modules/ffmpeg-static')
const { renderToFile } = require('./out-export-test.cjs')

const work = '/tmp/sa-export-test'
mkdirSync(work, { recursive: true })

function run(args) {
  execFileSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'inherit'] })
}

console.log('== generating test media ==')
run(['-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(work, 'A.mp4')])
run(['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(work, 'B.mp4')])
run(['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', '-c:a', 'aac', path.join(work, 'C.m4a')])

const a = path.join(work, 'A.mp4')
const b = path.join(work, 'B.mp4')
const c = path.join(work, 'C.m4a')

const effects = () => ({ brightness: 0, contrast: 0, saturation: 0, grayscale: 0, sepia: 0, hue: 0, blur: 0 })

const req = {
  project: {
    name: 'Test',
    width: 1920,
    height: 1080,
    fps: 30,
    tracks: [
      { id: 'v1', name: 'Video 1', kind: 'video', muted: false, hidden: false },
      { id: 'a1', name: 'Audio 1', kind: 'audio', muted: false, hidden: false }
    ],
    clips: [
      {
        id: 'c1', assetId: 'x1', assetPath: a, trackId: 'v1', start: 0, duration: 4, sourceStart: 0,
        volume: 1, effects: { ...effects(), saturation: 0.3, brightness: 0.1 },
        transitionIn: null, transitionOut: { type: 'crossfade', duration: 0.5 }, kind: 'video'
      },
      {
        id: 'c2', assetId: 'x2', assetPath: b, trackId: 'v1', start: 3.5, duration: 4, sourceStart: 0,
        volume: 1, effects: effects(),
        transitionIn: { type: 'crossfade', duration: 0.5 }, transitionOut: { type: 'fade', duration: 0.5 }, kind: 'video'
      },
      {
        id: 'c3', assetId: 'x3', assetPath: c, trackId: 'a1', start: 1, duration: 3, sourceStart: 0,
        volume: 0.8, effects: effects(), transitionIn: null, transitionOut: null, kind: 'audio'
      }
    ]
  },
  assets: [
    { id: 'x1', name: 'A.mp4', path: a, type: 'video', duration: 4, width: 640, height: 360, hasAudio: true },
    { id: 'x2', name: 'B.mp4', path: b, type: 'video', duration: 4, width: 640, height: 360, hasAudio: false },
    { id: 'x3', name: 'C.m4a', path: c, type: 'audio', duration: 3, hasAudio: true }
  ],
  outPath: path.join(work, 'out.mp4'),
  width: 1280,
  height: 720,
  fps: 30
}

console.log('== rendering ==')
const result = await renderToFile(req, (pct) => console.log('  progress:', pct + '%'))
console.log('== done, total:', result.total + 's')

const out = path.join(work, 'out.mp4')
console.log('output exists:', existsSync(out), 'size:', Math.round(statSync(out).size / 1024) + 'KB')

console.log('== probe output ==')
execFileSync(ffmpeg, ['-i', out], { stdio: ['ignore', 'inherit', 'inherit'] })
