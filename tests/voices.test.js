const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../voices.js');
const T = require('../tuning53.js');

const near = (x, y, eps = 1e-9) => assert.ok(Math.abs(x - y) <= eps, `${x} != ${y}`);
function finite(v) { if (!Number.isFinite(v)) throw new TypeError('non-finite'); return v; }
function fakeParam(initial) {
  let value = initial;
  const p = {
    get value() { return value; }, set value(v) { value = finite(v); }, events: [],
    cancelScheduledValues(t) { p.events.push(['cancel', t]); },
    setValueAtTime(v, t) { p.events.push(['set', finite(v), t]); value = v; },
    linearRampToValueAtTime(v, t) { p.events.push(['ramp', finite(v), t]); value = v; },
  };
  return p;
}
function fakeContext() {
  const ctx = {
    currentTime: 2, destination: {}, oscillators: [], gains: [], compressors: [],
    createPeriodicWave: (real, imag) => ({ real, imag }),
    createDynamicsCompressor() {
      const c = { threshold: fakeParam(0), knee: fakeParam(0), ratio: fakeParam(1), attack: fakeParam(0), release: fakeParam(0),
        connect(d) { c.to = d; } };
      ctx.compressors.push(c); return c;
    },
    createGain() { const g = { gain: fakeParam(1), connect(d) { g.to = d; } }; ctx.gains.push(g); return g; },
    createOscillator() {
      const o = { frequency: fakeParam(440), setPeriodicWave(w) { o.wave = w; }, connect(d) { o.to = d; },
        start(t) { o.startedAt = t; }, stop(t) { o.stoppedAt = t; } };
      ctx.oscillators.push(o); return o;
    },
  };
  return ctx;
}

test('constants: 10 ms ramps, 16 partials, at most 24 voices', () => {
  assert.equal(V.RAMP, 0.01); assert.equal(V.HARMONICS, 16); assert.equal(V.MAX_VOICES, 24);
  const { imag } = V.sawtoothCoefficients();
  for (let n = 1; n <= 16; n++) near(imag[n], (n % 2 ? 1 : -1) / n);
});

test('start: frequency from the 53-EDO step, gain 0 -> volume·vel/127·NOTE_GAIN in 10 ms, through the limiter', () => {
  const ctx = fakeContext();
  const v = V.createVoices(ctx);
  v.start(60, 17, 127);
  const o = ctx.oscillators[0], g = ctx.gains[0];
  near(o.frequency.value, T.frequency(17));
  assert.equal(o.startedAt, 2);
  assert.deepEqual(g.gain.events, [['set', 0, 2], ['ramp', 0.8 * 1 * V.NOTE_GAIN, 2.01]]);
  assert.equal(o.to, g); assert.equal(g.to, ctx.compressors[0]); assert.equal(ctx.compressors[0].to, ctx.destination);
});

test('stop: gain to 0 in 10 ms and the oscillator stops at the end of the ramp', () => {
  const ctx = fakeContext();
  const v = V.createVoices(ctx);
  v.start(60, 0, 100); ctx.currentTime = 3; v.stop(60);
  assert.deepEqual(ctx.gains[0].gain.events.slice(-1), [['ramp', 0, 3.01]]);
  near(ctx.oscillators[0].stoppedAt, 3.01);
  assert.equal(v.count(), 0);
  v.stop(60);   // twice is harmless
});

test('retune writes the new frequency at once; setA4 retunes every voice', () => {
  const ctx = fakeContext();
  const v = V.createVoices(ctx);
  v.start(62, 9, 100); ctx.currentTime = 4; v.retune(62, 8);
  assert.deepEqual(ctx.oscillators[0].frequency.events.pop(), ['set', T.frequency(8), 4]);
  v.setA4(442);
  near(ctx.oscillators[0].frequency.events.pop()[1], T.frequency(8, 442));
  v.setA4(0); v.setA4(NaN);   // ignored
  near(ctx.oscillators[0].frequency.value, T.frequency(8, 442));
});

test('apply runs engine actions in order', () => {
  const ctx = fakeContext();
  const v = V.createVoices(ctx);
  v.apply([{ type: 'start', midi: 60, s: 0, vel: 100 }, { type: 'start', midi: 64, s: 17, vel: 100 },
    { type: 'retune', midi: 64, s: 18 }, { type: 'stop', midi: 60 }]);
  assert.equal(v.count(), 1);
  near(ctx.oscillators[1].frequency.value, T.frequency(18));
});

test('the 25th voice stops the oldest one; re-starting an id stops its old voice first', () => {
  const ctx = fakeContext();
  const v = V.createVoices(ctx);
  for (let i = 0; i < 25; i++) v.start(30 + i, i, 100);
  assert.equal(v.count(), 24);
  assert.notEqual(ctx.oscillators[0].stoppedAt, undefined);
  v.start(40, 3, 100);
  assert.equal(v.count(), 24);
  assert.notEqual(ctx.oscillators[10].stoppedAt, undefined);
});

test('setVolume ramps every voice to the new level; negative or non-finite is ignored', () => {
  const ctx = fakeContext();
  const v = V.createVoices(ctx);
  v.start(60, 0, 127); ctx.currentTime = 5; v.setVolume(0.5);
  assert.deepEqual(ctx.gains[0].gain.events.slice(-1), [['ramp', 0.5 * V.NOTE_GAIN, 5.01]]);
  v.setVolume(-1); v.setVolume(Infinity);
  assert.equal(ctx.gains[0].gain.events.length, 5);
});

test('onEvict is called with the id of the voice stopped by the 25th start', () => {
  const ctx = fakeContext();
  const v = V.createVoices(ctx);
  const evicted = [];
  v.onEvict(id => evicted.push(id));
  for (let i = 0; i < 25; i++) v.start(30 + i, i, 100);
  assert.deepEqual(evicted, [30]);
});
