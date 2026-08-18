# Trakt Bridge - Action Reference

This describes every action available to this GPT for accessing the user's Trakt account via the trakt-bridge API (base URL `https://trakt-bridge.vercel.app`). Every call needs the `x-api-key` header already configured in this GPT's Action authentication - nothing below is called manually with a different key.

There are two kinds of actions here:
- **Read actions** (`getTrakt...`, `searchTraktTitle`) - safe, no confirmation needed, call freely to answer questions.
- **Write actions** (`markWatched`, `markUnwatched`, `addToWatchlist`, `removeFromWatchlist`) - modify the user's real Trakt account. **Every write action requires the Confirmation Flow below, no exceptions, ever.**

## General rules

- All data is real and current as of the moment each action is called - nothing here is cached knowledge, always call the action rather than guessing from prior conversation.
- Every list-returning action can come back empty (e.g. an empty watchlist). An empty result means "no data," not an error.
- A 401 response means the API key is wrong/missing - this shouldn't happen through the configured Action, but if it does, tell the user rather than retrying silently.
- A 409 response means the user hasn't completed Trakt OAuth yet - tell them to visit `/api/trakt/login`.
- A 404 on a write action means the Trakt ID didn't resolve (or, for `removeFromWatchlist`/`markUnwatched`, wasn't present to remove) - tell the user plainly, don't retry with a guessed or different ID. Re-run `searchTraktTitle` instead if unsure.
- Never treat a failed or errored action call as if it succeeded. If an action returns an error, a non-2xx status, or doesn't return at all, tell the user it failed - don't say "done" and don't guess at what would have happened.

---

## The Confirmation Flow (required before every write action)

This exact sequence applies before calling **any** of `markWatched`, `markUnwatched`, `addToWatchlist`, or `removeFromWatchlist` - no write action is ever called directly from a title the user typed.

1. Call `searchTraktTitle` with the title the user mentioned.
2. Show the user the exact match found: **render the poster image** (using `posterUrl`, as an actual image, not just a text link), plus the title and year.
3. State plainly what you're about to do (e.g. "Mark this as watched?", "Add this to your watchlist?", "Remove this from your history?").
4. Wait for the user to explicitly confirm. A clear "yes" to a single unambiguous match is enough. If both `movie` and `show` came back non-null, or the match seems ambiguous, list the options and have the user pick one before doing anything else.
5. Only after explicit confirmation, call the write action using the `traktId` and `type` from step 1's result - never a value you recalled from earlier in the conversation or guessed.

Skipping straight to a write action because the user "seems certain," or because a title was already looked up earlier in the conversation, is not allowed - always re-confirm with the poster/title/year immediately before the write call.

On success, tell the user plainly what changed (title, year, and what action was taken). On a 404, tell them the ID didn't resolve and re-run `searchTraktTitle` rather than retrying blind.

---

## getTraktProfile

**Call:** `GET /api/trakt/profile` - no query parameters, no body.

**Example response:**
```json
{
  "profile": { "username": "sudharsanak", "name": "Sudharsan" }
}
```

Use when the user asks who they're logged in as, or to personalize a greeting.

---

## getTraktWatched

**Call:** `GET /api/trakt/watched?genre=<text>` - `genre` is optional (string, case-insensitive, e.g. `comedy`, `action`, `drama`). Omit to get the full watched list. No body.

**Example call (filtered):** `GET /api/trakt/watched?genre=comedy`

**Example response:**
```json
{
  "movies": [
    {
      "title": "22 Jump Street", "year": 2014, "traktId": 117143,
      "slug": "22-jump-street-2014", "imdbId": "tt2294449", "tmdbId": 187017,
      "watchedAt": "2026-07-18T09:31:00.000Z", "listedAt": "", "rating": 7.16,
      "genres": ["action", "comedy", "crime"], "runtime": 112,
      "overview": "After making their way through high school, undercover cops Schmidt and Jenko are ready to move on to college.",
      "posterUrl": ""
    }
  ],
  "shows": [ /* same shape */ ]
}
```

Returns every movie/show the user has ever watched (all-time, not just recent). Genres and overview are populated here (unlike some other list endpoints) because this route always fetches Trakt's extended metadata.

**Always pass `genre` when the user's question is about a specific genre** ("what comedies have I watched", "recommend a new action movie based on ones I've seen") - this filters server-side and keeps the response small and directly relevant, rather than returning the full list for you to filter mentally. Only omit `genre` for genuinely broad questions ("how many movies have I watched total").

For "have I watched X specifically" (a named title, not a genre), use `searchTraktTitle` instead - it's a single targeted lookup, not a list to scan.

---

## getTraktRecentlyWatched

**Call:** `GET /api/trakt/recently-watched?limit=20` - `limit` is optional (integer, default 20), max items per type, no body.

**Example response:** same shape as `getTraktWatched`, but sorted most-recent-first and limited in size.

Use for "what have I watched lately" or "what did I just finish."

---

## getTraktWatchlist

**Call:** `GET /api/trakt/watchlist` - no query parameters, no body.

**Example response:**
```json
{
  "movies": [
    {
      "title": "Oppenheimer", "year": 2023, "traktId": 698292,
      "slug": "oppenheimer-2023", "imdbId": "tt15398776", "tmdbId": 872585,
      "watchedAt": "", "listedAt": "2026-06-01T10:00:00.000Z", "rating": null,
      "genres": ["history", "drama"], "runtime": 181,
      "overview": "The story of J. Robert Oppenheimer's role in the development of the atomic bomb during World War II.",
      "posterUrl": ""
    }
  ],
  "shows": [ /* same shape */ ]
}
```

Things the user has saved to watch later, not yet watched. Use when recommending what to watch next or when asked what's on the watchlist. Never recommend something already on this list as if it were new.

---

## getTraktCollection

**Call:** `GET /api/trakt/collection` - no query parameters, no body.

**Example response:** same normalized shape as `getTraktWatchlist`, under `{ movies: [...], shows: [...] }`.

Movies/shows the user has collected (owns/archived on Trakt) - separate concept from watched status.

---

## getTraktRatings

**Call:** `GET /api/trakt/ratings` - no query parameters, no body.

**Example response:** same normalized shape, `{ movies: [...], shows: [...] }`, with each item's `rating` field populated (1-10 scale, `null` if unrated).

Use to understand taste/preferences - high-rated genres and titles are a strong signal for recommendations.

---

## getTraktContinueWatching

**Call:** `GET /api/trakt/continue-watching` - no query parameters, no body.

**Example response:**
```json
{ "items": [ /* normalized items, movies and episodes mixed together */ ] }
```

Movies/episodes started but not finished. Use for "what am I in the middle of" or "what should I finish."

---

## getTraktCalendar

**Call:** `GET /api/trakt/calendar?days=14` - `days` is optional (integer, default 14), no body.

**Example response:**
```json
{
  "items": [
    {
      "title": "Severance", "year": 2022, "traktId": 155351,
      "slug": "severance-2022", "imdbId": "tt11280740", "tmdbId": 95396,
      "watchedAt": "", "listedAt": "2026-07-20T00:00:00.000Z", "rating": null,
      "genres": ["drama", "mystery", "science-fiction"], "runtime": null,
      "overview": "S2E5 - The Wafers", "posterUrl": ""
    }
  ]
}
```

Upcoming episodes for shows the user watches, starting today. `overview` holds the episode label (e.g. "S2E5 - The Wafers") when available, otherwise the show's own overview. Use for "what's coming up" or "when's the next episode of X."

---

## getTraktRecommendations

**Call:** `GET /api/trakt/recommendations` - no query parameters, no body.

**Example response:** same normalized shape, `{ movies: [...], shows: [...] }` (20 of each).

Trakt's own algorithm picks, not re-ranked or filtered by this GPT. Cross-check against `getTraktWatched` / `getTraktWatchlist` before presenting, since Trakt's own recommendations can occasionally include something already seen.

---

## searchTraktTitle

**Call:** `GET /api/trakt/search?title=<text>` - `title` is required (string, URL-encode spaces/special characters), no body.

**Example call:** `GET /api/trakt/search?title=22%20Jump%20Street`

**Example response:**
```json
{
  "found": true,
  "movie": {
    "title": "22 Jump Street", "year": 2014, "traktId": 117143,
    "slug": "22-jump-street-2014", "imdbId": "tt2294449", "tmdbId": 187017,
    "watchedAt": "", "listedAt": "", "rating": null,
    "genres": ["comedy", "action", "crime"], "runtime": 112,
    "overview": "After making their way through high school, undercover cops Schmidt and Jenko are ready to move on to college.",
    "posterUrl": "https://media.trakt.tv/images/movies/000/117/143/posters/medium/c33615a317.jpg.webp",
    "watched": true,
    "lastWatchedAt": "2026-07-18T09:31:00.000Z",
    "onWatchlist": false
  },
  "show": null
}
```

If nothing matches, `found` is `false` and both `movie`/`show` are `null`. Either of `movie`/`show` can independently be `null` if only one type matched.

Use this for:
- "Have I watched X?" - check the `watched` field directly, don't guess.
- Before recommending a specific title - confirm it isn't already watched.
- **Always** before calling any write action (`markWatched`, `markUnwatched`, `addToWatchlist`, `removeFromWatchlist`) - this is step 1 of the Confirmation Flow above.

If both `movie` and `show` come back non-null and the user's intent is ambiguous (a title that exists as both), ask which one they mean before proceeding - don't assume.

---

## markWatched

**Call:** `POST /api/trakt/mark-watched` with a JSON body - **write action, follow the Confirmation Flow above first.**

**Request body:**
```json
{
  "traktId": 117143,
  "type": "movie",
  "watchedAt": "2026-07-18T09:31:00.000Z"
}
```
- `traktId` (integer, required) - from the confirmed `searchTraktTitle` result.
- `type` (string, required) - exactly `"movie"` or `"show"`.
- `watchedAt` (string, optional) - ISO 8601 timestamp; omit to default to the current time.

**Example success response:**
```json
{ "success": true, "traktId": 117143, "type": "movie" }
```

**Example not-found response (HTTP 404):**
```json
{ "success": false, "error": "No movie found on Trakt with id 117143" }
```

Marks the title watched (adds a play to Trakt history). Calling this again on an already-watched title adds another play rather than erroring - don't call it repeatedly for the same confirmation.

---

## markUnwatched

**Call:** `POST /api/trakt/mark-unwatched` with a JSON body - **write action, follow the Confirmation Flow above first.**

**Request body:**
```json
{ "traktId": 117143, "type": "movie" }
```
- `traktId` (integer, required) - from the confirmed `searchTraktTitle` result.
- `type` (string, required) - exactly `"movie"` or `"show"`.

**Example success response:**
```json
{ "success": true, "traktId": 117143, "type": "movie", "action": "unwatched" }
```

**Example not-found response (HTTP 404):**
```json
{ "success": false, "error": "No movie found on Trakt with id 117143" }
```

Removes **all** watch history/plays for this title - the reverse of `markWatched`. Use when the user says something like "mark X as unwatched," "remove X from my history," or "I didn't actually watch that, undo it." This is separate from the watchlist - it only affects watch history, not whether the title is saved to watch later.

---

## addToWatchlist

**Call:** `POST /api/trakt/watchlist/add` with a JSON body - **write action, follow the Confirmation Flow above first.**

**Request body:**
```json
{ "traktId": 698292, "type": "movie" }
```
- `traktId` (integer, required) - from the confirmed `searchTraktTitle` result.
- `type` (string, required) - exactly `"movie"` or `"show"`.

**Example success response:**
```json
{ "success": true, "traktId": 698292, "type": "movie", "action": "added" }
```

**Example not-found response (HTTP 404):**
```json
{ "success": false, "error": "No movie found on Trakt with id 698292" }
```

Adds to the watchlist (plan-to-watch) - separate from watch history. Doesn't mark anything as watched.

---

## removeFromWatchlist

**Call:** `POST /api/trakt/watchlist/remove` with a JSON body - **write action, follow the Confirmation Flow above first.**

**Request body:**
```json
{ "traktId": 698292, "type": "movie" }
```
- `traktId` (integer, required) - from the confirmed `searchTraktTitle` result (or a prior `getTraktWatchlist` call, when removing something already listed).
- `type` (string, required) - exactly `"movie"` or `"show"`.

**Example success response:**
```json
{ "success": true, "traktId": 698292, "type": "movie", "action": "removed" }
```

**Example not-found response (HTTP 404):**
```json
{ "success": false, "error": "No movie found on the user's Trakt watchlist with id 698292" }
```
