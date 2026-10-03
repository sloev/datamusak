// Records what you hear (audio, via MediaRecorder on the master output) and what was played
// (a MIDI file of the same notes), for up to a minute. Recordings live in this browser (IndexedDB).
import { writeMidi } from './smf.js';

export const MAX_SECONDS = 60;
const KEEP = 12;

export class Recorder {
  constructor({ audio, midi, state }) {
    this.audio = audio;
    this.midi = midi;
    this.state = state;
    this.active = null;
    this.onChange = () => {};
    this.onSaved = () => {};
  }

  get recording() {
    return !!this.active;
  }

  get elapsed() {
    return this.active ? (performance.now() - this.active.started) / 1000 : 0;
  }

  static mimeType() {
    const options = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
    return (typeof MediaRecorder !== 'undefined' && options.find((m) => MediaRecorder.isTypeSupported(m))) || '';
  }

  start() {
    const { ctx, master } = this.audio;
    if (!ctx || !master || this.active) return false;
    const dest = ctx.createMediaStreamDestination();
    master.connect(dest);
    const mimeType = Recorder.mimeType();
    const mr = new MediaRecorder(dest.stream, mimeType ? { mimeType } : undefined);
    const rec = { mr, dest, chunks: [], notes: [], t0: ctx.currentTime, started: performance.now(), bpm: this.state.global.bpm };
    mr.ondataavailable = (e) => e.data.size && rec.chunks.push(e.data);
    rec.done = new Promise((resolve) => (mr.onstop = resolve));
    mr.start(1000);
    rec.timer = setTimeout(() => this.stop(), MAX_SECONDS * 1000);
    rec.tick = setInterval(() => this.onChange(), 500);
    this.active = rec;
    this.onChange();
    return true;
  }

  // Called for every played note.
  add(v) {
    const rec = this.active;
    if (!rec) return;
    const t = v.when - rec.t0;
    if (t < 0 || t > MAX_SECONDS) return;
    rec.notes.push({ t, duration: v.duration, note: v.note, velocity: v.velocity, program: v.program, channel: v.program === 'drums' ? 9 : this.midi.channelOf.get(v.source) ?? 0 });
  }

  async stop() {
    const rec = this.active;
    if (!rec) return null;
    this.active = null;
    clearTimeout(rec.timer);
    clearInterval(rec.tick);
    rec.mr.stop();
    await rec.done;
    try {
      this.audio.master.disconnect(rec.dest);
    } catch {}
    const created = Date.now();
    const recording = {
      id: `rec-${created}`,
      created,
      seconds: Math.min(MAX_SECONDS, Math.round((performance.now() - rec.started) / 100) / 10),
      notes: rec.notes.length,
      audio: new Blob(rec.chunks, { type: rec.mr.mimeType || 'audio/webm' }),
      midi: new Blob([writeMidi(rec.notes, { bpm: rec.bpm })], { type: 'audio/midi' }),
    };
    await saveRecording(recording);
    this.onChange();
    this.onSaved(recording);
    return recording;
  }
}

// ---- storage ----------------------------------------------------------------
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('datamusak', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('recordings', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('recordings', mode);
    const out = fn(t.objectStore('recordings'));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}
export async function listRecordings() {
  const all = await tx('readonly', (s) => s.getAll());
  return (all || []).sort((a, b) => b.created - a.created);
}
export async function saveRecording(r) {
  await tx('readwrite', (s) => s.put(r));
  const all = await listRecordings();
  for (const old of all.slice(KEEP)) await deleteRecording(old.id);
}
export const deleteRecording = (id) => tx('readwrite', (s) => s.delete(id));

export function fileName(r, kind) {
  const d = new Date(r.created);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  if (kind === 'midi') return `datamusak-${stamp}.mid`;
  const ext = r.audio.type.includes('mp4') ? 'm4a' : r.audio.type.includes('ogg') ? 'ogg' : 'webm';
  return `datamusak-${stamp}.${ext}`;
}
