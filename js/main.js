import { SOURCES, SOURCE_BY_ID } from './sources/index.js';
import { createRuntime } from './sources/runtime.js';
import { loadState, saveState, saveNow, clearState, defaultMapping, PARAMS } from './state.js';
import { SCALES, NOTE_NAMES, noteName } from './scales.js';
import { FAMILIES, programName } from './instruments.js';
import { AudioEngine } from './audio.js';
import { MidiOut } from './midi.js';
import { Engine } from './engine.js';
import { SoundMap } from './map.js';
import { PianoRoll, EventLog } from './viz.js';
import { mountLogo } from './logo.js';
import { presence } from './presence.js';
import { BUILTIN, snapshot, applySnapshot, shareUrl, decode, presetFromHash, localPresets, saveLocalPreset, deleteLocalPreset } from './presets.js';

const state = loadState(SOURCES);
const save = () => saveState(state);

// A shared preset link (#p=…) replaces the current setup once, then the hash is cleared.
let notice = '';
const linked = presetFromHash();
if (linked) {
  try {
    applySnapshot(state, SOURCES, await decode(linked));
    saveNow(state);
    notice = 'Loaded the preset from your link.';
  } catch {
    notice = 'That preset link looks broken — kept your own settings.';
  }
  history.replaceState(null, '', location.pathname + location.search);
}

const audio = new AudioEngine(state);
const midi = new MidiOut(state, SOURCES.map((s) => s.id));
const engine = new Engine({ state, audio, midi });

const $ = (sel) => document.querySelector(sel);
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const select = (choices, value, onchange, attrs = {}) =>
  h('select', { onchange: (e) => onchange(e.target.value), ...attrs }, choices.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));
const slider = (min, max, step, value, oninput, attrs = {}) =>
  h('input', { type: 'range', min, max, step, value, oninput: (e) => oninput(parseFloat(e.target.value)), ...attrs });
const row = (label, ...control) => h('label', { class: 'row' }, h('span', {}, label), ...control);
const chips = (items, isOn, toggle, attrs = {}) =>
  h('div', { class: 'chips', ...attrs }, items.map(([id, label]) => h('button', { class: 'chip' + (isOn(id) ? ' on' : ''), 'aria-pressed': String(isOn(id)), onclick: () => toggle(id) }, label)));

// Brief VHS glitch on interactions (RGB split + tears), never constant.
function glitch() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.body.classList.remove('glitching');
  void document.body.offsetWidth;
  document.body.classList.add('glitching');
  setTimeout(() => document.body.classList.remove('glitching'), 260);
}

// ------------------------------------------------------------- the stage

const roll = new PianoRoll($('#roll'));
const log = new EventLog($('#log'));
const soundMap = new SoundMap($('#map'), SOURCES, { onSelect: (id) => openSource(id) });
const lastHit = new Map();
engine.on((out) => {
  log.add(out);
  soundMap.pulse(out.src, out.ev, out.notes);
  for (const n of out.notes) roll.add(out.src, n);
  if (!out.notes.length) return;
  if (out.src.id !== 'listeners') presence.share(out.notes[0]);
  // the source's tile bounces on its notes (+10% pulse, low cadence)
  const t = performance.now();
  if (t - (lastHit.get(out.src.id) || 0) > 140) {
    lastHit.set(out.src.id, t);
    setTimeout(() => tileOf(out.src.id)?.animate([{ scale: 1.1 }, { scale: 1.04 }, { scale: 1 }], { duration: 200, easing: 'steps(3)' }), out.notes[0].delayMs);
  }
});
document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => soundMap.view(b.dataset.view)));
$('#raw').onclick = () => {
  const show = $('#log').hidden;
  $('#log').hidden = !show;
  $('#raw').classList.toggle('on', show);
  $('#raw').setAttribute('aria-pressed', String(show));
};

// ------------------------------------------------------------------ logo

const logo = mountLogo($('#logo'), { still: matchMedia('(prefers-reduced-motion: reduce)').matches });
if (!logo) {
  $('#logo').hidden = true;
  $('#logo-fallback').src = 'assets/logo.png';
  $('#logo-fallback').hidden = false;
}
const beatVar = () => document.documentElement.style.setProperty('--beat', `${60 / state.global.bpm}s`);
beatVar();

// ------------------------------------------------------- source runtime

let powered = false;
const running = new Map();
const statusOf = new Map();

function startSource(src) {
  if (running.has(src.id)) return;
  const rt = createRuntime(src, state.sources[src.id], {
    emit: (ev) => engine.handle(src, ev),
    setStatus: (kind, msg) => setStatus(src.id, kind, msg),
    getBpm: () => state.global.bpm,
  });
  running.set(src.id, rt);
  try {
    const r = src.start(rt.ctx);
    if (r?.catch) r.catch((e) => setStatus(src.id, 'error', e.message));
  } catch (e) {
    setStatus(src.id, 'error', e.message);
  }
}
function stopSource(id) {
  running.get(id)?.stop();
  running.delete(id);
  setStatus(id, 'idle', '');
}
function restartSource(src) {
  stopSource(src.id);
  if (powered && state.sources[src.id].enabled) startSource(src);
}
function setEnabled(src, on) {
  state.sources[src.id].enabled = on;
  soundMap.setEnabled(src.id, on);
  if (powered) on ? startSource(src) : stopSource(src.id);
  save();
  renderTile(src);
}
function setStatus(id, kind, msg) {
  statusOf.set(id, { kind, msg });
  renderTile(SOURCE_BY_ID[id]);
  const live = document.querySelector(`#sheet [data-status="${id}"]`);
  if (live) live.replaceWith(statusLine(id));
}
const statusLine = (id) => {
  const st = statusOf.get(id) || { kind: 'idle', msg: '' };
  return h('p', { class: 'status-line', 'data-status': id }, h('span', { class: 'status ' + st.kind }), ' ', st.msg || (powered ? '' : 'press PLAY to connect'));
};

$('#power').onclick = async () => {
  powered = !powered;
  glitch();
  logo?.glitch();
  $('#power').textContent = powered ? '■ STOP' : '▶ PLAY';
  $('#power').classList.toggle('on', powered);
  if (powered) {
    await audio.start();
    for (const src of SOURCES) if (state.sources[src.id].enabled) startSource(src);
  } else {
    for (const id of [...running.keys()]) stopSource(id);
    midi.panic();
    await audio.stop();
  }
};

// ----------------------------------------------------------------- tiles

const GROUPS = [...new Set(SOURCES.map((s) => s.group))];
let filter = 'All';

function renderFilters() {
  const items = ['All', 'On', ...GROUPS].map((g) => [g, g === 'Peer to peer' ? 'P2P' : g]);
  $('#filters').replaceChildren(chips(items, (g) => g === filter, (g) => {
    filter = g;
    renderFilters();
    renderTiles();
  }, { role: 'toolbar', 'aria-label': 'Filter sources' }));
}
const visible = (src) => filter === 'All' || (filter === 'On' ? state.sources[src.id].enabled : src.group === filter);
const tileOf = (id) => document.querySelector(`.tile[data-id="${id}"]`);

function renderTiles() {
  const list = SOURCES.filter(visible);
  $('#tiles').replaceChildren(
    ...list.map((src, i) => {
      const el = h('div', { class: 'tile', 'data-id': src.id, style: `--c:${src.color};--fg:${src.ink};--sh:${src.shadow};--i:${i}` });
      fillTile(el, src);
      return el;
    }),
    list.length ? null : h('p', { class: 'empty' }, filter === 'On' ? 'Nothing is on yet — tap a source to switch it on.' : 'No sources here.'),
  );
}
function fillTile(el, src) {
  const cfg = state.sources[src.id];
  const st = statusOf.get(src.id) || { kind: 'idle' };
  const rate = engine.eventsPerMinute(src.id);
  el.classList.toggle('on', cfg.enabled);
  el.replaceChildren(
    h('button', { class: 'tile-main', 'aria-pressed': String(cfg.enabled), title: cfg.enabled ? 'Switch off' : 'Switch on', onclick: () => setEnabled(src, !cfg.enabled) },
      h('span', { class: 'sticker' }),
      h('span', { class: 'tile-name' }, src.short || src.name),
      h('span', { class: 'tile-sub' }, h('span', { class: 'status ' + st.kind }), cfg.enabled ? (rate ? `${rate}/min` : st.kind === 'error' ? 'unreachable' : powered ? 'listening…' : 'on') : 'off'),
      h('span', { class: 'meter', style: `--m:${Math.min(1, rate / 120)}` })),
    h('button', { class: 'tile-more', 'aria-label': `Settings for ${src.name}`, onclick: () => openSource(src.id) }, '⋯'),
  );
}
function renderTile(src) {
  const el = src && tileOf(src.id);
  if (el) fillTile(el, src);
}
setInterval(() => SOURCES.forEach((s) => state.sources[s.id].enabled && renderTile(s)), 2000);

// ----------------------------------------------------------------- sheet

const sheet = $('#sheet');
function openSheet(title, color, shadow, ...content) {
  glitch();
  sheet.style.setProperty('--c', color || 'var(--ye)');
  sheet.style.setProperty('--sh', shadow || 'var(--pk)');
  sheet.replaceChildren(
    h('header', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'close', 'aria-label': 'Close', onclick: () => sheet.close() }, '✕')),
    h('div', { class: 'sheet-body' }, ...content.filter(Boolean)),
  );
  if (!sheet.open) sheet.showModal();
}
sheet.addEventListener('click', (e) => e.target === sheet && sheet.close());

function openSource(id) {
  const src = SOURCE_BY_ID[id];
  const cfg = state.sources[id];
  const re = () => openSource(id);
  const fieldChoices = [['none', '— nothing —'], ...Object.entries(src.allFields).map(([k, f]) => [k, f.label])];
  const famOn = (f) => cfg.families === 'all' || cfg.families.includes(f);
  openSheet(src.name, src.color, src.shadow,
    statusLine(id),
    h('p', { class: 'info' }, src.info, ' ', src.link ? h('a', { href: src.link, target: '_blank', rel: 'noopener' }, 'about the data ↗') : null),
    h('button', { class: 'pop listen' + (cfg.enabled ? ' on' : ''), onclick: () => { setEnabled(src, !cfg.enabled); re(); } }, cfg.enabled ? '■ LISTENING' : '▶ LISTEN'),
    ...Object.entries(src.options || {}).map(([k, o]) =>
      row(o.label, o.type === 'select'
        ? select(o.choices, cfg.options[k], (v) => { cfg.options[k] = v; save(); restartSource(src); })
        : h('input', { type: 'text', value: cfg.options[k], onchange: (e) => { cfg.options[k] = e.target.value.trim(); save(); restartSource(src); } }))),
    h('h3', {}, 'Instruments'),
    h('p', { class: 'hint' }, 'Each station, ship, author… gets its own instrument from these, always the same one.'),
    chips([['all', 'ALL 128'], ...FAMILIES.map((f) => [f.id, f.name])], (f) => (f === 'all' ? cfg.families === 'all' : cfg.families !== 'all' && famOn(f)), (f) => {
      if (f === 'all') cfg.families = cfg.families === 'all' ? defaultMapping(src).families : 'all';
      else {
        const set = new Set(cfg.families === 'all' ? [] : cfg.families);
        set.has(f) ? set.delete(f) : set.add(f);
        cfg.families = set.size ? [...set] : [f];
      }
      save();
      re();
    }),
    h('h3', {}, 'Range'),
    chips([['low', 'Low'], ['mid', 'Mid'], ['high', 'High'], ['wide', 'Wide']], (r) => cfg.register === r, (r) => { cfg.register = r; save(); re(); }),
    row('Volume', slider(0, 1.5, 0.01, cfg.volume, (v) => { cfg.volume = v; save(); })),
    row('Busy', slider(0.5, 20, 0.5, cfg.rate, (v) => { cfg.rate = v; save(); }), h('small', {}, 'max notes per second')),
    h('details', { class: 'more' },
      h('summary', {}, 'Which data drives what'),
      ...Object.entries(PARAMS).map(([p, label]) => row(label, select(fieldChoices, cfg.map[p], (v) => { cfg.map[p] = v; save(); }))),
      h('button', { onclick: () => { state.sources[id] = { ...defaultMapping(src), enabled: cfg.enabled, options: cfg.options }; save(); re(); } }, 'Reset this source')),
  );
}

// ------------------------------------------------------------- settings

function openSettings(open = 'music', message = notice) {
  notice = '';
  const g = state.global;
  const set = (k, after) => (v) => { g[k] = v; audio.applyGlobals(); after?.(); save(); };
  const section = (id, title, ...content) => h('details', { class: 'more', open: id === open }, h('summary', {}, title), ...content);
  const load = (snap) => { applySnapshot(state, SOURCES, snap); saveNow(state); location.reload(); };
  const msg = h('p', { class: 'msg', role: 'status' }, message || '');
  const name = h('input', { type: 'text', placeholder: 'name this setup', maxlength: 40 });
  const mine = Object.entries(localPresets()).sort((a, b) => b[1].saved - a[1].saved);
  openSheet('Settings', 'var(--ye)', 'var(--pk)',
    msg,
    section('music', 'Music',
      row('Key', select(NOTE_NAMES.map((n, i) => [i, n]), g.root, (v) => set('root')(parseInt(v)))),
      row('Scale', select(Object.entries(SCALES).map(([id, s]) => [id, s.name]), g.scale, set('scale'))),
      row('Tempo', slider(50, 180, 1, g.bpm, set('bpm', beatVar)), h('output', {}, g.bpm)),
      row('Grid', select([['off', 'free'], ['1/8', '1/8'], ['1/16', '1/16'], ['1/32', '1/32']], g.quantize, set('quantize')))),
    section('sound', 'Sound',
      row('Volume', slider(0, 1.2, 0.01, g.master, set('master'))),
      row('Reverb', slider(0, 1.5, 0.01, g.reverb, set('reverb'))),
      row('Echo', slider(0, 0.8, 0.01, g.delayMix, set('delayMix'))),
      row('Brightness', slider(0, 1, 0.01, g.tone, set('tone')))),
    section('mixer', 'Instrument mixer',
      h('p', { class: 'hint' }, 'Level per instrument family, for every source. Tap a name to hear it.'),
      h('div', { class: 'mixer' }, FAMILIES.map((f) => {
        const s = g.families[f.id];
        return h('div', { class: 'fader' },
          h('button', { class: 'fam', onclick: () => audio.audition(f.id) }, f.name),
          slider(0, 1.2, 0.01, s.level, (v) => { s.level = v; audio.applyGlobals(); save(); }),
          h('label', { class: 'mute' }, h('input', { type: 'checkbox', checked: s.mute, onchange: (e) => { s.mute = e.target.checked; audio.applyGlobals(); save(); } }), 'mute'));
      }))),
    section('presets', 'Presets',
      h('div', { class: 'row' }, h('button', {
        class: 'pop',
        onclick: async () => {
          const url = await shareUrl(snapshot(state, SOURCES));
          try {
            if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'datamusak preset', url });
            else await navigator.clipboard.writeText(url);
            msg.textContent = 'Link copied — anyone opening it gets this exact setup.';
          } catch {
            msg.textContent = url;
          }
        },
      }, 'Copy share link')),
      h('div', { class: 'row' }, name, h('button', { class: 'save', onclick: () => {
        const n = name.value.trim() || `Setup ${new Date().toLocaleString('en-GB')}`;
        saveLocalPreset(n, snapshot(state, SOURCES));
        openSettings('presets', `Saved “${n}” in this browser.`);
      } }, 'Save')),
      ...mine.map(([n, p]) => h('div', { class: 'preset' },
        h('button', { class: 'preset-load', onclick: () => load(p.snap) }, n),
        h('button', { class: 'x', 'aria-label': `Delete ${n}`, onclick: () => { deleteLocalPreset(n); openSettings('presets'); } }, '✕'))),
      ...BUILTIN.map((p) => h('div', { class: 'preset' }, h('button', { class: 'preset-load', onclick: () => load(p.snap) }, p.name), h('small', {}, p.desc)))),
    section('midi', 'MIDI out',
      h('p', { class: 'hint' }, 'Play your own synths or a DAW (Chrome/Edge). Each source gets a channel, drums go to 10.'),
      midi.supported
        ? midi.access
          ? row('Output', select([['', '— none —'], ...midi.outputs().map((o) => [o.id, o.name])], g.midiOut, (v) => { g.midiOut = v; save(); }))
          : h('button', { onclick: () => midi.enable().then(() => openSettings('midi')).catch((e) => (msg.textContent = 'MIDI unavailable: ' + e.message)) }, 'Enable MIDI')
        : h('p', {}, 'This browser has no Web MIDI.'),
      row('Built-in sound', h('input', { type: 'checkbox', checked: g.internal, onchange: (e) => set('internal')(e.target.checked) }))),
    section('about', 'About',
      h('p', {}, 'datamusak turns live open data into music: every data point becomes a note. The same data always makes the same sound — each station, ship or author has its own instrument and its own place in the scale, and its values walk the melody.'),
      h('p', {}, 'Everything runs in your browser, straight from public APIs, MQTT brokers, Nostr relays and peer-to-peer rooms. “Online” joins a peer-to-peer room to count listeners and share notes; peers can see each other’s IP address.'),
      h('p', {}, h('a', { href: 'https://github.com/sloev/datamusak', target: '_blank', rel: 'noopener' }, 'Source code'), ' · ', h('a', { href: 'https://github.com/sloev/datamusak/issues/new?template=new-data-source.yml', target: '_blank', rel: 'noopener' }, 'Suggest a data source')),
      h('button', { onclick: () => { if (confirm('Reset everything?')) { clearState(); location.reload(); } } }, 'Reset everything')),
  );
}
$('#open-settings').onclick = () => openSettings();
midi.onChange = () => sheet.open && openSettings('midi');

// ---------------------------------------------------------------- online

function renderOnline() {
  const b = $('#online');
  b.classList.toggle('on', presence.connected);
  b.textContent = presence.connected ? `● ${presence.peers + 1} online` : '○ offline';
}
presence.on(renderOnline);
$('#online').onclick = async () => {
  state.global.online = !presence.connected;
  save();
  if (state.global.online) await presence.join();
  else presence.leave();
  renderOnline();
};
if (state.global.online) setTimeout(() => presence.join().then(renderOnline).catch(renderOnline), 1500);

// ------------------------------------------------------------------ boot

for (const src of SOURCES) soundMap.setEnabled(src.id, state.sources[src.id].enabled);
renderFilters();
renderTiles();
if (notice) openSettings('presets');

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
// Handy for debugging in the console (and used by the end-to-end tests).
window.datamusak = { state, engine, audio, midi, map: soundMap.map, sources: SOURCES, programName, noteName };
