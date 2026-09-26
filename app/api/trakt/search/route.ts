import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { searchTraktTitle } from "@/lib/search";

// GET /search/movie and /search/show — https://docs.trakt.tv/reference/getsearchquery
export const GET = withTraktAuth(async (request, accessToken) => {
  const title = new URL(request.url).searchParams.get("title");
  if (!title) {
    return NextResponse.json({ error: "Missing required 'title' query parameter" }, { status: 400 });
  }

  const result = await searchTraktTitle(accessToken, title);
  return NextResponse.json(result);
});
