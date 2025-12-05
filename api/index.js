module.exports = async (req, res) => {
  // ───── CORS ─────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  res.setHeader("Content-Type", "application/json");

  try {
    const url = new URL(req.url, `https://${req.headers.host}`);

    // ───── CATALOG ─────
    if (url.searchParams.get("catalog") === "recent") {
      const today = new Date();
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        return d.toISOString().split("T")[0];
      });

      // fetch all 7 days in parallel
      const resultsArr = await Promise.all(
        days.map(day =>
          fetch(`https://api.tvmaze.com/schedule?country=US&date=${day}`)
            .then(r => r.ok ? r.json() : [])
        )
      );

      const results = resultsArr.flat();

      // deduplicate shows
      const uniq = new Map();
      for (const item of results) {
        if (!item.show?.id) continue;
        if (item.show.type === "Talk Show" || item.show.type === "News") continue; // optional filter

        const id = `tvmaze:${item.show.id}`;
        if (!uniq.has(id)) {
          uniq.set(id, {
            id,
            type: "series",
            name: item.show.name,
            poster: item.show.image?.medium || null,
            description: (item.show.summary || "").replace(/<[^>]*>/g, "")
          });
        }
      }

      return res.status(200).json({ metas: [...uniq.values()] });
    }

    // ───── META ─────
    if (url.searchParams.has("meta")) {
      const fullId = url.searchParams.get("meta");
      const tvmazeId = fullId.split(":")[1];

      const showRes = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}`);
      if (!showRes.ok) return res.status(404).json({});
      const show = await showRes.json();

      const epsRes = await fetch(`https://api.tvmaze.com/shows/${tvmazeId}/episodes`);
      const epsRaw = epsRes.ok ? await epsRes.json() : [];

      const episodes = epsRaw.map(ep => ({
        id: `tvmaze:${tvmazeId}:s${ep.season}e${ep.number}`,
        type: "episode",
        series: fullId,
        name: ep.name,
        season: ep.season,
        episode: ep.number,
        released: ep.airdate || null
      }));

      return res.status(200).json({
        meta: {
          id: fullId,
          type: "series",
          name: show.name,
          poster: show.image?.original || show.image?.medium || null,
          description: (show.summary || "").replace(/<[^>]*>/g, ""),
          episodes
        }
      });
    }

    // Default
    res.status(200).json({ status: "ok" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.toString() });
  }
};
