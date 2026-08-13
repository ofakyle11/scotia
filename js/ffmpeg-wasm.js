/* SHOTBREAK — FFmpeg.wasm loader (custom blob worker, no @ffmpeg/ffmpeg CDN worker) */
window.SBFFmpeg = (function () {
  'use strict';

  let cached = null;

  function assertIsolated() {
    if (typeof self !== 'undefined' && !self.crossOriginIsolated) {
      throw new Error(
        'Browser is not cross-origin isolated. Hard-refresh (Ctrl+Shift+R) on shotbreak.io/timeline/ and try again.'
      );
    }
    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error('SharedArrayBuffer unavailable — FFmpeg needs HTTPS with COOP/COEP headers.');
    }
  }

  async function loadFFmpeg(onProgress) {
    if (cached && cached.loaded) return cached;
    assertIsolated();

    const CORE = '/static/ffmpeg/ffmpeg-core.js';
    const WASM = '/static/ffmpeg/ffmpeg-core.wasm';

    if (onProgress) onProgress('Loading FFmpeg core…');
    const [coreRes, wasmRes] = await Promise.all([fetch(CORE), fetch(WASM)]);
    if (!coreRes.ok || !wasmRes.ok) {
      throw new Error('Could not load /static/ffmpeg/ffmpeg-core (HTTP ' + coreRes.status + '/' + wasmRes.status + ')');
    }
    const coreJsText = await coreRes.text();
    const wasmBuf = await wasmRes.arrayBuffer();

    if (onProgress) onProgress('Starting FFmpeg worker…');

    const workerSource =
      coreJsText + '\n;\n' +
      'let __core = null;\n' +
      'self.addEventListener("message", async (e) => {\n' +
      '  const { id, cmd, data } = e.data || {};\n' +
      '  try {\n' +
      '    let result;\n' +
      '    switch (cmd) {\n' +
      '      case "load":\n' +
      '        if (typeof createFFmpegCore !== "function") throw new Error("createFFmpegCore missing");\n' +
      '        __core = await createFFmpegCore({\n' +
      '          wasmBinary: new Uint8Array(data.wasmBytes),\n' +
      '          print: (msg) => self.postMessage({ type: "log", message: String(msg) }),\n' +
      '          printErr: (msg) => self.postMessage({ type: "log", message: "[err] " + String(msg) }),\n' +
      '        });\n' +
      '        if (__core.setLogger) __core.setLogger((evt) => self.postMessage({ type: "log", message: (evt && evt.message) || String(evt) }));\n' +
      '        if (__core.setProgress) __core.setProgress((evt) => self.postMessage({ type: "progress", progress: (evt && evt.progress) || 0 }));\n' +
      '        result = { ok: true };\n' +
      '        break;\n' +
      '      case "writeFile":\n' +
      '        __core.FS.writeFile(data.name, data.bytes);\n' +
      '        result = true;\n' +
      '        break;\n' +
      '      case "readFile":\n' +
      '        result = __core.FS.readFile(data.name);\n' +
      '        break;\n' +
      '      case "deleteFile":\n' +
      '        try { __core.FS.unlink(data.name); } catch (_) {}\n' +
      '        result = true;\n' +
      '        break;\n' +
      '      case "exec":\n' +
      '        if (__core.setTimeout) __core.setTimeout(data.timeout != null ? data.timeout : -1);\n' +
      '        __core.exec(...data.args);\n' +
      '        result = (__core.ret != null) ? __core.ret : 0;\n' +
      '        if (__core.reset) __core.reset();\n' +
      '        break;\n' +
      '      default:\n' +
      '        throw new Error("unknown cmd: " + cmd);\n' +
      '    }\n' +
      '    self.postMessage({ id, ok: true, result });\n' +
      '  } catch (err) {\n' +
      '    self.postMessage({ id, ok: false, error: (err && err.message) || String(err) });\n' +
      '  }\n' +
      '});\n' +
      'self.postMessage({ type: "ready" });\n';

    const workerBlobURL = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    let worker;
    try {
      worker = await new Promise((resolve, reject) => {
        const w = new Worker(workerBlobURL);
        const timeout = setTimeout(() => {
          w.terminate();
          reject(new Error('FFmpeg worker startup timeout (30s)'));
        }, 30000);
        const fail = (msg) => {
          clearTimeout(timeout);
          w.terminate();
          reject(new Error(msg));
        };
        w.addEventListener('error', (ev) => fail('Worker error: ' + (ev.message || 'unknown')));
        w.addEventListener('message', (e) => {
          if (e.data && e.data.type === 'ready') {
            clearTimeout(timeout);
            resolve(w);
          }
        });
      });
    } catch (e) {
      URL.revokeObjectURL(workerBlobURL);
      throw e;
    }

    let nextId = 1;
    const pending = new Map();
    let onProgressCb = null;

    worker.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === 'progress' && onProgressCb) {
        onProgressCb('Rendering ' + Math.round((d.progress || 0) * 100) + '%');
        return;
      }
      if (d.id == null) return;
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      if (d.ok) p.resolve(d.result);
      else p.reject(new Error(d.error || 'FFmpeg worker error'));
    });

    function call(cmd, data, transfer) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, cmd, data }, transfer || []);
      });
    }

    await call('load', { wasmBytes: wasmBuf }, [wasmBuf]);

    cached = {
      loaded: true,
      setProgress(cb) { onProgressCb = cb; },
      writeFile(name, bytes) {
        const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        return call('writeFile', { name, bytes: data });
      },
      readFile(name) { return call('readFile', { name }); },
      deleteFile(name) { return call('deleteFile', { name }); },
      exec(args, timeout) { return call('exec', { args, timeout }); },
    };
    return cached;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  async function stitchBlobs(blobs, onProgress) {
    const segs = (blobs || []).map((b) => ({ blob: b, trimIn: 0, trimOut: null, transition: 'cut', transitionDur: 0 }));
    return stitchTimeline(segs, onProgress);
  }

  async function stitchTimeline(segments, onProgress) {
    if (!segments || !segments.length) throw new Error('No clips to stitch');

    const ff = await loadFFmpeg(onProgress);
    if (ff.setProgress) ff.setProgress(onProgress);

    const trimmed = [];
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const raw = 'raw' + i + '.mp4';
      const out = 'trim' + i + '.mp4';
      const buf = s.blob instanceof Blob ? new Uint8Array(await s.blob.arrayBuffer()) : new Uint8Array(s.blob);
      await ff.writeFile(raw, buf);
      const ti = s.trimIn || 0;
      const to = s.trimOut != null ? s.trimOut : null;
      const dur = to != null ? Math.max(0.1, to - ti) : null;
      if (onProgress) onProgress('Trimming clip ' + (i + 1) + '/' + segments.length);
      const args = ['-ss', String(ti), '-i', raw];
      if (dur != null) args.push('-t', String(dur));
      args.push(
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        out
      );
      await ff.exec(args);
      await ff.deleteFile(raw).catch(() => {});
      trimmed.push({
        name: out,
        dur: dur || 5,
        transition: s.transition || 'cut',
        transitionDur: s.transitionDur || 0,
      });
    }

    const outName = 'out.mp4';

    if (trimmed.length === 1) {
      const data = await ff.readFile(trimmed[0].name);
      await ff.deleteFile(trimmed[0].name).catch(() => {});
      return new Blob([data.buffer], { type: 'video/mp4' });
    }

    const needsXfade = trimmed.some((t, idx) =>
      idx < trimmed.length - 1 &&
      (t.transition === 'dissolve' || t.transition === 'fade') &&
      (t.transitionDur || 0) > 0.08
    );

    if (!needsXfade) {
      const list = trimmed.map((t) => "file '" + t.name + "'").join('\n');
      await ff.writeFile('concat.txt', new TextEncoder().encode(list));
      if (onProgress) onProgress('Stitching clips…');
      await ff.exec([
        '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outName,
      ]);
      await ff.deleteFile('concat.txt').catch(() => {});
    } else {
      if (onProgress) onProgress('Applying dissolves…');
      const args = [];
      trimmed.forEach((t) => args.push('-i', t.name));
      let filter = '';
      let lastV = '0:v';
      let lastA = '0:a';
      let offset = trimmed[0].dur;
      for (let i = 1; i < trimmed.length; i++) {
        const prev = trimmed[i - 1];
        const fade = (prev.transition === 'dissolve' || prev.transition === 'fade')
          ? clamp(prev.transitionDur || 0.4, 0.1, 1.2)
          : 0.08;
        const vTag = 'vx' + i;
        const aTag = 'ax' + i;
        offset -= fade;
        filter += '[' + lastV + '][' + i + ':v]xfade=transition=fade:duration=' + fade + ':offset=' + Math.max(0, offset).toFixed(3) + '[' + vTag + '];';
        filter += '[' + lastA + '][' + i + ':a]acrossfade=d=' + fade + '[' + aTag + '];';
        lastV = vTag;
        lastA = aTag;
        offset += trimmed[i].dur - fade;
      }
      args.push('-filter_complex', filter.replace(/;$/, ''));
      args.push('-map', '[' + lastV + ']', '-map', '[' + lastA + ']');
      args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outName);
      try {
        await ff.exec(args);
      } catch (e) {
        if (onProgress) onProgress('Dissolve failed — hard-cut fallback…');
        const list = trimmed.map((t) => "file '" + t.name + "'").join('\n');
        await ff.writeFile('concat.txt', new TextEncoder().encode(list));
        await ff.exec([
          '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
          '-c:a', 'aac', '-movflags', '+faststart',
          outName,
        ]);
        await ff.deleteFile('concat.txt').catch(() => {});
      }
    }

    const data = await ff.readFile(outName);
    for (const t of trimmed) await ff.deleteFile(t.name).catch(() => {});
    await ff.deleteFile(outName).catch(() => {});
    return new Blob([data.buffer], { type: 'video/mp4' });
  }

  return { loadFFmpeg, stitchBlobs, stitchTimeline };
})();