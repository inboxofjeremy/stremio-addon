const { addonBuilder, getInterface } = require("stremio-addon-sdk");
const axios = require("axios");

// Create addon builder with required catalogs array
const builder = new addonBuilder({
  id: "org.example.recentshows",
  version: "1.0.0",
  name: "Recent Shows",
  description: "Shows aired in the last 7 days excluding talk shows and news",
  resources: ["catalog", "meta"],
  types: ["series"],
  catalogs: []  // REQUIRED
});

// Helper: format date YYYY-MM-DD
const formatDate = (d) => d.toISOString().split("T")[0];

// Fetch schedule for a single date
async function fetchSchedule(dateStr) {
  try {
    const res = await axios.get(`https://api.tvmaze.com/schedule?country=US&date=${dateStr}`);
    return res.data;
  } catch (err) {
    console.error("Error fetching TVmaze schedule:", err.message);
    return [];
  }
}

// Get shows and episodes from last 7 days
async function getRecentShows() {
  const today = new Date();
  const lastWeek = new Date();
  lastWeek.setDate(today.getDate() - 7);

  const dates = [];
  for (let d = new Date(lastWeek); d <= today; d.setDate(d.getDate() + 1)) {
    dates.push(formatDate(d));
  }

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
        episodes: [],
      };
    }

    showsMap[showId].episodes.push({
      id: ep.id.toString(),
      name: ep.name,
      season: ep.season,
      episode: ep.number,
      released: ep.airdate,
      type: "episode",
      series: showId,
    });
  });

  return Object.values(showsMap);
}

// CATALOG handler
builder.defineCatalogHandler(async ({ type }) => {
  if (type !== "series") return { metas: [] };
  const shows = await getRecentShows();
  return {
    metas: shows.map((show) => ({
      id: show.id,
      name: show.name,
      type: "series",
      poster: show.poster,
      description: show.description,
    })),
  };
});

// META handler
builder.defineMetaHandler(async ({ type, id }) => {
  const shows = await getRecentShows();
  const show = shows.find((s) => s.id === id);
  return { id, type, episodes: show ? show.episodes : [] };
});

// Export the addon interface
module.exports = getInterface(builder);
