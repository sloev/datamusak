// Optional Web MIDI output. Each source plays on its own channel (drums always on channel 10);
// a program change is sent whenever the instrument on a channel changes.
import { DRUMS } from './instruments.js';

export class MidiOut {
  constructor(state, sourceIds) {
    this.state = state;
    this.access = null;
    this.onChange = () => {};
    this.program = new Map(); // channel → current program
    // 15 melodic channels (skipping 10) shared round-robin by source order
    this.channelOf = new Map(sourceIds.map((id, i) => [id, [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15][i % 15]]));
  }

  get supported() {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  async enable() {
    if (this.access || !this.supported) return;
    this.access = await navigator.requestMIDIAccess();
    this.access.onstatechange = () => this.onChange();
    this.onChange();
  }

  outputs() {
    return this.access ? [...this.access.outputs.values()] : [];
  }

  get port() {
    const id = this.state.global.midiOut;
    return id && this.access ? this.access.outputs.get(id) : null;
  }

  // `delayMs` is relative to now.
  play(v, delayMs) {
    const port = this.port;
    if (!port) return;
    const ch = v.program === DRUMS ? 9 : this.channelOf.get(v.source) ?? 0;
    const t = performance.now() + Math.max(0, delayMs);
    if (v.program !== DRUMS && this.program.get(ch) !== v.program) {
      port.send([0xc0 | ch, v.program], t);
      this.program.set(ch, v.program);
    }
    const vel = Math.max(1, Math.min(127, Math.round(v.velocity * Math.min(1, v.level ?? 1))));
    port.send([0xb0 | ch, 74, Math.round(v.bright * 127)], t);
    port.send([0xb0 | ch, 10, Math.round((v.pan + 1) * 63.5)], t);
    port.send([0x90 | ch, v.note, vel], t);
    port.send([0x80 | ch, v.note, 0], t + v.duration * 1000);
  }

  panic() {
    const port = this.port;
    if (!port) return;
    for (let ch = 0; ch < 16; ch++) port.send([0xb0 | ch, 123, 0]);
    this.program.clear();
  }
}
