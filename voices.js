(function (host) {
  'use strict';
  // Web Audio: one oscillator and gain per sounding key -> limiter -> destination (spec §5).
  const T = (typeof module !== 'undefined' && module.exports) ? require('./tuning53.js') : host.Tuning53;
  const RAMP = 0.01, HARMONICS = 16, MAX_VOICES = 24, NOTE_GAIN = 0.2;

  // Sawtooth Fourier series up to the 16th partial: sine terms (-1)^(n+1) / n.
  function sawtoothCoefficients(h = HARMONICS) {
    const real = new Array(h + 1).fill(0), imag = new Array(h + 1).fill(0);
    for (let n = 1; n <= h; n++) imag[n] = (n % 2 ? 1 : -1) / n;
    return { real, imag };
  }
  // A voice's level at time `at`, from the ramp it is on. AudioParam.value cannot be trusted for this:
  // it reports the last rendered (or intrinsic) value, which is 1 for a gain created a moment ago.
  function levelAt(v, at) {
    if (at >= v.t0 + RAMP) return v.to;
    return v.from + (v.to - v.from) * Math.max(0, at - v.t0) / RAMP;
  }
  function rampTo(v, value, at) {
    const from = levelAt(v, at);
    v.gain.gain.cancelScheduledValues(at);
    v.gain.gain.setValueAtTime(from, at);
    v.gain.gain.linearRampToValueAtTime(value, at + RAMP);
    Object.assign(v, { from, to: value, t0: at });
  }

  function createVoices(context, destination = context.destination) {
    const { real, imag } = sawtoothCoefficients();
    const wave = context.createPeriodicWave(Float32Array.from(real), Float32Array.from(imag));
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    limiter.connect(destination);
    const voices = new Map();   // id -> { osc, gain, s, vel, serial }
    let a4 = 440, volume = 0.8, serial = 0;
    let onEvicted = () => {};
    const level = vel => volume * (vel / 127) * NOTE_GAIN;

    function stop(id) {
      const v = voices.get(id);
      if (!v) return;
      const at = context.currentTime;
      rampTo(v, 0, at);
      v.osc.stop(at + RAMP);
      voices.delete(id);
    }
    function start(id, s, vel) {
      stop(id);
      if (voices.size >= MAX_VOICES) {
        let oldest = null;
        for (const [k, v] of voices) if (oldest === null || v.serial < voices.get(oldest).serial) oldest = k;
        stop(oldest);
        onEvicted(oldest);
      }
      const at = context.currentTime;
      const osc = context.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.value = T.frequency(s, a4);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(level(vel), at + RAMP);
      osc.connect(gain);
      gain.connect(limiter);
      osc.start(at);
      voices.set(id, { osc, gain, s, vel, serial: serial++, from: 0, to: level(vel), t0: at });
    }
    function retune(id, s) {
      const v = voices.get(id);
      if (!v) return;
      v.s = s;
      v.osc.frequency.setValueAtTime(T.frequency(s, a4), context.currentTime);
    }
    function setA4(hz) {
      if (!Number.isFinite(hz) || hz <= 0) return;
      a4 = hz;
      for (const [id, v] of voices) retune(id, v.s);
    }
    function setVolume(x) {
      if (!Number.isFinite(x) || x < 0) return;
      volume = x;
      const at = context.currentTime;
      for (const v of voices.values()) rampTo(v, level(v.vel), at);
    }
    function apply(actions) {
      for (const a of actions) {
        if (a.type === 'start') start(a.midi, a.s, a.vel);
        else if (a.type === 'retune') retune(a.midi, a.s);
        else if (a.type === 'stop') stop(a.midi);
      }
    }
    return {
      start, stop, retune, apply, setA4, setVolume,
      stopAll() { for (const id of [...voices.keys()]) stop(id); },
      count: () => voices.size,
      onEvict(fn) { onEvicted = fn; },
    };
  }

  const api = { RAMP, HARMONICS, MAX_VOICES, NOTE_GAIN, sawtoothCoefficients, createVoices };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else host.Voices = api;
})(globalThis);
