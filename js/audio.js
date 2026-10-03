// Sound engine: General MIDI instruments via WebAudioFont (loaded on demand),
// one bus per instrument slot, plus global tone / delay / reverb / master.
import { DRUM_NOTES } from './scales.js';
import { GM } from './gm.js';
import { LIBS } from './lazy.js';

export const DRUMS = 'drums';

export class AudioEngine {
  constructor(state) {
    this.state = state;
    this.ctx = null;
    this.player = null; // WebAudioFont is loaded on first start
    this.slotBus = [];
    this.presets = []; // per slot: preset object, or {drums: {note: preset}}
    this.loading = [];
    this.onSlotStatus = () => {};
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  async start() {
    if (!this.ctx) {
      // Create the context synchronously inside the user gesture, then fetch the engine.
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const Player = await LIBS.webaudiofont();
      this.player = new Player();
      this.build();
    }
    await this.ctx.resume();
  }

  async stop() {
    if (this.ctx) await this.ctx.suspend();
  }

  build() {
    const ctx = this.ctx;
    this.bus = ctx.createGain();
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.ratio.value = 12;
    this.master = ctx.createGain();
    this.bus.connect(this.tone);
    this.tone.connect(this.limiter);
    this.limiter.connect(this.master);
    this.master.connect(ctx.destination);

    this.reverb = this.player.createReverberator(ctx);
    this.reverb.dry.gain.value = 0;
    this.tone.connect(this.reverb.input);
    this.reverb.output.connect(this.limiter);

    this.delaySend = ctx.createGain();
    this.delay = ctx.createDelay(4);
    this.feedback = ctx.createGain();
    this.delayFilter = ctx.createBiquadFilter();
    this.delayFilter.type = 'lowpass';
    this.delayFilter.frequency.value = 3500;
    this.tone.connect(this.delaySend);
    this.delaySend.connect(this.delay);
    this.delay.connect(this.delayFilter);
    this.delayFilter.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delayFilter.connect(this.limiter);

    this.state.slots.forEach((_, i) => this.ensureSlot(i));
    this.applyGlobals();
  }

  ensureSlot(i) {
    if (!this.player || this.slotBus[i]) return;
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner();
    g.connect(p);
    p.connect(this.bus);
    this.slotBus[i] = { gain: g, pan: p };
    this.applySlot(i);
    this.loadSlot(i);
  }

  applyGlobals() {
    if (!this.player) return;
    const g = this.state.global;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(g.master, t, 0.05);
    this.reverb.wet.gain.setTargetAtTime(g.reverb, t, 0.05);
    this.tone.frequency.setTargetAtTime(200 * Math.pow(2, g.tone * 6.5), t, 0.05);
    this.delaySend.gain.setTargetAtTime(g.delayMix, t, 0.05);
    this.feedback.gain.setTargetAtTime(g.delayFeedback, t, 0.05);
    this.delay.delayTime.setTargetAtTime(Math.min(3.9, (60 / g.bpm) * g.delayBeats), t, 0.05);
  }

  applySlot(i) {
    const s = this.state.slots[i];
    const b = this.slotBus[i];
    if (!b || !s) return;
    const t = this.ctx.currentTime;
    b.gain.gain.setTargetAtTime(s.mute ? 0 : s.level, t, 0.03);
    b.pan.pan.setTargetAtTime(s.pan, t, 0.03);
  }

  // Resolve and lazily load the WebAudioFont preset(s) for a slot's program.
  loadSlot(i) {
    if (!this.player) return;
    const program = this.state.slots[i].program;
    const loader = this.player.loader;
    const token = (this.loading[i] = {});
    let vars;
    if (program === DRUMS) {
      vars = DRUM_NOTES.map((n) => [n, loader.drumInfo(loader.findDrum(n))]);
    } else {
      vars = [[null, loader.instrumentInfo(loader.findInstrument(program))]];
    }
    this.onSlotStatus(i, 'loading');
    for (const [, info] of vars) loader.startLoad(this.ctx, info.url, info.variable);
    loader.waitLoad(() => {
      if (this.loading[i] !== token) return;
      if (program === DRUMS) {
        const drums = {};
        for (const [n, info] of vars) drums[n] = window[info.variable];
        this.presets[i] = { drums };
      } else {
        this.presets[i] = window[vars[0][1].variable];
      }
      this.onSlotStatus(i, 'ready');
    });
  }

  play({ slot, note, velocity, duration, pan, bright, when }) {
    if (!this.running) return;
    const preset = this.presets[slot];
    const bus = this.slotBus[slot];
    if (!preset || !bus) return;
    const p = preset.drums ? preset.drums[note] : preset;
    if (!p) return;
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300 * Math.pow(2, bright * 6);
    filter.Q.value = 0.7;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    filter.connect(panner);
    panner.connect(bus.gain);
    const vol = Math.pow(velocity / 127, 1.6) * 0.9;
    this.player.queueWaveTable(ctx, filter, p, when, note, duration, vol);
    const ttl = (when - ctx.currentTime + duration + 2) * 1000;
    setTimeout(() => {
      filter.disconnect();
      panner.disconnect();
    }, ttl);
  }

  instrumentNames() {
    return GM;
  }
}
