/**
 * Only one `<audio>` element plays at a time across the app (trending song
 * previews, voice message playback, status background music) — starting one
 * pauses whichever other one was already playing. Live call audio
 * (features/calls/call-overlay.tsx) is deliberately NOT wired into this: a
 * song preview pausing an active call's remote audio would be a much worse
 * surprise than the reverse, so calls are left out of the shared registry.
 */

let current: HTMLAudioElement | null = null;

/** Attach as `onPlay` on any `<audio>` tag that should take part. */
export function registerPlayingAudio(event: { currentTarget: HTMLAudioElement }): void {
  const el = event.currentTarget;
  if (current && current !== el) current.pause();
  current = el;
}
