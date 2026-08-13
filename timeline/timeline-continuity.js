/* Timeline — Scene continuity graph (locations + cast blocks) */
window.SBContinuity = (function () {
  function escRe(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function parseHeading(heading) {
    if (window.SBParser && window.SBParser.parseSceneHeading) {
      return window.SBParser.parseSceneHeading(heading);
    }
    return { key: '', name: '', timeOfDay: '', raw: heading || '' };
  }

  function continuityType(heading) {
    const h = String(heading || '');
    if (/\bCONTINUOUS\b/i.test(h)) return 'continuous';
    if (/\b(?:MOMENTS?\s+LATER|LATER|SAME\s+TIME)\b/i.test(h)) return 'later';
    if (/\b(?:FLASHBACK|FLASH\s*CUT|INTERCUT|TIME\s+CUT|MONTAGE|DREAM)\b/i.test(h)) return 'break';
    return 'new';
  }

  function inferCharRole(name, clip, sceneBg) {
    const up = String(name || '').toUpperCase().trim();
    if (!up) return 'supporting';
    if (sceneBg && sceneBg[up]) return 'background';
    const words = up.split(/\s+/).filter(Boolean);
    if (words.length >= 2 && !(clip && clip.dialogue)) return 'background';
    if (clip && clip.dialogue && (clip.characters || []).some(function (n) {
      return String(n || '').toUpperCase().trim() === up;
    })) return 'lead';
    return words.length >= 2 ? 'background' : 'supporting';
  }

  function nameInBlob(name, blob) {
    const up = String(name || '').toUpperCase().trim();
    if (!up || !blob) return false;
    return new RegExp('(?:^|[^A-Z])' + escRe(up) + '(?:[^A-Z]|$)').test(String(blob).toUpperCase());
  }

  function shotNeedsBackground(shot, bgNames) {
    if (!shot || !bgNames.length) return false;
    const type = String(shot.type || shot.shotType || '').toUpperCase();
    if (/^(WIDE|ESTABLISHING|MASTER)/.test(type)) return true;
    const blob = ((shot.description || '') + ' ' + (shot.dialogue || '')).toUpperCase();
    return bgNames.some(function (n) { return nameInBlob(n, blob); });
  }

  /** Group parsed scenes into location/time continuity blocks. */
  function buildBlocks(scenes, clips) {
    scenes = scenes || [];
    clips = clips || [];
    const blocks = [];
    let block = null;

    scenes.forEach(function (sc, si) {
      const meta = parseHeading(sc.heading || '');
      const ctype = continuityType(sc.heading);
      const prev = block;
      const sameKey = !!(prev && meta.key && prev.locationKey && prev.locationKey === meta.key);
      const merge = prev && (ctype === 'continuous' || (sameKey && ctype !== 'break' && ctype !== 'new'));

      if (!block || !merge) {
        block = {
          id: 'blk' + blocks.length,
          locationKey: meta.key || '',
          locationName: meta.name || '',
          timeOfDay: meta.timeOfDay || '',
          continuity: ctype,
          sceneIndices: [si],
          clipIndices: [],
          leads: [],
          supporting: [],
          background: [],
          headings: [sc.heading || ''],
        };
        blocks.push(block);
      } else {
        if (block.sceneIndices.indexOf(si) < 0) block.sceneIndices.push(si);
        if (meta.key && !block.locationKey) {
          block.locationKey = meta.key;
          block.locationName = meta.name;
        }
        if (sc.heading) block.headings.push(sc.heading);
      }

      const bgMap = sc.background_cast || {};
      const bgNames = Object.keys(bgMap);
      const present = new Set((sc.characters_present || []).map(function (n) {
        return String(n || '').toUpperCase().trim();
      }).filter(Boolean));
      bgNames.forEach(function (n) {
        present.add(String(n || '').toUpperCase().trim());
      });

      clips.forEach(function (clip, ci) {
        if (clip.sceneIdx !== si) return;
        if (block.clipIndices.indexOf(ci) < 0) block.clipIndices.push(ci);

        (clip.characters || []).forEach(function (n) {
          const up = String(n || '').toUpperCase().trim();
          if (!up) return;
          present.add(up);
        });

        present.forEach(function (up) {
          const clipRef = clip;
          const role = inferCharRole(up, clipRef, bgMap);
          const list = role === 'lead' ? block.leads : (role === 'background' ? block.background : block.supporting);
          if (list.indexOf(up) < 0) list.push(up);
        });
      });
    });

    return blocks;
  }

  function sortClipIndices(indices) {
    return indices.slice().sort(function (a, b) { return a - b; });
  }

  /** Apply continuity: carry cast across connected shots, scope background, link locations. */
  function applyGraph(state) {
    if (!state || !state.clips || !state.clips.length) return { blocks: [], changed: 0 };
    const scenes = (state.parseResult && state.parseResult.scenes) || [];
    const blocks = buildBlocks(scenes, state.clips);
    let changed = 0;
    const chars = state.characters || {};

    blocks.forEach(function (blk) {
      const carry = { leads: [], all: [] };
      const ordered = sortClipIndices(blk.clipIndices);

      ordered.forEach(function (ci) {
        const clip = state.clips[ci];
        if (!clip) return;
        const sc = scenes[clip.sceneIdx];
        const bgMap = (sc && sc.background_cast) || {};
        const bgNames = Object.keys(bgMap);
        let frame = (clip.characters || []).map(function (n) {
          return String(n || '').toUpperCase().trim();
        }).filter(Boolean);

        if (!frame.length && carry.all.length) {
          frame = carry.all.slice();
          clip.characters = frame.slice();
          changed++;
        }

        if (sc && sc.shots && sc.shots[clip.shotIdx]) {
          const sh = sc.shots[clip.shotIdx];
          if (shotNeedsBackground(sh, bgNames)) {
            bgNames.forEach(function (n) {
              const up = String(n || '').toUpperCase().trim();
              if (!up || frame.indexOf(up) >= 0) return;
              frame.push(up);
              if (!chars[up]) {
                chars[up] = Object.assign({}, window.SBCharacters.DEFAULTS, { role: 'background' });
                changed++;
              }
              const desc = bgMap[n] || bgMap[up] || '';
              if (desc && chars[up] && !chars[up].description) {
                chars[up].description = String(desc).trim();
              }
            });
            clip.characters = frame.slice();
          }
        }

        blk.leads.forEach(function (up) {
          if (frame.indexOf(up) < 0 && carry.leads.indexOf(up) >= 0) {
            frame.push(up);
            clip.characters = frame.slice();
            changed++;
          }
        });

        if (frame.length) {
          carry.all = frame.slice();
          carry.leads = frame.filter(function (up) {
            return inferCharRole(up, clip, bgMap) === 'lead';
          });
        }

        frame.forEach(function (up) {
          if (!chars[up]) {
            chars[up] = Object.assign({}, window.SBCharacters.DEFAULTS);
            changed++;
          }
          const role = inferCharRole(up, clip, bgMap);
          if (role && chars[up].role !== 'lead') chars[up].role = role;
        });
      });

      if (blk.locationKey && state.locationBible) {
        const loc = state.locationBible.find(function (l) { return l && l.key === blk.locationKey; });
        if (loc) {
          ordered.forEach(function (ci) {
            if (!loc.clipIndices) loc.clipIndices = [];
            if (loc.clipIndices.indexOf(ci) < 0) {
              loc.clipIndices.push(ci);
              changed++;
            }
          });
        }
      }
    });

    applyCrowdRules(state);
    applyBlockCastRules(state, blocks);

    state.continuityGraph = { blocks: blocks, builtAt: Date.now() };
    state.characters = chars;
    return { blocks: blocks, changed: changed };
  }

  function blockForClip(state, clipIndex) {
    const g = state && state.continuityGraph;
    if (!g || !g.blocks) return null;
    for (let i = 0; i < g.blocks.length; i++) {
      if (g.blocks[i].clipIndices.indexOf(clipIndex) >= 0) return g.blocks[i];
    }
    return null;
  }

  /** VORSANGER / ninety-clone crowd — one leader + crowd unit, not 90 character cards. */
  function applyCrowdRules(state) {
    if (!state) return 0;
    const script = String(state.scriptText || '');
    const blob = script + '\n' + (state.clips || []).map(function (c) {
      return (c.description || '') + ' ' + (c.dialogue || '') + ' ' + (c.heading || '');
    }).join('\n');
    if (!/\b(?:ninety|90)\b/i.test(blob) && !/\bidentical(?:ly)?\s+(?:dressed|groomed|clone)/i.test(blob)) {
      return 0;
    }
    if (!window.SBCharacters) return 0;
    let n = 0;
    const chars = state.characters || {};
    const crowdDesc =
      'Ninety identically dressed ex-military men: same face, short military haircut, dark blue jacket and trousers, sunglasses; disciplined formation';
    const leaderDesc =
      '50s, short military haircut, dark blue jacket, sunglasses, ex-military build; prominent white VORSANGER nametag on left chest; visually identical to the other eighty-nine men except for the nametag';

    if (!chars.VORSANGER) {
      chars.VORSANGER = Object.assign({}, window.SBCharacters.DEFAULTS);
      n++;
    }
    const v = chars.VORSANGER;
    if (!v._descLocked && (!v.description || v.description.length < 40 || /matching haircut|well groomed man/i.test(v.description))) {
      v.description = leaderDesc;
      n++;
    }
    v.role = 'lead';

    if (!chars.CROWD_CLONES) {
      chars.CROWD_CLONES = Object.assign({}, window.SBCharacters.DEFAULTS, { role: 'crowd', description: crowdDesc });
      n++;
    } else if (!chars.CROWD_CLONES.description) {
      chars.CROWD_CLONES.description = crowdDesc;
      chars.CROWD_CLONES.role = 'crowd';
      n++;
    }

    (state.clips || []).forEach(function (clip) {
      const text = ((clip.description || '') + ' ' + (clip.dialogue || '') + ' ' + (clip.heading || '')).toUpperCase();
      if (!text.includes('VORSANGER') && !/\b(?:90|NINETY)\b/.test(text) && !/IDENTICAL/.test(text)) return;
      clip.characters = clip.characters || [];
      ['VORSANGER'].forEach(function (name) {
        if (clip.characters.indexOf(name) < 0) clip.characters.push(name);
      });
      if (/WIDE|ESTABLISH|BOARD|BUS|TARMAC|CURB|LINE/i.test(text) && clip.characters.indexOf('CROWD_CLONES') < 0) {
        clip.characters.push('CROWD_CLONES');
      }
    });

    state.characters = chars;
    return n;
  }

  /** Carry block leads + crowd into every shot in the block (close-ups included). */
  function applyBlockCastRules(state, blocks) {
    if (!state || !blocks || !blocks.length) return 0;
    const script = String(state.scriptText || '');
    const hasCrowdScript =
      /\b(?:ninety|90)\b/i.test(script) ||
      /\bidentical(?:ly)?\s+(?:dressed|groomed|clone)/i.test(script);
    let n = 0;

    blocks.forEach(function (blk) {
      const blockBlob = ((blk.locationName || '') + ' ' + (blk.headings || []).join(' ')).toUpperCase();
      const blockHasVorsanger =
        blk.leads.indexOf('VORSANGER') >= 0 ||
        blk.background.indexOf('VORSANGER') >= 0 ||
        /VORSANGER|(?:\b90\b|NINETY)|IDENTICAL/.test(blockBlob);
      const blockIsAirport = /AIRPORT|TARMAC|TRUDEAU|TERMINAL|RUNWAY|CURB/.test(blockBlob);

      sortClipIndices(blk.clipIndices).forEach(function (ci) {
        const clip = state.clips[ci];
        if (!clip) return;
        clip.characters = clip.characters || [];
        const text = ((clip.description || '') + ' ' + (clip.dialogue || '') + ' ' + (clip.heading || '')).toUpperCase();
        const shotType = String(clip.shotType || (clip.params && clip.params.camera && clip.params.camera.angle) || '').toUpperCase();
        const needsCrowd =
          /^(WIDE|ESTABLISHING|MASTER)/.test(shotType) ||
          /WIDE|ESTABLISH|BOARD|BUS|TARMAC|CURB|LINE|FORMATION/.test(text);

        if (hasCrowdScript || blockHasVorsanger) {
          if (clip.characters.indexOf('VORSANGER') < 0) {
            clip.characters.push('VORSANGER');
            n++;
          }
          if (needsCrowd && clip.characters.indexOf('CROWD_CLONES') < 0) {
            clip.characters.push('CROWD_CLONES');
            n++;
          }
        }

        blk.leads.forEach(function (up) {
          if (!up || clip.characters.indexOf(up) >= 0) return;
          if (up === 'VORSANGER' && !(hasCrowdScript || blockHasVorsanger)) return;
          clip.characters.push(up);
          n++;
        });

        if (blockIsAirport && blk.locationName && clip.params && clip.params.scene) {
          if (!clip.params.scene.location || /^(scene|location)\s*\d*$/i.test(clip.params.scene.location)) {
            clip.params.scene.location = blk.locationName;
            n++;
          }
        }
      });
    });

    return n;
  }

  /** Prev-clip + block-boundary continuity for generate prompts. */
  function continuityForClip(state, clipIndex) {
    const clips = state.clips || [];
    if (clipIndex == null || clipIndex < 1 || !clips[clipIndex]) return null;
    const prev = clips[clipIndex - 1];
    const prevBlock = blockForClip(state, clipIndex - 1);
    const curBlock = blockForClip(state, clipIndex);
    const blockBreak = !!(prevBlock && curBlock && prevBlock.id !== curBlock.id);
    const phrase = blockBreak
      ? 'CONTINUITY (block handoff): Match the END STATE of the previous clip exactly — same character likenesses, lighting, rain, wet ground, reflections, and cinematic style. No visual reset.'
      : 'CONTINUITY (same scene block): Match characters, wardrobe, and environment from the previous shot in this sequence.';
    const prevUrl = prev.videoUrl ? String(prev.videoUrl) : '';
    const prevVideoUrl =
      prevUrl.startsWith('https://') || prevUrl.startsWith('blob:') || prevUrl.startsWith('data:')
        ? prevUrl
        : null;
    return {
      prevClipNum: prev.num || clipIndex,
      prevVideoUrl: prevVideoUrl,
      blockBreak: blockBreak,
      phrase: phrase,
      locationName: curBlock && curBlock.locationName ? curBlock.locationName : '',
      blockLeads: curBlock && curBlock.leads ? curBlock.leads.slice(0, 6) : [],
    };
  }

  function enrichPromptWithContinuity(prompt, state, clip) {
    const ci = (state.clips || []).findIndex(function (c) { return c && c.id === clip.id; });
    const cont = continuityForClip(state, ci);
    if (!cont) return prompt;
    let extra = cont.phrase;
    if (cont.locationName) {
      extra += ' Location: ' + cont.locationName + ' — same physical set as prior shots in this sequence.';
    }
    if (cont.blockLeads && cont.blockLeads.length) {
      extra += ' Characters in this sequence: ' + cont.blockLeads.join(', ') + '.';
    }
    if (cont.blockLeads && cont.blockLeads.indexOf('VORSANGER') >= 0) {
      extra += ' VORSANGER wears white nametag; clone crowd matches prior shots.';
    }
    if (cont.prevVideoUrl) {
      extra += ' Match the END FRAME of previous clip ' + cont.prevClipNum + ' exactly (wardrobe, lighting, environment).';
    }
    const out = (extra + ' ' + String(prompt || '')).replace(/\s+/g, ' ').trim();
    return out.length > 900 ? out.slice(0, 897) + '...' : out;
  }

  return {
    continuityType: continuityType,
    buildBlocks: buildBlocks,
    applyGraph: applyGraph,
    applyCrowdRules: applyCrowdRules,
    applyBlockCastRules: applyBlockCastRules,
    blockForClip: blockForClip,
    continuityForClip: continuityForClip,
    enrichPromptWithContinuity: enrichPromptWithContinuity,
  };
})();