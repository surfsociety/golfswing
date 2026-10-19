// Reine Rechenlogik: keine DOM-Zugriffe, damit sie auch in Node testbar ist.

export const BODY_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
];

export const PHASES = ['address', 'top', 'impact', 'finish'];
export const PHASE_LABELS = { address: 'Ansprechen', top: 'Top', impact: 'Treffmoment', finish: 'Finish' };

export const VIEWS = { faceon: 'Face-on (frontal)', dtl: 'Down-the-line (von hinten)' };

export const GOALS = {
  konstanz: 'Konstanz',
  laenge: 'Länge',
  slice: 'Slice-Indizien',
  gewicht: 'Gewichtsverlagerung',
};

export const METRICS = [
  { id: 'shoulderTurnTop', label: 'Schulterdrehung (max.)', unit: '°', views: ['faceon', 'dtl'], goals: ['laenge'],
    info: 'Größte Drehung der Schulterlinie gegenüber dem Ansprechen. Geschätzt aus der 3D-Schätzung des Modells, eher ±10° genau.' },
  { id: 'hipTurnTop', label: 'Hüftdrehung (max.)', unit: '°', views: ['faceon', 'dtl'], goals: ['laenge'],
    info: 'Größte Drehung der Hüftlinie im Rückschwung. Schätzung, eher ±10° genau.' },
  { id: 'xFactor', label: 'X-Faktor', unit: '°', views: ['faceon', 'dtl'], goals: ['laenge'],
    info: 'Größter Unterschied zwischen Schulter- und Hüftdrehung im Rückschwung.' },
  { id: 'shoulderOpenImpact', label: 'Schultern offen im Treffmoment', unit: '°', views: ['faceon', 'dtl'], goals: ['slice'],
    info: 'Wie weit die Schultern im Treffmoment schon Richtung Ziel gedreht sind. Stark offene Schultern sind ein typisches Slice-Indiz.' },
  { id: 'hipOpenImpact', label: 'Hüfte offen im Treffmoment', unit: '°', views: ['faceon', 'dtl'], goals: ['slice', 'gewicht'],
    info: 'Wie weit die Hüfte im Treffmoment Richtung Ziel geöffnet ist.' },
  { id: 'leadElbowTop', label: 'Führungsarm am Top', unit: '°', views: ['faceon', 'dtl'], goals: ['konstanz', 'laenge'],
    info: 'Ellbogenwinkel des Führungsarms am Top. 180° ist komplett gestreckt.' },
  { id: 'armPlaneTop', label: 'Armebene am Top', unit: '°', views: ['dtl'], goals: ['slice'],
    info: 'Neigung des Führungsarms minus Neigung der Schulterlinie. Positiv heißt steiler als die Schulterebene, negativ flacher.' },
  { id: 'weightTop', label: 'Gewicht vorne am Top', unit: '%', views: ['faceon'], goals: ['gewicht'],
    info: 'Position der Beckenmitte zwischen den Füßen. 0 % über dem hinteren Fuß, 100 % über dem vorderen Fuß.' },
  { id: 'weightImpact', label: 'Gewicht vorne im Treffmoment', unit: '%', views: ['faceon'], goals: ['gewicht', 'slice'],
    info: 'Position der Beckenmitte zwischen den Füßen im Treffmoment.' },
  { id: 'weightFinish', label: 'Gewicht vorne im Finish', unit: '%', views: ['faceon'], goals: ['gewicht'],
    info: 'Position der Beckenmitte zwischen den Füßen im Finish.' },
  { id: 'headMove', label: 'Kopfbewegung bis Treffmoment', unit: '%', views: ['faceon'], goals: ['konstanz'],
    info: 'Größte seitliche Kopfbewegung in Prozent der Schulterbreite. Positiv Richtung Ziel, negativ vom Ziel weg.' },
];

const deg = r => (r * 180) / Math.PI;
const wrap = a => { while (a > 180) a -= 360; while (a <= -180) a += 360; return a; };

export function sides(handed) {
  const left = { sh: 11, el: 13, wr: 15, hip: 23, ank: 27 };
  const right = { sh: 12, el: 14, wr: 16, hip: 24, ank: 28 };
  return handed === 'left' ? { lead: right, trail: left } : { lead: left, trail: right };
}

function copyPoints(pts) {
  return pts ? pts.map(p => ({ x: p.x, y: p.y, z: p.z ?? 0, v: p.visibility ?? 1 })) : null;
}

function lerpPoints(a, b, f) {
  return a.map((p, i) => ({
    x: p.x + (b[i].x - p.x) * f, y: p.y + (b[i].y - p.y) * f, z: p.z + (b[i].z - p.z) * f, v: Math.min(p.v, b[i].v),
  }));
}

// Füllt Bilder ohne erkannte Person per Interpolation und glättet leicht über die Zeit.
export function prepareFrames(raw, radius = 1) {
  const frames = raw.map(f => ({ t: f.t, lm: copyPoints(f.lm), world: copyPoints(f.world), detected: !!(f.lm && f.world) }));
  const valid = frames.map((f, i) => (f.detected ? i : -1)).filter(i => i >= 0);
  if (valid.length < 5) throw new Error('In zu wenigen Bildern wurde eine Person erkannt. Ist der ganze Körper im Bild?');

  for (let i = 0; i < frames.length; i++) {
    if (frames[i].detected) continue;
    const prev = valid.filter(j => j < i).pop();
    const next = valid.find(j => j > i);
    for (const key of ['lm', 'world']) {
      if (prev !== undefined && next !== undefined) {
        frames[i][key] = lerpPoints(frames[prev][key], frames[next][key], (i - prev) / (next - prev));
      } else {
        frames[i][key] = copyPoints(frames[prev ?? next][key]);
      }
    }
  }

  if (radius <= 0) return frames;
  return frames.map((f, i) => {
    const lo = Math.max(0, i - radius), hi = Math.min(frames.length - 1, i + radius);
    const out = { t: f.t, detected: f.detected };
    for (const key of ['lm', 'world']) {
      out[key] = f[key].map((p, k) => {
        let x = 0, y = 0, z = 0;
        for (let j = lo; j <= hi; j++) { const q = frames[j][key][k]; x += q.x; y += q.y; z += q.z; }
        const n = hi - lo + 1;
        return { x: x / n, y: y / n, z: z / n, v: p.v };
      });
    }
    return out;
  });
}

function yaw(a, b) { return deg(Math.atan2(b.z - a.z, b.x - a.x)); }

function angle3(a, b, c) {
  const u = [a.x - b.x, a.y - b.y, a.z - b.z], w = [c.x - b.x, c.y - b.y, c.z - b.z];
  const dot = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  const n = Math.hypot(...u) * Math.hypot(...w);
  return n ? deg(Math.acos(Math.max(-1, Math.min(1, dot / n)))) : 0;
}

// Spitzer Winkel einer Linie zur Horizontalen, in Bildkoordinaten (Pixel).
function incline(a, b) { return deg(Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x))); }

export function computeSeries(frames, W, H, handed) {
  const { lead, trail } = sides(handed);
  const px = (f, i) => ({ x: f.lm[i].x * W, y: f.lm[i].y * H });
  const s = { handsY: [], shYaw: [], hipYaw: [], elbow: [], armPlane: [], weight: [], noseX: [], shWidth: [], footDir: [] };
  for (const f of frames) {
    const w = f.world;
    s.handsY.push((px(f, lead.wr).y + px(f, trail.wr).y) / 2);
    s.shYaw.push(yaw(w[11], w[12]));
    s.hipYaw.push(yaw(w[23], w[24]));
    s.elbow.push(angle3(w[lead.sh], w[lead.el], w[lead.wr]));
    s.armPlane.push(incline(px(f, lead.sh), px(f, lead.wr)) - incline(px(f, lead.sh), px(f, trail.sh)));
    const la = px(f, lead.ank), ta = px(f, trail.ank);
    const hipMidX = (px(f, 23).x + px(f, 24).x) / 2;
    const span = la.x - ta.x;
    s.weight.push(Math.abs(span) > 1 ? (hipMidX - ta.x) / span : 0.5);
    s.noseX.push(px(f, 0).x);
    s.shWidth.push(Math.hypot(px(f, 11).x - px(f, 12).x, px(f, 11).y - px(f, 12).y));
    s.footDir.push(Math.sign(span) || 1);
  }
  return s;
}

const argmin = (arr, lo, hi) => { let k = lo; for (let i = lo; i <= hi; i++) if (arr[i] < arr[k]) k = i; return k; };
const argmax = (arr, lo, hi) => { let k = lo; for (let i = lo; i <= hi; i++) if (arr[i] > arr[k]) k = i; return k; };

// Schwungphasen aus der Handhöhe (Bild-y wächst nach unten).
export function detectPhases(series) {
  const y = series.handsY, n = y.length;
  if (n < 8) throw new Error('Das Video ist zu kurz für eine Analyse.');
  const v = y.map((val, i) => (i === 0 ? 0 : val - y[i - 1]));
  const fastest = argmax(v, 1, n - 1);
  const top = argmin(y, 0, fastest);
  const range = Math.max(...y) - Math.min(...y);
  const preLow = Math.max(...y.slice(0, top + 1));
  let address = 0;
  for (let i = top; i >= 0; i--) { if (y[i] >= preLow - 0.03 * range) { address = i; break; } }
  const win = Math.max(3, Math.round((fastest - top) * 2));
  const impact = argmax(y, fastest, Math.min(n - 1, fastest + win));
  const finish = impact < n - 1 ? argmin(y, impact + 1, n - 1) : n - 1;
  if (top - address < 2 || impact <= top || range < 0.1 * Math.max(...series.shWidth)) {
    throw new Error('Kein vollständiger Schwung erkannt. Schneide das Video auf Ansprechen bis Finish zu und prüfe, ob der ganze Körper zu sehen ist.');
  }
  return { address, top, impact, finish };
}

// Kumulierte Drehung gegenüber dem Ansprechen, Rückschwungrichtung positiv.
function turnFrom(yaws, address, top) {
  const out = new Array(yaws.length).fill(0);
  const step = d => (Math.abs(d) > 45 ? 0 : d); // Sprünge = vertauschte Seiten, ignorieren
  for (let i = address + 1; i < yaws.length; i++) out[i] = out[i - 1] + step(wrap(yaws[i] - yaws[i - 1]));
  for (let i = address - 1; i >= 0; i--) out[i] = out[i + 1] - step(wrap(yaws[i + 1] - yaws[i]));
  const sign = Math.sign(out[top]) || 1;
  return out.map(a => a * sign);
}

const round = (x, d = 0) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

export function computeMetrics(series, phases, view) {
  const { address: a, top, impact, finish } = phases;
  const sh = turnFrom(series.shYaw, a, top);
  const hp = turnFrom(series.hipYaw, a, top);
  const back = Math.max(a, 0), end = impact;
  const m = {};
  m.shoulderTurnTop = round(sh[argmax(sh, back, end)]);
  m.hipTurnTop = round(hp[argmax(hp, back, end)]);
  const xf = sh.map((s, i) => s - hp[i]);
  m.xFactor = round(xf[argmax(xf, back, end)]);
  m.shoulderOpenImpact = round(-sh[impact]);
  m.hipOpenImpact = round(-hp[impact]);
  m.leadElbowTop = round(series.elbow[top]);
  if (view === 'dtl') m.armPlaneTop = round(series.armPlane[top]);
  if (view === 'faceon') {
    m.weightTop = round(series.weight[top] * 100);
    m.weightImpact = round(series.weight[impact] * 100);
    m.weightFinish = round(series.weight[finish] * 100);
    const dir = series.footDir[a], sw = series.shWidth[a] || 1;
    let best = 0;
    for (let i = a; i <= impact; i++) {
      const d = ((series.noseX[i] - series.noseX[a]) * dir) / sw * 100;
      if (Math.abs(d) > Math.abs(best)) best = d;
    }
    m.headMove = round(best);
  }
  return { metrics: m, turns: { shoulder: sh, hip: hp } };
}

export function metricsFor(view) { return METRICS.filter(x => x.views.includes(view)); }

// Zeit im Video für einen normierten Phasenfortschritt u in [0, 3].
export function timeAtProgress(frames, phases, u) {
  const keys = PHASES.map(p => frames[phases[p]].t);
  const seg = Math.min(2, Math.max(0, Math.floor(u)));
  const f = Math.min(1, Math.max(0, u - seg));
  return keys[seg] + (keys[seg + 1] - keys[seg]) * f;
}

export const CLUBS = { driver: 'Driver', eisen: 'Eisen', wedge: 'Wedge' };

export const CURVES = {
  shoulder: { label: 'Schulterdrehung', unit: '°', views: ['faceon', 'dtl'] },
  hip: { label: 'Hüftdrehung', unit: '°', views: ['faceon', 'dtl'] },
  xFactor: { label: 'X-Faktor', unit: '°', views: ['faceon', 'dtl'] },
  elbow: { label: 'Führungsarm', unit: '°', views: ['faceon', 'dtl'] },
  weight: { label: 'Gewicht vorne', unit: '%', views: ['faceon'] },
};

export const CURVE_STEPS = 60; // 20 Stützstellen je Phasenabschnitt

// Verläufe über den normierten Schwungfortschritt 0..3 (Ansprechen, Top, Treffmoment, Finish),
// damit Schwünge unterschiedlicher Länge und Geschwindigkeit vergleichbar werden.
export function phaseCurves(frames, phases, series, turns, view) {
  const ts = frames.map(f => f.t);
  const at = (arr, t) => {
    let i = 1;
    while (i < ts.length - 1 && ts[i] < t) i++;
    const f = ts[i] === ts[i - 1] ? 0 : Math.min(1, Math.max(0, (t - ts[i - 1]) / (ts[i] - ts[i - 1])));
    return arr[i - 1] + (arr[i] - arr[i - 1]) * f;
  };
  const xf = turns.shoulder.map((s, i) => s - turns.hip[i]);
  const src = { shoulder: turns.shoulder, hip: turns.hip, xFactor: xf, elbow: series.elbow };
  if (view === 'faceon') src.weight = series.weight.map(w => w * 100);
  const out = {};
  for (const [key, arr] of Object.entries(src)) {
    out[key] = [];
    for (let k = 0; k <= CURVE_STEPS; k++) {
      out[key].push(Math.round(at(arr, timeAtProgress(frames, phases, (k / CURVE_STEPS) * 3))));
    }
  }
  return out;
}
