/* SHOTBREAK Timeline — Script Parser (offline module ①) */
window.SBParser = (function(){
  function isSH(t){
    const line=(t||'').trim();
    if(!line)return false;
    if(/^(?:(?:SC|SCENE)\s*\d+[A-Z]?[.\s\-]+\s*|\d+[.\s-]+\s*)?(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)[\s\-]/i.test(line))return true;
    if(/^SCENE\s+\d+(?:\s*[.\-—:]\s*|\s+)/i.test(line))return true;
    if(/^(FLASHBACK|FLASH\s*CUT|MONTAGE|DREAM|INTERCUT|BACK\s+TO|LATER|TIME\s+CUT|SERIES\s+OF\s+SHOTS)\b/i.test(line)&&line===line.toUpperCase())return true;
    if(/^\d+[.\s]+\s*[A-Z][A-Z0-9\s'\-]+\s+[-—–]\s+(DAY|NIGHT|MORNING|EVENING|DUSK|DAWN|CONTINUOUS|LATER)\s*$/i.test(line))return true;
    return /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i.test(line);
  }
  /** Character cue — must be ALL CAPS (matches Edit Studio isCC). */
  function isCC(l){
    const t=(l||'').trim();
    if(!t||t.length<2||t.length>40||isSH(t))return false;
    if(/^(FADE|CUT|DISSOLVE|SMASH|MATCH|IRIS|WIPE)/.test(t))return false;
    if(/^\(/.test(t)&&/\)$/.test(t))return false;
    return isCharCueLine(t);
  }
  function isPar(t){return /^\([^)]+\)$/.test(t)}
  function isTr(t){return /^(FADE IN|FADE OUT|CUT TO|DISSOLVE TO|SMASH CUT)/i.test(t)}
  function isSceneNumberOnly(t){return /^\d+[A-Z]?\.?$/.test(t)}
  function isTitlePageLine(t){
    if(isSH(t))return false;
    if(/^(written by|by |story by|draft|revision|page |registered|copyright|contact|address|phone|email|wga|version)/i.test(t))return true;
    if(LABEL_CUE_RE.test(t.trim()))return true;
    if(/^[A-Z][A-Z\s]{3,40}$/.test(t)&&!isCharCueLine(t)&&t.split(/\s+/).length<=5)return true;
    return false;
  }
  function exCN(t){return t.replace(/\s*\([^)]*\)\s*/g,'').trim().toUpperCase()}
  function resCN(n,c){if(c[n]!==undefined)return n;for(const f of Object.keys(c)){if(f.split(/\s+/).length>1&&f.split(/\s+/).includes(n))return f}return n}
  function spS(t){
    const r=t.match(/[^.!?]+[.!?]+[\s]*/g)||[t],res=[];let b='';
    for(const s of r){b+=s;if(b.trim().split(/\s+/).length>=6||s===r[r.length-1]){res.push(b.trim());b=''}}
    if(b.trim())res.push(b.trim());return res;
  }
  function iT(t,d,c){
    const x=t.toLowerCase().replace(/\([^)]*\)/g,'');
    if(/\b(close[\s-]?up|eyes|mouth|hand|tears)\b/.test(x))return'CLOSE-UP';
    if(/\b(insert|phone|screen|key|gun|weapon|drive)\b/.test(x))return'INSERT';
    if(d&&c===2)return'TWO-SHOT';if(d)return'MEDIUM';
    if(/\b(behind|shoulder)\b/.test(x))return'OTS';
    if(/\b(wide|room|city|street|warehouse|sky|surround)\b/.test(x))return'WIDE';
    if(/\b(walks?|run|follow|track|through|across)\b/.test(x))return'TRACKING';
    if(/\b(looks?\s+at|stares?|meets?\s+(his|her)\s+eyes)\b/.test(x))return'CLOSE-UP';
    return'MEDIUM';
  }
  function iCm(t,s){
    const x=t.toLowerCase();
    if(/\b(slow(ly)?|creep)\b/.test(x))return'SLOW DOLLY';
    if(/\b(pan|scans?)\b/.test(x))return'PAN';
    if(/\b(follow|track)\b/.test(x)&&s==='TRACKING')return'STEADICAM';
    if(/\b(crash|sudden)\b/.test(x))return'HANDHELD';
    return'STATIC';
  }
  function parseSceneHeading(heading){
    const h=String(heading||'').trim();
    if(!h)return{key:'',name:'',timeOfDay:'',raw:''};
    const normKey=name=>String(name||'').trim().toUpperCase().replace(/\s+/g,' ');

    let m=h.match(/^\s*(?:(?:SC|SCENE)\s*\d+[A-Z]?[.\s\-—]*\s*)?(INT\.|EXT\.|INT\/EXT\.|I\/E\.?)\s+(.+?)(?:\s*[-—–]\s*(.+))?$/i);
    if(m){
      const name=m[2].trim();
      const tod=(m[3]||'').trim();
      return{key:normKey(name),name,timeOfDay:tod,raw:h};
    }

    m=h.match(/^(?:(?:SCENE\s+)?\d+[A-Z]?[.\s]+)\s*([A-Z][A-Z0-9\s'\-/&,]+?)\s+[-—–]\s+(DAY|NIGHT|MORNING|EVENING|DUSK|DAWN|CONTINUOUS|LATER|MOMENTS(?:\s+LATER)?)/i);
    if(m){
      const name=m[1].trim();
      return{key:normKey(name),name,timeOfDay:m[2].trim(),raw:h};
    }

    if(/^(FLASHBACK|FLASH\s*CUT|MONTAGE|DREAM|INTERCUT|BACK\s+TO|LATER|TIME\s+CUT|SERIES\s+OF\s+SHOTS)\b/i.test(h)){
      const name=h.split(/\s*[-—–]\s*/)[0].trim();
      return{key:normKey(name),name,timeOfDay:'',raw:h};
    }

    return{key:'',name:'',timeOfDay:'',raw:h};
  }

  function inferLocation(heading){
    return parseSceneHeading(heading).name;
  }
  function inferTOD(heading){
    const meta=parseSceneHeading(heading);
    if(meta.timeOfDay){
      const t=meta.timeOfDay.toLowerCase();
      if(/\bnight\b/.test(t))return'Night';
      if(/\bdawn\b/.test(t))return'Dawn';
      if(/\bdusk\b/.test(t))return'Dusk';
      if(/\bmorning\b/.test(t))return'Morning';
      if(/\bevening\b/.test(t))return'Evening';
      return meta.timeOfDay;
    }
    if(!heading)return'Day';
    if(/\bNIGHT\b/i.test(heading))return'Night';
    if(/\bDAWN\b/i.test(heading))return'Dawn';
    if(/\bDUSK\b/i.test(heading))return'Dusk';
    return'Day';
  }

  function countCueLines(text){
    return (String(text||'').match(/^\s*[A-Z][A-Z0-9 .'\-]{1,35}\s*$/gm)||[]).length;
  }

  function upsertLocationRow(out,heading){
    const t=String(heading||'').trim();
    if(!t)return;
    const meta=parseSceneHeading(t);
    if(!meta.key)return;
    if(!out[meta.key]){
      out[meta.key]={name:meta.name,key:meta.key,heading:t,timeOfDay:meta.timeOfDay||'',clipIndices:[]};
    }else if(out[meta.key].heading!==t&&!out[meta.key].headings){
      out[meta.key].headings=[out[meta.key].heading,t];
    }else if(out[meta.key].headings&&out[meta.key].headings.indexOf(t)<0){
      out[meta.key].headings.push(t);
    }
  }

  /** Scan screenplay for sluglines — line-start and embedded (flattened PDF). */
  function extractLocationsFromText(text){
    const out={};
    const norm=normalizeScriptText(text);
    if(!norm.trim())return out;
    norm.split('\n').forEach(line=>{
      const t=line.trim();
      if(!t||!isSH(t))return;
      upsertLocationRow(out,t);
    });
    const inlineRe=/\b(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.?)\s+([A-Za-z0-9][A-Za-z0-9 .'\-/&,]{2,90}?)(?:\s*[-—–]\s*(DAY|NIGHT|MORNING|EVENING|DUSK|DAWN|CONTINUOUS|LATER|MOMENTS(?:\s+LATER)?))?(?=[.!?\s]|$)/gi;
    let m;
    while((m=inlineRe.exec(norm))!==null){
      const head=(/^(INT|EXT)/i.test(m[0])?m[0].trim():('INT. '+m[1].trim()+(m[2]?' - '+m[2]:'')));
      upsertLocationRow(out,head);
    }
    const locTagRe=/^\s*Location:\s*([^\n]{3,120})/gim;
    while((m=locTagRe.exec(norm))!==null){
      const name=String(m[1]||'').trim().replace(/[.,;]+$/, '');
      if(name.length>2&&!/^SCENE\s*\d*$/i.test(name)){
        upsertLocationRow(out,'INT. '+name+' - DAY');
      }
    }
    return out;
  }

  const CAP_FALSE_POS=new Set([
    'INT','EXT','I/E','INT/EXT','FADE','CUT','DISSOLVE','ANGLE','POV','CLOSE','WIDE','INSERT',
    'DAY','NIGHT','MORNING','EVENING','CONTINUOUS','LATER','MOMENTS','CONT','VO','OS','OC',
    'THE','AND','BUT','WITH','FROM','INTO','OVER','UNDER','AFTER','BEFORE','SCENE','SHOT',
    'FADE IN','FADE OUT','CUT TO','SMASH CUT','DISSOLVE TO','SUPER','TITLE','END','MONTAGE',
    'ABANDONED','WAREHOUSE','BUILDING','APARTMENT','HOUSE','OFFICE','FACTORY','ALLEY','STREET',
    'ROOM','HALLWAY','CORRIDOR','BASEMENT','ATTIC','GARAGE','KITCHEN','BEDROOM','ROOF','CEILING',
    'PARKING','FIELD','FOREST','BEACH','DESERT','HIGHWAY','ROAD','BRIDGE','TUNNEL','HOSPITAL',
    'SCHOOL','CHURCH','STATION','AIRPORT','PRISON','COURTROOM','LOBBY','BAR','RESTAURANT','LAB',
    'SLOWLY','QUICKLY','SUDDENLY','THEN','NOW','BACK','AWAY','DOWN','UP','OUT','OFF','ON','IN','AT','TO',
    'RAIN','WATER','WIND','FIRE','SMOKE','THUNDER','LIGHTNING','SUN','MOON','SNOW','FOG','MIST','TIN',
    'MEANWHILE','FINALLY','GRADUALLY','INSTANTLY','IMMEDIATELY','EVERYONE','SOMEBODY','SOMEONE',
    'ANYONE','NOBODY','PEOPLE','MEN','WOMEN','CHILDREN','SOLDIERS','WARRIORS','GUARDS','OFFICERS',
    'GERMAN','RUSSIAN','AMERICAN','BRITISH','FRENCH','VIKING','NORSE','ROMAN','POLICE','HORSES',
    'STOP','LOOK','LISTEN','RUN','HELP','WAIT','YES','NO','OK','OKAY','DAMN','HELL',
    'CLIFF','MOUNTAIN','RIVER','OCEAN','SEA','LAKE','VALLEY','CASTLE','SHIP','BOAT','DOOR','WALL',
    'HAMMER','HAMMERS','DRIP','DRIPS','STEP','STEPS','EMERGE','EMERGES','LAUNCH','LAUNCHES',
    'PUSH','PUSHES','RAISE','RAISING','DELIVERING','OPENING','SEQUENCE','WRITTEN','CREDITS',
    'TEASER','PROLOGUE','EPILOGUE','CLOSING','INTERNATIONAL','PIERRE','TRUDEAU','ZOOMS','LANDS',
    'CAMERA','STREET','LEVEL','JET','OVERHEAD','LARGE','AS','THE','A','AN'
  ]);
  const NON_NAME_WORDS=CAP_FALSE_POS;
  const LABEL_CUE_RE=/^(?:OPENING|TITLE|TEASER|PROLOGUE|EPILOGUE|END|CREDIT|CLOSING)\s+(?:SEQUENCE|CREDITS|SCENE)$|^(?:SEQUENCE|DIALOGUE|ACTION|REACTION|TRANSITION|CLIMAX|RESOLUTION|EPILOGUE|CHARACTER\s+INTRO|OPENING\s+SCENE|BEAT\s+\d+)$/i;

  function isLocationCaps(name){
    const LOC=new Set(['ABANDONED','WAREHOUSE','BUILDING','APARTMENT','HOUSE','OFFICE','FACTORY','ALLEY','STREET','ROOM','HALLWAY','CORRIDOR','BASEMENT','ATTIC','GARAGE','KITCHEN','BEDROOM','ROOF','CEILING','PARKING','FIELD','FOREST','BEACH','DESERT','HIGHWAY','ROAD','BRIDGE','TUNNEL','HOSPITAL','SCHOOL','CHURCH','STATION','AIRPORT','PRISON','COURTROOM','LOBBY','BAR','RESTAURANT','LAB','LOCATION','INTERIOR','EXTERIOR']);
    const words=String(name||'').toUpperCase().split(/\s+/);
    if(!words.length)return true;
    return words.every(w=>LOC.has(w)||CAP_FALSE_POS.has(w));
  }

  function cleanCharName(raw){
    if(!raw)return'';
    return raw.replace(/\s*\([^)]*\)\s*/g,'').replace(/\s*[-–—:]\s*$/,'').replace(/\s+/g,' ').trim().toUpperCase();
  }

  function isDescriptiveParen(desc){
    const d=String(desc||'').trim();
    if(!d||d.length<2)return false;
    if(/^(v\.?o\.?|o\.?s\.?|o\.?c\.?|cont'?d|whispering|beat|pause|sighs|laughing|filtered|into radio|to camera|pre-?lap|offscreen)$/i.test(d))return false;
    if(/^(to the|at the|from the|into the|over the|under the)\b/i.test(d))return false;
    if(/\d/.test(d))return true;
    if(/,/.test(d))return true;
    if(d.split(/\s+/).length>=3)return true;
    if(/\b(weathered|military|athletic|silver|hair|suit|sharp|eyes|old|young|tall|short|beard|scar|ex-|former|aged|burly|lean|pale|dark|blonde|brunette)\b/i.test(d))return true;
    return false;
  }

  function stripCastArticle(name){
    return cleanCharName(name).replace(/^(A|AN|THE)\s+/,'').trim();
  }

  function isLikelyPersonName(name,opts){
    opts=opts||{};
    const cn=stripCastArticle(name);
    if(!cn||cn.length<2||cn.length>40)return false;
    if(/^(INT|EXT|I\/E|INT\/EXT)\b/.test(cn))return false;
    if(isLocationCaps(cn))return false;
    const words=cn.split(/\s+/);
    if(words.every(w=>NON_NAME_WORDS.has(w)))return false;
    if(words.length===1){
      if(NON_NAME_WORDS.has(words[0]))return false;
      if(!opts.fromCue&&words[0].length<3)return false;
    }else if(words.every(w=>NON_NAME_WORDS.has(w)||/^(JR|SR|II|III|IV)$/i.test(w))){
      return false;
    }
    return true;
  }

  /** Looser gate: dialogue leads + background role titles (FLIGHT ATTENDANT, CUSTOMS AGENT). */
  function isCastMember(name,opts){
    opts=opts||{};
    const cn=stripCastArticle(name);
    if(!cn||cn.length<2||cn.length>40)return false;
    if(/^(INT|EXT|I\/E|INT\/EXT)\b/.test(cn))return false;
    if(isLocationCaps(cn))return false;
    if(isLikelyPersonName(cn,{fromCue:!!opts.fromCue}))return true;
    if(isLikelyPersonName(cn,{fromCue:true}))return true;
    const words=cn.split(/\s+/).filter(w=>w&&w!=='A'&&w!=='AN'&&w!=='THE');
    if(words.length>=2&&words.length<=4){
      const roleWords=words.filter(w=>!NON_NAME_WORDS.has(w)&&!/^(JR|SR|II|III|IV)$/i.test(w));
      if(roleWords.length>=2)return true;
    }
    if(words.length===1&&words[0].length>=3&&!NON_NAME_WORDS.has(words[0]))return true;
    return false;
  }

  function registerChar(chars,name,desc,opts){
    opts=opts||{};
    const cn=stripCastArticle(name);
    if(!cn||cn.length<2||cn.length>40)return;
    if(!isCastMember(cn,{fromCue:!!opts.fromCue}))return;
    if(chars[cn]===undefined)chars[cn]=desc||'';
    else if(desc&&(!chars[cn]||String(desc).length>String(chars[cn]).length))chars[cn]=desc;
  }

  function isCharCueLine(t){
    if(!t)return false;
    if(isSH(t))return false;
    if(/^(FADE|CUT|DISSOLVE|SMASH|MATCH|IRIS|WIPE|THE END)/i.test(t))return false;
    if(/^\(.+\)$/.test(t))return false;
    const cuePart=t.replace(/\s*\([^)]*\)\s*$/,'').trim();
    if(!cuePart||cuePart.length<2||cuePart.length>40)return false;
    if(cuePart!==cuePart.toUpperCase())return false;
    if(/[.!?,;:]$/.test(cuePart))return false;
    if(!/[A-Z]/.test(cuePart))return false;
    const words=cuePart.split(/\s+/);
    if(words.every(w=>NON_NAME_WORDS.has(w)))return false;
    if(words.length===1&&NON_NAME_WORDS.has(words[0]))return false;
    if(LABEL_CUE_RE.test(cuePart))return false;
    return isLikelyPersonName(cuePart,{fromCue:true});
  }

  function looksLikeCharCue(name){
    return isLikelyPersonName(name,{fromCue:true});
  }

  function filterCharacterMap(chars){
    const out={};
    Object.entries(chars||{}).forEach(([n,d])=>{
      if(isCastMember(n))out[cleanCharName(n)]=d;
    });
    return out;
  }

  /** Background / supporting cast from action lines (no dialogue cue). */
  function extractBackgroundCastFromText(text){
    const chars={};
    const norm=normalizeScriptText(text);
    if(!norm.trim())return chars;
    const patterns=[
      /(?:^|[\n.!?]\s*)(?:A|AN|TWO|THREE|FOUR|SEVERAL)\s+([A-Z][A-Z0-9 .'\-]{2,28}(?:\s+[A-Z][A-Z0-9 .'\-]{2,28}){0,3})\s*\(([^)]{3,160})\)/gi,
      /(?:^|\n)\s*(?:A|AN)\s+([A-Z][A-Z0-9 .'\-]{2,28}(?:\s+[A-Z][A-Z0-9 .'\-]{2,28}){0,2})\s+(?=[a-z])/gi,
      /(?:^|\n)\s*([A-Z][A-Z0-9 .'\-]{2,28}(?:\s+[A-Z][A-Z0-9 .'\-]{2,28}){0,3})\s*\(([^)]{3,160})\)\s*(?=[a-z])/gi,
      /(?:^|[\n.!?]\s*)([A-Z][A-Z0-9 .'\-]{2,28})\s*\(([^)]{3,160})\)\s*(?=[a-z])/gi
    ];
    patterns.forEach(re=>{
      let m;
      while((m=re.exec(norm))!==null){
        const name=m[1];
        const desc=m[2]&&isDescriptiveParen(m[2])?m[2].trim():'';
        registerChar(chars,name,desc,{fromCue:false});
      }
    });
    return filterCharacterMap(chars);
  }

  function nameInBlob(name,blob){
    const cn=cleanCharName(name);
    if(!cn)return false;
    const esc=cn.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp('(?:^|[^A-Z])'+esc+'(?:[^A-Z]|$)').test(blob);
  }

  function countLines(t){return String(t||'').split('\n').filter(l=>l.trim()).length}

  /** True when text looks like a PDF paste or single-line blob, not a real screenplay file. */
  function isScriptFlattened(text){
    const t=String(text||'').replace(/\r\n/g,'\n');
    if(!t.trim())return false;
    const lines=t.split('\n').map(l=>l.trim()).filter(Boolean);
    if(lines.length<=2&&t.length>280)return true;
    if(lines.length<=1&&t.length>120)return true;
    const avg=t.length/Math.max(lines.length,1);
    if(avg>130&&t.length>450)return true;
    const longLines=lines.filter(l=>l.length>180).length;
    if(longLines>=2&&longLines/lines.length>0.25)return true;
    if(lines.length<Math.ceil(t.length/350)&&t.length>700)return true;
    return false;
  }

  /** Split flattened PDF blobs before character cues and action-line names. */
  function insertCueBreaks(t){
    return t
      .replace(/([.!?])\s+([A-Z][A-Z0-9 .'\-]{1,30})(\s*\([^)]{0,80}\))?\s+(?=[(\[]|[a-z])/g,(m,p1,p2,p3)=>{
        if(!looksLikeCharCue(p2))return m;
        return p1+'\n\n'+p2+(p3||'')+'\n';
      })
      .replace(/\)\s+([A-Z][A-Z0-9 .'\-]{1,30})(\s*\([^)]{0,60}\))?\s*(?=\(|$|[a-z])/g,(m,p1,p2)=>{
        if(!looksLikeCharCue(p1))return m;
        return ')\n\n'+p1+(p2||'')+'\n';
      })
      .replace(/\s{2,}([A-Z][A-Z0-9 .'\-]{1,28})(\s*\([^)]{0,60}\))?\s+(?=\()/g,(m,p1,p2)=>{
        if(!looksLikeCharCue(p1))return m;
        return '\n\n'+p1+(p2||'')+'\n';
      })
      .replace(/\s+([A-Z][A-Z0-9 .'\-]{1,28})(\s*\([^)]{0,60}\))?\s+(?=[A-Za-z][a-z])/g,(m,p1,p2)=>{
        if(!looksLikeCharCue(p1))return m;
        return '\n\n'+p1+(p2||'')+'\n';
      })
      .replace(/\s+([A-Z]{2,}(?:\s+[A-Z]{2,}){0,2})\s+(?=[a-z])/g,(m,p1)=>{
        if(!looksLikeCharCue(p1)||isSH(p1))return m;
        return '\n\n'+p1+'\n';
      });
  }

  function splitCueParentheticals(t){
    return t
      .replace(/(^|\n)([A-Z][A-Z0-9 .'\-]{1,30})\s+(\([^)]{1,80}\))\s*(?=\n|[A-Za-z])/g,'$1$2\n$3\n')
      .replace(/\s+(\((?:v\.?o\.?|o\.?s\.?|o\.?c\.?|cont'?d|whispering|beat|pause|sighs|laughing|filtered|into radio|to camera)[^)]*\))/gi,'\n$1\n');
  }

  function splitSceneBlocks(t){
    return t
      .replace(/\s+(?=(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s)/gi,'\n\n')
      .replace(/((?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s+[^\n]{2,100}?[-—–]\s*(?:DAY|NIGHT|MORNING|EVENING|DUSK|DAWN|CONTINUOUS|LATER|MOMENTS))\s+(?=[A-Za-z])/gi,'$1\n\n')
      .replace(/\s+(?=(?:FADE IN|FADE OUT|CUT TO|DISSOLVE TO|SMASH CUT)\b)/gi,'\n\n')
      .replace(/\s+(\d+[A-Z]?\.)\s+(?=(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s)/gi,'\n\n$1\n');
  }

  /** Rebuild screenplay line breaks from flattened PDF / paste blobs. */
  function unflattenScreenplay(text){
    let t=String(text||'').replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/\t/g,' ');
    t=t.replace(/^\s*(FADE IN:?)\s*/i,'$1\n\n');
    t=splitSceneBlocks(t);
    t=insertCueBreaks(t);
    t=splitCueParentheticals(t);
    t=t.replace(/\s+(\([^)]{2,80}\))\s+(?=[A-Za-z"(])/g,'\n$1\n');
    t=t.replace(/([.!?])\s+(?=[A-Z][a-z])/g,'$1\n\n');
    if(isScriptFlattened(t))t=t.replace(/  +/g,'\n');
    return t.replace(/\n{3,}/g,'\n\n').trim();
  }

  /** Normalize PDF / pasted blobs — restore line breaks screenplay parsers expect. */
  function normalizeScriptText(text){
    if(!text)return'';
    let t=String(text).replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/\t/g,' ');
    if(isScriptFlattened(t))return unflattenScreenplay(t);
    const lineCount=countLines(t);
    if(lineCount<20&&t.length>250)return unflattenScreenplay(t);
    return t.replace(/\n{3,}/g,'\n\n').trim();
  }

  function normalizeScriptTextDetailed(text){
    const raw=String(text||'');
    const before=countLines(raw);
    const normalized=normalizeScriptText(raw);
    const after=countLines(normalized);
    return{text:normalized,wasFlattened:isScriptFlattened(raw)||after>before+3,before,after};
  }

  function parseQualityWarning(result){
    if(!result||!result.scenes||!result.scenes.length)return'';
    const heads=result.scenes.map(s=>(s.heading||'').trim().toUpperCase());
    const allFallback=heads.every(h=>h==='SCENE 1'||!h);
    if(allFallback&&result.scenes.length>=4)return'Parser could not find scene headings (INT./EXT.). Try .txt/.fdx or fix line breaks.';
    if(result.scenes.length>=8&&heads.filter(h=>h==='SCENE 1').length>=6)return'Many shots landed in fallback SCENE 1 — screenplay structure may be flattened (common with PDF).';
    return'';
  }

  function extractActionLineName(t,known){
    if(!t||isSH(t)||isTr(t))return null;
    const m=t.match(/^([A-Z][A-Z0-9 .'\-]{1,30}(?:\s+[A-Z][A-Z0-9 .'\-]{1,30}){0,2})\s+(?=[a-z])/);
    if(!m||!isCastMember(m[1]))return null;
    const cn=cleanCharName(m[1]);
    const words=cn.split(/\s+/);
    const paren=t.match(/^\S+(?:\s+\S+){0,2}\s*\(([^)]+)\)/);
    if(paren&&isDescriptiveParen(paren[1]))return cn;
    if(known&&known.has(cn))return cn;
    if(words.length===1&&words[0].length>=4&&!NON_NAME_WORDS.has(words[0]))return cn;
    if(words.length>=2&&words.every(w=>!NON_NAME_WORDS.has(w)))return cn;
    return null;
  }

  function extractInlineCue(t){
    if(!t||isSH(t))return null;
    const m=t.match(/^([A-Z][A-Z0-9 .'\-]{1,30})(\s*\([^)]{0,80}\))?\s+(?=[(\[]|[a-z]["'])/);
    if(!m||!isCharCueLine(m[1]+(m[2]||'')))return null;
    const ci=(m[2]||'').match(/\(([^)]+)\)/);
    const desc=ci&&ci[1]&&isDescriptiveParen(ci[1])?ci[1].trim():'';
    return{name:m[1],desc};
  }

  /** Pull character names from screenplay cues, dialogue labels, and verified action intros. */
  function extractCharactersFromText(text){
    const chars={};
    const norm=normalizeScriptText(text);
    if(!norm.trim())return chars;
    const lines=norm.split('\n');
    let inDialogue=false;
    lines.forEach(line=>{
      const t=line.trim();
      if(!t){inDialogue=false;return;}
      const fountain=t.match(/^@([A-Za-z][A-Za-z0-9 .'\-]{1,35})$/);
      if(fountain){registerChar(chars,fountain[1],'',{fromCue:true});inDialogue=true;return;}
      const inlineDlg=t.match(/^([A-Z][A-Z0-9 .'\-()]{1,35})\s*(?:\([^)]*\))?\s*:\s+/);
      if(inlineDlg){registerChar(chars,inlineDlg[1],'',{fromCue:true});inDialogue=true;return;}
      const dlgLabel=t.match(/^([A-Z][A-Z0-9 .'\-()]{1,35})\s*(?:\([^)]*\))?\s*:\s*$/);
      if(dlgLabel){registerChar(chars,dlgLabel[1],'',{fromCue:true});inDialogue=true;return;}
      if(isCharCueLine(t)){
        const ci=t.match(/\(([^)]+)\)/);
        const desc=ci&&ci[1]&&isDescriptiveParen(ci[1])?ci[1].trim():'';
        registerChar(chars,t,desc,{fromCue:true});
        inDialogue=true;
        return;
      }
      if(isSH(t)){inDialogue=false;return;}
      if(!inDialogue){
        const titleIntro=t.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s*\(([^)]+)\)/);
        if(titleIntro&&isDescriptiveParen(titleIntro[2]))registerChar(chars,titleIntro[1],titleIntro[2].trim());
        const parenIntro=t.match(/\b([A-Z][A-Z0-9 .'\-]{1,30}(?:\s+[A-Z][A-Z0-9 .'\-]{1,30}){0,2})\s*\(([^)]+)\)/);
        if(parenIntro&&isDescriptiveParen(parenIntro[2]))registerChar(chars,parenIntro[1],parenIntro[2].trim());
      }
    });
    const known=new Set(Object.keys(chars).map(cleanCharName));
    lines.forEach(line=>{
      const t=line.trim();
      if(!t||isSH(t)||isTr(t))return;
      if(isCharCueLine(t))return;
      const inlineCue=extractInlineCue(t);
      if(inlineCue){registerChar(chars,inlineCue.name,inlineCue.desc,{fromCue:true});return;}
      const actionName=extractActionLineName(t,known);
      if(actionName)registerChar(chars,actionName,'');
    });
    const titled=norm.match(/\b(?:Mr|Mrs|Ms|Dr|Det|Agent|Sgt|Officer|Captain)\.?\s+[A-Z][A-Za-z\-']{2,20}\b/g)||[];
    titled.forEach(m=>registerChar(chars,m.replace(/\./g,'').trim(),''));
    mergeCharMaps(chars,extractBackgroundCastFromText(norm));
    return filterCharacterMap(chars);
  }

  /** Detect timeline clip metadata pasted back as a "script" (not a real screenplay). */
  function isClipReconstruction(text){
    if(!text||!String(text).trim())return false;
    const t=String(text);
    const slugHits=(t.match(/(?:^|\s)(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)/gim)||[]).length;
    const lineCount=countLines(t);
    const cueHits=countCueLines(t);
    if(slugHits>=1&&(lineCount>=8||cueHits>=3))return false;
    if(cueHits>=6)return false;
    if(slugHits>=2&&lineCount>=12)return false;
    const dlgHits=(t.match(/delivering dialogue\./gi)||[]).length;
    const closeHits=(t.match(/Close on\s+[A-Z]/gi)||[]).length;
    const scene1=(t.match(/^SCENE 1\s*$/gim)||[]).length;
    if(dlgHits>=6||(closeHits>=6&&dlgHits>=3))return true;
    if(scene1>=10&&dlgHits>=3&&slugHits<1&&cueHits<3)return true;
    return false;
  }

  function mergeCharMaps(base,extra){
    const out=Object.assign({},base||{});
    Object.entries(extra||{}).forEach(([n,d])=>registerChar(out,n,d));
    return out;
  }

  function attachCharactersToShots(scenes,chars){
    if(!scenes||!chars)return;
    const names=Object.keys(chars).filter(n=>isCastMember(n));
    scenes.forEach(sc=>{
      (sc.shots||[]).forEach(sh=>{
        const found=new Set((sh.characters_in_frame||[]).filter(n=>isCastMember(n)));
        const blob=((sh.description||'')+' '+(sh.dialogue||'')).toUpperCase();
        names.forEach(n=>{
          if(nameInBlob(n,blob))found.add(cleanCharName(n));
        });
        sh.characters_in_frame=[...found];
      });
    });
  }

  function parse(text, durSec){
    const dur=durSec||5;
    const dl=dur+'-'+(dur+1)+'s';
    const lines=normalizeScriptText(text).split('\n'),scenes=[],chars={};
    let cur=null,i=0,seenFirstScene=false;
    while(i<lines.length){
      const l=lines[i],t=l.trim();
      if(!t||isTr(t)){i++;continue}
      if(isSceneNumberOnly(t)&&i+1<lines.length&&isSH(lines[i+1].trim())){i++;continue}
      if(isSH(t)){cur={heading:t,shots:[]};scenes.push(cur);seenFirstScene=true;i++;continue}
      if(!seenFirstScene&&isTitlePageLine(t)){i++;continue}
      if(!cur){
        if(!seenFirstScene&&isTitlePageLine(t)){i++;continue}
        cur={heading:'SCENE 1',shots:[]};scenes.push(cur);seenFirstScene=true;
      }
      if(isCC(t)){
        const rn=exCN(t),cn=resCN(rn,chars),ci=t.match(/\(([^)]+)\)/);
        const desc=ci&&ci[1]&&isDescriptiveParen(ci[1])?ci[1].trim():'';
        if(chars[cn]===undefined)chars[cn]=desc;
        else if(desc&&!chars[cn])chars[cn]=desc;
        i++;let par='',dl2=[];
        while(i<lines.length){
          const d=lines[i];
          if(!d.trim()||isSH(d.trim()))break;
          if(isCC(d.trim())&&!isPar(d))break;
          if(isPar(d))par=d.trim();else dl2.push(d.trim());
          i++;
        }
        if(dl2.length){
          const fd=dl2.join(' '),tp=iT(fd,!0,1),cm=iCm(fd,tp);
          let ds='Close on '+cn;if(chars[cn])ds+=' ('+chars[cn]+')';
          if(par)ds+=', '+par.replace(/[()]/g,'');
          ds+=', delivering dialogue.';
          cur.shots.push({type:tp,camera:cm,duration:dl,description:ds,dialogue:fd,characters_in_frame:[cn],cine:{}});
        }
        continue;
      }
      const ss=spS(t);
      const known=new Set(Object.keys(chars).map(cleanCharName));
      for(const s of ss){
        let m=[];
        const blob=s.toUpperCase();
        Object.keys(chars).forEach(c=>{if(nameInBlob(c,blob)&&!m.includes(c))m.push(c)});
        const im=s.match(/([A-Z][A-Z0-9 .'\-]{1,30}(?:\s+[A-Z][A-Z0-9 .'\-]{1,30}){0,2})\s*\(([^)]+)\)/);
        if(im&&isDescriptiveParen(im[2])){
          const rn=im[1].trim(),r=resCN(rn,chars);
          if(chars[r]===undefined)chars[rn]=im[2].trim();
          if(!m.includes(r))m.push(r);
          known.add(cleanCharName(r));
        }
        const titleIntro=s.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s*\(([^)]+)\)/);
        if(titleIntro&&isDescriptiveParen(titleIntro[2])){
          const rn=cleanCharName(titleIntro[1]),r=resCN(rn,chars);
          if(chars[r]===undefined)chars[rn]=titleIntro[2].trim();
          if(!m.includes(r))m.push(r);
          known.add(rn);
        }
        const actionName=extractActionLineName(s,known);
        if(actionName){
          const r=resCN(actionName,chars);
          if(!m.includes(r))m.push(r);
        }
        s.split(/\s+/).forEach(w=>{
          const u=w.replace(/[^A-Z]/g,'');
          if(u.length>=2){const r=resCN(u,chars);if(chars[r]!==undefined&&isCastMember(r)&&!m.includes(r))m.push(r)}
        });
        m=m.filter(n=>isCastMember(n));
        if(!m.length&&cur.shots.length){
          const prev=cur.shots[cur.shots.length-1];
          if(prev&&prev.characters_in_frame&&prev.characters_in_frame.length)m=prev.characters_in_frame.slice();
        }
        cur.shots.push({type:iT(s,!1,m.length),camera:iCm(s,iT(s,!1,m.length)),duration:dl,description:s,dialogue:null,characters_in_frame:m,cine:{}});
      }
      i++;
    }
    const enriched=filterCharacterMap(mergeCharMaps(chars,extractCharactersFromText(text)));
    attachCharactersToShots(scenes,enriched);
    scenes.forEach(sc=>{
      const parts=[sc.heading||''];
      (sc.shots||[]).forEach(sh=>{
        parts.push(sh.description||'');
        if(sh.dialogue)parts.push(sh.dialogue);
      });
      sc.background_cast=extractBackgroundCastFromText(parts.join('\n'));
      const present=new Set();
      let carry=[];
      (sc.shots||[]).forEach(sh=>{
        let frame=(sh.characters_in_frame||[]).filter(n=>isCastMember(n));
        if(!frame.length&&carry.length)frame=carry.slice();
        else if(frame.length)carry=frame.slice();
        sh.characters_in_frame=frame;
        frame.forEach(n=>present.add(cleanCharName(n)));
      });
      Object.keys(sc.background_cast||{}).forEach(n=>present.add(cleanCharName(n)));
      sc.characters_present=[...present];
    });
    return{scenes,characters:enriched};
  }

  function scenesToClips(result, global, clipDur){
    const clips=[];
    const labels=['Opening scene','Character intro','Dialogue','Action beat','Reaction shot','Scene transition','Climax','Resolution','Epilogue'];
    let n=0;
    result.scenes.forEach((sc,si)=>{
      sc.shots.forEach((sh,shi)=>{
        n++;
        const loc=inferLocation(sc.heading);
        const tod=inferTOD(sc.heading);
        clips.push({
          id:'clip-'+String(n).padStart(2,'0'),
          num:n,
          label:labels[(n-1)%labels.length]||('Beat '+n),
          sceneIdx:si,shotIdx:shi,
          heading:sc.heading,
          durationSec:clipDur||5,
          status:'draft',
          description:sh.description||'',
          dialogue:sh.dialogue||'',
          shotType:sh.type||'MEDIUM',
          camera:sh.camera||'STATIC',
          characters:sh.characters_in_frame||[],
          emotion:'Neutral',
          videoUrl:null,
          requestId:null,
          error:null,
          edit:{trimIn:0,trimOut:null,transition:'cut',transitionDur:0.5,speed:1,overlayFx:'',colorCorrect:''},
          params:{
            scene:{on:{location:true,timeOfDay:true,weather:false,season:false},location:loc,timeOfDay:tod,weather:'Clear',season:'Summer'},
            camera:{on:{angle:true,filmGrade:true,colorMode:true,saturation:false},angle:sh.type||'Medium',filmGrade:global.filmStyle||'35mm Grain',colorMode:'Color',saturation:'0'},
            atmosphere:{on:{lighting:true,mood:true,fx:false,sound:false},lighting:'Natural',mood:'Cinematic',fx:'',sound:''}
          }
        });
      });
    });
    return clips;
  }

  async function readFile(file){
    const name=(file.name||'').toLowerCase();
    if(name.endsWith('.txt'))return file.text();
    if(name.endsWith('.fdx'))return readFdx(file);
    if(name.endsWith('.pdf'))return readPdf(file);
    throw new Error('Unsupported file — use .txt, .fdx, or .pdf');
  }

  async function readFdx(file){
    const t=await file.text();
    const d=new DOMParser().parseFromString(t,'application/xml');
    const ps=d.getElementsByTagName('Paragraph'),ls=[];
    for(let i=0;i<ps.length;i++){
      const tp=ps[i].getAttribute('Type')||'';
      const ts=ps[i].getElementsByTagName('Text');
      let c='';for(let j=0;j<ts.length;j++)c+=ts[j].textContent;
      if(['Scene Heading','Action','Character','Dialogue','Parenthetical','Transition'].includes(tp)){
        ls.push(c);
        if(tp==='Scene Heading'||tp==='Transition')ls.push('');
      }
    }
    return ls.join('\n');
  }

  function pdfItemsToLines(items){
    const bits=items.map(it=>({
      str:String(it.str||'').replace(/\s+/g,' ').trim(),
      x:it.transform?it.transform[4]:0,
      y:it.transform?it.transform[5]:0
    })).filter(it=>it.str);
    bits.sort((a,b)=>b.y-a.y||a.x-b.x);
    const Y_TOL=5,lines=[];
    let curY=null,bucket=[];
    bits.forEach(it=>{
      if(curY===null||Math.abs(it.y-curY)>Y_TOL){
        if(bucket.length){
          bucket.sort((a,b)=>a.x-b.x);
          lines.push(bucket.map(b=>b.str).join(' ').trim());
        }
        bucket=[it];curY=it.y;
      }else bucket.push(it);
    });
    if(bucket.length){
      bucket.sort((a,b)=>a.x-b.x);
      lines.push(bucket.map(b=>b.str).join(' ').trim());
    }
    return lines;
  }

  async function readPdf(file){
    if(!window.pdfjsLib)throw new Error('PDF library not loaded');
    const buf=await file.arrayBuffer();
    const pdf=await window.pdfjsLib.getDocument({data:buf}).promise;
    const pages=[];
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      const content=await page.getTextContent();
      const pageText=pdfItemsToLines(content.items).join('\n');
      pages.push(normalizeScriptText(pageText));
    }
    return normalizeScriptText(pages.join('\n\n'));
  }

  return{parse,scenesToClips,readFile,extractCharactersFromText,extractBackgroundCastFromText,extractLocationsFromText,parseSceneHeading,inferLocation,mergeCharMaps,filterCharacterMap,isLikelyPersonName,isCastMember,countCueLines,LABEL_CUE_RE,normalizeScriptText,normalizeScriptTextDetailed,unflattenScreenplay,isScriptFlattened,isClipReconstruction,parseQualityWarning};
})();