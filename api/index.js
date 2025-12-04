const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

const builder = new addonBuilder({
  id: "org.example.recentshows",
  version: "1.0.0",
  name: "Recent Shows",
  description: "Shows aired in the last 7 days excluding talk shows and news",
  resources: ["catalog", "meta"],
  types: ["series"],
  catalogs: []
});

const formatDate = (d) => d.toISOString().split("T")[0];

let cache = {
  shows: null,
  lastFetch: 0
};

const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

async function fetchSchedule(dateStr) {
  try {
    const res = await axios.get(`https://api.tvmaze.com/schedule?country=US&date=${dateStr}`);
    return res.data;
  } catch (err) {
    console.error("TVmaze fetch error:", err.message);
    return [];
  }
}

async function getRecentShows() {
  const now = Date.now();

  if (cache.shows && now - cache.lastFetch < CACHE_DURATION) {
    return cache.shows;
  }

  const today = new Date();
  const lastWeek = new Date();
  lastWeek.setDate(today.getDate() - 7);

  const dates = [];
  for (let d = new Date(lastWeek); d <= today; d.setDate(d.getDate() + 1)) {
    dates.push(formatDate(d));
  }

  // Fetch all days in parallel
  const results = await Promise.all(dates.map(fetchSchedule));

  const showsMap = {};

  results.flat().forEach((ep) => {
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
  cache.lastFetch = now;

  return cache.shows;
}

builder.defineCatalogHandler(async ({ type }) => {
  if (type !== "series") return { metas: [] };
  return { metas: (await getRecentShows()).map((show) => ({
    id: show.id,
    name: show.name,
    type: "series",
    poster: show.poster,
    description: show.description
  }))};
});

builder.defineMetaHandler(async ({ type, id }) => {
  const show = (await getRecentShows()).find((s) => s.id === id);
  return { id, type, episodes: show ? show.episodes : [] };
});

module.exports = (req, res) => builder.getInterface(req, res);
