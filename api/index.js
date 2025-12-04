// api/index.js
module.exports = (req, res) => {
  res.status(200).json({
    metas: [
      {
        id: "placeholder-show",
        name: "Placeholder Show",
        type: "series",
        poster: "https://static.tvmaze.com/uploads/images/medium_portrait/1/1.jpg",
        description: "API responds immediately",
        episodes: [
          { id: "ep1", name: "Episode 1", season: 1, episode: 1, released: "2025-12-01", type: "episode", series: "placeholder-show" }
        ]
      }
    ]
  });
};
