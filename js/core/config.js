(function () {
  window.TinyTurnRPGModules = window.TinyTurnRPGModules || {};
  Object.assign(window.TinyTurnRPGModules, {
    createOverworldState: function () {
      return {
        xPct: 46,
        yPct: 52,
        stepPct: 3.5,
        snapRadiusPct: 4.25,
        hoveredLocId: null,
        isDragging: false,
      };
    },
    OVERWORLD_BATTLE_IDS: ["arena", "market-central", "fey-forest", "gutterglass"],
    OVERWORLD_SHOP_IDS: ["shop"],
    OVERWORLD_POS_OVERRIDES: {
      shop: { leftPct: 88.0, topPct: 18.0 },
    },
    OVERWORLD_LOC_ICONS: {
      "arena": "🏟️",
      "market-central": "🏙️",
      "fey-forest": "🌿",
      "gutterglass": "🪞",
      "shop": "",
    },
    MUSIC_TRACKS: [
      { src: "assets/audio/crystal-fields-of-aeria.mp3", title: "Crystal Fields of Aeria" },
      { src: "assets/audio/crystal-fields-of-aeria-alt.mp3", title: "Crystal Fields of Aeria (Alt)" },
    ],
    MUSIC_PREF_KEY: "rpg_music_enabled_v1",
    MUSIC_VOL_KEY: "rpg_music_volume_v1",
    BOSS_TRACK: { src: "assets/audio/arcane-showdown.mp3", title: "Arcane Showdown" },
    GAME_BUILD: "2026-03-08-modularized",
  });
})();
