const { addonBuilder } = require("stremio-addon-sdk");

const builder = new addonBuilder({
  id: "org.example.testaddon",
  version: "1.0.0",
  name: "Test Addon",
  description: "Minimal test addon for Vercel deployment",
  resources: ["catalog","meta"],
  types: ["series"],
  catalogs: [{ type: "series", id: "recent", name: "Test Catalog" }]
});

// Placeholder show that returns immediately
const cache = {
  shows: [
    {
      id: "test-show",
      name: "Test Show",
      type: "series",
      poster: "https://static.tvmaze.com/uploads/images/medium_portrait/1/1.jpg",
      description: "This show ensures the API responds immediately",
      episodes: [
        { id: "test-ep1", name: "Test Episode 1", season: 1, episode: 1, released: "2025-12-01", type: "episode", series: "test-show" }
      ]
    }
  ]
};

// Catalog returns immediately
builder.defineCatalogHandler(() => ({
  metas: cache.shows.map(s => ({
    id: s.id,
    name: s.name,
    type: "series",
    poster: s.poster,
    description: s.description
  }))
}));

// Meta returns immediately
builder.defineMetaHandler(({id}) => {
  const show = cache.shows.find(s => s.id === id);
  return { id, type: "series", episodes: show ? show.episodes : [] };
});

// Default export for Vercel
module.exports = (req, res) => builder.getInterface(req, res);
