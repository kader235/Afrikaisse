import { describe, expect, it } from 'vitest';
import { CHIMES, chimeDuration, encodeWav, renderChime } from '../src/chime.ts';

describe('carillons générés en code', () => {
  it('trois motifs distincts, chacun sous 2,5 s', () => {
    const names = Object.keys(CHIMES) as (keyof typeof CHIMES)[];
    expect(names.sort()).toEqual(['call', 'order', 'ready']);
    for (const name of names) expect(chimeDuration(name)).toBeLessThan(2.5);
    expect(JSON.stringify(CHIMES.order)).not.toBe(JSON.stringify(CHIMES.call));
  });

  it('volume : crête à 0,95 en fort, proportionnelle en moyen et faible, jamais d’écrêtage', () => {
    const peak = (v: 'low' | 'medium' | 'high') => renderChime('call', 8000, v).reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    expect(peak('high')).toBeCloseTo(0.95, 3);
    expect(peak('medium')).toBeCloseTo(0.57, 2);
    expect(peak('low')).toBeCloseTo(0.285, 2);
  });

  it('WAV PCM 16 bits mono lisible', () => {
    const samples = renderChime('ready', 22050, 'high');
    const wav = encodeWav(samples, 22050);
    const view = new DataView(wav.buffer);
    const text = (o: number, n: number) => String.fromCharCode(...wav.slice(o, o + n));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(22050);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(wav.length).toBe(44 + samples.length * 2);
    // Moins de 100 Ko : se fabrique instantanément, même sur une vieille tablette.
    expect(wav.length).toBeLessThan(100_000);
  });
});
