const fetch = require("node-fetch");   // ← stable, no async import

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json"
};

module.exports = async (req, res) => {
  // send CORS headers immediately
  for (const h in HEADERS) res.setHeader(h, HEADERS[h]);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { manifest, catalog, type, id } = req.query;

  // MANIFEST
  if (manifest !== undefined) {
    return res.status(200).json({
      id: "recent.tvmaze",
      version: "1.0.0",
      name: "Recent Episodes (TVmaze)",
      description: "Shows with episodes in last 7 PST days",
      types: ["series"],
      resources: ["catalog", "meta"],
      catalogs: [
        { id: "recent", type: "series", name: "Recent Episodes" }
      ],
      idPrefixes: ["tvmaze:"],
      endpoint: "https://" + req.headers.host + "/api"
    });
  }

  // CATALOG
  if (catalog === "recent" && type === "series") {
    try {
      const now = new Date();
      const pst = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));

      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(pst);
        d.setDate(pst.getDate() - i);
        days.push(d.toISOString().split("T")[0]);
      }

      let allEpisodes = [];

      for (const d of days) {
        const url = `https://api.tvmaze.com/schedule?country=US&date=${d}`;
        const r = await fetch(url);
        const j = await r.json();
        allEpisodes.push(...j);
      }

      const byShow = {};

      allEpisodes.forEach(ep => {
        if (!ep.show) return;
        if (["Talk Show", "News"].includes(ep.show.type)) return;

        const airdate = ep.airdate || ep.airstamp?.split("T")[0];
        if (!airdate) return;

        const s = ep.show;

        if (!byShow[s.id] || byShow[s.id].airdate < airdate) {
          byShow[s.id] = {
            id: "tvmaze:" + s.id,
            type: "series",
            name: s.name,
            poster: s.image?.medium || null,
            description: s.summary?.replace(/<[^>]*>/g, "") || "",
            airdate
          };
        }
      });

      const sorted = Object.values(byShow).sort((a, b) =>
        a.airdate < b.airdate ? 1 : -1
      );

      return res.status(200).json({ metas: sorted });

    } catch (err) {
      console.error("CATALOG ERROR:", err);
      return res.status(200).json({ metas: [] });
    }
  }

  // META
  if (id && id.startsWith("tvmaze:") && type === "series") {
    try {
      const showId = id.replace("tvmaze:", "");

      const show = await fetch(`https://api.tvmaze.com/shows/${showId}`).then(r => r.json());
      const eps = await fetch(`https://api.tvmaze.com/shows/${showId}/episodes`).then(r => r.json());

      return res.status(200).json({
        meta: {
          id,
          type: "series",
          name: show.name,
          poster: show.image?.original || show.image?.medium || null,
          description: show.summary?.replace(/<[^>]*>/g, "") || "",
          episodes: eps.map(e => ({
            id: `tvmaze:${showId}:s${e.season}e${e.number}`,
            series: id,
            type: "episode",
            season: e.season,
            episode: e.number,
            name: e.name,
            released: e.airdate,
            thumbnail: e.image?.medium || null
          }))
        }
      });

    } catch (err) {
      console.error("META ERROR:", err);
      return res.status(200).json({ meta: {} });
    }
  }

  return res.status(200).json({ status: "ok" });
};
