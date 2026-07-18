import { NextResponse } from "next/server";
import { withTraktAuth } from "@/lib/api-handler";
import { traktGet } from "@/lib/trakt";

// GET /users/settings — https://docs.trakt.tv/reference/getuserssettings
interface UserSettingsResponse {
  user?: { username?: string; name?: string | null };
}

export const GET = withTraktAuth(async (_request, accessToken) => {
  const settings = await traktGet<UserSettingsResponse>({ accessToken, path: "/users/settings" });

  return NextResponse.json({
    profile: {
      username: settings?.user?.username ?? "",
      name: settings?.user?.name ?? "",
    },
  });
});
