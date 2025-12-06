// -----------------------------
// CORS
// -----------------------------
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
// PST 7 day check
// -----------------------------
function inLast7PstDays(airdate) {
  if (!airdate) return false;

  const now = new Date();
  const pstNow = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  );

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(pstNow);
    d.setDate(pstNow.getDate() - i);
    days.push(d.toISOString().split("T")[0]);
  }

  return days.includes(airdate);
}

// -----------------------------
// Build catalog (slow, cached)
// -----------------------------
async function buildCatalog() {
  console.log("Building catalog…");

  const MAX_PAGES = 20;
  const excluded = ["Talk Show", "News"];
  const recentShows = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const shows = await fetchWithRetry(`https://api.tvmaze.com/shows?page=${page}`);
    if (!Array.isArray(shows)) continue;

    const chunkSize = 10;

    for (let i = 0; i < shows.length; i += chunkSize) {
      const chunk = shows.slice(i, i + chunkSize);

      const results = await Promise.all(
        chunk.map(async s => {
          if (excluded.includes(s.type)) return null;

          const eps = await fetchWithRetry(`https://api.tvmaze.com/shows/${s.id}/episodes`);
          if (!eps) return null;

          const recentEps = eps.filter(e => inLast7PstDays(e.airdate));
          if (recentEps.length === 0) return null;

          const latest = recentEps.reduce((a, b) =>
            a.airdate > b.airdate ? a : b
          ).airdate;

          return {
            id: `tvmaze:${s.id}`,
            type: "series",
            name: s.name,
            poster:
              s.image?.medium ||
              s.image?.original ||
              "https://static.strem.io/assets/placeholders/series.png",
            description: s.summary?.replace(/<[^>]*>/g, "") || "",
            latestAirdate: latest
          };
        })
      );

      recentShows.push(...results.filter(Boolean));
    }
  }

  recentShows.sort((a, b) => a.latestAirdate < b.latestAirdate ? 1 : -1);

  CATALOG_CACHE = recentShows;
  CACHE_TIMESTAMP = Date.now();

  console.log(`Catalog built. ${recentShows.length} shows cached.`);

  return recentShows;
}

// -----------------------------
// MAIN HANDLER
// -----------------------------
export default async function handler(req, res) {
  for (const h in HEADERS) res.setHeader(h, HEADERS[h]);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { manifest, catalog, type, id } = req.query;

  // Manifest
  if (manifest !== undefined) {
    return res.status(200).json({
      id: "recent.tvmaze",
      version: "1.0.0",
      name: "Recent Episodes (TVmaze)",
      description: "Shows with episodes in the last 7 PST days",
      types: ["series"],
      resources: ["catalog", "meta"],
      catalogs: [
        { id: "recent", type: "series", name: "Recent Episodes (7 days)" }
      ],
      idPrefixes: ["tvmaze:"],
      endpoint: `https://${req.headers.host}/api`
    });
  }

  // ==========================
  // CATALOG (FAST FROM CACHE)
  // ==========================
  if (catalog === "recent" && type === "series") {
    const expired = Date.now() - CACHE_TIMESTAMP > CACHE_TTL;

    // Use cached catalog if fresh
    if (CATALOG_CACHE && !expired) {
      console.log("Serving catalog from cache");
      return res.status(200).json({ metas: CATALOG_CACHE });
    }

    // Otherwise rebuild
    try {
      const catalogData = await buildCatalog();
      return res.status(200).json({ metas: catalogData });
    } catch (err) {
      console.error("Catalog error:", err);
      return res.status(200).json({ metas: [] });
    }
  }

  // ==========================
  // META
  // ==========================
  if (id && id.startsWith("tvmaze:") && type === "series") {
    try {
      const showId = id.replace("tvmaze:", "");

      const show = await fetchWithRetry(`https://api.tvmaze.com/shows/${showId}`);
      const eps = await fetchWithRetry(`https://api.tvmaze.com/shows/${showId}/episodes`) || [];

      return res.status(200).json({
        meta: {
          id,
          type: "series",
          name: show?.name || "Unknown Show",
          poster:
            show?.image?.original ||
            show?.image?.medium ||
            eps?.[0]?.image?.original ||
            eps?.[0]?.image?.medium ||
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
    } catch (err) {
      console.error("META error:", err);
      return res.status(200).json({ meta: {} });
    }
  }

  return res.status(200).json({ status: "ok" });
}
