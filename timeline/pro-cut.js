/* SHOTBREAK Pro Cut — browser-side clip analysis + professional EDL (web) */
window.SBProCut = (function () {
  'use strict';

  const SAMPLE_STEP = 0.25;
  const THUMB_W = 80;
  const THUMB_H = 45;
  const MIN_CLIP = 1.2;
  const HEAD_TAIL_PAD = 0.12;
  const MOTION_FLOOR = 0.018;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function loadVideo(src) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;
      v.crossOrigin = 'anonymous';
      const done = (ok) => {
        v.pause();
        v.removeAttribute('src');
        v.load();
      };
      v.onloadedmetadata = () => resolve(v);
      v.onerror = () => { done(); reject(new Error('Could not load video')); };
      setTimeout(() => { done(); reject(new Error('Video load timeout')); }, 20000);
      v.src = src;
    });
  }

  function frameDiff(a, b) {
    if (!a || !b || a.length !== b.length) return 1;
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) {
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    }
    return sum / (a.length / 4) / 765;
  }

  function grabFrame(video, canvas, ctx, t) {
    return new Promise((resolve) => {
      const seeked = () => {
        video.removeEventListener('seeked', seeked);
        try {
          ctx.drawImage(video, 0, 0, THUMB_W, THUMB_H);
          resolve(ctx.getImageData(0, 0, THUMB_W, THUMB_H).data);
        } catch (e) {
          resolve(null);
        }
      };
      video.addEventListener('seeked', seeked);
      try { video.currentTime = clamp(t, 0, Math.max(0, (video.duration || 5) - 0.05)); }
      catch (e) { resolve(null); }
    });
  }

  async function analyzeClip(src, onProgress) {
    const fallback = { src, duration: 5, motion: [], trimIn: HEAD_TAIL_PAD, trimOut: null, method: 'fallback' };
    let video;
    try {
      video = await loadVideo(src);
    } catch (e) {
      return Object.assign({}, fallback, { error: e.message });
    }

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 5;
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const motion = [];
    let prev = null;
    const samples = Math.max(2, Math.ceil(duration / SAMPLE_STEP));

    for (let i = 0; i <= samples; i++) {
      const t = clamp(i * SAMPLE_STEP, 0, duration - 0.04);
      if (onProgress) onProgress('Analyzing frame ' + (i + 1) + '/' + (samples + 1));
      const data = await grabFrame(video, canvas, ctx, t);
      const score = prev && data ? frameDiff(prev, data) : 0;
      motion.push({ t, score });
      prev = data;
    }

    video.pause();
    video.removeAttribute('src');

    let trimIn = HEAD_TAIL_PAD;
    let trimOut = duration - HEAD_TAIL_PAD;

    if (motion.length > 2 && motion.some((m) => m.score > MOTION_FLOOR)) {
      const active = motion.filter((m) => m.score >= MOTION_FLOOR);
      if (active.length) {
        trimIn = clamp(active[0].t - 0.05, 0, duration * 0.25);
        trimOut = clamp(active[active.length - 1].t + SAMPLE_STEP + 0.1, trimIn + MIN_CLIP, duration);
      }
    }

    if (trimOut - trimIn < MIN_CLIP) {
      trimIn = 0;
      trimOut = duration;
    }

    return {
      src,
      duration,
      motion,
      trimIn: Math.round(trimIn * 100) / 100,
      trimOut: Math.round(trimOut * 100) / 100,
      method: motion[0] && motion[0].score !== undefined ? 'motion' : 'fallback',
    };
  }

  function sceneKey(clip) {
    const h = String(clip.heading || clip.label || '').toUpperCase();
    const loc = clip.params && clip.params.scene ? String(clip.params.scene.location || '') : '';
    return (h + '|' + loc).trim();
  }

  function pickTransition(prev, next) {
    if (!prev || !next) return { type: 'cut', dur: 0 };
    const e1 = String(prev.emotion || 'Neutral');
    const e2 = String(next.emotion || 'Neutral');
    const sceneChange = sceneKey(prev) !== sceneKey(next);
    const moodShift = e1 !== e2 && (e1 !== 'Neutral' || e2 !== 'Neutral');
    if (sceneChange) return { type: 'dissolve', dur: 0.45 };
    if (moodShift) return { type: 'dissolve', dur: 0.35 };
    return { type: 'cut', dur: 0 };
  }

  function buildEdl(clips, analyses, opts) {
    opts = opts || {};
    const sorted = clips.slice().sort((a, b) => (a.num || 0) - (b.num || 0));
    const bySrc = {};
    (analyses || []).forEach((a) => { if (a && a.src) bySrc[a.src] = a; });

    const out = [];
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      const src = c.videoUrl || c.src;
      const a = bySrc[src] || {};
      const dur = a.duration || c.durationSec || 5;
      let trimIn = a.trimIn != null ? a.trimIn : HEAD_TAIL_PAD;
      let trimOut = a.trimOut != null ? a.trimOut : (dur - HEAD_TAIL_PAD);
      if (c.edit) {
        if (opts.respectManual === true && c.edit.trimIn != null) trimIn = c.edit.trimIn;
        if (opts.respectManual === true && c.edit.trimOut != null) trimOut = c.edit.trimOut;
      }
      trimIn = clamp(trimIn, 0, dur - MIN_CLIP);
      trimOut = clamp(trimOut, trimIn + MIN_CLIP, dur);

      const prev = sorted[i - 1];
      const tr = pickTransition(prev, c);
      out.push({
        id: c.id,
        num: c.num,
        name: c.name || ('Clip ' + (c.num || (i + 1))),
        src: src,
        trimIn: trimIn,
        trimOut: trimOut,
        transition: tr.type,
        transitionDur: tr.dur,
        emotion: c.emotion,
        scene: sceneKey(c),
        analysis: a.method || 'none',
      });
    }
    return {
      version: 1,
      projectName: opts.projectName || 'Shotbreak Pro Cut',
      pacing: opts.pacing || 'standard',
      clips: out,
      createdAt: Date.now(),
    };
  }

  async function run(clips, opts) {
    opts = opts || {};
    const list = (clips || []).filter((c) => c && (c.videoUrl || c.src));
    if (!list.length) throw new Error('No clips with video');

    const onProgress = opts.onProgress || function () {};
    onProgress('Pro Cut: analyzing ' + list.length + ' clip(s)…');

    const analyses = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const src = c.videoUrl || c.src;
      onProgress('Clip ' + (c.num || (i + 1)) + ': scanning motion…');
      analyses.push(await analyzeClip(src, (msg) => onProgress(msg)));
    }

    const edl = buildEdl(list, analyses, {
      projectName: opts.projectName,
      pacing: opts.pacing,
      respectManual: false,
    });

    onProgress('Pro Cut: EDL ready (' + edl.clips.length + ' clips)');
    return { edl, analyses };
  }

  function applyToTimelineClips(timelineClips, edl) {
    if (!edl || !Array.isArray(edl.clips)) return 0;
    const map = {};
    edl.clips.forEach((e) => { map[e.id] = e; });
    let n = 0;
    timelineClips.forEach((c) => {
      const e = map[c.id];
      if (!e) return;
      if (!c.edit) c.edit = { trimIn: 0, trimOut: null, transition: 'cut', transitionDur: 0.5, speed: 1, overlayFx: '', colorCorrect: '' };
      c.edit.trimIn = e.trimIn;
      c.edit.trimOut = e.trimOut;
      c.edit.transition = e.transition;
      c.edit.transitionDur = e.transitionDur || 0;
      n++;
    });
    return n;
  }

  return {
    analyzeClip: analyzeClip,
    buildEdl: buildEdl,
    run: run,
    applyToTimelineClips: applyToTimelineClips,
  };
})();