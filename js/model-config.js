/* Shotbreak — photo + video model capabilities + bulletproof settings dropdowns */
(function () {
  'use strict';

  var PHOTO_MODELS = {
    'wan-2.7': { label: 'Wan 2.7', resolutions: ['720p', '1080p', '1K', '2K'], aspectRatios: ['1:1', '16:9', '9:16', '2:3', '3:2', '4:3', '3:4'], supportsReferences: true, maxRefImages: 4, description: 'Alibaba Wan 2.7 - excellent I2I consistency' },
    'flux-xai': { label: 'Flux (pulling thru XAI API)', resolutions: ['1K', '2K'], aspectRatios: ['1:1', '16:9', '9:16', '2:3', '3:2', '4:3', '3:4', '20:9'], supportsReferences: true, maxRefImages: 3, description: 'High quality via Grok/Flux on XAI' },
    'nano-banana': { label: 'Nano Banana', resolutions: ['1K'], aspectRatios: ['1:1', '16:9', '9:16', '3:2', '2:3'], supportsReferences: true, maxRefImages: 3, description: 'Google Gemini Nano Banana - great for edits & consistency' },
    'nano-banana-pro': { label: 'Nano Banana Pro', resolutions: ['1K', '2K'], aspectRatios: ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3'], supportsReferences: true, maxRefImages: 5, description: 'Nano Banana Pro - higher fidelity, strong character lock' },
    'gpt-image-2': { label: 'GPT 2.0', resolutions: ['1024x1024', '1792x1024', '1024x1792'], aspectRatios: ['1:1', '16:9', '9:16'], supportsReferences: true, maxRefImages: 2, description: 'OpenAI GPT 2.0 via aggregator' }
  };

  var VIDEO_MODELS = {
    'seedance-2.0-turbo': { label: 'Seedance 2.0 Turbo', resolutions: ['720p'], aspectRatios: ['16:9', '9:16', '1:1', '2:3', '3:2'], durations: [4, 5, 6, 8, 10], supportsReferences: true, maxRefImages: 3, description: 'Fast reference-to-video, good audio' },
    'seedance-2.0': { label: 'Seedance 2.0 (Standard)', resolutions: ['480p', '720p', '1080p', '4K'], aspectRatios: ['16:9', '9:16', '1:1', '2:3', '3:2'], durations: [4, 5, 6, 8, 10, 12, 15], supportsReferences: true, maxRefImages: 3, description: 'Seedance 2.0 standard tier — higher fidelity than Turbo, up to 4K/15s via WaveSpeed' },
    'seedance-2.5': { label: 'Seedance 2.5 (multi-ref)', resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1'], durations: [5, 10, 15, 20, 30], supportsReferences: true, maxRefImages: 10, description: 'Seedance 2.5 — 30s single-shot, heavy multi-reference. Early access via WaveSpeed' },
    'wan-2.7': { label: 'Wan 2.7', resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '2:3', '3:2'], durations: [2, 4, 5, 6, 8, 10, 12, 15], supportsReferences: true, maxRefImages: 2, description: 'Wan 2.7 - strong I2V, first+last, audio, 2-15s' },
    'wan-2.5': { label: 'Wan 2.5 (budget)', resolutions: ['480p', '720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'], durations: [2, 4, 5, 6, 8, 10], supportsReferences: true, maxRefImages: 2, description: 'Wan 2.5 — half the price of 2.7, audio-in support, up to 10s via WaveSpeed' },
    'sora-2': { label: 'Sora 2', resolutions: ['720p'], aspectRatios: ['16:9', '9:16'], durations: [4, 8, 12], supportsReferences: true, maxRefImages: 1, description: 'Sora 2 via aivideoapi.ai — 4/8/12s, 16:9 or 9:16' },
    'veo-3.1': { label: 'Veo 3.1', resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'], durations: [4, 6, 8], supportsReferences: true, maxRefImages: 3, description: 'Google Veo 3.1 — 1080p T2V/R2V via WaveSpeed (4/6/8s)' },
    'veo-3.1-fast': { label: 'Veo 3.1 Fast', resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'], durations: [4, 6, 8], supportsReferences: true, maxRefImages: 3, description: 'Veo 3.1 Fast — ~1/3 the price of standard Veo, same durations via WaveSpeed' },
    'grok-imagine': { label: 'Grok Imagine (XAI)', resolutions: ['480p', '720p'], aspectRatios: ['1:1', '16:9', '9:16', '2:3', '3:2'], durations: [4, 5, 6, 8, 10, 12, 15], supportsReferences: true, maxRefImages: 7, description: 'XAI Grok Imagine native - excellent ref coherence + audio' },
    'kling-3.0-pro': { label: 'Kling 3.0 Pro', resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1'], durations: [3, 5, 8, 10, 15], supportsReferences: true, maxRefImages: 1, description: 'Kling 3.0 Pro — cinematic T2V/I2V via WaveSpeed' }
  };

  var _ddDocClickWired = false;
  var _ddScrollWired = false;

  function injectDropdownStyles() {
    if (document.getElementById('sb-dd-styles')) return;
    var s = document.createElement('style');
    s.id = 'sb-dd-styles';
    s.textContent = [
      '.sb-dd-wrap{position:relative;display:inline-block;min-width:128px;vertical-align:top;z-index:200}',
      '.sb-dd-btn{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;background:var(--surface2,#131319);border:1px solid var(--border,rgba(255,255,255,.1));color:var(--text,#e8e8ec);border-radius:6px;padding:7px 10px;font-size:11px;font-weight:600;cursor:pointer;line-height:1.3}',
      '.sb-dd-btn:hover{border-color:var(--border2,rgba(255,255,255,.18));color:#fff}',
      '.sb-dd-btn:focus{outline:none;border-color:var(--gold,#d4a843);box-shadow:0 0 0 2px rgba(212,168,67,.15)}',
      '.sb-dd-btn::after{content:"▾";font-size:10px;color:var(--dim,#5a5a6a);flex-shrink:0}',
      '.sb-dd-btn.open::after{transform:rotate(180deg)}',
      '.sb-dd-menu{position:absolute;top:calc(100% + 4px);left:0;right:0;max-height:240px;overflow-y:auto;background:var(--surface2,#131319);border:1px solid var(--border2,rgba(255,255,255,.14));border-radius:8px;padding:4px;box-shadow:0 10px 28px rgba(0,0,0,.5);z-index:10050}',
      '.sb-dd-menu.sb-dd-floating{position:fixed;right:auto;z-index:10050}',
      '.sb-dd-menu.sb-dd-hidden{display:none}',
      '.sb-dd-item{display:block;width:100%;text-align:left;border:none;background:transparent;color:var(--text2,#8e8e9e);padding:8px 10px;font-size:11px;font-weight:600;border-radius:5px;cursor:pointer}',
      '.sb-dd-item:hover,.sb-dd-item.sb-dd-on{background:rgba(212,168,67,.12);color:var(--gold,#d4a843)}',
      '.sb-dd-native{position:absolute!important;opacity:0!important;width:1px!important;height:1px!important;pointer-events:none!important;left:-9999px!important}',
      '#mhSettingsBar .sb-dd-wrap,#settingsBar .sb-dd-wrap{min-width:140px}',
      '#mhSettingsBar,#settingsBar,.settings-bar,.settings-quick,.mh-settings-quick,.settings-full{overflow:visible!important}',
      '#mhSettingsBar.sb-dd-bar-open,#settingsBar.sb-dd-bar-open{z-index:10040!important}',
      '.mh-section-label{position:relative;z-index:1}',
      '.timeline-wrap,.module-stack{position:relative;z-index:1}'
    ].join('');
    document.head.appendChild(s);
  }

  function positionFloatingMenu(btn, menu) {
    var r = btn.getBoundingClientRect();
    menu.classList.add('sb-dd-floating');
    menu.style.top = Math.round(r.bottom + 4) + 'px';
    menu.style.left = Math.round(r.left) + 'px';
    menu.style.width = Math.max(Math.round(r.width), 140) + 'px';
    menu.style.right = 'auto';
    menu.style.maxHeight = Math.min(240, Math.max(120, window.innerHeight - r.bottom - 12)) + 'px';
  }

  function dockFloatingMenu(ui) {
    if (!ui || !ui.menu || !ui.wrap) return;
    ui.menu.classList.remove('sb-dd-floating');
    ui.menu.style.top = '';
    ui.menu.style.left = '';
    ui.menu.style.width = '';
    ui.menu.style.right = '';
    ui.menu.style.maxHeight = '';
    if (ui.menu.parentNode !== ui.wrap) {
      ui.wrap.appendChild(ui.menu);
    }
  }

  function closeAllSbDropdowns() {
    document.querySelectorAll('.sb-dd-menu').forEach(function (m) {
      m.classList.add('sb-dd-hidden');
      var wrap = m._sbDdWrap;
      if (wrap) dockFloatingMenu({ menu: m, wrap: wrap });
    });
    document.querySelectorAll('.sb-dd-btn.open').forEach(function (b) { b.classList.remove('open'); });
    var bar = document.getElementById('mhSettingsBar') || document.getElementById('settingsBar');
    if (bar) bar.classList.remove('sb-dd-bar-open');
  }

  function openSbDropdown(sel, ui) {
    refreshSbDropdown(sel);
    closeAllSbDropdowns();
    document.body.appendChild(ui.menu);
    ui.menu._sbDdWrap = ui.wrap;
    positionFloatingMenu(ui.btn, ui.menu);
    ui.menu.classList.remove('sb-dd-hidden');
    ui.btn.classList.add('open');
    var bar = document.getElementById('mhSettingsBar') || document.getElementById('settingsBar');
    if (bar && bar.contains(ui.wrap)) bar.classList.add('sb-dd-bar-open');
  }

  function wireDocClose() {
    if (_ddDocClickWired) return;
    _ddDocClickWired = true;
    document.addEventListener('click', function (e) {
      if (e.target.closest && (e.target.closest('.sb-dd-wrap') || e.target.closest('.sb-dd-menu'))) return;
      closeAllSbDropdowns();
    });
    if (_ddScrollWired) return;
    _ddScrollWired = true;
    var onScroll = function () { closeAllSbDropdowns(); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
  }

  function refreshSbDropdown(sel) {
    if (!sel || !sel._sbDd) return;
    var ui = sel._sbDd;
    var btnLabel = 'Choose…';
    if (sel.options.length && sel.selectedIndex >= 0) {
      btnLabel = sel.options[sel.selectedIndex].textContent;
    } else if (sel.disabled) {
      btnLabel = '—';
    }
    ui.btn.textContent = btnLabel;
    ui.btn.disabled = !!sel.disabled;
    ui.menu.innerHTML = '';
    for (var i = 0; i < sel.options.length; i++) {
      (function (opt) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'sb-dd-item' + (opt.value === sel.value ? ' sb-dd-on' : '');
        item.textContent = opt.textContent;
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          sel.value = opt.value;
          refreshSbDropdown(sel);
          closeAllSbDropdowns();
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
        ui.menu.appendChild(item);
      })(sel.options[i]);
    }
  }

  function enhanceSelect(sel) {
    if (!sel || sel.dataset.sbDd === '1') {
      refreshSbDropdown(sel);
      return;
    }
    injectDropdownStyles();
    wireDocClose();
    sel.dataset.sbDd = '1';
    sel.classList.add('sb-dd-native');

    var wrap = document.createElement('div');
    wrap.className = 'sb-dd-wrap';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sb-dd-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    var menu = document.createElement('div');
    menu.className = 'sb-dd-menu sb-dd-hidden';
    menu.setAttribute('role', 'listbox');

    btn.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (sel.disabled) return;
      var open = menu.classList.contains('sb-dd-hidden');
      if (open) {
        setTimeout(function () {
          openSbDropdown(sel, { wrap: wrap, btn: btn, menu: menu });
        }, 0);
      } else {
        closeAllSbDropdowns();
      }
    });
    menu.addEventListener('mousedown', function (e) { e.stopPropagation(); });

    sel._sbDd = { wrap: wrap, btn: btn, menu: menu };
    var parent = sel.parentNode;
    parent.insertBefore(wrap, sel);
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    wrap.appendChild(sel);
    refreshSbDropdown(sel);
  }

  function enhanceSelects(ids) {
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) enhanceSelect(el);
    });
  }

  /** Undo sb-dd wrapper — timeline uses native OS dropdowns on Windows. */
  function restoreNativeSelect(sel) {
    if (!sel) return;
    var ui = sel._sbDd;
    if (ui && ui.wrap && ui.wrap.parentNode) {
      ui.wrap.parentNode.insertBefore(sel, ui.wrap);
      ui.wrap.remove();
    }
    sel.classList.remove('sb-dd-native');
    delete sel.dataset.sbDd;
    delete sel._sbDd;
    sel.style.cssText = '';
    sel.removeAttribute('style');
  }

  function restoreNativeSelects(ids) {
    (ids || []).forEach(function (id) {
      restoreNativeSelect(document.getElementById(id));
    });
  }

  function getModelConfig(model, isVideo) {
    var list = isVideo ? VIDEO_MODELS : PHOTO_MODELS;
    return list[model] || Object.values(list)[0] || {};
  }

  function populateModelSelect(selectId, modelsObj) {
    var sel = document.getElementById(selectId);
    if (!sel || !modelsObj) return;
    sel.innerHTML = '';
    Object.keys(modelsObj).forEach(function (key) {
      var m = modelsObj[key];
      var opt = document.createElement('option');
      opt.value = key;
      opt.textContent = m.label || key;
      sel.appendChild(opt);
    });
    refreshSbDropdown(sel);
  }

  function fillSelect(selectId, values, formatter) {
    var sel = document.getElementById(selectId);
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = '';
    if (!values || !values.length) {
      sel.disabled = true;
      var empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '—';
      sel.appendChild(empty);
      refreshSbDropdown(sel);
      return;
    }
    sel.disabled = false;
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = String(v);
      o.textContent = formatter ? formatter(v) : String(v);
      sel.appendChild(o);
    });
    if (current && values.some(function (x) { return String(x) === current; })) sel.value = current;
    else sel.value = String(values[0]);
    refreshSbDropdown(sel);
  }

  function updateOptionsForModel(model, isVideo, resId, aspectId, durId) {
    var cfg = getModelConfig(model, isVideo);
    var resolutions = Array.isArray(cfg.resolutions) ? cfg.resolutions : [];
    var aspects = Array.isArray(cfg.aspectRatios) ? cfg.aspectRatios : [];
    var durations = isVideo && Array.isArray(cfg.durations) ? cfg.durations : [];

    fillSelect(resId, resolutions, null);
    fillSelect(aspectId, aspects, null);
    if (durId) fillSelect(durId, durations, function (d) { return '~' + d + 's'; });

    var noteEl = document.getElementById(isVideo ? 'videoModelNote' : 'photoModelNote');
    if (noteEl && cfg.description) {
      var refNote = cfg.supportsReferences ? ' • up to ' + (cfg.maxRefImages || 3) + ' refs' : '';
      var paramBits = [];
      if (resolutions.length) paramBits.push(resolutions.join(', '));
      if (aspects.length) paramBits.push(aspects.join(', '));
      if (durations.length) paramBits.push(durations.map(function (d) { return d + 's'; }).join(', '));
      var paramNote = paramBits.length ? ' • supported: ' + paramBits.join(' · ') : '';
      noteEl.textContent = cfg.description + refNote + paramNote;
    }
  }

  function updateVideoOptions() {
    var modelSel = document.getElementById('videoModelSelect');
    if (!modelSel) return;
    updateOptionsForModel(modelSel.value, true, 'videoResolutionSelect', 'videoAspectSelect', 'videoDurationSelect');
  }

  function updatePhotoOptions() {
    var modelSel = document.getElementById('photoModelSelect');
    if (!modelSel) return;
    var cfg = getModelConfig(modelSel.value, false);
    var noteEl = document.getElementById('photoModelNote');
    if (noteEl) {
      var refNote = cfg.supportsReferences ? ' • up to ' + (cfg.maxRefImages || 3) + ' refs supported' : '';
      noteEl.textContent = (cfg.description || '') + refNote;
    }
  }

  var APP_VIDEO_IDS = ['videoModelSelect', 'videoAspectSelect', 'videoDurationSelect', 'videoResolutionSelect'];
  var TL_VIDEO_IDS = ['gModel', 'gAspect', 'gDuration', 'gQuality'];
  var TL_STYLE_IDS = ['gFilm', 'gColor', 'gAudio', 'gLang'];
  var TL_ALL_SETTING_IDS = TL_VIDEO_IDS.concat(TL_STYLE_IDS);

  function inferVideoProvider(model) {
    var m = String(model || '').toLowerCase();
    if (m.indexOf('grok') >= 0) return 'grok-imagine';
    if (m.indexOf('sora') >= 0) return 'aivideoapi';
    return 'wavespeed';
  }

  /** Single source of truth for video submit payloads — reads UI + validates per model */
  function getVideoSettings(source) {
    var isTimeline = source === 'timeline' || (!document.getElementById('videoModelSelect') && document.getElementById('gModel'));
    var ids = isTimeline
      ? { model: 'gModel', aspect: 'gAspect', duration: 'gDuration', resolution: 'gQuality' }
      : { model: 'videoModelSelect', aspect: 'videoAspectSelect', duration: 'videoDurationSelect', resolution: 'videoResolutionSelect' };

    if (isTimeline) {
      var gModel = document.getElementById('gModel');
      if (gModel && !gModel.options.length) {
        populateModelSelect('gModel', VIDEO_MODELS);
        if (VIDEO_MODELS['seedance-2.0-turbo']) gModel.value = 'seedance-2.0-turbo';
        updateOptionsForModel(gModel.value, true, 'gQuality', 'gAspect', 'gDuration');
      }
    } else {
      mhInitVideoSettings();
    }

    var modelEl = document.getElementById(ids.model);
    var model = (modelEl && modelEl.value) || 'seedance-2.0-turbo';
    if (!VIDEO_MODELS[model]) {
      model = VIDEO_MODELS['seedance-2.0-turbo'] ? 'seedance-2.0-turbo' : Object.keys(VIDEO_MODELS)[0];
      if (modelEl) modelEl.value = model;
    }

    var cfg = getModelConfig(model, true);
    var aspEl = document.getElementById(ids.aspect);
    var durEl = document.getElementById(ids.duration);
    var resEl = document.getElementById(ids.resolution);

    var aspect = (aspEl && aspEl.value) || (cfg.aspectRatios && cfg.aspectRatios[0]) || '16:9';
    var duration = parseInt((durEl && durEl.value) || '', 10);
    if (!duration || isNaN(duration)) duration = (cfg.durations && cfg.durations[0]) || 6;
    var resolution = (resEl && resEl.value) || (cfg.resolutions && cfg.resolutions[0]) || '720p';

    if (cfg.aspectRatios && cfg.aspectRatios.indexOf(aspect) < 0) aspect = cfg.aspectRatios[0];
    if (cfg.durations && cfg.durations.indexOf(duration) < 0) duration = cfg.durations[0];
    if (cfg.resolutions && cfg.resolutions.indexOf(resolution) < 0) resolution = cfg.resolutions[0];

    if (aspEl && aspEl.value !== aspect) aspEl.value = aspect;
    if (durEl && durEl.value !== String(duration)) durEl.value = String(duration);
    if (resEl && resEl.value !== resolution) resEl.value = resolution;
    if (!isTimeline) {
      refreshSbDropdown(aspEl);
      refreshSbDropdown(durEl);
      refreshSbDropdown(resEl);
      refreshSbDropdown(modelEl);
    }

    return {
      model: model,
      aspect_ratio: aspect,
      duration: duration,
      resolution: resolution,
      provider: inferVideoProvider(model)
    };
  }

  function updateSettingsStatusBar() {
    var bar = document.getElementById('mhSettingsStatus');
    if (!bar || !document.getElementById('videoModelSelect')) return;
    try {
      var s = getVideoSettings('app');
      var label = VIDEO_MODELS[s.model] ? VIDEO_MODELS[s.model].label : s.model;
      bar.textContent = 'Generate will use: ' + label + ' · ' + s.aspect_ratio + ' · ~' + s.duration + 's · ' + s.resolution;
    } catch (e) {
      bar.textContent = '';
    }
  }

  function mhInitVideoSettings() {
    var vidSel = document.getElementById('videoModelSelect');
    if (!vidSel) return;
    var keys = Object.keys(VIDEO_MODELS);
    if (!keys.length) return;
    if (vidSel.options.length !== keys.length) {
      populateModelSelect('videoModelSelect', VIDEO_MODELS);
    }
    if (!vidSel.value || !VIDEO_MODELS[vidSel.value]) {
      vidSel.value = VIDEO_MODELS['seedance-2.0-turbo'] ? 'seedance-2.0-turbo' : keys[0];
    }
    updateVideoOptions();
    enhanceSelects(APP_VIDEO_IDS);
    if (!vidSel.dataset.mhWired) {
      vidSel.dataset.mhWired = '1';
      vidSel.addEventListener('change', function () {
        updateVideoOptions();
        updateSettingsStatusBar();
      });
    }
    ['videoAspectSelect', 'videoDurationSelect', 'videoResolutionSelect'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !el.dataset.mhWired) {
        el.dataset.mhWired = '1';
        el.addEventListener('change', updateSettingsStatusBar);
      }
    });
    updateSettingsStatusBar();
  }

  function initTimelineVideoSettings(onSync, skipInitialSync) {
    var modelSel = document.getElementById('gModel');
    if (!modelSel) return;
    restoreNativeSelects(TL_ALL_SETTING_IDS);
    populateModelSelect('gModel', VIDEO_MODELS);
    var migrate = { 'seedance-turbo': 'seedance-2.0-turbo', seedance: 'seedance-2.0-turbo', veo: 'veo-3.1' };
    if (modelSel.value && migrate[modelSel.value]) modelSel.value = migrate[modelSel.value];
    if (!modelSel.value || !VIDEO_MODELS[modelSel.value]) {
      modelSel.value = VIDEO_MODELS['seedance-2.0-turbo'] ? 'seedance-2.0-turbo' : Object.keys(VIDEO_MODELS)[0];
    }
    function refresh(runSync) {
      updateOptionsForModel(modelSel.value, true, 'gQuality', 'gAspect', 'gDuration');
      /* Timeline uses native <select> — custom sb-dd was invisible/blocked on Windows */
      if (runSync !== false && typeof onSync === 'function') onSync();
    }
    if (!modelSel.dataset.tlWired) {
      modelSel.dataset.tlWired = '1';
      modelSel.addEventListener('change', function () { refresh(true); });
      ['gAspect', 'gDuration', 'gQuality'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', function () { if (typeof onSync === 'function') onSync(); });
      });
    }
    refresh(skipInitialSync === true ? false : true);
  }

  window.PHOTO_MODELS = PHOTO_MODELS;
  window.VIDEO_MODELS = VIDEO_MODELS;
  window.getModelConfig = getModelConfig;
  window.populateModelSelect = populateModelSelect;
  window.updateOptionsForModel = updateOptionsForModel;
  window.updateVideoOptions = updateVideoOptions;
  window.updatePhotoOptions = updatePhotoOptions;
  window.mhInitVideoSettings = mhInitVideoSettings;
  window.initTimelineVideoSettings = initTimelineVideoSettings;
  window.enhanceSelect = enhanceSelect;
  window.enhanceSelects = enhanceSelects;
  window.restoreNativeSelects = restoreNativeSelects;
  window.getVideoSettings = getVideoSettings;
  window.inferVideoProvider = inferVideoProvider;
  window.updateSettingsStatusBar = updateSettingsStatusBar;

  function boot() {
    if (document.getElementById('videoModelSelect')) mhInitVideoSettings();
    if (document.getElementById('gModel') && typeof window.initTimelineVideoSettings === 'function') {
      /* timeline.js calls initTimelineVideoSettings with syncGlobal */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 30); });
  } else {
    setTimeout(boot, 30);
  }
})();