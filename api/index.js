const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json"
};

// -----------------------------
// In-memory cache
// -----------------------------
let CATALOG_CACHE = null;
let CACHE_TIMESTAMP = 0;
const CACHE_TTL = 1000 * 60 * 180; // 3 hours

// -----------------------------
// Safe fetch with retry
// -----------------------------
async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      return await res.json();
    } catch (err) {
      if (i === retries) {
        console.error("Fetch failed:", url, err.message);
        return null;
      }
      await new Promise(r => setTimeout(r, 200));
    }
  }
}

// -----------------------------
// Check PST last 7 days
// -----------------------------
function inLast7PstDays(airdate) {
  if (!airdate) return false;
  const now = new Date();
  const pstNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(pstNow);
    d.setDate(pstNow.getDate() - i);
    days.push(d.toISOString().split("T")[0]);
  }
  return days.includes(airdate);
}

// -----------------------------
// Build full catalog (Option A)
// -----------------------------
async function buildCatalog() {
  console.log("Building full catalog…");
  const MAX_PAGES = 20; // ~5000 shows
  const excluded = ["Talk Show", "News"];
  const recentShows = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const shows = await fetchWithRetry(`https://api.tvmaze.com/shows?page=${page}`);
    if (!Array.isArray(shows)) continue;

    for (const s of shows) {
      if (excluded.includes(s.type)) continue;

      const eps = await fetchWithRetry(`https://api.tvmaze.com/shows/${s.id}/episodes`);
      if (!eps) continue;

      const recentEps = eps.filter(e => inLast7PstDays(e.airdate));
      if (!recentEps.length) continue;

      // Determine latest airdate for sorting
      const latest = recentEps.reduce((a, b) => (a.airdate > b.airdate ? a : b)).airdate;

      recentShows.push({
        id: `tvmaze:${s.id}`,
        type: "series",
        name: s.name,
        poster:
          s.image?.medium ||
          s.image?.original ||
          "https://static.strem.io/assets/placeholders/series.png",
        description: s.summary?.replace(/<[^>]*>/g, "") || "",
        latestAirdate: latest
      });
    }
  }

  // Sort by latest episode airdate descending
  recentShows.sort((a, b) => (a.latestAirdate < b.latestAirdate ? 1 : -1));

  CATALOG_CACHE = recentShows;
  CACHE_TIMESTAMP = Date.now();

  console.log(`Catalog built with ${recentShows.length} shows`);
  return recentShows;
}

// -----------------------------
// MAIN HANDLER
// -----------------------------
export default async function handler(req, res) {
  for (const h in HEADERS) res.setHeader(h, HEADERS[h]);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { manifest, catalog, type, id } = req.query;

  // MANIFEST
  if (manifest !== undefined) {
    return res.status(200).json({
      id: "recent.tvmaze",
      version: "3.0.0",
      name: "Recent Episodes (TVmaze)",
      description: "Shows with episodes in the last 7 PST days",
      types: ["series"],
      resources: ["catalog", "meta"],
      catalogs: [{ id: "recent", type: "series", name: "Recent Episodes (7 days)" }],
      idPrefixes: ["tvmaze:"],
      endpoint: `https://${req.headers.host}/api`
    });
  }

  // CATALOG
  if (catalog === "recent" && type === "series") {
    const expired = Date.now() - CACHE_TIMESTAMP > CACHE_TTL;

    if (CATALOG_CACHE && !expired) {
      console.log("Serving catalog from cache");
      return res.status(200).json({ metas: CATALOG_CACHE });
    }

    console.log("Rebuilding catalog from all shows…");
    const data = await buildCatalog();
    return res.status(200).json({ metas: data });
  }

  // META
  if (id && id.startsWith("tvmaze:") && type === "series") {
    const showId = id.replace("tvmaze:", "");
    const show = await fetchWithRetry(`https://api.tvmaze.com/shows/${showId}`);
    const eps = await fetchWithRetry(`https://api.tvmaze.com/shows/${showId}/episodes`) || [];

    return res.status(200).json({
      meta: {
        id,
        type: "series",
        name: show?.name,
        poster:
          show?.image?.original ||
          show?.image?.medium ||
          eps?.[0]?.image?.original ||
          "https://static.strem.io/assets/placeholders/series.png",
        description: show?.summary?.replace(/<[^>]*>/g, "") || "",
        episodes: eps.map(e => ({
          id: `tvmaze:${showId}:s${e.season}e${e.number}`,
          series: id,
          type: "episode",
          season: e.season,
          episode: e.number,
          name: e.name,
          released: e.airdate,
          thumbnail: e.image?.medium || e.image?.original || null
        }))
      }
    });
  }

  return res.status(200).json({ status: "ok" });
}
