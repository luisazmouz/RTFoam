/* ============================================================
   SLIPSTREAM FOAMWORKS — app behavior
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
    motor: '',        // populated once motors.json loads
    controlConfig: 'Ailerons + Elevator',
    foam: '',         // populated once materials.json loads
    notes: ''
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
  let parsedAircraftTypes = null, parsedDesignRules = null, parsedValidation = null, parsedMaterials = null, parsedMotors = null;

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

  // motors
  const motors = parsed.motors || [];
  const motorBox = document.getElementById('motor-buttons');
  motorBox.innerHTML = motors.map(m =>
    `<button data-motor="${h(m.label)}" onclick="onMotorChange('${m.label.replace(/'/g, "\\'")}')">${h(m.label)}</button>`).join('');
  if (!state.form.motor && motors.length) state.form.motor = motors[0].label;

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
  const k = state.knowledgeStatus;
  if (k.loaded) {
    el.innerHTML = `<span style="color:#6FCF8E;">KNOWLEDGE LOADED: YES</span> — ${k.files.length} files, ${k.totalChars.toLocaleString()} chars<br>` +
      k.files.map(f => '· ' + h(f)).join('<br>');
  } else {
    el.innerHTML = `<span style="color:var(--danger);">KNOWLEDGE LOADED: NO</span>${k.error ? ' — ' + h(k.error) : ''}`;
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

const GEN_LINES = [
  '> SIZING WING PLANFORM…',
  '> CHECKING WING LOADING ENVELOPE…',
  '> SOLVING TAIL VOLUME + MOMENT ARM…',
  '> PLACING CENTER OF GRAVITY…',
  '> ROUTING SPAR + HINGE LINES…',
  '> DRAFTING CUT SHEET…',
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
  state.log = ['> PARAMETERS RECEIVED', `> CALIBRATION: ${memory.length} FLIGHT REPORT${memory.length === 1 ? '' : 'S'} LOADED`];
  renderConsole();
  setGenerateButtonBusy(true);
  let i = 0;
  logTimer = setInterval(() => {
    if (i < GEN_LINES.length) { state.log.push(GEN_LINES[i++]); renderLogLines(); }
  }, 1300);

  try {
    const formWithKnowledge = { ...state.form, knowledge: knowledge.parsed };
    const { system, messages } = Lib.buildPrompt(formWithKnowledge, memory, knowledge.text);
    const text = await llmComplete(system, messages);
    const parsed = Lib.parseDesign(text, formWithKnowledge, knowledge.parsed);
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
  btn.textContent = busy ? 'COMPUTING…' : '⚙ GENERATE AIRFRAME';
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
function onStyleChange(v) { state.form.style = v; syncFormButtons(); }
function onMotorChange(v) { state.form.motor = v; syncFormButtons(); }
function onFoamChange(v) { state.form.foam = v; syncFormButtons(); }
function onControlConfigChange(v) { state.form.controlConfig = v; syncFormButtons(); }
function onNotesChange(v) { state.form.notes = v; }
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
  for (const btn of document.querySelectorAll('#motor-buttons button')) btn.classList.toggle('on', btn.dataset.motor === f.motor);
  for (const btn of document.querySelectorAll('#foam-buttons button')) btn.classList.toggle('on', btn.dataset.foam === f.foam);
  for (const btn of document.querySelectorAll('#control-config-buttons button')) btn.classList.toggle('on', btn.dataset.cc === f.controlConfig);
  document.getElementById('wingspan-slider').value = f.wingspan;
  document.getElementById('out-span').textContent = f.wingspan + ' MM';
  document.getElementById('form-notes').value = f.notes;
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
function planeParts(cls, stroke, dash, fill) {
  return `
  <g class="${cls}" stroke="${stroke}" stroke-width="1.6" ${dash ? 'stroke-dasharray="4 3"' : ''} fill="${fill || 'none'}" fill-opacity="0" stroke-linejoin="round">
    <g class="pt-wing"><polygon points="38,66 100,52 162,66 162,80 100,72 38,80"/></g>
    <g class="pt-fus"><polygon points="96,20 104,20 106,118 94,118"/></g>
    <g class="pt-stab"><polygon points="78,106 122,106 118,120 82,120"/></g>
    <g class="pt-fin"><rect x="98.5" y="100" width="3" height="18"/></g>
  </g>`;
}
function genStage() {
  return `
  <div class="gen-stage">
    <svg viewBox="0 0 200 145" xmlns="http://www.w3.org/2000/svg">
      <circle class="gen-ring" cx="100" cy="72" r="60" fill="none" stroke="var(--stroke)" stroke-width="1" stroke-dasharray="3 6"/>
      ${planeParts('plane-wire', 'var(--dim)', true)}
      ${planeParts('plane-solid', 'var(--ink)', false, 'var(--accent)')}
      <g class="plan-marks">
        <circle cx="100" cy="66" r="5" fill="none" stroke="var(--accent)" stroke-width="1.4"/>
        <line x1="92" y1="66" x2="108" y2="66" stroke="var(--accent)" stroke-width="1.4"/>
        <line x1="100" y1="58" x2="100" y2="74" stroke="var(--accent)" stroke-width="1.4"/>
        <line x1="38" y1="132" x2="162" y2="132" stroke="var(--dim)" stroke-width="1"/>
        <line x1="38" y1="128" x2="38" y2="136" stroke="var(--dim)" stroke-width="1"/>
        <line x1="162" y1="128" x2="162" y2="136" stroke="var(--dim)" stroke-width="1"/>
      </g>
    </svg>
    <div class="scanbeam"></div>
    <div class="gen-status">DESIGNING AIRFRAME<span class="dots"><span>.</span><span>.</span><span>.</span></span></div>
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
       <div class="line">&nbsp;&nbsp;MODEL WILL SOLVE FOR:</div>
       <div class="line">&nbsp;&nbsp;· WING LOADING ENVELOPE (G/DM²)</div>
       <div class="line">&nbsp;&nbsp;· CG PLACEMENT PER STYLE BAND</div>
       <div class="line">&nbsp;&nbsp;· TAIL VOLUME + MOMENT ARM</div>
       <div class="line">&nbsp;&nbsp;· SPAR, HINGE + SERVO BAY LAYOUT</div>
       <div class="line">&nbsp;&nbsp;OUTPUT: 1:1 SVG CUT SHEET</div>`;
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
      <div class="preview">${Lib.buildPlanSVG(d.params, theme)}</div>
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

  document.getElementById('detail-plan').innerHTML = Lib.buildPlanSVG(d.params, theme);

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
