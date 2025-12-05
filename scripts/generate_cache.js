// scripts/generate_cache.js
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const mkdirp = require("mkdirp");

const COUNTRY = process.env.TVMAZE_COUNTRY || "US"; // set TVMAZE_COUNTRY env to change
const DAYS = 7; // last N days (inclusive)
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const CATALOG_PATH = path.join(PUBLIC_DIR, "catalog", "series");
const META_DIR = path.join(PUBLIC_DIR, "meta", "series");

// Axios with timeout
const ax = axios.create({ timeout: 10000 });

function formatDate(d) {
  return d.toISOString().split("T")[0];
}

async function fetchScheduleForDate(dateStr) {
  const url = `https://api.tvmaze.com/schedule?country=${COUNTRY}&date=${dateStr}`;
  const res = await ax.get(url);
  return res.data || [];
}

async function fetchShowEpisodes(showId) {
  // Fetch episodes list for a show: use /shows/:id/episodes (faster / lighter)
  const url = `https://api.tvmaze.com/shows/${showId}/episodes`;
  const res = await ax.get(url);
  return res.data || [];
}

(async function main() {
  try {
    console.log("Starting generation of static TVmaze addon files...");

    // Ensure folders
    mkdirp.sync(CATALOG_PATH);
    mkdirp.sync(META_DIR);

    const today = new Date();
    const dates = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      dates.push(formatDate(d));
    }
    console.log("Fetching schedule for dates:", dates.join(", "));

    // Fetch schedules in parallel but rate-limit a bit (we'll do sequential to be safe)
    const scheduleResults = [];
    for (const dt of dates) {
      try {
        console.log("Fetching schedule for", dt);
        const data = await fetchScheduleForDate(dt);
        scheduleResults.push(...data);
      } catch (err) {
        console.error("Failed schedule fetch for", dt, err.message || err);
      }
    }

    // Build map of unique shows that appear in schedule
    const showsMap = new Map();
    for (const ep of scheduleResults) {
      const show = ep.show;
      if (!show) continue;
      if (["Talk Show", "News"].includes(show.type)) continue;
      const key = String(show.id);
      if (!showsMap.has(key)) {
        showsMap.set(key, {
          tvmazeId: key,
          id: `tvmaze:${key}`,
          name: show.name,
          poster: show.image?.original || show.image?.medium || "",
          description: show.summary || "",
        });
      }
    }

    console.log("Found shows:", showsMap.size);

    // Build catalog metas (minimal)
    const metas = [];
    for (const showData of showsMap.values()) {
      metas.push({
        id: showData.id,
        type: "series",
        name: showData.name,
        poster: showData.poster,
        description: showData.description
      });
    }

    // Write catalog file: /public/catalog/series/recent7.json
    const catalogFolder = CATALOG_PATH;
    const catalogFile = path.join(catalogFolder, "recent7.json");
    mkdirp.sync(catalogFolder);
    fs.writeFileSync(catalogFile, JSON.stringify({ metas }, null, 2), "utf8");
    console.log("Wrote catalog:", catalogFile);

    // For each show, fetch episodes and write meta file
    // We'll fetch sequentially to avoid rate-limit; you can parallelize carefully.
    let i = 0;
    for (const [tvmazeId, showData] of showsMap) {
      i++;
      try {
        console.log(`(${i}/${showsMap.size}) Fetching episodes for show ${tvmazeId} - ${showData.name}`);
        const eps = await fetchShowEpisodes(tvmazeId); // array of episodes
        // Map episodes to Stremio meta schema
        const episodes = eps.map(ep => ({
          id: `tvmaze:${ep.id}`,
          type: "episode",
          name: ep.name || "",
          season: ep.season || 0,
          episode: ep.number || 0,
          released: ep.airdate || null,
          overview: ep.summary || "",
          series: `tvmaze:${tvmazeId}`
        }));

        const metaObj = {
          meta: {
            id: `tvmaze:${tvmazeId}`,
            type: "series",
            name: showData.name,
            poster: showData.poster,
            description: showData.description,
            episodes
          }
        };

        const outFile = path.join(META_DIR, `tvmaze:${tvmazeId}.json`);
        fs.writeFileSync(outFile, JSON.stringify(metaObj, null, 2), "utf8");
        console.log("  Wrote meta:", outFile);
      } catch (err) {
        console.error("  Failed to fetch episodes for", tvmazeId, err.message || err);
      }
    }

    console.log("Static generation complete. Files written to public/ catalog & meta folders.");
    console.log("Deploy to Vercel and point manifest endpoint to your root URL.");
  } catch (err) {
    console.error("Generation failed:", err.message || err);
    process.exit(1);
  }
})();
