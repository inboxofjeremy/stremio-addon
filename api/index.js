const { addonBuilder } = require("stremio-addon-sdk");

// Builder with one catalog
const builder = new addonBuilder({
  id: "org.example.testaddon",
  version: "1.0.0",
  name: "Test Addon",
  description: "Minimal working addon",
  resources: ["catalog","meta"],
  types: ["series"],
  catalogs: [{ type: "series", id: "recent", name: "Test Catalog" }]
});

// Preloaded show to return immediately
const cache = {
  shows: [
    {
      id: "placeholder-show",
      name: "Placeholder Show",
      type: "series",
      poster: "https://static.tvmaze.com/uploads/images/medium_portrait/1/1.jpg",
      description: "This show ensures the API responds immediately",
      episodes: [
        { id: "ep1", name: "Episode 1", season: 1, episode: 1, released: "2025-12-01", type: "episode", series: "placeholder-show" }
      ]
    }
  ]
};

// Catalog handler
builder.defineCatalogHandler(() => ({
  metas: cache.shows.map(s => ({
    id: s.id,
    name: s.name,
    type: "series",
    poster: s.poster,
    description: s.description
  }))
}));

// Meta handler
builder.defineMetaHandler(({id}) => {
  const show = cache.shows.find(s => s.id === id);
  return { id, type: "series", episodes: show ? show.episodes : [] };
});

// Default export for Vercel
module.exports = (req,res) => builder.getInterface(req,res);
