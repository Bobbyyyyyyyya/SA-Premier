var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main/export.ts
var export_exports = {};
__export(export_exports, {
  cancelExport: () => cancelExport,
  renderToFile: () => renderToFile,
  startExport: () => startExport
});
module.exports = __toCommonJS(export_exports);
var import_fluent_ffmpeg = __toESM(require("fluent-ffmpeg"));
var import_ffmpeg_static = __toESM(require("ffmpeg-static"));
if (!import_ffmpeg_static.default) {
  throw new Error("ffmpeg-static binary not found");
}
import_fluent_ffmpeg.default.setFfmpegPath(import_ffmpeg_static.default);
var current = null;
var n = (v) => Number.isFinite(v) ? v.toFixed(4) : "0";
var IMAGE_INPUT = /\.(png|jpe?g|gif|webp|bmp)$/i;
function effectFilters(e) {
  const out = [];
  const eq = [];
  if (e.brightness) eq.push(`brightness=${n(e.brightness)}`);
  if (e.contrast) eq.push(`contrast=${n(1 + e.contrast)}`);
  if (e.saturation) eq.push(`saturation=${n(1 + e.saturation)}`);
  if (eq.length) out.push(`eq=${eq.join(":")}`);
  if (e.hue) out.push(`hue=h=${n(e.hue)}`);
  if (e.grayscale > 0) out.push(`hue=s=${n(1 - Math.min(1, e.grayscale))}`);
  if (e.sepia > 0) {
    const v = Math.min(1, e.sepia);
    out.push(
      `colorchannelmixer=rr=${n(1 - 0.607 * v)}:rg=${n(0.769 * v)}:rb=${n(0.189 * v)}:gr=${n(0.349 * v)}:gg=${n(1 - 0.314 * v)}:gb=${n(0.168 * v)}:br=${n(0.272 * v)}:bg=${n(0.534 * v)}:bb=${n(1 - 0.869 * v)}`
    );
  }
  if (e.blur > 0) out.push(`boxblur=luma_radius=${n(e.blur)}:luma_power=1:chroma_radius=${n(e.blur / 2)}:chroma_power=1`);
  return out;
}
function timemarkToSeconds(tm) {
  const m = tm.match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  return (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + +m[3];
}
function buildCommand(req) {
  const { outPath, width, height, fps } = req;
  const { tracks, clips } = req.project;
  const assets = new Map(req.assets.map((a) => [a.path, a]));
  const inputPaths = [];
  for (const c of clips) {
    if (!inputPaths.includes(c.assetPath)) inputPaths.push(c.assetPath);
  }
  const inIdx = (p) => inputPaths.indexOf(p);
  const total = clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  if (total <= 0) throw new Error("Timeline is empty - add some clips first");
  const graph = [];
  const trackSegs = /* @__PURE__ */ new Map();
  const audioLabels = [];
  for (const c of clips) {
    const asset = assets.get(c.assetPath);
    if (!asset) continue;
    const idx = inIdx(c.assetPath);
    if (c.kind === "video") {
      const lbl = "c" + c.id;
      const fx = [];
      fx.push(`trim=start=${n(c.sourceStart)}:end=${n(c.sourceStart + c.duration)}`);
      fx.push("setpts=PTS-STARTPTS");
      fx.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease`);
      fx.push(`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`);
      fx.push("setsar=1");
      fx.push(`fps=${fps}`);
      fx.push(...effectFilters(c.effects));
      fx.push("format=rgba");
      if (c.transitionIn) fx.push(`fade=t=in:st=0:d=${n(c.transitionIn.duration)}:alpha=1`);
      if (c.transitionOut) {
        fx.push(`fade=t=out:st=${n(c.duration - c.transitionOut.duration)}:d=${n(c.transitionOut.duration)}:alpha=1`);
      }
      graph.push(`[${idx}:v]${fx.join(",")}[${lbl}]`);
      const tl = "t" + c.id;
      graph.push(`[${lbl}]setpts=PTS+${n(c.start)}/TB[${tl}]`);
      const segs = trackSegs.get(c.trackId) ?? [];
      segs.push(tl);
      trackSegs.set(c.trackId, segs);
    }
    if (asset.hasAudio) {
      const al = "a" + c.id;
      graph.push(
        `[${idx}:a]atrim=start=${n(c.sourceStart)}:end=${n(c.sourceStart + c.duration)},asetpts=PTS-STARTPTS,volume=${n(Math.max(0, c.volume))},asetpts=PTS+${n(c.start)}/TB,aformat=sample_rates=48000:channel_layouts=stereo[${al}]`
      );
      audioLabels.push(`[${al}]`);
    }
  }
  const videoTracks = tracks.filter(
    (t) => t.kind === "video" && (trackSegs.get(t.id)?.length ?? 0) > 0
  );
  if (videoTracks.length) {
    graph.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${n(total)}[master]`);
    const perTrack = /* @__PURE__ */ new Map();
    for (const t of videoTracks) {
      const segs = trackSegs.get(t.id);
      if (segs.length === 1) {
        perTrack.set(t.id, segs[0]);
      } else {
        const bg = "bg" + t.id;
        graph.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${n(total)}[${bg}]`);
        let prev2 = `[${bg}]`;
        segs.forEach((s, i) => {
          const o = `o${t.id}_${i}`;
          graph.push(`${prev2}[${s}]overlay=format=auto:eof_action=pass[${o}]`);
          prev2 = `[${o}]`;
        });
        const vl = "vt" + t.id;
        graph.push(`${prev2}null[${vl}]`);
        perTrack.set(t.id, vl);
      }
    }
    let prev = "[master]";
    let k = 0;
    for (const t of videoTracks) {
      const cur = perTrack.get(t.id);
      if (k === videoTracks.length - 1) {
        graph.push(`${prev}[${cur}]overlay=format=auto:eof_action=pass[vout]`);
      } else {
        const m = `m${k}`;
        graph.push(`${prev}[${cur}]overlay=format=auto:eof_action=pass[${m}]`);
        prev = `[${m}]`;
      }
      k++;
    }
  } else {
    graph.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${n(total)}[vout]`);
  }
  let hasAudio = false;
  if (audioLabels.length) {
    hasAudio = true;
    if (audioLabels.length === 1) {
      graph.push(`${audioLabels[0]}anull[aout]`);
    } else {
      graph.push(
        `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0:dropout_transition=0[aout]`
      );
    }
  }
  const cmd = (0, import_fluent_ffmpeg.default)();
  for (const p of inputPaths) {
    cmd.input(p);
    if (IMAGE_INPUT.test(p)) cmd.loop();
  }
  cmd.complexFilter(graph);
  cmd.outputOptions([
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "medium",
    "-movflags",
    "+faststart"
  ]);
  if (hasAudio) cmd.outputOptions(["-c:a", "aac", "-b:a", "192k"]);
  cmd.output(outPath);
  cmd.map("[vout]");
  if (hasAudio) cmd.map("[aout]");
  return { cmd, total };
}
function renderToFile(req, onProgress, onLog) {
  return new Promise((resolve, reject) => {
    const { cmd, total } = buildCommand(req);
    let lastPct = -1;
    cmd.on("start", (cmdLine) => console.log("[export]", cmdLine));
    cmd.on("progress", (p) => {
      const sec = timemarkToSeconds(p.timemark || "");
      const pct = total > 0 ? Math.min(100, Math.round(sec / total * 100)) : 0;
      if (pct !== lastPct) {
        lastPct = pct;
        onProgress?.(pct);
      }
    });
    cmd.on("end", () => resolve({ total }));
    cmd.on("error", (err) => reject(err));
    cmd.on("stderr", (line) => {
      if (onLog && /error|invalid|no such|not found/i.test(line)) onLog(line);
    });
    cmd.run();
  });
}
function startExport(webContents, req) {
  const state = { cmd: null, cancelled: false };
  current = state;
  const runner = new Promise((resolve, reject) => {
    const { cmd } = buildCommand(req);
    state.cmd = cmd;
    let lastPct = -1;
    cmd.on("start", (cmdLine) => console.log("[export]", cmdLine));
    cmd.on("progress", (p) => {
      const sec = timemarkToSeconds(p.timemark || "");
      const pct = totalOf(req) > 0 ? Math.min(100, Math.round(sec / totalOf(req) * 100)) : 0;
      if (pct !== lastPct) {
        lastPct = pct;
        webContents.send("export-progress", { phase: "progress", percent: pct, outPath: req.outPath });
      }
    });
    cmd.on("end", () => resolve());
    cmd.on("error", (err) => reject(err));
    cmd.on("stderr", (line) => {
      if (/error|invalid|no such|not found/i.test(line)) {
        webContents.send("export-progress", { phase: "log", percent: 0, message: line, outPath: req.outPath });
      }
    });
    cmd.run();
  });
  void runner.then(() => {
    if (!state.cancelled) {
      webContents.send("export-progress", { phase: "done", percent: 100, outPath: req.outPath });
    }
  }).catch((err) => {
    if (!state.cancelled) {
      webContents.send("export-progress", { phase: "error", percent: 0, message: err.message, outPath: req.outPath });
    }
  }).finally(() => {
    current = null;
  });
  return { started: true, outPath: req.outPath };
}
function totalOf(req) {
  return req.project.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
}
function cancelExport() {
  if (current) {
    current.cancelled = true;
    try {
      current.cmd?.kill("SIGKILL");
    } catch {
    }
    current = null;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  cancelExport,
  renderToFile,
  startExport
});
