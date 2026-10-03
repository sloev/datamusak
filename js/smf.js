// A tiny Standard MIDI File (format 0) writer for recorded notes.
// notes: [{ t (seconds from start), duration, note, velocity, channel, program }]
const PPQ = 480;

function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

export function writeMidi(notes, { bpm = 120, name = 'datamusak' } = {}) {
  const tick = (sec) => Math.max(0, Math.round((sec * bpm * PPQ) / 60));
  const events = [];
  const usPerBeat = Math.round(60000000 / bpm);
  events.push([0, 0, [0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff]]);
  const title = [...new TextEncoder().encode(name)];
  events.push([0, 0, [0xff, 0x03, ...vlq(title.length), ...title]]);
  const program = new Map();
  for (const n of [...notes].sort((a, b) => a.t - b.t)) {
    const ch = n.channel & 0x0f;
    const on = tick(n.t);
    if (ch !== 9 && typeof n.program === 'number' && program.get(ch) !== n.program) {
      events.push([on, 1, [0xc0 | ch, n.program & 0x7f]]);
      program.set(ch, n.program);
    }
    events.push([on, 3, [0x90 | ch, n.note & 0x7f, Math.max(1, Math.min(127, n.velocity))]]);
    events.push([tick(n.t + n.duration), 2, [0x80 | ch, n.note & 0x7f, 0]]);
  }
  // by time; at equal times: meta, program change, note-off, then note-on
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const track = [];
  let last = 0;
  for (const [t, , bytes] of events) {
    track.push(...vlq(t - last), ...bytes);
    last = t;
  }
  track.push(0, 0xff, 0x2f, 0x00);
  const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  return new Uint8Array([
    ...[0x4d, 0x54, 0x68, 0x64], ...u32(6), 0, 0, 0, 1, (PPQ >> 8) & 0xff, PPQ & 0xff,
    ...[0x4d, 0x54, 0x72, 0x6b], ...u32(track.length), ...track,
  ]);
}
