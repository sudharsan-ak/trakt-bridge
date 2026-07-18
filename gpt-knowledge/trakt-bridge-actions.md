# Trakt Bridge - Action Reference

This describes every action available to this GPT for accessing the user's Trakt account via the trakt-bridge API (base URL `https://trakt-bridge.vercel.app`). Every call needs the `x-api-key` header already configured in this GPT's Action authentication - nothing below is called manually with a different key. Follow the rules in each section exactly, especially for `markWatched`.

## General rules

- All data is real and current as of the moment each action is called - nothing here is cached knowledge, always call the action rather than guessing from prior conversation.
- Every list-returning action can come back empty (e.g. an empty watchlist). An empty result means "no data," not an error.
- A 401 response means the API key is wrong/missing - this shouldn't happen through the configured Action, but if it does, tell the user rather than retrying silently.
- A 409 response means the user hasn't completed Trakt OAuth yet - tell them to visit `/api/trakt/login`.
- Never call `markWatched` without first calling `searchTraktTitle` and getting explicit user confirmation on the exact title, year, and poster shown. This is the only action that modifies the user's Trakt account and it is not easily reversible.

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
- **Always** before calling `markWatched` - this is the required first step.

If both `movie` and `show` come back non-null and the user's intent is ambiguous (a title that exists as both), ask which one they mean before proceeding - don't assume.

---

## markWatched

**Call:** `POST /api/trakt/mark-watched` with a JSON body - **this is a write action with real, not-easily-reversible effects on the user's account.**

**Request body:**
```json
{
  "traktId": 117143,
  "type": "movie",
  "watchedAt": "2026-07-18T09:31:00.000Z"
}
```
- `traktId` (integer, required) - must come from a prior `searchTraktTitle` call, never invented or guessed.
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

**Required process, every time, no exceptions:**
1. Call `searchTraktTitle` with the title the user mentioned.
2. Show the user the exact match found: title, year, and poster image (render the `posterUrl` as an image if possible, not just as a text link).
3. Ask the user to explicitly confirm this is the correct item before proceeding. A clear "yes" in response to a single unambiguous match is enough; if multiple plausible matches exist (movie and show with similar titles, or a title with multiple versions/years), list them and have the user pick one.
4. Only after explicit confirmation, call `markWatched` with the confirmed `traktId` and `type` from step 1's result.

Never call `markWatched` directly from a title without going through `searchTraktTitle` and confirmation first, even if the user seems certain - the confirmation step exists specifically to catch title ambiguity and wrong matches before they're written to a real account.

On success, tell the user plainly what was marked watched (title, year) and when. On a 404, tell the user the Trakt ID didn't resolve to anything and don't retry with a guessed ID - re-run `searchTraktTitle` instead.
