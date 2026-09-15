/**
 * Signal sonore des écrans du personnel (nouvelle commande, appel d'une table).
 * Les navigateurs n'autorisent le son qu'après un geste de l'utilisateur : le premier
 * toucher sur l'écran « déverrouille » l'audio.
 */
let audio: AudioContext | null = null;

function context(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audio = audio ?? new Ctor();
    return audio;
  } catch {
    return null;
  }
}

export function unlockSound(): void {
  const ctx = context();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

export function beep(times = 2, frequency = 880): void {
  const ctx = context();
  if (!ctx || ctx.state !== 'running') return;
  const start = ctx.currentTime;
  for (let i = 0; i < times; i++) {
    const at = start + i * 0.28;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.9, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.24);
  }
}
