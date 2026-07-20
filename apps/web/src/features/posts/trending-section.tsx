import { useState } from 'react';
import type { TrendingMovieDto, TrendingSongDto } from '@pulsechat/shared';
import { Modal } from '../../components/ui/modal';
import { Skeleton } from '../../components/ui/skeleton';
import { handleImageError } from '../../lib/image-fallback';
import { useTrendingMovies, useTrendingSongs } from './use-discover';

/**
 * §24.3 trending movies & songs — a discovery section deliberately separate
 * from the ranked post feed below it, so the two ranking systems (this one
 * external and static, the feed's engagement-based) are never conflated.
 * Renders nothing once loaded if the cache is still empty (e.g. TMDB key not
 * yet configured) rather than showing an empty-state block for a section
 * that's inherently optional chrome, not core content.
 */
export function TrendingSection() {
  const movies = useTrendingMovies();
  const songs = useTrendingSongs();
  const [openMovie, setOpenMovie] = useState<TrendingMovieDto | null>(null);

  const hasMovies = (movies.data?.items.length ?? 0) > 0;
  const hasSongs = (songs.data?.items.length ?? 0) > 0;
  const loading = movies.isLoading || songs.isLoading;

  if (!loading && !hasMovies && !hasSongs) return null;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface-raised p-4">
      <h2 className="text-sm font-semibold tracking-wide text-fg-muted uppercase">Trending</h2>

      {loading && (
        <div aria-hidden className="flex gap-3">
          <Skeleton className="h-40 w-28 shrink-0 rounded-xl" />
          <Skeleton className="h-40 w-28 shrink-0 rounded-xl" />
          <Skeleton className="h-40 w-28 shrink-0 rounded-xl" />
        </div>
      )}

      {hasMovies && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-fg-muted">Movies</h3>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {movies.data!.items.map((movie) => (
              <button
                key={movie.id}
                type="button"
                onClick={() => setOpenMovie(movie)}
                className="w-28 shrink-0 text-left"
              >
                <div className="aspect-[2/3] w-28 overflow-hidden rounded-xl bg-surface-sunken">
                  {movie.posterUrl && (
                    <img
                      src={movie.posterUrl}
                      alt=""
                      loading="lazy"
                      onError={handleImageError}
                      className="size-full object-cover"
                    />
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-fg">{movie.title}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {hasSongs && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-fg-muted">Songs</h3>
          <div className="flex flex-col gap-2">
            {songs.data!.items.map((song) => (
              <SongRow key={song.id} song={song} />
            ))}
          </div>
        </div>
      )}

      {openMovie && (
        <Modal open onClose={() => setOpenMovie(null)} title={openMovie.title}>
          <div className="flex gap-3">
            {openMovie.posterUrl && (
              <img
                src={openMovie.posterUrl}
                alt=""
                onError={handleImageError}
                className="h-40 w-28 shrink-0 rounded-xl object-cover"
              />
            )}
            <p className="text-sm text-fg-muted">
              {openMovie.overview ?? 'No synopsis available.'}
            </p>
          </div>
        </Modal>
      )}
    </section>
  );
}

function SongRow({ song }: { song: TrendingSongDto }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-1 py-1">
      <div className="size-10 shrink-0 overflow-hidden rounded-lg bg-surface-sunken">
        {song.coverUrl && (
          <img
            src={song.coverUrl}
            alt=""
            onError={handleImageError}
            className="size-full object-cover"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{song.title}</p>
        <p className="truncate text-xs text-fg-muted">{song.artist}</p>
      </div>
      {song.previewUrl && (
        // §24.3 — inline preview playback where the source API provides a clip.
        <audio src={song.previewUrl} controls preload="none" className="h-8 w-40" />
      )}
    </div>
  );
}
