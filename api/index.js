const { addonBuilder } = require("stremio-addon-sdk");

// Minimal builder with one catalog
const builder = new addonBuilder({
  id: "org.example.recentshows",
  version: "1.0.0",
  name: "Recent Shows (Test)",
  description: "Test addon with one show, guaranteed to load",
  resources: ["catalog","meta"],
  types: ["series"],
  catalogs: [
    { type: "series", id: "recent", name: "Recent Shows" }
  ]
});

// Minimal test show
const testShow = {
  id: "test-show",
  name: "Test Show",
  type: "series",
  poster: "https://static.tvmaze.com/uploads/images/medium_portrait/1/1.jpg",
  description: "This is a test show",
  episodes: [
    {
      id: "test-ep1",
      name: "Test Episode 1",
      season: 1,
      episode: 1,
      released: "2025-12-01",
      type: "episode",
      series: "test-show"
    }
  ]
};

// Catalog handler returns the test show instantly
builder.defineCatalogHandler(async ({ type }) => {
  if (type !== "series") return { metas: [] };
  return { metas: [testShow] };
});

// Meta handler returns the episodes of the test show
builder.defineMetaHandler(async ({ type, id }) => {
  if (id === testShow.id) return { id, type, episodes: testShow.episodes };
  return { id, type, episodes: [] };
});

// Vercel export
module.exports = (req, res) => builder.getInterface(req, res);
