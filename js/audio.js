// Sound engine: any of the 128 General MIDI programs + a drum kit via WebAudioFont, loaded on
// demand (and cached by the service worker), one bus per instrument family, then tone / delay /
// reverb / master.
import { DRUM_NOTES } from './scales.js';
import { FAMILIES, DRUMS } from './instruments.js';
import { LIBS } from './lazy.js';

export { DRUMS };

export class AudioEngine {
  constructor(state) {
    this.state = state;
    this.ctx = null;
    this.player = null; // WebAudioFont is loaded on first start
    this.bus = {}; // family id → GainNode
    this.presets = new Map(); // program → preset | { drums: { note: preset } }
    this.loading = new Map(); // program → [pending voices]
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
    this.mix = ctx.createGain();
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.ratio.value = 12;
    this.master = ctx.createGain();
    this.mix.connect(this.tone);
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
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 3500;
    this.tone.connect(this.delaySend);
    this.delaySend.connect(this.delay);
    this.delay.connect(damp);
    damp.connect(this.feedback);
    this.feedback.connect(this.delay);
    damp.connect(this.limiter);

    for (const f of FAMILIES) {
      const g = ctx.createGain();
      g.connect(this.mix);
      this.bus[f.id] = g;
    }
    this.applyGlobals();
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
    for (const f of FAMILIES) {
      const s = g.families[f.id];
      this.bus[f.id].gain.setTargetAtTime(s.mute ? 0 : s.level, t, 0.03);
    }
  }

  // Fetch the sample set(s) for a program; resolves when every zone is decoded.
  load(program) {
    if (this.presets.has(program) || this.loading.has(program) || !this.player) return;
    this.loading.set(program, []);
    const loader = this.player.loader;
    const infos =
      program === DRUMS
        ? DRUM_NOTES.map((n) => [n, loader.drumInfo(loader.findDrum(n))])
        : [[null, loader.instrumentInfo(loader.findInstrument(program))]];
    for (const [, info] of infos) loader.startLoad(this.ctx, info.url, info.variable);
    const started = performance.now();
    const check = () => {
      if (!infos.every(([, info]) => loader.loaded(info.variable))) {
        if (performance.now() - started < 30000) setTimeout(check, 120);
        else this.loading.delete(program); // give up quietly; a later note retries
        return;
      }
      const preset = program === DRUMS ? { drums: Object.fromEntries(infos.map(([n, info]) => [n, window[info.variable]])) } : window[infos[0][1].variable];
      this.presets.set(program, preset);
      // notes that arrived while loading still play if they're fresh
      const pending = this.loading.get(program) || [];
      this.loading.delete(program);
      const now = this.ctx.currentTime;
      for (const v of pending) if (now - v.when < 0.6) this.play({ ...v, when: now + 0.01 });
    };
    check();
  }

  play(v) {
    if (!this.running) return;
    const preset = this.presets.get(v.program);
    if (!preset) {
      this.load(v.program);
      const q = this.loading.get(v.program);
      if (q && q.length < 8) q.push(v);
      return;
    }
    const p = preset.drums ? preset.drums[v.note] : preset;
    if (!p) return;
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300 * Math.pow(2, v.bright * 6);
    filter.Q.value = 0.7;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, v.pan));
    filter.connect(panner);
    panner.connect(this.bus[v.family] || this.mix);
    this.player.queueWaveTable(ctx, filter, p, v.when, v.note, v.duration, Math.pow(v.velocity / 127, 1.6) * 0.9);
    setTimeout(() => {
      filter.disconnect();
      panner.disconnect();
    }, (v.when - ctx.currentTime + v.duration + 2) * 1000);
  }

  // A quick audition of one family (used by the mixer).
  async audition(familyId) {
    await this.start();
    const f = FAMILIES.find((x) => x.id === familyId);
    const program = f.programs[0];
    const note = program === DRUMS ? 38 : 60;
    this.play({ program, family: f.id, note, velocity: 100, duration: 0.6, pan: 0, bright: 0.8, when: this.ctx.currentTime + 0.05 });
  }
}
