// ----------------------------------------------------
// HEADERS
// ----------------------------------------------------
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json"
};

// ----------------------------------------------------
// CACHES
// ----------------------------------------------------
const SHOW_CACHE_TTL = 24 * 60 * 60 * 1000;   // 24 hours
const CATALOG_CACHE_TTL = 5 * 60 * 1000;      // 5 minutes

const showCache = new Map();     // key: showId, value: { timestamp, eps }
const catalogCache = { timestamp: 0, data: [] };

// ----------------------------------------------------
// SAFE FETCH WITH RETRY
// ----------------------------------------------------
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
      await new Promise(r => setTimeout(r, 150));
    }
  }
}

// ----------------------------------------------------
// LAST 7 DAYS (PST)
// ----------------------------------------------------
function inLast7PstDays(airdate) {
  if (!airdate) return false;
  const now = new Date();
  const pst = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  );

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(pst);
    d.setDate(pst.getDate() - i);
    days.push(d.toISOString().split("T")[0]);
  }
  return days.includes(airdate);
}

// ----------------------------------------------------
// FETCH SHOW EPISODES WITH CACHING
// ----------------------------------------------------
async function getShowEpisodes(showId) {
  const cached = showCache.get(showId);

  if (cached && Date.now() - cached.timestamp < SHOW_CACHE_TTL) {
    return cached.eps;
  }

  const eps = await fetchWithRetry(`https://api.tvmaze.com/shows/${showId}/episodes`);
  if (!eps) return [];

  showCache.set(showId, {
    timestamp: Date.now(),
    eps
  });

  return eps;
}

// ----------------------------------------------------
// MAIN HANDLER
// ----------------------------------------------------
export default async function handler(req, res) {
  for (const h in HEADERS) res.setHeader(h, HEADERS[h]);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { manifest, catalog, type, id } = req.query;

  // ----------------------------------------------------
  // MANIFEST
  // ----------------------------------------------------
  if (manifest !== undefined) {
    return res.status(200).json({
      id: "recent.tvmaze",
      version: "1.0.0",
      name: "Recent Episodes (TVmaze)",
      description: "Shows with episodes aired in last 7 PST days",
      types: ["series"],
      resources: ["catalog", "meta"],
      catalogs: [
        { id: "recent", type: "series", name: "Recent Episodes (7 days)" }
      ],
      idPrefixes: ["tvmaze:"],
      endpoint: `https://${req.headers.host}/api`
    });
  }

  // ----------------------------------------------------
  // CATALOG
  // ----------------------------------------------------
  if (catalog === "recent" && type === "series") {

    // Return cache if fresh
    if (Date.now() - catalogCache.timestamp < CATALOG_CACHE_TTL) {
      return res.status(200).json({ metas: catalogCache.data });
    }

    try {
      const MAX_PAGES = 20; // ~5000 shows
      const recentShows = [];

      for (let page = 0; page < MAX_PAGES; page++) {
        const shows = await fetchWithRetry(`https://api.tvmaze.com/shows?page=${page}`);
        if (!Array.isArray(shows)) continue;

        // small chunk batching
        const chunkSize = 10;
        for (let i = 0; i < shows.length; i += chunkSize) {
          const chunk = shows.slice(i, i + chunkSize);

          const results = await Promise.all(
            chunk.map(async s => {
              const eps = await getShowEpisodes(s.id);
              if (!eps || !eps.length) return null;

              const hasRecent = eps.some(e => inLast7PstDays(e.airdate));
              if (!hasRecent) return null;

              return {
                id: `tvmaze:${s.id}`,
                type: "series",
                name: s.name,
                poster:
                  s.image?.medium ||
                  s.image?.original ||
                  "https://static.strem.io/assets/placeholders/series.png",
                description: s.summary?.replace(/<[^>]*>/g, "") || ""
              };
            })
          );

          recentShows.push(...results.filter(Boolean));
        }
      }

      catalogCache.timestamp = Date.now();
      catalogCache.data = recentShows;

      return res.status(200).json({ metas: recentShows });

    } catch (err) {
      console.error("CATALOG ERROR:", err);

      // fallback to cached data if possible
      return res.status(200).json({
        metas: catalogCache.data || []
      });
    }
  }

  // ----------------------------------------------------
  // META
  // ----------------------------------------------------
  if (id && id.startsWith("tvmaze:") && type === "series") {
    try {
      const showId = id.replace("tvmaze:", "");

      const show = await fetchWithRetry(`https://api.tvmaze.com/shows/${showId}`);
      const eps = await getShowEpisodes(showId);

      return res.status(200).json({
        meta: {
          id,
          type: "series",
          name: show?.name || "Unknown Show",
          poster:
            show?.image?.original ||
            show?.image?.medium ||
            eps[0]?.image?.original ||
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
      console.error("META ERROR:", err);
      return res.status(200).json({ meta: {} });
    }
  }

  return res.status(200).json({ status: "ok" });
}
