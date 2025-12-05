// /api/index.js
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const MANIFEST = {
  id: "com.yourname.recentmaze",
  version: "1.0.0",
  name: "Recent TV (TVMaze)",
  description: "Shows aired in the last 7 days",
  resources: ["catalog", "meta"],
  types: ["series"],
  catalogs: [
    {
      id: "recent",
      type: "series",
      name: "Recent TV (7 days)"
    }
  ],
  idPrefixes: ["tvmaze:"],
  endpoint: "" // will be injected dynamically
};

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const endpoint = `https://${req.headers.host}/api`;
    MANIFEST.endpoint = endpoint;

    // ───────────────────────────────────────────────
    // 1) RETURN MANIFEST
    // ───────────────────────────────────────────────
    if (url.searchParams.has("manifest")) {
      return res.status(200).json(MANIFEST);
    }

    // ───────────────────────────────────────────────
    // 2) CATALOG: ?catalog=recent
    // ───────────────────────────────────────────────
    if (url.searchParams.get("catalog") === "recent") {
      const today = new Date();
      const days = [];

      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        days.push(d.toISOString().split("T")[0]);
      }

      // Request all 7 days of schedule
      const results = [];
      for (const day of days) {
        const r = await fetch(`https://api.tvmaze.com/schedule?country=US&date=${day}`);
        if (r.ok) results.push(...await r.json());
      }

      // Deduplicate shows
      const map = new Map();
      for (const item of results) {
        if (!item.show || !item.show.id) continue;

        const id = `tvmaze:${item.show.id}`;
        if (!map.has(id)) {
          map.set(id, {
            id,
            type: "series",
            name: item.show.name,
            poster: item.show.image?.medium || null,
            description: item.show.summary?.replace(/<[^>]+>/g, "") || "",
          });
        }
      }

      return res.status(200).json({ metas: [...map.values()] });
    }

    // ───────────────────────────────────────────────
    // 3) META: ?meta=tvmaze:12345
    // ───────────────────────────────────────────────
    if (url.searchParams.has("meta")) {
      const fullId = url.searchParams.get("meta");
      const tvmazeId = fullId.split(":")[1];

      const showRes = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}`);
      if (!showRes.ok) return res.status(404).json({});

      const show = await showRes.json();

      const epsRes = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}/episodes`);
      const episodesRaw = epsRes.ok ? await epsRes.json() : [];

      const episodes = episodesRaw.map(ep => ({
        id: `tvmaze:${tvmazeId}:s${ep.season}e${ep.number}`,
        type: "episode",
        series: `tvmaze:${tvmazeId}`,
        name: ep.name,
        season: ep.season,
        episode: ep.number,
        released: ep.airdate || null
      }));

      const meta = {
        id: fullId,
        type: "series",
        name: show.name,
        poster: show.image?.original || show.image?.medium || null,
        description: show.summary?.replace(/<[^>]+>/g, "") || "",
        episodes
      };

      return res.status(200).json({ meta });
    }

    // Default response so browser always loads
    res.status(200).json({ status: "addon online" });

  } catch (err) {
    console.error("Addon error:", err);
    return res.status(500).json({ error: err.toString() });
  }
};
