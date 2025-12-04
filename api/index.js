const { addonBuilder } = require("stremio-addon-sdk");

const builder = new addonBuilder({
  id: "org.example.recentshows",
  version: "1.0.0",
  name: "Recent Shows",
  description: "Shows aired in the last 7 days excluding talk shows/news",
  resources: ["catalog","meta"],
  types: ["series"],
  catalogs: [
    { type: "series", id: "recent", name: "Recent Shows" }
  ]
});

builder.defineCatalogHandler(async ({ type }) => {
  return {
    metas: [
      {
        id: "1",
        name: "Test Show",
        type: "series",
        poster: "https://static.tvmaze.com/uploads/images/medium_portrait/1/1.jpg",
        description: "This is a test show"
      }
    ]
  };
});

builder.defineMetaHandler(async ({ type, id }) => {
  return {
    id,
    type,
    episodes: [
      {
        id: "101",
        name: "Test Episode 1",
        season: 1,
        episode: 1,
        released: "2025-12-01",
        type: "episode",
        series: id
      }
    ]
  };
});

module.exports = (req,res) => builder.getInterface(req,res);
