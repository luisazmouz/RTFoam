// plan-lib.js — geometry/rendering math for Slipstream Foamworks.
// Classic script: exposes window.PlanLib. All dimensions in mm unless noted.
//
// IMPORTANT: this file contains NO aircraft design bands (wing loading,
// aspect ratio, CG, tail volume, control-configuration servo counts, etc).
// Those live ONLY in /knowledge/*.json and are loaded at runtime by app.js,
// then passed into buildPrompt() / parseDesign() as the `knowledge` /
// `knowledgeText` arguments. This file is pure geometry (the algebra that
// turns a wing area + aspect ratio into chords, the SVG renderer) — the
// numeric design bands that decide WHAT wing loading/CG/etc a style should
// use are data, not code, and are never hardcoded here.
(function () {

function mid(range) { return (range[0] + range[1]) / 2; }
function asRange(value, spread) { return Array.isArray(value) ? value : [Number(value) - spread, Number(value) + spread]; }

/* ============================================================
   CORE EQUATIONS (pure math — see /knowledge/equations.json for
   the documented version injected into the AI prompt)
   ============================================================ */
function computeStats(p) {
  const root = p.rootChordMM, tip = p.tipChordMM;
  const areaMM2 = ((root + tip) / 2) * p.wingspanMM;
  const areaDM2 = areaMM2 / 10000;
  const taper = tip / root;
  const mac = root * (2 / 3) * ((1 + taper + taper * taper) / (1 + taper));
  const wingLoading = p.weightG / areaDM2;
  const ar = (p.wingspanMM * p.wingspanMM) / areaMM2;
  const s2 = p.wingspanMM / 2;
  const macY = (p.wingspanMM / 6) * ((1 + 2 * taper) / (1 + taper));
  const macLE = p.sweepMM * (macY / s2);
  const cgFromRootLE = macLE + mac * (p.cgPercentMAC / 100);
  const lh = Math.max(1, p.fuselageLengthMM - p.noseLengthMM);
  const hStabAreaMM2 = ((p.hStabSpanMM || 0) / 2) * (p.hStabChordMM || 0) * 2 * 0.9; // trapezoid approx
  const tailVolume = hStabAreaMM2 > 0 ? (hStabAreaMM2 * lh) / (areaMM2 * mac) : 0;
  return { areaDM2, areaMM2, mac, wingLoading, ar, cgFromRootLE, macLE, tailVolume, tailArmMM: lh };
}

const F = 'IBM Plex Mono, monospace';

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function num(n) { return Math.round(n * 10) / 10; }
function pts(arr) { return arr.map(p => `${num(p[0])},${num(p[1])}`).join(' '); }
function clamp(v, lo, hi, dflt) {
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
function clampInt(v, lo, hi, dflt) { return Math.round(clamp(v, lo, hi, dflt)); }

/* ============================================================
   SVG CUT-SHEET RENDERER
   Colors: { bg, line, dim, accent, grid }
   wingPanelLimitMM comes from knowledge/design-rules.json (passed
   in via p.wingPanelLimitMM); falls back to 800 if not supplied.
   ============================================================ */
function buildPlanSVG(p, c, opts) {
  opts = opts || {};
  const st = computeStats(p);
  const panelLimit = p.wingPanelLimitMM || 800;
  const M = 70;
  const span = p.wingspanMM, s2 = span / 2;
  const wh = Math.max(p.rootChordMM, p.sweepMM + p.tipChordMM);
  const hasHStab = p.hStabSpanMM >= 50;
  const hasVStab = p.vStabHeightMM >= 30;
  const isVtail = p.tailType === 'vtail';
  const isFlyingWing = p.tailType === 'flyingwing';
  const fusH = p.fuselageHeightMM, fusL = p.fuselageLengthMM;
  const row2H = Math.max(fusH, hasHStab ? p.hStabChordMM : 0, (hasVStab && !isVtail) ? p.vStabHeightMM : 0);
  const row2W = fusL + 70 + (hasHStab ? p.hStabSpanMM + 70 : 0) + ((hasVStab && !isVtail) ? p.vStabChordMM : 0);
  const titleW = 340, titleH = 96;
  const W = Math.max(span + 2 * M, row2W + 2 * M, 780);
  // assembled top view (reference drawing) occupies the first row
  const asmS = 0.5; // assembled view scale
  const asmTop = M + 30;
  const asmLen = Math.max(fusL, p.sweepMM + p.rootChordMM) * asmS;
  const wingY = asmTop + asmLen + 74;
  const dimGap = 56;
  const wingSplit = span > panelLimit;
  const row2Y = wingY + wh + dimGap + (wingSplit ? 24 : 0) + 40;
  const legendY = row2Y + row2H + dimGap + 26;
  const H = legendY + titleH + M * 0.6;
  const cx = W / 2;

  const S = [];
  const stroke = `stroke="${c.line}" fill="none" stroke-width="2" stroke-linejoin="round"`;
  const score = `stroke="${c.line}" fill="none" stroke-width="1.5" stroke-dasharray="8 6"`;
  const ref = `stroke="${c.accent}" fill="none" stroke-width="1.5"`;
  const thin = `stroke="${c.dim}" fill="none" stroke-width="1"`;
  function text(x, y, s, size, fill, anchor, weight) {
    return `<text x="${num(x)}" y="${num(y)}" font-family="${F}" font-size="${size || 12}" fill="${fill || c.dim}" text-anchor="${anchor || 'start'}"${weight ? ` font-weight="${weight}"` : ''} letter-spacing="1">${esc(s)}</text>`;
  }
  function dimH(x1, x2, y, label) {
    return `<line x1="${num(x1)}" y1="${num(y)}" x2="${num(x2)}" y2="${num(y)}" ${thin}/>` +
      `<line x1="${num(x1)}" y1="${num(y - 6)}" x2="${num(x1)}" y2="${num(y + 6)}" ${thin}/>` +
      `<line x1="${num(x2)}" y1="${num(y - 6)}" x2="${num(x2)}" y2="${num(y + 6)}" ${thin}/>` +
      text((x1 + x2) / 2, y - 8, label, 13, c.dim, 'middle');
  }

  S.push(`<rect width="${W}" height="${H}" fill="${c.bg}"/>`);
  const gl = [];
  for (let x = 0; x <= W; x += 50) gl.push(`M ${x} 0 V ${H}`);
  for (let y = 0; y <= H; y += 50) gl.push(`M 0 ${y} H ${W}`);
  S.push(`<path d="${gl.join(' ')}" stroke="${c.grid}" stroke-width="1" fill="none"/>`);
  S.push(`<rect x="14" y="14" width="${W - 28}" height="${H - 28}" fill="none" stroke="${c.dim}" stroke-width="1"/>`);

  // ===== ASSEMBLED TOP VIEW (reference — shows what the finished aircraft looks like) =====
  {
    const ay = asmTop;
    const nose = p.noseLengthMM * asmS;
    const fl = fusL * asmS;
    const fw = Math.max(p.fuselageHeightMM * 0.62, 26) * asmS * 2; // top-view fuselage width
    // wing root LE position along the fuselage: flying wings sit far aft, tailed planes ~just after the nose
    const wingRootLE = isFlyingWing ? ay + Math.max(fl - p.rootChordMM * asmS - 8, nose * 0.6) : ay + nose + fl * 0.06;
    // fuselage (top view): pointed nose, tapered tail
    const fus = [
      [cx, ay], [cx + fw / 2, ay + nose], [cx + fw / 2, ay + fl * 0.72],
      [cx + fw * 0.22, ay + fl], [cx - fw * 0.22, ay + fl], [cx - fw / 2, ay + fl * 0.72], [cx - fw / 2, ay + nose]
    ];
    S.push(`<polygon points="${pts(fus)}" ${stroke}/>`);
    // wing planform in place
    const ws2 = s2 * asmS, swp = p.sweepMM * asmS, rc = p.rootChordMM * asmS, tc = p.tipChordMM * asmS;
    const aw = [
      [cx - ws2, wingRootLE + swp], [cx, wingRootLE], [cx + ws2, wingRootLE + swp],
      [cx + ws2, wingRootLE + swp + tc], [cx, wingRootLE + rc], [cx - ws2, wingRootLE + swp + tc]
    ];
    S.push(`<polygon points="${pts(aw)}" ${stroke}/>`);
    if (isFlyingWing) {
      // winglets at the tips
      for (const sgn of [-1, 1]) {
        S.push(`<rect x="${num(cx + sgn * ws2 - (sgn > 0 ? 0 : 3))}" y="${num(wingRootLE + swp - 4)}" width="3" height="${num(tc + 8)}" fill="${c.line}"/>`);
      }
    } else if (hasHStab) {
      const hs2 = (p.hStabSpanMM / 2) * asmS, hc = p.hStabChordMM * asmS;
      const hLE = ay + fl - hc - 4;
      if (isVtail) {
        // V-tail seen from above: two swept panels splayed outward
        for (const sgn of [-1, 1]) {
          const vt = [[cx, hLE + hc * 0.2], [cx + sgn * hs2 * 0.85, hLE], [cx + sgn * hs2 * 0.85, hLE + hc * 0.75], [cx, hLE + hc]];
          S.push(`<polygon points="${pts(vt)}" ${stroke}/>`);
        }
      } else {
        const ht = [
          [cx - hs2, hLE + hc * 0.25], [cx, hLE], [cx + hs2, hLE + hc * 0.25],
          [cx + hs2, hLE + hc], [cx - hs2, hLE + hc]
        ];
        S.push(`<polygon points="${pts(ht)}" ${stroke}/>`);
      }
    }
    // fin from above (thin centerline) — not for V-tail (its panels replace the fin)
    if (hasVStab && !isVtail) {
      S.push(`<rect x="${num(cx - 1.5)}" y="${num(ay + fl - p.vStabChordMM * asmS - 2)}" width="3" height="${num(p.vStabChordMM * asmS)}" fill="${c.line}"/>`);
    }
    // CG marker on the assembled view
    const acg = wingRootLE + st.cgFromRootLE * asmS;
    S.push(`<circle cx="${cx}" cy="${num(acg)}" r="6" ${ref}/>`);
    S.push(`<line x1="${num(cx - 10)}" y1="${num(acg)}" x2="${num(cx + 10)}" y2="${num(acg)}" ${ref}/>`);
    S.push(`<line x1="${cx}" y1="${num(acg - 10)}" x2="${cx}" y2="${num(acg + 10)}" ${ref}/>`);
    const cfg = isFlyingWing ? 'FLYING WING — ELEVONS' : isVtail ? 'V-TAIL' : p.hasRudder ? 'FULL TAIL + RUDDER' : 'CONVENTIONAL TAIL';
    S.push(text(cx - Math.max(ws2, fw / 2), ay - 16, `ASSEMBLED TOP VIEW — ${cfg} · SCALE 1:2 · REFERENCE, DO NOT CUT`, 12, c.line, 'start', 600));
  }

  // ===== WING (plan view) =====
  const wY = wingY;
  const wingPoly = [
    [cx - s2, wY + p.sweepMM], [cx, wY], [cx + s2, wY + p.sweepMM],
    [cx + s2, wY + p.sweepMM + p.tipChordMM], [cx, wY + p.rootChordMM], [cx - s2, wY + p.sweepMM + p.tipChordMM]
  ];
  S.push(`<polygon points="${pts(wingPoly)}" ${stroke}/>`);
  if (wingSplit) {
    S.push(`<line x1="${cx}" y1="${num(wY - 16)}" x2="${cx}" y2="${num(wY + p.rootChordMM + 16)}" stroke="${c.accent}" stroke-width="2" stroke-dasharray="10 6"/>`);
    S.push(text(cx + 14, wY - 20, `PANEL JOIN — SCORE + TAPE HINGE (2× ≤${panelLimit}MM PANELS)`, 11, c.accent));
  } else {
    S.push(`<line x1="${cx}" y1="${num(wY - 16)}" x2="${cx}" y2="${num(wY + p.rootChordMM + 16)}" ${thin} stroke-dasharray="12 5 2 5"/>`);
  }
  const sparRootY = wY + p.rootChordMM * 0.3;
  const sparTipY = wY + p.sweepMM + p.tipChordMM * 0.3;
  S.push(`<polyline points="${pts([[cx - s2 + 8, sparTipY], [cx, sparRootY], [cx + s2 - 8, sparTipY]])}" ${score}/>`);
  S.push(text(cx + 14, sparRootY - 6, 'SPAR — SCORE, DO NOT CUT', 11));
  const hingeRootY = wY + p.rootChordMM * 0.75;
  const hingeTipY = wY + p.sweepMM + p.tipChordMM * 0.75;
  const inset = Math.max(24, s2 * 0.08);
  const surfLabel = hasHStab ? 'AILERON — CUT + BEVEL HINGE' : 'ELEVON — CUT + BEVEL HINGE';
  S.push(`<polyline points="${pts([[cx - s2 + 10, hingeTipY], [cx - inset, hingeRootY]])}" ${score}/>`);
  S.push(`<polyline points="${pts([[cx + inset, hingeRootY], [cx + s2 - 10, hingeTipY]])}" ${score}/>`);
  S.push(text(cx - s2 + 14, hingeTipY + 18, surfLabel, 11));
  if (p.servoCount >= (hasHStab ? 4 : 2)) {
    const bayX = s2 * 0.45;
    const bayY = wY + p.sweepMM * (0.45) + ((p.rootChordMM + p.tipChordMM) / 2) * 0.5;
    for (const sgn of [-1, 1]) {
      S.push(`<rect x="${num(cx + sgn * bayX - 12)}" y="${num(bayY - 8)}" width="24" height="16" ${ref}/>`);
      S.push(text(cx + sgn * bayX, bayY + 28, 'SERVO 9G', 10, c.accent, 'middle'));
    }
  }
  const cgY = wY + st.cgFromRootLE;
  S.push(`<circle cx="${cx}" cy="${num(cgY)}" r="9" ${ref}/>`);
  S.push(`<line x1="${num(cx - 15)}" y1="${num(cgY)}" x2="${num(cx + 15)}" y2="${num(cgY)}" ${ref}/>`);
  S.push(`<line x1="${cx}" y1="${num(cgY - 15)}" x2="${cx}" y2="${num(cgY + 15)}" ${ref}/>`);
  S.push(text(cx + 22, cgY + 4, `CG ${Math.round(st.cgFromRootLE)} MM AFT OF ROOT LE (${p.cgPercentMAC}% MAC)`, 12, c.accent));
  S.push(text(cx - s2, wY - 14, wingSplit ? `PART A — WING, 2× ≤${panelLimit}MM PANELS` : 'PART A — WING (1×)', 13, c.line, 'start', 600));
  S.push(dimH(cx - s2, cx + s2, wY + wh + 30, `WINGSPAN ${span} MM`));

  // ===== ROW 2 =====
  let fx = M + 10;
  const fy = row2Y + (row2H - fusH) / 2;
  const nose = p.noseLengthMM, len = fusL, h = fusH;
  const fusPoly = [
    [fx, fy + h * 0.55], [fx + nose * 0.55, fy + h * 0.05], [fx + nose + len * 0.16, fy],
    [fx + len, fy + h * 0.5], [fx + len, fy + h * 0.82], [fx + nose * 0.4, fy + h], [fx + nose * 0.12, fy + h * 0.9]
  ];
  S.push(`<polygon points="${pts(fusPoly)}" ${stroke}/>`);
  S.push(`<line x1="${num(fx + nose * 0.3)}" y1="${num(fy + h * 0.12)}" x2="${num(fx + nose * 0.3)}" y2="${num(fy + h * 0.95)}" ${score}/>`);
  S.push(text(fx + nose * 0.3, fy - 10, 'FIREWALL', 10));
  S.push(`<rect x="${num(fx + len * 0.5)}" y="${num(fy + h * 0.35)}" width="24" height="16" ${ref}/>`);
  S.push(text(fx + len * 0.5 + 12, fy + h * 0.35 - 8, 'SERVO', 10, c.accent, 'middle'));
  S.push(text(fx, fy - 26, `PART B — FUSELAGE SIDE (2×)`, 13, c.line, 'start', 600));
  S.push(dimH(fx, fx + len, fy + h + 28, `LENGTH ${len} MM`));

  let hx = fx + len + 70;
  if (hasHStab) {
    const hs2 = p.hStabSpanMM / 2, hc = p.hStabChordMM;
    const hy = row2Y + (row2H - hc) / 2;
    const hcx = hx + hs2;
    const hPoly = [[hx, hy + hc * 0.25], [hcx, hy], [hx + p.hStabSpanMM, hy + hc * 0.25], [hx + p.hStabSpanMM, hy + hc], [hx, hy + hc]];
    S.push(`<polygon points="${pts(hPoly)}" ${stroke}/>`);
    S.push(`<line x1="${num(hx + 8)}" y1="${num(hy + hc * 0.7)}" x2="${num(hx + p.hStabSpanMM - 8)}" y2="${num(hy + hc * 0.7)}" ${score}/>`);
    const partLabel = isVtail ? 'PART C — V-TAIL PANEL (2×)' : 'PART C — H-STAB (1×)';
    const hingeLabel = isVtail ? 'RUDDERVATOR HINGE' : 'ELEVATOR HINGE';
    S.push(text(hx, hy - 12, partLabel, 13, c.line, 'start', 600));
    S.push(text(hcx, hy + hc * 0.7 + 16, hingeLabel, 10, c.dim, 'middle'));
    S.push(dimH(hx, hx + p.hStabSpanMM, hy + hc + 28, `${p.hStabSpanMM} MM`));
    hx += p.hStabSpanMM + 70;
  }
  if (hasVStab && !isVtail) {
    const vc = p.vStabChordMM, vh = p.vStabHeightMM;
    const vy = row2Y + (row2H - vh) / 2;
    const vPoly = [[hx, vy + vh], [hx + vc * 0.5, vy], [hx + vc, vy], [hx + vc, vy + vh]];
    S.push(`<polygon points="${pts(vPoly)}" ${stroke}/>`);
    S.push(`<line x1="${num(hx + vc * 0.75)}" y1="${num(vy + 8)}" x2="${num(hx + vc * 0.75)}" y2="${num(vy + vh - 8)}" ${score}/>`);
    S.push(text(hx, vy - 12, `PART D — FIN (${hasHStab ? '1×' : '2×'})`, 13, c.line, 'start', 600));
    S.push(text(hx + vc * 0.75, vy + vh + 16, p.hasRudder ? 'RUDDER HINGE' : 'FIXED FIN', 10, c.dim, 'middle'));
  }

  // ===== LEGEND + TITLE BLOCK =====
  const ly = legendY + 26;
  S.push(`<line x1="${M}" y1="${ly}" x2="${M + 44}" y2="${ly}" ${stroke}/>`);
  S.push(text(M + 54, ly + 4, 'CUT LINE', 11));
  S.push(`<line x1="${M + 150}" y1="${ly}" x2="${M + 194}" y2="${ly}" ${score}/>`);
  S.push(text(M + 204, ly + 4, 'SCORE / FOLD / HINGE', 11));
  S.push(`<line x1="${M + 400}" y1="${ly}" x2="${M + 444}" y2="${ly}" ${ref}/>`);
  S.push(text(M + 454, ly + 4, 'REFERENCE — CG / BAYS', 11));
  S.push(text(M, ly + 24, `MATERIAL: ${(p.foam || '5 MM FOAM BOARD').toUpperCase()} · PRINT AT 100% SCALE`, 11));

  const tbx = W - titleW - 30, tby = H - titleH - 30;
  S.push(`<rect x="${tbx}" y="${tby}" width="${titleW}" height="${titleH}" fill="none" stroke="${c.line}" stroke-width="1.5"/>`);
  S.push(`<line x1="${tbx}" y1="${tby + 34}" x2="${tbx + titleW}" y2="${tby + 34}" ${thin}/>`);
  S.push(`<line x1="${tbx}" y1="${tby + 64}" x2="${tbx + titleW}" y2="${tby + 64}" ${thin}/>`);
  S.push(text(tbx + 12, tby + 23, (p.name || 'UNTITLED').toUpperCase(), 15, c.line, 'start', 600));
  S.push(text(tbx + titleW - 12, tby + 23, 'SHEET 1/1', 11, c.dim, 'end'));
  S.push(text(tbx + 12, tby + 53, `AUW ${p.weightG} G · LOAD ${num(st.wingLoading)} G/DM² · AR ${num(st.ar)}`, 11));
  S.push(text(tbx + 12, tby + 84, `RTFOAM · SCALE 1:1 · ${opts.date || new Date().toISOString().slice(0, 10)}`, 11));

  const dims = opts.physical ? ` width="${num(W)}mm" height="${num(H)}mm"` : ' width="100%"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(W)} ${num(H)}"${dims} style="display:block">${S.join('')}</svg>`;
}

/* ============================================================
   SEED HANGAR — a handful of precomputed example RC foam-board
   aircraft shown before anyone has generated one of their own.
   These are static examples, not affected by /knowledge/.
   ============================================================ */
const SEED_DESIGNS = [
  { id:'seed-trainer', seed:true, name:'Pelican TR-2', styleTag:'TRAINER', controlConfigTag:'Ailerons + Elevator + Rudder', description:'A stable high-wing trainer with a broad constant-chord center section, rounded tips, and a long tail moment.', notes:['Build the high wing with mild dihedral.','Keep the battery movable through the marked CG range.'], params:{name:'Pelican TR-2',architecture:'trainer-high-wing',wingspanMM:1000,rootChordMM:220,tipChordMM:180,sweepMM:8,fuselageLengthMM:720,noseLengthMM:145,fuselageHeightMM:78,hStabSpanMM:360,hStabChordMM:110,vStabHeightMM:155,vStabChordMM:125,cgPercentMAC:28,weightG:520,motor:'2212 · 1000KV',motorBattery:'3S',motorProp:'10x4.5',servoCount:5,foam:'5 mm foam board',tailType:'full',hasRudder:true,wingPanelLimitMM:800}},
  { id:'seed-fighter', seed:true, name:'Iron Midge IF-9', styleTag:'FIGHTER', controlConfigTag:'Elevons only', description:'A compact delta fighter with a deep center chord, clipped tips, twin fins, and elevon control.', notes:['Use twin carbon spars across the center section.','Start at the forward CG mark.'], params:{name:'Iron Midge IF-9',architecture:'fighter-delta',wingspanMM:680,rootChordMM:360,tipChordMM:95,sweepMM:205,fuselageLengthMM:430,noseLengthMM:125,fuselageHeightMM:66,hStabSpanMM:0,hStabChordMM:0,vStabHeightMM:118,vStabChordMM:95,cgPercentMAC:24,weightG:430,motor:'2205 · 2300KV',motorBattery:'3S',motorProp:'6x4',servoCount:2,foam:'5 mm foam board',tailType:'flyingwing',hasRudder:false,wingPanelLimitMM:800}},
  { id:'seed-experimental', seed:true, name:'XW-2 Kestrel', styleTag:'EXPERIMENTAL', controlConfigTag:'Elevons only', description:'A blended flying wing with a central equipment pod, moderate sweep, twin vertical fins, and detachable wing panels.', notes:['Dry-fit both wing panels to the center pod before gluing.','Keep the battery tray adjustable around the CG.'], params:{name:'XW-2 Kestrel',architecture:'experimental-flying-wing',wingspanMM:762,rootChordMM:310,tipChordMM:120,sweepMM:150,fuselageLengthMM:395,noseLengthMM:115,fuselageHeightMM:72,hStabSpanMM:0,hStabChordMM:0,vStabHeightMM:135,vStabChordMM:105,cgPercentMAC:26,weightG:580,motor:'2205 · 2300KV',motorBattery:'3S',motorProp:'7x4',servoCount:2,foam:'5 mm foam board',tailType:'flyingwing',hasRudder:false,wingPanelLimitMM:800}},
  { id:'seed-warbird', seed:true, name:'Mustang WB-5', styleTag:'WARBIRD', controlConfigTag:'Ailerons + Elevator + Rudder', description:'A scale-inspired low-wing warbird with an elliptical planform, narrow fuselage, and conventional full tail.', notes:['Reinforce the firewall with plywood.','Use low rates for the first flight.'], params:{name:'Mustang WB-5',architecture:'warbird-elliptical',wingspanMM:950,rootChordMM:210,tipChordMM:105,sweepMM:42,fuselageLengthMM:760,noseLengthMM:175,fuselageHeightMM:82,hStabSpanMM:330,hStabChordMM:105,vStabHeightMM:155,vStabChordMM:118,cgPercentMAC:29,weightG:610,motor:'2212 · 1400KV',motorBattery:'3S',motorProp:'9x6',servoCount:5,foam:'5 mm foam board',tailType:'full',hasRudder:true,wingPanelLimitMM:800}}
];

/* ============================================================
   AI PROMPT
   knowledgeText is the raw concatenated contents of every file in
   /knowledge/ (see app.js loadKnowledgeFiles()) — it is injected
   verbatim between MANDATORY markers. There is no hardcoded
   fallback text here: if knowledgeText is empty, generation should
   never have been attempted (app.js enforces this before calling
   buildPrompt at all).
   ============================================================ */
function buildPrompt(form, memory, knowledgeText, hangarInventory, noveltyFeedback) {
  let system = `You are a senior aerospace engineer specializing in RC foam-board aircraft (radio-controlled models cut from flat foam board, powered by a brushless motor and hobby servos — NOT paper airplanes).

You are NOT a creative writer. You are NOT producing concept art. You are designing aircraft that should realistically fly. Every dimension must be chosen using the design bands and equations supplied below, not guesses. Your job is to produce a conservative, stable aircraft that an experienced RC builder could reasonably expect to trim and fly.

GENERAL PRINCIPLES
• Stability is always more important than performance.
• Never optimize for appearance.
• Never invent dimensions because they "look right" — use the mandatory design knowledge below.
• If requirements conflict, choose the safer design.

IMPORTANT — the all-up weight is NOT something you choose freely. The app computes it deterministically from the wing area you design and the style's target wing loading (see the knowledge below). Still return a weightG estimate for your own internal consistency, but understand it will be recalculated after your response using the mandatory bands. The app also clamps aspect ratio, CG, and tail volume into the bands from the knowledge below after you respond.

=== MANDATORY DESIGN KNOWLEDGE START ===
${knowledgeText}
=== MANDATORY DESIGN KNOWLEDGE END ===

OUTPUT — respond with ONLY a single valid JSON object. No markdown. No explanation. No comments. Every number must be an integer:
{"name": "two-word callsign + short designation, e.g. 'Harrier SK-7'",
"description": "1–2 sentences on character and mission",
"rootChordMM": n, "tipChordMM": n, "sweepMM": n,
"targetWingLoadingGPerDM2": n, "tailVolumeCoefficient": n,
"fuselageLengthMM": n, "noseLengthMM": n, "fuselageHeightMM": n,
"hStabSpanMM": n, "hStabChordMM": n, "vStabHeightMM": n, "vStabChordMM": n,
"cgPercentMAC": n, "weightG": n,
"notes": ["4–6 short build & flight notes specific to this design"]}
All dimensions integers in mm. tailVolumeCoefficient is the coefficient multiplied by 100 (for example, return 50 for 0.50).`;

  if (memory && memory.length) {
    system += `

CALIBRATION — real flight reports from this pilot's previous builds. Learn from them: if reports say nose-heavy, place CG slightly further aft or flag battery position; tail-heavy → CG forward; stalled/crashed → lower wing loading or bigger tail; too fast → more area or less sweep. Reports:
${memory.map(m => '- ' + m).join('\n')}`;
  }

  if (hangarInventory && hangarInventory.length) {
    system += `

HANGAR INVENTORY — these aircraft already exist. You MUST compare the new design against every item below before answering. Do not reuse a name, designation, or nearly identical geometry. A new aircraft is considered a duplicate when it has the same style/control layout and closely similar span, aspect ratio, taper, sweep, fuselage proportion, CG, and tail volume. Create a materially different but still conservative solution within the mandatory safety bands.
${hangarInventory.map(m => '- ' + m).join('\n')}`;
  }

  if (noveltyFeedback) {
    system += `

REJECTED CANDIDATE FEEDBACK — the previous candidate was too similar to an existing hangar aircraft. Correct this explicitly while staying inside all mandatory engineering bands:
${noveltyFeedback}`;
  }

  const knowledge = form.knowledge; // parsed JSON, attached by app.js
  const cc = (knowledge && knowledge.designRules.controlConfigurations[form.controlConfig]) || { tailType: 'conventional', rudder: false };
  const panelLimit = (knowledge && knowledge.designRules.wingPanelLimitMM) || 800;
  const user = `Design an RC foam-board aircraft:
- Style: ${form.style}
- Wingspan: exactly ${form.wingspan} mm${form.wingspan > panelLimit ? ` (this will be built as panels no larger than ${panelLimit}mm each, joined at the centerline — design the planform as one continuous wing, the app handles the panel split)` : ''}
- Control configuration: ${form.controlConfig} (${cc.tailType === 'flyingwing' ? 'flying wing — no horizontal stabilizer, elevons on the wing trailing edge' : cc.tailType === 'vtail' ? 'V-tail — two angled ruddervator panels instead of separate stab + fin' : cc.hasRudder ? 'full tail with rudder' : 'conventional fixed-fin tail'})
- Material: ${form.foam}
- Motor system: select and recommend the safest compatible motor, battery-cell count, and propeller from motors.json after solving the airframe weight. Do not assume a user-selected motor.`;

  return { system, messages: [{ role: 'user', content: user }] };
}

/* ============================================================
   PARSE + ENGINEERING VALIDATION
   knowledge = { aircraftTypes, designRules, validation } — parsed
   JSON from /knowledge/aircraft-types.json, design-rules.json,
   validation.json (see app.js loadKnowledgeFiles()). This function
   throws if knowledge is missing rather than silently using a
   hardcoded default, because the source of truth for these bands
   must be the knowledge files, not this code.
   ============================================================ */
function parseDesign(text, form, knowledge) {
  if (!knowledge || !knowledge.aircraftTypes || !knowledge.designRules || !knowledge.validation || !knowledge.materials || !knowledge.motors || !knowledge.novelty) {
    throw new Error('Knowledge files missing. Aircraft generation disabled.');
  }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('Model returned no JSON');
  const j = JSON.parse(text.slice(a, b + 1));

  const spec = knowledge.aircraftTypes[form.style];
  if (!spec) throw new Error('No design band for style "' + form.style + '" in aircraft-types.json');
  const cc = knowledge.designRules.controlConfigurations[form.controlConfig];
  if (!cc) throw new Error('No control configuration "' + form.controlConfig + '" in design-rules.json');
  const rules = knowledge.designRules;
  const val = knowledge.validation;
  const isWing = cc.tailType === 'flyingwing';
  if (Array.isArray(cc.allowedStyles) && !cc.allowedStyles.includes(form.style)) {
    throw new Error('Control configuration "' + form.controlConfig + '" is not approved for style "' + form.style + '".');
  }
  const materialSpec = knowledge.materials.find(m => m.label === form.foam);
  if (!materialSpec) throw new Error('Selected material is missing from materials.json: ' + form.foam);

  const materialSpan = materialSpec.absoluteWingspanMM || val.wingspanMM;
  const wingspanMM = clampInt(form.wingspan, val.wingspanMM[0], val.wingspanMM[1], 900);
  if (wingspanMM < materialSpan[0] || wingspanMM > materialSpan[1]) {
    throw new Error(form.foam + ' supports ' + materialSpan[0] + '–' + materialSpan[1] + ' mm wingspan; requested ' + wingspanMM + ' mm.');
  }

  // --- wing: preserve the model's proposed planform variation, but clamp
  // both taper and aspect ratio into the style's proven-safe bands. This avoids
  // collapsing every aircraft of the same style/span into the same midpoint geometry.
  const modelRoot = Number(j.rootChordMM) || wingspanMM / mid(spec.aspectRatio);
  const modelTip = Number(j.tipChordMM) || modelRoot * rules.taperRatio.default;
  const styleTaper = isWing && spec.flyingWingOverrides?.taperRatio ? spec.flyingWingOverrides.taperRatio : (spec.taperRatio || [rules.taperRatio.min, rules.taperRatio.max]);
  const taper = clamp(modelTip / Math.max(1, modelRoot), Math.max(rules.taperRatio.min, styleTaper[0]), Math.min(rules.taperRatio.max, styleTaper[1]), rules.taperRatio.default);
  const proposedAreaMM2 = ((modelRoot + modelTip) / 2) * wingspanMM;
  const proposedAR = proposedAreaMM2 > 0 ? (wingspanMM * wingspanMM) / proposedAreaMM2 : mid(spec.aspectRatio);
  const targetAR = clamp(proposedAR, spec.aspectRatio[0], spec.aspectRatio[1], mid(spec.aspectRatio));
  const avgChord = wingspanMM / targetAR;
  const rootBounds = val.rootChordMM || [val.minRootChordMM, 420];
  const tipBounds = val.tipChordMM || [val.minTipChordMM, 300];
  const rootChordMM = clampInt(Math.round((2 * avgChord) / (1 + taper)), Math.max(rootBounds[0], materialSpec.minimumRootChordMM || 0), rootBounds[1], Math.round((2 * avgChord) / (1 + taper)));
  const tipChordMM = clampInt(Math.round(taper * rootChordMM), tipBounds[0], tipBounds[1], Math.round(taper * rootChordMM));

  const sweepBand = isWing && spec.flyingWingOverrides?.rootSweepMM ? spec.flyingWingOverrides.rootSweepMM : spec.rootSweepMM;
  const sweepMM = isWing
    ? clampInt(j.sweepMM, Math.max(sweepBand[0], rules.flyingWingMinSweepMM || 120), Math.max(sweepBand[1], rules.flyingWingMinSweepMM || 120), Math.max(mid(sweepBand), rules.flyingWingMinSweepMM || 120))
    : clampInt(j.sweepMM, sweepBand[0], sweepBand[1], mid(sweepBand));

  const areaMM2 = ((rootChordMM + tipChordMM) / 2) * wingspanMM;
  const areaDM2 = areaMM2 / 10000;
  const macTaper = tipChordMM / rootChordMM;
  const mac = rootChordMM * (2 / 3) * ((1 + macTaper + macTaper * macTaper) / (1 + macTaper));

  // --- weight: solve from the style loading band. Motor selection happens
  // after geometry and weight are known, so the user never has to guess a power system.
  const loadingBand = isWing && spec.flyingWingOverrides?.wingLoadingGPerDM2
    ? spec.flyingWingOverrides.wingLoadingGPerDM2
    : spec.wingLoadingGPerDM2;
  const targetWingLoading = clamp(j.targetWingLoadingGPerDM2, loadingBand[0], loadingBand[1], mid(loadingBand));
  const weightBounds = val.weightG || [val.minWeightG, 1900];
  const weightG = clampInt(Math.round(areaDM2 * targetWingLoading), weightBounds[0], weightBounds[1], Math.round(areaDM2 * targetWingLoading));

  // Select the motor whose preferred AUW/span envelope best matches the solved aircraft.
  // Absolute limits are mandatory. Preferred ranges and mission suitability determine score.
  const styleWords = String(form.style || '').toLowerCase();
  const controlWords = String(form.controlConfig || '').toLowerCase();
  const motorCandidates = knowledge.motors.filter(m => {
    const abs = m.absoluteAllUpWeightG || m.recommendedAllUpWeightG;
    return abs && weightG >= abs[0] && weightG <= abs[1];
  });
  if (!motorCandidates.length) {
    throw new Error('No motor in motors.json safely supports the calculated ' + weightG + ' g all-up weight. Add a suitable motor or change the wingspan/material.');
  }
  function rangePenalty(value, range) {
    if (!range) return 0.35;
    if (value >= range[0] && value <= range[1]) return 0;
    return Math.min(2, Math.min(Math.abs(value - range[0]), Math.abs(value - range[1])) / Math.max(1, range[1] - range[0]));
  }
  function motorScore(m) {
    let score = rangePenalty(weightG, m.recommendedAllUpWeightG) * 4 + rangePenalty(wingspanMM, m.recommendedWingspanMM) * 2;
    const hay = ((m.class || '') + ' ' + (m.notes || '')).toLowerCase();
    if (hay.includes(styleWords)) score -= 0.8;
    if (isWing && (hay.includes('flying-wing') || hay.includes('fighter') || hay.includes('sport'))) score -= 0.9;
    if (controlWords.includes('rudder') && hay.includes('trainer')) score -= 0.15;
    const thrust = m.estimatedStaticThrustG ? mid(m.estimatedStaticThrustG) : 0;
    const ratio = thrust / Math.max(1, weightG);
    const desired = ['Fighter','Aerobatic','Sport'].includes(form.style) || isWing ? 1.0 : 0.75;
    if (ratio < desired) score += (desired - ratio) * 8;
    return score;
  }
  const motorSpec = motorCandidates.slice().sort((a, b) => motorScore(a) - motorScore(b))[0];
  const batteryCells = Array.isArray(motorSpec.batteryCells) ? motorSpec.batteryCells[0] + (motorSpec.batteryCells.length > 1 ? '–' + motorSpec.batteryCells[motorSpec.batteryCells.length - 1] : '') + 'S' : 'See motor data';
  const propeller = Array.isArray(motorSpec.propellers) ? motorSpec.propellers[0] : 'See motor data';

  // --- CG: clamp into style band ---
  const cgBand = isWing && spec.flyingWingOverrides?.cgPercentMAC ? spec.flyingWingOverrides.cgPercentMAC : spec.cgPercentMAC;
  const cgPercentMAC = clampInt(j.cgPercentMAC, cgBand[0], cgBand[1], mid(cgBand));

  // --- fuselage + tail arm ---
  const fuselageRatioBand = spec.fuselageToSpanRatio || [0.35, 1.05];
  const fuselageMin = Math.max(val.fuselageLengthMM[0], Math.round(wingspanMM * fuselageRatioBand[0]));
  const fuselageMax = Math.min(val.fuselageLengthMM[1], Math.round(wingspanMM * fuselageRatioBand[1]));
  let fuselageLengthMM = clampInt(j.fuselageLengthMM, fuselageMin, fuselageMax, Math.round((fuselageMin + fuselageMax) / 2));
  let noseLengthMM = clampInt(j.noseLengthMM, 50, 320, Math.round(fuselageLengthMM * (rules.noseLengthPercentFuselage[0] / 100 + 0.03)));
  const minTailArm = rules.tailArmToMACRatio[0] * mac, maxTailArm = rules.tailArmToMACRatio[1] * mac;
  if (!isWing) {
    let tailArm = fuselageLengthMM - noseLengthMM;
    if (tailArm < minTailArm) fuselageLengthMM = Math.round(noseLengthMM + minTailArm);
    else if (tailArm > maxTailArm) fuselageLengthMM = Math.round(noseLengthMM + maxTailArm);
    fuselageLengthMM = clampInt(fuselageLengthMM, val.fuselageLengthMM[0], val.fuselageLengthMM[1], fuselageLengthMM);
  }
  noseLengthMM = clampInt(
    noseLengthMM,
    Math.round(fuselageLengthMM * rules.noseLengthPercentFuselage[0] / 100),
    Math.round(fuselageLengthMM * rules.noseLengthPercentFuselage[1] / 100),
    noseLengthMM
  );
  const fuselageHeightBand = spec.fuselageHeightToRootChordRatio || [0.2, 0.46];
  const fuselageHeightMM = clampInt(j.fuselageHeightMM, Math.max(val.fuselageHeightMM[0], Math.round(rootChordMM * fuselageHeightBand[0])), Math.min(val.fuselageHeightMM[1], Math.round(rootChordMM * fuselageHeightBand[1])), 68);

  // --- horizontal tail: sized from the tail volume coefficient, not guessed ---
  let hStabSpanMM = 0, hStabChordMM = 0;
  if (cc.hasHorizontalStab) {
    const lh = Math.max(1, fuselageLengthMM - noseLengthMM);
    const tailBand = asRange(spec.tailVolumeCoefficient, 0.05);
    const requestedTailVolume = clamp(Number(j.tailVolumeCoefficient) / 100, tailBand[0], tailBand[1], mid(tailBand));
    const shArea = (requestedTailVolume * areaMM2 * mac) / lh;
    const hStabARRange = asRange(rules.horizontalStabAspectRatio, 0.5);
    const hStabAR = mid(hStabARRange);
    const hSpanBounds = val.hStabSpanMM || [val.minHStabSpanMM, 650];
    const hChordBounds = val.hStabChordMM || [0, 240];
    hStabSpanMM = clampInt(Math.round(Math.sqrt(shArea * hStabAR)), Math.max(140, hSpanBounds[0]), hSpanBounds[1], Math.round(Math.sqrt(shArea * hStabAR)));
    hStabChordMM = clampInt(Math.round(shArea / hStabSpanMM), Math.max(45, hChordBounds[0]), hChordBounds[1], Math.round(shArea / hStabSpanMM));
    hStabSpanMM = Math.min(hStabSpanMM, Math.round(wingspanMM * 0.6));
  }

  // --- vertical tail: sized as a percentage of wing area ---
  const finBand = isWing && spec.flyingWingOverrides?.verticalFinPercentOfWingArea ? spec.flyingWingOverrides.verticalFinPercentOfWingArea : spec.verticalFinPercentOfWingArea;
  const vArea = (mid(finBand) / 100) * areaMM2;
  const finAR = mid(asRange(rules.verticalFinAspectRatio, 0.2));
  const vHeightBounds = val.vStabHeightMM || [val.minVStabHeightMM, 280];
  const vChordBounds = val.vStabChordMM || [45, 240];
  const vStabHeightMM = clampInt(Math.round(Math.sqrt(vArea * finAR)), vHeightBounds[0], vHeightBounds[1], Math.round(Math.sqrt(vArea * finAR)));
  const vStabChordMM = clampInt(Math.round(vArea / vStabHeightMM), vChordBounds[0], vChordBounds[1], Math.round(vArea / vStabHeightMM));

  const params = {
    name: String(j.name || 'Untitled Mk-1').slice(0, 40),
    wingspanMM, rootChordMM, tipChordMM, sweepMM,
    fuselageLengthMM, noseLengthMM, fuselageHeightMM,
    hStabSpanMM, hStabChordMM, vStabHeightMM, vStabChordMM,
    cgPercentMAC, weightG,
    motor: motorSpec.label, motorBattery: batteryCells, motorProp: propeller, motorReason: motorSpec.notes || '', servoCount: cc.servoCount, foam: form.foam,
    tailType: cc.tailType, hasRudder: cc.hasRudder,
    wingPanelLimitMM: rules.wingPanelLimitMM,
    designStyle: form.style, architecture: form.style === 'Trainer' ? 'trainer-high-wing' : form.style === 'Warbird' ? 'warbird-low-wing' : form.style === 'Fighter' ? (cc.tailType === 'flyingwing' ? 'fighter-delta' : 'fighter-swept-tail') : 'experimental-flying-wing'
  };

  const notes = Array.isArray(j.notes) ? j.notes.map(n => String(n)).slice(0, 6) : [];
  if (wingspanMM > rules.wingPanelLimitMM) {
    notes.unshift(`Wingspan is ${wingspanMM} mm — cut as panels no larger than ${rules.wingPanelLimitMM} mm each and join at the centerline with a taped hinge (see cut sheet panel-join mark).`);
  }
  if (cc.tailType === 'flyingwing') notes.unshift('Flying wing: CG is critical with no tail to mask an error — verify at the marked point before every flight.');
  if (cc.tailType === 'vtail') notes.unshift('V-tail: mount both tail panels at a dihedral angle per typical V-tail geometry (roughly 30–40° from horizontal) — they are cut flat.');
  if (cc.hasRudder) notes.unshift('Full tail: coordinate rudder with aileron on turns for a scale-like flight feel.');
  if (wingspanMM >= (materialSpec.sparRequiredAboveWingspanMM || Infinity)) notes.unshift(form.foam + ': carbon or wood spar reinforcement is mandatory at this span.');
  const recommendedWeight = motorSpec.recommendedAllUpWeightG || motorSpec.absoluteAllUpWeightG;
  notes.unshift(`Recommended power system: ${motorSpec.label}, ${batteryCells} battery, ${propeller} propeller. Verify measured current and thrust with the actual components.`);
  if (recommendedWeight && (weightG < recommendedWeight[0] || weightG > recommendedWeight[1])) notes.unshift(motorSpec.label + ': calculated AUW is outside the preferred range but inside the absolute limit; verify measured thrust before flight.');

  return {
    name: params.name,
    styleTag: form.style.toUpperCase(),
    controlConfigTag: form.controlConfig,
    description: String(j.description || '').slice(0, 220),
    notes: notes.slice(0, 6),
    architectureVariant: String(j.architectureVariant || params.architecture),
    construction: j.construction || null,
    visualBrief: j.visualBrief || null,
    params
  };
}


/* ============================================================
   DESIGN DOSSIER RENDERERS
   A coherent presentation view inspired by real assembly manuals:
   exploded components, ready views, specifications, and labels.
   The physical 1:1 cut sheet remains buildPlanSVG(..., {physical:true}).
   ============================================================ */
function buildReadyViewSVG(p, c) {
  const W = 900, H = 330, cx = W / 2;
  const scale = Math.min(0.42, 720 / Math.max(1, p.wingspanMM));
  const half = p.wingspanMM * scale / 2;
  const root = p.rootChordMM * scale, tip = p.tipChordMM * scale, sweep = p.sweepMM * scale;
  const y = 70;
  const wing = [[cx-half,y+sweep],[cx,y],[cx+half,y+sweep],[cx+half,y+sweep+tip],[cx,y+root],[cx-half,y+sweep+tip]];
  const pts2 = a => a.map(q => q.map(v => Math.round(v*10)/10).join(',')).join(' ');
  const isWing = p.tailType === 'flyingwing';
  const fusL = Math.min(190, p.fuselageLengthMM * scale);
  const fusW = Math.max(18, p.fuselageHeightMM * scale * 0.9);
  let extra = `<path d="M${cx-fusW/2},${y+8} L${cx+fusW/2},${y+8} L${cx+fusW*.65},${y+fusL*.72} L${cx},${y+fusL} L${cx-fusW*.65},${y+fusL*.72} Z" fill="${c.bg}" stroke="${c.line}" stroke-width="3"/>`;
  if (isWing) {
    extra += `<path d="M${cx-half+35},${y+sweep-8} v-${Math.max(28, p.vStabHeightMM*scale)} h16 v${Math.max(28, p.vStabHeightMM*scale)}z M${cx+half-51},${y+sweep-8} v-${Math.max(28, p.vStabHeightMM*scale)} h16 v${Math.max(28, p.vStabHeightMM*scale)}z" fill="${c.accent}" fill-opacity=".3" stroke="${c.line}" stroke-width="2"/>`;
  } else if (p.hStabSpanMM > 0) {
    const hs = p.hStabSpanMM*scale/2, hc=p.hStabChordMM*scale, ty=y+fusL-hc;
    extra += `<path d="M${cx-hs},${ty+hc*.25} L${cx},${ty} L${cx+hs},${ty+hc*.25} L${cx+hs},${ty+hc} L${cx-hs},${ty+hc}Z" fill="${c.bg}" stroke="${c.line}" stroke-width="2"/>`;
  }
  const st=computeStats(p), cg=y+st.cgFromRootLE*scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block"><rect width="${W}" height="${H}" fill="${c.bg}"/><g opacity=".18" stroke="${c.grid}"><path d="M0 55H900M0 110H900M0 165H900M0 220H900M0 275H900M75 0V330M150 0V330M225 0V330M300 0V330M375 0V330M450 0V330M525 0V330M600 0V330M675 0V330M750 0V330M825 0V330"/></g><polygon points="${pts2(wing)}" fill="${c.accent}" fill-opacity=".12" stroke="${c.line}" stroke-width="3"/>${extra}<circle cx="${cx}" cy="${cg}" r="8" fill="none" stroke="${c.accent}" stroke-width="2"/><path d="M${cx-13} ${cg}H${cx+13}M${cx} ${cg-13}V${cg+13}" stroke="${c.accent}" stroke-width="2"/><text x="24" y="35" fill="${c.line}" font-family="${F}" font-size="18" font-weight="600">${esc((p.name||'AIRFRAME').toUpperCase())}</text><text x="876" y="35" text-anchor="end" fill="${c.dim}" font-family="${F}" font-size="13">READY VIEW · ${p.wingspanMM} MM</text></svg>`;
}

function buildDesignDossierSVG(p, c) {
  const W=1600,H=1000, isWing=p.tailType==='flyingwing', isV=p.tailType==='vtail', st=computeStats(p);
  const line=c.line, dim=c.dim, ac=c.accent, bg=c.bg;
  const txt=(x,y,t,size=18,anchor='start',weight='400',fill=line)=>`<text x="${x}" y="${y}" font-family="${F}" font-size="${size}" text-anchor="${anchor}" font-weight="${weight}" fill="${fill}">${esc(t)}</text>`;
  const leader=(x1,y1,x2,y2)=>`<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${dim}" stroke-width="1.5" stroke-dasharray="7 6" fill="none"/>`;
  const wingPanel=(x,y,flip=1)=>{const L=470,rc=145,tc=80,sw=100; const d=flip>0?`M${x} ${y} L${x+L} ${y+sw} L${x+L} ${y+sw+tc} L${x} ${y+rc}Z`:`M${x} ${y} L${x-L} ${y+sw} L${x-L} ${y+sw+tc} L${x} ${y+rc}Z`; return `<path d="${d}" fill="${ac}" fill-opacity=".08" stroke="${line}" stroke-width="3"/><path d="${flip>0?`M${x+35} ${y+92}L${x+L-25} ${y+sw+tc*.45}`:`M${x-35} ${y+92}L${x-L+25} ${y+sw+tc*.45}`}" stroke="${dim}" stroke-width="2" stroke-dasharray="10 7"/>`;};
  const centerX=1020, centerY=235;
  let exploded=wingPanel(centerX-70,centerY+40,-1)+wingPanel(centerX+70,centerY+40,1);
  exploded+=`<path d="M${centerX-75} ${centerY+20} L${centerX+75} ${centerY+20} L${centerX+105} ${centerY+300} L${centerX} ${centerY+360} L${centerX-105} ${centerY+300}Z" fill="${bg}" stroke="${line}" stroke-width="3"/><rect x="${centerX-58}" y="${centerY+92}" width="116" height="72" rx="8" fill="${ac}" fill-opacity=".14" stroke="${line}" stroke-width="2"/>`;
  if(isWing){exploded+=`<path d="M${centerX-410} ${centerY-80} l75 -50 l22 155 l-88 18Z M${centerX+410} ${centerY-80} l-75 -50 l-22 155 l88 18Z" fill="${ac}" fill-opacity=".16" stroke="${line}" stroke-width="3"/>`;}
  else {exploded+=`<path d="M${centerX-160} ${centerY+380} L${centerX} ${centerY+330} L${centerX+160} ${centerY+380} L${centerX+145} ${centerY+445} L${centerX-145} ${centerY+445}Z" fill="${ac}" fill-opacity=".1" stroke="${line}" stroke-width="3"/>`; if(!isV) exploded+=`<path d="M${centerX} ${centerY+305} l65 75 h-65Z" fill="${ac}" fill-opacity=".18" stroke="${line}" stroke-width="3"/>`;}
  exploded+=`<rect x="${centerX-500}" y="${centerY+360}" width="410" height="12" rx="6" fill="${line}" opacity=".7"/><rect x="${centerX+90}" y="${centerY+360}" width="410" height="12" rx="6" fill="${line}" opacity=".7"/>`;
  const ready=buildReadyViewSVG(p,c).replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'');
  let specs=[['WINGSPAN',p.wingspanMM+' mm'],['LENGTH',p.fuselageLengthMM+' mm'],['FLYING WEIGHT',p.weightG+' g'],['MOTOR',p.motor],['BATTERY',p.motorBattery||'—'],['PROPELLER',p.motorProp||'—'],['SERVOS',p.servoCount+' × 9g'],['CG',p.cgPercentMAC+'% MAC'],['WING LOADING',num(st.wingLoading)+' g/dm²'],['MATERIAL',p.foam]];
  let specRows=specs.map((r,i)=>txt(48,285+i*34,r[0]+':',16,'start','600',line)+txt(235,285+i*34,r[1],16,'start','400',dim)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block"><rect width="${W}" height="${H}" fill="${bg}"/><rect x="18" y="18" width="1564" height="964" rx="12" fill="none" stroke="${dim}" stroke-width="1" opacity=".7"/>${txt(35,72,(p.name||'AIRFRAME').toUpperCase(),54,'start','700',line)}${txt(38,108,(isWing?'EXPERIMENTAL RC FLYING WING':isV?'RC V-TAIL AIRFRAME':'RC FOAM AIRFRAME')+' · RTFOAM',20,'start','500',dim)}<path d="M35 128H405" stroke="${line}" stroke-width="2"/>${txt(35,170,'A coherent parametric build package with solved stability,',17,'start','400',dim)}${txt(35,196,'recommended power system, assembly geometry, and CG.',17,'start','400',dim)}<rect x="30" y="225" width="380" height="390" rx="10" fill="none" stroke="${dim}" opacity=".7"/>${txt(45,260,'SPECIFICATIONS (RECOMMENDED)',18,'start','700',line)}${specRows}<rect x="430" y="25" width="1145" height="590" rx="10" fill="none" stroke="${dim}" opacity=".7"/><rect x="430" y="25" width="190" height="42" rx="8" fill="${line}"/>${txt(450,54,'EXPLODED VIEW',18,'start','700',bg)}${exploded}${leader(650,150,830,260)}${txt(625,138,'LEFT WING PANEL',16,'start','600',line)}${leader(1390,150,1210,260)}${txt(1410,138,'RIGHT WING PANEL',16,'end','600',line)}${leader(1130,120,1050,250)}${txt(1135,108,'CENTER POD / BATTERY BAY',16,'start','600',line)}${leader(560,520,700,600)}${txt(520,510,'SPAR STRIP',16,'start','600',line)}${leader(1460,520,1340,600)}${txt(1480,510,'SPAR STRIP',16,'end','600',line)}<rect x="30" y="635" width="1545" height="320" rx="10" fill="none" stroke="${dim}" opacity=".7"/><rect x="30" y="635" width="145" height="42" rx="8" fill="${line}"/>${txt(50,664,'READY VIEW',18,'start','700',bg)}<svg x="220" y="660" width="1050" height="270" viewBox="0 0 900 330">${ready}</svg>${txt(45,720,'ASSEMBLY PRIORITIES',18,'start','700',line)}${txt(45,755,'1  Cut mirrored panels accurately.',15,'start','400',dim)}${txt(45,785,'2  Install spars before closing folds.',15,'start','400',dim)}${txt(45,815,'3  Keep battery adjustable around CG.',15,'start','400',dim)}${txt(45,845,'4  Verify control direction and range.',15,'start','400',dim)}${txt(45,875,'5  Glide-test before powered flight.',15,'start','400',dim)}${txt(1545,935,'RTFOAM · BUILD DOSSIER · V9',13,'end','500',dim)}</svg>`;
}


/* ============================================================
   V10 ARCHITECTURE RENDERER
   Dedicated geometry and assembly drawings for four aircraft families.
   ============================================================ */
function styleOf(p){
  const s=String(p.designStyle||p.styleTag||'').toLowerCase();
  if(s.includes('warbird')) return 'warbird';
  if(s.includes('fighter')) return 'fighter';
  if(s.includes('experimental')) return 'experimental';
  if(s.includes('trainer')) return 'trainer';
  const a=String(p.architecture||'').toLowerCase();
  if(a.includes('warbird')) return 'warbird';
  if(a.includes('fighter')) return 'fighter';
  if(a.includes('experimental')||a.includes('flying-wing')) return 'experimental';
  return 'trainer';
}
function architectureOf(p){
  const s=styleOf(p);
  if(s==='warbird') return 'warbird-low-wing';
  if(s==='fighter') return p.tailType==='flyingwing'?'fighter-delta':'fighter-swept-tail';
  if(s==='experimental') return 'experimental-flying-wing';
  return 'trainer-high-wing';
}
function svgText(x,y,t,size,fill,anchor,weight){return `<text x="${num(x)}" y="${num(y)}" font-family="${F}" font-size="${size||14}" fill="${fill}" text-anchor="${anchor||'start'}" font-weight="${weight||400}">${esc(t)}</text>`}
function pathEl(d,fill,stroke,w=2,extra=''){return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${w}" stroke-linejoin="round" ${extra}/>`}
function buildPlanSVG(p,c,opts){
  opts=opts||{};
  const style=styleOf(p), M=55, gap=45, half=p.wingspanMM/2, root=p.rootChordMM, tip=p.tipChordMM, sweep=p.sweepMM;
  const wingH=Math.max(root,sweep+tip), wingW=p.wingspanMM+gap;
  const row2Y=M+wingH+95, tailW=Math.max(p.hStabSpanMM||0,p.vStabChordMM||0)+gap;
  const W=Math.max(wingW+2*M,p.fuselageLengthMM+tailW+3*M,900);
  const H=row2Y+Math.max(p.fuselageHeightMM+90,p.hStabChordMM+90,p.vStabHeightMM+90)+150;
  const line=c.line, dim=c.dim, ac=c.accent, bg=c.bg;
  const panelPath=(x,y,mirror)=>{
    const rootX=mirror?x:x+half, tipX=mirror?x+half:x;
    if(style==='warbird'){
      const sx=mirror?1:-1;
      return `M${rootX} ${y} C${rootX+sx*half*.30} ${y+sweep*.02} ${rootX+sx*half*.72} ${y+sweep*.22} ${tipX} ${y+sweep+tip*.35} C${tipX-sx*half*.02} ${y+sweep+tip*.72} ${rootX+sx*half*.68} ${y+sweep+tip} ${rootX+sx*half*.48} ${y+sweep+tip*.94} L${rootX} ${y+root} Z`;
    }
    if(style==='fighter') return `M${rootX} ${y} L${tipX} ${y+sweep} L${tipX+(mirror?-half*.14:half*.14)} ${y+sweep+tip} L${rootX} ${y+root} Z`;
    if(style==='experimental') return `M${rootX} ${y} L${tipX} ${y+sweep} Q${tipX+(mirror?10:-10)} ${y+sweep+tip*.55} ${tipX+(mirror?-half*.14:half*.14)} ${y+sweep+tip} L${rootX} ${y+root} Z`;
    const rr=Math.min(24,tip*.25); return `M${rootX} ${y} L${tipX+(mirror?-rr:rr)} ${y+sweep} Q${tipX} ${y+sweep} ${tipX} ${y+sweep+rr} L${tipX} ${y+sweep+tip-rr} Q${tipX} ${y+sweep+tip} ${tipX+(mirror?-rr:rr)} ${y+sweep+tip} L${rootX} ${y+root} Z`;
  };
  const left=panelPath(M,M,false), right=panelPath(M+half+gap,M,true);
  const sparY=M+root*.30, hingeY=M+root*.75;
  const fusX=M, fusY=row2Y, L=p.fuselageLengthMM, fh=p.fuselageHeightMM, nose=p.noseLengthMM;
  let fus=`M${fusX} ${fusY+fh*.55} Q${fusX+nose*.35} ${fusY} ${fusX+nose} ${fusY} L${fusX+L} ${fusY+fh*.42} L${fusX+L} ${fusY+fh*.82} L${fusX+nose*.35} ${fusY+fh} Z`;
  if(style==='fighter') fus=`M${fusX} ${fusY+fh*.50} L${fusX+nose} ${fusY} L${fusX+L} ${fusY+fh*.38} L${fusX+L} ${fusY+fh*.72} L${fusX+nose} ${fusY+fh} Z`;
  if(style==='warbird') fus=`M${fusX} ${fusY+fh*.55} C${fusX+nose*.25} ${fusY} ${fusX+nose*.85} ${fusY} ${fusX+nose} ${fusY+fh*.08} C${fusX+L*.45} ${fusY+fh*.08} ${fusX+L*.72} ${fusY+fh*.20} ${fusX+L} ${fusY+fh*.42} L${fusX+L} ${fusY+fh*.75} C${fusX+L*.62} ${fusY+fh*.78} ${fusX+L*.28} ${fusY+fh} ${fusX+nose*.2} ${fusY+fh} Z`;
  const tailX=fusX+L+gap, hspan=p.hStabSpanMM||0, hc=p.hStabChordMM||0;
  let htail=''; if(hspan>0){
    if(style==='warbird') htail=`M${tailX} ${fusY+hc*.45} C${tailX+hspan*.20} ${fusY} ${tailX+hspan*.40} ${fusY} ${tailX+hspan*.50} ${fusY+hc*.08} C${tailX+hspan*.60} ${fusY} ${tailX+hspan*.80} ${fusY} ${tailX+hspan} ${fusY+hc*.45} C${tailX+hspan*.78} ${fusY+hc} ${tailX+hspan*.22} ${fusY+hc} ${tailX} ${fusY+hc*.45} Z`;
    else htail=`M${tailX} ${fusY+hc*.20} L${tailX+hspan*.50} ${fusY} L${tailX+hspan} ${fusY+hc*.20} L${tailX+hspan*.88} ${fusY+hc} L${tailX+hspan*.12} ${fusY+hc} Z`;
  }
  const finX=tailX, finY=fusY+hc+28, vc=p.vStabChordMM||70, vh=p.vStabHeightMM||80;
  const fin=`M${finX} ${finY+vh} Q${finX+vc*.28} ${finY} ${finX+vc*.72} ${finY+vh*.18} L${finX+vc} ${finY+vh} Z`;
  const labels=`${svgText(M,M-15,'LEFT WING PANEL · 1×',13,line,'start',600)}${svgText(M+half+gap,M-15,'RIGHT WING PANEL · 1×',13,line,'start',600)}${svgText(fusX,fusY-15,'FUSELAGE SIDE · 2×',13,line,'start',600)}${hspan?svgText(tailX,fusY-15,'HORIZONTAL TAIL · 1×',13,line,'start',600):''}${svgText(finX,finY-10,'VERTICAL FIN · '+(p.tailType==='flyingwing'?'2×':'1×'),13,line,'start',600)}`;
  const dims=opts.physical?` width="${num(W)}mm" height="${num(H)}mm"`:' width="100%"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(W)} ${num(H)}"${dims}><rect width="${W}" height="${H}" fill="${bg}"/><path d="${left}" fill="none" stroke="${line}" stroke-width="2"/><path d="${right}" fill="none" stroke="${line}" stroke-width="2"/>${lineEl(M+half*.12,sparY,M+half*.92,sparY,dim,1.5,'8 6')}${lineEl(M+half+gap+half*.08,sparY,M+half+gap+half*.88,sparY,dim,1.5,'8 6')}${lineEl(M+half*.15,hingeY,M+half*.92,hingeY,dim,1.5,'4 5')}${lineEl(M+half+gap+half*.08,hingeY,M+half+gap+half*.85,hingeY,dim,1.5,'4 5')}<path d="${fus}" fill="none" stroke="${line}" stroke-width="2"/>${htail?`<path d="${htail}" fill="none" stroke="${line}" stroke-width="2"/>`:''}<path d="${fin}" fill="none" stroke="${line}" stroke-width="2"/>${labels}<circle cx="${M+half}" cy="${M+Math.min(root*.72,computeStats(p).cgFromRootLE)}" r="8" fill="none" stroke="${ac}" stroke-width="2"/>${svgText(M,H-50,`RTFOAM · ${architectureOf(p).replaceAll('-',' ').toUpperCase()} · TRUE SCALE CUT SHEET · V10`,14,line,'start',600)}${svgText(W-M,H-50,'SOLID: CUT · DASHED: SPAR / HINGE · PRINT 100%',12,dim,'end',500)}</svg>`;
}
function lineEl(x1,y1,x2,y2,stroke,w=1.5,dash=''){return `<path d="M${num(x1)} ${num(y1)}L${num(x2)} ${num(y2)}" fill="none" stroke="${stroke}" stroke-width="${w}"${dash?` stroke-dasharray="${dash}"`:''}/>`}

function v10Geometry(p,W=900,H=420){
  const style=styleOf(p), arch=architectureOf(p), cx=W/2;
  const span=Math.min(W*.82, Math.max(W*.52,p.wingspanMM*.65)), half=span/2;
  const root=Math.min(H*.43,Math.max(105,p.rootChordMM*.58));
  const tip=Math.max(42,Math.min(root*.72,p.tipChordMM*.52));
  const sweep=Math.min(root*.92,Math.max(0,p.sweepMM*.52));
  const wingY=style==='trainer'?125:style==='warbird'?155:105;
  let wing='', leftWing='', rightWing='', fus='', htail='', vtail='', fins='';
  const fusL=Math.min(H*.72,Math.max(190,p.fuselageLengthMM*.43));
  const fusW=Math.max(34,Math.min(78,p.fuselageHeightMM*.55));
  const tailY=wingY+fusL*.78;

  if(style==='trainer'){
    const r=22;
    leftWing=`M${cx-12} ${wingY} L${cx-half+r} ${wingY+sweep} Q${cx-half} ${wingY+sweep} ${cx-half} ${wingY+sweep+r} L${cx-half} ${wingY+sweep+tip-r} Q${cx-half} ${wingY+sweep+tip} ${cx-half+r} ${wingY+sweep+tip} L${cx-12} ${wingY+root} Z`;
    rightWing=leftWing.replaceAll(String(cx-half),String(cx+half)).replaceAll(String(cx-12),String(cx+12));
    rightWing=`M${cx+12} ${wingY} L${cx+half-r} ${wingY+sweep} Q${cx+half} ${wingY+sweep} ${cx+half} ${wingY+sweep+r} L${cx+half} ${wingY+sweep+tip-r} Q${cx+half} ${wingY+sweep+tip} ${cx+half-r} ${wingY+sweep+tip} L${cx+12} ${wingY+root} Z`;
    wing=leftWing+' '+rightWing;
    fus=`M${cx} ${wingY-85} Q${cx+fusW*.48} ${wingY-64} ${cx+fusW*.48} ${wingY+70} L${cx+fusW*.26} ${tailY+55} L${cx-fusW*.26} ${tailY+55} L${cx-fusW*.48} ${wingY+70} Q${cx-fusW*.48} ${wingY-64} ${cx} ${wingY-85} Z`;
    htail=`M${cx-145} ${tailY+18} Q${cx-148} ${tailY+5} ${cx-125} ${tailY} L${cx} ${tailY-8} L${cx+125} ${tailY} Q${cx+148} ${tailY+5} ${cx+145} ${tailY+18} L${cx} ${tailY+40} Z`;
    vtail=`M${cx} ${tailY+35} Q${cx+46} ${tailY+15} ${cx+38} ${tailY-55} L${cx} ${tailY-23} Z`;
  } else if(style==='warbird'){
    leftWing=`M${cx-18} ${wingY} C${cx-half*.28} ${wingY+sweep*.02} ${cx-half*.72} ${wingY+sweep*.25} ${cx-half} ${wingY+sweep+tip*.38} C${cx-half*.98} ${wingY+sweep+tip*.78} ${cx-half*.70} ${wingY+sweep+tip} ${cx-half*.50} ${wingY+sweep+tip*.94} L${cx-18} ${wingY+root} Z`;
    rightWing=`M${cx+18} ${wingY} C${cx+half*.28} ${wingY+sweep*.02} ${cx+half*.72} ${wingY+sweep*.25} ${cx+half} ${wingY+sweep+tip*.38} C${cx+half*.98} ${wingY+sweep+tip*.78} ${cx+half*.70} ${wingY+sweep+tip} ${cx+half*.50} ${wingY+sweep+tip*.94} L${cx+18} ${wingY+root} Z`;
    wing=leftWing+' '+rightWing;
    fus=`M${cx} ${wingY-118} C${cx+fusW*.58} ${wingY-110} ${cx+fusW*.62} ${wingY-52} ${cx+fusW*.55} ${wingY+45} C${cx+fusW*.48} ${wingY+130} ${cx+fusW*.28} ${tailY+30} ${cx+fusW*.15} ${tailY+70} L${cx-fusW*.15} ${tailY+70} C${cx-fusW*.28} ${tailY+30} ${cx-fusW*.48} ${wingY+130} ${cx-fusW*.55} ${wingY+45} C${cx-fusW*.62} ${wingY-52} ${cx-fusW*.58} ${wingY-110} ${cx} ${wingY-118} Z`;
    htail=`M${cx-125} ${tailY+25} C${cx-95} ${tailY+4} ${cx-35} ${tailY} ${cx} ${tailY-8} C${cx+35} ${tailY} ${cx+95} ${tailY+4} ${cx+125} ${tailY+25} C${cx+90} ${tailY+40} ${cx+35} ${tailY+42} ${cx} ${tailY+45} C${cx-35} ${tailY+42} ${cx-90} ${tailY+40} ${cx-125} ${tailY+25} Z`;
    vtail=`M${cx} ${tailY+40} C${cx+52} ${tailY+5} ${cx+38} ${tailY-70} ${cx+7} ${tailY-96} L${cx} ${tailY-20} Z`;
  } else if(style==='fighter'){
    if(p.tailType==='flyingwing'){
      leftWing=`M${cx-8} ${wingY} L${cx-half} ${wingY+sweep+10} L${cx-half*.82} ${wingY+sweep+tip} L${cx-8} ${wingY+root} Z`;
      rightWing=`M${cx+8} ${wingY} L${cx+half} ${wingY+sweep+10} L${cx+half*.82} ${wingY+sweep+tip} L${cx+8} ${wingY+root} Z`;
    }else{
      leftWing=`M${cx-18} ${wingY+12} L${cx-half} ${wingY+sweep} L${cx-half*.76} ${wingY+sweep+tip} L${cx-18} ${wingY+root} Z`;
      rightWing=`M${cx+18} ${wingY+12} L${cx+half} ${wingY+sweep} L${cx+half*.76} ${wingY+sweep+tip} L${cx+18} ${wingY+root} Z`;
      htail=`M${cx-115} ${tailY+8} L${cx} ${tailY-18} L${cx+115} ${tailY+8} L${cx+78} ${tailY+34} L${cx} ${tailY+28} L${cx-78} ${tailY+34} Z`;
    }
    wing=leftWing+' '+rightWing;
    fus=`M${cx} ${wingY-125} L${cx+fusW*.38} ${wingY-58} L${cx+fusW*.48} ${wingY+105} L${cx+fusW*.16} ${tailY+70} L${cx-fusW*.16} ${tailY+70} L${cx-fusW*.48} ${wingY+105} L${cx-fusW*.38} ${wingY-58} Z`;
    fins=`M${cx-half*.48} ${wingY+sweep+tip*.45} l-8 -62 l38 16 l4 58 z M${cx+half*.48} ${wingY+sweep+tip*.45} l8 -62 l-38 16 l-4 58 z`;
    if(p.tailType!=='flyingwing') vtail=`M${cx} ${tailY+35} L${cx+42} ${tailY-70} L${cx+18} ${tailY+48} Z`;
  } else {
    leftWing=`M${cx-28} ${wingY} L${cx-half} ${wingY+sweep} Q${cx-half*1.01} ${wingY+sweep+tip*.55} ${cx-half*.84} ${wingY+sweep+tip} L${cx-28} ${wingY+root} Z`;
    rightWing=`M${cx+28} ${wingY} L${cx+half} ${wingY+sweep} Q${cx+half*1.01} ${wingY+sweep+tip*.55} ${cx+half*.84} ${wingY+sweep+tip} L${cx+28} ${wingY+root} Z`;
    wing=leftWing+' '+rightWing;
    fus=`M${cx} ${wingY-78} Q${cx+fusW*.72} ${wingY-38} ${cx+fusW*.68} ${wingY+root*.42} L${cx+fusW*.42} ${wingY+root*.92} L${cx} ${wingY+root+45} L${cx-fusW*.42} ${wingY+root*.92} L${cx-fusW*.68} ${wingY+root*.42} Q${cx-fusW*.72} ${wingY-38} ${cx} ${wingY-78} Z`;
    fins=`M${cx-half*.56} ${wingY+sweep+tip*.48} l-10 -70 q32 -18 52 8 l3 70 z M${cx+half*.56} ${wingY+sweep+tip*.48} l10 -70 q-32 -18 -52 8 l-3 70 z`;
  }
  return {style,arch,cx,wingY,span,half,root,tip,sweep,fusL,fusW,tailY,wing,leftWing,rightWing,fus,htail,vtail,fins};
}
function buildReadyViewSVG(p,c){
  const W=900,H=420,g=v10Geometry(p,W,H),st=computeStats(p),line=c.line,dim=c.dim,ac=c.accent;
  const cgY=g.wingY+Math.min(g.root*.72,st.cgFromRootLE*.48);
  const wingFill=pathEl(g.wing,ac,line,3,'fill-opacity=".10"');
  const tail=(g.htail?pathEl(g.htail,ac,line,2,'fill-opacity=".09"'):'')+(g.vtail?pathEl(g.vtail,ac,line,2,'fill-opacity=".17"'):'')+(g.fins?pathEl(g.fins,ac,line,2,'fill-opacity=".17"'):'');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%"><rect width="${W}" height="${H}" fill="${c.bg}"/>${wingFill}${tail}${pathEl(g.fus,c.bg,line,3)}${lineEl(g.cx-g.half*.76,g.wingY+g.sweep+g.tip*.70,g.cx-34,g.wingY+g.root*.72,dim,2,'8 7')}${lineEl(g.cx+34,g.wingY+g.root*.72,g.cx+g.half*.76,g.wingY+g.sweep+g.tip*.70,dim,2,'8 7')}<circle cx="${g.cx}" cy="${num(cgY)}" r="8" fill="none" stroke="${ac}" stroke-width="2"/>${lineEl(g.cx-13,cgY,g.cx+13,cgY,ac,2)}${lineEl(g.cx,cgY-13,g.cx,cgY+13,ac,2)}${svgText(24,35,(p.name||'AIRCRAFT').toUpperCase(),18,line,'start',600)}${svgText(876,35,architectureOf(p).replaceAll('-',' ').toUpperCase(),12,dim,'end',500)}</svg>`;
}
function buildPerspectiveViewSVG(p,c){
  const W=900,H=420,inner=buildReadyViewSVG(p,c).replace(/^<svg[^>]*>/,'').replace(/<rect[^>]*\/>/,'').replace(/<text[\s\S]*$/,'');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%"><rect width="${W}" height="${H}" fill="${c.bg}"/><g transform="translate(72,8) skewX(-13) scale(.84,.70)">${inner}</g><ellipse cx="455" cy="350" rx="275" ry="25" fill="#000" opacity=".13"/>${svgText(24,35,(p.name||'AIRCRAFT').toUpperCase(),18,c.line,'start',600)}${svgText(876,35,'PERSPECTIVE ASSEMBLED VIEW',12,c.dim,'end',500)}</svg>`;
}
function buildExplodedPreviewSVG(p,c){
  const W=900,H=420,g=v10Geometry(p,W,H),line=c.line,dim=c.dim,ac=c.accent;
  const left=pathEl(g.leftWing,ac,line,3,'fill-opacity=".10" transform="translate(-46,-18)"');
  const right=pathEl(g.rightWing,ac,line,3,'fill-opacity=".10" transform="translate(46,-18)"');
  const center=pathEl(g.fus,c.bg,line,3,'transform="translate(0,45)"');
  const tails=(g.htail?pathEl(g.htail,ac,line,2,'fill-opacity=".10" transform="translate(0,62)"'):'')+(g.vtail?pathEl(g.vtail,ac,line,2,'fill-opacity=".18" transform="translate(0,82)"'):'')+(g.fins?pathEl(g.fins,ac,line,2,'fill-opacity=".18" transform="translate(0,-48)"'):'');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%"><rect width="${W}" height="${H}" fill="${c.bg}"/>${left}${right}${center}${tails}${lineEl(g.cx-75,g.wingY+30,g.cx-20,g.wingY+85,dim,1.5,'7 6')}${lineEl(g.cx+75,g.wingY+30,g.cx+20,g.wingY+85,dim,1.5,'7 6')}<rect x="${num(g.cx-g.half*.73)}" y="${num(g.wingY+g.root+95)}" width="${num(g.half*.55)}" height="8" rx="4" fill="${line}" opacity=".65"/><rect x="${num(g.cx+g.half*.18)}" y="${num(g.wingY+g.root+95)}" width="${num(g.half*.55)}" height="8" rx="4" fill="${line}" opacity=".65"/>${svgText(24,35,(p.name||'AIRCRAFT').toUpperCase(),18,line,'start',600)}${svgText(876,35,'EXPLODED ASSEMBLY',12,dim,'end',500)}</svg>`;
}
function buildDesignDossierSVG(p,c){
  const W=1600,H=1060,line='#202428',dim='#5a6066',ac='#9b6b3e',paper='#f7f7f3',st=computeStats(p),style=styleOf(p),arch=architectureOf(p);
  const exp=buildExplodedPreviewSVG(p,{bg:paper,line,dim,accent:ac}).replace(/^<svg[^>]*>/,'').replace(/<rect[^>]*\/>/,'').replace(/<text[\s\S]*$/,'');
  const top=buildReadyViewSVG(p,{bg:paper,line,dim,accent:ac}).replace(/^<svg[^>]*>/,'').replace(/<rect[^>]*\/>/,'').replace(/<text[\s\S]*$/,'');
  const perspective=buildPerspectiveViewSVG(p,{bg:paper,line,dim,accent:ac}).replace(/^<svg[^>]*>/,'').replace(/<rect[^>]*\/>/,'').replace(/<text[\s\S]*$/,'');
  const specs=[['Wingspan',p.wingspanMM+' mm'],['Length',p.fuselageLengthMM+' mm'],['Flying weight',p.weightG+' g'],['Motor',p.motor],['Battery',p.motorBattery||'—'],['Propeller',p.motorProp||'—'],['Servos',p.servoCount+' ×'],['CG',p.cgPercentMAC+'% MAC'],['Wing loading',num(st.wingLoading)+' g/dm²'],['Material',p.foam]];
  const rows=specs.map((r,i)=>`${svgText(42,292+i*30,r[0]+':',15,line,'start',600)}${svgText(205,292+i*30,r[1],15,dim)}`).join('');
  const labels= style==='warbird' ? ['LEFT ELLIPTICAL WING','RIGHT ELLIPTICAL WING','COWL / FUSELAGE','HORIZONTAL TAIL','FIREWALL + SPAR'] : style==='fighter' ? ['LEFT SWEPT PANEL','RIGHT SWEPT PANEL','POINTED FUSELAGE','TAIL / TWIN FINS','MAIN SPAR'] : style==='experimental' ? ['LEFT WING MODULE','RIGHT WING MODULE','EQUIPMENT POD','TWIN VERTICAL FINS','CARBON SPAR'] : ['LEFT HIGH-WING PANEL','RIGHT HIGH-WING PANEL','BOX FUSELAGE','TAIL ASSEMBLY','DIHEDRAL JOINER'];
  const call=(x1,y1,x2,y2,label,anchor='start')=>`${lineEl(x1,y1,x2,y2,dim,1.4,'7 6')}${svgText(x1,y1-8,label,15,line,anchor,600)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%"><rect width="${W}" height="${H}" fill="${paper}"/><rect x="18" y="18" width="1564" height="1024" rx="12" fill="none" stroke="#9a9a94"/>${svgText(30,78,(p.name||'AIRCRAFT').toUpperCase(),52,line,'start',700)}${svgText(32,114,arch.replaceAll('-',' ').toUpperCase()+' · FOAM RC AIRCRAFT',19,dim,'start',500)}<path d="M30 132H400" stroke="${line}" stroke-width="2"/>${svgText(32,170,'Architecture-specific parts, assembly order,',17,dim)}${svgText(32,194,'power system, stability data, and true geometry.',17,dim)}<rect x="28" y="225" width="380" height="390" rx="9" fill="none" stroke="#999"/>${svgText(42,260,'SPECIFICATIONS (RECOMMENDED)',17,line,'start',700)}${rows}<rect x="430" y="26" width="1142" height="620" rx="10" fill="none" stroke="#999"/><rect x="430" y="26" width="190" height="40" rx="7" fill="${line}"/>${svgText(448,53,'EXPLODED VIEW',17,paper,'start',700)}<svg x="500" y="82" width="1000" height="500" viewBox="0 0 900 420">${exp}</svg>${call(570,145,755,235,labels[0])}${call(1425,145,1245,235,labels[1],'end')}${call(1020,105,1000,250,labels[2])}${call(610,565,760,510,labels[4])}${call(1410,565,1250,510,labels[3],'end')}<rect x="28" y="665" width="1544" height="350" rx="10" fill="none" stroke="#999"/><rect x="28" y="665" width="145" height="40" rx="7" fill="${line}"/>${svgText(46,692,'READY VIEWS',17,paper,'start',700)}<svg x="350" y="700" width="570" height="260" viewBox="0 0 900 420">${top}</svg><svg x="925" y="700" width="620" height="260" viewBox="0 0 900 420">${perspective}</svg>${svgText(45,750,'ASSEMBLY SEQUENCE',17,line,'start',700)}${svgText(45,785,'1  Cut every architecture-specific part at true scale.',14,dim)}${svgText(45,815,'2  Dry-fit wing roots, spars, firewall, and tail keys.',14,dim)}${svgText(45,845,'3  Join mirrored panels without twist or overlap.',14,dim)}${svgText(45,875,'4  Install electronics with battery movable through CG.',14,dim)}${svgText(45,905,'5  Verify throws, balance, glide trim, and structure.',14,dim)}${svgText(1540,1025,'RTFOAM · BUILD DOSSIER · V11',12,dim,'end',500)}</svg>`;
}

const THEMES = {
  'Cyanotype': {
    vars: { '--bg': '#0F2A43', '--panel': '#0C2136', '--panel2': '#133048', '--ink': '#EAF2F9', '--dim': '#8FB0C9', '--grid': 'rgba(190,215,235,0.08)', '--stroke': 'rgba(190,215,235,0.25)', '--accent': '#F97268', '--accent-ink': '#2A1210' },
    svg: { bg: '#0C2136', line: '#EAF2F9', dim: '#8FB0C9', accent: '#F97268', grid: 'rgba(190,215,235,0.10)' }
  },
  'Drafting Paper': {
    vars: { '--bg': '#F2EFE6', '--panel': '#FAF8F1', '--panel2': '#ECE7DA', '--ink': '#1E3A5F', '--dim': '#6B7E95', '--grid': 'rgba(30,58,95,0.09)', '--stroke': 'rgba(30,58,95,0.30)', '--accent': '#C25E2E', '--accent-ink': '#FAF8F1' },
    svg: { bg: '#FAF8F1', line: '#1E3A5F', dim: '#6B7E95', accent: '#C25E2E', grid: 'rgba(30,58,95,0.10)' }
  },
  'Night Ops': {
    vars: { '--bg': '#111417', '--panel': '#171B1F', '--panel2': '#1E242A', '--ink': '#DCE5EB', '--dim': '#7F909D', '--grid': 'rgba(160,190,210,0.06)', '--stroke': 'rgba(160,190,210,0.22)', '--accent': '#5BC8E8', '--accent-ink': '#0F1D24' },
    svg: { bg: '#14181C', line: '#DCE5EB', dim: '#7F909D', accent: '#5BC8E8', grid: 'rgba(160,190,210,0.08)' }
  }
};

const PRINT_COLORS = { bg: '#FFFFFF', line: '#1E3A5F', dim: '#5A6B80', accent: '#C25E2E', grid: 'rgba(30,58,95,0.12)' };

window.PlanLib = {
  computeStats, buildPlanSVG, buildReadyViewSVG, buildPerspectiveViewSVG, buildExplodedPreviewSVG, buildDesignDossierSVG, SEED_DESIGNS, buildPrompt, parseDesign, THEMES, PRINT_COLORS,
  VERSION: 11
};
})();
