// api/index.js
const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

// Builder manifest (Stremio-facing)
const builder = new addonBuilder({
  id: "org.example.tvmaze.recent7",
  version: "1.0.0",
  name: "TVmaze — Recent 7 days",
  description: "Shows aired in the last 7 days (excludes Talk Show & News)",
  resources: ["catalog", "meta"],
  types: ["series"],
  catalogs: [
    { type: "series", id: "recent7", name: "Recent 7 days (TVmaze)" }
  ]
});

// Axios instance with reasonable timeout
const axiosInstance = axios.create({ timeout: 8000 });

// Utility: format date YYYY-MM-DD
const formatDate = (d) => d.toISOString().split("T")[0];

const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// In-memory cache
let cache = {
  shows: [],      // array of { id: "tvmaze:<id>", name, type, poster, description, episodes: [...] (episodes only in meta) }
  lastFetch: 0
};

// Fetch schedule for last 7 days and populate cache.shows (non-blocking)
async function fetchScheduleAndBuildCache(country = "US") {
  try {
    const today = new Date();
    const start = new Date();
    start.setDate(today.getDate() - 6); // last 7 days inclusive

    const dates = [];
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      dates.push(formatDate(new Date(d)));
    }

    // fetch each day's schedule in parallel
    const promises = dates.map((date) =>
      axiosInstance
        .get(`https://api.tvmaze.com/schedule?country=${country}&date=${date}`)
        .then((res) => res.data)
        .catch((err) => {
          console.warn("TVmaze schedule fetch failed for", date, err?.message || err);
          return [];
        })
    );

    const results = await Promise.all(promises); // array of arrays
    const combined = results.flat();

    // build a map of showId -> show info (we don't include episodes here)
    const showsMap = new Map();

    combined.forEach((ep) => {
      const show = ep.show;
      if (!show) return;
      if (["Talk Show", "News"].includes(show.type)) return;

      const showId = `tvmaze:${show.id}`; // canonical ID for our addon
      if (!showsMap.has(showId)) {
        showsMap.set(showId, {
          id: showId,
          name: show.name,
          type: "series",
          poster: show.image?.original || show.image?.medium || "",
          description: show.summary || "",
          // episodes will be populated dynamically by meta handler
        });
      }
    });

    cache.shows = Array.from(showsMap.values());
    cache.lastFetch = Date.now();
    console.log("Schedule cache updated, shows:", cache.shows.length);
  } catch (err) {
    console.error("fetchScheduleAndBuildCache error:", err?.message || err);
  }
}

// Public: ensure cache fresh (non-blocking)
function ensureCache() {
  if (Date.now() - cache.lastFetch > CACHE_DURATION) {
    // fire and forget
    fetchScheduleAndBuildCache().catch((e) => console.error("Background schedule fetch failed:", e?.message || e));
  }
}

// Helper to convert TVmaze episode object to Stremio episode meta
function makeEpisodeMeta(tvEp, showIdPrefix) {
  // tvEp: episode object from schedule or show embed
  return {
    id: `tvmaze:${tvEp.id}`,
    type: "episode",
    name: tvEp.name || "",
    season: tvEp.season || 0,
    episode: tvEp.number || 0,
    released: tvEp.airdate || null,
    overview: tvEp.summary || "",
    // `series` should be the series id we produce
    series: `${showIdPrefix}`
  };
}

// Meta handler: dynamic. Called when Stremio asks for a show's meta (with episodes).
// We expect id like "tvmaze:<showId>"
builder.defineMetaHandler(async ({ type, id }) => {
  // respond fast: try to fetch episodes live from TVmaze for the specific show id
  // parse tvmaze id:
  try {
    if (!id || !id.startsWith("tvmaze:")) {
      return { id, type, meta: null };
    }

    const tvmazeId = id.split(":")[1];
    if (!tvmazeId) return { id, type, meta: null };

    // Fetch show info with all episodes: /shows/:id?embed=episodes
    const url = `https://api.tvmaze.com/shows/${tvmazeId}?embed=episodes`;
    let resp;
    try {
      resp = await axiosInstance.get(url);
    } catch (err) {
      console.warn("Failed to fetch show meta from TVmaze for", tvmazeId, err?.message || err);
      // fallback: if cache contains show info, return it without episodes
      const cached = cache.shows.find((s) => s.id === id);
      return {
        id,
        type,
        meta: cached
          ? {
              id: cached.id,
              type: "series",
              name: cached.name,
              poster: cached.poster,
              description: cached.description,
              episodes: []
            }
          : { id, type, name: "", episodes: [] }
      };
    }

    const showData = resp.data;
    const embedded = resp.data._embedded;
    const episodes = (embedded && embedded.episodes) || [];

    // Build Stremio meta with episodes
    const showMeta = {
      id,
      type: "series",
      name: showData.name || "",
      poster: showData.image?.original || showData.image?.medium || "",
      description: showData.summary || "",
      // episodes array in Stremio meta
      episodes: episodes.map((ep) => ({
        id: `tvmaze:${ep.id}`,
        type: "episode",
        name: ep.name || "",
        season: ep.season || 0,
        episode: ep.number || 0,
        released: ep.airdate || null,
        overview: ep.summary || "",
        series: id
      }))
    };

    return { id, type, meta: showMeta };
  } catch (err) {
    console.error("meta handler unexpected error:", err?.message || err);
    return { id, type, meta: null };
  }
});

// Catalog handler: returns current cache (metas)
builder.defineCatalogHandler(({ type }) => {
  // keep cache fresh in background
  ensureCache();

  if (type !== "series") return { metas: [] };

  // Map cache.shows to Stremio "meta" entries with minimal fields
  const metas = cache.shows.map((s) => ({
    id: s.id,
    type: "series",
    name: s.name,
    poster: s.poster,
    description: s.description
  }));

  // If cache is empty, return an empty list (so Stremio shows no items) rather than an invalid placeholder
  // That avoids false placeholder ids causing meta lookup errors.
  return { metas };
});

// Kick off initial background fetch (non-blocking) at cold-start
fetchScheduleAndBuildCache().catch((e) => console.error("Initial schedule fetch failed:", e?.message || e));

// Vercel export
module.exports = (req, res) => builder.getInterface(req, res);
