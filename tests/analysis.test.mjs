import { prepareFrames, computeSeries, detectPhases, computeMetrics, timeAtProgress } from '../analysis.js';
import assert from 'node:assert/strict';
// Synthetic right-handed face-on swing: 0..30 address, 30..60 backswing, 60..70 downswing, 70..90 finish
const N = 91;
const lerp = (a,b,f)=>a+(b-a)*f;
function profile(i){ // returns shoulder turn, hip turn, hands height (0 low..1 high), hip shift (0..1)
  if (i<=30) return {sh:0,hp:0,h:0,ws:0.5};
  if (i<=60){const f=(i-30)/30;return {sh:90*f,hp:45*f,h:f,ws:lerp(0.5,0.35,f)};}
  if (i<=70){const f=(i-60)/10;return {sh:lerp(90,-20,f),hp:lerp(45,-40,f),h:1-f,ws:lerp(0.35,0.8,f)};}
  const f=(i-70)/20; return {sh:lerp(-20,-100,f),hp:lerp(-40,-80,f),h:lerp(0,0.95,f),ws:lerp(0.8,0.95,f)};
}
const rad = d=>d*Math.PI/180;
const raw=[];
for(let i=0;i<N;i++){
  const p=profile(i);
  const lm=Array.from({length:33},()=>({x:0.5,y:0.5,z:0,visibility:1}));
  const world=Array.from({length:33},()=>({x:0,y:0,z:0}));
  // world: golfer's left (11) on +x when facing camera; rotation negative yaw for backswing
  const shW=0.2, hpW=0.15;
  const s=rad(-p.sh), h=rad(-p.hp);
  world[11]={x:shW*Math.cos(s),y:-0.5,z:shW*Math.sin(s)}; world[12]={x:-shW*Math.cos(s),y:-0.5,z:-shW*Math.sin(s)};
  world[23]={x:hpW*Math.cos(h),y:0,z:hpW*Math.sin(h)}; world[24]={x:-hpW*Math.cos(h),y:0,z:-hpW*Math.sin(h)};
  // lead arm straight
  world[13]={x:world[11].x,y:-0.25,z:world[11].z}; world[15]={x:world[11].x,y:0,z:world[11].z};
  // image: lead ankle 27 on right (x=0.6), trail 28 at 0.4
  lm[27]={x:0.6,y:0.95,z:0,visibility:1}; lm[28]={x:0.4,y:0.95,z:0,visibility:1};
  const hipX=lerp(0.4,0.6,p.ws); lm[23]={x:hipX+0.03,y:0.55,z:0,visibility:1}; lm[24]={x:hipX-0.03,y:0.55,z:0,visibility:1};
  lm[11]={x:0.55,y:0.3,z:0,visibility:1}; lm[12]={x:0.45,y:0.3,z:0,visibility:1};
  const hy=lerp(0.6,0.1,p.h); lm[15]={x:0.5,y:hy,z:0,visibility:1}; lm[16]={x:0.5,y:hy,z:0,visibility:1};
  lm[0]={x:0.5+(i>60&&i<=70?0.01:0),y:0.2,z:0,visibility:1};
  raw.push({t:i/30, lm: i===45?null:lm, world: i===45?null:world});
}
const frames=prepareFrames(raw);
const s=computeSeries(frames,1000,1000,'right');
const ph=detectPhases(s); console.log(ph);
assert.ok(Math.abs(ph.address-30)<=2 && Math.abs(ph.top-60)<=2 && Math.abs(ph.impact-70)<=2, 'phases');
const {metrics}=computeMetrics(s,ph,'faceon'); console.log(metrics);
assert.ok(Math.abs(metrics.shoulderTurnTop-90)<6); assert.ok(Math.abs(metrics.hipTurnTop-45)<6);
assert.ok(Math.abs(metrics.xFactor-45)<6); assert.ok(metrics.leadElbowTop>170);
assert.ok(metrics.weightTop<45 && metrics.weightImpact>70);
console.log('t(u=1.5)=',timeAtProgress(frames,ph,1.5));
// left-handed mirror: should not crash
computeMetrics(computeSeries(frames,1000,1000,'left'),ph,'dtl');
console.log('OK');

// Pro-Muster
const { phaseCurves } = await import('../analysis.js');
const { corridor, position, curveBand, sequencing, squareTiming } = await import('../patterns.js');
const res = computeMetrics(s, ph, 'faceon');
const curves = phaseCurves(frames, ph, s, res.turns, 'faceon');
assert.equal(curves.shoulder.length, 61);
assert.ok(Math.abs(curves.shoulder[20] - 86) < 6, 'shoulder at top');
const ht = squareTiming(curves.hip), st = squareTiming(curves.shoulder);
assert.ok(ht != null && st != null && ht < st, 'hip squares before shoulders');
const pros = [80, 90, 95, 100, 85].map((v, i) => ({ metrics: { shoulderTurnTop: v }, curves }));
const c = corridor(pros, { id: 'shoulderTurnTop', unit: '°' });
assert.equal(c.p50, 90); assert.equal(c.spread, 'eng');
assert.equal(position(70, c), 'darunter'); assert.equal(position(90, c), 'im Korridor');
assert.equal(curveBand(pros, 'hip').p50.length, 61);
const sq = sequencing(pros); assert.equal(sq.hipFirst, 5);
console.log('patterns OK', { ht, st });
