const fetch = (...args) => import("node-fetch").then(m => m.default(...args));

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json"
};

module.exports = async (req, res) => {
  for (const h in HEADERS) res.setHeader(h, HEADERS[h]);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { manifest, catalog, type, id } = req.query;

  // --------------------------
  // MANIFEST
  // --------------------------
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

  // --------------------------
  // CATALOG (FAST)
  // --------------------------
  if (catalog === "recent" && type === "series") {
    try {
      const today = new Date();
      const pstNow = new Date(
        today.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
      );

      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(pstNow);
        d.setDate(pstNow.getDate() - i);
        days.push(d.toISOString().split("T")[0]);
      }

      // Fetch episodes for each of last 7 PST days
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

        // exclude talk/news
        if (["Talk Show", "News"].includes(ep.show.type)) return;

        const airdate = ep.airdate || ep.airstamp?.split("T")[0];
        if (!airdate) return;

        // choose most recent episode per show
        if (!byShow[ep.show.id] || byShow[ep.show.id].airdate < airdate) {
          byShow[ep.show.id] = {
            showId: ep.show.id,
            id: "tvmaze:" + ep.show.id,
            type: "series",
            name: ep.show.name,
            poster: ep.show.image?.medium || null,
            description: ep.show.summary?.replace(/<[^>]*>/g, "") || "",
            airdate
          };
        }
      });

      // Sort by most recent airdate
      const sorted = Object.values(byShow).sort((a, b) =>
        a.airdate < b.airdate ? 1 : -1
      );

      return res.status(200).json({ metas: sorted });
    } catch (e) {
      console.error("CATALOG ERROR", e);
      return res.status(200).json({ metas: [] });
    }
  }

  // --------------------------
  // META (fetch full series)
  // --------------------------
  if (id && id.startsWith("tvmaze:") && type === "series") {
    const showId = id.replace("tvmaze:", "");
    try {
      const showData = await fetch(`https://api.tvmaze.com/shows/${showId}`).then(r => r.json());
      const epsData = await fetch(`https://api.tvmaze.com/shows/${showId}/episodes`).then(r => r.json());

      const meta = {
        id,
        type: "series",
        name: showData.name,
        poster: showData.image?.original || showData.image?.medium || null,
        description: showData.summary?.replace(/<[^>]*>/g, "") || "",
        episodes: epsData.map(e => ({
          id: `tvmaze:${showId}:s${e.season}e${e.number}`,
          series: id,
          type: "episode",
          season: e.season,
          episode: e.number,
          name: e.name,
          released: e.airdate,
          thumbnail: e.image?.medium || null
        }))
      };

      return res.status(200).json({ meta });
    } catch (e) {
      console.error("META ERROR", e);
      return res.status(200).json({ meta: {} });
    }
  }

  return res.status(200).json({ status: "ok" });
};
