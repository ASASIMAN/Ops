import { getGoogleAccessToken } from "./oauth";

// Search Console Search Analytics API - real organic search performance,
// replacing the "not connected" status this has had all build.
export interface SearchConsoleDailyRow {
  date: string; // YYYY-MM-DD
  clicks: number;
  impressions: number;
  ctr: number; // 0-1
  position: number; // average
}

export async function fetchSearchConsoleDaily(
  startDate: string,
  endDate: string,
): Promise<SearchConsoleDailyRow[]> {
  const refreshToken = process.env.GOOGLE_GSC_REFRESH_TOKEN;
  const siteUrl = process.env.GOOGLE_GSC_SITE_URL;
  if (!refreshToken || !siteUrl) {
    throw new Error(
      "Search Console is not configured. Set GOOGLE_GSC_REFRESH_TOKEN and GOOGLE_GSC_SITE_URL.",
    );
  }

  const accessToken = await getGoogleAccessToken(refreshToken);

  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ["date"],
        rowLimit: 1000,
      }),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Search Console query failed: HTTP ${res.status} ${body}`);
  }

  const body = (await res.json()) as {
    rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[];
  };

  return (body.rows ?? []).map((row) => ({
    date: row.keys[0],
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
  }));
}
