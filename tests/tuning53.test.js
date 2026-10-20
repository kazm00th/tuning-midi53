const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../tuning53.js');

const P = (a, b, c = 0) => T.pt(a, b, c);
const near = (x, y, eps = 1e-9) => assert.ok(Math.abs(x - y) <= eps, `${x} != ${y}`);

test('steps of the lattice directions: 3/2 = 31, 5/4 = 17, 7/4 = 43, 81/80 = 1', () => {
  assert.equal(T.N, 53);
  assert.equal(T.step(P(1, 0)), 31);
  assert.equal(T.step(P(0, 1)), 17);
  assert.equal(T.step(P(0, 0, 1)), 43);
  assert.equal(T.step(P(4, -1)), 1);          // syntonic comma
  assert.equal(T.step(P(8, 1)), 0);           // schisma vanishes
  assert.equal(T.step(P(-5, 6)), 0);          // kleisma vanishes
});

test('interval table: ratios and steps of spec §3.1', () => {
  const steps = T.INTERVALS.map(x => T.step(x.p));
  assert.deepEqual(steps, [0, 5, 9, 14, 17, 22, 26, 31, 36, 39, 44, 48]);
  T.INTERVALS.forEach((x, d) => { assert.equal(x.d, d); assert.equal(T.pc(x.p), d); });
  const ranks = T.INTERVALS.map(x => x.rank);
  assert.deepEqual(ranks, [-1, 3, 2, 1, 1, 0, 4, 0, 1, 1, 2, 3]);
});

test('pitch class of a lattice point; 7/4 counts as 10 semitones', () => {
  assert.equal(T.pc(P(0, 0)), 0);
  assert.equal(T.pc(P(-1, 1)), 9);     // A = 5/3
  assert.equal(T.pc(P(-2, 1)), 2);     // D = 10/9
  assert.equal(T.pc(P(0, 0, 1)), 10);  // 7/4
  assert.equal(T.pc(P(-4, 4)), 0);     // B♯⁻⁴
});

test('names follow Shinohara 2019: letter, accidentals, comma index, (7)', () => {
  assert.equal(T.name(P(0, 0)).text, 'C0');
  assert.equal(T.name(P(0, 1)).text, 'E-1');
  assert.equal(T.name(P(-2, 1)).text, 'D-1');
  assert.equal(T.name(P(-4, 1)).text, 'C-1');
  assert.equal(T.name(P(-4, 4)).text, 'B♯-4');
  assert.equal(T.name(P(-1, 0)).text, 'F0');
  assert.equal(T.name(P(0, -1)).text, 'A♭1');
  assert.equal(T.name(P(1, 0, 1)).text, 'F0(7)');   // 7/4 above G
  assert.equal(T.name(P(3, 0)).text, 'A0');
});

test('recognize major, minor, dominant seventh and minor seventh in any inversion', () => {
  assert.equal(T.recognize([0, 4, 7]).chord.name, '長三和音');
  assert.equal(T.recognize([4, 7, 0, 12]).rootPc, 0);
  assert.equal(T.recognize([9, 0, 4]).chord.name, '短三和音');
  assert.equal(T.recognize([9, 0, 4]).rootPc, 9);
  assert.equal(T.recognize([7, 11, 2, 5]).chord.name, '属七');
  assert.equal(T.recognize([7, 11, 2, 5]).rootPc, 7);
  assert.equal(T.recognize([2, 5, 9, 0]).chord.name, '短七');
  assert.equal(T.recognize([2, 5, 9, 0]).rootPc, 2);
  assert.equal(T.recognize([0, 4]), null);
  assert.equal(T.recognize([0, 4, 8]), null);
  assert.equal(T.step(T.CHORDS[2].shape[10]), 43);   // dominant seventh 7/4
  assert.equal(T.step(T.CHORDS[3].shape[10]), 45);   // minor seventh chord 9/5
});

test('deviation from 12-TET and the nearest point of each pitch class', () => {
  near(T.deviation(P(0, 1)), 17 * 1200 / 53 - 400);
  assert.ok(T.same(T.nearest(0), P(0, 0)));
  assert.ok(T.same(T.nearest(4), P(4, 0)));          // E⁰ (18 steps, +7.5¢) beats E⁻¹ (17, −15.1¢)
  for (let k = 0; k < 12; k++) {
    const best = T.nearest(k);
    assert.equal(T.pc(best), k);
    for (const q of T.candidates(k)) assert.ok(Math.abs(T.deviation(best)) <= Math.abs(T.deviation(q)) + 1e-9);
  }
  for (const q of T.candidates(6)) { assert.equal(q.c, 0); assert.ok(Math.abs(q.b) <= 2); assert.equal(T.pc(q), 6); }
});

test('placeGroup "root": root nearest 12-TET, other tones pure from it', () => {
  const g = T.placeGroup([4, 8, 11], 'root');       // E major
  assert.equal(g.chord.name, '長三和音');
  assert.ok(T.same(g.points.get(4), P(4, 0)));
  assert.ok(T.same(g.points.get(8), P(4, 1)));
  assert.ok(T.same(g.points.get(11), P(5, 0)));
});

test('placeGroup "average": the root that minimises the squared deviations of all tones', () => {
  const pcs = [4, 8, 11];
  const g = T.placeGroup(pcs, 'average');
  const sq = pts => [...pts.values()].reduce((s, p) => s + T.deviation(p) ** 2, 0);
  const best = Math.min(...T.candidates(4).map(r => sq(new Map([[4, r], [8, T.add(r, P(0, 1))], [11, T.add(r, P(1, 0))]]))));
  near(sq(g.points), best);
  assert.ok(T.same(T.sub(g.points.get(8), g.points.get(4)), P(0, 1)));
});

test('placeGroup of a group that is not a chord uses the interval table from the lowest key', () => {
  const g = T.placeGroup([0, 2], 'root');           // C and D: D is 9/8 above C
  assert.equal(g.chord, null);
  assert.ok(T.same(g.points.get(2), P(2, 0)));
});

test('absolute step: octave chosen nearest to the key in 12-TET; C⁻¹ on middle C is −1', () => {
  assert.equal(T.absStep(P(0, 0), 60), 0);
  assert.equal(T.absStep(P(-4, 1), 60), -1);
  assert.equal(T.absStep(P(0, 0), 72), 53);
  assert.equal(T.absStep(P(0, 1), 64), 17);
  assert.equal(T.absStep(P(0, 1), 52), 17 - 53);
  near(T.frequency(0), 440 * Math.pow(2, -9 / 12));
  near(T.frequency(53), 2 * 440 * Math.pow(2, -9 / 12));
  near(T.frequency(0, 442), 442 * Math.pow(2, -9 / 12));
});
