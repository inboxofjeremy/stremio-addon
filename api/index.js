// ---------------------------------------------------------
// HEADERS
// ---------------------------------------------------------
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json"
};

// TVMaze throttling-safe fetch
async function safeFetch(url) {
  const r = await fetch(url);
  if (!r.ok) return null;
  return r.json();
}

export default async function handler(req, res) {
  for (const h in HEADERS) res.setHeader(h, HEADERS[h]);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { manifest, catalog, type, id } = req.query;

  // ---------------------------------------------------------
  // MANIFEST
  // ---------------------------------------------------------
  if (manifest !== undefined) {
    return res.status(200).json({
      id: "recent.tvmaze",
      version: "1.0.0",
      name: "Recent Episodes (TVmaze)",
      description: "Shows with episodes aired in last 7 PST days",
      types: ["series"],
      resources: ["catalog", "meta"],
      catalogs: [
        { id: "recent", type: "series", name: "Recent Episodes (7 days)" }
      ],
      idPrefixes: ["tvmaze:"],
      endpoint: `https://${req.headers.host}/api`
    });
  }

  // ---------------------------------------------------------
  // CATALOG — TRUE 7-DAY PST EPISODE SCAN (FAST)
  // ---------------------------------------------------------
  if (catalog === "recent" && type === "series") {
    try {
      // Convert now -> PST
      const now = new Date();
      const pstNow = new Date(
        now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
      );

      // Compute list of PST dates (yyyy-mm-dd)
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(pstNow);
        d.setDate(pstNow.getDate() - i);
        days.push(d.toISOString().split("T")[0]);
      }

      // Fetch the full US schedule for each day — FAST PARALLEL
      const scheduleUrls = days.map(
        d => `https://api.tvmaze.com/schedule?country=US&date=${d}`
      );
      const scheduleResults = await Promise.all(
        scheduleUrls.map(url => safeFetch(url))
      );

      // Flatten episodes
      let allEpisodes = [];
      for (const r of scheduleResults) {
        if (Array.isArray(r)) allEpisodes.push(...r);
      }

      // Collect unique show IDs we need episode-date verification for
      const showIds = [...new Set(allEpisodes.map(ep => ep.show?.id).filter(Boolean))];

      // Fetch episodes for each show - but batched (TVMaze rate limits!)
      const chunkSize = 10;
      const episodeFetches = [];

      for (let i = 0; i < showIds.length; i += chunkSize) {
        const chunk = showIds.slice(i, i + chunkSize);
        episodeFetches.push(
          Promise.all(
            chunk.map(id =>
              safeFetch(`https://api.tvmaze.com/shows/${id}/episodes`)
                .then(eps => ({ id, eps }))
            )
          )
        );
      }

      const episodeResults = (await Promise.all(episodeFetches)).flat();

      // Build a map: showId -> last aired episode date
      const lastAired = {};

      for (const { id: showId, eps } of episodeResults) {
        if (!Array.isArray(eps)) continue;

        for (const e of eps) {
          const airdate = e.airdate || e.airstamp?.split("T")[0];
          if (!airdate) continue;

          if (!lastAired[showId] || lastAired[showId] < airdate) {
            lastAired[showId] = airdate;
          }
        }
      }

      // Filter shows whose latest episode is within PST last 7 days
      const recentShows = [];

      for (const showId of showIds) {
        const latest = lastAired[showId];
        if (!latest) continue;

        if (days.includes(latest)) {
          // Get basic show info (from schedule, reliable)
          const exampleEpisode = allEpisodes.find(ep => ep.show?.id === showId);
          if (!exampleEpisode) continue;

          const s = exampleEpisode.show;

          recentShows.push({
            id: `tvmaze:${showId}`,
            type: "series",
            name: s.name,
            poster: s.image?.medium || s.image?.original || null,
            description: s.summary?.replace(/<[^>]*>/g, "") || "",
            airdate: latest
          });
        }
      }

      // Sort by latest episode
      recentShows.sort((a, b) => (a.airdate < b.airdate ? 1 : -1));

      return res.status(200).json({ metas: recentShows });

    } catch (err) {
      console.error("CATALOG ERROR:", err);
      return res.status(200).json({ metas: [] });
    }
  }

  // ---------------------------------------------------------
  // META — FULL SEASONS + EPISODES FOR SHOW
  // ---------------------------------------------------------
  if (id && id.startsWith("tvmaze:") && type === "series") {
    try {
      const showId = id.replace("tvmaze:", "");

      const show = await safeFetch(`https://api.tvmaze.com/shows/${showId}`);
      const eps = await safeFetch(`https://api.tvmaze.com/shows/${showId}/episodes`);

      if (!show) return res.status(200).json({ meta: {} });

      return res.status(200).json({
        meta: {
          id,
          type: "series",
          name: show.name,
          poster: show.image?.original || show.image?.medium || null,
          description: show.summary?.replace(/<[^>]*>/g, "") || "",
          episodes: (eps || []).map(e => ({
            id: `tvmaze:${showId}:s${e.season}e${e.number}`,
            series: id,
            type: "episode",
            season: e.season,
            episode: e.number,
            name: e.name,
            released: e.airdate || null,
            thumbnail: e.image?.medium || e.image?.original || null
          }))
        }
      });

    } catch (err) {
      console.error("META ERROR:", err);
      return res.status(200).json({ meta: {} });
    }
  }

  return res.status(200).json({ status: "ok" });
}
