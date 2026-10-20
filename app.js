(function () {
  'use strict';
  // Wiring: input events -> engine -> voices, and redraw the views.
  const { Tuning53: T, Engine, Voices, Input, Views } = window;
  const $ = id => document.getElementById(id);
  const now = () => performance.now() / 1000;

  const engine = Engine.createEngine({ placeMode: $('place-mode').value, fixMode: $('fix-mode').value });
  const pcKeys = Input.createPcKeyboard();
  let context = null, voices = null, tickTimer = null;
  let lastStarted = new Set();
  const history = [];   // roots of recent chords (spec §6 C)
  const App = { engine, voices: null, handle, attachMidiInput };

  function ensureAudio() {
    if (voices) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    context = new AC();
    voices = Voices.createVoices(context);
    voices.setA4(Number($('a4').value) || 440);
    voices.setVolume(Number($('volume').value));
    // Spec Review Focus 5: a voice dropped for the 25th note is no longer sounding for the engine either.
    voices.onEvict(id => { engine.forget(id); render(); });
    App.voices = voices;
    $('audio-status').textContent = '音が出ます。';
    $('start').textContent = '音が出ています';
  }

  // Notes of the current chord: a new chord begins with the first key pressed after any key was let go.
  // Sounding notes outside it are the common tones held over from the previous chord (spec §6 A, B).
  let releasedSince = false;
  function run(actions) {
    for (const a of actions) {
      if (a.type === 'stop') releasedSince = true;
      if (a.type === 'start') {
        if (releasedSince) { lastStarted = new Set(); releasedSince = false; }
        lastStarted.add(a.midi);
      }
    }
    if (voices) voices.apply(actions);
    const c = engine.chord();
    if (c && (!history.length || !T.same(history[history.length - 1], c.root))) {
      history.push(c.root);
      if (history.length > 16) history.shift();
    }
  }

  // Spec Review Focus 3: the engine only learns the time from events, so wake it when a group is due.
  function scheduleTick() {
    clearTimeout(tickTimer);
    const due = engine.pendingUntil();
    if (due === null) return;
    tickTimer = setTimeout(() => { run(engine.tick(Math.max(now(), due))); scheduleTick(); render(); },
      Math.max(0, (due - now()) * 1000) + 1);
  }

  function handle(ev, t = now()) {
    if (!ev) return;
    if (ev.type === 'on') run(engine.noteOn(ev.midi, ev.vel, t));
    else if (ev.type === 'off') { releasedSince = true; run(engine.noteOff(ev.midi, t)); }
    else if (ev.type === 'pedal') run(engine.setPedal(ev.down, t));
    scheduleTick();
    render();
  }

  function render() {
    if (!$('view-table').hidden) Views.table($('view-table').querySelector('.body'), engine, lastStarted);
    if (!$('view-keyboard').hidden) Views.keyboard($('view-keyboard').querySelector('.body'), engine, lastStarted, pcKeys.octave());
    if (!$('view-lattice').hidden) Views.lattice($('view-lattice').querySelector('.body'), engine, history);
    if (!$('view-circle').hidden) Views.circle($('view-circle').querySelector('.body'), engine);
    $('octave').textContent = `C${pcKeys.octave()}〜D♯${pcKeys.octave() + 1}`;
  }

  // ---------------------------------------------------------------- MIDI
  const midiHeld = new Map();   // input id -> { notes: Set of midi notes it holds, pedal: boolean }
  let midiAccess = null, currentInput = null;

  // Also used by the browser checks with a fake input ({ id, onmidimessage }).
  function attachMidiInput(input) {
    if (currentInput && currentInput !== input) {
      currentInput.onmidimessage = null;
      deviceGone(currentInput.id);   // what the old input held would never be let go
    }
    currentInput = input;
    if (!input) return;
    input.onmidimessage = msg => {
      const ev = Input.parseMidi(Array.from(msg.data));
      if (!ev) return;
      ensureAudioIfAllowed();
      const held = midiHeld.get(input.id) || { notes: new Set(), pedal: false };
      midiHeld.set(input.id, held);
      if (ev.type === 'on') held.notes.add(ev.midi);
      if (ev.type === 'off') held.notes.delete(ev.midi);
      if (ev.type === 'pedal') held.pedal = ev.down;
      handle(ev);
    };
  }
  // Spec Review Focus 4: a device that goes away releases every key it was holding, and its pedal.
  function deviceGone(id) {
    const held = midiHeld.get(id);
    if (!held) return;
    midiHeld.delete(id);
    for (const midi of held.notes) handle({ type: 'off', midi });
    if (held.pedal) handle({ type: 'pedal', down: false });
  }
  App.deviceGone = deviceGone;
  // MIDI messages are not a user gesture; sound only once the page has been allowed to start audio.
  function ensureAudioIfAllowed() { if (context && context.state === 'suspended') context.resume(); }

  function listInputs() {
    const select = $('midi-input');
    const chosen = select.value;
    select.innerHTML = '<option value="">（なし）</option>';
    for (const input of midiAccess.inputs.values()) {
      const opt = document.createElement('option');
      opt.value = input.id;
      opt.textContent = input.name || input.id;
      select.appendChild(opt);
    }
    const ids = [...midiAccess.inputs.keys()];
    select.value = ids.includes(chosen) ? chosen : (ids.length === 1 ? ids[0] : '');
    attachMidiInput(select.value ? midiAccess.inputs.get(select.value) : null);
  }
  if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess().then(access => {
      midiAccess = access;
      listInputs();
      access.onstatechange = e => {
        if (e.port && e.port.type === 'input' && e.port.state === 'disconnected') deviceGone(e.port.id);
        listInputs();
      };
      $('midi-input').addEventListener('change', () => attachMidiInput(midiAccess.inputs.get($('midi-input').value) || null));
    }, () => { $('midi-status').textContent = 'MIDI の使用が許可されませんでした。PC のキーボードで弾けます'; });
  } else {
    $('midi-status').textContent = 'この環境では MIDI を使えません。PC のキーボードで弾けます';
  }

  // ---------------------------------------------------------------- PC keyboard
  // Spec Review Focus 2: typing into a field is not playing.
  const typing = el => el && (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) &&
    !(el.tagName === 'INPUT' && ['checkbox', 'range', 'button'].includes(el.type));
  window.addEventListener('keydown', e => {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') e.preventDefault();
    const events = pcKeys.keydown(e.code, e.repeat);
    if (events.length) ensureAudio();
    for (const ev of events) handle(ev);
    if (e.code === 'KeyZ' || e.code === 'KeyX') render();
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space' && !typing(e.target)) e.preventDefault();
    for (const ev of pcKeys.keyup(e.code)) handle(ev);
  });
  // Spec Review Focus 1: keyup never arrives after the window loses focus.
  window.addEventListener('blur', () => { for (const ev of pcKeys.releaseAll()) handle(ev); });

  // ---------------------------------------------------------------- settings
  $('start').addEventListener('click', () => { ensureAudio(); if (context.state === 'suspended') context.resume(); });
  $('place-mode').addEventListener('change', () => engine.setSettings({ placeMode: $('place-mode').value }));
  $('fix-mode').addEventListener('change', () => engine.setSettings({ fixMode: $('fix-mode').value }));
  $('a4').addEventListener('input', () => {
    const hz = Number($('a4').value);
    if (voices && Number.isFinite(hz) && hz > 0) voices.setA4(hz);
  });
  $('volume').addEventListener('input', () => { if (voices) voices.setVolume(Number($('volume').value)); });
  $('reset').addEventListener('click', () => { engine.reset(); });
  for (const [box, view] of [['show-table', 'view-table'], ['show-keyboard', 'view-keyboard'],
    ['show-lattice', 'view-lattice'], ['show-circle', 'view-circle']]) {
    $(box).addEventListener('change', () => { $(view).hidden = !$(box).checked; render(); });
  }

  window.App = App;
  render();
})();
