import type { TrendingMovie, TrendingSong } from '@prisma/client';
import { LIMITS, type Page, type TrendingMovieDto, type TrendingSongDto } from '@pulsechat/shared';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import * as trendingRepo from '../repositories/trending.repository.js';

/**
 * §24.3 trending movies & songs: a scheduled fetch against TMDB (movies) and
 * Deezer's public chart (songs, no key required) populates the cache tables
 * — the API itself never calls either provider on a user request, so client
 * traffic can never blow either provider's free-tier rate limit. TMDB is
 * optional (same no-op-until-configured pattern as TURN/VAPID/Brevo): until
 * `TMDB_API_KEY` is set, the sweep just skips movies and keeps songs fresh.
 */

const ITEMS = LIMITS.TRENDING_ITEMS_PER_SOURCE;
let sweepHandle: NodeJS.Timeout | null = null;

interface TmdbMovie {
  id: number;
  title: string;
  poster_path: string | null;
  overview: string | null;
}

async function refreshMovies(): Promise<void> {
  if (!env.TMDB_API_KEY) return;
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/trending/movie/day?api_key=${env.TMDB_API_KEY}`,
    );
    if (!res.ok) throw new Error(`TMDB responded ${res.status}`);
    const data = (await res.json()) as { results?: TmdbMovie[] };
    const rows = (data.results ?? []).slice(0, ITEMS).map((movie, index) => ({
      id: String(movie.id),
      title: movie.title,
      posterUrl: movie.poster_path ? `https://image.tmdb.org/t/p/w342${movie.poster_path}` : null,
      overview: movie.overview,
      rank: index,
    }));
    await trendingRepo.replaceMovies(rows);
    logger.info(
      { event: 'trending.movies_refreshed', count: rows.length },
      'trending movies refreshed',
    );
  } catch (error) {
    logger.error({ event: 'trending.movies_failed', err: error }, 'trending movies refresh failed');
  }
}

interface DeezerTrack {
  id: number;
  title: string;
  preview: string | null;
  artist?: { name?: string };
  album?: { cover_medium?: string };
}

async function refreshSongs(): Promise<void> {
  try {
    const res = await fetch(`https://api.deezer.com/chart/0/tracks?limit=${ITEMS}`);
    if (!res.ok) throw new Error(`Deezer responded ${res.status}`);
    const data = (await res.json()) as { data?: DeezerTrack[] };
    const rows = (data.data ?? []).slice(0, ITEMS).map((track, index) => ({
      id: String(track.id),
      title: track.title,
      artist: track.artist?.name ?? 'Unknown artist',
      coverUrl: track.album?.cover_medium ?? null,
      previewUrl: track.preview ?? null,
      rank: index,
    }));
    await trendingRepo.replaceSongs(rows);
    logger.info(
      { event: 'trending.songs_refreshed', count: rows.length },
      'trending songs refreshed',
    );
  } catch (error) {
    logger.error({ event: 'trending.songs_failed', err: error }, 'trending songs refresh failed');
  }
}

export async function refreshTrending(): Promise<void> {
  await Promise.all([refreshMovies(), refreshSongs()]);
}

/** Started once at boot (index.ts), same pattern as `status.service.startExpirySweep`. */
export function startTrendingSweep(): void {
  if (sweepHandle) return;
  void refreshTrending();
  sweepHandle = setInterval(() => void refreshTrending(), LIMITS.TRENDING_REFRESH_INTERVAL_MS);
  sweepHandle.unref();
}

// ── Read paths (GET /discover/movies, GET /discover/songs) ──────────────────

function toMovieDto(row: TrendingMovie): TrendingMovieDto {
  return { id: row.id, title: row.title, posterUrl: row.posterUrl, overview: row.overview };
}

function toSongDto(row: TrendingSong): TrendingSongDto {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    coverUrl: row.coverUrl,
    previewUrl: row.previewUrl,
  };
}

export async function listTrendingMovies(pagination: {
  cursor?: string;
  limit: number;
}): Promise<Page<TrendingMovieDto>> {
  const rows = await trendingRepo.listMovies({
    cursor: pagination.cursor,
    limit: pagination.limit + 1,
  });
  const pageRows = rows.slice(0, pagination.limit);
  return {
    items: pageRows.map(toMovieDto),
    ...(rows.length > pagination.limit ? { nextCursor: pageRows.at(-1)!.id } : {}),
  };
}

export async function listTrendingSongs(pagination: {
  cursor?: string;
  limit: number;
}): Promise<Page<TrendingSongDto>> {
  const rows = await trendingRepo.listSongs({
    cursor: pagination.cursor,
    limit: pagination.limit + 1,
  });
  const pageRows = rows.slice(0, pagination.limit);
  return {
    items: pageRows.map(toSongDto),
    ...(rows.length > pagination.limit ? { nextCursor: pageRows.at(-1)!.id } : {}),
  };
}
