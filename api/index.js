module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  try {
    const url = new URL(req.url, `https://${req.headers.host}`);

    // ───── CATALOG: recent ───────────────────────────
    if (url.searchParams.get("catalog") === "recent") {
      const today = new Date();
      const dates = [];

      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        dates.push(d.toISOString().split("T")[0]);
      }

      const results = [];

      for (const day of dates) {
        const r = await fetch(
          `https://api.tvmaze.com/schedule?country=US&date=${day}`
        );
        if (r.ok) results.push(...(await r.json()));
      }

      const uniq = new Map();

      for (const item of results) {
        if (!item.show || !item.show.id) continue;

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

    // ───── META: single show ─────────────────────────
    if (url.searchParams.has("meta")) {
      const full = url.searchParams.get("meta");
      const tmId = full.split(":")[1];

      const s = await fetch(`https://api.tvmaze.com/shows/${tmId}`);
      if (!s.ok) return res.status(404).json({});

      const show = await s.json();

      const e = await fetch(`https://api.tvmaze.com/shows/${tmId}/episodes`);
      const eps = e.ok ? await e.json() : [];

      return res.status(200).json({
        meta: {
          id: full,
          type: "series",
          name: show.name,
          poster: show.image?.original || show.image?.medium || null,
          description: (show.summary || "").replace(/<[^>]*>/g, ""),
          episodes: eps.map(ep => ({
            id: `tvmaze:${tmId}:s${ep.season}e${ep.number}`,
            type: "episode",
            series: full,
            name: ep.name,
            season: ep.season,
            episode: ep.number,
            released: ep.airdate || null
          }))
        }
      });
    }

    res.status(200).json({ status: "ok" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.toString() });
  }
};
