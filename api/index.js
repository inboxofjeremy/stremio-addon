const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json"
};

// -----------------------------
// In-memory cache
// -----------------------------
let CATALOG_CACHE = [];
let CACHE_TIMESTAMP = 0;
const CACHE_TTL = 1000 * 60 * 180; // 3 hours

// Track scan progress
let SCAN_IN_PROGRESS = false;
let CURRENT_PAGE = 0;

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
// Check last 7 PST days
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
// Progressive catalog build
// -----------------------------
async function progressiveBuild() {
  if (SCAN_IN_PROGRESS) return;
  SCAN_IN_PROGRESS = true;

  const MAX_PAGES = 20; // adjust if needed
  const excludedTypes = ["Talk Show", "News"];

  while (CURRENT_PAGE < MAX_PAGES) {
    try {
      const shows = await fetchWithRetry(`https://api.tvmaze.com/shows?page=${CURRENT_PAGE}`);
      if (!Array.isArray(shows)) break;

      for (const s of shows) {
        if (excludedTypes.includes(s.type)) continue;

        const eps = await fetchWithRetry(`https://api.tvmaze.com/shows/${s.id}/episodes`);
        if (!Array.isArray(eps)) continue;

        const recentEps = eps.filter(e => inLast7PstDays(e.airdate));
        if (!recentEps.length) continue;

        const latest = recentEps.reduce((a, b) => (a.airdate > b.airdate ? a : b)).airdate;

        // Avoid duplicates
        if (!CATALOG_CACHE.some(x => x.id === `tvmaze:${s.id}`)) {
          CATALOG_CACHE.push({
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

      CURRENT_PAGE++;
    } catch (err) {
      console.error("Progressive scan error:", err);
      break;
    }
  }

  // Sort by latest airdate descending
  CATALOG_CACHE.sort((a, b) => (a.latestAirdate < b.latestAirdate ? 1 : -1));
  CACHE_TIMESTAMP = Date.now();
  SCAN_IN_PROGRESS = false;
  console.log(`Progressive catalog build complete. Total shows: ${CATALOG_CACHE.length}`);
}

// -----------------------------
// MAIN HANDLER
// -----------------------------
export default async function handler(req, res) {
  for (const h in HEADERS) res.setHeader(h, HEADERS[h]);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { manifest, catalog, type, id } = req.query;

  // -----------------------
  // MANIFEST
  // -----------------------
  if (manifest !== undefined) {
    return res.status(200).json({
      id: "recent.tvmaze",
      version: "5.0.0",
      name: "Recent Episodes (TVmaze)",
      description: "Shows with episodes in the last 7 PST days",
      types: ["series"],
      resources: ["catalog", "meta"],
      catalogs: [{ id: "recent", type: "series", name: "Recent Episodes (7 days)" }],
      idPrefixes: ["tvmaze:"],
      endpoint: `https://${req.headers.host}/api`
    });
  }

  // -----------------------
  // CATALOG
  // -----------------------
  if (catalog === "recent" && type === "series") {
    const expired = Date.now() - CACHE_TIMESTAMP > CACHE_TTL;

    // Serve cached catalog if available
    if (CATALOG_CACHE.length > 0 && !expired) {
      if (!SCAN_IN_PROGRESS) progressiveBuild(); // refresh cache in background
      return res.status(200).json({ metas: CATALOG_CACHE });
    }

    // Start progressive build if cache is empty or expired
    progressiveBuild(); 
    return res.status(200).json({ metas: CATALOG_CACHE });
  }

  // -----------------------
  // META
  // -----------------------
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

  // -----------------------
  // DEFAULT
  // -----------------------
  return res.status(200).json({ status: "ok" });
};
