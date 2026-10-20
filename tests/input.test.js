const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../input.js');

test('MIDI: note on, note on with velocity 0 = off, note off, CC64 pedal; other messages ignored', () => {
  assert.deepEqual(I.parseMidi([0x90, 60, 100]), { type: 'on', midi: 60, vel: 100 });
  assert.deepEqual(I.parseMidi([0x93, 61, 1]), { type: 'on', midi: 61, vel: 1 });      // any channel
  assert.deepEqual(I.parseMidi([0x90, 60, 0]), { type: 'off', midi: 60 });
  assert.deepEqual(I.parseMidi([0x8f, 60, 64]), { type: 'off', midi: 60 });
  assert.deepEqual(I.parseMidi([0xb0, 64, 127]), { type: 'pedal', down: true });
  assert.deepEqual(I.parseMidi([0xb0, 64, 64]), { type: 'pedal', down: true });
  assert.deepEqual(I.parseMidi([0xb0, 64, 63]), { type: 'pedal', down: false });
  assert.equal(I.parseMidi([0xb0, 7, 100]), null);
  assert.equal(I.parseMidi([0xe0, 0, 64]), null);
  assert.equal(I.parseMidi([0xf8]), null);
});

test('PC keys: A..L white keys and W..P black keys from C of the octave (C4 = 60 at the start)', () => {
  const kb = I.createPcKeyboard();
  const codes = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP'];
  assert.deepEqual(codes.map(c => kb.keydown(c)[0].midi), [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75]);
  assert.deepEqual(kb.keydown('KeyA'), []);                      // already down
  assert.deepEqual(kb.keyup('KeyA'), [{ type: 'off', midi: 60 }]);
  assert.equal(I.PC_VELOCITY, 100);
});

test('PC keys: Z/X change the octave within C1..C7; a held key is released at its own note', () => {
  const kb = I.createPcKeyboard();
  kb.keydown('KeyA');                      // C4
  kb.keydown('KeyX'); assert.equal(kb.octave(), 5);
  assert.deepEqual(kb.keydown('KeyS'), [{ type: 'on', midi: 74, vel: 100 }]);
  assert.deepEqual(kb.keyup('KeyA'), [{ type: 'off', midi: 60 }]);
  for (let i = 0; i < 10; i++) kb.keydown('KeyZ');
  assert.equal(kb.octave(), 1);
  for (let i = 0; i < 10; i++) kb.keydown('KeyX');
  assert.equal(kb.octave(), 7);
});

test('PC keys: Space is the pedal, auto-repeat and unknown keys are ignored', () => {
  const kb = I.createPcKeyboard();
  assert.deepEqual(kb.keydown('Space'), [{ type: 'pedal', down: true }]);
  assert.deepEqual(kb.keydown('Space'), []);
  assert.deepEqual(kb.keyup('Space'), [{ type: 'pedal', down: false }]);
  assert.deepEqual(kb.keydown('KeyA', true), []);
  assert.deepEqual(kb.keydown('KeyQ'), []);
  assert.deepEqual(kb.keyup('KeyQ'), []);
});

test('releaseAll lets go of every held key and the Space pedal (for window blur)', () => {
  const kb = I.createPcKeyboard();
  kb.keydown('KeyA'); kb.keydown('KeyD'); kb.keydown('Space');
  const out = kb.releaseAll();
  assert.deepEqual(out.filter(e => e.type === 'off').map(e => e.midi).sort(), [60, 64]);
  assert.deepEqual(out.filter(e => e.type === 'pedal'), [{ type: 'pedal', down: false }]);
  assert.deepEqual(kb.releaseAll(), []);
  assert.deepEqual(kb.keydown('KeyA'), [{ type: 'on', midi: 60, vel: 100 }]);
});
