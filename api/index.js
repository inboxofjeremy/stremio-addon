const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

const builder = new addonBuilder({
  id: "org.example.recentshows",
  version: "1.0.0",
  name: "Recent Shows (TVmaze)",
  description: "Shows aired in the last 7 days excluding Talk Shows/News",
  resources: ["catalog","meta"],
  types: ["series"],
  catalogs: [
    { type: "series", id: "recent", name: "Recent Shows" }
  ]
});

const axiosInstance = axios.create({ timeout: 5000 });
const formatDate = d => d.toISOString().split("T")[0];

let cache = { shows: [], lastFetch: 0 };
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// Fetch last 7 days of shows from TVmaze
async function fetchCache() {
  const today = new Date();
  const last7Days = new Date();
  last7Days.setDate(today.getDate() - 6);

  const dates = [];
  for (let d = new Date(last7Days); d <= today; d.setDate(d.getDate() + 1)) {
    dates.push(formatDate(new Date(d)));
  }

  const results = [];
  for (const date of dates) {
    try {
      const res = await axiosInstance.get(`https://api.tvmaze.com/schedule?country=US&date=${date}`);
      results.push(res.data || []);
    } catch (err) {
      console.error("TVmaze fetch error for date", date, err.message);
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

// Background updater to avoid repeated TVmaze calls
async function updateCache() {
  if (Date.now() - cache.lastFetch > CACHE_DURATION) {
    fetchCache();
  }
}

// Catalog handler returns cached data immediately
builder.defineCatalogHandler(async ({ type }) => {
  if (type !== "series") return { metas: [] };
  await updateCache();
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

// Meta handler returns all episodes for a show
builder.defineMetaHandler(async ({ type, id }) => {
  await updateCache();
  const show = cache.shows.find(s => s.id === id);
  return { id, type, episodes: show ? show.episodes : [] };
});

// Vercel serverless export
module.exports = (req, res) => builder.getInterface(req, res);
