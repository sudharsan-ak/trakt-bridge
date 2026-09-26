import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { getContinueWatching } from "@/lib/continue-watching";

// Matches app.trakt.tv/users/me/progress: for shows, this is mostly
// next-episode-to-watch derived from watched history (/shows/{id}/progress/
// watched), not literal paused playback — Trakt's /sync/playback endpoints
// are only populated when a scrobbling client reports an actual mid-episode
// pause, which is empty for most accounts most of the time. See
// lib/continue-watching.ts for the full explanation and the merge logic.
//
// Accepts optional ?type=movie|show to match the website's Movies/Shows
// tabs; omitted returns both, matching the website's default Media tab.
export const GET = withTraktAuth(async (request, accessToken) => {
  const typeParam = new URL(request.url).searchParams.get("type");
  const type = typeParam === "movie" || typeParam === "show" ? typeParam : undefined;

  const items = await getContinueWatching(accessToken, { type });

  return NextResponse.json({ items });
});
