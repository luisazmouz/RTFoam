/* ============================================================
   RTFOAM — app behavior
   State + event handlers. All form/detail/report markup is real
   static HTML in index.html — this file wires it up, plus renders
   the genuinely data-driven lists (hangar cards, flight-data rows,
   build notes, console log lines).

   KNOWLEDGE-DEPENDENT GENERATION
   Every generation MUST fetch /knowledge/*.json + report.md fresh
   (cache: 'no-store') before calling the AI. If any file is
   missing or empty, generation stops with a visible error — there
   is no hardcoded fallback design data in this app. See
   /knowledge/README.md.
   ============================================================ */

const Lib = window.PlanLib;
const APP_VERSION = 8; // must match PlanLib.VERSION — mismatch means stale files on the server
const LS_DESIGNS = 'slipstream_designs_v1';
const LS_LOGS = 'slipstream_flightlog_v1';

const KNOWLEDGE_FILES = [
  'knowledge/report.md',
  'knowledge/equations.json',
  'knowledge/aircraft-types.json',
  'knowledge/design-rules.json',
  'knowledge/validation.json',
  'knowledge/materials.json',
  'knowledge/motors.json',
  'knowledge/novelty.json',
];

const state = {
  view: 'home',            // 'home' | 'new' | 'detail'
  designs: [],             // local + seeds (+ cloud once synced)
  activeId: null,
  generating: false,
  log: [],
  error: null,
  form: {
    style: 'Trainer',
    wingspan: 900,
    controlConfig: 'Ailerons + Elevator',
    foam: '',         // populated once materials.json loads
  },
  flightLogs: {},          // designId -> {verdict, note, ts}
  report: { verdict: '', note: '' },
  knowledgeStatus: { loaded: false, files: [], totalChars: 0, error: null },
};

/* HTML-escape untrusted strings (design names etc. come from an LLM) */
function h(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const theme = Lib.THEMES['Cyanotype'].svg; // on-screen plan colors

/* ============================================================
   KNOWLEDGE LOADING — required, fail-fast, no silent fallback
   ============================================================ */
async function loadKnowledgeFiles() {
  const parts = [];
  const fileList = [];
  let totalChars = 0;
  let parsedAircraftTypes = null, parsedDesignRules = null, parsedValidation = null, parsedMaterials = null, parsedMotors = null, parsedNovelty = null;

  for (const path of KNOWLEDGE_FILES) {
    let response;
    const url = new URL(path, document.baseURI).href;
    try {
      response = await fetch(url, { cache: 'no-store' });
    } catch (e) {
      throw new Error('Knowledge file missing: ' + path + ' (fetch failed — if you are opening this file directly as file://, serve it over http:// instead, e.g. `npx serve` or any static host)');
    }
    if (!response.ok) throw new Error('Knowledge file missing: ' + path + ' (HTTP ' + response.status + ' at ' + url + ')');
    const text = await response.text();
    if (!text.trim()) throw new Error('Knowledge file empty: ' + path);

    parts.push('\n\n--- FILE: ' + path + ' ---\n' + text);
    fileList.push(path);
    totalChars += text.length;

    if (path.endsWith('aircraft-types.json')) parsedAircraftTypes = JSON.parse(text);
    if (path.endsWith('design-rules.json')) parsedDesignRules = JSON.parse(text);
    if (path.endsWith('validation.json')) parsedValidation = JSON.parse(text);
    if (path.endsWith('materials.json')) parsedMaterials = JSON.parse(text);
    if (path.endsWith('motors.json')) parsedMotors = JSON.parse(text);
    if (path.endsWith('novelty.json')) parsedNovelty = JSON.parse(text);
  }

  return {
    text: parts.join('\n'),
    fileList,
    totalChars,
    parsed: {
      aircraftTypes: parsedAircraftTypes,
      designRules: parsedDesignRules,
      validation: parsedValidation,
      materials: parsedMaterials,
      motors: parsedMotors,
      novelty: parsedNovelty,
    },
  };
}

/* Populate the UI (style list comes from aircraft-types.json keys,
   control configs / motors / materials from their files) as soon as
   knowledge loads at boot. This is a convenience load for the form —
   generation ALWAYS reloads fresh via loadKnowledgeFiles() again. */
async function bootKnowledge() {
  try {
    const k = await loadKnowledgeFiles();
    state.knowledgeStatus = { loaded: true, files: k.fileList, totalChars: k.totalChars, error: null };
    state._noveltyRules = k.parsed.novelty;
    state._knowledge = k.parsed;
    populateFormFromKnowledge(k.parsed);
  } catch (e) {
    state.knowledgeStatus = { loaded: false, files: [], totalChars: 0, error: (e && e.message) || String(e) };
  }
  renderKnowledgeDebug();
}

function populateFormFromKnowledge(parsed) {
  // styles
  const styleNames = Object.keys(parsed.aircraftTypes || {});
  const styleBox = document.getElementById('style-buttons');
  styleBox.innerHTML = styleNames.map(s =>
    `<button data-style="${h(s)}" onclick="onStyleChange('${s.replace(/'/g, "\\'")}')">${h(s.toUpperCase())}</button>`).join('');
  if (!styleNames.includes(state.form.style)) state.form.style = styleNames[0] || '';

  // control configurations
  const ccNames = Object.keys((parsed.designRules && parsed.designRules.controlConfigurations) || {});
  const ccBox = document.getElementById('control-config-buttons');
  ccBox.innerHTML = ccNames.map(cName =>
    `<button data-cc="${h(cName)}" onclick="onControlConfigChange('${cName.replace(/'/g, "\\'")}')">${h(cName.toUpperCase())}</button>`).join('');
  if (!ccNames.includes(state.form.controlConfig)) state.form.controlConfig = ccNames[0] || '';
  state._controlConfigurations = (parsed.designRules && parsed.designRules.controlConfigurations) || {};

  // materials
  const materials = parsed.materials || [];
  const foamBox = document.getElementById('foam-buttons');
  foamBox.innerHTML = materials.map(m =>
    `<button data-foam="${h(m.label)}" onclick="onFoamChange('${m.label.replace(/'/g, "\\'")}')">${h(m.label.toUpperCase())}</button>`).join('');
  if (!state.form.foam && materials.length) state.form.foam = materials[0].label;

  // wingspan slider bounds
  if (parsed.validation && parsed.validation.wingspanMM) {
    const slider = document.getElementById('wingspan-slider');
    slider.min = parsed.validation.wingspanMM[0];
    slider.max = parsed.validation.wingspanMM[1];
  }
  state._wingPanelLimit = (parsed.designRules && parsed.designRules.wingPanelLimitMM) || 800;

  syncFormButtons();
}

function renderKnowledgeDebug() {
  const el = document.getElementById('knowledge-debug');
  if (!el) return;
  const libV = (window.PlanLib && window.PlanLib.VERSION) || 0;
  const versionLine = libV === APP_VERSION
    ? `BUILD v${APP_VERSION} · LIB v${libV} — files in sync`
    : `<span style="color:var(--danger);">STALE FILES: app.js is v${APP_VERSION} but plan-lib.js is v${libV || '?'} — re-upload ALL site files together and hard-refresh</span>`;
  const k = state.knowledgeStatus;
  if (k.loaded) {
    el.innerHTML = versionLine + '<br>' +
      `<span style="color:#6FCF8E;">KNOWLEDGE LOADED: YES</span> — ${k.files.length} files, ${k.totalChars.toLocaleString()} chars<br>` +
      k.files.map(f => '· ' + h(f)).join('<br>');
  } else {
    el.innerHTML = versionLine + '<br>' +
      `<span style="color:var(--danger);">KNOWLEDGE LOADED: NO</span>${k.error ? ' — ' + h(k.error) : ''}`;
  }
}

/* ============================================================
   PERSISTENCE — localStorage + optional Supabase
   ============================================================ */
function loadLocal() {
  let user = [], logs = {};
  try { user = JSON.parse(localStorage.getItem(LS_DESIGNS)) || []; } catch (e) {}
  try { logs = JSON.parse(localStorage.getItem(LS_LOGS)) || {}; } catch (e) {}
  state.designs = [...user, ...Lib.SEED_DESIGNS];
  state.flightLogs = logs;
}
function persist() {
  try {
    localStorage.setItem(LS_DESIGNS, JSON.stringify(state.designs.filter(d => d.userMade)));
    localStorage.setItem(LS_LOGS, JSON.stringify(state.flightLogs));
  } catch (e) {}
}

const sbOn = () => !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
const sbBase = () => CONFIG.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/slipstream_hangar';
const sbHeaders = () => ({
  'content-type': 'application/json',
  apikey: CONFIG.SUPABASE_ANON_KEY,
  authorization: 'Bearer ' + CONFIG.SUPABASE_ANON_KEY,
});

async function sbSaveDesign(design) {
  if (!sbOn()) return;
  try {
    await fetch(sbBase() + '?on_conflict=id', {
      method: 'POST',
      headers: { ...sbHeaders(), prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([{ id: design.id, data: design }]),
    });
  } catch (e) { console.warn('supabase save failed', e); }
}

async function sbLoadGallery() {
  if (!sbOn()) return;
  try {
    const r = await fetch(sbBase() + '?select=id,data&order=updated_at.desc&limit=60', { headers: sbHeaders() });
    if (!r.ok) return;
    const rows = await r.json();
    const existing = new Set(state.designs.map(d => d.id));
    const cloud = rows
      .map(row => row.data)
      .filter(d => d && d.params && !existing.has(d.id))
      .map(d => ({ ...d, cloud: true }));
    if (cloud.length) {
      state.designs = [...state.designs.filter(d => !d.seed), ...cloud, ...state.designs.filter(d => d.seed)];
      renderCards();
    }
  } catch (e) { console.warn('supabase load failed', e); }
}

/* ============================================================
   AI — all generation goes through the owner's proxy (worker.js),
   which ONLY forwards the already-expanded prompt. It adds no
   fallback design rules of its own.
   ============================================================ */
async function llmComplete(system, messages) {
  if (!CONFIG.API_PROXY_URL) {
    throw new Error('This site is not connected to a model yet. Site owner: deploy worker.js and set CONFIG.API_PROXY_URL in index.html.');
  }
  const r = await fetch(CONFIG.API_PROXY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ system, messages }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'Proxy error ' + r.status);
  return j.text || '';
}

function buildMemory() {
  const out = [];
  for (const d of state.designs) {
    const l = state.flightLogs[d.id];
    if (!l || !l.verdict) continue;
    const st = Lib.computeStats(d.params);
    out.push(`"${d.name}" (${d.styleTag.toLowerCase()}, span ${d.params.wingspanMM}mm, ${d.params.weightG}g, CG ${d.params.cgPercentMAC}% MAC, loading ${Math.round(st.wingLoading)}g/dm²): ${l.verdict}${l.note ? ' — ' + l.note : ''}`);
  }
  return out.slice(0, 8);
}

function buildHangarInventory() {
  const limit = (state._noveltyRules && state._noveltyRules.maxHangarItemsInPrompt) || 60;
  return state.designs.slice(0, limit).map(d => {
    const p = d.params;
    const st = Lib.computeStats(p);
    const taper = p.rootChordMM ? p.tipChordMM / p.rootChordMM : 0;
    return `"${d.name}" | ${d.styleTag} | ${d.controlConfigTag || p.tailType} | span ${p.wingspanMM}mm | AR ${st.ar.toFixed(2)} | taper ${taper.toFixed(2)} | sweep ${p.sweepMM}mm | fuselage ${p.fuselageLengthMM}mm | CG ${p.cgPercentMAC}% | tail volume ${st.tailVolume.toFixed(2)} | loading ${st.wingLoading.toFixed(1)}g/dm²`;
  });
}

function normalizedName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function designDistance(a, b) {
  const ap = a.params, bp = b.params;
  const as = Lib.computeStats(ap), bs = Lib.computeStats(bp);
  const rules = state._noveltyRules || {};
  const metricRules = rules.metrics || {};
  const rel = (x, y, floor = 1) => Math.abs(x - y) / Math.max(floor, Math.abs(x), Math.abs(y));
  const sameStyle = String(a.styleTag || '').toUpperCase() === String(b.styleTag || '').toUpperCase();
  const sameControl = String(a.controlConfigTag || ap.tailType || '') === String(b.controlConfigTag || bp.tailType || '');
  const values = {
    wingspanMM: [ap.wingspanMM, bp.wingspanMM],
    aspectRatio: [as.ar, bs.ar],
    taperRatio: [ap.tipChordMM / Math.max(1, ap.rootChordMM), bp.tipChordMM / Math.max(1, bp.rootChordMM)],
    sweepMM: [ap.sweepMM, bp.sweepMM],
    fuselageToSpanRatio: [ap.fuselageLengthMM / Math.max(1, ap.wingspanMM), bp.fuselageLengthMM / Math.max(1, bp.wingspanMM)],
    cgPercentMAC: [ap.cgPercentMAC, bp.cgPercentMAC],
    tailVolumeCoefficient: [as.tailVolume, bs.tailVolume],
    wingLoadingGPerDM2: [as.wingLoading, bs.wingLoading],
  };
  let weighted = 0, totalWeight = 0;
  for (const [key, pair] of Object.entries(values)) {
    const r = metricRules[key] || {};
    const weight = Number(r.weight) || 1;
    const distance = r.absoluteScale
      ? Math.abs(pair[0] - pair[1]) / Number(r.absoluteScale)
      : rel(pair[0], pair[1], Number(r.normalizationFloor) || 1);
    weighted += Math.min(1, distance) * weight;
    totalWeight += weight;
  }
  const geometryDistance = totalWeight ? weighted / totalWeight : 1;
  const penalties = rules.categoryPenalties || {};
  return geometryDistance
    + (sameStyle ? 0 : Number(penalties.differentStyle ?? 0.22))
    + (sameControl ? 0 : Number(penalties.differentControlConfiguration ?? 0.22));
}

function findDuplicate(candidate) {
  const rules = state._noveltyRules || {};
  const threshold = Number(rules.duplicateDistanceThreshold) || 0.115;
  const candidateName = normalizedName(candidate.name);
  let closest = null;
  for (const existing of state.designs) {
    const exactName = !!(rules.name?.rejectExactNormalizedName !== false && candidateName && candidateName === normalizedName(existing.name));
    const distance = designDistance(candidate, existing);
    if (exactName || distance < threshold) {
      if (!closest || exactName || distance < closest.distance) closest = { existing, distance, exactName };
    }
  }
  return closest;
}

function duplicateFeedback(match) {
  const d = match.existing;
  const st = Lib.computeStats(d.params);
  const minChanges = (state._noveltyRules && state._noveltyRules.minimumMaterialDifferences) || 3;
  const retry = (state._noveltyRules && state._noveltyRules.retryInstruction) || 'Change the geometry materially while staying inside all safety bands.';
  return `Too similar to "${d.name}" (${d.styleTag}, ${d.controlConfigTag || d.params.tailType}, span ${d.params.wingspanMM}mm, AR ${st.ar.toFixed(2)}, sweep ${d.params.sweepMM}mm, CG ${d.params.cgPercentMAC}%). Change at least ${minChanges} engineering metrics. ${retry}`;
}

const GEN_LINES = [
  '> SOLVING PLANFORM + TAPER…',
  '> ESTIMATING ALL-UP WEIGHT…',
  '> SELECTING MOTOR / PROP SYSTEM…',
  '> SOLVING STABILITY VOLUMES…',
  '> POSITIONING BATTERY + CG RANGE…',
  '> LAYING OUT SPARS, SERVOS + HINGES…',
  '> ASSEMBLING EXPLODED BUILD DOSSIER…',
];
let logTimer = null;

async function onGenerate() {
  if (state.generating) return;

  // 1) Knowledge is mandatory. Fetch fresh (no-store) so a deleted/renamed
  // file is detected immediately — no cached success, no fallback.
  let knowledge;
  try {
    knowledge = await loadKnowledgeFiles();
    state.knowledgeStatus = { loaded: true, files: knowledge.fileList, totalChars: knowledge.totalChars, error: null };
    state._noveltyRules = knowledge.parsed.novelty;
    state._knowledge = knowledge.parsed;
  } catch (e) {
    state.knowledgeStatus = { loaded: false, files: [], totalChars: 0, error: (e && e.message) || String(e) };
    renderKnowledgeDebug();
    state.generating = false;
    state.error = 'Knowledge files missing. Aircraft generation disabled. ' + ((e && e.message) || String(e));
    renderConsole();
    return;
  }
  renderKnowledgeDebug();

  const memory = buildMemory();
  state.generating = true;
  state.error = null;
  state.log = ['> MISSION ENVELOPE LOCKED', '> CHECKING CONTROL-LAYOUT COMPATIBILITY', `> CALIBRATION: ${memory.length} FLIGHT REPORT${memory.length === 1 ? '' : 'S'} LOADED`];
  renderConsole();
  setGenerateButtonBusy(true);
  let i = 0;
  logTimer = setInterval(() => {
    if (i < GEN_LINES.length) { state.log.push(GEN_LINES[i++]); renderLogLines(); }
  }, 1300);

  try {
    const formWithKnowledge = { ...state.form, knowledge: knowledge.parsed };
    const hangarInventory = buildHangarInventory();
    let parsed = null;
    let noveltyFeedback = '';
    const maxAttempts = (knowledge.parsed.novelty && knowledge.parsed.novelty.maxGenerationAttempts) || 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        state.log.push(`> NOVELTY RETRY ${attempt}/${maxAttempts} — REDESIGNING…`);
        renderLogLines();
      }
      const { system, messages } = Lib.buildPrompt(formWithKnowledge, memory, knowledge.text, hangarInventory, noveltyFeedback);
      const text = await llmComplete(system, messages);
      parsed = Lib.parseDesign(text, formWithKnowledge, knowledge.parsed);
      const duplicate = findDuplicate(parsed);
      if (!duplicate) break;
      noveltyFeedback = duplicateFeedback(duplicate);
      parsed = null;
      if (attempt === maxAttempts) {
        throw new Error('The model produced a near-duplicate after three attempts. Closest existing aircraft: ' + duplicate.existing.name + '. Change the style, control configuration, material, or wingspan to request a more distinct design.');
      }
    }
    // sanity assertion: the generated tail must match the requested control configuration
    const ccWanted = knowledge.parsed.designRules.controlConfigurations[state.form.controlConfig];
    if (ccWanted) {
      if (ccWanted.hasHorizontalStab && parsed.params.hStabSpanMM === 0)
        throw new Error('Internal mismatch: requested "' + state.form.controlConfig + '" but generated no horizontal tail. Check for stale files (see debug panel).');
      if (!ccWanted.hasHorizontalStab && parsed.params.hStabSpanMM > 0)
        throw new Error('Internal mismatch: requested "' + state.form.controlConfig + '" but generated a horizontal tail. Check for stale files (see debug panel).');
    }
    const design = { id: 'd' + Date.now(), userMade: true, createdAt: Date.now(), ...parsed };
    state.designs.unshift(design);
    persist();
    sbSaveDesign(design);
    clearInterval(logTimer);
    state.generating = false;
    state.log = [];
    setGenerateButtonBusy(false);
    openDesign(design.id);
  } catch (e) {
    clearInterval(logTimer);
    state.generating = false;
    setGenerateButtonBusy(false);
    let msg = (e && e.message) || String(e);
    if (/rate|429|too many/i.test(msg)) msg = 'RATE LIMIT — wait a minute and try again.';
    else if (/failed to fetch/i.test(msg)) msg = 'Could not reach the AI proxy. Check CONFIG.API_PROXY_URL.';
    else if (/JSON|Unexpected/i.test(msg)) msg = 'The model returned a malformed plan. Try again — usually a one-off.';
    state.error = msg;
    renderConsole();
  }
}
function setGenerateButtonBusy(busy) {
  const btn = document.getElementById('btn-generate');
  btn.disabled = busy;
  btn.textContent = busy ? 'ENGINEERING AIRFRAME…' : 'GENERATE AIRFRAME';
}

/* ============================================================
   VIEW SWITCHING
   ============================================================ */
function go(view) {
  state.view = view;
  state.error = null;
  state.log = [];
  document.getElementById('view-home').hidden = view !== 'home';
  document.getElementById('view-new').hidden = view !== 'new';
  document.getElementById('view-detail').hidden = view !== 'detail';
  if (view === 'new') { syncFormButtons(); renderConsole(); renderKnowledgeDebug(); }
  if (view === 'home') renderCards();
  window.scrollTo(0, 0);
}

function openDesign(id) {
  state.activeId = id;
  const l = state.flightLogs[id] || {};
  state.report = { verdict: l.verdict || '', note: l.note || '' };
  state.view = 'detail';
  document.getElementById('view-home').hidden = true;
  document.getElementById('view-new').hidden = true;
  document.getElementById('view-detail').hidden = false;
  renderDetail();
  window.scrollTo(0, 0);
}
const active = () => state.designs.find(d => d.id === state.activeId) || null;

/* ============================================================
   FORM EVENT HANDLERS
   ============================================================ */
function controlAllowedForStyle(controlName, styleName) {
  const cc = (state._controlConfigurations || {})[controlName];
  return !cc || !Array.isArray(cc.allowedStyles) || cc.allowedStyles.includes(styleName);
}
function selectFirstCompatibleControl() {
  if (controlAllowedForStyle(state.form.controlConfig, state.form.style)) return;
  const next = Object.keys(state._controlConfigurations || {}).find(name => controlAllowedForStyle(name, state.form.style));
  if (next) state.form.controlConfig = next;
}
function onStyleChange(v) { state.form.style = v; selectFirstCompatibleControl(); syncFormButtons(); }
function onFoamChange(v) { state.form.foam = v; syncFormButtons(); }
function onControlConfigChange(v) {
  if (!controlAllowedForStyle(v, state.form.style)) return;
  state.form.controlConfig = v;
  syncFormButtons();
}
function onWingspanChange(v) {
  state.form.wingspan = Number(v);
  document.getElementById('out-span').textContent = v + ' MM';
  const note = document.getElementById('wingspan-note');
  const limit = state._wingPanelLimit || 800;
  note.textContent = state.form.wingspan > limit
    ? `Will be cut as panels no larger than ${limit}mm, joined at the centerline.`
    : '';
}

function syncFormButtons() {
  const f = state.form;
  for (const btn of document.querySelectorAll('#style-buttons button')) btn.classList.toggle('on', btn.dataset.style === f.style);
  for (const btn of document.querySelectorAll('#foam-buttons button')) btn.classList.toggle('on', btn.dataset.foam === f.foam);
  for (const btn of document.querySelectorAll('#control-config-buttons button')) {
    const allowed = controlAllowedForStyle(btn.dataset.cc, f.style);
    btn.disabled = !allowed;
    btn.classList.toggle('unavailable', !allowed);
    btn.classList.toggle('on', allowed && btn.dataset.cc === f.controlConfig);
  }
  document.getElementById('wingspan-slider').value = f.wingspan;
  document.getElementById('out-span').textContent = f.wingspan + ' MM';
  onWingspanChange(f.wingspan);
}

/* ============================================================
   ACTIONS — download / print / delete / report / export-import
   ============================================================ */
function onDownloadSvg() {
  const d = active(); if (!d) return;
  const svg = Lib.buildPlanSVG(d.params, Lib.PRINT_COLORS, { physical: true });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = d.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-cutsheet.svg';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function onPrintPdf() {
  const d = active(); if (!d) return;
  const svg = Lib.buildPlanSVG(d.params, Lib.PRINT_COLORS, { physical: true });
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
  document.body.appendChild(f);
  f.srcdoc = '<!DOCTYPE html><html><head><title>' + h(d.name) + '</title><style>@page{margin:8mm}body{margin:0}svg{max-width:100%;height:auto}</style></head><body>' + svg + '</body></html>';
  f.onload = () => setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000); }, 150);
}

function onDeleteDesign() {
  const d = active(); if (!d || !d.userMade) return;
  state.designs = state.designs.filter(x => x.id !== d.id);
  delete state.flightLogs[d.id];
  persist();
  go('home');
}

function onVerdictClick(v) {
  state.report.verdict = v;
  for (const btn of document.querySelectorAll('#verdict-buttons button')) btn.classList.toggle('on', btn.dataset.verdict === v);
  syncReportSaveButton();
}
function onReportNoteChange(v) { state.report.note = v; syncReportSaveButton(); }
function syncReportSaveButton() {
  const d = active(); if (!d) return;
  const saved = state.flightLogs[d.id];
  const isSaved = saved && saved.verdict === state.report.verdict && (saved.note || '') === (state.report.note || '');
  const btn = document.getElementById('btn-save-report');
  btn.textContent = isSaved ? '✓ REPORT LOGGED — TRAINING FUTURE DESIGNS' : 'FILE FLIGHT REPORT';
}
function onSaveReport() {
  const d = active(); if (!d || !state.report.verdict) return;
  state.flightLogs[d.id] = { ...state.report, ts: Date.now() };
  persist();
  syncReportSaveButton();
}

function onExportHangar() {
  const data = { slipstream: 1, exportedAt: new Date().toISOString(), designs: state.designs.filter(d => d.userMade), flightLogs: state.flightLogs };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'slipstream-hangar.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function onImportHangar(input) {
  const file = input.files && input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const incoming = (Array.isArray(data.designs) ? data.designs : []).filter(d => d && d.params);
      const existing = new Set(state.designs.map(d => d.id));
      state.designs = [...incoming.filter(d => !existing.has(d.id)).map(d => ({ ...d, userMade: true })), ...state.designs];
      Object.assign(state.flightLogs, data.flightLogs || {});
      persist();
      renderCards();
    } catch (e) { console.warn('import failed', e); }
  };
  reader.readAsText(file);
  input.value = '';
}

/* ============================================================
   GENERATION STAGE — morphing blueprint aircraft
   ============================================================ */
function genStage() {
  const flyingWing = state.form.controlConfig === 'Elevons only';
  const vTail = state.form.controlConfig === 'V-tail';
  const spanLabel = state.form.wingspan + ' MM';
  const tail = flyingWing ? '' : vTail
    ? '<path class="draft-line phase-3" d="M100 112 L78 124 L100 116 L122 124 Z"/>'
    : '<path class="draft-line phase-3" d="M74 116 L100 108 L126 116 L124 126 L76 126 Z"/><path class="draft-line phase-3" d="M100 103 L108 126 L100 126 Z"/>';
  const pod = flyingWing
    ? '<path class="draft-line phase-2" d="M92 40 L108 40 L114 112 L100 124 L86 112 Z"/>'
    : '<path class="draft-line phase-2" d="M94 24 L106 24 L110 122 L100 132 L90 122 Z"/>';
  return `
  <div class="design-solver">
    <div class="solver-head"><span>LIVE GEOMETRY SOLVER</span><span class="solver-span">${spanLabel}</span></div>
    <svg class="solver-svg" viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg" aria-label="Airframe being drafted">
      <g class="solver-grid"><path d="M20 20H180M20 45H180M20 70H180M20 95H180M20 120H180M40 10V140M70 10V140M100 10V140M130 10V140M160 10V140"/></g>
      <g fill="none" stroke="currentColor" stroke-linejoin="round">
        <path class="draft-line phase-1" d="M20 72 L100 42 L180 72 L172 104 L100 88 L28 104 Z"/>
        <path class="draft-line phase-2" d="M30 95 L78 84 M122 84 L170 95" stroke-dasharray="3 3"/>
        ${pod}${tail}
        <path class="draft-line phase-4 cg-ring" d="M94 76 A6 6 0 1 0 106 76 A6 6 0 1 0 94 76 M90 76H110M100 66V86"/>
        <path class="draft-line phase-4 dimension" d="M20 134H180M20 130V138M180 130V138"/>
      </g>
      <g class="solver-labels">
        <text x="100" y="146" text-anchor="middle">WINGSPAN ${spanLabel}</text>
        <text x="25" y="65">WING PANEL A</text><text x="175" y="65" text-anchor="end">WING PANEL B</text>
        <text x="108" y="74">CG</text>
      </g>
      <g class="solver-nodes"><circle cx="20" cy="72" r="2"/><circle cx="100" cy="42" r="2"/><circle cx="180" cy="72" r="2"/><circle cx="100" cy="88" r="2"/></g>
    </svg>
    <div class="solver-progress"><span></span></div>
    <div class="solver-caption">PARAMETRIC PLANFORM IS BEING SOLVED AGAINST THE KNOWLEDGE BASE AND EXISTING HANGAR</div>
  </div>`;
}
const DOTS = '<span class="dots"><span>.</span><span>.</span><span>.</span></span>';
function logLinesHtml() {
  return state.log.map((t, i) =>
    `<div class="line hot">${h(t)}${state.generating && i === state.log.length - 1 ? DOTS : ''}</div>`).join('');
}
function renderLogLines() {
  const el = document.getElementById('gen-log');
  if (el) el.innerHTML = logLinesHtml(); else renderConsole();
}
function renderConsole() {
  const busy = state.generating || state.log.length;
  const body = document.getElementById('console-body');
  body.innerHTML = busy
    ? (state.generating ? genStage() : '') + `<div id="gen-log">${logLinesHtml()}</div>`
    : `<div class="line hot">&gt; STANDING BY FOR PARAMETERS…</div>
       <div class="line">&nbsp;&nbsp;ENGINEERING PIPELINE:</div>
       <div class="line">&nbsp;&nbsp;· WING LOADING ENVELOPE (G/DM²)</div>
       <div class="line">&nbsp;&nbsp;· CG PLACEMENT PER STYLE BAND</div>
       <div class="line">&nbsp;&nbsp;· TAIL VOLUME + MOMENT ARM</div>
       <div class="line">&nbsp;&nbsp;· SPAR, HINGE + SERVO BAY LAYOUT</div>
       <div class="line">&nbsp;&nbsp;OUTPUT: BUILD DOSSIER + 1:1 SVG CUT SHEET</div>`;
  const err = document.getElementById('gen-error');
  err.hidden = !state.error;
  err.textContent = state.error ? 'ERR // ' + state.error : '';
}

/* ============================================================
   RENDER — hangar cards + design detail
   ============================================================ */
function renderCards() {
  const reportCount = Object.values(state.flightLogs).filter(l => l && l.verdict).length;
  document.getElementById('hangar-counts').textContent =
    `${String(state.designs.length).padStart(2, '0')} AIRFRAMES · ${String(reportCount).padStart(2, '0')} FLIGHT REPORTS`;

  const cards = state.designs.map((d, i) => {
    const log = state.flightLogs[d.id];
    const meta = `SPAN ${d.params.wingspanMM} MM · ${d.params.weightG} G · CG ${d.params.cgPercentMAC}% MAC`
      + (log && log.verdict ? ' · ' + log.verdict : '') + (d.userMade ? ' · YOURS' : '');
    return `
    <div class="card" style="animation-delay:${Math.min(i * 60, 480)}ms" onclick="openDesign('${h(d.id)}')">
      <div class="preview">${Lib.buildReadyViewSVG(d.params, theme)}</div>
      <div class="body">
        <div class="title-row"><span class="name">${h(d.name)}</span><span class="tag">${h(d.styleTag)}</span></div>
        <span class="meta">${h(meta)}</span>
      </div>
    </div>`;
  }).join('');
  document.getElementById('cards').innerHTML = cards;
}

function renderDetail() {
  const d = active();
  if (!d) { go('home'); return; }
  const st = Lib.computeStats(d.params);
  const r1 = n => Math.round(n * 10) / 10;

  document.getElementById('detail-name').textContent = d.name;
  document.getElementById('detail-tag').textContent = d.styleTag + (d.controlConfigTag ? ' · ' + d.controlConfigTag.toUpperCase() : '');
  document.getElementById('detail-desc').textContent = d.description;

  document.getElementById('detail-plan').innerHTML = Lib.buildDesignDossierSVG(d.params, theme);

  const rows = [
    ['WINGSPAN', d.params.wingspanMM + ' mm'],
    ['WING AREA', r1(st.areaDM2) + ' dm²'],
    ['MAC', Math.round(st.mac) + ' mm'],
    ['ALL-UP WEIGHT', d.params.weightG + ' g'],
    ['WING LOADING', r1(st.wingLoading) + ' g/dm²'],
    ['ASPECT RATIO', r1(st.ar)],
    ['CG', Math.round(st.cgFromRootLE) + ' mm aft LE · ' + d.params.cgPercentMAC + '%'],
    ['TAIL VOLUME', st.tailVolume ? r1(st.tailVolume) : '—'],
    ['MOTOR', d.params.motor],
    ['BATTERY', d.params.motorBattery || 'See motor guidance'],
    ['PROPELLER', d.params.motorProp || 'See motor guidance'],
    ['SERVOS', d.params.servoCount + '×'],
    ['MATERIAL', d.params.foam],
  ].map(([k, v]) => `<div class="stat-row"><span class="k">${h(k)}</span><span class="v">${h(String(v))}</span></div>`).join('');
  document.getElementById('detail-stats').innerHTML = rows;

  document.getElementById('detail-notes').innerHTML = (d.notes || []).map((t, i) =>
    `<div class="note-row"><span class="num">${String(i + 1).padStart(2, '0')}</span><span class="txt">${h(t)}</span></div>`).join('');

  document.getElementById('btn-delete').hidden = !d.userMade;

  for (const btn of document.querySelectorAll('#verdict-buttons button')) btn.classList.toggle('on', btn.dataset.verdict === state.report.verdict);
  document.getElementById('report-note').value = state.report.note;
  syncReportSaveButton();
}

/* ============================================================
   BOOT
   ============================================================ */
loadLocal();
go('home');
sbLoadGallery();
bootKnowledge();
