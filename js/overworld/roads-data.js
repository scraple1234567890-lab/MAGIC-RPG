window.TinyTurnRPGModules = window.TinyTurnRPGModules || {};
(() => {
  const nodes = {
    arena: { xPct: 18.6, yPct: 35.4 },
    arenaBend: { xPct: 20.8, yPct: 41.2 },
    westMerge: { xPct: 24.0, yPct: 47.5 },
    marketCentral: { xPct: 44.4, yPct: 55.3 },
    hospitalBend: { xPct: 52.9, yPct: 49.9 },
    palace: { xPct: 43.8, yPct: 43.9 },
    portJunction: { xPct: 60.0, yPct: 34.0 },
    shop: { xPct: 58.2, yPct: 21.8 },
    feyForest: { xPct: 56.0, yPct: 59.7 },
    eastMerge: { xPct: 69.8, yPct: 53.6 },
    gutterglass: { xPct: 71.1, yPct: 42.8 },
  };

  // Simplified road graph: only the main blue roads needed to connect the
  // playable overworld locations. Fewer branches means keyboard movement feels
  // more predictable and less like the roads are making decisions behind the curtain.
  const routes = [
    {
      id: 'arena-to-market',
      points: [
        { node: 'arena' },
        { xPct: 19.8, yPct: 38.3 },
        { node: 'arenaBend' },
        { xPct: 22.4, yPct: 44.5 },
        { node: 'westMerge' },
        { xPct: 31.0, yPct: 54.6 },
        { xPct: 38.0, yPct: 55.0 },
        { node: 'marketCentral' }
      ]
    },
    {
      id: 'market-to-palace',
      points: [
        { node: 'marketCentral' },
        { xPct: 44.2, yPct: 52.4 },
        { xPct: 43.9, yPct: 49.6 },
        { xPct: 43.8, yPct: 46.8 },
        { node: 'palace' }
      ]
    },
    {
      id: 'market-to-fey',
      points: [
        { node: 'marketCentral' },
        { xPct: 49.0, yPct: 56.0 },
        { node: 'feyForest' }
      ]
    },
    {
      id: 'fey-to-gutterglass',
      points: [
        { node: 'feyForest' },
        { xPct: 62.5, yPct: 57.5 },
        { node: 'eastMerge' },
        { xPct: 71.0, yPct: 48.0 },
        { node: 'gutterglass' }
      ]
    },
    {
      id: 'market-to-shop',
      points: [
        { node: 'marketCentral' },
        { xPct: 47.5, yPct: 52.0 },
        { node: 'hospitalBend' },
        { xPct: 55.5, yPct: 43.5 },
        { node: 'portJunction' },
        { xPct: 58.8, yPct: 28.0 },
        { node: 'shop' }
      ]
    }
  ];

  const polylines = routes.map((route) => ({
    id: route.id,
    points: route.points.map((pt) => {
      if (pt && pt.node && nodes[pt.node]) {
        return { xPct: nodes[pt.node].xPct, yPct: nodes[pt.node].yPct, node: pt.node };
      }
      return { xPct: pt.xPct, yPct: pt.yPct };
    })
  }));

  window.TinyTurnRPGModules.overworldRoads = {
    nodes,
    routes,
    polylines,
    intersections: ['marketCentral', 'feyForest']
  };
})();
