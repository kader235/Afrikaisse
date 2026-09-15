import type { ChimeName } from './alertRules.ts';
import { encodeWav, renderChime, type AlertVolume } from './chime.ts';

/**
 * Son des alertes du personnel, fiable sur la tablette.
 *
 * 1. WebAudio, gardé éveillé : reprise à chaque toucher, touche clavier, retour au premier plan.
 * 2. Si WebAudio reste suspendu au moment de l'alerte : élément <audio> lisant un WAV fabriqué
 *    en code (l'enveloppe Android autorise la lecture sans geste), et nouvelle tentative de reprise.
 * Les navigateurs de PC n'autorisent le son qu'après un premier geste : l'état est affiché dans
 * « Son et notifications ».
 */

export type SoundState = 'ready' | 'locked' | 'unsupported';

let audio: AudioContext | null = null;
let installed = false;
let mediaUnlocked = false;
const listeners = new Set<(state: SoundState) => void>();
const buffers = new Map<string, AudioBuffer>();
const wavUrls = new Map<string, string>();

function context(): AudioContext | null {
  if (audio) return audio;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audio = new Ctor();
    audio.onstatechange = notify;
    return audio;
  } catch {
    return null;
  }
}

export function soundState(): SoundState {
  const ctx = context();
  if (ctx) return ctx.state === 'running' || mediaUnlocked ? 'ready' : 'locked';
  return typeof Audio === 'undefined' ? 'unsupported' : mediaUnlocked ? 'ready' : 'locked';
}

function notify() {
  const state = soundState();
  listeners.forEach((cb) => cb(state));
}

export function onSoundState(cb: (state: SoundState) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Relance l'audio (sans effet s'il tourne déjà). */
export function wakeAudio(): void {
  const ctx = context();
  if (ctx && ctx.state !== 'running') ctx.resume().then(notify, () => undefined);
}

/** Écoute les gestes et les retours au premier plan pour garder l'audio éveillé. Une seule fois. */
export function installSoundUnlock(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const onGesture = () => {
    wakeAudio();
    primeMedia();
  };
  for (const type of ['pointerdown', 'touchstart', 'keydown', 'click']) window.addEventListener(type, onGesture, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => !document.hidden && wakeAudio());
  window.addEventListener('focus', wakeAudio);
  window.addEventListener('pageshow', wakeAudio);
  wakeAudio();
}

/** Premier geste : un son muet « déverrouille » aussi l'élément <audio> pour les navigateurs qui l'exigent. */
function primeMedia() {
  if (mediaUnlocked || typeof Audio === 'undefined') return;
  try {
    const el = new Audio(wavUrl('ready', 'low'));
    el.muted = true;
    el.play().then(
      () => {
        el.pause();
        mediaUnlocked = true;
        notify();
      },
      () => undefined,
    );
  } catch {
    /* pas d'élément audio : WebAudio seul */
  }
}

function wavUrl(name: ChimeName, volume: AlertVolume): string {
  const id = `${name}:${volume}`;
  let url = wavUrls.get(id);
  if (!url) {
    const rate = 22050;
    const bytes = encodeWav(renderChime(name, rate, volume), rate);
    url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' }));
    wavUrls.set(id, url);
  }
  return url;
}

function playWebAudio(ctx: AudioContext, name: ChimeName, volume: AlertVolume): boolean {
  const id = `${name}:${volume}:${ctx.sampleRate}`;
  let buffer = buffers.get(id);
  if (!buffer) {
    const samples = renderChime(name, ctx.sampleRate, volume);
    buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    buffers.set(id, buffer);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  return true;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Joue un carillon. Résout `true` si le son est parti, `false` si l'appareil l'a refusé
 * (l'appelant poste alors une notification système, qui sonnera, elle).
 */
export async function playChime(name: ChimeName, volume: AlertVolume): Promise<boolean> {
  const ctx = context();
  try {
    // Reprise courte : si elle aboutit, WebAudio ; sinon le secours <audio> part sans attendre.
    if (ctx && ctx.state !== 'running') await Promise.race([ctx.resume().catch(() => undefined), pause(200)]);
    if (ctx && ctx.state === 'running') return playWebAudio(ctx, name, volume);
  } catch {
    /* on tente le secours */
  }
  if (typeof Audio === 'undefined') return false;
  try {
    await new Audio(wavUrl(name, volume)).play();
    if (!mediaUnlocked) {
      mediaUnlocked = true;
      notify();
    }
    return true;
  } catch {
    return false;
  } finally {
    wakeAudio();
  }
}
