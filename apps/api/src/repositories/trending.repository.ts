import type { TrendingMovie, TrendingSong } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Data access for the §24.3 trending-content cache tables. The service layer
 * owns the fetch-from-TMDB/Deezer schedule; this layer only shapes queries.
 */

export async function replaceMovies(
  rows: Array<{
    id: string;
    title: string;
    posterUrl: string | null;
    overview: string | null;
    rank: number;
  }>,
): Promise<void> {
  if (rows.length === 0) return;
  await prisma.$transaction([
    prisma.trendingMovie.deleteMany({}),
    prisma.trendingMovie.createMany({ data: rows }),
  ]);
}

export async function replaceSongs(
  rows: Array<{
    id: string;
    title: string;
    artist: string;
    coverUrl: string | null;
    previewUrl: string | null;
    rank: number;
  }>,
): Promise<void> {
  if (rows.length === 0) return;
  await prisma.$transaction([
    prisma.trendingSong.deleteMany({}),
    prisma.trendingSong.createMany({ data: rows }),
  ]);
}

export function listMovies(options: { cursor?: string; limit: number }): Promise<TrendingMovie[]> {
  return prisma.trendingMovie.findMany({
    orderBy: [{ rank: 'asc' }, { id: 'asc' }],
    take: options.limit,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
}

export function listSongs(options: { cursor?: string; limit: number }): Promise<TrendingSong[]> {
  return prisma.trendingSong.findMany({
    orderBy: [{ rank: 'asc' }, { id: 'asc' }],
    take: options.limit,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
}
