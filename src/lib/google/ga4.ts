import { getGoogleAccessToken } from "./oauth";

// GA4 Data API - real website traffic, replacing the "not connected"
// status this has had all build. Metrics kept to the standard GA4 set
// (no custom events/conversions defined for this property yet, so
// nothing beyond what GA4 tracks out of the box is requested).
export interface Ga4DailyRow {
  date: string; // YYYY-MM-DD
  sessions: number;
  activeUsers: number;
  newUsers: number;
  screenPageViews: number;
  engagementRate: number; // 0-1
  averageSessionDuration: number; // seconds
}

export async function fetchGa4Daily(startDate: string, endDate: string): Promise<Ga4DailyRow[]> {
  const refreshToken = process.env.GOOGLE_GA4_REFRESH_TOKEN;
  const propertyId = process.env.GOOGLE_GA4_PROPERTY_ID;
  if (!refreshToken || !propertyId) {
    throw new Error(
      "GA4 is not configured. Set GOOGLE_GA4_REFRESH_TOKEN and GOOGLE_GA4_PROPERTY_ID.",
    );
  }

  const accessToken = await getGoogleAccessToken(refreshToken);

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "sessions" },
          { name: "activeUsers" },
          { name: "newUsers" },
          { name: "screenPageViews" },
          { name: "engagementRate" },
          { name: "averageSessionDuration" },
        ],
        orderBys: [{ dimension: { dimensionName: "date" } }],
      }),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GA4 runReport failed: HTTP ${res.status} ${body}`);
  }

  const body = (await res.json()) as {
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  };

  return (body.rows ?? []).map((row) => {
    const d = row.dimensionValues[0].value; // YYYYMMDD
    const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const [sessions, activeUsers, newUsers, screenPageViews, engagementRate, averageSessionDuration] =
      row.metricValues.map((m) => Number(m.value));
    return { date, sessions, activeUsers, newUsers, screenPageViews, engagementRate, averageSessionDuration };
  });
}
