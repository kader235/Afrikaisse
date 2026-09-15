import type { ChimeName } from './alertRules.ts';

/**
 * Carillons des alertes, calculés en code (aucun fichier son à télécharger) : la même onde sert
 * à WebAudio et, en secours, à un élément <audio> lisant un WAV fabriqué ici. Logique pure.
 *
 * Timbre de cloche douce : fondamentale + harmoniques légères, attaque courte, extinction naturelle.
 * Trois motifs qu'on reconnaît sans regarder l'écran.
 */

export type AlertVolume = 'low' | 'medium' | 'high';

export const VOLUME_GAIN: Record<AlertVolume, number> = { low: 0.3, medium: 0.6, high: 1 };

interface Note {
  /** Hz */
  f: number;
  /** Départ, en secondes. */
  t: number;
  /** Durée d'extinction, en secondes. */
  d: number;
  /** Niveau relatif. */
  g: number;
}

const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const B5 = 987.77;
const C5 = 523.25;
const C6 = 1046.5;

export const CHIMES: Record<ChimeName, Note[]> = {
  // Nouvelle commande : deux tons montants, deux fois (« ding-ding… ding-ding »).
  order: [
    { f: E5, t: 0, d: 0.55, g: 0.9 },
    { f: A5, t: 0.18, d: 0.8, g: 1 },
    { f: E5, t: 0.75, d: 0.55, g: 0.9 },
    { f: A5, t: 0.93, d: 1, g: 1 },
  ],
  // Commande prête : arpège montant qui se pose (« c'est prêt »).
  ready: [
    { f: C5, t: 0, d: 0.5, g: 0.8 },
    { f: E5, t: 0.15, d: 0.5, g: 0.85 },
    { f: G5, t: 0.3, d: 0.55, g: 0.9 },
    { f: C6, t: 0.45, d: 1.1, g: 1 },
  ],
  // Appel, addition, problème : sonnette « ding-dong », deux fois.
  call: [
    { f: B5, t: 0, d: 0.7, g: 1 },
    { f: G5, t: 0.32, d: 0.9, g: 0.95 },
    { f: B5, t: 1.0, d: 0.7, g: 1 },
    { f: G5, t: 1.32, d: 1.1, g: 0.95 },
  ],
};

const HARMONICS: [ratio: number, level: number, decay: number][] = [
  [1, 1, 1],
  [2, 0.28, 0.6],
  [3, 0.08, 0.35],
];

export function chimeDuration(name: ChimeName): number {
  return Math.max(...CHIMES[name].map((n) => n.t + n.d)) + 0.05;
}

/** Onde du carillon (mono, -1..1), normalisée au volume demandé (fort = crête à 0,95). */
export function renderChime(name: ChimeName, sampleRate: number, volume: AlertVolume): Float32Array {
  const length = Math.ceil(chimeDuration(name) * sampleRate);
  const out = new Float32Array(length);
  const attack = 0.006;
  for (const note of CHIMES[name]) {
    const start = Math.floor(note.t * sampleRate);
    const end = Math.min(length, start + Math.ceil(note.d * sampleRate));
    for (let i = start; i < end; i++) {
      const x = (i - start) / sampleRate;
      const env = x < attack ? x / attack : 1;
      let v = 0;
      for (const [ratio, level, decay] of HARMONICS) {
        v += level * Math.exp((-5 * x) / (note.d * decay)) * Math.sin(2 * Math.PI * note.f * ratio * x);
      }
      out[i] = out[i]! + note.g * env * v;
    }
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i]!));
  const scale = peak > 0 ? (0.95 * VOLUME_GAIN[volume]) / peak : 0;
  for (let i = 0; i < length; i++) out[i] = out[i]! * scale;
  return out;
}

/** Fichier WAV PCM 16 bits mono. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return bytes;
}
