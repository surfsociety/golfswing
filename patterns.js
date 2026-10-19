// Auswertung über viele gespeicherte Pro-Schwünge: Korridore je Messwert und Bänder je Bewegungskurve.

import { CURVE_STEPS } from './analysis.js';

export const MIN_PROS = 3;
export const SOLID_PROS = 10;

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Ab welcher Breite des mittleren 50-%-Bereichs ein Wert als Stilfrage gilt (Einheit des Messwerts).
const SPREAD = { '°': [10, 20], '%': [10, 20] };

export function corridor(entries, metric) {
  const vals = entries.map(e => e.metrics?.[metric.id]).filter(v => v != null).sort((a, b) => a - b);
  if (vals.length < MIN_PROS) return { n: vals.length };
  const p25 = quantile(vals, 0.25), p50 = quantile(vals, 0.5), p75 = quantile(vals, 0.75);
  const [tight, wide] = SPREAD[metric.unit] || SPREAD['°'];
  const iqr = p75 - p25;
  const spread = iqr <= tight ? 'eng' : iqr <= wide ? 'mittel' : 'breit';
  return { n: vals.length, p25, p50, p75, spread };
}

export function position(value, c) {
  if (value == null || c.p25 == null) return null;
  if (value < c.p25) return 'darunter';
  if (value > c.p75) return 'darüber';
  return 'im Korridor';
}

export function curveBand(entries, key) {
  const curves = entries.map(e => e.curves?.[key]).filter(c => Array.isArray(c) && c.length === CURVE_STEPS + 1);
  if (curves.length < MIN_PROS) return { n: curves.length };
  const p25 = [], p50 = [], p75 = [];
  for (let k = 0; k <= CURVE_STEPS; k++) {
    const col = curves.map(c => c[k]).sort((a, b) => a - b);
    p25.push(quantile(col, 0.25)); p50.push(quantile(col, 0.5)); p75.push(quantile(col, 0.75));
  }
  return { n: curves.length, p25, p50, p75 };
}

// Zeitpunkt im Abschwung (0 = Top, 1 = Treffmoment), an dem eine Drehung wieder auf Ansprechposition ist.
export function squareTiming(curve) {
  if (!curve) return null;
  const per = CURVE_STEPS / 3;
  for (let k = per + 1; k <= 2 * per; k++) {
    if (curve[k - 1] > 0 && curve[k] <= 0) {
      const f = curve[k - 1] / (curve[k - 1] - curve[k]);
      return (k - 1 + f - per) / per;
    }
  }
  return null;
}

// Typische Abfolge im Abschwung: Hüfte vor Schultern zurück auf Ansprechposition.
export function sequencing(entries) {
  let hipFirst = 0, counted = 0;
  const hipT = [], shT = [];
  for (const e of entries) {
    const h = squareTiming(e.curves?.hip), s = squareTiming(e.curves?.shoulder);
    if (h != null) hipT.push(h);
    if (s != null) shT.push(s);
    if (h != null && s != null) { counted++; if (h < s) hipFirst++; }
  }
  const med = arr => quantile([...arr].sort((a, b) => a - b), 0.5);
  return { counted, hipFirst, hipMedian: med(hipT), shoulderMedian: med(shT) };
}
