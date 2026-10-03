// Optional Web MIDI output: each instrument slot sends on its own channel
// (slot 1 → ch 1 …, drum slots always on ch 10), so a DAW or hardware synth can play along.
import { DRUMS } from './audio.js';

export class MidiOut {
  constructor(state) {
    this.state = state;
    this.access = null;
    this.onChange = () => {};
  }

  get supported() {
    return 'requestMIDIAccess' in navigator;
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

  channel(slot) {
    return this.state.slots[slot].program === DRUMS ? 9 : slot % 16 === 9 ? 15 : slot % 16;
  }

  programChange(slot) {
    const port = this.port;
    const program = this.state.slots[slot].program;
    if (port && program !== DRUMS) port.send([0xc0 | this.channel(slot), program]);
  }

  sendAllPrograms() {
    this.state.slots.forEach((_, i) => this.programChange(i));
  }

  // `delayMs` is relative to now.
  play({ slot, note, velocity, duration, bright }, delayMs) {
    const port = this.port;
    if (!port) return;
    const ch = this.channel(slot);
    const level = this.state.slots[slot].mute ? 0 : this.state.slots[slot].level;
    const vel = Math.max(1, Math.min(127, Math.round(velocity * Math.min(1, level))));
    const t = performance.now() + Math.max(0, delayMs);
    port.send([0xb0 | ch, 74, Math.round(bright * 127)], t);
    port.send([0x90 | ch, note, vel], t);
    port.send([0x80 | ch, note, 0], t + duration * 1000);
  }

  panic() {
    const port = this.port;
    if (!port) return;
    for (let ch = 0; ch < 16; ch++) port.send([0xb0 | ch, 123, 0]);
  }
}
