import { SOURCES, SOURCE_BY_ID } from './sources/index.js';
import { createRuntime } from './sources/runtime.js';
import { loadState, saveState, clearState, defaultMapping, PARAMS, DEFAULT_SLOTS } from './state.js';
import { SCALES, NOTE_NAMES, noteName } from './scales.js';
import { AudioEngine, DRUMS } from './audio.js';
import { MidiOut } from './midi.js';
import { Normalizer } from './normalize.js';
import { Engine } from './engine.js';
import { SoundMap } from './map.js';
import { PianoRoll, EventLog } from './viz.js';

const state = loadState(SOURCES);
const save = () => saveState(state);
const audio = new AudioEngine(state);
const midi = new MidiOut(state);
const normalizer = new Normalizer();
const engine = new Engine({ state, audio, midi, normalizer });

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
  h('select', { onchange: (e) => onchange(e.target.value), ...attrs },
    choices.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));
const slider = (min, max, step, value, oninput, attrs = {}) =>
  h('input', { type: 'range', min, max, step, value, oninput: (e) => oninput(parseFloat(e.target.value)), ...attrs });
const numberInput = (min, max, step, value, onchange, attrs = {}) =>
  h('input', { type: 'number', min, max, step, value, onchange: (e) => onchange(parseFloat(e.target.value)), ...attrs });

// ----------------------------------------------------------- visualizers

const roll = new PianoRoll($('#roll'));
const log = new EventLog($('#log'));
const soundMap = new SoundMap($('#map'), SOURCES, { onSelect: (id) => focusSource(id) });
engine.on((out) => {
  log.add(out);
  soundMap.pulse(out.src, out.ev, out.notes);
  for (const n of out.notes) roll.add(out.src, n);
});
$('#log-pause').onchange = (e) => (log.paused = e.target.checked);
$('#log-played').onchange = (e) => (log.onlyPlayed = e.target.checked);
document.querySelectorAll('.map-views button').forEach((b) => (b.onclick = () => soundMap.view(b.dataset.view)));

// ---------------------------------------------------------- source runtime

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
    src.start(rt.ctx);
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
  normalizer.reset(src.id);
  if (powered && state.sources[src.id].enabled) startSource(src);
}

function setStatus(id, kind, msg) {
  statusOf.set(id, { kind, msg });
  const card = document.querySelector(`.source[data-id="${id}"]`);
  if (!card) return;
  card.querySelector('.status').className = 'status ' + kind;
  card.querySelector('.status-msg').textContent = msg || (kind === 'idle' ? '' : kind);
}

$('#power').onclick = async () => {
  powered = !powered;
  $('#power').textContent = powered ? '■ Stop' : '▶ Start';
  $('#power').classList.toggle('on', powered);
  if (powered) {
    await audio.start();
    midi.sendAllPrograms();
    for (const src of SOURCES) if (state.sources[src.id].enabled) startSource(src);
  } else {
    for (const id of [...running.keys()]) stopSource(id);
    midi.panic();
    await audio.stop();
  }
};

// --------------------------------------------------------------- globals

function renderGlobals() {
  const g = state.global;
  const set = (k, after) => (v) => {
    g[k] = v;
    audio.applyGlobals();
    after && after();
    save();
  };
  const field = (label, control) => h('label', { class: 'g' }, h('span', {}, label), control);
  const midiControl = midi.supported
    ? midi.access
      ? select([['', '— none —'], ...midi.outputs().map((o) => [o.id, o.name])], g.midiOut, (v) => {
          g.midiOut = v;
          midi.sendAllPrograms();
          save();
        })
      : h('button', { onclick: () => midi.enable().catch((e) => alert('MIDI unavailable: ' + e.message)) }, 'Enable')
    : h('span', { class: 'muted' }, 'not supported');
  $('#globals').replaceChildren(
    field('BPM', numberInput(30, 240, 1, g.bpm, set('bpm'), { class: 'n3' })),
    field('Grid', select(['off', '1/4', '1/8', '1/16', '1/32'].map((q) => [q, q]), g.quantize, set('quantize'))),
    field('Key', select(NOTE_NAMES.map((n, i) => [i, n]), g.root, (v) => set('root')(parseInt(v)))),
    field('Scale', select(Object.entries(SCALES).map(([id, s]) => [id, s.name]), g.scale, set('scale'))),
    field('Master', slider(0, 1.2, 0.01, g.master, set('master'))),
    field('Tone', slider(0, 1, 0.01, g.tone, set('tone'))),
    field('Reverb', slider(0, 1.5, 0.01, g.reverb, set('reverb'))),
    field('Delay', slider(0, 0.8, 0.01, g.delayMix, set('delayMix'))),
    field('Feedback', slider(0, 0.85, 0.01, g.delayFeedback, set('delayFeedback'))),
    field('Delay time', select([[0.25, '1/16'], [0.5, '1/8'], [0.75, '3/16'], [1, '1/4'], [1.5, '3/8'], [2, '1/2']], g.delayBeats, (v) => set('delayBeats')(parseFloat(v)))),
    field('Polyphony', numberInput(4, 128, 1, g.maxPolyphony, set('maxPolyphony'), { class: 'n3' })),
    field('Built-in synth', h('input', { type: 'checkbox', checked: g.internal, onchange: (e) => set('internal')(e.target.checked) })),
    field('MIDI out', midiControl),
  );
}
midi.onChange = renderGlobals;

// ---------------------------------------------------------------- sources

const slotChoices = () => state.slots.map((s, i) => [i, `${i + 1} ${s.name}`]);

function renderSources() {
  const root = $('#tab-sources');
  root.replaceChildren(
    h('p', { class: 'hint' }, 'Tick a source to listen. Click a name (or its circle on the map) to edit how its data becomes music.'),
  );
  let group;
  for (const src of SOURCES) {
    if (src.group !== group) {
      group = src.group;
      root.append(h('h3', {}, group));
    }
    root.append(sourceCard(src));
  }
}

function sourceCard(src) {
  const cfg = state.sources[src.id];
  const st = statusOf.get(src.id) || { kind: 'idle', msg: '' };
  const body = h('div', { class: 'mapping', hidden: true });
  const card = h('div', { class: 'source', 'data-id': src.id },
    h('div', { class: 'source-head' },
      h('input', {
        type: 'checkbox', checked: cfg.enabled, title: 'Listen to this source',
        onchange: (e) => {
          cfg.enabled = e.target.checked;
          soundMap.setEnabled(src.id, cfg.enabled);
          if (powered) cfg.enabled ? startSource(src) : stopSource(src.id);
          save();
        },
      }),
      h('span', { class: 'swatch', style: `background:${src.color}` }),
      h('button', { class: 'name', onclick: () => toggleMapping(card) }, src.name),
      h('span', { class: 'rate', title: 'events per minute' }),
      h('span', { class: 'status ' + st.kind, title: 'idle / connecting / ok / error' }),
    ),
    h('div', { class: 'source-sub' }, h('span', {}, src.transport), ' ', h('span', { class: 'status-msg' }, st.msg)),
    body,
  );
  soundMap.setEnabled(src.id, cfg.enabled);
  return card;
}

function toggleMapping(card, force) {
  const body = card.querySelector('.mapping');
  const open = force ?? body.hidden;
  body.hidden = !open;
  card.classList.toggle('open', open);
  if (open) renderMapping(SOURCE_BY_ID[card.dataset.id], body);
}

function focusSource(id) {
  showTab('sources');
  const card = document.querySelector(`.source[data-id="${id}"]`);
  toggleMapping(card, true);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 900);
}

function renderMapping(src, body) {
  const cfg = state.sources[src.id];
  const rerender = () => renderMapping(src, body);
  const fieldChoices = [['none', '— fixed (middle) —'], ...Object.entries(src.allFields).map(([k, f]) => [k, f.label])];

  const options = Object.entries(src.options || {}).map(([k, o]) =>
    h('label', { class: 'row' }, h('span', {}, o.label),
      o.type === 'select'
        ? select(o.choices, cfg.options[k], (v) => {
            cfg.options[k] = v;
            save();
            restartSource(src);
          })
        : h('input', {
            type: 'text', value: cfg.options[k], class: 'wide',
            onchange: (e) => {
              cfg.options[k] = e.target.value.trim();
              save();
              restartSource(src);
            },
          })),
  );

  const paramRow = (name) => {
    const p = PARAMS[name];
    const m = cfg[name];
    const hint = name === 'pitch' ? (v) => noteName(Math.round(v)) : null;
    const bound = (key) => {
      const hintEl = hint ? h('small', {}, hint(m[key])) : null;
      const input = numberInput(p.min, p.max, p.step, m[key], (v) => {
        m[key] = Math.min(p.max, Math.max(p.min, v));
        if (hintEl) hintEl.textContent = hint(m[key]);
        save();
      }, { class: 'n4' });
      return h('span', { class: 'bound' }, input, hintEl);
    };
    return h('tr', {},
      h('th', {}, p.label),
      h('td', {}, select(fieldChoices, m.field, (v) => { m.field = v; save(); })),
      h('td', {}, bound('lo')),
      h('td', {}, bound('hi')),
      h('td', {}, h('input', { type: 'checkbox', checked: m.invert, title: 'invert', onchange: (e) => { m.invert = e.target.checked; save(); } })),
    );
  };

  const allSlots = cfg.slots === 'all';
  const slotChips = h('div', { class: 'chips' },
    h('label', { class: 'chip' + (allSlots ? ' on' : '') },
      h('input', { type: 'checkbox', checked: allSlots, onchange: (e) => { cfg.slots = e.target.checked ? 'all' : [0]; save(); rerender(); } }), 'All'),
    state.slots.map((s, i) => {
      const on = allSlots || cfg.slots.includes(i);
      return h('label', { class: 'chip' + (on ? ' on' : ''), title: s.program === DRUMS ? 'drum kit' : '' },
        h('input', {
          type: 'checkbox', checked: on, disabled: allSlots,
          onchange: (e) => {
            const set = new Set(cfg.slots);
            e.target.checked ? set.add(i) : set.delete(i);
            cfg.slots = [...set].sort((a, b) => a - b);
            save();
            rerender();
          },
        }),
        `${i + 1} ${s.name}`);
    }),
  );

  const parts = [
    h('p', { class: 'info' }, src.info, ' ', src.link ? h('a', { href: src.link, target: '_blank', rel: 'noopener' }, 'about the data ↗') : null),
    options.length ? h('div', { class: 'opts' }, options) : null,
    h('table', { class: 'params' },
      h('thead', {}, h('tr', {}, h('th', {}), h('th', {}, 'data field'), h('th', {}, 'low'), h('th', {}, 'high'), h('th', {}, 'inv'))),
      h('tbody', {}, Object.keys(PARAMS).map(paramRow)),
    ),
    h('div', { class: 'sub' }, h('strong', {}, 'Instruments'), slotChips,
      h('label', { class: 'row' }, h('span', {}, 'choose instrument by'),
        select([['cycle', 'taking turns'], ['random', 'random'], ['field', 'data field →']], cfg.slotMode, (v) => { cfg.slotMode = v; save(); rerender(); }),
        cfg.slotMode === 'field' ? select(fieldChoices.slice(1), cfg.slotField, (v) => { cfg.slotField = v; save(); }) : null),
    ),
    h('div', { class: 'grid2' },
      h('label', { class: 'row' }, h('span', {}, 'Scale'),
        select([['global', '(global)'], ...Object.entries(SCALES).map(([id, s]) => [id, s.name])], cfg.scale, (v) => { cfg.scale = v; save(); })),
      h('label', { class: 'row' }, h('span', {}, 'Harmony'),
        select([['none', 'single note'], ['third', '+ third'], ['fifth', '+ fifth'], ['triad', 'triad'], ['octave', '+ octave'], ['spread', 'fifth + octave']], cfg.harmony, (v) => { cfg.harmony = v; save(); })),
      h('label', { class: 'row' }, h('span', {}, 'Level'), slider(0, 1.5, 0.01, cfg.level, (v) => { cfg.level = v; save(); })),
      h('label', { class: 'row' }, h('span', {}, 'Max notes/s'), numberInput(0.1, 50, 0.1, cfg.rate, (v) => { cfg.rate = v; save(); }, { class: 'n4' })),
      h('label', { class: 'row' }, h('span', {}, 'Chance'), slider(0, 1, 0.01, cfg.chance, (v) => { cfg.chance = v; save(); })),
      h('button', {
        onclick: () => {
          const d = defaultMapping(src);
          Object.assign(cfg, { ...d, enabled: cfg.enabled, options: cfg.options });
          save();
          rerender();
        },
      }, 'Reset mapping'),
    ),
  ];
  body.replaceChildren(...parts.filter(Boolean));
}

setInterval(() => {
  for (const src of SOURCES) {
    const el = document.querySelector(`.source[data-id="${src.id}"] .rate`);
    if (el) {
      const n = engine.eventsPerMinute(src.id);
      el.textContent = n ? `${n}/min` : '';
    }
  }
}, 2000);

// ------------------------------------------------------------ instruments

const programChoices = () => [[DRUMS, '🥁 Drum kit'], ...audio.instrumentNames().map((n, i) => [i, `${i + 1} ${n}`])];

function renderInstruments() {
  const root = $('#tab-instruments');
  root.replaceChildren(
    h('p', { class: 'hint' }, 'Instrument slots. Each source plays on the slots ticked in its mapping. With MIDI out, slot n sends on channel n (drums on 10).'),
    ...state.slots.map((s, i) => slotCard(s, i)),
    h('div', { class: 'row' },
      state.slots.length < 16 ? h('button', { onclick: () => { state.slots.push({ ...DEFAULT_SLOTS[0], name: 'Slot ' + (state.slots.length + 1) }); audio.ensureSlot(state.slots.length - 1); save(); renderInstruments(); } }, '+ add instrument') : null,
      state.slots.length > 1 ? h('button', { onclick: () => { state.slots.pop(); save(); renderInstruments(); } }, '− remove last') : null,
    ),
  );
}

function slotCard(s, i) {
  const upd = (k) => (v) => {
    s[k] = v;
    audio.applySlot(i);
    save();
  };
  return h('div', { class: 'slot', 'data-slot': i },
    h('div', { class: 'row' },
      h('strong', {}, i + 1),
      h('input', { type: 'text', value: s.name, class: 'slot-name', onchange: (e) => { s.name = e.target.value; save(); } }),
      select(programChoices(), s.program, (v) => {
        s.program = v === DRUMS ? DRUMS : parseInt(v);
        audio.loadSlot(i);
        midi.programChange(i);
        save();
      }),
      h('span', { class: 'slot-status' }),
    ),
    h('div', { class: 'row' },
      h('label', {}, 'level ', slider(0, 1.2, 0.01, s.level, upd('level'))),
      h('label', {}, 'pan ', slider(-1, 1, 0.05, s.pan, upd('pan'))),
      h('label', {}, 'octave ', select([-3, -2, -1, 0, 1, 2, 3].map((o) => [o, o > 0 ? '+' + o : o]), s.octave, (v) => upd('octave')(parseInt(v)))),
      h('label', {}, h('input', { type: 'checkbox', checked: s.mute, onchange: (e) => upd('mute')(e.target.checked) }), ' mute'),
      h('button', {
        title: 'play a test note',
        onclick: async () => {
          await audio.start();
          const when = audio.ctx.currentTime + 0.05;
          const note = s.program === DRUMS ? 38 : 60 + 12 * s.octave;
          audio.play({ slot: i, note, velocity: 100, duration: 0.8, pan: 0, bright: 0.8, when });
          midi.play({ slot: i, note, velocity: 100, duration: 0.8, bright: 0.8 }, 50);
        },
      }, '♪ test'),
    ),
  );
}

audio.onSlotStatus = (i, status) => {
  const el = document.querySelector(`.slot[data-slot="${i}"] .slot-status`);
  if (el) el.textContent = status === 'loading' ? 'loading…' : '';
};

// ------------------------------------------------------------------ tabs

function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => (t.hidden = t.id !== 'tab-' + name));
  if (name === 'instruments') renderInstruments();
}
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
$('#reset').onclick = () => {
  if (!confirm('Reset all instruments, mappings and global settings?')) return;
  clearState();
  location.reload();
};

renderGlobals();
renderSources();
