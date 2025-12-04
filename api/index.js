// api/index.js
const { addonBuilder } = require("stremio-addon-sdk");

// Minimal builder with one catalog and one show
const builder = new addonBuilder({
  id: "org.example.testaddon",
  version: "1.0.0",
  name: "Test Addon",
  description: "Minimal test addon",
  resources: ["catalog","meta"],
  types: ["series"],
  catalogs: [{ type: "series", id: "recent", name: "Test Catalog" }]
});

// Preloaded show
const cache = {
  shows: [
    {
      id: "test-show",
      name: "Test Show",
      type: "series",
      poster: "https://static.tvmaze.com/uploads/images/medium_portrait/1/1.jpg",
      description: "This is a test show",
      episodes: [
        { id: "test-ep1", name: "Test Episode 1", season: 1, episode: 1, released: "2025-12-01", type: "episode", series: "test-show" }
      ]
    }
  ]
};

// Catalog handler
builder.defineCatalogHandler(() => {
  return { metas: cache.shows.map(s => ({ id: s.id, name: s.name, type: "series", poster: s.poster, description: s.description })) };
});

// Meta handler
builder.defineMetaHandler(({id}) => {
  const show = cache.shows.find(s => s.id===id);
  return { id, type: "series", episodes: show ? show.episodes : [] };
});

// Default export for Vercel
module.exports = (req,res) => builder.getInterface(req,res);
