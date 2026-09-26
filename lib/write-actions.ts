import { traktPost } from "./trakt";

// The four write actions this bridge exposes, all built on the same
// request/response shape: resolve a Trakt ID + type, POST a /sync/*
// payload, check Trakt's not_found response. Shared by the REST
// /api/trakt/mark-watched, mark-unwatched, watchlist/add, watchlist/remove
// routes and the equivalent MCP tools so neither duplicates the other.
export type WriteAction = "mark_watched" | "mark_unwatched" | "watchlist_add" | "watchlist_remove";

export interface WriteActionParams {
  traktId: number;
  type: "movie" | "show";
  watchedAt?: string;
}

// The word shown in the response (both REST and MCP) for what happened —
// kept as one source of truth so the two paths never say different things
// about the same event.
export type WriteActionLabel = "watched" | "unwatched" | "added" | "removed";

export type WriteActionResult =
  | { success: true; traktId: number; type: "movie" | "show"; action: WriteActionLabel }
  | { success: false; error: string };

interface SyncNotFoundResponse {
  not_found: { movies?: unknown[] | null; shows?: unknown[] | null };
}

const ACTION_CONFIG: Record<
  WriteAction,
  { path: string; label: WriteActionLabel; buildEntry: (params: WriteActionParams) => Record<string, unknown> }
> = {
  mark_watched: {
    path: "/sync/history",
    label: "watched",
    buildEntry: (params) => ({
      ids: { trakt: params.traktId },
      watched_at: params.watchedAt ?? new Date().toISOString(),
    }),
  },
  mark_unwatched: {
    path: "/sync/history/remove",
    label: "unwatched",
    buildEntry: (params) => ({ ids: { trakt: params.traktId } }),
  },
  watchlist_add: {
    path: "/sync/watchlist",
    label: "added",
    buildEntry: (params) => ({ ids: { trakt: params.traktId } }),
  },
  watchlist_remove: {
    path: "/sync/watchlist/remove",
    label: "removed",
    buildEntry: (params) => ({ ids: { trakt: params.traktId } }),
  },
};

export async function performTraktWrite(
  accessToken: string,
  action: WriteAction,
  params: WriteActionParams
): Promise<WriteActionResult> {
  const { path, label, buildEntry } = ACTION_CONFIG[action];
  const key = params.type === "movie" ? "movies" : "shows";

  const result = await traktPost<SyncNotFoundResponse>({
    accessToken,
    path,
    body: { [key]: [buildEntry(params)] },
  });

  const notFound = (result.not_found[key] ?? []).length > 0;
  if (notFound) {
    return { success: false, error: `No ${params.type} found on Trakt with id ${params.traktId}` };
  }

  return { success: true, traktId: params.traktId, type: params.type, action: label };
}
