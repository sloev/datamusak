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
import { Recorder, MAX_SECONDS, listRecordings, deleteRecording, fileName } from './recorder.js';
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
const recorder = new Recorder({ audio, midi, state });

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
const soundMap = new SoundMap($('#map'), SOURCES, {
  onSelect: (id) => openSource(id),
  onViewChange: (v) => document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v)),
});
const lastHit = new Map();
engine.on((out) => {
  log.add(out);
  soundMap.pulse(out.src, out.ev, out.notes);
  for (const n of out.notes) {
    roll.add(out.src, n);
    recorder.add(n);
  }
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

// The logo is a looping video (pre-rendered from the WebGL shader in scripts/logo-shader.js), so it moves on
// every device. If autoplay was refused (e.g. battery saver), start it on the first tap.
const logo = $('#logo');
const kick = () => logo.paused && logo.play().catch(() => {});
logo.play?.().catch(() => {});
addEventListener('pointerdown', kick, { once: true });
document.addEventListener('visibilitychange', () => !document.hidden && kick());
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
  // switching a source on means "let me hear it", so it also starts playback
  if (on && !powered) $('#power').onclick();
  else if (powered) on ? startSource(src) : stopSource(src.id);
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
  const idle = !state.sources[id].enabled ? 'off' : powered ? 'connecting…' : 'on — press PLAY to connect';
  return h('p', { class: 'status-line', 'data-status': id }, h('span', { class: 'status ' + st.kind }), ' ', st.kind === 'idle' ? idle : st.msg || (st.kind === 'ok' ? 'connected' : st.kind));
};

// ● REC: up to a minute of sound + a MIDI file of the same notes
function renderRec() {
  const b = $('#rec');
  b.classList.toggle('on', recorder.recording);
  const left = Math.max(0, Math.ceil(MAX_SECONDS - recorder.elapsed));
  b.textContent = recorder.recording ? `■ 0:${String(left).padStart(2, '0')}` : '● REC';
  b.setAttribute('aria-pressed', String(recorder.recording));
}
recorder.onChange = renderRec;
// also when the minute runs out by itself
recorder.onSaved = () => openSettings('recordings', 'Saved — play it, download the sound or the MIDI file, or share it.');
$('#rec').onclick = async () => {
  glitch();
  if (recorder.recording) return recorder.stop();
  if (!powered) await $('#power').onclick();
  recorder.start();
};
const stopRecording = () => recorder.stop();

$('#power').onclick = async () => {
  powered = !powered;
  glitch();
  $('#power').textContent = powered ? '■ STOP' : '▶ PLAY';
  $('#power').classList.toggle('on', powered);
  $('#power').classList.remove('nudge');
  if (powered) {
    await audio.start();
    if (!powered) return; // stopped again while the audio engine was starting
    for (const src of SOURCES) if (state.sources[src.id].enabled) startSource(src);
  } else {
    await stopRecording();
    for (const id of [...running.keys()]) stopSource(id);
    midi.panic();
    await audio.stop();
  }
};

// Space plays / stops, unless typing or on a focused control (where Space already means "press")
addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || e.target.closest?.('input, select, textarea, button, a, [contenteditable], dialog[open]')) return;
  e.preventDefault();
  $('#power').onclick();
});

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

// Weekly measured reachability + busyness (stats/sources.json, see scripts/source-stats.mjs).
let weekly = {};
fetch('stats/sources.json')
  .then((r) => r.json())
  .then((s) => {
    weekly = s.sources || {};
    renderTiles();
  })
  .catch(() => {});

// Reachable first, then busiest. What this browser sees right now beats last week's measurement.
function rank(src) {
  const live = statusOf.get(src.id);
  const w = weekly[src.id];
  const reachable = live?.kind === 'error' ? 0 : live?.kind === 'ok' ? 1 : w ? (w.status === 'ok' ? 1 : w.status === 'error' ? 0 : 0.5) : 0.5;
  const epm = Math.max(engine.eventsPerMinute(src.id), w?.eventsPerMin || 0);
  return [reachable, epm];
}
function sorted(list) {
  const r = new Map(list.map((s) => [s.id, rank(s)]));
  // your own broker and the test signal aren't "data from the world": always last
  const last = (src) => (src.group === 'Custom' ? 1 : 0);
  return [...list].sort((a, b) => last(a) - last(b) || r.get(b.id)[0] - r.get(a.id)[0] || r.get(b.id)[1] - r.get(a.id)[1]);
}
const perMin = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n < 10 ? String(n) : String(Math.round(n)));
const offLabel = (src) => {
  const w = weekly[src.id];
  if (!w) return 'off';
  if (w.status === 'error') return 'was down';
  return w.eventsPerMin ? `~${perMin(w.eventsPerMin)}/min` : 'off';
};

function renderTiles() {
  const list = sorted(SOURCES.filter(visible));
  $('#tiles').replaceChildren(
    ...list.map((src, i) => {
      const el = h('div', { class: 'tile', 'data-id': src.id, style: `--c:${src.color};--fg:${src.ink};--sh:${src.shadow};--i:${i}` });
      fillTile(el, src);
      return el;
    }),
    ...(list.length ? [] : [h('p', { class: 'empty' }, filter === 'On' ? 'Nothing is on yet — tap a source to switch it on.' : 'No sources here.')]),
  );
}
function fillTile(el, src) {
  const cfg = state.sources[src.id];
  const st = statusOf.get(src.id) || { kind: 'idle' };
  const rate = engine.eventsPerMinute(src.id);
  el.classList.toggle('on', cfg.enabled);
  el.replaceChildren(
    h('button', { class: 'tile-main', 'aria-pressed': String(cfg.enabled), title: `${src.name} — ${cfg.enabled ? 'tap to switch off' : 'tap to listen'}`, onclick: () => setEnabled(src, !cfg.enabled) },
      h('span', { class: 'sticker' }),
      h('span', { class: 'tile-name' + fit(src.short || src.name) }, src.short || src.name),
      h('span', { class: 'tile-sub' }, h('span', { class: 'status ' + st.kind }), cfg.enabled ? (rate ? `${perMin(rate)}/min` : st.kind === 'error' ? 'unreachable' : powered ? 'listening…' : 'on') : offLabel(src)),
      h('span', { class: 'meter', style: `--m:${Math.min(1, rate / 120)}` })),
    h('button', { class: 'tile-more', 'aria-label': `Settings for ${src.name}`, onclick: () => openSource(src.id) }, '⋯'),
  );
}
// long single words ("EARTHQUAKES") get a smaller size instead of breaking mid-word
const fit = (name) => {
  const longest = Math.max(...name.split(/\s+/).map((w) => w.length));
  return longest > 10 ? ' longer' : longest > 8 ? ' long' : '';
};
function renderTile(src) {
  const el = src && tileOf(src.id);
  if (el) fillTile(el, src);
}
setInterval(() => SOURCES.forEach((s) => state.sources[s.id].enabled && renderTile(s)), 2000);

// ----------------------------------------------------------------- sheet

const sheet = $('#sheet');
function openSheet(title, color, shadow, ...content) {
  if (!sheet.open) glitch(); // switching tabs inside an open sheet stays calm
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
    h('p', { class: 'hint' }, src.identity ? `Each ${src.identity} always gets its own instrument from these.` : 'One voice, playing an instrument from these.'),
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

const TABS = [['music', 'Music'], ['sound', 'Sound'], ['mixer', 'Mixer'], ['presets', 'Presets'], ['recordings', 'Recordings'], ['midi', 'MIDI'], ['about', 'About']];
let settingsTab = 'music';

async function share(title, { url, files }) {
  try {
    if (files && navigator.canShare?.({ files })) return await navigator.share({ title, files });
    if (url && navigator.share && matchMedia('(pointer: coarse)').matches) return await navigator.share({ title, url });
    if (url) {
      await navigator.clipboard.writeText(url);
      return 'copied';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  return 'unsupported';
}
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
}

function openSettings(tab = settingsTab, message = notice) {
  notice = '';
  settingsTab = tab;
  const g = state.global;
  const set = (k, after) => (v) => { g[k] = v; audio.applyGlobals(); after?.(); save(); };
  const load = (snap) => { applySnapshot(state, SOURCES, snap); saveNow(state); location.reload(); };
  const msg = h('p', { class: 'msg', role: 'status' }, message || '');
  const sharePreset = async (snap, name) => {
    const url = await shareUrl(snap);
    const r = await share(`datamusak · ${name}`, { url });
    msg.textContent = r === 'copied' ? `Link to “${name}” copied — anyone opening it gets that exact setup.` : r === 'unsupported' ? url : '';
  };

  // always visible: save the current setup
  const name = h('input', { type: 'text', placeholder: 'name this setup', maxlength: 40, 'aria-label': 'Preset name' });
  const saveBar = h('div', { class: 'save-bar' }, name,
    h('button', { class: 'pop save', onclick: () => {
      const n = name.value.trim() || `Setup ${new Date().toLocaleString('en-GB')}`;
      saveLocalPreset(n, snapshot(state, SOURCES));
      openSettings('presets', `Saved “${n}”.`);
    } }, 'Save'),
    h('button', { class: 'share-now', title: 'Share the current setup as a link', onclick: () => sharePreset(snapshot(state, SOURCES), 'this setup') }, 'Share'));

  const tabs = h('nav', { class: 'tabs', role: 'tablist' }, TABS.map(([id, label]) =>
    h('button', { role: 'tab', class: 'chip' + (id === tab ? ' on' : ''), 'aria-selected': String(id === tab), onclick: () => openSettings(id) }, label)));

  let tempoOut;
  const panels = {
    music: () => [
      row('Key', select(NOTE_NAMES.map((n, i) => [i, n]), g.root, (v) => set('root')(parseInt(v)))),
      row('Scale', select(Object.entries(SCALES).map(([id, sc]) => [id, sc.name]), g.scale, set('scale'))),
      row('Tempo', slider(50, 180, 1, g.bpm, (v) => { set('bpm', beatVar)(v); tempoOut.textContent = v; }), (tempoOut = h('output', {}, g.bpm))),
      row('Grid', select([['off', 'free'], ['1/8', '1/8'], ['1/16', '1/16'], ['1/32', '1/32']], g.quantize, set('quantize'))),
    ],
    sound: () => [
      row('Volume', slider(0, 1.2, 0.01, g.master, set('master'))),
      row('Reverb', slider(0, 1.5, 0.01, g.reverb, set('reverb'))),
      row('Echo', slider(0, 0.8, 0.01, g.delayMix, set('delayMix'))),
      row('Brightness', slider(0, 1, 0.01, g.tone, set('tone'))),
    ],
    mixer: () => [
      h('p', { class: 'hint' }, 'Level per instrument family, for every source. Tap a name to hear it.'),
      h('div', { class: 'mixer' }, FAMILIES.map((f) => {
        const st = g.families[f.id];
        return h('div', { class: 'fader' },
          h('button', { class: 'fam', onclick: () => audio.audition(f.id) }, f.name),
          slider(0, 1.2, 0.01, st.level, (v) => { st.level = v; audio.applyGlobals(); save(); }),
          h('label', { class: 'mute' }, h('input', { type: 'checkbox', checked: st.mute, onchange: (e) => { st.mute = e.target.checked; audio.applyGlobals(); save(); } }), 'mute'));
      })),
    ],
    presets: () => {
      const mine = Object.entries(localPresets()).sort((a, b) => b[1].saved - a[1].saved);
      return [
        h('h3', {}, 'Yours'),
        mine.length ? null : h('p', { class: 'hint' }, 'Nothing saved yet — name your setup above and press Save.'),
        ...mine.map(([n, p]) => h('div', { class: 'preset' },
          h('div', { class: 'preset-name' }, h('strong', {}, n), h('small', {}, new Date(p.saved).toLocaleString('en-GB'))),
          h('div', { class: 'preset-actions' },
            h('button', { class: 'preset-load', onclick: () => load(p.snap) }, 'Load'),
            h('button', { onclick: () => sharePreset(p.snap, n) }, 'Share'),
            h('button', { class: 'x', 'aria-label': `Delete ${n}`, onclick: () => { if (confirm(`Delete “${n}”?`)) { deleteLocalPreset(n); openSettings('presets', `Deleted “${n}”.`); } } }, 'Delete')))),
        h('h3', {}, 'Built in'),
        ...BUILTIN.map((p) => h('div', { class: 'preset' },
          h('div', { class: 'preset-name' }, h('strong', {}, p.name), h('small', {}, p.desc)),
          h('div', { class: 'preset-actions' },
            h('button', { class: 'preset-load', onclick: () => load(p.snap) }, 'Load'),
            h('button', { onclick: () => sharePreset(p.snap, p.name) }, 'Share')))),
      ];
    },
    recordings: () => {
      const list = h('div', { class: 'recordings' }, h('p', { class: 'hint' }, 'Loading…'));
      listRecordings().then((all) => {
        list.replaceChildren(
          ...(all.length ? [] : [h('p', { class: 'hint' }, `No recordings yet — press ● REC (up to ${MAX_SECONDS} s). You get the sound and a MIDI file of every note.`)]),
          ...all.map((r) => {
            const src = URL.createObjectURL(r.audio);
            return h('div', { class: 'recording' },
              h('div', { class: 'preset-name' }, h('strong', {}, new Date(r.created).toLocaleString('en-GB')), h('small', {}, `${r.seconds} s · ${r.notes} notes`)),
              h('audio', { controls: true, src, preload: 'none' }),
              h('div', { class: 'preset-actions' },
                h('button', { onclick: () => download(r.audio, fileName(r, 'audio')) }, '⬇ Sound'),
                h('button', { onclick: () => download(r.midi, fileName(r, 'midi')) }, '⬇ MIDI'),
                h('button', { onclick: async () => {
                  const files = [new File([r.audio], fileName(r, 'audio'), { type: r.audio.type }), new File([r.midi], fileName(r, 'midi'), { type: 'audio/midi' })];
                  const res = await share('datamusak recording', { files });
                  if (res === 'unsupported') { download(r.audio, fileName(r, 'audio')); msg.textContent = 'Sharing files isn’t supported here — downloaded instead.'; }
                } }, 'Share'),
                h('button', { class: 'x', onclick: async () => { await deleteRecording(r.id); openSettings('recordings'); } }, 'Delete')));
          }),
        );
      });
      return [list];
    },
    midi: () => [
      h('p', { class: 'hint' }, 'Play your own synths or a DAW (Chrome/Edge). Each source gets a channel, drums go to 10.'),
      midi.supported
        ? midi.access
          ? row('Output', select([['', '— none —'], ...midi.outputs().map((o) => [o.id, o.name])], g.midiOut, (v) => { g.midiOut = v; save(); }))
          : h('button', { onclick: () => midi.enable().then(() => openSettings('midi')).catch((e) => (msg.textContent = 'MIDI unavailable: ' + e.message)) }, 'Enable MIDI')
        : h('p', {}, 'This browser has no Web MIDI.'),
      row('Built-in sound', h('input', { type: 'checkbox', checked: g.internal, onchange: (e) => set('internal')(e.target.checked) })),
    ],
    about: () => [
      h('p', {}, 'datamusak turns live open data into music: every data point becomes a note. The same data always makes the same sound — each station, ship or author has its own instrument and its own place in the scale, and its values walk the melody.'),
      h('p', {}, 'Everything runs in your browser, straight from public APIs, MQTT brokers, Nostr relays and peer-to-peer rooms. “Online” joins a peer-to-peer room to count listeners and share notes; peers can see each other’s IP address.'),
      h('p', {}, h('a', { href: 'https://github.com/sloev/datamusak', target: '_blank', rel: 'noopener' }, 'Source code'), ' · ', h('a', { href: 'https://github.com/sloev/datamusak/issues/new?template=new-data-source.yml', target: '_blank', rel: 'noopener' }, 'Suggest a data source')),
      h('button', { onclick: () => { if (confirm('Reset everything?')) { clearState(); location.reload(); } } }, 'Reset everything'),
    ],
  };
  openSheet('Settings', 'var(--ye)', 'var(--pk)', saveBar, msg, tabs, h('div', { class: 'panel', role: 'tabpanel' }, ...panels[tab]().filter(Boolean)));
}
$('#open-settings').onclick = () => openSettings();
midi.onChange = () => sheet.open && settingsTab === 'midi' && openSettings('midi');

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

// ---------------------------------------------------------------- footer

// The browsers CI ran the whole test suite on for this build (stats/browsers.json, written at
// deploy by scripts/browser-report.mjs): each fades in and away, then a quiet summary stays.
fetch('stats/browsers.json')
  .then((r) => r.json())
  .then(({ browsers = [], testedAt }) => {
    const ok = browsers.filter((b) => b.ok);
    if (!ok.length) return;
    const el = $('#tested');
    const names = ok.map((b) => `${b.label} ${String(b.version || '').split('.')[0]}`.trim());
    const day = testedAt ? new Date(testedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
    const summary = `✓ tested & working on ${ok.length} browsers${day ? ' · ' + day : ''}`;
    el.title = `Tested & working: ${names.join(', ')}`;
    el.hidden = false;
    let timer;
    const play = () => {
      clearTimeout(timer);
      el.classList.remove('done');
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.textContent = `✓ tested & working: ${names.join(' · ')}`;
        return;
      }
      names.forEach((n, i) => {
        timer = setTimeout(() => el.replaceChildren(h('span', { class: 'one' }, `✓ ${n}`)), i * 1800);
      });
      timer = setTimeout(() => {
        el.textContent = summary;
        el.classList.add('done');
      }, names.length * 1800);
    };
    el.onclick = play;
    play();
  })
  .catch(() => {});

$('#made-with').textContent = [...'💖💘💜🧡💛💚💙✨🌈🦄🍩🪐🔥👾🎉🍄🌀🚀🛸🎨🐙🦖🍭💾🕹️🪩🎛️📡🎧🛰️'][Math.floor(Math.random() * 30)] || '🍄';
// PWA install: Chromium offers a prompt event; iOS needs the Share-sheet route.
let installPrompt = null;
const installed = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (!installed()) $('#install').hidden = false;
});
addEventListener('appinstalled', () => {
  installPrompt = null;
  $('#install').hidden = true;
  $('#install-hint').hidden = true;
});
if (!installed() && ios) $('#install').hidden = false;
$('#install').onclick = async () => {
  if (installPrompt) {
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') $('#install').hidden = true;
    installPrompt = null;
  } else {
    $('#install-hint').hidden = false;
  }
};

// ------------------------------------------------------------------ boot

for (const src of SOURCES) soundMap.setEnabled(src.id, state.sources[src.id].enabled);
soundMap.fit(true);
renderFilters();
renderTiles();
if (notice) openSettings('presets');

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
// Handy for debugging in the console (and used by the end-to-end tests).
window.datamusak = { state, engine, audio, midi, recorder, map: soundMap.map, sources: SOURCES, statusOf, programName, noteName };
