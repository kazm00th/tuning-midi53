(function (host) {
  'use strict';
  // MIDI messages and PC key events -> { type: 'on', midi, vel } | { type: 'off', midi } | { type: 'pedal', down }.
  function parseMidi(data) {
    const [status, d1, d2] = data;
    const kind = status & 0xf0;
    if (kind === 0x90 && d2 > 0) return { type: 'on', midi: d1, vel: d2 };
    if (kind === 0x80 || kind === 0x90) return { type: 'off', midi: d1 };
    if (kind === 0xb0 && d1 === 64) return { type: 'pedal', down: d2 >= 64 };
    return null;
  }

  // KeyboardEvent.code -> semitones above the C of the current octave (spec §4.2).
  const KEYS = {
    KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
    KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15,
  };
  const MIN_OCTAVE = 1, MAX_OCTAVE = 7, PC_VELOCITY = 100;

  function createPcKeyboard(startOctave = 4) {
    let octave = startOctave;
    const down = new Map();   // code -> midi (null for Space); a key is released at the note it started
    function keydown(code, repeat = false) {
      if (repeat || down.has(code)) return [];
      if (code === 'KeyZ') { octave = Math.max(MIN_OCTAVE, octave - 1); return []; }
      if (code === 'KeyX') { octave = Math.min(MAX_OCTAVE, octave + 1); return []; }
      if (code === 'Space') { down.set(code, null); return [{ type: 'pedal', down: true }]; }
      if (!(code in KEYS)) return [];
      const midi = 12 * (octave + 1) + KEYS[code];
      down.set(code, midi);
      return [{ type: 'on', midi, vel: PC_VELOCITY }];
    }
    function keyup(code) {
      if (!down.has(code)) return [];
      const midi = down.get(code);
      down.delete(code);
      return [code === 'Space' ? { type: 'pedal', down: false } : { type: 'off', midi }];
    }
    function releaseAll() {
      const out = [...down.keys()].map(code => keyup(code)[0]);
      return out;
    }
    return { keydown, keyup, releaseAll, octave: () => octave };
  }

  const api = { KEYS, MIN_OCTAVE, MAX_OCTAVE, PC_VELOCITY, parseMidi, createPcKeyboard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else host.Input = api;
})(globalThis);
