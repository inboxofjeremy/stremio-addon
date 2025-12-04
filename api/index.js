const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

// Proper manifest with catalog object
const builder = new addonBuilder({
  id: "org.example.recentshows",
  version: "1.0.0",
  name: "Recent Shows",
  description: "Shows aired in the last 7 days excluding talk shows/news",
  resources: ["catalog", "meta"],
  types: ["series"],
  catalogs: [
    { type: "series", id: "recent", name: "Recent Shows" }
  ]
});

const axiosInstance = axios.create({ timeout: 3000 });
const formatDate = (d) => d.toISOString().split("T")[0];

let cache = { shows: [], lastFetch: 0 };
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// Function to fetch 7 days from TVmaze and populate cache
async function fetchCache() {
  const today = new Date();
  const lastWeek = new Date();
  lastWeek.setDate(today.getDate() - 7);

  const dates = [];
  for (let d = new Date(lastWeek); d <= today; d.setDate(d.getDate() + 1)) {
    dates.push(formatDate(d));
  }

  const results = [];
  for (const date of dates) {
    try {
      const res = await axiosInstance.get(`https://api.tvmaze.com/schedule?country=US&date=${date}`);
      results.push(res.data || []);
    } catch {
      results.push([]);
    }
  }

  const showsMap = {};
  results.flat().forEach(ep => {
    const show = ep.show;
    if (!show) return;
    if (["Talk Show", "News"].includes(show.type)) return;

    const showId = show.id.toString();
    if (!showsMap[showId]) {
      showsMap[showId] = {
        id: showId,
        name: show.name,
        type: "series",
        poster: show.image?.medium || "",
        description: show.summary || "",
        episodes: []
      };
    }

    showsMap[showId].episodes.push({
      id: ep.id.toString(),
      name: ep.name,
      season: ep.season,
      episode: ep.number,
      released: ep.airdate,
      type: "episode",
      series: showId
    });
  });

  cache.shows = Object.values(showsMap);
  cache.lastFetch = Date.now();
  console.log("Cache populated with", cache.shows.length, "shows");
}

// Preload cache at startup (non-blocking)
fetchCache().catch(err => console.error("Initial cache fetch failed:", err.message));

// Background cache updater
async function updateCache() {
  const now = Date.now();
  if (now - cache.lastFetch < CACHE_DURATION) return;
  fetchCache();
}

// Catalog handler: return cached data immediately
builder.defineCatalogHandler(async ({ type }) => {
  if (type !== "series") return { metas: [] };

  // Trigger async cache update
  updateCache();

  // Return cached shows immediately
  return {
    metas: cache.shows.map(show => ({
      id: show.id,
      name: show.name,
      type: "series",
      poster: show.poster,
      description: show.description
    }))
  };
});

// Meta handler: return cached episodes
builder.defineMetaHandler(async ({ type, id }) => {
  updateCache();
  const show = cache.shows.find(s => s.id === id);
  return { id, type, episodes: show ? show.episodes : [] };
});

// Vercel export
module.exports = (req, res) => builder.getInterface(req, res);
