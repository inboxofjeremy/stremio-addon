const axios = require("axios");

const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes
let cache = {
  shows: [],
  lastFetch: 0
};

// Helper: format date YYYY-MM-DD
const formatDate = (d) => d.toISOString().split("T")[0];

// Fetch last 7 days from TVmaze in background
async function fetchTVMazeCache() {
  try {
    const today = new Date();
    const last7Days = new Date();
    last7Days.setDate(today.getDate() - 6);

    const dates = [];
    for (let d = new Date(last7Days); d <= today; d.setDate(d.getDate() + 1)) {
      dates.push(formatDate(new Date(d)));
    }

    const results = await Promise.all(
      dates.map((date) =>
        axios
          .get(`https://api.tvmaze.com/schedule?country=US&date=${date}`)
          .then((res) => res.data)
          .catch(() => [])
      )
    );

    const showsMap = {};
    results.flat().forEach((ep) => {
      const show = ep.show;
      if (!show || ["Talk Show", "News"].includes(show.type)) return;

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
    console.log("Cache updated:", cache.shows.length, "shows");
  } catch (err) {
    console.error("TVmaze fetch failed:", err.message);
  }
}

// Trigger background fetch if cache stale
function updateCache() {
  if (Date.now() - cache.lastFetch > CACHE_DURATION) {
    fetchTVMazeCache(); // do NOT await
  }
}

// API endpoint for Stremio
module.exports = (req, res) => {
  try {
    updateCache(); // fetch in background

    // Return cache immediately (or placeholder if empty)
    const metas =
      cache.shows.length > 0
        ? cache.shows
        : [
            {
              id: "placeholder-show",
              name: "Loading shows...",
              type: "series",
              poster: "https://static.tvmaze.com/uploads/images/medium_portrait/1/1.jpg",
              description: "Fetching recent shows from TVmaze...",
              episodes: []
            }
          ];

    res.status(200).json({ metas });
  } catch (err) {
    // Never fail Stremio request
    res.status(200).json({
      metas: [
        {
          id: "placeholder-show",
          name: "Loading shows...",
          type: "series",
          poster: "https://static.tvmaze.com/uploads/images/medium_portrait/1/1.jpg",
          description: "API error fallback",
          episodes: []
        }
      ]
    });
    console.error(err);
  }
};
