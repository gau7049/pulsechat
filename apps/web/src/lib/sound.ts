import { useEffect, useState } from 'react';

/**
 * Message send/receive sounds (Requirement Scope: "similar to WhatsApp").
 * No bundled audio assets exist in this repo yet (see PENDING_SETUP.md's
 * "CC0 status music" entry — nothing licensed is available), so these are
 * synthesized with the Web Audio API instead: two short sine-wave tones with
 * a quick attack/decay envelope, tuned to read as a soft "send click" and a
 * brighter "receive pop." Zero asset weight, works offline, no licensing
 * question.
 */

const STORAGE_KEY = 'pulsechat.sound-enabled';

function loadEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

let enabled = loadEnabled();
const listeners = new Set<() => void>();

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(next: boolean): void {
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    // Storage unavailable (private mode etc.) — preference just won't persist.
  }
  for (const listener of listeners) listener();
}

/** Settings toggle binding — stays in sync if changed elsewhere (e.g. another tab). */
export function useSoundEnabled(): boolean {
  const [value, setValue] = useState(enabled);
  useEffect(() => {
    const listener = () => setValue(enabled);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return value;
}

// ── Synthesis ─────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

// Browsers only allow an AudioContext to start truly "running" after a user
// gesture — prime it on the first tap/click/keypress anywhere in the app so
// it's already unlocked by the time a message-received sound needs to fire
// (which happens on a server push, not directly inside a gesture handler).
if (typeof document !== 'undefined') {
  const unlock = () => {
    getAudioContext();
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
}

function tone(
  ctx: AudioContext,
  frequencyHz: number,
  startAt: number,
  durationSec: number,
  peakGain: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequencyHz;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec + 0.02);
}

export type SoundKind = 'send' | 'receive';

export function playSound(kind: SoundKind): void {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  if (kind === 'send') {
    tone(ctx, 720, now, 0.07, 0.05);
    tone(ctx, 1020, now + 0.045, 0.06, 0.04);
  } else {
    tone(ctx, 880, now, 0.12, 0.07);
    tone(ctx, 1175, now + 0.09, 0.14, 0.055);
  }
}
