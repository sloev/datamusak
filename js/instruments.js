// The General MIDI families (8 programs each) plus a drum kit. Sources pick from families,
// so "all 128 instruments" and "just bass + pads" are the same simple choice.
import { GM } from './gm.js';

export const DRUMS = 'drums';

const NAMES = ['Piano', 'Mallets', 'Organ', 'Guitar', 'Bass', 'Strings', 'Ensemble', 'Brass', 'Reed', 'Pipe', 'Synth lead', 'Synth pad', 'Synth FX', 'Ethnic', 'Percussive', 'Sound FX'];
const IDS = ['piano', 'chromatic', 'organ', 'guitar', 'bass', 'strings', 'ensemble', 'brass', 'reed', 'pipe', 'lead', 'pad', 'fx', 'ethnic', 'percussive', 'sfx'];

export const FAMILIES = [
  ...IDS.map((id, i) => ({ id, name: NAMES[i], programs: [...Array(8).keys()].map((k) => i * 8 + k) })),
  { id: 'drums', name: 'Drums', programs: [DRUMS] },
];
export const FAMILY_BY_ID = Object.fromEntries(FAMILIES.map((f) => [f.id, f]));

export const familyOf = (program) => (program === DRUMS ? 'drums' : IDS[Math.floor(program / 8)]);
export const programName = (program) => (program === DRUMS ? 'Drum kit' : GM[program]);

// All programs a source may play: 'all' = 128 GM programs + the drum kit.
export function poolFor(families) {
  const list = families === 'all' ? FAMILIES : FAMILIES.filter((f) => families.includes(f.id));
  const pool = list.flatMap((f) => f.programs);
  return pool.length ? pool : [0];
}
