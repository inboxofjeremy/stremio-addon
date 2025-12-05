export const config = { runtime: "edge" };

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: HEADERS, status: 200 });

  const url = new URL(req.url);
  const catalog = url.searchParams.get("catalog");
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id");

  const PST_OFFSET = -8; // PST is UTC-8
  const now = new Date();

  // ------------------------------
  // 1️⃣ Catalog endpoint
  // ------------------------------
  if (catalog === "recent" && type === "series") {
    try {
      let allShows = [];
      let page = 0;
      let more = true;

      while (more) {
        const resp = await fetch(`https://api.tvmaze.com/shows?page=${page}`);
        const shows = await resp.json();
        if (!shows || shows.length === 0) {
          more = false;
          break;
        }
        allShows.push(...shows);
        page++;
        if (page > 5) break; // limit to first 6 pages (approx 1500 shows) for performance
      }

      const recentShows = [];

      for (const show of allShows) {
        // Fetch all episodes for the show
        const epsResp = await fetch(`https://api.tvmaze.com/shows/${show.id}/episodes`);
        const episodes = epsResp.ok ? await epsResp.json() : [];

        // Check if any episode aired in last 7 PST days
        const hasRecent = episodes.some(ep => {
          if (!ep.airdate) return false;
          const epDate = new Date(ep.airdate + "T00:00:00Z");
          epDate.setHours(epDate.getHours() + PST_OFFSET);
          const diffDays = (now - epDate) / (1000 * 60 * 60 * 24);
          return diffDays <= 7 && diffDays >= 0;
        });

        if (!hasRecent) continue;

        // Find latest airdate for sorting
        const latestAirdate = episodes.reduce((latest, ep) => {
          if (!ep.airdate) return latest;
          const epDate = new Date(ep.airdate + "T00:00:00Z");
          epDate.setHours(epDate.getHours() + PST_OFFSET);
          return epDate > latest ? epDate : latest;
        }, new Date(0));

        recentShows.push({
          id: `tvmaze:${show.id}`,
          type: "series",
          name: show.name,
          poster: show.image?.medium || null,
          description: (show.summary || "").replace(/<[^>]+>/g, ""),
          latestAirdate,
        });
      }

      // Sort descending by latest episode airdate
      const sortedShows = recentShows.sort((a, b) => b.latestAirdate - a.latestAirdate);

      // Remove latestAirdate before returning
      const metas = sortedShows.map(({ latestAirdate, ...rest }) => rest);

      return new Response(JSON.stringify({ metas }), { headers: HEADERS });
    } catch (err) {
      console.error("CATALOG ERROR", err);
      return new Response(JSON.stringify({ metas: [] }), { headers: HEADERS });
    }
  }

  // ------------------------------
  // 2️⃣ Meta endpoint: return all episodes for the show
  // ------------------------------
  if (id && id.startsWith("tvmaze:") && type === "series") {
    const showId = id.split(":")[1];
    try {
      const [showResp, epsResp] = await Promise.all([
        fetch(`https://api.tvmaze.com/shows/${showId}`),
        fetch(`https://api.tvmaze.com/shows/${showId}/episodes`)
      ]);

      if (!showResp.ok) throw new Error("Show not found");

      const show = await showResp.json();
      const eps = epsResp.ok ? await epsResp.json() : [];

      const metaObj = {
        id,
        type: "series",
        name: show.name || "",
        poster: show.image?.original || show.image?.medium || null,
        description: (show.summary || "").replace(/<[^>]+>/g, ""),
        episodes: eps.map(ep => ({
          id: `tvmaze:${showId}:${ep.id}`,
          series: id,
          type: "episode",
          name: ep.name || "",
          season: ep.season || 0,
          episode: ep.number || 0,
          released: ep.airdate || null,
          poster: ep.image?.medium || ep.image?.original || null
        }))
      };

      return new Response(JSON.stringify({ meta: metaObj }), { headers: HEADERS });
    } catch (err) {
      console.error("META ERROR", err);
      return new Response(JSON.stringify({ meta: {} }), { headers: HEADERS });
    }
  }

  // ------------------------------
  // Default fallback
  // ------------------------------
  return new Response(JSON.stringify({ status: "ok" }), { headers: HEADERS });
}
