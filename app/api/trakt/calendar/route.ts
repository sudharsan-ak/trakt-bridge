import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { traktGet } from "@/lib/trakt";
import type { NormalizedItem } from "@/lib/normalize";

// GET /calendars/my/shows/{start_date}/{days}
// https://docs.trakt.tv/reference/getcalendarsshows
// Accepts optional ?days= (default 14). Always starts from today.
interface CalendarShowEntry {
  first_aired?: string;
  episode?: { season?: number; number?: number; title?: string };
  show?: {
    title?: string;
    year?: number;
    ids?: { trakt?: number; slug?: string; imdb?: string; tmdb?: number };
    overview?: string;
    genres?: string[];
  };
}

export const GET = withTraktAuth(async (request, accessToken) => {
  const days = Number(new URL(request.url).searchParams.get("days")) || 14;
  const startDate = new Date().toISOString().slice(0, 10);

  const raw = await traktGet<CalendarShowEntry[]>({
    accessToken,
    path: `/calendars/my/shows/${startDate}/${days}`,
  });

  const items: NormalizedItem[] = (raw ?? []).map((entry) => ({
    title: entry.show?.title ?? "",
    year: entry.show?.year ?? null,
    traktId: entry.show?.ids?.trakt ?? null,
    slug: entry.show?.ids?.slug ?? "",
    imdbId: entry.show?.ids?.imdb ?? "",
    tmdbId: entry.show?.ids?.tmdb ?? null,
    watchedAt: "",
    listedAt: entry.first_aired ?? "",
    rating: null,
    genres: entry.show?.genres ?? [],
    runtime: null,
    overview: entry.episode?.title
      ? `S${entry.episode.season}E${entry.episode.number} - ${entry.episode.title}`
      : (entry.show?.overview ?? ""),
  }));

  return NextResponse.json({ items });
});
