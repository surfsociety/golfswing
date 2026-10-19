import { FilesetResolver, PoseLandmarker } from './vendor/mediapipe/vision_bundle.mjs';
import {
  BODY_CONNECTIONS, PHASES, PHASE_LABELS, GOALS, METRICS, CLUBS, CURVES, CURVE_STEPS,
  sides, prepareFrames, computeSeries, detectPhases, computeMetrics, metricsFor, timeAtProgress, phaseCurves,
} from './analysis.js';
import { MIN_PROS, SOLID_PROS, corridor, position, curveBand, sequencing, squareTiming } from './patterns.js';
import * as store from './storage.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

// ---------- Einstellungen ----------
const SETTINGS_KEY = 'golf-settings';
const settings = { handed: 'right', goal: 'konstanz' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { /* ohne Speicher weiter */ }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* egal */ } }

// ---------- Pose-Modell ----------
let landmarkerPromise = null;
let tsCounter = 0;
function getLandmarker() {
  if (!landmarkerPromise) {
    $('#engine-status').textContent = 'Modell lädt …';
    landmarkerPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm', location.href).href);
      const options = delegate => ({
        baseOptions: { modelAssetPath: new URL('models/pose_landmarker_full.task', location.href).href, delegate },
        runningMode: 'VIDEO', numPoses: 1,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      let lm, mode = 'GPU';
      try { lm = await PoseLandmarker.createFromOptions(fileset, options('GPU')); }
      catch { mode = 'CPU'; lm = await PoseLandmarker.createFromOptions(fileset, options('CPU')); }
      $('#engine-status').textContent = `Bereit (${mode})`;
      return lm;
    })().catch(err => {
      landmarkerPromise = null;
      $('#engine-status').textContent = 'Modell nicht geladen';
      throw err;
    });
  }
  return landmarkerPromise;
}

// ---------- Clips ----------
const clips = {};
for (const stage of $$('.stage')) {
  const role = stage.dataset.role;
  clips[role] = {
    role, stage, video: stage.querySelector('video'), canvas: stage.querySelector('canvas'), frame: stage.querySelector('.frame'),
    view: 'faceon', club: 'driver', name: '', url: null, W: 0, H: 0, range: [0, 0], step: 1 / 30,
    rawFrames: null, frames: null, series: null, phases: null, metrics: null, turns: null,
  };
  stage.dataset.title = role === 'me' ? 'Ich' : 'Pro';
}
let active = 'me';
const cur = () => clips[active];

function seek(video, t) {
  return new Promise(resolve => {
    if (Math.abs(video.currentTime - t) < 0.0005) return resolve();
    const done = () => { video.removeEventListener('seeked', done); clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, 2000);
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

function nearestFrame(clip, t) {
  const f = clip.frames;
  if (!f) return -1;
  let lo = 0, hi = f.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (f[mid].t < t) lo = mid; else hi = mid; }
  const idx = Math.abs(f[lo].t - t) <= Math.abs(f[hi].t - t) ? lo : hi;
  return Math.abs(f[idx].t - t) <= clip.step * 1.5 ? idx : -1;
}

// ---------- Zeichnen ----------
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function draw(clip) {
  const { canvas, video } = clip;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (!w || !h) return;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!$('#show-skeleton').checked) return;
  drawSkeleton(ctx, clip, nearestFrame(clip, video.currentTime), w, h, dpr);
}

function drawSkeleton(ctx, clip, idx, w, h, scale) {
  if (idx < 0) return;
  const lm = clip.frames[idx].lm;
  const P = i => [lm[i].x * w, lm[i].y * h];
  const { lead } = sides(settings.handed);
  const line = (a, b, color, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width * scale; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(...P(a)); ctx.lineTo(...P(b)); ctx.stroke();
  };
  for (const [a, b] of BODY_CONNECTIONS) line(a, b, 'rgba(255,255,255,0.75)', 3);
  line(11, 12, cssVar('--shoulder'), 5);
  line(23, 24, cssVar('--hip'), 5);
  line(lead.sh, lead.el, cssVar('--arm'), 5);
  line(lead.el, lead.wr, cssVar('--arm'), 5);
  ctx.fillStyle = '#fff';
  for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    ctx.beginPath(); ctx.arc(...P(i), 3.5 * scale, 0, Math.PI * 2); ctx.fill();
  }

  const label = (text, [x, y], color) => {
    ctx.font = `600 ${13 * scale}px -apple-system, system-ui, sans-serif`;
    const tw = ctx.measureText(text).width, pad = 4 * scale;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x + 8 * scale, y - 10 * scale, tw + pad * 2, 20 * scale);
    ctx.fillStyle = color; ctx.fillText(text, x + 8 * scale + pad, y + 5 * scale);
  };
  if (clip.series) {
    label(`${Math.round(clip.series.elbow[idx])}°`, P(lead.el), cssVar('--arm'));
  }
  if (clip.turns) {
    const mid = (a, b) => [(P(a)[0] + P(b)[0]) / 2, (P(a)[1] + P(b)[1]) / 2];
    const sm = mid(11, 12); label(`S ${Math.round(clip.turns.shoulder[idx])}°`, [sm[0], sm[1] - 26 * scale], cssVar('--shoulder'));
    label(`H ${Math.round(clip.turns.hip[idx])}°`, mid(23, 24), cssVar('--hip'));
  }
  if (clip.phases) {
    const phase = PHASES.find(p => clip.phases[p] === idx);
    if (phase) {
      ctx.font = `700 ${16 * scale}px -apple-system, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      const tw = ctx.measureText(PHASE_LABELS[phase]).width;
      ctx.fillRect(8 * scale, 8 * scale, tw + 16 * scale, 28 * scale);
      ctx.fillStyle = '#fff'; ctx.fillText(PHASE_LABELS[phase], 16 * scale, 28 * scale);
    }
  }
}

let rafId = 0;
function renderLoop() {
  cancelAnimationFrame(rafId);
  const tick = () => {
    for (const c of Object.values(clips)) if (c.url) draw(c);
    syncScrubber();
    if (Object.values(clips).some(c => !c.video.paused)) rafId = requestAnimationFrame(tick);
  };
  tick();
}

// ---------- Video laden ----------
$('#file-input').addEventListener('change', e => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  loadFile(cur(), file);
});

function loadFile(clip, file) {
  if (clip.url) URL.revokeObjectURL(clip.url);
  Object.assign(clip, { url: URL.createObjectURL(file), name: file.name, rawFrames: null, frames: null, series: null, phases: null, metrics: null, turns: null, curves: null, historyId: null });
  clip.view = $('#view-select').value;
  clip.club = $('#club-select').value;
  clip.video.src = clip.url;
  clip.video.addEventListener('loadedmetadata', async () => {
    // Manche Dateien melden keine Dauer, bis einmal ans Ende gesprungen wurde
    if (!Number.isFinite(clip.video.duration)) {
      await new Promise(r => { clip.video.addEventListener('durationchange', r, { once: true }); clip.video.currentTime = 1e7; setTimeout(r, 3000); });
    }
    clip.W = clip.video.videoWidth; clip.H = clip.video.videoHeight;
    clip.frame.style.setProperty('--ar', `${clip.W} / ${clip.H}`);
    clip.frame.style.aspectRatio = `${clip.W} / ${clip.H}`;
    clip.frame.style.width = `min(100%, calc(var(--frame-vh, 70vh) * ${clip.W / clip.H}))`;
    clip.range = [0, clip.video.duration];
    clip.stage.classList.add('loaded');
    // iOS dekodiert das erste Bild erst nach einem kurzen play()
    clip.video.play().then(() => clip.video.pause()).catch(() => {}).finally(() => seek(clip.video, 0).then(() => draw(clip)));
    updateUI();
  }, { once: true });
  getLandmarker().catch(() => {});
  updateUI();
}

// ---------- Player ----------
for (const c of Object.values(clips)) {
  for (const ev of ['seeked', 'timeupdate', 'pause']) c.video.addEventListener(ev, () => { draw(c); syncScrubber(); });
  c.video.addEventListener('play', renderLoop);
}
window.addEventListener('resize', () => Object.values(clips).forEach(c => c.url && draw(c)));

function syncScrubber() {
  const c = cur();
  if (!c.url || !c.video.duration) return;
  $('#scrubber').value = Math.round((c.video.currentTime / c.video.duration) * 1000);
  $('#btn-play').textContent = c.video.paused ? '▶︎' : '❚❚';
}

$('#scrubber').addEventListener('input', e => {
  const c = cur();
  if (c.video.duration) c.video.currentTime = (e.target.value / 1000) * c.video.duration;
});
$('#btn-play').addEventListener('click', () => {
  const v = cur().video;
  if (v.paused) { if (v.ended || v.currentTime >= v.duration - 0.01) v.currentTime = 0; v.play(); } else v.pause();
});
$('#speed').addEventListener('change', e => { for (const c of Object.values(clips)) c.video.playbackRate = Number(e.target.value); });
$('#show-skeleton').addEventListener('change', () => Object.values(clips).forEach(c => c.url && draw(c)));

function stepFrame(dir) {
  const c = cur(); c.video.pause();
  if (c.frames) {
    const idx = nearestFrame(c, c.video.currentTime);
    const base = idx >= 0 ? idx : c.frames.findIndex(f => f.t >= c.video.currentTime);
    const next = Math.min(c.frames.length - 1, Math.max(0, base + dir));
    c.video.currentTime = c.frames[next].t;
  } else {
    c.video.currentTime = Math.min(c.video.duration, Math.max(0, c.video.currentTime + dir / 30));
  }
}
$('#btn-prev').addEventListener('click', () => stepFrame(-1));
$('#btn-next').addEventListener('click', () => stepFrame(1));

$('#btn-trim-start').addEventListener('click', () => { const c = cur(); c.range[0] = Math.min(c.video.currentTime, c.range[1] - 0.2); updateUI(); });
$('#btn-trim-end').addEventListener('click', () => { const c = cur(); c.range[1] = Math.max(c.video.currentTime, c.range[0] + 0.2); updateUI(); });

$('#view-select').addEventListener('change', e => {
  const c = cur(); c.view = e.target.value;
  if (c.series) { try { finalize(c); } catch { /* Meldung beim nächsten Analysieren */ } updateSavedEntry(c); }
  updateUI();
});

const clubSel = $('#club-select');
for (const [k, v] of Object.entries(CLUBS)) clubSel.append(new Option(v, k));
clubSel.addEventListener('change', e => {
  const c = cur(); c.club = e.target.value;
  updateSavedEntry(c);
  updateUI();
});

// ---------- Analyse ----------
let analysing = false;
$('#btn-analyse').addEventListener('click', async () => {
  const c = cur();
  if (!c.url || analysing) return;
  analysing = true;
  const msg = $('#analyse-msg'); msg.className = 'small'; msg.textContent = 'Modell wird geladen …';
  $('#progress').classList.remove('hidden');
  updateUI();
  try {
    const lm = await getLandmarker();
    const v = c.video; v.pause();
    const [s, e] = c.range;
    c.step = Math.max(1 / 60, (e - s) / 360);
    const raw = [];
    const total = Math.floor((e - s) / c.step) + 1;
    for (let i = 0; i < total; i++) {
      const t = s + i * c.step;
      await seek(v, t);
      tsCounter += 33;
      const r = lm.detectForVideo(v, tsCounter);
      raw.push({ t, lm: r.landmarks?.[0] || null, world: r.worldLandmarks?.[0] || null });
      if (i % 3 === 0) {
        $('#progress div').style.width = `${Math.round(((i + 1) / total) * 100)}%`;
        msg.textContent = `Analysiere Bild ${i + 1} von ${total} …`;
      }
    }
    c.rawFrames = raw;
    finalize(c);
    await seek(v, c.frames[c.phases.top].t);
    draw(c);
    await saveToHistory(c);
    msg.textContent = 'Fertig. Im Verlauf gespeichert.';
  } catch (err) {
    console.error(err);
    msg.className = 'small warn';
    msg.textContent = err?.message || 'Analyse fehlgeschlagen.';
  } finally {
    analysing = false;
    $('#progress').classList.add('hidden');
    $('#progress div').style.width = '0';
    updateUI();
  }
});

// Aus den Rohdaten alle Werte neu berechnen (auch nach Wechsel von Spielhand oder Perspektive).
function finalize(c) {
  c.frames = prepareFrames(c.rawFrames);
  c.series = computeSeries(c.frames, c.W, c.H, settings.handed);
  try {
    c.phases = detectPhases(c.series);
    const res = computeMetrics(c.series, c.phases, c.view);
    c.metrics = res.metrics; c.turns = res.turns;
    c.curves = phaseCurves(c.frames, c.phases, c.series, c.turns, c.view);
  } catch (err) {
    c.phases = null; c.metrics = null; c.turns = null; c.curves = null;
    throw err;
  }
}

async function thumbnail(c) {
  const cv = document.createElement('canvas');
  const w = 240, h = Math.round(240 * c.H / c.W);
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(c.video, 0, 0, w, h);
  drawSkeleton(ctx, c, c.phases.top, w, h, 0.6);
  try { return cv.toDataURL('image/jpeg', 0.7); } catch { return null; }
}

async function saveToHistory(c) {
  const id = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const entry = {
    id, date: new Date().toISOString(), role: c.role, view: c.view, club: c.club, handed: settings.handed,
    name: c.name, metrics: c.metrics, curves: c.curves, thumb: await thumbnail(c),
  };
  c.historyId = id;
  await store.put(entry);
  await store.requestPersistence();
  await refreshLatestPro();
}

// Nachträgliche Änderung von Schläger oder Perspektive auch im gespeicherten Eintrag übernehmen.
async function updateSavedEntry(c) {
  if (!c.historyId) return;
  const entry = (await store.all()).find(e => e.id === c.historyId);
  if (!entry) return;
  Object.assign(entry, { view: c.view, club: c.club, metrics: c.metrics, curves: c.curves });
  await store.put(entry);
  await refreshLatestPro();
}

// ---------- Ergebnisse ----------
const fmt = (v, unit) => (v === null || v === undefined ? '–' : `${v.toLocaleString('de-DE')}${unit === '%' ? ' %' : unit}`);

let latestPro = {};
async function refreshLatestPro() {
  latestPro = {};
  for (const e of await store.all()) {
    if (e.role !== 'pro') continue;
    latestPro[`${e.view}|${e.club}`] ??= e;
    latestPro[e.view] ??= e;
  }
}

function proMetricsFor(view, club) {
  const p = clips.pro;
  if (p.metrics && p.view === view && p.club === club) return p.metrics;
  return (latestPro[`${view}|${club}`] || latestPro[view])?.metrics || null;
}

const clubLabel = club => CLUBS[club] || 'Schläger unbekannt';

function sortedMetrics(list) {
  const focus = m => m.goals.includes(settings.goal);
  return [...list].sort((a, b) => Number(focus(b)) - Number(focus(a)));
}

function renderResults() {
  const c = cur();
  const show = !!c.metrics;
  $('#results').classList.toggle('hidden', !show);
  if (!show) return;
  $('#goal-badge').textContent = `Fokus: ${GOALS[settings.goal]}`;
  const pb = $('#phase-buttons'); pb.innerHTML = '';
  for (const p of PHASES) {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = PHASE_LABELS[p];
    b.addEventListener('click', () => { c.video.pause(); c.video.currentTime = c.frames[c.phases[p]].t; });
    pb.append(b);
  }
  const pro = c.role === 'me' ? proMetricsFor(c.view, c.club) : null;
  const ul = $('#metric-list'); ul.innerHTML = '';
  for (const m of sortedMetrics(metricsFor(c.view))) {
    const li = document.createElement('li');
    if (m.goals.includes(settings.goal)) li.className = 'focus';
    const proText = pro && pro[m.id] != null ? `<span class="pro">Pro ${fmt(pro[m.id], m.unit)}</span>` : '';
    li.innerHTML = `<div class="metric-head"><span>${m.label}</span><span class="metric-value">${fmt(c.metrics[m.id], m.unit)}${proText}</span></div><div class="metric-info">${m.info}</div>`;
    ul.append(li);
  }
}

function updateUI() {
  const c = cur();
  for (const b of $$('.seg')) {
    const cl = clips[b.dataset.role];
    b.classList.toggle('active', b.dataset.role === active);
    b.innerHTML = `${b.dataset.role === 'me' ? 'Mein Schwung' : 'Pro-Schwung'}${cl.metrics ? '<span class="dot"></span>' : ''}`;
  }
  if (!inCompare) for (const c2 of Object.values(clips)) c2.stage.classList.toggle('hidden', c2.role !== active);
  $('#view-select').value = c.view;
  $('#club-select').value = c.club;
  $('#clip-name').textContent = c.name ? `${c.name}` : '';
  $('#player').classList.toggle('hidden', !c.url);
  $('#trim-label').textContent = c.url ? `Analysebereich ${c.range[0].toFixed(1)}–${c.range[1].toFixed(1)} s` : '';
  $('#btn-analyse').disabled = analysing || !c.url;
  $('#btn-analyse').textContent = c.metrics ? 'Erneut analysieren' : 'Schwung analysieren';
  for (const id of ['#btn-trim-start', '#btn-trim-end', '#file-input', '#view-select', '#club-select']) $(id).disabled = analysing;
  if (!analysing && !c.metrics && c.rawFrames === null) $('#analyse-msg').textContent = c.url ? 'Tipp: Mit „Start hier“ und „Ende hier“ auf Ansprechen bis Finish zuschneiden, das macht die Analyse schneller und genauer.' : '';
  renderResults();
  syncScrubber();
}

for (const b of $$('.seg')) b.addEventListener('click', () => {
  for (const c of Object.values(clips)) c.video.pause();
  active = b.dataset.role; $('#analyse-msg').textContent = ''; updateUI();
  draw(cur());
});

// ---------- Vergleich ----------
let inCompare = false;
let compareU = 0, comparePlaying = false, seekBusy = false, pendingU = null;

function enterCompare() {
  inCompare = true;
  const ready = clips.me.metrics && clips.pro.metrics;
  $('#compare-empty').classList.toggle('hidden', !!ready);
  $('#compare-body').classList.toggle('hidden', !ready);
  if (!ready) return;
  const host = $('#compare-host');
  for (const c of [clips.me, clips.pro]) {
    c.video.pause();
    c.stage.classList.remove('hidden');
    c.frame.style.setProperty('--frame-vh', '55vh');
    host.append(c.stage);
  }
  const warn = [];
  if (clips.me.view !== clips.pro.view) warn.push('Die Perspektiven unterscheiden sich, der Vergleich ist nur eingeschränkt aussagekräftig.');
  $('#compare-warning').textContent = warn.join(' ');
  $('#compare-warning').classList.toggle('hidden', !warn.length);
  renderCompareTable();
  showCompare(compareU);
}

function leaveCompare() {
  if (!inCompare) return;
  inCompare = false; comparePlaying = false;
  const host = $('#stage-host');
  for (const c of [clips.me, clips.pro]) { c.frame.style.removeProperty('--frame-vh'); host.append(c.stage); }
  updateUI();
}

async function showCompare(u) {
  if (seekBusy) { pendingU = u; return; }
  seekBusy = true;
  await Promise.all([clips.me, clips.pro].map(c => seek(c.video, timeAtProgress(c.frames, c.phases, u))));
  draw(clips.me); draw(clips.pro);
  seekBusy = false;
  if (pendingU !== null) { const next = pendingU; pendingU = null; showCompare(next); }
}

$('#compare-scrubber').addEventListener('input', e => { compareU = e.target.value / 1000; showCompare(compareU); });
$('#compare-play').addEventListener('click', async () => {
  if (comparePlaying) { comparePlaying = false; return; }
  comparePlaying = true; $('#compare-play').textContent = '❚❚ Stopp';
  if (compareU >= 3) compareU = 0;
  while (comparePlaying && compareU < 3) {
    compareU = Math.min(3, compareU + 0.025 * Number($('#speed').value) * 2);
    $('#compare-scrubber').value = Math.round(compareU * 1000);
    await showCompare(compareU);
    await new Promise(r => setTimeout(r, 16));
  }
  comparePlaying = false; $('#compare-play').textContent = '▶︎ Synchron abspielen';
});

function renderCompareTable() {
  const me = clips.me, pro = clips.pro;
  const list = METRICS.filter(m => m.views.includes(me.view) && m.views.includes(pro.view));
  const tb = $('#compare-rows'); tb.innerHTML = '';
  for (const m of sortedMetrics(list)) {
    const a = me.metrics[m.id], b = pro.metrics[m.id];
    const d = a != null && b != null ? Math.round((a - b) * 10) / 10 : null;
    const tr = document.createElement('tr');
    if (m.goals.includes(settings.goal)) tr.className = 'focus';
    tr.innerHTML = `<td>${m.label}</td><td>${fmt(a, m.unit)}</td><td>${fmt(b, m.unit)}</td><td>${d == null ? '–' : (d > 0 ? '+' : '') + fmt(d, m.unit)}</td>`;
    tb.append(tr);
  }
}

// ---------- Verlauf ----------
function fillMetricSelect() {
  const sel = $('#hist-metric'), prev = sel.value;
  sel.innerHTML = '';
  for (const m of sortedMetrics(metricsFor($('#hist-view').value))) sel.append(new Option(m.label, m.id));
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

async function renderHistory() {
  fillMetricSelect();
  const view = $('#hist-view').value, metricId = $('#hist-metric').value;
  const metric = METRICS.find(m => m.id === metricId);
  const entries = (await store.all()).filter(e => e.view === view);
  const series = entries.filter(e => e.role === 'me' && e.metrics?.[metricId] != null).reverse();
  renderChart(series.map(e => ({ date: new Date(e.date), v: e.metrics[metricId] })), metric);

  const ul = $('#hist-list'); ul.innerHTML = '';
  if (!entries.length) ul.innerHTML = '<li class="muted small">Noch keine gespeicherten Schwünge in dieser Perspektive.</li>';
  for (const e of entries) {
    const li = document.createElement('li');
    const date = new Date(e.date).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
    const key = sortedMetrics(metricsFor(e.view)).slice(0, 3).map(m => `${m.label}: ${fmt(e.metrics?.[m.id], m.unit)}`).join(' · ');
    li.innerHTML = `${e.thumb ? `<img alt="" src="${e.thumb}">` : '<img alt="">'}<div class="meta"><strong>${e.role === 'pro' ? 'Pro-Referenz' : 'Mein Schwung'} · ${clubLabel(e.club)}</strong>${date}<br>${key}</div>`;
    const del = document.createElement('button');
    del.className = 'btn small'; del.textContent = 'Löschen';
    del.addEventListener('click', async () => {
      if (del.dataset.armed) { await store.remove(e.id); await refreshLatestPro(); renderHistory(); }
      else { del.dataset.armed = '1'; del.textContent = 'Sicher?'; setTimeout(() => { delete del.dataset.armed; del.textContent = 'Löschen'; }, 3000); }
    });
    li.append(del);
    ul.append(li);
  }
}

function renderChart(points, metric) {
  const host = $('#hist-chart');
  if (points.length < 2) {
    host.innerHTML = `<p class="muted small">${points.length ? 'Ab zwei gespeicherten Schwüngen erscheint hier dein Verlauf.' : 'Noch keine Werte für diesen Messwert.'}</p>`;
    return;
  }
  const W = 320, H = 200, pl = 34, pr = 10, pt = 12, pb = 26;
  const vals = points.map(p => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  const x = i => pl + (i / (points.length - 1)) * (W - pl - pr);
  const y = v => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const dfmt = dt => dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf ${metric.label}">
    <line class="axis" x1="${pl}" y1="${H - pb}" x2="${W - pr}" y2="${H - pb}"/>
    <line class="axis" x1="${pl}" y1="${pt}" x2="${pl}" y2="${H - pb}"/>
    <text x="${pl - 4}" y="${y(hi - pad) + 4}" text-anchor="end">${Math.round(hi - pad)}</text>
    <text x="${pl - 4}" y="${y(lo + pad) + 4}" text-anchor="end">${Math.round(lo + pad)}</text>
    <text x="${pl}" y="${H - 8}">${dfmt(points[0].date)}</text>
    <text x="${W - pr}" y="${H - 8}" text-anchor="end">${dfmt(points[points.length - 1].date)}</text>
    <path class="line" d="${d}"/>
    ${points.map((p, i) => `<circle class="pt" cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.5"><title>${dfmt(p.date)}: ${fmt(p.v, metric.unit)}</title></circle>`).join('')}
  </svg>`;
}

$('#hist-view').addEventListener('change', renderHistory);
$('#hist-metric').addEventListener('change', renderHistory);

$('#btn-export').addEventListener('click', async () => {
  const data = { app: 'golf-swing', version: 1, exported: new Date().toISOString(), entries: await store.all() };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `golf-schwuenge-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  $('#hist-msg').textContent = `${data.entries.length} Schwünge exportiert.`;
});

$('#import-input').addEventListener('change', async e => {
  const file = e.target.files?.[0]; e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const entries = (data.entries || []).filter(x => x && x.id && x.date && x.metrics && x.view);
    for (const x of entries) await store.put(x);
    await refreshLatestPro();
    $('#hist-msg').textContent = `${entries.length} Schwünge importiert.`;
    renderHistory();
  } catch {
    $('#hist-msg').textContent = 'Die Datei konnte nicht gelesen werden.';
  }
});

// ---------- Pro-Muster ----------
const pctOfDownswing = x => (x == null ? '–' : `${Math.round(x * 100)} %`);

for (const [k, v] of Object.entries(CLUBS)) $('#pat-club').append(new Option(v, k));

function fillCurveSelect() {
  const sel = $('#pat-curve'), prev = sel.value, view = $('#pat-view').value;
  sel.innerHTML = '';
  for (const [k, c] of Object.entries(CURVES)) if (c.views.includes(view)) sel.append(new Option(c.label, k));
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

async function renderPatterns() {
  fillCurveSelect();
  const view = $('#pat-view').value, club = $('#pat-club').value;
  const all = await store.all();
  const match = e => e.view === view && (club === 'all' || e.club === club);
  const pros = all.filter(e => e.role === 'pro' && match(e));
  const mine = all.find(e => e.role === 'me' && match(e)) || null;

  const n = pros.length;
  const note = n < MIN_PROS
    ? `Erst ${n} Pro-Schwung${n === 1 ? '' : 'e'} gespeichert. Muster erscheinen ab ${MIN_PROS}, belastbar werden sie ab etwa ${SOLID_PROS}.`
    : n < SOLID_PROS
      ? `${n} Pro-Schwünge. Erste Tendenzen, belastbar wird es ab etwa ${SOLID_PROS}.`
      : `${n} Pro-Schwünge ausgewertet.`;
  $('#pat-summary').textContent = `${note}${mine ? ` Verglichen wird mit deinem letzten Schwung vom ${new Date(mine.date).toLocaleDateString('de-DE')}.` : ' Für den Vergleich fehlt noch ein eigener Schwung mit diesem Schläger.'}`;
  const enough = n >= MIN_PROS;
  $('#pat-body').classList.toggle('hidden', !enough);
  if (!enough) return;

  // a) Korridor je Messwert, sortiert: gemeinsame Prinzipien zuerst
  const order = { eng: 0, mittel: 1, breit: 2 };
  const rows = metricsFor(view).map(m => ({ m, c: corridor(pros, m) })).filter(r => r.c.p50 != null)
    .sort((a, b) => order[a.c.spread] - order[b.c.spread]);
  const tb = $('#pat-rows'); tb.innerHTML = '';
  for (const { m, c } of rows) {
    const my = mine?.metrics?.[m.id];
    const pos = position(my, c);
    const r1 = v => Math.round(v);
    const tr = document.createElement('tr');
    if (m.goals.includes(settings.goal)) tr.className = 'focus';
    tr.innerHTML = `<td>${m.label}<div class="spread ${c.spread}">${c.spread === 'eng' ? 'gemeinsames Prinzip' : c.spread === 'breit' ? 'Stilfrage' : 'mittlere Streuung'}</div></td>
      <td>${fmt(r1(c.p50), m.unit)}</td><td>${r1(c.p25) === r1(c.p75) ? fmt(r1(c.p25), m.unit) : `${r1(c.p25)} bis ${fmt(r1(c.p75), m.unit)}`}</td>
      <td>${fmt(my, m.unit)}${pos ? `<div class="pos ${pos === 'im Korridor' ? 'ok' : 'off'}">${pos}</div>` : ''}</td>`;
    tb.append(tr);
  }

  // Abfolge im Abschwung
  const seq = sequencing(pros);
  const myHip = squareTiming(mine?.curves?.hip), mySh = squareTiming(mine?.curves?.shoulder);
  const ins = [];
  if (seq.counted >= MIN_PROS) {
    ins.push(`Bei ${seq.hipFirst} von ${seq.counted} Pros ist die Hüfte im Abschwung vor den Schultern zurück auf Ansprechposition.${myHip != null && mySh != null ? ` Bei dir: ${myHip < mySh ? 'ebenfalls Hüfte zuerst' : 'Schultern zuerst, ein mögliches Indiz für einen Abschwung von oben'}.` : ''}`);
    ins.push(`Hüfte wieder auf Ansprechposition: Pros im Mittel bei ${pctOfDownswing(seq.hipMedian)} des Abschwungs${myHip != null ? `, du bei ${pctOfDownswing(myHip)}` : ''}.`);
    ins.push(`Schultern wieder auf Ansprechposition: Pros im Mittel bei ${pctOfDownswing(seq.shoulderMedian)} des Abschwungs${mySh != null ? `, du bei ${pctOfDownswing(mySh)}` : ''}.`);
  }
  const narrow = rows.filter(r => r.c.spread === 'eng');
  // Größte Abweichungen relativ zur Pro-Streuung zuerst, höchstens drei
  const dev = r => { const v = mine?.metrics?.[r.m.id]; if (v == null) return 0; const w = Math.max(2, r.c.p75 - r.c.p25); return v < r.c.p25 ? (r.c.p25 - v) / w : v > r.c.p75 ? (v - r.c.p75) / w : 0; };
  const offNarrow = narrow.filter(r => dev(r) > 0).sort((a, b) => dev(b) - dev(a)).slice(0, 3);
  if (offNarrow.length) ins.push(`Bei Werten, die unter Pros eng beieinander liegen, weichst du am deutlichsten hier ab: ${offNarrow.map(r => r.m.label).join(', ')}. Dort lohnt sich Training eher als bei reinen Stilfragen.`);
  const ul = $('#pat-insights'); ul.innerHTML = '';
  for (const t of ins) { const li = document.createElement('li'); li.textContent = t; ul.append(li); }
  $('#pat-insights-card').classList.toggle('hidden', !ins.length);

  // b) Bewegungsablauf als Band
  const key = $('#pat-curve').value;
  renderBand(curveBand(pros, key), mine?.curves?.[key], CURVES[key]);
}

function renderBand(band, mine, def) {
  const host = $('#pat-chart');
  if (band.p50 == null) { host.innerHTML = `<p class="muted small">Für diese Kurve gibt es erst ${band.n} Pro-Schwünge mit gespeichertem Verlauf (ab dieser Version werden Verläufe mitgespeichert).</p>`; return; }
  const W = 340, H = 220, pl = 34, pr = 8, pt = 10, pb = 28;
  const vals = [...band.p25, ...band.p75, ...(mine || [])];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 2) { lo -= 1; hi += 1; }
  const x = k => pl + (k / CURVE_STEPS) * (W - pl - pr);
  const y = v => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
  const path = arr => arr.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${path(band.p75)} ${band.p25.map((v, k) => [k, v]).reverse().map(([k, v]) => `L${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} Z`;
  const ticks = PHASES.map((p, i) => {
    const xx = x((i / 3) * CURVE_STEPS);
    return `<line class="grid" x1="${xx}" y1="${pt}" x2="${xx}" y2="${H - pb}"/><text x="${xx}" y="${H - 10}" text-anchor="${i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}">${PHASE_LABELS[p]}</text>`;
  }).join('');
  const zero = lo < 0 && hi > 0 ? `<line class="zero" x1="${pl}" y1="${y(0)}" x2="${W - pr}" y2="${y(0)}"/>` : '';
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${def.label}: Pro-Band und dein Verlauf">
    ${ticks}${zero}
    <text x="${pl - 4}" y="${pt + 8}" text-anchor="end">${Math.round(hi)}</text>
    <text x="${pl - 4}" y="${H - pb}" text-anchor="end">${Math.round(lo)}</text>
    <path class="band" d="${area}"/>
    <path class="median" d="${path(band.p50)}"/>
    ${mine ? `<path class="mine" d="${path(mine)}"/>` : ''}
  </svg>
  <div class="legend small"><span class="lg band"></span>Pros, mittlere 50 %<span class="lg median"></span>Pro-Median${mine ? '<span class="lg mine"></span>Du' : ''}</div>`;
}

$('#pat-view').addEventListener('change', renderPatterns);
$('#pat-club').addEventListener('change', renderPatterns);
$('#pat-curve').addEventListener('change', renderPatterns);

// ---------- Einstellungen ----------
const goalSel = $('#goal-select');
for (const [k, v] of Object.entries(GOALS)) goalSel.append(new Option(v, k));
goalSel.value = settings.goal;
goalSel.addEventListener('change', () => { settings.goal = goalSel.value; saveSettings(); updateUI(); });
for (const r of $$('input[name=handed]')) {
  r.checked = r.value === settings.handed;
  r.addEventListener('change', () => {
    settings.handed = r.value; saveSettings();
    for (const c of Object.values(clips)) if (c.rawFrames) { try { finalize(c); } catch { /* Meldung beim nächsten Analysieren */ } }
    updateUI();
  });
}

// ---------- Tabs ----------
for (const b of $$('.tabbar button')) b.addEventListener('click', () => {
  const tab = b.dataset.tab;
  $$('.tabbar button').forEach(x => x.classList.toggle('active', x === b));
  $$('.tab').forEach(s => s.classList.toggle('active', s.id === `tab-${tab}`));
  for (const c of Object.values(clips)) c.video.pause();
  if (tab === 'compare') enterCompare(); else leaveCompare();
  if (tab === 'history') renderHistory();
  if (tab === 'patterns') renderPatterns();
  window.scrollTo(0, 0);
});

// ---------- Start ----------
refreshLatestPro().then(updateUI).catch(updateUI);
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
