(function (host) {
  'use strict';
  // Pitch maths. A point { a, b, c } is 3^a·5^b·7^c (octave-equivalent); it sounds as a 53-EDO step.
  const N = 53;
  const VAL = { a: 31, b: 17, c: 43 };   // steps of 3/2, 5/4 and 7/4 within the octave
  const FIFTHS = 'FCGDAEB';

  const mod = (x, m) => ((x % m) + m) % m;
  const pt = (a, b, c = 0) => ({ a, b, c });
  const add = (p, q) => pt(p.a + q.a, p.b + q.b, p.c + q.c);
  const sub = (p, q) => pt(p.a - q.a, p.b - q.b, p.c - q.c);
  const same = (p, q) => p.a === q.a && p.b === q.b && p.c === q.c;
  const step = p => mod(VAL.a * p.a + VAL.b * p.b + VAL.c * p.c, N);
  const pc = p => mod(7 * p.a + 4 * p.b + 10 * p.c, 12);   // 12-TET pitch class, C = 0

  // Spec §3.1: the interval used to place a note d semitones above a sounding note.
  // rank: simplicity (perfect 0, thirds and sixths 1, second and minor seventh 2, seventh and semitone 3, tritone 4).
  const INTERVALS = [
    [pt(0, 0), -1], [pt(-1, -1), 3], [pt(2, 0), 2], [pt(1, -1), 1], [pt(0, 1), 1], [pt(-1, 0), 0],
    [pt(2, 1), 4], [pt(1, 0), 0], [pt(0, -1), 1], [pt(-1, 1), 1], [pt(-2, 0), 2], [pt(1, 1), 3],
  ].map(([p, rank], d) => ({ d, p, rank }));

  // Spec §3.4: recognised chords and their pure shapes (semitones above the root -> point).
  const CHORDS = [
    { name: '長三和音', shape: { 0: pt(0, 0), 4: pt(0, 1), 7: pt(1, 0) } },
    { name: '短三和音', shape: { 0: pt(0, 0), 3: pt(1, -1), 7: pt(1, 0) } },
    { name: '属七', shape: { 0: pt(0, 0), 4: pt(0, 1), 7: pt(1, 0), 10: pt(0, 0, 1) } },
    { name: '短七', shape: { 0: pt(0, 0), 3: pt(1, -1), 7: pt(1, 0), 10: pt(2, -1) } },
  ];
  const ROLE = { 0: '根音', 3: '第3音', 4: '第3音', 7: '第5音', 10: '第7音' };

  function recognize(pcs) {
    const set = [...new Set(pcs.map(k => mod(k, 12)))].sort((x, y) => x - y);
    for (const chord of CHORDS) {
      const shape = Object.keys(chord.shape).map(Number).sort((x, y) => x - y);
      if (shape.length !== set.length) continue;
      for (const root of set) {
        const rel = set.map(k => mod(k - root, 12)).sort((x, y) => x - y);
        if (rel.every((k, i) => k === shape[i])) return { chord, rootPc: root };
      }
    }
    return null;
  }

  const cents = p => step(p) * 1200 / N;
  const deviation = p => mod(cents(p) - 100 * pc(p) + 600, 1200) - 600;

  // Points of pitch class k with c = 0 and |b| <= 2 (spec §3.2).
  function candidates(k) {
    const out = [];
    for (let b = -2; b <= 2; b++) {
      const a0 = mod(7 * (k - 4 * b), 12);   // 7·7 ≡ 1 (mod 12)
      for (const a of [a0 - 24, a0 - 12, a0]) out.push(pt(a, b));
    }
    return out;
  }
  const simplicity = p => Math.abs(p.b) * 100 + Math.abs(p.a);
  // The candidate with the smallest score; ties go to the simpler point.
  function argmin(points, score) {
    let best = null, bestScore = Infinity;
    for (const p of points) {
      const s = score(p);
      if (s < bestScore - 1e-9 || (Math.abs(s - bestScore) <= 1e-9 && simplicity(p) < simplicity(best))) {
        best = p; bestScore = s;
      }
    }
    return best;
  }
  const nearest = k => argmin(candidates(k), p => Math.abs(deviation(p)));

  // Spec §3.2: place a group from silence. pcs[0] is the lowest key.
  function placeGroup(pcs, mode) {
    const tones = [...new Set(pcs.map(k => mod(k, 12)))];
    const r = recognize(tones);
    const rootPc = r ? r.rootPc : mod(pcs[0], 12);
    const shapeOf = k => (r ? r.chord.shape[mod(k - rootPc, 12)] : INTERVALS[mod(k - rootPc, 12)].p);
    const at = root => new Map(tones.map(k => [k, add(root, shapeOf(k))]));
    const root = mode === 'average'
      ? argmin(candidates(rootPc), cand => [...at(cand).values()].reduce((s, p) => s + deviation(p) ** 2, 0))
      : nearest(rootPc);
    return { points: at(root), rootPc, chord: r ? r.chord : null };
  }

  // Whole-keyboard step (C4 = 0) for a point sounded on MIDI key midi: the octave nearest to 12-TET.
  function absStep(p, midi) {
    const s0 = step(p);
    return s0 + N * Math.round(((midi - 60) * N / 12 - s0) / N);
  }
  const frequency = (s, a4 = 440) => a4 * Math.pow(2, -9 / 12) * Math.pow(2, s / N);

  // Shinohara 2019: letter, accidentals, syntonic-comma index (-b); 7/4 spelled as a minor seventh, marked (7).
  function name(p) {
    const k = p.a + 4 * p.b - 2 * p.c;
    const letter = FIFTHS[mod(k + 1, 7)];
    const n = Math.floor((k + 1) / 7);
    const acc = n >= 0 ? '♯'.repeat(n) : '♭'.repeat(-n);
    const index = -p.b;
    return { letter, acc, index, sept: p.c, text: `${letter}${acc}${index}${p.c ? '(7)' : ''}` };
  }

  const api = { N, VAL, INTERVALS, CHORDS, ROLE, mod, pt, add, sub, same, step, pc, recognize, cents, deviation,
    candidates, nearest, placeGroup, absStep, frequency, name };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else host.Tuning53 = api;
})(globalThis);
