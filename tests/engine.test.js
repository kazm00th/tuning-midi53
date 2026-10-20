const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../tuning53.js');
const E = require('../engine.js');

const P = (a, b, c = 0) => T.pt(a, b, c);
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, B4 = 71, C5 = 72;
const point = (eng, midi) => eng.sounding().find(n => n.midi === midi).p;
const stepOf = (eng, midi) => eng.sounding().find(n => n.midi === midi).s;

// Press keys one after another (each later than the 30 ms group window), from silence.
function play(eng, keys, t0 = 0) {
  let t = t0;
  const actions = [];
  actions.push(...eng.noteOn(keys[0], 100, t));
  t += 0.05;
  actions.push(...eng.tick(t));
  for (const k of keys.slice(1)) { t += 0.05; actions.push(...eng.noteOn(k, 100, t)); }
  return { t, actions };
}

test('the first key waits 30 ms (GROUP_WINDOW), then sounds near 12-TET', () => {
  assert.equal(E.GROUP_WINDOW, 0.03);
  const eng = E.createEngine();
  assert.deepEqual(eng.noteOn(C4, 90, 0), []);
  assert.equal(eng.pendingUntil(), 0.03);
  assert.deepEqual(eng.tick(0.02), []);
  const a = eng.tick(0.03);
  assert.equal(a.length, 1);
  assert.deepEqual(a[0], { type: 'start', midi: C4, p: P(0, 0), s: 0, vel: 90 });
  assert.equal(eng.pendingUntil(), null);
});

test('keys within 30 ms form one group: C E G pressed together is a pure major triad', () => {
  const eng = E.createEngine();
  eng.noteOn(E4, 100, 0); eng.noteOn(C4, 100, 0.01); eng.noteOn(G4, 100, 0.02);
  const a = eng.tick(0.031);
  assert.deepEqual(a.map(x => x.type), ['start', 'start', 'start']);
  assert.deepEqual([stepOf(eng, C4), stepOf(eng, E4), stepOf(eng, G4)], [0, 17, 31]);
  assert.equal(eng.chord().chord.name, '長三和音');
});

test('C then E (one after the other): E is the pure major third, 17 steps', () => {
  const eng = E.createEngine();
  play(eng, [C4, E4]);
  assert.ok(T.same(point(eng, E4), P(0, 1)));
  assert.equal(stepOf(eng, E4), 17);
});

test('C, E, G one at a time give 0, 17, 31', () => {
  const eng = E.createEngine();
  play(eng, [C4, E4, G4]);
  assert.deepEqual([C4, E4, G4].map(m => stepOf(eng, m)), [0, 17, 31]);
});

test('I–vi–ii–V–I holding the common tones ends on C⁻¹ (−1 step)', () => {
  const eng = E.createEngine();
  let { t } = play(eng, [C4, E4, G4]);
  const step = () => (t += 0.05);
  eng.noteOff(G4, step()); eng.noteOn(A4, 100, step());                        // vi: A C E (hold C E)
  assert.ok(T.same(point(eng, A4), P(-1, 1)));
  eng.noteOff(C4, step()); eng.noteOff(E4, step());
  eng.noteOn(D4 + 12, 100, step()); eng.noteOn(F4 + 12, 100, step());          // ii: D F A (hold A)
  assert.ok(T.same(point(eng, D4 + 12), P(-2, 1)));
  assert.ok(T.same(point(eng, F4 + 12), P(-1, 0)));
  eng.noteOff(A4, step()); eng.noteOff(F4 + 12, step());
  eng.noteOn(G4, 100, step()); eng.noteOn(B4, 100, step());                    // V: G B D (hold D)
  assert.ok(T.same(point(eng, G4), P(-3, 1)));
  assert.ok(T.same(point(eng, B4), P(-3, 2)));
  eng.noteOff(D4 + 12, step()); eng.noteOff(B4, step());
  eng.noteOn(C5, 100, step()); eng.noteOn(E4 + 12, 100, step());              // I: C E G (hold G)
  assert.ok(T.same(point(eng, C5), P(-4, 1)));
  assert.equal(stepOf(eng, C5), 53 - 1);
  assert.equal(T.name(point(eng, C5)).text, 'C-1');
});

test('C D F A: D first sounds as 9/8 (9 steps); "move" retunes it to D⁻¹ (8 steps)', () => {
  const eng = E.createEngine({ fixMode: 'move' });
  const { actions } = play(eng, [C4, D4, F4, A4]);
  assert.equal(T.step(point(eng, A4)), 39);
  assert.ok(T.same(point(eng, D4), P(-2, 1)));
  assert.equal(stepOf(eng, D4), 8);
  const retune = actions.filter(x => x.type === 'retune');
  assert.deepEqual(retune, [{ type: 'retune', midi: D4, p: P(-2, 1), s: 8 }]);
  assert.equal(eng.chord().chord.name, '短七');
  assert.equal(T.step(T.sub(point(eng, C4), point(eng, D4))), 45);   // 9/5 in the minor seventh chord
});

test('C D F A with "keep": D stays at 9 steps and nothing is retuned', () => {
  const eng = E.createEngine({ fixMode: 'keep' });
  const { actions } = play(eng, [C4, D4, F4, A4]);
  assert.equal(stepOf(eng, D4), 9);
  assert.equal(actions.filter(x => x.type === 'retune').length, 0);
});

test('dominant seventh G B D F: F is 43 steps above G (7/4) and named F(7)', () => {
  const eng = E.createEngine();
  play(eng, [G4 - 12, B4 - 12, D4, F4]);
  const g = point(eng, G4 - 12), f = point(eng, F4);
  assert.equal(T.step(T.sub(f, g)), 43);
  assert.equal(f.c, 1);
  assert.ok(T.name(f).text.endsWith('(7)'));
  assert.equal(eng.chord().chord.name, '属七');
});

test('a septimal note is not an anchor while plain notes sound; alone, new notes inherit c', () => {
  const eng = E.createEngine();
  let { t } = play(eng, [G4 - 12, B4 - 12, D4, F4]);
  eng.noteOff(B4 - 12, (t += 0.05)); eng.noteOff(D4, (t += 0.05));
  eng.noteOn(C4, 100, (t += 0.05));   // G and F(7) sound: C is placed from G only (a fourth above G)
  assert.equal(point(eng, C4).c, 0);
  assert.ok(T.same(T.sub(point(eng, C4), point(eng, G4 - 12)), P(-1, 0)));
  eng.noteOff(G4 - 12, (t += 0.05)); eng.noteOff(C4, (t += 0.05));
  eng.noteOn(A4, 100, (t += 0.05));   // only F(7) sounds: A is a pure major third above it, keeping c = 1
  assert.equal(point(eng, A4).c, 1);
  assert.ok(T.same(T.sub(point(eng, A4), point(eng, F4)), P(0, 1)));
});

test('a key of the same pitch class as a sounding note gets the same lattice point', () => {
  const eng = E.createEngine();
  play(eng, [C4, E4, C5]);
  assert.ok(T.same(point(eng, C5), point(eng, C4)));
  assert.equal(stepOf(eng, C5), 53);
});

test('pedal: released keys keep sounding and still count as common tones; pedal up stops them', () => {
  const eng = E.createEngine();
  let { t } = play(eng, [C4, E4, G4]);
  eng.setPedal(true, (t += 0.05));
  assert.deepEqual(eng.noteOff(C4, (t += 0.05)), []);
  eng.noteOff(E4, (t += 0.05)); eng.noteOff(G4, (t += 0.05));
  eng.noteOn(A4, 100, (t += 0.05));   // C and E sound under the pedal: A is placed from them
  assert.ok(T.same(point(eng, A4), P(-1, 1)));
  const up = eng.setPedal(false, (t += 0.05));
  assert.deepEqual(up.map(x => x.midi).sort(), [C4, E4, G4].sort());
  assert.deepEqual(eng.sounding().map(n => n.midi), [A4]);
});

test('releasing everything returns to 12-TET: the next chord starts a new group', () => {
  const eng = E.createEngine();
  let { t } = play(eng, [C4, E4, G4]);
  eng.noteOff(C4, (t += 0.05)); eng.noteOff(E4, (t += 0.05)); eng.noteOff(G4, (t += 0.05));
  assert.equal(eng.sounding().length, 0);
  eng.noteOn(A4, 100, (t += 0.05));
  assert.equal(eng.sounding().length, 0);   // waiting for the group
  eng.tick((t += 0.05));
  assert.ok(T.same(point(eng, A4), T.nearest(9)));
});

test('reset: the next group ignores sounding notes and never moves them, even with "move"', () => {
  const eng = E.createEngine({ fixMode: 'move' });
  let { t } = play(eng, [C4, D4]);            // D at 9/8 (9 steps)
  eng.reset();
  eng.noteOn(F4, 100, (t += 0.05)); eng.noteOn(A4, 100, (t += 0.01));
  const a = eng.tick((t += 0.05));
  assert.equal(a.filter(x => x.type === 'retune').length, 0);
  assert.equal(stepOf(eng, D4), 9);
  assert.ok(T.same(point(eng, F4), T.nearest(5)));
  eng.noteOn(B4, 100, (t += 0.05));           // after the group, placement relative to sounding notes resumes
  assert.equal(eng.pendingUntil(), null);
});

test('a key pressed and released inside the group window still sounds briefly', () => {
  const eng = E.createEngine();
  eng.noteOn(C4, 100, 0); eng.noteOff(C4, 0.01);
  const a = eng.tick(0.04);
  assert.deepEqual(a.map(x => x.type), ['start', 'stop']);
  assert.equal(eng.sounding().length, 0);
});

test('re-striking a key that sounds under the pedal stops the old note and places it anew', () => {
  const eng = E.createEngine();
  let { t } = play(eng, [C4, E4]);
  eng.setPedal(true, (t += 0.05));
  eng.noteOff(E4, (t += 0.05));
  const a = eng.noteOn(E4, 80, (t += 0.05));
  assert.deepEqual(a.map(x => x.type), ['stop', 'start']);
  assert.ok(T.same(point(eng, E4), P(0, 1)));
});

test('placement mode "average" is used for groups', () => {
  const eng = E.createEngine({ placeMode: 'average' });
  eng.noteOn(E4, 100, 0); eng.noteOn(G4 + 1, 100, 0); eng.noteOn(B4, 100, 0);
  eng.tick(0.05);
  const ref = T.placeGroup([4, 8, 11], 'average').points;
  assert.ok(T.same(point(eng, E4), ref.get(4)));
});
