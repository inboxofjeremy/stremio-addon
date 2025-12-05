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

  // ------------------------------
  // Catalog endpoint
  // ------------------------------
  if (catalog === "recent" && type === "series") {
    try {
      const today = new Date();
      let allShows = [];

      for (let i = 0; i < 7; i++) {
        const dt = new Date(today);
        dt.setDate(today.getDate() - i);
        const dateStr = dt.toISOString().split("T")[0];

        const resp = await fetch(`https://api.tvmaze.com/schedule?country=US&date=${dateStr}`);
        const json = await resp.json();
        allShows = allShows.concat(json);
      }

      const uniqueShows = {};
      allShows.forEach(e => {
        if (!e.show) return;
        if (["Talk Show", "News"].includes(e.show.type)) return;

        uniqueShows[e.show.id] = {
          id: `tvmaze:${e.show.id}`,
          type: "series",
          name: e.show.name,
          poster: e.show.image?.medium || null,
          description: (e.show.summary || "").replace(/<[^>]+>/g, "")
        };
      });

      return new Response(JSON.stringify({ metas: Object.values(uniqueShows) }), { headers: HEADERS });
    } catch (err) {
      console.error("CATALOG ERROR", err);
      return new Response(JSON.stringify({ metas: [] }), { headers: HEADERS });
    }
  }

  // ------------------------------
  // Meta endpoint
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
          released: ep.airdate || null
        }))
      };

      return new Response(JSON.stringify({ meta: metaObj }), { headers: HEADERS });
    } catch (err) {
      console.error("META ERROR", err);
      return new Response(JSON.stringify({ meta: {} }), { headers: HEADERS });
    }
  }

  // Default fallback
  return new Response(JSON.stringify({ status: "ok" }), { headers: HEADERS });
}
