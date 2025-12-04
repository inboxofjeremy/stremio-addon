import { addonBuilder, getInterface } from "stremio-addon-sdk";
import axios from "axios";

const builder = new addonBuilder({
  id: "org.example.recentshows",
  version: "1.0.0",
  name: "Recent Shows",
  description: "Shows aired in the last 7 days excluding talk shows and news",
  resources: ["catalog", "meta"],
  types: ["series"],
});

// Helper to get date strings
function formatDate(date) {
  return date.toISOString().split("T")[0];
}

// Get episodes from last 7 days
async function getRecentEpisodes() {
  const today = new Date();
  const lastWeek = new Date(today);
  lastWeek.setDate(today.getDate() - 7);

  const showsMap = {}; // id -> show + episodes

  for (let d = new Date(lastWeek); d <= today; d.setDate(d.getDate() + 1)) {
    const dateStr = formatDate(d);
    const response = await axios.get(`https://api.tvmaze.com/schedule?country=US&date=${dateStr}`);
    response.data.forEach(ep => {
      const show = ep.show;
      // Skip Talk Shows and News
      if (["Talk Show", "News"].includes(show.type)) return;

      if (!showsMap[show.id]) {
        showsMap[show.id] = {
          id: show.id.toString(),
          name: show.name,
          type: "series",
          poster: show.image?.medium,
          description: show.summary || "",
          episodes: [],
        };
      }

      // Add episode
      showsMap[show.id].episodes.push({
        id: ep.id.toString(),
        name: ep.name,
        season: ep.season,
        episode: ep.number,
        released: ep.airdate,
        type: "episode",
        series: show.id.toString(),
      });
    });
  }

  return Object.values(showsMap);
}

// CATALOG
builder.defineCatalogHandler(async ({ type, id }) => {
  if (type !== "series") return { metas: [] };

  const shows = await getRecentEpisodes();

  // Only send show meta (without episodes)
  const metas = shows.map(show => ({
    id: show.id,
    name: show.name,
    type: "series",
    poster: show.poster,
    description: show.description,
  }));

  return { metas };
});

// META (return episodes for a specific show)
builder.defineMetaHandler(async ({ type, id }) => {
  const shows = await getRecentEpisodes();
  const show = shows.find(s => s.id === id);
  if (!show) return { id, type, episodes: [] };

  return { id, type, episodes: show.episodes };
});

export default getInterface(builder);
