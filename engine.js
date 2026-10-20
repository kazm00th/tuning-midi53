(function (host) {
  'use strict';
  // Where each key sounds (spec §3). Pure: every event carries its time t (seconds); every call returns actions:
  //   { type: 'start', midi, p, s, vel } | { type: 'retune', midi, p, s } | { type: 'stop', midi }
  const T = (typeof module !== 'undefined' && module.exports) ? require('./tuning53.js') : host.Tuning53;
  const GROUP_WINDOW = 0.03;

  // Lexicographic "a < b" for arrays of numbers.
  function less(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  }

  function createEngine(options = {}) {
    const settings = { placeMode: 'root', fixMode: 'move', ...options };
    const notes = new Map();   // midi -> { midi, p, s, vel, held, order }
    let pedal = false;
    let order = 0;
    let group = null;          // { start, keys: [{ midi, vel, released }] }
    let resetPending = false;
    let lastChord = null;

    const sounding = () => [...notes.values()];
    const keyPc = midi => T.mod(midi - 60, 12);
    const rel = (k, n) => T.INTERVALS[T.mod(k - T.pc(n.p), 12)];
    const add = (midi, p, vel, held) => {
      const n = { midi, p, s: T.absStep(p, midi), vel, held, order: order++ };
      notes.set(midi, n);
      return n;
    };
    const start = n => ({ type: 'start', midi: n.midi, p: n.p, s: n.s, vel: n.vel });

    // §3.1: same pitch class -> same point; else the candidate in table relation with the most anchors.
    function place(midi) {
      const k = keyPc(midi);
      const all = sounding();
      const twin = all.find(n => T.pc(n.p) === k);
      if (twin) return twin.p;
      const plain = all.filter(n => n.p.c === 0);
      const anchors = (plain.length ? plain : all).sort((x, y) => x.order - y.order);
      let best = null;
      for (const src of anchors) {
        const cand = T.add(src.p, rel(k, src).p);
        const count = anchors.filter(m => T.same(T.sub(cand, m.p), rel(k, m).p)).length;
        const key = [-count, rel(k, src).rank, src.order];
        if (!best || less(key, best.key)) best = { cand, key };
      }
      return best.cand;
    }

    // §3.3: when the sounding notes form a chord, take the root that leaves the most older notes in place.
    function fixChord(newMidi) {
      const all = sounding();
      const r = T.recognize(all.map(n => T.pc(n.p)));
      if (!r) { lastChord = null; return []; }
      const shapeOf = n => r.chord.shape[T.mod(T.pc(n.p) - r.rootPc, 12)];
      const older = all.filter(n => n.midi !== newMidi).sort((x, y) => x.order - y.order);
      let best = null;
      for (const ref of older) {
        const root = T.sub(ref.p, shapeOf(ref));
        const moved = older.filter(n => !T.same(n.p, T.add(root, shapeOf(n))));
        const key = [moved.length, -(moved.length ? Math.min(...moved.map(n => n.order)) : Infinity)];
        if (!best || less(key, best.key)) best = { root, key };
      }
      lastChord = { chord: r.chord, root: best.root };
      const actions = [];
      for (const n of all) {
        const ideal = T.add(best.root, shapeOf(n));
        if (T.same(ideal, n.p)) continue;
        if (n.midi === newMidi) { n.p = ideal; n.s = T.absStep(ideal, n.midi); continue; }
        if (settings.fixMode !== 'move') continue;
        n.p = ideal; n.s = T.absStep(ideal, n.midi);
        actions.push({ type: 'retune', midi: n.midi, p: n.p, s: n.s });
      }
      return actions;
    }

    // §3.2: sound the group (lowest key first); a reset group never moves the sounding notes.
    function flush() {
      const keys = group.keys.slice().sort((x, y) => x.midi - y.midi);
      group = null;
      resetPending = false;
      const placed = T.placeGroup(keys.map(x => keyPc(x.midi)), settings.placeMode);
      const actions = keys.map(x => start(add(x.midi, placed.points.get(keyPc(x.midi)), x.vel, !x.released)));
      const r = T.recognize(sounding().map(n => T.pc(n.p)));
      lastChord = r ? { chord: r.chord, root: placed.points.get(r.rootPc) || null } : null;
      for (const x of keys) {
        if (x.released && !pedal) { notes.delete(x.midi); actions.push({ type: 'stop', midi: x.midi }); }
      }
      return actions;
    }

    function tick(t) {
      return group && t - group.start >= GROUP_WINDOW - 1e-9 ? flush() : [];
    }

    function noteOn(midi, vel, t) {
      const actions = tick(t);
      if (notes.has(midi)) { notes.delete(midi); actions.push({ type: 'stop', midi }); }
      if (group) {
        const k = group.keys.find(x => x.midi === midi);
        if (k) k.released = false; else group.keys.push({ midi, vel, released: false });
        return actions;
      }
      if (notes.size === 0 || resetPending) {
        group = { start: t, keys: [{ midi, vel, released: false }] };
        return actions;
      }
      const n = add(midi, place(midi), vel, true);
      const fixes = fixChord(midi);
      actions.push(start(n), ...fixes);
      return actions;
    }

    function noteOff(midi, t) {
      const actions = tick(t);
      const k = group && group.keys.find(x => x.midi === midi);
      if (k) { k.released = true; return actions; }
      const n = notes.get(midi);
      if (!n) return actions;
      if (pedal) { n.held = false; return actions; }
      notes.delete(midi);
      actions.push({ type: 'stop', midi });
      return actions;
    }

    function setPedal(down, t) {
      const actions = tick(t);
      pedal = down;
      if (!down) {
        for (const n of sounding()) {
          if (!n.held) { notes.delete(n.midi); actions.push({ type: 'stop', midi: n.midi }); }
        }
      }
      return actions;
    }

    return {
      noteOn, noteOff, setPedal, tick,
      reset() { resetPending = true; },
      // A note the voices had to drop (more than MAX_VOICES): forget it without sending actions.
      forget(midi) { notes.delete(midi); return []; },
      setSettings(s) { Object.assign(settings, s); },
      settings: () => ({ ...settings }),
      sounding: () => sounding().map(n => ({ ...n })),
      chord: () => lastChord,
      pendingUntil: () => (group ? group.start + GROUP_WINDOW : null),
    };
  }

  const api = { GROUP_WINDOW, createEngine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else host.Engine = api;
})(globalThis);
