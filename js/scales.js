// Scales as semitone offsets from the root. Data is mapped onto scale *degrees*
// (not semitones), so every step of the input range lands on a note in the scale.
export const SCALES = {
  majorPentatonic: { name: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  minorPentatonic: { name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  major: { name: 'Major (Ionian)', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'Natural minor (Aeolian)', steps: [0, 2, 3, 5, 7, 8, 10] },
  harmonicMinor: { name: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  melodicMinor: { name: 'Melodic minor', steps: [0, 2, 3, 5, 7, 9, 11] },
  dorian: { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  locrian: { name: 'Locrian', steps: [0, 1, 3, 5, 6, 8, 10] },
  blues: { name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  wholeTone: { name: 'Whole tone', steps: [0, 2, 4, 6, 8, 10] },
  hirajoshi: { name: 'Hirajoshi', steps: [0, 2, 3, 7, 8] },
  inSen: { name: 'In sen', steps: [0, 1, 5, 7, 10] },
  pelog: { name: 'Pelog (approx.)', steps: [0, 1, 3, 7, 8] },
  hungarianMinor: { name: 'Hungarian minor', steps: [0, 2, 3, 6, 7, 8, 11] },
  doubleHarmonic: { name: 'Double harmonic', steps: [0, 1, 4, 5, 7, 8, 11] },
  diminished: { name: 'Diminished (half-whole)', steps: [0, 1, 3, 4, 6, 7, 9, 10] },
  fifths: { name: 'Root + fifth (drone)', steps: [0, 7] },
  majorTriad: { name: 'Major arpeggio', steps: [0, 4, 7] },
  minorTriad: { name: 'Minor arpeggio', steps: [0, 3, 7] },
  chromatic: { name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

// All MIDI notes in [lo, hi] that belong to the scale.
export function scaleNotes(scaleId, root, lo, hi) {
  const steps = (SCALES[scaleId] || SCALES.majorPentatonic).steps;
  const out = [];
  for (let n = Math.max(0, lo); n <= Math.min(127, hi); n++) {
    if (steps.includes((((n - root) % 12) + 12) % 12)) out.push(n);
  }
  return out.length ? out : [Math.round((lo + hi) / 2)];
}

// Map 0..1 onto a scale degree between lo and hi.
export function quantize(x, scaleId, root, lo, hi) {
  const notes = scaleNotes(scaleId, root, lo, hi);
  const i = Math.min(notes.length - 1, Math.max(0, Math.floor(x * notes.length)));
  return notes[i];
}

// Move `note` by `degrees` scale steps (used for harmonies).
export function stepInScale(note, degrees, scaleId, root) {
  const notes = scaleNotes(scaleId, root, 0, 127);
  let i = notes.indexOf(note);
  if (i < 0) i = notes.findIndex((n) => n > note);
  if (i < 0) return note;
  return notes[Math.min(notes.length - 1, Math.max(0, i + degrees))];
}

// A General MIDI drum kit subset, ordered roughly low/boomy → high/bright.
export const DRUM_NOTES = [35, 36, 41, 43, 45, 47, 38, 40, 37, 39, 48, 50, 56, 54, 42, 44, 46, 51, 59, 53, 49, 57, 75, 76, 77, 81];
