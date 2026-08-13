/* SHOTBREAK Timeline Studio — full stack */
(function(){
'use strict';

const STORAGE_KEY='SB_Timeline_v1';
const BOOT_VERSION='20260628a';
const OWNER_EMAILS=new Set(['mz465@shotbreak.io','kz465@shotbreak.io']);
const CHAR_SKIP=new Set(['INT','EXT','FADE','CUT','CLOSE','WIDE','THE','AND','RAIN','WATER','ROOF','SCENE','OPENING','SEQUENCE','DIALOGUE','ACTION','REACTION','CLIMAX','RESOLUTION','EPILOGUE','TRANSITION','ABANDONED','WAREHOUSE','BUILDING','STREET','NIGHT','DAY','MORNING','EVENING','LOCATION','INTERIOR','EXTERIOR']);
const JUNK_CLOSE_ON_RE=/^Close on\s+((?:OPENING|TITLE|CLOSING|END|CREDIT|TEASER|PROLOGUE)\s+(?:SEQUENCE|SCENE|CREDITS)|SEQUENCE|DIALOGUE|ACTION|REACTION|TRANSITION|CLIMAX|RESOLUTION|EPILOGUE|CHARACTER\s+INTRO|OPENING\s+SCENE)/i;
const JUNK_CHAR_WORDS=new Set([
  'THE','AND','BUT','FOR','NOT','YOU','ALL','CAN','HER','WAS','ONE','OUR','OUT','ARE','HAS','HIS','HOW','ITS','MAY','NEW','NOW','OLD','SEE','WAY','WHO','DID','GET','HIT','LET','PUT','SAY','SHE','TOO','USE','WHY','ANY','DAY','END','TWO','WAR','YES','YET',
  'STOP','LOOK','THOSE','TONIGHT','THIS','WHAT','WHEN','THAT','SINCE','JUST','THEY','ROCKS','TOGETHER','READY','BESIDE','SWIFTLY','OPENING','SEQUENCE','WRITTEN','ROCKY','CLIFFTOP','HEIGHTS','DRIVE','INTERNATIONAL','AIRPORT','FEBRUARY','GERMAN',
  'FORTY','UNIT','SUN','MEDIA','EXT','INT','SCI','LONDON','CALLING','MONTREAL','OAKVILLE','SHERWOOD','MOTHERFUCKER','COCKSUCKER','FUCK','THROW','KNOW','ONLY','SURE','THINGS','LIFE','DEATH','TAXES','PAY','STRUGGLES','WILDLY','POWERFUL',
  'LAUNCHES','SCREAMS','STRAIGHTENS','JACKET','TURNS','AROUND','LEAVES','SHAKES','WALKS','ALONE','ATOP','CLIFF','WARRIORS','CHIEF','SWORN'
]);

let state={
  projectName:'Untitled Film',clips:[],characters:{},locationBible:[],selectedId:null,selectedChar:null,selectedLoc:null,
  scriptText:'',
  global:{filmStyle:'Cinematic',colorGrade:'Natural',aspectRatio:'16:9',quality:'1080p',audioProfile:'Cinematic',model:'seedance-2.0-turbo',clipDuration:5,language:'English'},
  assembly:{titleText:'',creditsText:'',musicHint:'',sfxHint:''},
  parseResult:null,queue:{running:false}
};
let history={past:[],future:[]}, curUser=null, auth=null, timelineEditorInst=null;

function $(id){return document.getElementById(id)}
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),2800)}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}
function formatTime(sec){return Math.floor(sec/60)+':'+String(Math.floor(sec%60)).padStart(2,'0')}

function snapshot(){return JSON.stringify({clips:state.clips,characters:state.characters,locationBible:state.locationBible,global:state.global,assembly:state.assembly,projectName:state.projectName,selectedId:state.selectedId,selectedLoc:state.selectedLoc})}
function pushHistory(){history.past.push(snapshot());if(history.past.length>50)history.past.shift();history.future=[];updateUndo()}
function restore(s){const d=JSON.parse(s);state.clips=d.clips||[];state.characters=d.characters||{};state.locationBible=d.locationBible||[];state.global=Object.assign(state.global,d.global||{});state.assembly=Object.assign(state.assembly,d.assembly||{});state.projectName=d.projectName||'Untitled Film';state.selectedId=d.selectedId;state.selectedLoc=d.selectedLoc||null;state.clips.forEach(ensureClip)}
function undo(){if(!history.past.length)return;history.future.push(snapshot());restore(history.past.pop());save();renderAll();toast('Undo')}
function redo(){if(!history.future.length)return;history.past.push(snapshot());restore(history.future.pop());save();renderAll();toast('Redo')}
function updateUndo(){if($('btnUndo'))$('btnUndo').disabled=!history.past.length;if($('btnRedo'))$('btnRedo').disabled=!history.future.length}

function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({clips:state.clips,characters:state.characters,locationBible:state.locationBible,global:state.global,assembly:state.assembly,parseResult:state.parseResult,projectName:state.projectName,scriptText:state.scriptText}))}catch(e){}}
function load(){try{const d=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(!d)return;if(d.clips)state.clips=d.clips;if(d.characters)state.characters=SBCharacters.normalize(d.characters);if(d.locationBible)state.locationBible=d.locationBible;if(d.global)Object.assign(state.global,d.global);if(d.assembly)Object.assign(state.assembly,d.assembly);if(d.parseResult)state.parseResult=d.parseResult;if(d.projectName)state.projectName=d.projectName;if(d.scriptText)state.scriptText=d.scriptText;state.clips.forEach(ensureClip)}catch(e){}}

function ensureClip(c){
  const sceneDef={on:{location:1,timeOfDay:1,weather:0,season:0},location:'',timeOfDay:'Day',weather:'Clear',season:'Summer'};
  const cameraDef={on:{angle:1,filmGrade:1,colorMode:1,saturation:0},angle:'Medium',filmGrade:'35mm Grain',colorMode:'Color',saturation:'0'};
  const atmosDef={on:{lighting:1,mood:1,fx:0,sound:0},lighting:'Natural',mood:'Cinematic',fx:'',sound:''};
  if(!c.params)c.params={scene:Object.assign({},sceneDef),camera:Object.assign({},cameraDef),atmosphere:Object.assign({},atmosDef)};
  if(!c.params.scene)c.params.scene=Object.assign({},sceneDef);
  if(!c.params.scene.on)c.params.scene.on=Object.assign({},sceneDef.on);
  if(!c.params.camera)c.params.camera=Object.assign({},cameraDef);
  if(!c.params.camera.on)c.params.camera.on=Object.assign({},cameraDef.on);
  if(!c.params.atmosphere)c.params.atmosphere=Object.assign({},atmosDef);
  if(!c.params.atmosphere.on)c.params.atmosphere.on=Object.assign({},atmosDef.on);
  if(c.params.scene.location==null)c.params.scene.location='';
  if(!c.edit)c.edit={trimIn:0,trimOut:null,transition:'cut',transitionDur:0.5,speed:1,overlayFx:'',colorCorrect:''};
  if(!c.emotion)c.emotion='Neutral';
}

/* Owner-token session (from /verify-owner, name + OWNER_PW_* env password).
 * Works on static deploys with no Firebase user provisioned. */
const OT_KEY='SB_OWNER_TOKEN',ON_KEY='SB_OWNER_NAME',OE_KEY='SB_OWNER_EXPIRES';
function ownerToken(){try{const tk=localStorage.getItem(OT_KEY),exp=parseInt(localStorage.getItem(OE_KEY)||'0',10);if(tk&&exp>Date.now()&&tk.split(':').length===4&&tk.startsWith('owner:'))return tk}catch(e){}return null}
function setOwnerSession(name,token,expires){
  try{localStorage.setItem(OT_KEY,token);localStorage.setItem(ON_KEY,name);localStorage.setItem(OE_KEY,String(expires))}catch(e){}
  window.SB_OWNER_TOKEN=token;
  curUser={name:name,email:name+'@shotbreak.io',isOwner:true,uid:'owner_'+name};
  $('loginOverlay').classList.add('hidden');$('userMeta').textContent=name;
}
async function getToken(){const ot=ownerToken();if(ot)return ot;if(!auth||!auth.currentUser)throw new Error('Not signed in');return auth.currentUser.getIdToken()}
async function hdrs(){return{'Content-Type':'application/json','Authorization':'Bearer '+(await getToken())}}

function initAuth(){
  const existing=ownerToken();
  if(existing)setOwnerSession(localStorage.getItem(ON_KEY)||'owner',existing,parseInt(localStorage.getItem(OE_KEY)||'0',10));
  if(window.firebase&&window.SHOTBREAK_CONFIG){
    if(!firebase.apps.length)firebase.initializeApp(window.SHOTBREAK_CONFIG.firebase);
    auth=firebase.auth();
    auth.onAuthStateChanged(u=>{
      if(u){const e=(u.email||'').toLowerCase();curUser={name:u.displayName||e.split('@')[0],email:e,isOwner:OWNER_EMAILS.has(e),uid:u.uid};$('loginOverlay').classList.add('hidden');$('userMeta').textContent=curUser.name}
      else if(!ownerToken()){curUser=null;$('loginOverlay').classList.remove('hidden')}
    });
  }
  $('loginBtn').onclick=async()=>{
    const err=$('loginErr');err.style.display='none';
    const emailRaw=$('loginEmail').value.trim(),pw=$('loginPw').value.trim();
    if(!emailRaw||!pw){err.textContent='Enter username/email and password';err.style.display='block';return}
    const short=emailRaw.toLowerCase().split('@')[0];
    // 1. Owner-short login (mz465 / kz465 + OWNER_PW_* value) via /verify-owner
    try{
      const r=await fetch('/.netlify/functions/verify-owner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:short,password:pw})});
      if(r.ok){const d=await r.json();if(d&&d.token){setOwnerSession(d.name,d.token,d.expires);return}}
    }catch(e){}
    // 2. Firebase email/password fallback
    if(!auth){err.textContent='Invalid login (and Firebase unavailable on this page)';err.style.display='block';return}
    try{await auth.signInWithEmailAndPassword(emailRaw.includes('@')?emailRaw:short+'@shotbreak.io',pw)}
    catch(e){err.textContent='Invalid username or password';err.style.display='block'}
  };
}

function cleanClipDescription(clip){
  const desc=String(clip.description||'').trim();
  if(!desc)return'';
  if(JUNK_CLOSE_ON_RE.test(desc)||/delivering dialogue\./i.test(desc)&&JUNK_CLOSE_ON_RE.test(desc)){
    if(clip.dialogue)return clip.dialogue.trim();
    if(clip.heading)return clip.heading.trim();
    return'';
  }
  const closeM=desc.match(/^Close on\s+([A-Z][A-Z0-9 .'\-]{1,40})/i);
  if(closeM&&!isValidCharacterName(closeM[1])){
    if(clip.dialogue)return clip.dialogue.trim();
    return desc.replace(/^Close on\s+[A-Z][A-Z0-9 .'\-]{1,40},?\s*/i,'').replace(/,?\s*delivering dialogue\.?/i,'').trim();
  }
  return desc;
}

function pickVideoUrl(d){
  if(!d)return null;
  if(d.video_url)return d.video_url;
  if(d.url)return d.url;
  if(d.video&&d.video.url)return d.video.url;
  const out=d.raw&&d.raw.output;
  if(out&&Array.isArray(out.urls)&&out.urls[0])return out.urls[0];
  return null;
}

function formatGenError(sd,status){
  const err=String((sd&&sd.error)||'').trim();
  const det=String((sd&&sd.detail)||'').trim();
  const code=String((sd&&sd.raw&&sd.raw.error&&sd.raw.error.code)||'').toLowerCase();
  const blob=(err+' '+det).toLowerCase();
  if(code==='insufficient_credits'||/insufficient_credits|balance is too low/.test(blob)){
    return'AI Video API credits exhausted — top up at https://aivideoapi.ai/dashboard/billing';
  }
  if(code==='spend_limit_exceeded'||/spend_limit_exceeded/.test(blob)){
    return'AI Video API key spend limit reached — raise limits at https://aivideoapi.ai/api-keys';
  }
  if(code==='ip_not_allowed'||/ip_not_allowed|ip blocked/.test(blob)){
    return'AI Video API IP blocked — clear IP allowlist on your key at https://aivideoapi.ai/api-keys';
  }
  if(code==='invalid_api_key'||/invalid_api_key/.test(blob)){
    return'AI Video API key invalid — https://aivideoapi.ai/api-keys';
  }
  if(/aivideoapi.*not configured|set_aivideoapi_key/i.test(blob)){
    return'Sora 2 not configured. Owner: run fix-aivideoapi-sora.ps1 with key from https://aivideoapi.ai/api-keys';
  }
  if(/openai.*not configured|set openai_api_key/i.test(blob)){
    return'OpenAI Sora not configured. Owner: POST {action:"set_openai_key",api_key:"sk-..."} to generate-video.';
  }
  if(/unauthorized|invalid.*key|api key/.test(blob)&&!/invalid_request/.test(blob)){
    return'Video API key misconfigured on server ('+(det||err||'check Netlify env')+').';
  }
  if(status===401)return'Session expired — sign out and sign back in.';
  if(status===503)return det||err||'Video service unavailable (API keys not configured).';
  return det||err||'Video generation failed';
}

function repairCorruptClips(){
  if(!state.clips.length)return false;
  let changed=false;
  state.clips.forEach(c=>{
    harvestTraitsFromClip(c);
    const desc=String(c.description||'');
    if(JUNK_CLOSE_ON_RE.test(desc)||(desc.includes('delivering dialogue')&&desc.match(/Close on\s+[A-Z]/i)&&!isValidCharacterName((desc.match(/Close on\s+([A-Z][A-Z0-9 .'\-]{1,40})/i)||[])[1]))){
      const dlg=c.dialogue||'';
      const head=(c.heading||'').trim();
      if(dlg){c.description=dlg.slice(0,400);changed=true}
      else if(head&&head!=='SCENE 1'){c.description=head.slice(0,400);changed=true}
      else{c.description='';changed=true}
    }
    if(c.characters&&c.characters.length){
      const clean=c.characters.filter(n=>isValidCharacterName(n));
      if(clean.length!==c.characters.length){c.characters=clean;changed=true}
    }
  });
  if(changed)save();
  return changed;
}

function buildPrompt(clip){
  const g=state.global,p=clip.params,x=[];
  if(clip.heading&&clip.heading!=='SCENE 1')x.push(clip.heading.slice(0,80)+'.');
  if(p.scene.on.location&&p.scene.location)x.push('Location: '+p.scene.location+'.');
  if(p.scene.on.timeOfDay&&p.scene.timeOfDay)x.push('Time: '+p.scene.timeOfDay+'.');
  if(p.scene.on.weather&&p.scene.weather)x.push('Weather: '+p.scene.weather+'.');
  if(p.camera.on.angle&&p.camera.angle)x.push('Camera: '+p.camera.angle+'.');
  if(p.camera.on.filmGrade&&p.camera.filmGrade)x.push('Film: '+p.camera.filmGrade+'.');
  if(p.atmosphere.on.lighting&&p.atmosphere.lighting)x.push('Lighting: '+p.atmosphere.lighting+'.');
  if(p.atmosphere.on.mood&&p.atmosphere.mood)x.push('Mood: '+p.atmosphere.mood+'.');
  if(clip.emotion)x.push('Emotion: '+clip.emotion+'.');
  x.push('Style: '+g.filmStyle+', '+g.colorGrade+'.');
  const desc=cleanClipDescription(clip);
  if(desc)x.push(desc.slice(0,300));
  if(clip.dialogue&&!desc.includes(clip.dialogue.slice(0,40)))x.push('Dialogue: "'+clip.dialogue.slice(0,120)+'"');
  let pr=x.join(' ').replace(/\s+/g,' ').trim();
  const safeClip=Object.assign({},clip,{characters:(clip.characters||[]).filter(n=>isValidCharacterName(n))});
  pr=SBCharacters.injectIntoPrompt(pr,state.characters,safeClip);
  if(window.SBContinuity&&typeof SBContinuity.enrichPromptWithContinuity==='function'){
    pr=SBContinuity.enrichPromptWithContinuity(pr,state,clip);
  }
  return pr.length>900?pr.slice(0,897)+'...':pr||'Cinematic scene shot';
}

function clipDur(c){return (c.edit.trimOut!=null?c.edit.trimOut:c.durationSec)-(c.edit.trimIn||0)}
function totalDuration(){return state.clips.reduce((a,c)=>a+clipDur(c),0)}

function cleanLocName(s){
  return String(s||'')
    .replace(/^\s*(?:at|inside|outside|near)\s+(?:the\s+)?/i,'')
    .replace(/^\s*in\s+(?:the\s+)?/i,'')
    .replace(/\s+/g,' ')
    .trim();
}
function canonicalLocName(name){
  const script=String((state&&state.scriptText)||'');
  if(window.SBLocEnrich&&typeof SBLocEnrich.canonicalLocName==='function'){
    return SBLocEnrich.canonicalLocName(name,script);
  }
  const n=cleanLocName(name);
  if(!n)return'';
  if(/montreal[\s-]*trudeau|montréal[\s-]*trudeau|pierre\s+elliott\s+trudeau|\byul\b|aéroport.*trudeau/i.test(n))return'Pierre Trudeau International Airport';
  if(/^pierre\s+trudeau\b/i.test(n)&&/airport/i.test(n))return'Pierre Trudeau International Airport';
  return n;
}
function locKeyName(name){const n=canonicalLocName(name);return n?n.toUpperCase().replace(/\s+/g,' '):''}

function scriptHasSluglines(text){
  return /^\s*(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)/im.test(String(text||''));
}

function getClipLocationRaw(clip){
  const p=clip.params&&clip.params.scene;
  const vals=[p&&p.location,clip.location,clip.sceneLocation,clip.setting&&clip.setting.location];
  for(let i=0;i<vals.length;i++){
    const v=String(vals[i]||'').trim();
    if(v)return v;
  }
  return'';
}

function parseLocFromText(raw){
  const t=String(raw||'').trim();
  if(!t)return'';
  const locTag=t.match(/\bLocation:\s*([^.;\n]{3,120})/i);
  if(locTag){
    const n=canonicalLocName(locTag[1].trim());
    if(n.length>2&&!/^SCENE\s*\d*$/i.test(n))return n;
  }
  const slug=t.match(/\b(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.?)\s+([^\n.!?\]]{2,120})/i);
  if(slug){
    const n=canonicalLocName(slug[1].split(/\s*[-—–]\s*/)[0].trim());
    if(n.length>2&&!/^SCENE\s*\d*$/i.test(n)&&!/^(DAY|NIGHT|MORNING|EVENING|CONTINUOUS)$/i.test(n))return n;
  }
  const atM=t.match(/\b(?:at|in|inside|outside|near)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 .'\-/&,]{4,100})/i);
  if(atM){
    const n=canonicalLocName(atM[1].replace(/[.,;]+$/, '').trim());
    if(n.length>4&&!/^SCENE\s*\d*$/i.test(n))return n;
  }
  const direct=canonicalLocName(t);
  if(direct.length>2&&!/^SCENE\s*\d*$/i.test(direct)&&!/^(DAY|NIGHT|MORNING|EVENING|OPENING|DIALOGUE|ACTION)$/i.test(direct))return direct;
  return'';
}

function upsertLocEntry(bible,byKey,name,heading,ci){
  const clean=canonicalLocName(name);
  if(!clean||clean.length<2||/^SCENE\s*\d*$/i.test(clean))return false;
  const key=locKeyName(clean);
  if(!key)return false;
  let loc=byKey[key];
  if(!loc){
    loc={name:clean,key,description:(heading&&heading!=='SCENE 1'?heading:clean),locked:false,plateUrl:null,consistencyPhrase:'',clipIndices:[]};
    bible.push(loc);byKey[key]=loc;
  }
  if(ci!=null&&loc.clipIndices.indexOf(ci)<0)loc.clipIndices.push(ci);
  if(heading&&heading!=='SCENE 1'&&(!loc.description||loc.description===loc.name))loc.description=heading;
  return true;
}

function countCueLines(text){
  if(SBParser&&SBParser.countCueLines)return SBParser.countCueLines(text);
  return (String(text||'').match(/^\s*[A-Z][A-Z0-9 .'\-]{1,35}\s*$/gm)||[]).length;
}

/** Script usable for full parse — sluglines or cue lines override clip-recon false positive. */
function usableScriptText(){
  const t=(state.scriptText||'').trim();
  if(!t)return'';
  if(scriptHasSluglines(t))return state.scriptText;
  if(countCueLines(t)>=2)return state.scriptText;
  if(t.length>400&&t.split(/\r?\n/).filter(l=>l.trim()).length>=15&&!isClipReconstruction(t))return state.scriptText;
  if(!isClipReconstruction(t))return state.scriptText;
  return'';
}

function screenplayText(){return usableScriptText();}

/** Always build text from timeline clips — never corrupted scriptText. */
function clipsTextBlob(){
  if(!state.clips.length)return'';
  const parts=[];
  state.clips.forEach(c=>{
    if(c.heading)parts.push(c.heading);
    const loc=getClipLocationRaw(c);
    if(loc)parts.push('Location: '+loc);
    if(c.description)parts.push(c.description);
    if(c.dialogue)parts.push(c.dialogue);
    (c.characters||[]).forEach(n=>parts.push(String(n)));
  });
  return parts.join('\n');
}

/** Best text for cast/location mining — real screenplay first, else clip metadata. */
function extractionText(){
  const script=usableScriptText();
  if(script)return script;
  const clipBlob=clipsTextBlob();
  if(clipBlob.trim())return clipBlob;
  const raw=(state.scriptText||'').trim();
  if(raw&&!isClipReconstruction(raw))return state.scriptText;
  return'';
}

function charactersNeedHydration(){
  const keys=Object.keys(state.characters||{});
  if(!keys.length)return true;
  return keys.some(k=>{const c=state.characters[k];return!c||!String(c.description||'').trim();});
}

function isDescriptiveTrait(s){
  const d=String(s||'').trim();
  if(!d||d.length<3)return false;
  if(/^(v\.?o\.?|o\.?s\.?|cont'?d|whispering|shouting|beat|pause)$/i.test(d))return false;
  if(/^(to|at|from|with|into)\s+[A-Za-z][A-Za-z .'\-]{0,30}\.?$/i.test(d))return false;
  if(/reads\s*["']\s*["']/i.test(d))return false;
  if(/^(his|her|their)\s+(?:nametag|name\s*tag|nameplate|badge)\s+reads\b/i.test(d))return false;
  return /\d|s|hair|suit|jacket|eyes|weathered|military|tall|old|young|beard|scar|worn|tailored|silver|grey|gray|dark|pale/i.test(d)||d.length>12;
}

function inferLocFromClipText(clip){
  const fields=[getClipLocationRaw(clip),clip.heading,clip.description,clip.dialogue,clip.label];
  for(let i=0;i<fields.length;i++){
    const loc=parseLocFromText(fields[i]);
    if(loc)return loc;
  }
  return'';
}

function locationsFromScriptText(text){
  if(!text||!SBParser||!SBParser.extractLocationsFromText)return{};
  const t=String(text||'');
  if(!/\b(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i.test(t)&&!/^\s*Location:\s/im.test(t))return{};
  return SBParser.extractLocationsFromText(text);
}

function mineLocationsFromParseScenes(){
  const scenes=state.parseResult&&state.parseResult.scenes;
  if(!scenes||!state.clips.length)return 0;
  let n=0;
  state.clips.forEach(clip=>{
    ensureClip(clip);
    const si=clip.sceneIdx;
    if(si==null||!scenes[si])return;
    const heading=scenes[si].heading||'';
    const loc=parseLocFromText(heading)||(SBParser.inferLocation?SBParser.inferLocation(heading):'');
    if(loc&&(!getClipLocationRaw(clip)||/^at\s+/i.test(getClipLocationRaw(clip)))){
      clip.params.scene.location=loc;
      n++;
    }
  });
  return n;
}

function harvestTraitsFromClip(clip){
  const desc=String(clip.description||'');
  const patterns=[
    /Close on\s+([A-Z][A-Z0-9 .'\-]{1,30})\s*\(([^)]+)\)/i,
    /\b([A-Z][A-Z0-9 .'\-]{1,30})\s*\(([^)]{4,200})\)/i
  ];
  for(let pi=0;pi<patterns.length;pi++){
    const m=desc.match(patterns[pi]);
    if(!m||!isValidCharacterName(m[1])||!isDescriptiveTrait(m[2]))continue;
    const up=String(m[1]).toUpperCase().trim();
    if(!state.characters[up])state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);
    const c=state.characters[up];
    const trait=m[2].trim();
    if(!c.description||trait.length>String(c.description).length)c.description=trait;
    if(!(clip.characters||[]).some(n=>String(n).toUpperCase().trim()===up)){
      clip.characters=clip.characters||[];
      clip.characters.push(up);
    }
    return up;
  }
  return null;
}

function mineProjectMetadata(){
  let changed=false;
  mineLocationsFromParseScenes();
  state.clips.forEach(clip=>{
    ensureClip(clip);
    harvestTraitsFromClip(clip);
    const loc=inferLocFromClipText(clip);
    if(loc&&(!getClipLocationRaw(clip)||String(getClipLocationRaw(clip)).trim()==='')){
      clip.params.scene.location=loc;
      changed=true;
    }
  });
  const pm=state.parseResult&&state.parseResult.characters;
  if(pm){
    Object.keys(pm).forEach(k=>{
      const up=String(k).toUpperCase().trim();
      if(!up||!isValidCharacterName(up))return;
      if(!state.characters[up])state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);
      const d=String(pm[k]||'').trim();
      if(d&&(!state.characters[up].description||d.length>String(state.characters[up].description).length)){
        state.characters[up].description=d;
        changed=true;
      }
    });
  }
  if(changed)save();
}

function bootstrapLocationsInline(){
  const bible=state.locationBible||[];
  const byKey={};
  bible.forEach(l=>{if(l&&l.key){if(!l.clipIndices)l.clipIndices=[];byKey[l.key]=l}});
  state.clips.forEach((clip,ci)=>{
    ensureClip(clip);
    const heading=clip.heading||'';
    let name=parseLocFromText(getClipLocationRaw(clip))||inferLocFromClipText(clip);
    if(SBParser&&SBParser.parseSceneHeading){
      const m=SBParser.parseSceneHeading(heading);
      if(m&&m.name)name=name||cleanLocName(m.name);
    }else{
      name=name||parseLocFromText(heading);
    }
    const si=clip.sceneIdx;
    const sc=state.parseResult&&state.parseResult.scenes&&si!=null?state.parseResult.scenes[si]:null;
    if(sc&&sc.heading){
      name=name||parseLocFromText(sc.heading)||(SBParser.inferLocation?cleanLocName(SBParser.inferLocation(sc.heading)):'');
    }
    upsertLocEntry(bible,byKey,name,heading||sc&&sc.heading,ci);
  });
  const scriptBlob=extractionText();
  Object.values(locationsFromScriptText(scriptBlob)).forEach(row=>{
    if(!row||!row.key)return;
    upsertLocEntry(bible,byKey,row.name,row.heading,null);
  });
  const scenes=state.parseResult&&state.parseResult.scenes;
  if(scenes){
    scenes.forEach(sc=>{
      const h=sc.heading||'';
      const name=parseLocFromText(h)||(SBParser.inferLocation?cleanLocName(SBParser.inferLocation(h)):'');
      upsertLocEntry(bible,byKey,name,h,null);
    });
  }
  state.locationBible=bible;
  if(!state.selectedLoc&&bible.length)state.selectedLoc=bible[0].key;
  return bible.length;
}

function bootstrapCharactersInline(){
  Object.keys(state.characters||{}).forEach(name=>{
    const c=state.characters[name];
    if(!c)return;
    if(c.desc&&!c.description)c.description=c.desc;
    delete c.desc;
    if(c.description&&String(c.description).trim())return;
    const up=String(name).toUpperCase();
    const pm=state.parseResult&&state.parseResult.characters;
    const fromParse=pm&&(pm[up]||pm[name]);
    if(fromParse&&String(fromParse).trim()){c.description=String(fromParse).trim();return}
    for(let i=0;i<state.clips.length;i++){
      const clip=state.clips[i];
      const blob=((clip.description||'')+' '+(clip.dialogue||'')+' '+(clip.heading||'')).toUpperCase();
      const inClip=(clip.characters||[]).some(n=>String(n).toUpperCase().trim()===up)||blob.includes(up);
      if(!inClip)continue;
      const desc=String(clip.description||'');
      const m=desc.match(new RegExp(up.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*\\(([^)]+)\\)','i'));
      if(m&&m[1]&&isDescriptiveTrait(m[1])){c.description=m[1].trim();return}
      if(desc.length>12&&!/^Close on\s+/i.test(desc)&&isDescriptiveTrait(desc)){c.description=desc.slice(0,300);return}
    }
  });
  try{
    if(window.SBCharacters){
      const blob=extractionText();
      const pm=(state.parseResult&&state.parseResult.characters)||{};
      if(typeof SBCharacters.hydrate==='function')SBCharacters.hydrate(state.characters,blob,state.clips,pm);
      else if(typeof SBCharacters.enrichAll==='function')SBCharacters.enrichAll(state.characters,blob,state.clips,pm);
    }
  }catch(e){console.warn('[Shotbreak] character module hydrate',e)}
  return Object.values(state.characters).filter(c=>c.description&&String(c.description).trim()).length;
}

function ensureCharactersFromClips(){
  if(!state.clips.length)return 0;
  let added=0;
  state.clips.forEach(c=>{
    (c.characters||[]).forEach(n=>{
      const up=String(n||'').toUpperCase().trim();
      if(!up||!isValidCharacterName(up))return;
      if(!state.characters[up]){state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);added++}
    });
    harvestTraitsFromClip(c);
    const desc=String(c.description||'');
    const closeM=desc.match(/Close on\s+([A-Z][A-Z0-9 .'\-]{1,30})/i);
    if(closeM&&isValidCharacterName(closeM[1])){
      const up=closeM[1].toUpperCase().trim();
      if(!state.characters[up]){state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);added++}
    }
  });
  return added;
}

/** Mine named roles + traits from clip descriptions/dialogue (background cast). */
function mineCharactersFromClips(){
  if(!state.clips.length)return 0;
  let added=0;
  const patterns=[
    /(?:^|[\n.!?]\s*)(?:A|AN|TWO|THREE|FOUR|SEVERAL)\s+([A-Z][A-Z0-9 .'\-]{2,30}(?:\s+[A-Z][A-Z0-9 .'\-]{2,30}){0,3})\s*\(([^)]{3,160})\)/gi,
    /\b([A-Z][A-Z0-9 .'\-]{2,30})\s*\(([^)]{4,160})\)\s*(?=[a-z])/gi,
    /Close on\s+([A-Z][A-Z0-9 .'\-]{1,30})\s*\(([^)]{3,160})\)/gi
  ];
  state.clips.forEach(c=>{
    const blob=[c.heading,c.description,c.dialogue].filter(Boolean).join('\n');
    patterns.forEach(re=>{
      re.lastIndex=0;
      let m;
      while((m=re.exec(blob))!==null){
        const up=String(m[1]||'').replace(/\s*\([^)]*\)\s*/g,'').trim().toUpperCase();
        if(!up||!isValidCharacterName(up))continue;
        if(!state.characters[up]){state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);added++}
        const trait=String(m[2]||'').trim();
        if(trait&&isDescriptiveTrait(trait)){
          const ch=state.characters[up];
          if(!ch.description||trait.length>String(ch.description).length)ch.description=trait;
        }
        if(!(c.characters||[]).some(n=>String(n).toUpperCase().trim()===up)){
          c.characters=c.characters||[];
          c.characters.push(up);
        }
      }
    });
    const cueLines=blob.match(/^\s*([A-Z][A-Z0-9 .'\-]{2,30})\s*$/gm)||[];
    cueLines.forEach(line=>{
      const up=String(line).trim().toUpperCase();
      if(!isValidCharacterName(up))return;
      if(!state.characters[up]){state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);added++}
    });
  });
  if(added)save();
  return added;
}

function repairAllCharacterDescriptions(){
  if(window.SBEnrich&&typeof SBEnrich.repairAllCharacterDescriptions==='function'){
    return SBEnrich.repairAllCharacterDescriptions(state.characters);
  }
  if(window.SBCharacters&&typeof SBCharacters.sanitizeDescription==='function'){
    let n=0;
    Object.keys(state.characters||{}).forEach(name=>{
      const c=state.characters[name];
      if(!c||c._descLocked)return;
      const clean=SBCharacters.sanitizeDescription(c.description||'',name);
      if(clean!==(c.description||'')){c.description=clean;n++}
    });
    return n;
  }
  return 0;
}

function masteryStats(){
  const names=Object.keys(state.characters);
  const charFilled=Object.values(state.characters).filter(c=>c.description&&String(c.description).trim()).length;
  const locN=(state.locationBible||[]).length;
  const clipsWithLoc=state.clips.filter(c=>!!parseLocFromText(getClipLocationRaw(c))||!!inferLocFromClipText(c)).length;
  const el=$('tbBuildVer');
  if(el)el.textContent='build '+BOOT_VERSION+' · '+locN+' loc ('+clipsWithLoc+'/'+state.clips.length+' clips) · '+charFilled+'/'+names.length+' chars';
  return{locN,charFilled,total:names.length,clipsWithLoc};
}

/** Layer 1 — local structure: parse, cast names, locations. No LLM, no heavy hydrate. */
function bootstrapStructure(force,opts){
  opts=opts||{};
  mineProjectMetadata();
  ensureCharactersFromClips();
  if(!opts.skipClipMine)mineCharactersFromClips();
  repairCharactersFromClips();
  const script=usableScriptText();
  const extractBlob=extractionText();
  try{
    if(script&&SBParser&&SBParser.parse&&(force||!state.parseResult||!state.parseResult.scenes)){
      const norm=normalizeImportedScript(script).text;
      state.parseResult=SBParser.parse(norm,parseInt(state.global.clipDuration,10)||5);
      if(norm&&norm!==state.scriptText){state.scriptText=norm;save()}
    }
    syncCharactersFromParse(state.parseResult||{characters:{},scenes:[]},extractBlob,{skipHydrate:true});
  }catch(e){console.warn('[Shotbreak] parse',e)}
  if(force)state.locationBible=[];
  backfillClipLocationsFromParse();
  ensureShotOneLocation();
  bootstrapLocationsInline();
  if(window.SBContinuity&&typeof SBContinuity.applyGraph==='function'){
    try{SBContinuity.applyGraph(state)}catch(e){console.warn('[Shotbreak] SBContinuity',e)}
  }
  if(window.SBLocations&&typeof SBLocations.syncAll==='function'){
    try{state.locationBible=SBLocations.syncAll(state,extractionText())}catch(e){console.warn('[Shotbreak] SBLocations',e)}
  }
  if(window.SBLocEnrich&&typeof SBLocEnrich.buildLocalAliasMap==='function'){
    try{
      const trusted=(state.locationBible||[]).map(function(l){return l&&l.key;}).filter(Boolean);
      const aliasMap=SBLocEnrich.buildLocalAliasMap(trusted,state.scriptText||'');
      SBLocEnrich.mergeLocationBible(state,aliasMap);
      SBLocEnrich.applyAliasesToClips(state,aliasMap);
      if(window.SBContinuity&&typeof SBContinuity.applyGraph==='function')SBContinuity.applyGraph(state);
    }catch(e){console.warn('[Shotbreak] SBLocEnrich local merge',e)}
  }
  repairAllCharacterDescriptions();
  applyCastRoles(state.characters,state.clips);
  const names=Object.keys(state.characters);
  if(names.length&&!state.selectedChar)state.selectedChar=names[0];
  if((state.locationBible||[]).length&&!state.selectedLoc)state.selectedLoc=state.locationBible[0].key;
  save();
  return masteryStats();
}

function bootstrapMastery(force,opts){
  opts=opts||{};
  const r=bootstrapStructure(force,opts);
  if(!opts.skipHydrate){
    try{hydrateAllCharacters(force)}catch(e){console.warn('[Shotbreak] hydrateAllCharacters',e)}
    bootstrapCharactersInline();
    repairAllCharacterDescriptions();
    save();
    return masteryStats();
  }
  return r;
}

/** Layer 2 — Grok character enricher on explicit sync / import. */
async function syncMasteryWithAgent(force){
  const r=bootstrapStructure(force,{skipClipMine:false});
  let agentMsg='';
  if(window.SBEnrich&&typeof SBEnrich.enrichViaAgent==='function'){
    try{
      if(auth&&auth.currentUser)toast('Extracting character bible…');
      const ar=await SBEnrich.enrichViaAgent(state,{getHeaders:hdrs});
      if(ar.ok){
        agentMsg=' · AI enriched '+ar.merged+'/'+ar.total;
      }else if(ar.reason==='not_signed_in'||ar.reason==='no_auth'){
        agentMsg=' · sign in for AI character bible';
        try{hydrateAllCharacters(true)}catch(e){}
        bootstrapCharactersInline();
      }else if(ar.fallback){
        agentMsg=' · local extract (AI unavailable)';
        try{hydrateAllCharacters(true)}catch(e){}
        bootstrapCharactersInline();
      }else{
        agentMsg=' · agent: '+ar.reason;
      }
    }catch(e){
      console.warn('[Shotbreak] enrichViaAgent',e);
      agentMsg=' · local extract fallback';
      try{hydrateAllCharacters(true)}catch(err){}
      bootstrapCharactersInline();
    }
  }else{
    try{hydrateAllCharacters(true)}catch(e){}
    bootstrapCharactersInline();
  }
  let locMsg='';
  if(window.SBLocEnrich&&typeof SBLocEnrich.enrichViaAgent==='function'){
    try{
      if(auth&&auth.currentUser)toast('Merging locations across scenes…');
      const lr=await SBLocEnrich.enrichViaAgent(state,{getHeaders:hdrs});
      if(lr.ok){
        locMsg=' · '+lr.total+' loc'+(lr.merged?' ('+lr.merged+' merged)':'')+(lr.enriched?' · AI atmosphere':'' );
      }else if(lr.merged){
        locMsg=' · '+lr.merged+' location'+(lr.merged===1?'':'s')+' merged locally';
        if(lr.fallback)locMsg+=' (sign in for AI atmosphere)';
      }else if(lr.reason==='not_signed_in'){
        locMsg=' · sign in to merge locations with AI';
      }
      renderLocations();
    }catch(e){
      console.warn('[Shotbreak] enrichLocations',e);
      locMsg=' · location merge fallback';
    }
  }
  repairAllCharacterDescriptions();
  save();
  const stats=masteryStats();
  stats.agentMsg=agentMsg+locMsg;
  return stats;
}

function masterySyncMessage(r){
  const extra=r&&r.agentMsg?r.agentMsg:'';
  if(!r.total&&!r.locN){
    if(r.clipsWithLoc&&!r.locN)return'Found location on '+r.clipsWithLoc+' clips but bible empty — hard refresh (Ctrl+Shift+R)';
    return'No locations found — set Location on a clip (right panel) or re-import script with INT./EXT. lines';
  }
  return r.charFilled+'/'+r.total+' chars · '+r.locN+' locations synced'+extra;
}

function hydrateAllCharacters(force){
  const script=screenplayText();
  let blob=extractionText();
  if(!blob.trim()&&!state.clips.length)return;

  if(script&&SBParser&&SBParser.parse){
    const norm=normalizeImportedScript(script).text;
    const dur=parseInt(state.global.clipDuration,10)||5;
    if(force||!state.parseResult||!Object.keys(state.parseResult.characters||{}).length){
      state.parseResult=SBParser.parse(norm,dur);
    }
    const parseMap=state.parseResult.characters||{};
    Object.keys(parseMap).forEach(k=>{
      const up=String(k).toUpperCase().trim();
      if(!up||!isValidCharacterName(up))return;
      if(!state.characters[up])state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);
      const d=String(parseMap[k]||'').trim();
      if(d&&(!state.characters[up].description||d.length>String(state.characters[up].description||'').length)){
        state.characters[up].description=d;
      }
    });
    if(force||charactersNeedHydration())syncCharactersFromParse(state.parseResult,norm);
    if(SBCharacters&&typeof SBCharacters.hydrate==='function')SBCharacters.hydrate(state.characters,norm,state.clips,parseMap);
    else bootstrapCharactersInline();
  }else{
    if(!Object.keys(state.characters).length){
      rebuildCharactersFromProject();
      repairCharactersFromClips();
    }
    let parseMap=(state.parseResult&&state.parseResult.characters)||{};
    if(script&&SBParser.extractCharactersFromText){
      parseMap=SBParser.mergeCharMaps(parseMap,SBParser.extractCharactersFromText(script));
    }
    if(SBCharacters&&typeof SBCharacters.hydrate==='function')SBCharacters.hydrate(state.characters,blob,state.clips,parseMap);
    else bootstrapCharactersInline();
  }
  save();
}
function ensureCharacterDetails(){
  if(state.clips.length||state.scriptText)bootstrapMastery(false,{skipHydrate:true});
}
function renderAll(){
  $('projectTitle').textContent=state.projectName;
  repairCorruptClips();
  if(state.clips.length||state.scriptText)bootstrapMastery(false,{skipHydrate:true});
  renderTimeline();renderScriptEditor();renderAssembly();renderCharacters();renderLocations();renderOutput();renderDetail();updateUndo();
  if(window.SBBudget)SBBudget.refresh(state);
  openSidePanelsIfNeeded();
}
function openSidePanelsIfNeeded(){
  if(!state.clips.length)return;
  document.querySelectorAll('.module-panel').forEach(panel=>{
    const sum=panel.querySelector('summary');
    const label=sum?sum.textContent.trim():'';
    if(label==='Characters'||label==='Locations')panel.open=true;
  });
}
function ensureShotOneLocation(){
  if(!state.clips.length)return false;
  const scenes=state.parseResult&&state.parseResult.scenes;
  if(!scenes||!scenes.length)return false;
  const clip=state.clips[0];
  const heading=scenes[0].heading||'';
  const loc=canonicalLocName(
    SBParser.inferLocation?SBParser.inferLocation(heading):
    (SBParser.parseSceneHeading?SBParser.parseSceneHeading(heading).name:'')
  );
  if(!loc)return false;
  ensureClip(clip);
  let changed=false;
  if(clip.sceneIdx==null){clip.sceneIdx=0;changed=true}
  const raw=getClipLocationRaw(clip);
  if(!raw||raw==='SCENE 1'||/^at\s+/i.test(raw)){
    clip.params.scene.location=loc;changed=true;
  }
  if(heading&&heading!=='SCENE 1'&&(!clip.heading||clip.heading==='SCENE 1')){
    clip.heading=heading;changed=true;
  }
  if(changed)save();
  return changed;
}

function backfillClipLocationsFromParse(){
  const scenes=state.parseResult&&state.parseResult.scenes;
  if(!scenes||!state.clips.length)return;
  let changed=false;
  state.clips.forEach(clip=>{
    const si=clip.sceneIdx;
    if(si==null||!scenes[si])return;
    const heading=scenes[si].heading||'';
    const loc=SBParser.inferLocation?SBParser.inferLocation(heading):(SBParser.parseSceneHeading?SBParser.parseSceneHeading(heading).name:'');
    ensureClip(clip);
    const cleanLoc=loc?canonicalLocName(String(loc).replace(/^\s*(?:at|in|on|inside|outside|near)\s+(?:the\s+)?/i,'').trim()):'';
    if(cleanLoc&&(!clip.params.scene.location||clip.params.scene.location===''||/^at\s+/i.test(clip.params.scene.location))){
      clip.params.scene.location=cleanLoc;changed=true;
    }
    if(heading&&heading!=='SCENE 1'&&(!clip.heading||clip.heading==='SCENE 1')){
      clip.heading=heading;changed=true;
    }
  });
  if(changed)save();
  ensureShotOneLocation();
}
function syncLocationBibleFromClips(){
  bootstrapLocationsInline();
  if(window.SBLocations&&typeof SBLocations.syncAll==='function'){
    try{state.locationBible=SBLocations.syncAll(state)}catch(e){}
  }
  if(state.selectedLoc&&!state.locationBible.some(l=>l.key===state.selectedLoc)){
    state.selectedLoc=state.locationBible.length?state.locationBible[0].key:null;
  }
  return true;
}

/** Read screenplay from textarea, falling back to stored scriptText. */
function scriptEditorText(){
  const ta=$('scriptEditor');
  const stored=(state.scriptText||'').trim();
  if(!ta)return stored;
  const live=(ta.value||'').trim();
  if(live)return ta.value;
  return state.scriptText||'';
}

/** Persist textarea → state.scriptText before parse/import. */
function flushScriptEditor(){
  const ta=$('scriptEditor');
  const raw=ta?(ta.value||''):(state.scriptText||'');
  const trimmed=raw.trim();
  if(trimmed){
    state.scriptText=raw;
    save();
  }
  return trimmed?raw:(state.scriptText||'');
}

function isClipReconstruction(text){
  if(SBParser.isClipReconstruction)return SBParser.isClipReconstruction(text);
  const t=String(text||'');
  return (t.match(/^SCENE 1\s*$/gim)||[]).length>=3||(t.match(/delivering dialogue\./gi)||[]).length>=2;
}

function updateScriptMeta(){
  const text=scriptEditorText();
  const lines=text?text.split(/\r?\n/).length:0;
  const chars=text.length;
  const summary=lines+' lines · '+chars+' chars'+(state.clips.length?' · '+state.clips.length+' clips':'');
  const meta=$('scriptMeta');
  if(meta)meta.textContent=summary;
  const bar=$('scriptBarMeta');
  if(bar){
    if(!text.trim())bar.textContent='No screenplay yet — click ✎ Open script editor';
    else if(isClipReconstruction(text))bar.textContent='⚠ Corrupted clip text — open editor & use + New script';
    else if(SBParser.isScriptFlattened&&SBParser.isScriptFlattened(text))bar.textContent='⚠ Flattened script — open editor & click Unflatten';
    else bar.textContent=summary;
  }
}

function rebuildScriptFromParse(){
  const scenes=state.parseResult&&state.parseResult.scenes;
  if(!scenes||!scenes.length)return'';
  const parts=[];
  scenes.forEach(function(sc){
    if(sc.heading)parts.push(String(sc.heading).trim());
    (sc.shots||[]).forEach(function(sh){
      if(sh.description)parts.push(String(sh.description).trim());
      if(sh.dialogue){
        const cue=(sh.characters_in_frame&&sh.characters_in_frame[0])||'';
        if(cue)parts.push(String(cue).toUpperCase().trim());
        parts.push(String(sh.dialogue).trim());
      }
    });
    parts.push('');
  });
  return parts.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

async function recoverCorruptScript(){
  const rebuilt=rebuildScriptFromParse();
  if(!rebuilt||rebuilt.length<80){
    toast('No parse data to recover from — import your .txt / .pdf / .fdx file');
    openScriptPanel();
    return false;
  }
  pushHistory();
  state.scriptText=rebuilt;
  const ta=$('scriptEditor');
  if(ta){ta.value=rebuilt;ta._focused=false}
  save();
  renderScriptWarn(rebuilt);
  updateScriptMeta();
  if(isClipReconstruction(rebuilt)){
    toast('Recovery still looks thin — best fix is re-importing your original screenplay file');
    return false;
  }
  await importText(rebuilt,{fromRecovery:true});
  toast('Recovered screenplay from parse — review in script editor');
  return true;
}

function renderScriptWarn(text){
  const el=$('scriptWarn');
  if(!el)return;
  const corrupt=isClipReconstruction(text);
  if(corrupt){
    el.classList.remove('hidden');
    const canRecover=!!(state.parseResult&&state.parseResult.scenes&&state.parseResult.scenes.length);
    el.innerHTML='<strong>Not your original screenplay.</strong> This box has broken clip-reconstruction text. '+
      (canRecover?'<button type="button" class="tb-btn gold" id="btnRecoverScript" style="margin:8px 8px 0 0">↻ Recover from parse</button>':'')+
      ' Or click <strong>+ New script</strong> and re-import your .txt / .pdf / .fdx.';
    const btn=$('btnRecoverScript');
    if(btn)btn.onclick=function(){recoverCorruptScript()};
    return;
  }
  if(state.clips.length&&!text.trim()){
    el.classList.remove('hidden');
    el.innerHTML='<strong>No screenplay stored.</strong> Import or paste your original script here. The timeline clips alone cannot rebuild a proper screenplay.';
    return;
  }
  el.classList.add('hidden');
  el.innerHTML='';
}

function renderScriptEditor(){
  const ta=$('scriptEditor');
  if(!ta)return;
  if(!ta._focused){
    const blob=state.scriptText||'';
    if(blob&&ta.value!==blob)ta.value=blob;
  }
  renderScriptWarn(scriptEditorText());
  updateScriptMeta();
}

function openScriptPanel(){
  renderScriptEditor();
  const modal=$('scriptModal');
  if(modal)modal.classList.remove('hidden');
  const ta=$('scriptEditor');
  if(ta)setTimeout(()=>ta.focus(),120);
}
function closeScriptPanel(){
  syncScriptFromEditor();
  const modal=$('scriptModal');
  if(modal)modal.classList.add('hidden');
}

function syncScriptFromEditor(){
  const ta=$('scriptEditor');
  if(!ta)return'';
  const val=ta.value;
  if(isClipReconstruction(val)){
    renderScriptWarn(val);
    updateScriptMeta();
    return val;
  }
  state.scriptText=val;
  save();
  renderScriptWarn(val);
  updateScriptMeta();
  return state.scriptText;
}

function startNewScript(){
  const has=!!(state.clips.length||state.scriptText||(scriptEditorText()||'').trim());
  if(has&&!confirm('Start a new script? This clears the timeline, characters, and stored screenplay. Rendered videos in this session are removed from the timeline (downloads are kept).'))return;
  pushHistory();
  state.scriptText='';
  state.clips=[];
  state.characters={};
  state.parseResult=null;
  state.selectedId=null;
  state.selectedChar=null;
  const ta=$('scriptEditor');
  if(ta){ta.value='';ta._focused=false}
  save();renderAll();openScriptPanel();toast('Ready for a new script — paste or import below');
}

function normalizeImportedScript(raw){
  if(SBParser.normalizeScriptTextDetailed)return SBParser.normalizeScriptTextDetailed(raw);
  const norm=SBParser.normalizeScriptText?SBParser.normalizeScriptText(raw):raw;
  const before=String(raw||'').split('\n').filter(l=>l.trim()).length;
  const after=String(norm||'').split('\n').filter(l=>l.trim()).length;
  return{text:norm,wasFlattened:after>before+3,before,after};
}

function unflattenScriptFromEditor(){
  const ta=$('scriptEditor');
  const raw=ta?(ta.value||''):state.scriptText||'';
  if(!raw.trim()){toast('Paste or import a screenplay first');openScriptPanel();return}
  if(isClipReconstruction(raw)){
    toast('That is broken clip text — use + New script and import your real file');
    openScriptPanel();
    return;
  }
  const flat=SBParser.isScriptFlattened?SBParser.isScriptFlattened(raw):false;
  const norm=normalizeImportedScript(raw);
  pushHistory();
  state.scriptText=norm.text;
  if(ta){ta.value=norm.text;ta._focused=false}
  save();renderScriptEditor();
  if(norm.wasFlattened||flat){
    toast('Unflattened screenplay · '+norm.before+' → '+norm.after+' lines');
  }else{
    toast('Script already has line breaks ('+norm.after+' lines)');
  }
}

async function reparseScriptFromEditor(){
  const text=flushScriptEditor().trim();
  if(!text){toast('Paste or type a screenplay in the Script panel first');openScriptPanel();return}
  if(isClipReconstruction(text)){
    toast('This is reconstructed clip junk — use + New script and re-import your real screenplay');
    openScriptPanel();
    return;
  }
  const hasWork=state.clips.length>0;
  const hasRendered=state.clips.some(c=>c.videoUrl||c.status==='approved');
  if(hasWork){
    let msg='Re-parse and replace the timeline from your edited script?';
    if(hasRendered)msg+=' Clips with generated video will be rebuilt (you may need to re-generate).';
    if(!confirm(msg))return;
  }
  await importText(text,{fromEditor:true});
  openScriptPanel();
}

function renderTimeline(){
  const has=state.clips.length>0;
  $('importZone').classList.toggle('hidden',has);
  $('timelineSection').classList.toggle('hidden',!has);
  if($('flowHint'))$('flowHint').classList.toggle('hidden',has);
  if(!has){$('clipRow').innerHTML='';$('timeRuler').innerHTML='';return}
  let t=0,ticks=[];
  state.clips.forEach(c=>{ticks.push('<span class="time-tick">'+formatTime(t)+'</span>');t+=clipDur(c)});
  ticks.push('<span class="time-tick">'+formatTime(t)+'</span>');
  $('timeRuler').innerHTML=ticks.join('');
  $('clipRow').innerHTML=state.clips.map(c=>{
    const st=c.status==='approved'?'approved':c.status==='done'?'done':c.status==='generating'?'gen':'';
    const th=c.videoUrl?'<video src="'+c.videoUrl+'" muted loop playsinline></video>':'<span class="ph">🎬</span>';
    return '<div class="clip-card'+(c.id===state.selectedId?' active':'')+(c.status==='approved'?' approved':'')+'" data-id="'+c.id+'" draggable="true"><div class="clip-status '+st+'"></div><div class="clip-num">Clip '+String(c.num).padStart(2,'0')+'</div><div class="clip-thumb">'+th+'</div><div class="clip-label">'+esc(c.label)+'</div><div class="clip-dur">~'+c.durationSec+'s</div></div>';
  }).join('');
  $('clipRow').querySelectorAll('.clip-card').forEach(el=>{
    el.onclick=()=>{state.selectedId=el.dataset.id;renderAll()};
    el.ondragstart=e=>e.dataTransfer.setData('text/plain',el.dataset.id);
    el.ondragover=e=>e.preventDefault();
    el.ondrop=e=>{e.preventDefault();reorder(el.dataset.id,e.dataTransfer.getData('text/plain'))};
  });
  $('clipCount').textContent=state.clips.length+' clips · '+formatTime(totalDuration());
}

function reorder(toId,fromId){
  if(!fromId||fromId===toId)return;pushHistory();
  const fi=state.clips.findIndex(c=>c.id===fromId),ti=state.clips.findIndex(c=>c.id===toId);
  if(fi<0||ti<0)return;
  const[item]=state.clips.splice(fi,1);state.clips.splice(ti,0,item);
  state.clips.forEach((c,i)=>{c.num=i+1;c.id='clip-'+String(i+1).padStart(2,'0')});
  save();renderAll();
}

function renderDetail(){
  const clip=state.clips.find(c=>c.id===state.selectedId),body=$('detailBody');
  if(!clip){body.innerHTML='<div class="detail-empty">Select a clip to edit and generate.</div>';$('detailTitle').textContent='Clip';return}
  const label=clip.label.length>28?clip.label.slice(0,26)+'…':clip.label;
  $('detailTitle').textContent='Clip '+String(clip.num).padStart(2,'0')+' · '+label;
  const p=clip.params;
  let locHint='';
  if(window.SBLocations){
    const meta=SBLocations.clipLocationMeta(clip);
    const locEntry=(state.locationBible||[]).find(l=>l.key===meta.key);
    if(locEntry&&locEntry.locked){
      locHint='<div style="font-size:11px;color:var(--gold);margin-bottom:10px;padding:8px 10px;background:rgba(212,168,67,.08);border:1px solid rgba(212,168,67,.3);border-radius:8px">🔒 Location locked: <strong>'+esc(locEntry.name)+'</strong>'+(locEntry.plateUrl?' · plate attached':'')+'</div>';
    }else if(meta.name){
      locHint='<div style="font-size:11px;color:var(--dim);margin-bottom:10px">📍 '+esc(meta.name)+' — lock in <strong>Locations</strong> panel below timeline</div>';
    }
  }
  if(window.SBContinuity&&typeof SBContinuity.blockForClip==='function'){
    const ci=state.clips.findIndex(c=>c.id===clip.id);
    const blk=SBContinuity.blockForClip(state,ci);
    if(blk){
      const cast=[].concat(blk.leads||[],blk.supporting||[],blk.background||[]).filter(Boolean);
      const castPreview=cast.slice(0,6).join(', ')+(cast.length>6?'…':'');
      locHint+='<div style="font-size:11px;color:var(--text2);margin-bottom:10px;padding:8px 10px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px">🔗 Scene block · '+esc(blk.continuity||'new')+
        (blk.locationName?' · <strong>'+esc(blk.locationName)+'</strong>':'')+
        (castPreview?' · cast: '+esc(castPreview):'')+'</div>';
    }
  }
  body.innerHTML=locHint+
    '<div class="field"><label>Scene</label><textarea id="d-desc" rows="3">'+esc(clip.description)+'</textarea></div>'+
    '<div class="field"><label>Emotion</label><select id="d-emotion">'+['Neutral','Tense','Joy','Fear','Anger','Sad','Noir'].map(e=>'<option'+(clip.emotion===e?' selected':'')+'>'+e+'</option>').join('')+'</select></div>'+
    '<details class="detail-section"><summary>AI prompt</summary><div class="section-inner"><textarea id="d-prompt" readonly rows="4">'+esc(buildPrompt(clip))+'</textarea></div></details>'+
    '<details class="detail-section"><summary>Scene &amp; setting</summary><div class="section-inner">'+mkTog(p.scene,'location','Location')+mkTog(p.scene,'timeOfDay','Time')+mkTog(p.scene,'weather','Weather')+mkTog(p.scene,'season','Season')+'</div></details>'+
    '<details class="detail-section"><summary>Camera</summary><div class="section-inner">'+mkTog(p.camera,'angle','Angle')+mkTog(p.camera,'filmGrade','Film grade')+mkTog(p.camera,'colorMode','Color')+mkTog(p.camera,'saturation','Saturation')+'</div></details>'+
    '<details class="detail-section"><summary>Atmosphere</summary><div class="section-inner">'+mkTog(p.atmosphere,'lighting','Lighting')+mkTog(p.atmosphere,'mood','Mood')+mkTog(p.atmosphere,'fx','FX')+mkTog(p.atmosphere,'sound','Sound')+'</div></details>'+
    (clip.error?'<div class="err">'+esc(clip.error)+'</div>':'');
  $('d-desc').oninput=e=>{clip.description=e.target.value;save();const pr=$('d-prompt');if(pr)pr.value=buildPrompt(clip)};
  $('d-emotion').onchange=e=>{clip.emotion=e.target.value;save();const pr=$('d-prompt');if(pr)pr.value=buildPrompt(clip)};
  body.querySelectorAll('.toggle').forEach(t=>{t.onclick=()=>{const g=clip.params[t.dataset.grp];g.on[t.dataset.f]=!g.on[t.dataset.f];t.classList.toggle('on',g.on[t.dataset.f]);save();const pr=$('d-prompt');if(pr)pr.value=buildPrompt(clip)}});
  body.querySelectorAll('input[data-grp]').forEach(inp=>{inp.oninput=()=>{clip.params[inp.dataset.grp][inp.dataset.f]=inp.value;save();const pr=$('d-prompt');if(pr)pr.value=buildPrompt(clip)}});
}
function mkTog(grp,f,label){return '<div class="field"><label><span>'+label+'</span><span class="toggle'+(grp.on[f]?' on':'')+'" data-grp="'+(['location','timeOfDay','weather','season'].includes(f)?'scene':['angle','filmGrade','colorMode','saturation'].includes(f)?'camera':'atmosphere')+'" data-f="'+f+'"></span></label><input data-grp="'+(['location','timeOfDay','weather','season'].includes(f)?'scene':['angle','filmGrade','colorMode','saturation'].includes(f)?'camera':'atmosphere')+'" data-f="'+f+'" value="'+esc(grp[f]||'')+'"></div>'}

function clipsForEditor(){
  const withVideo=state.clips.filter(c=>c.videoUrl);
  const approved=withVideo.filter(c=>c.status==='approved');
  return approved.length?approved:withVideo;
}
function initTimelineEditor(){
  if(timelineEditorInst||!window.SBTimelineEditor||!$('tle-binItems'))return;
  timelineEditorInst=window.SBTimelineEditor.create({
    prefix:'tle-',
    storageKey:'SB_Editor_embed_v1',
    embedded:true,
    projectName:state.projectName
  });
  timelineEditorInst.init({onSync:syncTimelineEditor,onProCut:runProCut});
}
async function runProCut(){
  if(!window.SBProCut)return toast('Pro Cut module not loaded — hard refresh');
  const ok=clipsForEditor();
  if(!ok.length)return toast('Generate clips first');
  const panel=$('editorPanel');
  if(panel)panel.open=true;
  if(!timelineEditorInst)initTimelineEditor();
  const log=$('tle-agentLog');
  const prog=(msg)=>{if(log){const line=document.createElement('div');line.className='line info';line.textContent=msg;log.appendChild(line);log.scrollTop=log.scrollHeight}};
  const btn=$('tle-btnProCut');
  if(btn)btn.disabled=true;
  try{
    prog('Pro Cut starting…');
    const result=await SBProCut.run(ok,{
      projectName:state.projectName,
      onProgress:prog,
    });
    SBProCut.applyToTimelineClips(state.clips,result.edl);
    save();
    if(timelineEditorInst)await timelineEditorInst.applyProCut(result.edl);
    toast('Pro Cut ready — review track, then Render MP4');
  }catch(e){
    toast(e.message||'Pro Cut failed');
    prog('Pro Cut failed: '+(e.message||e));
  }
  if(btn)btn.disabled=false;
}
function syncTimelineEditor(){
  if(!timelineEditorInst)initTimelineEditor();
  if(!timelineEditorInst)return toast('Editor not ready');
  const ok=clipsForEditor();
  if(!ok.length)return toast('Generate clips first');
  if(!state.clips.filter(c=>c.status==='approved'&&c.videoUrl).length)toast('Using unapproved clips — approve for final export');
  timelineEditorInst.syncFromClips(ok,{clipDuration:clipDur});
}
function openEditorPanel(){
  const panel=$('editorPanel');
  if(panel)panel.open=true;
  syncTimelineEditor();
}
function renderAssembly(){
  const hint=$('tle-syncHint');
  if(!hint)return;
  const n=state.clips.filter(c=>c.videoUrl).length;
  const a=state.clips.filter(c=>c.status==='approved'&&c.videoUrl).length;
  hint.textContent=n?(a?a+' approved · '+n+' with video — Pro Cut or Sync':'No approved clips — Pro Cut uses all generated clips'):'Generate clips, then Pro Cut';
}

function deleteCharacter(name){
  const up=String(name||'').trim();
  if(!up||!state.characters[up])return;
  if(!confirm('Delete "'+up+'"? They will be removed from the character list and all clips.'))return;
  pushHistory();
  delete state.characters[up];
  state.clips.forEach(c=>{
    if(!c.characters)return;
    c.characters=c.characters.filter(n=>String(n).toUpperCase().trim()!==up);
  });
  const remaining=Object.keys(state.characters);
  state.selectedChar=remaining.includes(state.selectedChar)?state.selectedChar:(remaining[0]||null);
  save();
  renderCharacters();
  renderTimeline();
  toast('Deleted '+up);
}

function renderCharacters(){
  let listHtml=SBCharacters.renderList(state.characters,state.selectedChar);
  if(!Object.keys(state.characters).length&&state.clips.length){
    listHtml='<div style="padding:10px 12px;margin-bottom:10px;background:rgba(212,168,67,.08);border:1px solid rgba(212,168,67,.35);border-radius:8px;font-size:12px;line-height:1.5;color:var(--text2)">'+
      '<strong style="color:var(--gold)">Characters empty</strong> — click <strong>↻ Sync from parse</strong> or <strong>re-import</strong> your script (Import / Paste). Names must be in screenplay format (ALL CAPS cue lines or <em>Name: dialogue</em>).</div>'+listHtml;
  }
  $('charListPanel').innerHTML=listHtml;
  $('charListPanel').querySelectorAll('.char-card').forEach(el=>{
    el.onclick=()=>{state.selectedChar=el.dataset.name;renderCharacters()};
  });
  $('charListPanel').querySelectorAll('.char-del').forEach(btn=>{
    btn.onclick=e=>{e.stopPropagation();deleteCharacter(btn.dataset.del)};
  });
  const stripNames=charsForStrip();
  if($('charsStrip'))$('charsStrip').classList.toggle('hidden',!stripNames.length);
  $('charChips').innerHTML=stripNames.map(n=>'<span class="char-chip">'+esc(n)+'</span>').join('');
  renderCharEditor();
}
function renderCharEditor(){
  $('charEditorPanel').innerHTML=SBCharacters.renderEditor(state.selectedChar,state.selectedChar?state.characters[state.selectedChar]:null);
  if(!state.selectedChar)return;
  const c=state.characters[state.selectedChar];
  $('charEditorPanel').querySelectorAll('[data-k]').forEach(el=>{
    const k=el.dataset.k;
    if(el.classList.contains('toggle')){el.onclick=()=>{pushHistory();c[k]=!c[k];el.classList.toggle('on',c[k]);save();renderCharacters()};return}
    el.oninput=el.onchange=()=>{
      c[k]=el.value;
      if(k==='description')c._descLocked=true;
      if(k==='wardrobe')c._wardrobeLocked=true;
      save();
    };
  });
  const up=$('btnUploadRef');if(up)up.onclick=()=>uploadRef(state.selectedChar);
  const clr=$('btnClearRef');if(clr)clr.onclick=()=>{pushHistory();c.refUrl=null;save();renderCharacters()};
  const del=$('btnDeleteChar');if(del)del.onclick=()=>deleteCharacter(state.selectedChar);
}
async function uploadRef(name){
  const inp=document.createElement('input');inp.type='file';inp.accept='image/*';
  inp.onchange=async()=>{const f=inp.files[0];if(!f)return;try{
    const dataUrl=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f)});
    const r=await fetch('/.netlify/functions/generate-video',{method:'POST',headers:await hdrs(),body:JSON.stringify({action:'upload_image',image_data_url:dataUrl,filename:f.name})});
    const d=await r.json();if(!r.ok||!d.url)throw new Error(d.error||'Upload failed');
    pushHistory();state.characters[name].refUrl=d.url;save();renderCharacters();toast('Reference locked for '+name);
  }catch(e){toast(e.message)}};
  inp.click();
}

function renderLocations(){
  const bible=state.locationBible||[];
  let listHtml=window.SBLocations?SBLocations.renderList(bible,state.selectedLoc):
    (bible.length?'<div class="loc-grid">'+bible.map(l=>'<div class="loc-card'+(state.selectedLoc===l.key?' selected':'')+'" data-key="'+esc(l.key)+'"><div class="loc-name">'+esc(l.name)+'</div><div class="loc-meta">'+(l.clipIndices||[]).length+' clips</div></div>').join('')+'</div>':
    '<div class="empty-hint">No locations — click ↻ Sync from clips</div>');
  if(!bible.length&&state.clips.length){
    listHtml='<div style="padding:10px 12px;margin-bottom:10px;background:rgba(212,168,67,.08);border:1px solid rgba(212,168,67,.35);border-radius:8px;font-size:12px;line-height:1.5;color:var(--text2)">'+
      '<strong style="color:var(--gold)">No locations yet</strong> — click <strong>↻ Sync from clips</strong> (scene headings from your parse).</div>'+listHtml;
  }
  const listEl=$('locListPanel');
  if(listEl){
    listEl.innerHTML=listHtml;
    listEl.querySelectorAll('.loc-card').forEach(el=>{
      el.onclick=()=>{state.selectedLoc=el.dataset.key;renderLocations()};
    });
  }
  const locked=window.SBLocations?SBLocations.lockedNames(bible):(bible||[]).filter(l=>l&&l.locked&&l.name).map(l=>l.name);
  if($('locsStrip'))$('locsStrip').classList.toggle('hidden',!locked.length);
  if($('locChips'))$('locChips').innerHTML=locked.map(n=>'<span class="char-chip on">🔒 '+esc(n)+'</span>').join('');
  renderLocEditor();
}
function renderLocEditor(){
  const panel=$('locEditorPanel');
  if(!panel)return;
  if(!window.SBLocations){
    const loc=state.selectedLoc?(state.locationBible||[]).find(l=>l.key===state.selectedLoc):null;
    panel.innerHTML=loc?'<div class="loc-editor"><h4>📍 '+esc(loc.name)+'</h4><p style="font-size:12px;color:var(--dim)">'+esc(loc.description||'')+'</p></div>':'<div class="empty-hint">Select a location</div>';
    return;
  }
  const loc=state.selectedLoc?(state.locationBible||[]).find(l=>l.key===state.selectedLoc):null;
  panel.innerHTML=SBLocations.renderEditor(state.selectedLoc,loc);
  if(!loc)return;
  panel.querySelectorAll('[data-k]').forEach(el=>{
    const k=el.dataset.k;
    if(el.classList.contains('toggle')){
      el.onclick=()=>{pushHistory();loc.locked=!loc.locked;el.classList.toggle('on',loc.locked);save();renderLocations();renderDetail();toast(loc.locked?'Location locked: '+loc.name:'Location unlocked: '+loc.name)};
      return;
    }
    el.oninput=el.onchange=()=>{loc[k]=el.value;save();const pr=$('d-prompt');if(pr&&state.selectedId){const c=state.clips.find(x=>x.id===state.selectedId);if(c)pr.value=buildPrompt(c)}};
  });
  const up=$('btnUploadLocPlate');if(up)up.onclick=()=>uploadLocPlate(state.selectedLoc);
  const clr=$('btnClearLocPlate');if(clr)clr.onclick=()=>{pushHistory();loc.plateUrl=null;save();renderLocations();toast('Plate removed')};
}
async function uploadLocPlate(locKey){
  const loc=(state.locationBible||[]).find(l=>l.key===locKey);
  if(!loc)return toast('Select a location first');
  const inp=document.createElement('input');inp.type='file';inp.accept='image/*';
  inp.onchange=async()=>{const f=inp.files[0];if(!f)return;try{
    const dataUrl=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f)});
    const r=await fetch('/.netlify/functions/generate-video',{method:'POST',headers:await hdrs(),body:JSON.stringify({action:'upload_image',image_data_url:dataUrl,filename:f.name})});
    const d=await r.json();if(!r.ok||!d.url)throw new Error(d.error||'Upload failed');
    pushHistory();loc.plateUrl=d.url;loc.locked=true;save();renderLocations();toast('Location plate set for '+loc.name);
  }catch(e){toast(e.message)}};
  inp.click();
}

function renderOutput(){$('queuePanel').innerHTML=SBExport.renderQueue(state.clips,state.queue);$('outputStats').textContent=state.clips.filter(c=>c.status==='approved').length+' approved · '+state.clips.filter(c=>c.videoUrl).length+' rendered'}

function isValidCharacterName(name){
  const up=String(name||'').toUpperCase().trim();
  if(!up||up.length<2)return false;
  if(SBParser.isCastMember)return SBParser.isCastMember(up);
  if(SBParser.isLikelyPersonName)return SBParser.isLikelyPersonName(up,{fromCue:true});
  return !JUNK_CHAR_WORDS.has(up)&&!CHAR_SKIP.has(up);
}

function scriptForCastExtraction(){
  return extractionText();
}

function inferCastRole(name,clips){
  const up=String(name||'').toUpperCase().trim().replace(/^(A|AN|THE)\s+/,'');
  const words=up.split(/\s+/).filter(Boolean);
  let hasDialogue=false;
  (clips||[]).forEach(c=>{
    if(!c.dialogue)return;
    const inFrame=(c.characters||[]).some(n=>String(n).toUpperCase().trim()===up);
    if(inFrame)hasDialogue=true;
  });
  if(words.length>=2)return hasDialogue?'supporting':'background';
  if(hasDialogue)return'lead';
  return'supporting';
}

function applyCastRoles(characters,clips){
  if(!characters)return;
  Object.keys(characters).forEach(name=>{
    const c=characters[name];
    if(!c||c.role&&c.role!=='lead')return;
    c.role=inferCastRole(name,clips);
  });
}

function collectCastFromProject(){
  const chars={};
  const add=(name,desc)=>{
    const up=String(name||'').replace(/\s*\([^)]*\)\s*/g,'').trim().toUpperCase();
    if(!up||!isValidCharacterName(up))return;
    if(chars[up]===undefined)chars[up]=desc||'';
    else if(desc&&String(desc).length>String(chars[up]).length)chars[up]=desc;
  };
  if(state.parseResult&&state.parseResult.characters){
    Object.entries(state.parseResult.characters).forEach(([n,d])=>add(n,d));
  }
  if(state.parseResult&&state.parseResult.scenes){
    state.parseResult.scenes.forEach(sc=>{
      (sc.shots||[]).forEach(sh=>{
        (sh.characters_in_frame||[]).forEach(n=>add(n,''));
      });
    });
  }
  state.clips.forEach(c=>{
    (c.characters||[]).forEach(n=>add(n,''));
    const desc=String(c.description||'');
    const closeM=desc.match(/Close on\s+([A-Z][A-Z0-9 .'\-]{1,30})/i);
    if(closeM)add(closeM[1],'');
  });
  const script=scriptForCastExtraction();
  if(script&&SBParser.extractCharactersFromText){
    Object.entries(SBParser.extractCharactersFromText(script)).forEach(([n,d])=>add(n,d));
  }
  if(script&&SBParser.extractBackgroundCastFromText){
    Object.entries(SBParser.extractBackgroundCastFromText(script)).forEach(([n,d])=>add(n,d));
  }
  return chars;
}

function trustedCharacterNames(text){
  const trusted=new Set();
  const script=scriptForCastExtraction()||((text&&!isClipReconstruction(text))?text:'')||clipsTextBlob();
  Object.keys(collectCastFromProject()).forEach(n=>trusted.add(String(n).toUpperCase().trim()));
  if(script&&SBParser.extractCharactersFromText){
    Object.keys(SBParser.extractCharactersFromText(script)).forEach(n=>{
      if(isValidCharacterName(n))trusted.add(String(n).toUpperCase().trim());
    });
  }
  if(script&&SBParser.extractBackgroundCastFromText){
    Object.keys(SBParser.extractBackgroundCastFromText(script)).forEach(n=>{
      if(isValidCharacterName(n))trusted.add(String(n).toUpperCase().trim());
    });
  }
  return trusted;
}

function syncCharactersFromParse(result,text,opts){
  opts=opts||{};
  let chars=Object.assign({},collectCastFromProject(),(result&&result.characters)||{});
  const script=scriptForCastExtraction()||text||clipsTextBlob();
  if(script&&SBParser.extractCharactersFromText){
    chars=SBParser.mergeCharMaps(chars,SBParser.extractCharactersFromText(script));
  }
  if(script&&SBParser.extractBackgroundCastFromText){
    chars=SBParser.mergeCharMaps(chars,SBParser.extractBackgroundCastFromText(script));
  }
  if(result&&result.scenes){
    result.scenes.forEach(sc=>{
      (sc.shots||[]).forEach(sh=>{
        (sh.characters_in_frame||[]).forEach(n=>{
          const up=String(n||'').replace(/\s*\([^)]*\)\s*/g,'').trim().toUpperCase();
          if(up&&chars[up]===undefined&&isValidCharacterName(up))chars[up]='';
        });
      });
    });
  }
  const normalized=SBCharacters.normalize(chars);
  const out={};
  Object.keys(normalized).forEach(k=>{
    const up=String(k).toUpperCase().trim();
    if(!up)return;
    const prev=state.characters[up]||{};
    const merged={...SBCharacters.DEFAULTS,...normalized[k],...prev};
    const dNew=normalized[k].description||'';
    const dPrev=prev.description||'';
    merged.description=dPrev.length>dNew.length?dPrev:dNew;
    out[up]=merged;
  });
  state.characters=pruneJunkCharacters(out,trustedCharacterNames(text));
  if(!opts.skipHydrate){
    SBCharacters.hydrate(state.characters,text||state.scriptText||clipTextBlob(),state.clips,(result&&result.characters)||{});
  }
  applyCastRoles(state.characters,state.clips);
  const names=Object.keys(state.characters);
  if(names.length&&!state.selectedChar)state.selectedChar=names[0];
}

function pruneJunkCharacters(chars,trusted){
  const trustedSet=trusted||trustedCharacterNames(state.scriptText||'');
  const clipSet=new Set();
  const frameSet=new Set();
  state.clips.forEach(c=>{
    (c.characters||[]).forEach(n=>clipSet.add(String(n).toUpperCase().trim()));
    const blob=((c.description||'')+' '+(c.dialogue||'')).toUpperCase();
    Object.keys(chars||{}).forEach(n=>{
      const up=String(n).toUpperCase().trim();
      if(up&&blob.includes(up))frameSet.add(up);
    });
  });
  if(state.parseResult&&state.parseResult.scenes){
    state.parseResult.scenes.forEach(sc=>{
      (sc.shots||[]).forEach(sh=>{
        (sh.characters_in_frame||[]).forEach(n=>frameSet.add(String(n).toUpperCase().trim()));
      });
    });
  }
  const out={};
  Object.entries(chars||{}).forEach(([name,val])=>{
    const up=String(name).toUpperCase().trim();
    if(!up||up.length<2||up.length>40||!isValidCharacterName(up))return;
    if(trustedSet.has(up)){out[up]=val;return;}
    if(clipSet.has(up)||frameSet.has(up)){out[up]=val;return;}
    const words=up.split(/\s+/);
    if(words.length>4)return;
    if(words.every(w=>JUNK_CHAR_WORDS.has(w)||CHAR_SKIP.has(w)))return;
    if(words.length===1&&(JUNK_CHAR_WORDS.has(words[0])||CHAR_SKIP.has(words[0])))return;
    out[up]=val;
  });
  if(!Object.keys(out).length&&trustedSet.size){
    trustedSet.forEach(up=>{
      if(chars[up]!==undefined)out[up]=chars[up];
      else if(chars[up.toLowerCase()]!==undefined)out[up]=chars[up.toLowerCase()];
    });
  }
  return out;
}

function charsForStrip(){
  const set=new Set();
  state.clips.forEach(c=>(c.characters||[]).forEach(n=>{const u=String(n||'').toUpperCase().trim();if(u)set.add(u)}));
  const pruned=pruneJunkCharacters(Object.fromEntries([...set].map(n=>[n,{}])));
  return Object.keys(pruned).sort().slice(0,16);
}

function clipTextBlob(){
  return extractionText();
}

function repairCharactersFromClips(){
  if(!state.clips.length&&!state.scriptText)return false;
  let changed=false;
  state.clips.forEach(c=>{
    (c.characters||[]).forEach(n=>{
      const up=String(n||'').toUpperCase().trim();
      if(!up)return;
      if(isValidCharacterName(up)&&!state.characters[up]){
        state.characters[up]=Object.assign({},SBCharacters.DEFAULTS);
        changed=true;
      }
    });
  });
  if(changed)save();
  return changed;
}

/** Re-sync characters from stored script + full re-parse + clip metadata. */
function rebuildCharactersFromProject(){
  if(!state.scriptText||!state.scriptText.trim()||isClipReconstruction(state.scriptText))return false;
  const blob=state.scriptText;
  if(!blob||!blob.trim())return false;
  const base=Object.assign({},(state.parseResult&&state.parseResult.characters)||{});
  let merged=base;
  const dur=parseInt(state.global.clipDuration,10)||5;
  const norm=normalizeImportedScript(blob).text;

  if(SBParser.parse){
    const reparsed=SBParser.parse(norm,dur);
    state.parseResult=reparsed;
    merged=SBParser.mergeCharMaps(merged,reparsed.characters||{});
    (reparsed.scenes||[]).forEach(sc=>{
      (sc.shots||[]).forEach(sh=>{
        (sh.characters_in_frame||[]).forEach(n=>registerCharFromParse(merged,n));
      });
    });
  }
  if(SBParser.extractCharactersFromText&&!isClipReconstruction(norm)){
    merged=SBParser.mergeCharMaps(merged,SBParser.extractCharactersFromText(norm));
  }
  state.clips.forEach(c=>{
    (c.characters||[]).forEach(n=>registerCharFromParse(merged,n));
    const desc=c.description||'';
    const closeOn=desc.match(/Close on\s+([A-Z][A-Z0-9 .'\-]{1,30})/i);
    if(closeOn)registerCharFromParse(merged,closeOn[1]);
  });
  const names=Object.keys(merged).filter(n=>n.length>=2);
  if(!names.length)return false;
  const filtered=SBParser.filterCharacterMap?SBParser.filterCharacterMap(merged):merged;
  state.characters=SBCharacters.normalize(pruneJunkCharacters(filtered,trustedCharacterNames(norm)));
  SBCharacters.hydrate(state.characters,norm,state.clips,merged);
  if(!state.selectedChar)state.selectedChar=names[0];
  save();
  return true;
}
function registerCharFromParse(map,name,desc){
  const up=String(name||'').replace(/\s*\([^)]*\)\s*/g,'').trim().toUpperCase();
  if(!up||up.length<2||up.length>40||!isValidCharacterName(up))return;
  if(map[up]===undefined)map[up]=desc||'';
  else if(desc&&!map[up])map[up]=desc;
}

async function importText(text,opts){
  opts=opts||{};
  const raw=String(text||'').trim();
  if(!raw){toast('No screenplay text to parse');openScriptPanel();return}
  if(isClipReconstruction(raw)){
    toast('That text is broken clip output — use + New script, then import your real file');
    openScriptPanel();
    return;
  }
  pushHistory();
  const normInfo=normalizeImportedScript(raw);
  const norm=normInfo.text;
  state.scriptText=norm;
  const ta=$('scriptEditor');
  if(ta){ta.value=norm;ta._focused=false}
  const dur=parseInt(state.global.clipDuration,10)||5;
  const result=SBParser.parse(norm,dur);
  state.parseResult=result;
  state.clips=SBParser.scenesToClips(result,state.global,dur);
  state.clips.forEach(ensureClip);
  state.locationBible=[];
  if(state.clips.length)state.selectedId=state.clips[0].id;
  const syncR=await syncMasteryWithAgent(true);
  save();renderAll();
  const nChars=Object.keys(state.characters).length;
  const nLocs=(state.locationBible||[]).length;
  let msg=state.clips.length+' clips'+(nChars?' · '+nChars+' characters':'')+(nLocs?' · '+nLocs+' locations':'')+(syncR?' · synced':'');
  if(normInfo.wasFlattened)msg='Unflattened '+normInfo.before+'→'+normInfo.after+' lines · '+msg;
  const warn=SBParser.parseQualityWarning?SBParser.parseQualityWarning(result):'';
  if(warn)msg+=' — '+warn;
  toast(msg);
  openSidePanelsIfNeeded();
  openScriptPanel();
}
async function importFile(file){
  try{
    const text=await SBParser.readFile(file);
    await importText(text);
  }catch(e){
    toast(e.message||'Import failed');
    openScriptPanel();
  }
}

function addClip(){
  pushHistory();const n=state.clips.length+1;
  const c={id:'clip-'+String(n).padStart(2,'0'),num:n,label:'New beat',heading:'',durationSec:state.global.clipDuration||5,status:'draft',description:'',dialogue:'',characters:[],videoUrl:null,requestId:null,error:null,emotion:'Neutral'};
  ensureClip(c);state.clips.push(c);state.selectedId=c.id;save();renderAll();
}
function duplicateClip(){
  const src=state.clips.find(c=>c.id===state.selectedId);if(!src){toast('Select a clip');return}
  pushHistory();const n=state.clips.length+1;
  const c=JSON.parse(JSON.stringify(src));c.id='clip-'+String(n).padStart(2,'0');c.num=n;c.status='draft';c.videoUrl=null;c.requestId=null;c.error=null;
  state.clips.push(c);state.selectedId=c.id;save();renderAll();toast('Duplicated');
}

async function extractVideoEndFrame(videoUrl){
  const src=String(videoUrl||'');
  if(!src)return null;
  return new Promise((resolve)=>{
    const v=document.createElement('video');
    v.muted=true;
    v.playsInline=true;
    v.preload='auto';
    if(src.startsWith('https://'))v.crossOrigin='anonymous';
    let settled=false;
    const finish=(val)=>{if(settled)return;settled=true;resolve(val||null)};
    const grab=()=>{
      try{
        const w=v.videoWidth,h=v.videoHeight;
        if(!w||!h){finish(null);return}
        const c=document.createElement('canvas');
        c.width=w;c.height=h;
        c.getContext('2d').drawImage(v,0,0,w,h);
        finish(c.toDataURL('image/jpeg',0.9));
      }catch(_){finish(null)}
    };
    v.addEventListener('loadedmetadata',()=>{
      const t=Math.max(0,(v.duration||4)-0.12);
      v.currentTime=Number.isFinite(t)?t:0;
    });
    v.addEventListener('seeked',grab);
    v.addEventListener('error',()=>finish(null));
    setTimeout(()=>finish(null),12000);
    v.src=src;
  });
}

async function resolvePrevClipFrameRef(state,clipIndex){
  if(clipIndex==null||clipIndex<1||!state.clips[clipIndex])return null;
  const prev=state.clips[clipIndex-1];
  if(!prev||!prev.videoUrl)return null;
  return extractVideoEndFrame(prev.videoUrl);
}

async function runJob(clip){
  clip.status='generating';clip.error=null;renderAll();
  let prompt=buildPrompt(clip);
  const ref=SBCharacters.getRefForClip(state.characters,clip);
  try{
    const h=await hdrs();
    const vs=(typeof window.getVideoSettings==='function')?window.getVideoSettings('timeline'):null;
    const dur=vs?vs.duration:Math.min(15,Math.max(3,parseInt(state.global.clipDuration,10)||clip.durationSec||5));
    const asp=vs?vs.aspect_ratio:(state.global.aspectRatio||'16:9');
    const pollModel=vs?vs.model:state.global.model;
    const pollProv=vs?vs.provider:((typeof window.inferVideoProvider==='function')?window.inferVideoProvider(pollModel):(pollModel&&pollModel.includes('grok')?'grok-imagine':pollModel&&pollModel.includes('sora')?'aivideoapi':'wavespeed'));
    const body={action:'submit',model:pollModel,prompt,duration:dur,aspect_ratio:asp,resolution:vs?vs.resolution:(state.global.quality||'720p'),provider:pollProv};
    if(ref&&ref.url&&String(ref.url).startsWith('https://'))body.character_image_url=ref.url;
    if(window.SBMastery){
      const mastery=window.SBMastery.resolveForTimeline(state,clip);
      if(!body.character_image_url&&mastery.character_image_url)body.character_image_url=mastery.character_image_url;
      if(mastery.location_image_url)body.location_image_url=mastery.location_image_url;
      if(mastery.reference_images&&mastery.reference_images.length)body.reference_images=mastery.reference_images;
      body.prompt=window.SBMastery.enrichPrompt(body.prompt,mastery);
    }
    if(window.SBContinuity&&typeof SBContinuity.continuityForClip==='function'){
      const ci=state.clips.findIndex(c=>c.id===clip.id);
      const cont=SBContinuity.continuityForClip(state,ci);
      if(cont){
        body.prompt=SBContinuity.enrichPromptWithContinuity(body.prompt,state,clip);
        if(cont.prevVideoUrl){
          const prevFrame=await resolvePrevClipFrameRef(state,ci);
          if(prevFrame){
            body.prev_frame_image_url=prevFrame;
            if(!body.character_image_url)body.character_image_url=prevFrame;
            else if(!body.reference_images)body.reference_images=[prevFrame];
            else if(body.reference_images.indexOf(prevFrame)<0)body.reference_images.unshift(prevFrame);
          }
        }
      }
    }
    const sub=await fetch('/.netlify/functions/generate-video',{method:'POST',headers:h,body:JSON.stringify(body)});
    const sd=await sub.json();
    if(!sub.ok||!sd.request_id)throw new Error(formatGenError(sd,sub.status));
    clip.requestId=sd.request_id;
    clip.provider=sd.provider||pollProv;
    const jobProv=clip.provider;
    const t0=Date.now();
    while(Date.now()-t0<480000){
      await new Promise(r=>setTimeout(r,5000));
      const pollBody={action:'status',request_id:clip.requestId,model:pollModel,provider:jobProv};
      const pr=await fetch('/.netlify/functions/generate-video',{method:'POST',headers:h,body:JSON.stringify(pollBody)});
      const pd=await pr.json();const st=(pd.status||pd.state||'').toUpperCase();
      if(st==='COMPLETED'||st==='SUCCESS'||st==='SUCCEEDED'||st==='DONE'){
        let videoUrl=pickVideoUrl(pd);
        if(!videoUrl){
          const rr=await fetch('/.netlify/functions/generate-video',{method:'POST',headers:h,body:JSON.stringify({action:'result',request_id:clip.requestId,model:pollModel,provider:jobProv})});
          const rd=await rr.json();
          videoUrl=pickVideoUrl(rd);
        }
        if(!videoUrl)throw new Error('No video URL in provider response');
        clip.videoUrl=videoUrl;
        clip.status='done';clip.error=null;save();renderAll();return;
      }
      if(st==='FAILED'||st==='ERROR')throw new Error(formatGenError(pd,pr.status));
    }
    throw new Error('Timed out');
  }catch(e){clip.status='draft';clip.error=e.message;save();renderAll();toast(e.message)}
}

async function genSelected(){if(!curUser)return toast('Sign in');const c=state.clips.find(x=>x.id===state.selectedId);if(!c)return toast('Select clip');await runJob(c)}
async function batchGen(){
  if(!curUser)return toast('Sign in');if(state.queue.running)return;
  state.queue.running=true;$('queueBar').classList.add('on');
  for(let i=0;i<state.clips.length;i++){
    $('queueText').textContent='Clip '+(i+1)+' / '+state.clips.length;
    if(i>0&&!state.clips[i-1].videoUrl)toast('Clip '+i+' has no video — continuity refs may be weak for clip '+(i+1));
    await runJob(state.clips[i]);
  }
  state.queue.running=false;$('queueBar').classList.remove('on');toast('Batch done');
}
function approveSelected(){
  const c=state.clips.find(x=>x.id===state.selectedId);if(!c)return toast('Select clip');
  if(!c.videoUrl)return toast('Generate first');
  pushHistory();c.status='approved';save();renderAll();toast('Approved');
}

function previewAll(){
  const vids=state.clips.filter(c=>c.videoUrl);
  if(!vids.length)return toast('No rendered clips');
  $('previewModal').classList.remove('hidden');
  let i=0;const vid=$('previewPlayer');
  function next(){if(i>=vids.length){$('previewModal').classList.add('hidden');return}vid.src=vids[i].videoUrl;$('previewLabel').textContent='Clip '+vids[i].num+' / '+vids.length;i++}
  vid.onended=next;next();
}

function syncGlobal(){['gFilm','gColor','gAspect','gQuality','gAudio','gModel','gDuration','gLang'].forEach(id=>{const el=$(id);if(!el)return});
  state.global.filmStyle=$('gFilm').value;state.global.colorGrade=$('gColor').value;state.global.aspectRatio=$('gAspect').value;
  state.global.quality=$('gQuality').value;state.global.audioProfile=$('gAudio').value;state.global.model=$('gModel').value;
  state.global.clipDuration=parseInt($('gDuration').value,10)||5;state.global.language=$('gLang').value;save()}

function exportEDL(){
  const approved=state.clips.filter(c=>c.status==='approved'&&c.videoUrl);
  SBExport.exportEDL(approved.length?approved:state.clips);
  toast('EDL downloaded');
}
function exportProject(){SBExport.exportProject({clips:state.clips,characters:state.characters,locationBible:state.locationBible,global:state.global,assembly:state.assembly,projectName:state.projectName,scriptText:state.scriptText,parseResult:state.parseResult});toast('Project saved')}
function loadProject(){
  const inp=document.createElement('input');inp.type='file';inp.accept='.json';
  inp.onchange=async()=>{const f=inp.files[0];if(!f)return;pushHistory();const d=JSON.parse(await f.text());
    state.clips=d.clips||[];state.characters=SBCharacters.normalize(d.characters||{});state.locationBible=d.locationBible||[];
    state.global=Object.assign(state.global,d.global||{});
    state.assembly=Object.assign(state.assembly,d.assembly||{});state.projectName=d.projectName||'Imported';
    state.scriptText=d.scriptText||'';state.parseResult=d.parseResult||null;
    const ta=$('scriptEditor');if(ta){ta.value=state.scriptText;ta._focused=false}
    state.clips.forEach(ensureClip);syncLocationBibleFromClips();save();renderAll();openScriptPanel();toast('Project loaded')};
  inp.click();
}

async function finalExport(){
  const clips=state.clips.filter(c=>c.status==='approved'&&c.videoUrl);
  if(!clips.length)return toast('Approve clips with video first');
  $('exportModal').classList.remove('hidden');$('exportStatus').textContent='Starting…';
  try{
    const blob=await SBExport.stitchClips(clips,{fade:state.assembly.masterFade||0.3},m=>$('exportStatus').textContent=m);
    SBExport.download('shotbreak-final.'+(blob.type.includes('zip')?'zip':'mp4'),blob,blob.type);
    $('exportStatus').textContent='Done!';
    toast('Final export downloaded');
  }catch(e){$('exportStatus').textContent=e.message;toast(e.message)}
}

function sendEditor(){openEditorPanel()}

function toggleMoreMenu(open){
  const menu=$('moreMenu');const btn=$('btnMoreMenu');if(!menu)return;
  const show=open!==undefined?open:menu.classList.contains('hidden');
  menu.classList.toggle('hidden',!show);
  if(show&&btn){
    const r=btn.getBoundingClientRect();
    menu.style.position='fixed';
    menu.style.top=Math.round(r.bottom+4)+'px';
    menu.style.left=Math.round(r.left)+'px';
    menu.style.zIndex='10060';
  }else{
    menu.style.position='';
    menu.style.top='';
    menu.style.left='';
    menu.style.zIndex='';
  }
}
function bindUI(){
  $('btnMoreMenu').onclick=e=>{e.stopPropagation();toggleMoreMenu()};
  document.addEventListener('click',()=>toggleMoreMenu(false));
  window.addEventListener('scroll',()=>toggleMoreMenu(false),true);
  $('moreMenu').onclick=e=>e.stopPropagation();
  $('fileInput').onchange=async e=>{
    const f=e.target.files[0];
    e.target.value='';
    if(!f)return;
    openScriptPanel();
    toast('Reading '+f.name+'…');
    try{await importFile(f)}catch(err){toast(err.message||'Import failed')}
  };
  $('btnImport').onclick=()=>$('fileInput').click();
  $('btnPaste').onclick=()=>{openScriptPanel();toast('Paste screenplay here, then Re-parse timeline')};
  const btnScript=$('btnScript');
  if(btnScript)btnScript.onclick=openScriptPanel;
  const btnOpenScript=$('btnOpenScript');
  if(btnOpenScript)btnOpenScript.onclick=openScriptPanel;
  const btnBarImport=$('btnBarImport');
  if(btnBarImport)btnBarImport.onclick=()=>$('fileInput').click();
  const btnBarReparse=$('btnBarReparse');
  if(btnBarReparse)btnBarReparse.onclick=()=>reparseScriptFromEditor().catch(e=>toast(e.message));
  const btnCloseScript=$('btnCloseScript');
  if(btnCloseScript)btnCloseScript.onclick=closeScriptPanel;
  const scriptModal=$('scriptModal');
  if(scriptModal)scriptModal.onclick=e=>{if(e.target===scriptModal)closeScriptPanel()};
  const btnEditLink=$('btnEditScriptLink');
  if(btnEditLink)btnEditLink.onclick=openScriptPanel;
  const btnReparse=$('btnReparseScript');
  if(btnReparse)btnReparse.onclick=()=>reparseScriptFromEditor().catch(e=>toast(e.message));
  const btnUnflatten=$('btnUnflattenScript');
  if(btnUnflatten)btnUnflatten.onclick=unflattenScriptFromEditor;
  const btnScriptImport=$('btnScriptImport');
  if(btnScriptImport)btnScriptImport.onclick=()=>$('fileInput').click();
  const btnNewScript=$('btnNewScript');
  if(btnNewScript)btnNewScript.onclick=startNewScript;
  const btnRecoverScriptBar=$('btnRecoverScriptBar');
  if(btnRecoverScriptBar)btnRecoverScriptBar.onclick=recoverCorruptScript;
  const btnMenuScript=$('btnMenuScript');
  if(btnMenuScript)btnMenuScript.onclick=()=>{toggleMoreMenu(false);openScriptPanel()};
  const scriptTa=$('scriptEditor');
  if(scriptTa&&!scriptTa._wired){
    scriptTa._wired=true;
    scriptTa.addEventListener('focus',()=>{scriptTa._focused=true});
    scriptTa.addEventListener('blur',()=>{scriptTa._focused=false;clearTimeout(scriptTa._syncT);syncScriptFromEditor()});
    /* Debounced — syncing serializes the whole project to localStorage, which
     * froze typing on feature-length scripts when run per keystroke. */
    scriptTa.addEventListener('input',()=>{clearTimeout(scriptTa._syncT);scriptTa._syncT=setTimeout(syncScriptFromEditor,400)});
  }
  $('btnAdd').onclick=addClip;
  $('btnDup').onclick=duplicateClip;
  $('btnUndo').onclick=undo;
  $('btnRedo').onclick=redo;
  $('btnBatch').onclick=batchGen;
  $('btnGen').onclick=genSelected;
  $('btnRegen').onclick=genSelected;
  $('btnApprove').onclick=approveSelected;
  $('btnPreview').onclick=()=>{const c=state.clips.find(x=>x.id===state.selectedId);if(c&&c.videoUrl)window.open(c.videoUrl);else toast('No video')};
  $('btnPreviewAll').onclick=previewAll;
  $('btnExport').onclick=sendEditor;
  $('btnFinal').onclick=finalExport;
  $('btnEDL').onclick=exportEDL;
  $('btnSaveProj').onclick=exportProject;
  $('btnLoadProj').onclick=loadProject;
  const btnResync=$('btnResyncChars');
  if(btnResync)btnResync.onclick=async()=>{
    pushHistory();
    btnResync.disabled=true;
    try{
      const r=await syncMasteryWithAgent(true);
      renderCharacters();renderLocations();
      toast(masterySyncMessage(r));
    }catch(e){toast(e.message||'Character sync failed')}
    btnResync.disabled=false;
  };
  const btnResyncLocs=$('btnResyncLocs');
  if(btnResyncLocs)btnResyncLocs.onclick=async()=>{
    if(!state.clips.length&&!state.scriptText)return toast('Import or re-parse your script first');
    pushHistory();
    btnResyncLocs.disabled=true;
    try{
      const r=await syncMasteryWithAgent(true);
      renderLocations();renderCharacters();
      toast(masterySyncMessage(r));
      const panel=$('locationsPanel');if(panel)panel.open=true;
    }catch(e){toast(e.message||'Location sync failed')}
    btnResyncLocs.disabled=false;
  };
  $('btnAddChar').onclick=()=>{const n=prompt('Character name:');if(!n)return;pushHistory();state.characters[n.toUpperCase()]=Object.assign({},SBCharacters.DEFAULTS);state.selectedChar=n.toUpperCase();save();renderCharacters()};
  $('btnClosePreview').onclick=()=>$('previewModal').classList.add('hidden');
  $('btnCloseExport').onclick=()=>$('exportModal').classList.add('hidden');
  ['gFilm','gColor','gAspect','gQuality','gAudio','gModel','gDuration','gLang'].forEach(id=>{const el=$(id);if(el)el.onchange=syncGlobal});
  const btnMore=$('btnSettingsMore'), panelFull=$('settingsFull');
  if(btnMore&&panelFull){
    btnMore.onclick=()=>{
      const open=panelFull.classList.toggle('hidden');
      btnMore.classList.toggle('open',!open);
      btnMore.setAttribute('aria-expanded',!open?'true':'false');
    };
  }
  initTimelineEditor();
  if(window.SBBudget)SBBudget.wire({getState:()=>state,toast});
  load();
  repairCorruptClips();
  if(state.scriptText&&isClipReconstruction(state.scriptText)){
    console.warn('[Shotbreak] scriptText looks like clip reconstruction — open ✎ Script and re-import your screenplay');
  }
  Object.keys(state.characters).forEach(n=>{
    if(!isValidCharacterName(n))delete state.characters[n];
  });
  if(state.clips.length||state.scriptText||state.parseResult){
    bootstrapMastery(true,{skipHydrate:true});
    repairAllCharacterDescriptions();
    save();
  }
  const modelMigrate={'seedance-turbo':'seedance-2.0-turbo','seedance':'seedance-2.0-turbo','veo':'veo-3.1'};
  if(state.global.model&&modelMigrate[state.global.model])state.global.model=modelMigrate[state.global.model];
  if(typeof window.initTimelineVideoSettings==='function'){
    if($('gModel')&&state.global.model)$('gModel').value=state.global.model;
    window.initTimelineVideoSettings(syncGlobal,true);
    if($('gModel')&&state.global.model&&window.VIDEO_MODELS&&window.VIDEO_MODELS[state.global.model])$('gModel').value=state.global.model;
    if(typeof window.updateOptionsForModel==='function')window.updateOptionsForModel($('gModel').value,true,'gQuality','gAspect','gDuration');
    if(state.global.aspectRatio&&$('gAspect')){const ok=[...$('gAspect').options].some(o=>o.value===state.global.aspectRatio);if(ok)$('gAspect').value=state.global.aspectRatio;}
    if(state.global.clipDuration&&$('gDuration')){const dv=String(state.global.clipDuration);const ok=[...$('gDuration').options].some(o=>o.value===dv);if(ok)$('gDuration').value=dv;}
    if(state.global.quality&&$('gQuality')){const ok=[...$('gQuality').options].some(o=>o.value===state.global.quality);if(ok)$('gQuality').value=state.global.quality;}
    ['gFilm','gColor','gAudio','gLang'].forEach(id=>{
      const m={gFilm:'filmStyle',gColor:'colorGrade',gAudio:'audioProfile',gLang:'language'};
      const el=$(id);if(!el)return;
      const v=state.global[m[id]];
      if(v==null||v==='')return;
      const has=[...el.options].some(o=>o.value===String(v));
      el.value=has?String(v):el.options[0]?el.options[0].value:'';
    });
    syncGlobal();
  }
  renderAll();
  try{
    if(!localStorage.getItem('SB_Timeline_script_hint_v2')){
      localStorage.setItem('SB_Timeline_script_hint_v2','1');
      setTimeout(()=>toast('Screenplay: gold ✎ Script (top) or yellow bar under Settings'),1200);
    }
  }catch(e){}
}

document.addEventListener('DOMContentLoaded',()=>{initAuth();bindUI()});
})();