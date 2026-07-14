import { useQuery } from '@tanstack/react-query';
import type { TrendingMovieDto, TrendingSongDto } from '@pulsechat/shared';
import { get } from '../../lib/api';

/**
 * §24.3 trending movies & songs — a small cached set served straight from
 * the API's own cache tables (never queried live from client to TMDB/Deezer).
 * Query-only, no mutations, so a plain `useQuery` fits better than the
 * infinite-scroll pattern the rest of `use-posts.ts` uses for open-ended
 * feeds.
 */

export function useTrendingMovies() {
  return useQuery({
    queryKey: ['discover', 'movies'] as const,
    queryFn: () => get<{ items: TrendingMovieDto[] }>('/discover/movies'),
    staleTime: 60_000,
  });
}

export function useTrendingSongs() {
  return useQuery({
    queryKey: ['discover', 'songs'] as const,
    queryFn: () => get<{ items: TrendingSongDto[] }>('/discover/songs'),
    staleTime: 60_000,
  });
}
