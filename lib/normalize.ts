// Shared normalized item shape returned for every movie/show across all
// trakt-bridge endpoints.
export interface NormalizedItem {
  title: string;
  year: number | null;
  traktId: number | null;
  slug: string;
  imdbId: string;
  tmdbId: number | null;
  watchedAt: string;
  listedAt: string;
  rating: number | null;
  genres: string[];
  runtime: number | null;
  overview: string;
  posterUrl: string;
}

interface RawIds {
  trakt?: number;
  slug?: string;
  imdb?: string;
  tmdb?: number;
}

interface RawImages {
  poster?: string[];
}

interface RawMovieOrShow {
  title?: string;
  year?: number;
  ids?: RawIds;
  genres?: string[];
  runtime?: number;
  overview?: string;
  images?: RawImages;
}

// Trakt's poster URLs come back protocol-relative (e.g. "media.trakt.tv/...")
function posterUrlFrom(images?: RawImages): string {
  const path = images?.poster?.[0];
  if (!path) return "";
  return path.startsWith("http") ? path : `https://${path}`;
}

// Trakt wraps the movie/show object differently per endpoint (sync/history
// nests it under "movie" or "show", sync/watched too, recommendations return
// it flat, etc). This accepts either the wrapper or the bare object.
interface NormalizeInput {
  movie?: RawMovieOrShow;
  show?: RawMovieOrShow;
  title?: string;
  year?: number;
  ids?: RawIds;
  genres?: string[];
  runtime?: number;
  overview?: string;
  images?: RawImages;
  watched_at?: string;
  last_watched_at?: string;
  listed_at?: string;
  collected_at?: string;
  rated_at?: string;
  rating?: number;
}

export function normalizeItem(raw: NormalizeInput): NormalizedItem {
  const media = raw.movie ?? raw.show ?? raw;

  return {
    title: media.title ?? "",
    year: media.year ?? null,
    traktId: media.ids?.trakt ?? null,
    slug: media.ids?.slug ?? "",
    imdbId: media.ids?.imdb ?? "",
    tmdbId: media.ids?.tmdb ?? null,
    watchedAt: raw.watched_at ?? raw.last_watched_at ?? "",
    listedAt: raw.listed_at ?? raw.collected_at ?? "",
    rating: raw.rating ?? null,
    genres: media.genres ?? [],
    runtime: media.runtime ?? null,
    overview: media.overview ?? "",
    posterUrl: posterUrlFrom(media.images),
  };
}

export function normalizeList(raw: unknown): NormalizedItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => normalizeItem(item as NormalizeInput));
}
