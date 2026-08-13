/* SHOTBREAK Timeline Editor Engine — standalone / embedded mount */
window.SBTimelineEditor = (function () {
  'use strict';

  const PX_PER_SEC = 48;

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }
  function uid() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function probeDuration(src) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      const done = (n) => { v.src = ''; resolve(n || 5); };
      v.onloadedmetadata = () => done(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 5);
      v.onerror = () => done(5);
      setTimeout(() => done(5), 8000);
      v.src = src;
    });
  }

  function normalizeBinItem(item) {
    const src = item.src || item.videoUrl || item.url || '';
    return {
      id: item.id || uid(),
      name: item.name || item.label || ('Clip ' + (item.num || '')).trim() || 'Clip',
      src: src,
      duration: Number(item.duration) > 0 ? Number(item.duration) : 5,
      thumb: item.thumb || null,
      source: item.source || 'import',
    };
  }

  function createEditor(options) {
    options = options || {};
    const prefix = options.prefix || '';
    const storageKey = options.storageKey || 'SB_Editor_v1';
    const embedded = !!options.embedded;
    const $ = function (id) { return document.getElementById(prefix + id); };

    let state = {
      projectName: options.projectName || 'Untitled Project',
      bin: [],
      timeline: [],
      selectedId: null,
      playhead: 0,
      zoom: 1,
      playing: false,
    };
    let playTimer = null;
    let fileInput = null;

    function agentLog(msg, kind) {
      const el = $('agentLog');
      if (!el) return;
      const line = document.createElement('div');
      line.className = 'line ' + (kind || 'info');
      line.textContent = msg;
      el.appendChild(line);
      while (el.childNodes.length > 40) el.removeChild(el.firstChild);
      el.scrollTop = el.scrollHeight;
    }

    function save() {
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          projectName: state.projectName,
          bin: state.bin,
          timeline: state.timeline,
          savedAt: Date.now(),
        }));
      } catch (e) { agentLog('Save failed: ' + e.message, 'err'); }
    }

    function loadSaved() {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const d = JSON.parse(raw);
        if (d.projectName) state.projectName = d.projectName;
        if (Array.isArray(d.bin)) state.bin = d.bin;
        if (Array.isArray(d.timeline)) state.timeline = d.timeline;
      } catch (e) { /* ignore */ }
    }

    async function addToBin(item, skipSave) {
      const b = normalizeBinItem(item);
      if (!b.src) return null;
      if (!b.duration || b.duration === 5) b.duration = await probeDuration(b.src);
      const exists = state.bin.some((x) => x.src === b.src);
      if (!exists) state.bin.push(b);
      if (!skipSave) { save(); renderBin(); }
      return b;
    }

    function binById(id) { return state.bin.find((b) => b.id === id); }

    function clipDuration(tlClip) {
      const b = binById(tlClip.binId);
      if (!b) return 0;
      const out = tlClip.trimOut != null ? tlClip.trimOut : b.duration;
      const inn = tlClip.trimIn || 0;
      return Math.max(0.1, out - inn);
    }

    function totalDuration() {
      return state.timeline.reduce((a, c) => a + clipDuration(c), 0);
    }

    function formatTc(sec) {
      const s = Math.max(0, sec || 0);
      const m = Math.floor(s / 60);
      const r = s - m * 60;
      return String(m).padStart(2, '0') + ':' + r.toFixed(2).padStart(5, '0');
    }

    function renderBin() {
      const el = $('binItems');
      if (!el) return;
      if (!state.bin.length) {
        el.innerHTML = '<div class="tle-empty">No media — click <strong>Sync clips</strong> or <strong>Upload MP4</strong>.</div>';
        return;
      }
      el.innerHTML = state.bin.map((b) => {
        const thumb = b.src
          ? '<video class="thumb" src="' + esc(b.src) + '" muted preload="metadata"></video>'
          : '<div class="thumb"></div>';
        return '<div class="bin-item" data-id="' + esc(b.id) + '" draggable="true">' +
          thumb +
          '<div class="meta"><div class="name">' + esc(b.name) + '</div><div class="dur">' + b.duration.toFixed(1) + 's</div></div></div>';
      }).join('');

      el.querySelectorAll('.bin-item').forEach((node) => {
        const id = node.getAttribute('data-id');
        node.addEventListener('click', () => addToTimeline(id));
        node.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/sb-bin-id', id);
          e.dataTransfer.effectAllowed = 'copy';
        });
      });
    }

    function addToTimeline(binId) {
      const b = binById(binId);
      if (!b) return;
      state.timeline.push({ id: uid(), binId: b.id, trimIn: 0, trimOut: null, transition: 'cut' });
      save();
      renderTimeline();
      renderInspector();
      agentLog('Added "' + b.name + '"', 'ok');
    }

    function renderTimeline() {
      const lane = $('videoLane');
      const ruler = $('ruler');
      if (!lane || !ruler) return;

      const z = state.zoom || 1;
      const total = Math.max(totalDuration(), 8);
      const width = total * PX_PER_SEC * z;
      lane.style.minWidth = width + 'px';
      ruler.innerHTML = '<div class="ruler-inner" style="width:' + width + 'px;position:relative;height:100%"></div>';
      const inner = ruler.querySelector('.ruler-inner');
      const step = z >= 2 ? 1 : 2;
      let ticks = '';
      for (let t = 0; t <= total; t += step) {
        const x = t * PX_PER_SEC * z;
        ticks += '<div class="ruler-tick" style="left:' + x + 'px"></div>' +
          '<div class="ruler-label" style="left:' + x + 'px">' + formatTc(t) + '</div>';
      }
      inner.innerHTML = ticks;

      let offset = 0;
      lane.innerHTML = '';
      state.timeline.forEach((tl) => {
        const b = binById(tl.binId);
        if (!b) return;
        const dur = clipDuration(tl);
        const w = dur * PX_PER_SEC * z;
        const left = offset * PX_PER_SEC * z;
        const div = document.createElement('div');
        div.className = 'clip' + (tl.id === state.selectedId ? ' selected' : '');
        div.style.left = left + 'px';
        div.style.width = w + 'px';
        div.dataset.id = tl.id;
        div.innerHTML =
          (b.src ? '<video class="clip-thumb" src="' + esc(b.src) + '" muted preload="metadata"></video>' : '') +
          '<div class="clip-name">' + esc(b.name) + '</div>' +
          '<div class="clip-dur">' + dur.toFixed(1) + 's</div>';
        div.addEventListener('click', (e) => {
          e.stopPropagation();
          state.selectedId = tl.id;
          renderTimeline();
          renderInspector();
          seekToOffset(offset);
        });
        lane.appendChild(div);
        offset += dur;
      });

      let ph = lane.querySelector('.playhead');
      if (!ph) {
        ph = document.createElement('div');
        ph.className = 'playhead';
        lane.appendChild(ph);
      }
      ph.style.left = (state.playhead * PX_PER_SEC * z) + 'px';

      const tc = $('timecode');
      const tt = $('totalTime');
      if (tc) tc.textContent = formatTc(state.playhead);
      if (tt) tt.textContent = '/ ' + formatTc(total);
      updatePreview();
    }

    function renderInspector() {
      const el = $('inspectorContent');
      if (!el) return;
      const tl = state.timeline.find((c) => c.id === state.selectedId);
      if (!tl) {
        el.className = 'inspector-empty';
        el.textContent = 'Select a clip on the edit track';
        return;
      }
      const b = binById(tl.binId);
      el.className = '';
      el.innerHTML =
        '<div class="field"><label>Name</label><input value="' + esc(b && b.name) + '" readonly></div>' +
        '<div class="field-row">' +
        '<div class="field"><label>Trim in</label><input type="number" step="0.1" min="0" id="' + prefix + 'inTrim" value="' + (tl.trimIn || 0) + '"></div>' +
        '<div class="field"><label>Trim out</label><input type="number" step="0.1" id="' + prefix + 'outTrim" value="' + (tl.trimOut != null ? tl.trimOut : '') + '"></div>' +
        '</div>' +
        '<div class="field"><label>Transition</label><select id="' + prefix + 'transSel">' +
        ['cut', 'dissolve', 'fade'].map((t) => '<option value="' + t + '"' + (tl.transition === t ? ' selected' : '') + '>' + t + '</option>').join('') +
        '</select></div>';

      document.getElementById(prefix + 'inTrim').onchange = (e) => {
        tl.trimIn = Math.max(0, parseFloat(e.target.value) || 0);
        save(); renderTimeline();
      };
      document.getElementById(prefix + 'outTrim').onchange = (e) => {
        const v = e.target.value.trim();
        tl.trimOut = v === '' ? null : Math.max(0.1, parseFloat(v) || 0);
        save(); renderTimeline();
      };
      document.getElementById(prefix + 'transSel').onchange = (e) => {
        tl.transition = e.target.value;
        save();
      };
    }

    function seekToOffset(sec) {
      state.playhead = Math.max(0, Math.min(sec, totalDuration()));
      renderTimeline();
    }

    function updatePreview() {
      const ph = $('previewA');
      const placeholder = $('previewPlaceholder');
      if (!ph) return;
      let offset = 0;
      let found = null;
      let local = 0;
      for (const tl of state.timeline) {
        const dur = clipDuration(tl);
        if (state.playhead >= offset && state.playhead < offset + dur) {
          found = tl;
          local = state.playhead - offset + (tl.trimIn || 0);
          break;
        }
        offset += dur;
      }
      if (!found) {
        ph.removeAttribute('src');
        ph.style.opacity = '0';
        if (placeholder) placeholder.style.display = '';
        return;
      }
      const b = binById(found.binId);
      if (!b || !b.src) return;
      if (placeholder) placeholder.style.display = 'none';
      ph.style.opacity = '1';
      if (ph.src !== b.src) ph.src = b.src;
      const target = Math.max(0, local);
      if (Math.abs((ph.currentTime || 0) - target) > 0.15) {
        try { ph.currentTime = target; } catch (e) { /* ignore */ }
      }
    }

    function stopPlay() {
      state.playing = false;
      if (playTimer) { clearInterval(playTimer); playTimer = null; }
      const ph = $('previewA');
      if (ph) ph.pause();
      const btn = $('playBtn');
      if (btn) btn.textContent = '▶';
    }

    function startPlay() {
      if (!state.timeline.length) return;
      state.playing = true;
      const btn = $('playBtn');
      if (btn) btn.textContent = '⏸';
      const ph = $('previewA');
      if (ph) ph.play().catch(() => {});
      const t0 = performance.now();
      const startPh = state.playhead;
      playTimer = setInterval(() => {
        state.playhead = startPh + (performance.now() - t0) / 1000;
        if (state.playhead >= totalDuration()) {
          state.playhead = totalDuration();
          stopPlay();
        }
        renderTimeline();
      }, 50);
    }

    function ensureFileInput() {
      if (fileInput) return fileInput;
      fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov';
      fileInput.multiple = true;
      fileInput.style.display = 'none';
      fileInput.addEventListener('change', async () => {
        const files = fileInput.files;
        if (!files || !files.length) return;
        let added = 0;
        for (const f of files) {
          if (!f.type.startsWith('video/') && !/\.(mp4|webm|mov)$/i.test(f.name)) continue;
          await addToBin({ id: uid(), name: f.name.replace(/\.[^.]+$/, ''), src: URL.createObjectURL(f), duration: 5, source: 'upload' });
          added++;
        }
        fileInput.value = '';
        renderBin();
        save();
        agentLog(added ? 'Uploaded ' + added + ' file(s)' : 'No valid video files', added ? 'ok' : 'err');
      });
      document.body.appendChild(fileInput);
      return fileInput;
    }

    function importFromStorage() {
      let n = 0;
      try {
        const exportRaw = localStorage.getItem('SB_Timeline_Export');
        if (exportRaw) {
          const items = JSON.parse(exportRaw);
          if (Array.isArray(items) && items.length) {
            items.forEach((item, i) => {
              const b = normalizeBinItem({
                id: item.id || uid(),
                name: item.name || ('Clip ' + (i + 1)),
                src: item.src,
                duration: item.duration || 5,
                source: 'timeline-export',
              });
              if (!b.src) return;
              state.bin.push(b);
              state.timeline.push({ id: uid(), binId: b.id, trimIn: 0, trimOut: null, transition: item.transition || 'cut' });
              n++;
            });
            localStorage.removeItem('SB_Timeline_Export');
          }
        }
      } catch (e) { /* ignore */ }
      return n;
    }

    async function syncFromClips(clips, opts) {
      opts = opts || {};
      const list = (clips || []).filter((c) => c && (c.videoUrl || c.src)).slice()
        .sort((a, b) => (a.num || 0) - (b.num || 0));
      state.bin = [];
      state.timeline = [];
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const durFn = opts.clipDuration;
        const dur = durFn ? durFn(c) : (c.duration || c.durationSec || 5);
        const b = await addToBin({
          id: c.id || uid(),
          name: c.name || ('Clip ' + (c.num || (i + 1))),
          src: c.videoUrl || c.src,
          duration: dur,
          source: c.status === 'approved' ? 'approved' : 'clip',
        }, true);
        if (b && opts.rebuildTimeline !== false) {
          state.timeline.push({
            id: uid(),
            binId: b.id,
            trimIn: (c.edit && c.edit.trimIn) || 0,
            trimOut: (c.edit && c.edit.trimOut != null) ? c.edit.trimOut : null,
            transition: (c.edit && c.edit.transition) || 'cut',
          });
        }
      }
      save();
      renderBin();
      renderTimeline();
      agentLog('Synced ' + list.length + ' clip(s) from timeline', 'ok');
      return list.length;
    }

    function exportEdl() {
      const lines = ['TITLE: ' + state.projectName, 'FCM: NON-DROP FRAME'];
      let offset = 0;
      state.timeline.forEach((tl) => {
        const b = binById(tl.binId);
        if (!b) return;
        const dur = clipDuration(tl);
        lines.push('* FROM CLIP NAME: ' + b.name);
        lines.push('* SOURCE FILE: ' + b.src);
        offset += dur;
      });
      const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (state.projectName || 'shotbreak').replace(/\s+/g, '_') + '.edl';
      a.click();
      agentLog('EDL exported', 'ok');
    }

    async function renderExport() {
      if (!state.timeline.length) { agentLog('Add clips to the edit track first', 'err'); return; }
      if (!window.SBFFmpeg) {
        agentLog('FFmpeg module not loaded — hard refresh the page', 'err');
        return;
      }
      agentLog('Rendering…', 'info');
      const segments = [];
      for (let i = 0; i < state.timeline.length; i++) {
        const tl = state.timeline[i];
        const b = binById(tl.binId);
        if (!b || !b.src) continue;
        try {
          const r = await fetch(b.src);
          if (!r.ok) throw new Error('fetch failed');
          const trimOut = tl.trimOut != null ? tl.trimOut : b.duration;
          segments.push({
            blob: await r.blob(),
            trimIn: tl.trimIn || 0,
            trimOut: trimOut,
            transition: tl.transition || 'cut',
            transitionDur: tl.transitionDur != null ? tl.transitionDur : ((tl.transition === 'dissolve' || tl.transition === 'fade') ? 0.4 : 0),
          });
        } catch (e) {
          agentLog('Could not fetch ' + b.name + ' (CORS or network)', 'err');
          return;
        }
      }
      try {
        const out = await window.SBFFmpeg.stitchTimeline(segments, (msg) => agentLog(msg, 'info'));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(out);
        a.download = (state.projectName || 'shotbreak_edit').replace(/\s+/g, '_') + '.mp4';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        agentLog('Render complete', 'ok');
      } catch (e) {
        agentLog('Render failed: ' + e.message, 'err');
      }
    }

    async function applyProCut(edl) {
      if (!edl || !Array.isArray(edl.clips) || !edl.clips.length) {
        agentLog('Pro Cut EDL empty', 'err');
        return 0;
      }
      state.bin = [];
      state.timeline = [];
      for (let i = 0; i < edl.clips.length; i++) {
        const e = edl.clips[i];
        const b = await addToBin({
          id: e.id || uid(),
          name: e.name || ('Clip ' + (e.num || (i + 1))),
          src: e.src,
          duration: e.trimOut != null ? e.trimOut : 5,
          source: 'pro-cut',
        }, true);
        if (!b) continue;
        state.timeline.push({
          id: uid(),
          binId: b.id,
          trimIn: e.trimIn || 0,
          trimOut: e.trimOut != null ? e.trimOut : null,
          transition: e.transition || 'cut',
          transitionDur: e.transitionDur || 0,
        });
      }
      save();
      renderBin();
      renderTimeline();
      renderInspector();
      agentLog('Pro Cut applied — ' + edl.clips.length + ' clip(s)', 'ok');
      return edl.clips.length;
    }

    function wireDropTargets() {
      const lane = $('videoLane');
      if (!lane) return;
      lane.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
      lane.addEventListener('drop', (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/sb-bin-id');
        if (id) addToTimeline(id);
      });
    }

    function wireControls(extra) {
      extra = extra || {};
      const play = $('playBtn');
      if (play) play.onclick = () => { state.playing ? stopPlay() : startPlay(); };
      const zoom = $('zoom');
      if (zoom) zoom.oninput = (e) => { state.zoom = parseFloat(e.target.value) || 1; renderTimeline(); };
      const ruler = $('ruler');
      if (ruler) ruler.onclick = (ev) => {
        const rect = ruler.getBoundingClientRect();
        const x = ev.clientX - rect.left + (ruler.scrollLeft || 0);
        stopPlay();
        seekToOffset(x / (PX_PER_SEC * (state.zoom || 1)));
      };
      if ($('btnSync')) $('btnSync').onclick = () => { if (extra.onSync) extra.onSync(); };
      if ($('btnProCut')) $('btnProCut').onclick = () => { if (extra.onProCut) extra.onProCut(); };
      if ($('btnUpload')) $('btnUpload').onclick = () => ensureFileInput().click();
      if ($('btnRender')) $('btnRender').onclick = () => renderExport();
      if ($('btnEdl')) $('btnEdl').onclick = () => exportEdl();
      if ($('btn-save')) $('btn-save').onclick = () => { save(); agentLog('Saved', 'ok'); };
      if ($('btn-export')) $('btn-export').onclick = () => exportEdl();
      if ($('btn-render')) $('btn-render').onclick = () => renderExport();
      const pn = $('project-name');
      if (pn) {
        pn.value = state.projectName;
        pn.oninput = (e) => { state.projectName = e.target.value; save(); };
      }
    }

    async function init(extra) {
      loadSaved();
      wireDropTargets();
      wireControls(extra);
      if (!embedded) importFromStorage();
      await Promise.all(state.bin.map(async (b) => {
        if (!b.duration || b.duration <= 5) b.duration = await probeDuration(b.src);
      }));
      renderBin();
      renderTimeline();
      renderInspector();
    }

    return {
      init: init,
      syncFromClips: syncFromClips,
      applyProCut: applyProCut,
      upload: () => ensureFileInput().click(),
      renderExport: renderExport,
      exportEdl: exportEdl,
      refresh: async function () {
        importFromStorage();
        renderBin();
        renderTimeline();
      },
      getState: function () { return state; },
    };
  }

  function initStandalone() {
    if (!document.getElementById('binItems')) return null;
    const inst = createEditor({ prefix: '', storageKey: 'SB_Editor_v1', embedded: false });
    window.uploadMedia = () => inst.upload();
    window.refreshGenerated = () => inst.refresh();
    window.togglePlay = function () {
      const btn = document.getElementById('playBtn');
      if (btn && btn.textContent === '⏸') btn.click();
      else document.getElementById('playBtn') && document.getElementById('playBtn').click();
    };
    window.seek = function () {};
    window.setZoom = function (v) {
      const z = document.getElementById('zoom');
      if (z) { z.value = v; z.dispatchEvent(new Event('input')); }
    };
    window.seekToRuler = function (ev) {
      const ruler = document.getElementById('ruler');
      if (ruler) ruler.dispatchEvent(new MouseEvent('click', { clientX: ev.clientX, bubbles: true }));
    };
    window.clearTimeline = function () { /* standalone stub */ };
    window.runAgentOnSelection = function () {};
    window.closeModal = function () {};
    window.submitModal = function () {};
    inst.init();
    console.log('[Editor] standalone ready');
    return inst;
  }

  return {
    create: createEditor,
    initStandalone: initStandalone,
  };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('binItems')) window.SBTimelineEditor.initStandalone();
  });
} else if (document.getElementById('binItems')) {
  window.SBTimelineEditor.initStandalone();
}