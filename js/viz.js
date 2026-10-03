// Live visualizers: a scrolling piano roll of played notes and a raw data → MIDI log.
import { noteName } from './scales.js';

const SPAN_MS = 10000;
const LOW = 24;
const HIGH = 108;

export class PianoRoll {
  constructor(canvas) {
    this.canvas = canvas;
    this.notes = [];
    this.draw = this.draw.bind(this);
    requestAnimationFrame(this.draw);
  }

  add(src, n) {
    const start = performance.now() + n.delayMs;
    this.notes.push({ color: src.color, note: n.note, vel: n.velocity, start, end: start + n.duration * 1000 });
    if (this.notes.length > 1500) this.notes.splice(0, 300);
  }

  draw() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const now = performance.now();
    const playX = w * 0.85;
    const x = (t) => playX - ((now - t) / SPAN_MS) * playX;
    const rowH = h / (HIGH - LOW);
    // octave guides
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let n = LOW; n <= HIGH; n += 12) g.fillRect(0, h - (n - LOW) * rowH, w, 1);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.font = '10px ui-monospace, monospace';
    for (let n = 36; n <= HIGH; n += 12) g.fillText(noteName(n), 4, h - (n - LOW) * rowH - 2);
    // notes
    this.notes = this.notes.filter((n) => n.end > now - SPAN_MS);
    for (const n of this.notes) {
      const x0 = x(n.start);
      const x1 = Math.max(x0 + 2, x(Math.min(n.end, now + SPAN_MS)));
      const y = h - (Math.min(HIGH, Math.max(LOW, n.note)) - LOW) * rowH;
      const active = n.start <= now && n.end >= now;
      g.globalAlpha = 0.25 + (n.vel / 127) * 0.75;
      g.fillStyle = n.color;
      g.fillRect(x0, y - rowH, x1 - x0, Math.max(2, rowH));
      if (active) {
        g.globalAlpha = 1;
        g.fillRect(playX - 3, y - rowH - 1, 6, Math.max(4, rowH + 2));
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillRect(playX, 0, 1, h);
    requestAnimationFrame(this.draw);
  }
}

export class EventLog {
  constructor(el) {
    this.el = el;
    this.pending = [];
    this.paused = false;
    this.onlyPlayed = false;
    this.flush = this.flush.bind(this);
    requestAnimationFrame(this.flush);
  }

  add({ src, values, ev, notes }) {
    if (this.paused || (this.onlyPlayed && !notes.length)) return;
    this.pending.push({ src, values, ev, notes, t: new Date() });
    if (this.pending.length > 40) this.pending.splice(0, this.pending.length - 40);
  }

  flush() {
    if (this.pending.length) {
      const frag = document.createDocumentFragment();
      for (const e of this.pending) frag.prepend(this.row(e));
      this.el.prepend(frag);
      this.pending = [];
      while (this.el.childElementCount > 150) this.el.lastElementChild.remove();
    }
    requestAnimationFrame(this.flush);
  }

  row({ src, values, ev, notes, t }) {
    const div = document.createElement('div');
    div.className = 'log-row' + (notes.length ? ' played' : '');
    const raw = Object.entries(values)
      .filter(([k, v]) => typeof v === 'number' && k !== 'lat' && k !== 'lon')
      .map(([k, v]) => `${k}=${fmt(v)}`)
      .join(' ');
    const midi = notes.length
      ? notes.map((n) => `${noteName(n.note)} v${n.velocity} ${n.duration.toFixed(2)}s →${n.slot + 1}`).join(', ')
      : '·';
    div.innerHTML = `<span class="t">${t.toLocaleTimeString('en-GB')}</span><span class="dot" style="background:${src.color}"></span><span class="src"></span><span class="raw"></span><span class="midi"></span>`;
    div.querySelector('.src').textContent = ev.label || src.name;
    div.querySelector('.raw').textContent = raw;
    div.querySelector('.midi').textContent = midi;
    return div;
  }
}

function fmt(v) {
  const a = Math.abs(v);
  if (a >= 1000) return Math.round(v).toString();
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
