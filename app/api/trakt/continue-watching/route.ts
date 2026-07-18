import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { traktGet } from "@/lib/trakt";
import { normalizeList } from "@/lib/normalize";

// GET /sync/playback — https://docs.trakt.tv/reference/getsyncprogressplayback
// Returns in-progress movies and episodes mixed together; Trakt doesn't
// expose a reliable per-item type flag in the shared normalized shape, so
// both come back in one "items" array (each item's presence of a "runtime"
// vs episode fields would need extra per-item Trakt calls to disambiguate,
// which isn't worth it for a continue-watching list).
export const GET = withTraktAuth(async (_request, accessToken) => {
  const playback = await traktGet({ accessToken, path: "/sync/playback" });

  return NextResponse.json({
    items: normalizeList(playback),
  });
});
