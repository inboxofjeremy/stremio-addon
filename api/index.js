// ------------------------------
// HEADERS
// ------------------------------
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json"
};

// ------------------------------
// SAFE FETCH WITH RETRY
// ------------------------------
async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      return await res.json();
    } catch (err) {
      if (i === retries) {
        console.error("Fetch failed:", url, err.message);
        return null;
      }
      await new Promise(r => setTimeout(r, 200)); // small delay before retry
    }
  }
}

// ------------------------------
// HANDLER
// ------------------------------
export default async function handler(req, res) {
  // CORS headers
  for (const h in HEADERS) res.setHeader(h, HEADERS[h]);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { manifest, catalog, type, id } = req.query;

  // ------------------------------
  // MANIFEST
  // ------------------------------
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

  // ------------------------------
  // CATALOG
  // ------------------------------
  if (catalog === "recent" && type === "series") {
    try {
      const now = new Date();
      const pstNow = new Date(
        now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
      );

      // Last 7 PST dates
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(pstNow);
        d.setDate(pstNow.getDate() - i);
        days.push(d.toISOString().split("T")[0]);
      }

      // Fetch schedule for each day in parallel with retry
      const scheduleResults = await Promise.all(
        days.map(d => fetchWithRetry(`https://api.tvmaze.com/schedule?country=US&date=${d}`))
      );

      let allEpisodes = [];
      for (const r of scheduleResults) {
        if (Array.isArray(r)) allEpisodes.push(...r);
      }

      // Unique show IDs
      const showIds = [...new Set(allEpisodes.map(ep => ep.show?.id).filter(Boolean))];

      // Fetch full episodes per show in batches of 10
      const chunkSize = 10;
      const episodeFetches = [];
      for (let i = 0; i < showIds.length; i += chunkSize) {
        const chunk = showIds.slice(i, i + chunkSize);
        episodeFetches.push(
          Promise.all(
            chunk.map(async showId => {
              const eps = await fetchWithRetry(`https://api.tvmaze.com/shows/${showId}/episodes`);
              return { showId, eps: eps || [] };
            })
          )
        );
      }

      const episodeResults = (await Promise.all(episodeFetches)).flat();

      // Filter shows with episodes in last 7 PST days
      const recentShows = [];
      for (const { showId, eps } of episodeResults) {
        const recentEps = eps.filter(ep => {
          if (!ep.airdate) return false;
          return days.includes(ep.airdate);
        });
        if (recentEps.length === 0) continue;

        // Take example episode for show info
        const exampleEpisode = allEpisodes.find(ep => ep.show?.id === showId);
        if (!exampleEpisode) continue;
        const s = exampleEpisode.show;

        recentShows.push({
          id: `tvmaze:${showId}`,
          type: "series",
          name: s.name,
          poster:
            s.image?.medium ||
            s.image?.original ||
            recentEps[0].image?.medium ||
            recentEps[0].image?.original ||
            "https://static.strem.io/assets/placeholders/series.png",
          description: s.summary?.replace(/<[^>]*>/g, "") || "",
          airdate: recentEps.reduce((latest, ep) => (ep.airdate > latest ? ep.airdate : latest), "")
        });
      }

      // Sort by latest episode airdate descending
      recentShows.sort((a, b) => (a.airdate < b.airdate ? 1 : -1));

      return res.status(200).json({ metas: recentShows });
    } catch (err) {
      console.error("CATALOG ERROR:", err);
      return res.status(200).json({ metas: [] });
    }
  }

  // ------------------------------
  // META — full show + episodes
  // ------------------------------
  if (id && id.startsWith("tvmaze:") && type === "series") {
    try {
      const showId = id.replace("tvmaze:", "");

      const show = await fetchWithRetry(`https://api.tvmaze.com/shows/${showId}`);
      const eps = await fetchWithRetry(`https://api.tvmaze.com/shows/${showId}/episodes`) || [];

      if (!show) return res.status(200).json({ meta: {} });

      return res.status(200).json({
        meta: {
          id,
          type: "series",
          name: show.name,
          poster:
            show.image?.original ||
            show.image?.medium ||
            eps[0]?.image?.original ||
            eps[0]?.image?.medium ||
            "https://static.strem.io/assets/placeholders/series.png",
          description: show.summary?.replace(/<[^>]*>/g, "") || "",
          episodes: eps.map(e => ({
            id: `tvmaze:${showId}:s${e.season}e${e.number}`,
            series: id,
            type: "episode",
            season: e.season,
            episode: e.number,
            name: e.name,
            released: e.airdate,
            thumbnail: e.image?.medium || e.image?.original || null
          }))
        }
      });
    } catch (err) {
      console.error("META ERROR:", err);
      return res.status(200).json({ meta: {} });
    }
  }

  // ------------------------------
  // DEFAULT
  // ------------------------------
  return res.status(200).json({ status: "ok" });
}
