/**
 * Status background-music catalog (Requirement Scope §11, Technical Spec §1
 * "Status background music"). These are **placeholders** — the real CC0 track
 * pick from Free Music Archive / Pixabay Music / Chosic is a pending manual
 * step (ROADMAP.md "Pending manual setup"), not blocking this milestone's
 * code. `fileUrl` points at paths that don't exist on disk yet; the player
 * treats a 404 as "track unavailable" rather than failing the whole status.
 * Swapping in real files later is a data-only change to this list.
 */
export interface StatusMusicTrack {
  id: string;
  title: string;
  artist: string;
  fileUrl: string;
}

export const STATUS_MUSIC_TRACKS: readonly StatusMusicTrack[] = [
  {
    id: 'placeholder-1',
    title: 'Morning Glow',
    artist: 'TBD (CC0)',
    fileUrl: '/audio/status/placeholder-1.mp3',
  },
  {
    id: 'placeholder-2',
    title: 'City Lights',
    artist: 'TBD (CC0)',
    fileUrl: '/audio/status/placeholder-2.mp3',
  },
  {
    id: 'placeholder-3',
    title: 'Chill Wave',
    artist: 'TBD (CC0)',
    fileUrl: '/audio/status/placeholder-3.mp3',
  },
  {
    id: 'placeholder-4',
    title: 'Golden Hour',
    artist: 'TBD (CC0)',
    fileUrl: '/audio/status/placeholder-4.mp3',
  },
  {
    id: 'placeholder-5',
    title: 'Late Night',
    artist: 'TBD (CC0)',
    fileUrl: '/audio/status/placeholder-5.mp3',
  },
  {
    id: 'placeholder-6',
    title: 'Open Road',
    artist: 'TBD (CC0)',
    fileUrl: '/audio/status/placeholder-6.mp3',
  },
];
