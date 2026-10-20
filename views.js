(function (host) {
  'use strict';
  // The four views of spec §6. Each function redraws its container from the engine's state.
  // Only internal data (note names and numbers) is drawn, so building markup as strings is safe here.
  const T = host.Tuning53;
  const STEP_CENTS = 1200 / T.N;
  const KEY_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const keyName = midi => KEY_NAMES[T.mod(midi, 12)] + (Math.floor(midi / 12) - 1);
  const dev12 = n => n.s * STEP_CENTS - 100 * (n.midi - 60);
  const signed = (x, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);

  function noteHtml(p) {
    const n = T.name(p);
    return `${n.letter}${n.acc}<sup>${n.index}</sup>${n.sept ? '(7)' : ''}`;
  }
  function noteSvg(p, x, y, size, anchor = 'middle', fill = 'currentColor') {
    const n = T.name(p);
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" text-anchor="${anchor}" fill="${fill}">` +
      `${n.letter}${n.acc}<tspan font-size="${(size * 0.65).toFixed(1)}" dy="${(-size * 0.4).toFixed(1)}">${n.index}</tspan>` +
      `<tspan dy="${(size * 0.4).toFixed(1)}">${n.sept ? '(7)' : ''}</tspan></text>`;
  }
  const sorted = engine => engine.sounding().sort((x, y) => x.midi - y.midi);
  const isCommon = (n, lastStarted) => !lastStarted.has(n.midi);

  // A: one row per sounding note.
  function table(container, engine, lastStarted) {
    const notes = sorted(engine);
    const c = engine.chord();
    let head = '和音：—';
    if (c) {
      const d = T.deviation(c.root);
      head = `和音：${noteHtml(c.root)} の${c.chord.name}　根音の 12 平均律からのずれ：${signed(d / STEP_CENTS)} 段（${signed(d)}¢）`;
    }
    const rows = notes.map(n => {
      const role = c ? T.ROLE[T.mod(T.pc(n.p) - T.pc(c.root), 12)] || '' : '';
      const flags = [n.held ? '' : 'ペダル', isCommon(n, lastStarted) ? '<span class="common">共通音</span>' : '']
        .filter(Boolean).join('・');
      return `<tr><td>${keyName(n.midi)}</td><td>${noteHtml(n.p)}</td><td>${n.s}</td>` +
        `<td>${signed(dev12(n))}¢</td><td>${role}</td><td>${flags}</td></tr>`;
    }).join('');
    container.innerHTML = `<p class="chord-line">${head}</p>` +
      `<table><thead><tr><th>鍵</th><th>音名</th><th>段</th><th>12 平均律から</th><th>役割</th><th></th></tr></thead>` +
      `<tbody>${rows || '<tr><td colspan="6" class="status">（鳴っている音はありません）</td></tr>'}</tbody></table>`;
  }

  // B: keyboard of at least two octaves around the sounding notes and the PC keyboard range.
  const BLACK = new Set([1, 3, 6, 8, 10]);
  function keyboard(container, engine, lastStarted, pcOctave) {
    const notes = engine.sounding();
    const byMidi = new Map(notes.map(n => [n.midi, n]));
    const pcLow = 12 * (pcOctave + 1), pcHigh = pcLow + 15;
    const midis = [pcLow, pcHigh, ...notes.map(n => n.midi)];
    let low = 12 * Math.floor(Math.min(...midis) / 12);
    let high = 12 * Math.ceil((Math.max(...midis) + 1) / 12) - 1;
    if (high - low < 23) high = low + 23;
    const whites = [];
    for (let m = low; m <= high; m++) if (!BLACK.has(T.mod(m, 12))) whites.push(m);
    const W = 26, H = 120, top = 26, BW = 16, BH = 74;
    const xOfWhite = new Map(whites.map((m, i) => [m, i * W]));
    const width = whites.length * W;
    let svg = '';
    const label = (n, x, y) => noteSvg(n.p, x, y, 10) +
      `<text x="${x.toFixed(1)}" y="${(y + 11).toFixed(1)}" font-size="8" text-anchor="middle" fill="currentColor">${signed(dev12(n), 0)}</text>`;
    // PC keyboard range
    const pcX0 = xOfWhite.has(pcLow) ? xOfWhite.get(pcLow) : 0;
    const lastWhite = whites.filter(m => m <= pcHigh).pop();
    const pcX1 = (xOfWhite.has(lastWhite) ? xOfWhite.get(lastWhite) : 0) + W;
    svg += `<rect x="${pcX0}" y="6" width="${pcX1 - pcX0}" height="8" rx="3" fill="var(--accent)" opacity="0.5"/>` +
      `<text x="${pcX0 + 2}" y="22" font-size="9" fill="currentColor">PC のキーボード</text>`;
    for (const m of whites) {
      const n = byMidi.get(m), x = xOfWhite.get(m);
      const fill = n ? (n.held ? 'var(--held)' : 'var(--sustain)') : 'var(--bg)';
      const stroke = n && isCommon(n, lastStarted) ? 'var(--common)' : 'var(--line)';
      svg += `<rect x="${x + 0.5}" y="${top}" width="${W - 1}" height="${H}" fill="${fill}" stroke="${stroke}" stroke-width="${n && isCommon(n, lastStarted) ? 2.5 : 1}"/>`;
      if (T.mod(m, 12) === 0) svg += `<text x="${x + W / 2}" y="${top + H + 12}" font-size="9" text-anchor="middle" fill="currentColor">${keyName(m)}</text>`;
      if (n) svg += label(n, x + W / 2, top + H - 22);
    }
    for (let m = low; m <= high; m++) {
      if (!BLACK.has(T.mod(m, 12))) continue;
      const n = byMidi.get(m), x = xOfWhite.get(m - 1) + W - BW / 2;
      const fill = n ? (n.held ? 'var(--held)' : 'var(--sustain)') : 'var(--fg)';
      const common = n && isCommon(n, lastStarted);
      svg += `<rect x="${x}" y="${top}" width="${BW}" height="${BH}" fill="${fill}" stroke="${common ? 'var(--common)' : 'var(--fg)'}" stroke-width="${common ? 2.5 : 1}"/>`;
      if (n) svg += label(n, x + BW / 2, top + BH + 14);
    }
    container.innerHTML = `<svg viewBox="0 0 ${width} ${top + H + 18}" width="${width}" role="img" aria-label="鍵盤">${svg}</svg>` +
      '<p class="help">色＝押している鍵（薄い色はペダルで残っている音）、赤い枠＝共通音（前の和音から鳴っている音）。</p>';
  }

  // C: lattice (fifths across, major thirds up) with the sounding points and the path of chord roots.
  function lattice(container, engine, history) {
    const notes = engine.sounding();
    const pts = [...notes.map(n => n.p), ...history];
    const ca = pts.length ? Math.round(pts.reduce((s, p) => s + p.a, 0) / pts.length) : 0;
    const cb = pts.length ? Math.round(pts.reduce((s, p) => s + p.b, 0) / pts.length) : 0;
    const A = 7, B = 3, cell = 52, pad = 30;
    const w = (2 * A) * cell + 2 * pad, h = (2 * B) * cell + 2 * pad;
    const xy = p => [pad + (p.a - ca + A) * cell + p.c * 10, pad + (cb - p.b + B) * cell - p.c * 10];
    let svg = '';
    for (let a = ca - A; a <= ca + A; a++) {
      for (let b = cb - B; b <= cb + B; b++) {
        const [x, y] = xy(T.pt(a, b));
        svg += `<circle cx="${x}" cy="${y}" r="2.5" fill="var(--grid)"/>`;
        svg += noteSvg(T.pt(a, b), x, y + 14, 9, 'middle', 'var(--muted)');
      }
    }
    if (history.length > 1) {
      const line = history.map(p => xy(p).join(',')).join(' ');
      svg += `<polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 4" opacity="0.8"/>`;
    }
    history.forEach((p, i) => {
      const [x, y] = xy(p);
      svg += `<circle cx="${x}" cy="${y}" r="${i === history.length - 1 ? 7 : 4}" fill="none" stroke="var(--accent)" stroke-width="1.5"/>`;
    });
    for (const n of notes) {
      const [x, y] = xy(n.p);
      svg += `<circle cx="${x}" cy="${y}" r="6" fill="var(--held)" stroke="var(--fg)"/>`;
      svg += noteSvg(n.p, x, y - 10, 13, 'middle', 'currentColor');
    }
    container.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" role="img" aria-label="格子">${svg}</svg>` +
      '<p class="help">横＝五度、縦＝長三度（上へ 5/4）。黄色＝鳴っている音、青い丸と点線＝和音の根音の道（最近 16 個、いちばん大きい丸がいま）。7 倍音の音は右上に少しずらして描く。</p>';
  }

  // D: 53 steps on a circle; sounding steps marked; the twelve 12-TET positions drawn lightly.
  function circle(container, engine) {
    const notes = engine.sounding();
    const size = 340, cx = size / 2, cy = size / 2, r = 120;
    const pos = (frac, rr) => {
      const ang = -Math.PI / 2 + 2 * Math.PI * frac;
      return [cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)];
    };
    let svg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)"/>`;
    for (let k = 0; k < 12; k++) {
      const [x1, y1] = pos(k / 12, r - 10), [x2, y2] = pos(k / 12, r + 10), [tx, ty] = pos(k / 12, r - 22);
      svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--muted)" stroke-width="1" opacity="0.6"/>`;
      svg += `<text x="${tx}" y="${ty + 3}" font-size="9" text-anchor="middle" fill="var(--muted)">${KEY_NAMES[k]}</text>`;
    }
    for (let s = 0; s < T.N; s++) {
      const [x, y] = pos(s / T.N, r);
      svg += `<circle cx="${x}" cy="${y}" r="1.8" fill="var(--muted)"/>`;
    }
    const seen = new Map();
    for (const n of notes) {
      const s = T.mod(n.s, T.N);
      if (seen.has(s)) continue;
      seen.set(s, n);
      const [x, y] = pos(s / T.N, r), [lx, ly] = pos(s / T.N, r + 26);
      svg += `<circle cx="${x}" cy="${y}" r="6" fill="var(--held)" stroke="var(--fg)"/>`;
      svg += noteSvg(n.p, lx, ly + 4, 12, 'middle', 'currentColor');
      const [sx, sy] = pos(s / T.N, r + 44);
      svg += `<text x="${sx}" y="${sy + 4}" font-size="9" text-anchor="middle" fill="var(--muted)">${s}</text>`;
    }
    container.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" role="img" aria-label="53 段の円">${svg}</svg>` +
      '<p class="help">小さな点＝53 段、目盛り＝12 平均律の 12 の位置、黄色＝鳴っている段（数は段）。</p>';
  }

  host.Views = { table, keyboard, lattice, circle, keyName };
})(globalThis);
