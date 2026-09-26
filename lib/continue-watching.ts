import { traktGet, traktGetAllPages } from "./trakt";

// Trakt exposes two different concepts under "continue watching", and the
// website's Continue Watching page (app.trakt.tv/users/me/progress) blends
// them together:
//
//   - actual paused playback position (/sync/playback/*) — only populated
//     when a scrobbling client reports a mid-episode/mid-movie pause, which
//     for most accounts is empty most of the time.
//   - "next episode to watch" per show, derived from watched history via
//     /shows/{id}/progress/watched — this is what fills most of the
//     website's page (e.g. "Modern Family S2E17, 210 left") even though
//     nothing was ever literally paused there.
//
// This file builds the website-equivalent view: one call per watched show
// (there is no bulk "next episode for all my shows" endpoint on Trakt), plus
// the playback lists merged in for genuinely in-progress items. Shows that
// are fully caught up (no next_episode) are excluded, matching the website.

interface RawShowIds {
  trakt?: number;
  slug?: string;
  imdb?: string;
  tmdb?: number;
}

interface RawEpisode {
  season?: number;
  number?: number;
  title?: string;
}

interface RawWatchedShowEntry {
  last_watched_at?: string;
  show?: { ids?: RawShowIds; title?: string; year?: number };
}

interface RawShowProgress {
  aired?: number;
  completed?: number;
  next_episode?: RawEpisode | null;
}

interface RawPlaybackEntry {
  progress?: number;
  paused_at?: string;
  type?: "movie" | "episode";
  movie?: { title?: string; year?: number; ids?: RawShowIds };
  show?: { title?: string; year?: number; ids?: RawShowIds };
  episode?: RawEpisode;
}

export interface ContinueWatchingItem {
  type: "movie" | "show";
  title: string;
  traktId: number | null;
  year: number | null;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  remainingEpisodes?: number;
  lastActivityAt: string;
  /** true if this came from an actual saved pause position rather than next-episode inference */
  isPaused: boolean;
}

export interface GetContinueWatchingOptions {
  /** Only return this type; omit for both, matching the website's "Media" tab. */
  type?: "movie" | "show";
}

export async function getContinueWatching(
  accessToken: string,
  options: GetContinueWatchingOptions = {}
): Promise<ContinueWatchingItem[]> {
  const wantMovies = options.type !== "show";
  const wantShows = options.type !== "movie";

  const [playbackMovies, playbackEpisodes, watchedShows] = await Promise.all([
    wantMovies ? traktGet<RawPlaybackEntry[]>({ accessToken, path: "/sync/playback/movies" }) : Promise.resolve([]),
    wantShows ? traktGet<RawPlaybackEntry[]>({ accessToken, path: "/sync/playback/episodes" }) : Promise.resolve([]),
    wantShows
      ? traktGetAllPages<RawWatchedShowEntry>({ accessToken, path: "/sync/watched/shows" })
      : Promise.resolve([]),
  ]);

  const items: ContinueWatchingItem[] = [];
  const pausedShowIds = new Set<number>();

  for (const entry of playbackMovies ?? []) {
    if (entry.type !== "movie" || !entry.movie) continue;
    items.push({
      type: "movie",
      title: entry.movie.title ?? "",
      traktId: entry.movie.ids?.trakt ?? null,
      year: entry.movie.year ?? null,
      lastActivityAt: entry.paused_at ?? "",
      isPaused: true,
    });
  }

  for (const entry of playbackEpisodes ?? []) {
    if (entry.type !== "episode" || !entry.show) continue;
    const showTraktId = entry.show.ids?.trakt ?? null;
    if (showTraktId !== null) pausedShowIds.add(showTraktId);
    items.push({
      type: "show",
      title: entry.show.title ?? "",
      traktId: showTraktId,
      year: entry.show.year ?? null,
      season: entry.episode?.season,
      episode: entry.episode?.number,
      episodeTitle: entry.episode?.title,
      lastActivityAt: entry.paused_at ?? "",
      isPaused: true,
    });
  }

  // Next-episode-to-watch for every watched show that isn't already covered
  // by an actual paused position and isn't fully caught up. One request per
  // show — there is no bulk equivalent on Trakt's API.
  const showsToCheck = (watchedShows ?? []).filter((entry) => {
    const traktId = entry.show?.ids?.trakt;
    return traktId !== undefined && !pausedShowIds.has(traktId);
  });

  const progressResults = await Promise.all(
    showsToCheck.map(async (entry) => {
      const traktId = entry.show!.ids!.trakt!;
      const progress = await traktGet<RawShowProgress>({
        accessToken,
        path: `/shows/${traktId}/progress/watched`,
        searchParams: { hidden: "false", specials: "false" },
      });
      return { entry, progress };
    })
  );

  for (const { entry, progress } of progressResults) {
    if (!progress?.next_episode) continue; // fully caught up or no data — excluded, matching the website

    const aired = progress.aired ?? 0;
    const completed = progress.completed ?? 0;

    items.push({
      type: "show",
      title: entry.show?.title ?? "",
      traktId: entry.show?.ids?.trakt ?? null,
      year: entry.show?.year ?? null,
      season: progress.next_episode.season,
      episode: progress.next_episode.number,
      episodeTitle: progress.next_episode.title,
      remainingEpisodes: Math.max(aired - completed, 0),
      lastActivityAt: entry.last_watched_at ?? "",
      isPaused: false,
    });
  }

  items.sort((a, b) => (b.lastActivityAt || "").localeCompare(a.lastActivityAt || ""));

  return items;
}

export async function getPlaybackProgress(accessToken: string): Promise<ContinueWatchingItem[]> {
  const [playbackMovies, playbackEpisodes] = await Promise.all([
    traktGet<RawPlaybackEntry[]>({ accessToken, path: "/sync/playback/movies" }),
    traktGet<RawPlaybackEntry[]>({ accessToken, path: "/sync/playback/episodes" }),
  ]);

  const items: ContinueWatchingItem[] = [];

  for (const entry of playbackMovies ?? []) {
    if (entry.type !== "movie" || !entry.movie) continue;
    items.push({
      type: "movie",
      title: entry.movie.title ?? "",
      traktId: entry.movie.ids?.trakt ?? null,
      year: entry.movie.year ?? null,
      lastActivityAt: entry.paused_at ?? "",
      isPaused: true,
    });
  }

  for (const entry of playbackEpisodes ?? []) {
    if (entry.type !== "episode" || !entry.show) continue;
    items.push({
      type: "show",
      title: entry.show.title ?? "",
      traktId: entry.show.ids?.trakt ?? null,
      year: entry.show.year ?? null,
      season: entry.episode?.season,
      episode: entry.episode?.number,
      episodeTitle: entry.episode?.title,
      lastActivityAt: entry.paused_at ?? "",
      isPaused: true,
    });
  }

  return items;
}
