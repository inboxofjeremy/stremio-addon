const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const builder = new addonBuilder({
  id: "org.example.recentshows",
  version: "1.0.0",
  name: "Recent Shows",
  description: "Shows aired in the last 3 days excluding talk shows/news",
  resources: ["catalog", "meta"],
  types: ["series"],
  catalogs: [
    { type: "series", id: "recent", name: "Recent Shows" }
  ]
});

const axiosInstance = axios.create({ timeout: 3000 });
const formatDate = (d) => d.toISOString().split("T")[0];

let cache = { shows: [], lastFetch: 0 };
const CACHE_DURATION = 15 * 60 * 1000;

// Load test cache immediately to avoid cold start issues
try {
  const rawCache = fs.readFileSync(path.join(__dirname, "../public/cache.json"));
  cache.shows = JSON.parse(rawCache);
  cache.lastFetch = Date.now();
  console.log("Loaded initial cache with", cache.shows.length, "shows");
} catch (err) {
  console.error("Failed to load initial cache:", err.message);
}

// Async fetch from TVmaze (last 3 days)
async function fetchCache() {
  const today = new Date();
  const last3Days = new Date();
  last3Days.setDate(today.getDate() - 2);

  const dates = [];
  for (let d = new Date(last3Days); d <= today; d.setDate(d.getDate() + 1)) {
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
  console.log("Cache updated with", cache.shows.length, "shows");
}

// Background updater
async function updateCache() {
  if (Date.now() - cache.lastFetch < CACHE_DURATION) return;
  fetchCache(); // run async
}

// Catalog handler
builder.defineCatalogHandler(async ({ type }) => {
  if (type !== "series") return { metas: [] };
  updateCache(); // async background fetch
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

// Meta handler
builder.defineMetaHandler(async ({ type, id }) => {
  updateCache();
  const show = cache.shows.find(s => s.id === id);
  return { id, type, episodes: show ? show.episodes : [] };
});

module.exports = (req, res) => builder.getInterface(req, res);
