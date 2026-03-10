/**
 * Tiny Turn RPG
 * Turn-based, single-player battle loop (in-browser).
 *
 * Strategy overhaul:
 * - Three-wave battle (Wave 3 is a boss).
 * - Expanded type system: Wind / Fire / Sight / Earth / Touch (with STAB).
 * - Removed RNG (no crits, no misses, no random status procs).
 * - Added Focus (resource) + Enemy Intent telegraphing for planning.
 */

const root = document.getElementById("rpgRoot");

if (root) {
  const modules = window.TinyTurnRPGModules || {};
  const createGameElements = modules.createGameElements || (() => ({}));
  const autoScaleSprite = modules.autoScaleSprite || (() => {});
  const autoScaleSpritesIn = modules.autoScaleSpritesIn || (() => {});
  const overworldRoadsModule = modules.overworldRoads || null;
  const els = createGameElements(document);

  // --------------------
  // Overworld (very simple traversable map)
  // Now rendered on top of the same map image used on the Map page.
  // --------------------
  const OVERWORLD = {
    xPct: 46,
    yPct: 52,
    stepPct: 3.5,
    moveSpeedPct: 18,
    snapRadiusPct: 5.75,
    worldScale: 1.55,
    minScale: 1,
    maxScale: 2.35,
    targetX: null,
    targetY: null,
    rafId: 0,
    keys: Object.create(null),
    hasPointerGuide: false,
    roadGraph: null,
    pathNodeIds: [],
    keyboardNodeTarget: null,
    // Tooltip UX state
    hoveredLocId: null,
    isDragging: false,
    showRoadOverlay: true,
    showFog: true,
    fogReveals: [],
    fogRevealRadiusPct: 8.5,
    fogStampGapPct: 3.4,
    fogDirty: true,
    fogCachedMarkup: '',
    fogRevealedSpotIds: Object.create(null),
  };


  const APPROACH = {
    active: false,
    locationId: null,
    scene: null,
    xPct: 12,
    yPct: 74,
    targetX: null,
    targetY: null,
    moveSpeedPct: 34,
    gridCols: 12,
    gridRows: 8,
    tileCol: 0,
    tileRow: 0,
    pathTiles: [],
    queuedDir: null,
    moving: false,
    moveFromX: 12,
    moveFromY: 74,
    moveToX: 12,
    moveToY: 74,
    moveToCol: 0,
    moveToRow: 0,
    moveElapsed: 0,
    moveDuration: 0.14,
    grid: null,
    rafId: 0,
    lastTs: 0,
    keys: Object.create(null),
    preferredDir: null,
    nearGate: false,
    nearInteractableId: null,
    nearPuzzleNodeId: null,
    nearEncounterTileId: null,
    interactedIds: Object.create(null),
    bonuses: [],
    puzzleStates: Object.create(null),
    encounterTiles: [],
    encounterTileStates: Object.create(null),
    statusMessage: '',
    puzzle: {
      active: false,
      interactableId: null,
      prompt: '',
      hint: '',
      sequence: [],
      entered: [],
      message: '',
    },
  };

  const APPROACH_SKIRMISH_DEFAULT_CHANCE = 0.16;

  // Battle locations used by the RPG.
  const BASE_OVERWORLD_BATTLE_IDS = ["arena", "market-central", "fey-forest", "gutterglass"];
  const FINAL_LOCATION_ID = "palace";
  // Non-battle locations (utility).
  const OVERWORLD_SHOP_IDS = ["shop"];

  const CAMPAIGN_DISTRICTS = [
    { id: "arena", label: "Arena", bossName: "Iron Champion", artifactName: "Crown Sigil", artifactIcon: "👑", blurb: "A champion's seal torn from the roar of the coliseum." },
    { id: "market-central", label: "Market Central", bossName: "Gilded Broker", artifactName: "Coin of Accord", artifactIcon: "🪙", blurb: "A pact-marked coin reclaimed from the city's bargaining heart." },
    { id: "fey-forest", label: "Fey Forest", bossName: "Thorn Regent", artifactName: "Verdant Lens", artifactIcon: "🌿", blurb: "A living lens of mossglass that still hums with old roots." },
    { id: "gutterglass", label: "Gutterglass", bossName: "Shard Warden", artifactName: "Prism Heart", artifactIcon: "🔷", blurb: "A faceted core that catches too many versions of the truth." },
  ];
  const CAMPAIGN_DISTRICT_BY_ID = Object.fromEntries(CAMPAIGN_DISTRICTS.map((d) => [d.id, d]));

  function getCampaignProgress(player = state?.player || null) {
    const savedBossUniques = player?.bossUniques ?? loadHeroProgress(activeHeroId).bossUniques;
    const clears = sanitizeBossUniques(savedBossUniques);
    const recovered = CAMPAIGN_DISTRICTS.filter((d) => !!clears[d.id]);
    const finalUnlocked = recovered.length >= CAMPAIGN_DISTRICTS.length;
    const campaignComplete = !!clears[FINAL_LOCATION_ID];
    return {
      clears,
      recovered,
      recoveredCount: recovered.length,
      finalUnlocked,
      campaignComplete,
    };
  }

  function isCampaignFinalUnlocked(player = state?.player || null) {
    return getCampaignProgress(player).finalUnlocked;
  }

  function getOverworldBattleIds() {
    const ids = [...BASE_OVERWORLD_BATTLE_IDS];
    if (isCampaignFinalUnlocked()) ids.push(FINAL_LOCATION_ID);
    return ids;
  }

  function getOverworldVisibleBattleIds() {
    return [...BASE_OVERWORLD_BATTLE_IDS, FINAL_LOCATION_ID];
  }

  function getCampaignTrackerHtml(progress = getCampaignProgress()) {
    const chips = CAMPAIGN_DISTRICTS.map((d) => {
      const done = !!progress.clears[d.id];
      return `
        <div class="rpgCampaignArtifact${done ? ' isRecovered' : ''}">
          <div class="rpgCampaignArtifactIcon" aria-hidden="true">${d.artifactIcon}</div>
          <div class="rpgCampaignArtifactMeta">
            <strong>${escapeHtml(d.artifactName)}</strong>
            <span>${escapeHtml(d.label)} • ${done ? 'Recovered' : `Defeat ${d.bossName}`}</span>
          </div>
        </div>
      `;
    }).join('');

    const finalText = progress.campaignComplete
      ? 'Final Boss defeated'
      : (progress.finalUnlocked ? 'Palace unlocked' : 'Collect all four artifacts');

    return `
      <section class="rpgCampaignCard" aria-label="Campaign progress">
        <div class="rpgCampaignHead">
          <div>
            <p class="rpgCampaignKicker">Campaign Goal</p>
            <h3 class="rpgCampaignTitle">Defeat the district bosses and reclaim the four city artifacts</h3>
            <p class="rpgCampaignBody">Each district boss guards one artifact. Recover the full set to unlock the Palace and finish the campaign.</p>
          </div>
          <div class="rpgCampaignMeter" aria-label="Artifacts recovered">${progress.recoveredCount} / ${CAMPAIGN_DISTRICTS.length}</div>
        </div>
        <div class="rpgCampaignArtifacts">${chips}</div>
        <div class="rpgCampaignFinal${progress.finalUnlocked ? ' isUnlocked' : ''}${progress.campaignComplete ? ' isComplete' : ''}">
          <span class="rpgCampaignFinalLabel">Palace Gate</span>
          <strong>${escapeHtml(finalText)}</strong>
        </div>
      </section>
    `;
  }

  // Overworld-only position overrides (so the site map can keep its own layout).
  // Percent values are relative to the map image inside the overworld modal.
  const OVERWORLD_POS_OVERRIDES = {
    // Keep the shop far from the battle markers *and* within the default visible area
    // of the overworld modal (so you don't have to scroll to find it).
    shop: { leftPct: 59.8, topPct: 29.6 },
    [FINAL_LOCATION_ID]: { leftPct: 43.8, topPct: 43.9 },
  };

  const OVERWORLD_LOC_ICONS = {
    "arena": "🏟️",
    "market-central": "🏙️",
    "fey-forest": "🌿",
    "gutterglass": "🪞",
    // Shop marker: keep it flat (no coin/emoji on the pin).
    "shop": "",
    [FINAL_LOCATION_ID]: "✦",
  };

  function getOverworldPos(id) {
    const o = OVERWORLD_POS_OVERRIDES && OVERWORLD_POS_OVERRIDES[id];
    if (o && typeof o.leftPct === 'number' && typeof o.topPct === 'number') return o;
    const m = getMapLocationData(id);
    if (!m) return null;
    return { leftPct: toSafeNum(m.leftPct, 50), topPct: toSafeNum(m.topPct, 50) };
  }

  function getMapLocationData(id) {
    const data = window.MAP_LOCATIONS_DATA;
    if (!data || !Array.isArray(data.locations)) return null;
    return data.locations.find((l) => l && l.id === id) || null;
  }


function getOverworldRoadSource() {
  return (overworldRoadsModule && Array.isArray(overworldRoadsModule.polylines))
    ? overworldRoadsModule.polylines
    : [];
}

function buildOverworldRoadGraph() {
  const src = getOverworldRoadSource();
  if (!src.length) return { nodes: [], edges: [], intersections: [] };

  const explicitNodes = (overworldRoadsModule && overworldRoadsModule.nodes) ? overworldRoadsModule.nodes : null;
  const explicitIntersections = Array.isArray(overworldRoadsModule?.intersections) ? overworldRoadsModule.intersections : [];
  const nodes = [];
  const edgeMaps = [];
  const namedNodeToIndex = new Map();
  const keyToIndex = new Map();
  const keyScale = 4;
  const spacingPct = 0.85;

  const makeKey = (x, y) => `${Math.round(x * keyScale)}:${Math.round(y * keyScale)}`;
  const getNodeIndex = (x, y, name = '') => {
    if (name && namedNodeToIndex.has(name)) return namedNodeToIndex.get(name);
    const k = makeKey(x, y);
    if (keyToIndex.has(k)) {
      const found = keyToIndex.get(k);
      if (name) namedNodeToIndex.set(name, found);
      return found;
    }
    const idx = nodes.length;
    nodes.push({ xPct: x, yPct: y, name: name || '' });
    edgeMaps.push(new Map());
    keyToIndex.set(k, idx);
    if (name) namedNodeToIndex.set(name, idx);
    return idx;
  };
  const connect = (a, b) => {
    if (a === b || !Number.isFinite(a) || !Number.isFinite(b)) return;
    const na = nodes[a];
    const nb = nodes[b];
    const dist = Math.hypot((nb.xPct - na.xPct), (nb.yPct - na.yPct));
    if (!Number.isFinite(dist) || dist <= 0) return;
    const ma = edgeMaps[a];
    const mb = edgeMaps[b];
    const prevA = ma.get(b);
    const prevB = mb.get(a);
    if (!Number.isFinite(prevA) || dist < prevA) ma.set(b, dist);
    if (!Number.isFinite(prevB) || dist < prevB) mb.set(a, dist);
  };

  if (explicitNodes && typeof explicitNodes === 'object') {
    Object.entries(explicitNodes).forEach(([name, pt]) => {
      const x = toSafeNum(pt?.xPct, NaN);
      const y = toSafeNum(pt?.yPct, NaN);
      if ([x, y].every(Number.isFinite)) getNodeIndex(x, y, name);
    });
  }

  src.forEach((poly) => {
    const pts = (poly && Array.isArray(poly.points)) ? poly.points : [];
    if (pts.length < 2) return;
    let prevIdx = null;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const ax = toSafeNum(a?.xPct, NaN);
      const ay = toSafeNum(a?.yPct, NaN);
      const bx = toSafeNum(b?.xPct, NaN);
      const by = toSafeNum(b?.yPct, NaN);
      const aName = (typeof a?.node === 'string') ? a.node : '';
      const bName = (typeof b?.node === 'string') ? b.node : '';
      if (![ax, ay, bx, by].every(Number.isFinite)) continue;
      const aIdx = getNodeIndex(ax, ay, aName);
      if (prevIdx !== null && prevIdx !== aIdx) connect(prevIdx, aIdx);
      prevIdx = aIdx;
      const segLen = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(segLen / spacingPct));
      for (let s = 1; s < steps; s += 1) {
        const t = s / steps;
        const x = ax + ((bx - ax) * t);
        const y = ay + ((by - ay) * t);
        const idx = getNodeIndex(x, y);
        connect(prevIdx, idx);
        prevIdx = idx;
      }
      const bIdx = getNodeIndex(bx, by, bName);
      connect(prevIdx, bIdx);
      prevIdx = bIdx;
    }
  });

  const edges = edgeMaps.map((m) => Array.from(m.entries()).map(([to, cost]) => ({ to, cost })));
  const intersections = explicitIntersections
    .map((name) => namedNodeToIndex.get(name))
    .filter((idx) => Number.isFinite(idx));
  return { nodes, edges, intersections };
}

function getOverworldRoadGraph() {
  if (!OVERWORLD.roadGraph) OVERWORLD.roadGraph = buildOverworldRoadGraph();
  return OVERWORLD.roadGraph;
}

function findNearestRoadNode(xPct, yPct) {
  const graph = getOverworldRoadGraph();
  if (!graph.nodes.length) return null;
  let best = null;
  for (let i = 0; i < graph.nodes.length; i += 1) {
    const n = graph.nodes[i];
    const dist = Math.hypot((xPct - n.xPct), (yPct - n.yPct));
    if (!best || dist < best.dist) best = { index: i, xPct: n.xPct, yPct: n.yPct, dist };
  }
  return best;
}

function snapOverworldToRoad() {
  const nearest = findNearestRoadNode(OVERWORLD.xPct, OVERWORLD.yPct);
  if (!nearest) return false;
  OVERWORLD.xPct = nearest.xPct;
  OVERWORLD.yPct = nearest.yPct;
  return true;
}

function findShortestRoadPath(startIndex, goalIndex) {
  const graph = getOverworldRoadGraph();
  if (!graph.nodes.length) return [];
  if (!Number.isFinite(startIndex) || !Number.isFinite(goalIndex)) return [];
  if (startIndex === goalIndex) return [startIndex];

  const nodeCount = graph.nodes.length;
  const dist = new Array(nodeCount).fill(Infinity);
  const prev = new Array(nodeCount).fill(-1);
  const open = new Set([startIndex]);
  dist[startIndex] = 0;

  const heuristic = (idx) => {
    const a = graph.nodes[idx];
    const b = graph.nodes[goalIndex];
    return Math.hypot((a.xPct - b.xPct), (a.yPct - b.yPct));
  };

  while (open.size) {
    let current = -1;
    let bestScore = Infinity;
    for (const idx of open) {
      const score = dist[idx] + heuristic(idx);
      if (score < bestScore) {
        bestScore = score;
        current = idx;
      }
    }
    if (current < 0) break;
    if (current === goalIndex) break;
    open.delete(current);

    const edges = graph.edges[current] || [];
    for (const edge of edges) {
      const next = edge.to;
      const alt = dist[current] + edge.cost;
      if (alt + 1e-9 < dist[next]) {
        dist[next] = alt;
        prev[next] = current;
        open.add(next);
      }
    }
  }

  if (!Number.isFinite(dist[goalIndex])) return [];
  const out = [];
  let cursor = goalIndex;
  while (cursor >= 0) {
    out.push(cursor);
    if (cursor === startIndex) break;
    cursor = prev[cursor];
  }
  out.reverse();
  return out;
}

function setOverworldPathByNodeIndices(nodeIds) {
  const graph = getOverworldRoadGraph();
  const clean = Array.isArray(nodeIds)
    ? nodeIds.filter((idx) => Number.isFinite(idx) && graph.nodes[idx])
    : [];
  OVERWORLD.pathNodeIds = clean.slice();
  OVERWORLD.keyboardNodeTarget = null;
  if (!clean.length) {
    OVERWORLD.targetX = null;
    OVERWORLD.targetY = null;
    OVERWORLD.hasPointerGuide = false;
    return;
  }
  const finalNode = graph.nodes[clean[clean.length - 1]];
  OVERWORLD.targetX = finalNode.xPct;
  OVERWORLD.targetY = finalNode.yPct;
  OVERWORLD.hasPointerGuide = true;
}

function moveTowardRoadNode(nodeIndex, stepPct) {
  const graph = getOverworldRoadGraph();
  const node = graph.nodes[nodeIndex];
  if (!node) return false;
  const dx = node.xPct - OVERWORLD.xPct;
  const dy = node.yPct - OVERWORLD.yPct;
  const dist = Math.hypot(dx, dy);
  if (dist <= 0.0001) {
    OVERWORLD.xPct = node.xPct;
    OVERWORLD.yPct = node.yPct;
    return true;
  }
  const step = Math.max(0.0001, toSafeNum(stepPct, 0));
  if (dist <= step) {
    OVERWORLD.xPct = node.xPct;
    OVERWORLD.yPct = node.yPct;
    return true;
  }
  OVERWORLD.xPct += (dx / dist) * step;
  OVERWORLD.yPct += (dy / dist) * step;
  return false;
}

function chooseKeyboardRoadNode(input) {
  const graph = getOverworldRoadGraph();
  if (!graph.nodes.length || !input) return null;

  // Prefer staying on the current segment unless the player clearly asks to turn.
  if (Number.isFinite(OVERWORLD.keyboardNodeTarget) && graph.nodes[OVERWORLD.keyboardNodeTarget]) {
    const targetNode = graph.nodes[OVERWORLD.keyboardNodeTarget];
    const dx = targetNode.xPct - OVERWORLD.xPct;
    const dy = targetNode.yPct - OVERWORLD.yPct;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.14) {
      const dot = ((dx / dist) * input.x) + ((dy / dist) * input.y);
      if (dot > -0.1) return OVERWORLD.keyboardNodeTarget;
    }
  }

  const nearest = findNearestRoadNode(OVERWORLD.xPct, OVERWORLD.yPct);
  if (!nearest) return null;
  const current = nearest.index;
  const edges = graph.edges[current] || [];
  if (!edges.length) return null;

  let bestIdx = null;
  let bestScore = 0.35;
  for (const edge of edges) {
    const node = graph.nodes[edge.to];
    if (!node) continue;
    const dx = node.xPct - OVERWORLD.xPct;
    const dy = node.yPct - OVERWORLD.yPct;
    const dist = Math.hypot(dx, dy);
    if (dist <= 0.0001) continue;
    const dot = ((dx / dist) * input.x) + ((dy / dist) * input.y);
    // Prefer closer nodes when the angle match is similar.
    const score = dot - (dist * 0.015);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = edge.to;
    }
  }
  return bestIdx;
}

function buildRoadPathToPoint(leftPct, topPct) {
  const graph = getOverworldRoadGraph();
  if (!graph.nodes.length) return [];
  const from = findNearestRoadNode(OVERWORLD.xPct, OVERWORLD.yPct);
  const to = findNearestRoadNode(leftPct, topPct);
  if (!from || !to) return [];
  const path = findShortestRoadPath(from.index, to.index);
  if (!path.length) return [];
  if (path.length > 1 && path[0] === from.index) path.shift();
  return path;
}

function getSingleStepRoadPath(dx, dy) {
  const len = Math.hypot(dx, dy) || 1;
  const input = { x: dx / len, y: dy / len };
  const nextIdx = chooseKeyboardRoadNode(input);
  return Number.isFinite(nextIdx) ? [nextIdx] : [];
}

function getLeftmostRoadNode() {
  const graph = getOverworldRoadGraph();
  if (!graph.nodes.length) return null;
  return graph.nodes.reduce((best, node) => {
    if (!node) return best;
    if (!best) return node;
    if (node.xPct < best.xPct) return node;
    if (Math.abs(node.xPct - best.xPct) < 0.001 && node.yPct < best.yPct) return node;
    return best;
  }, null);
}

function resetOverworldFog() {
  OVERWORLD.fogReveals = [];
  OVERWORLD.fogDirty = true;
  OVERWORLD.fogCachedMarkup = '';
  OVERWORLD.fogRevealedSpotIds = Object.create(null);
}

function stampFogReveal(xPct = OVERWORLD.xPct, yPct = OVERWORLD.yPct, radiusPct = OVERWORLD.fogRevealRadiusPct, force = false) {
  const x = clamp(toSafeNum(xPct, OVERWORLD.xPct), 0, 100);
  const y = clamp(toSafeNum(yPct, OVERWORLD.yPct), 0, 100);
  const r = Math.max(2.5, toSafeNum(radiusPct, OVERWORLD.fogRevealRadiusPct));
  const reveals = Array.isArray(OVERWORLD.fogReveals) ? OVERWORLD.fogReveals : [];
  const last = reveals.length ? reveals[reveals.length - 1] : null;
  const gap = Math.max(1.2, toSafeNum(OVERWORLD.fogStampGapPct, 3.4));
  if (!force && last && Math.hypot(x - last.xPct, y - last.yPct) < gap) return false;
  reveals.push({ xPct: x, yPct: y, radiusPct: r });
  if (reveals.length > 120) reveals.splice(0, reveals.length - 120);
  OVERWORLD.fogReveals = reveals;
  OVERWORLD.fogDirty = true;
  return true;
}

function renderFogOverlay() {
  if (!(els.locationChoices instanceof HTMLElement)) return;
  const fogEl = els.locationChoices.querySelector('#owFog');
  const holesEl = els.locationChoices.querySelector('#owFogMaskHoles');
  if (!(fogEl instanceof SVGElement) || !(holesEl instanceof SVGElement)) return;
  fogEl.classList.toggle('isHidden', !OVERWORLD.showFog);
  if (!OVERWORLD.showFog) return;
  if (!OVERWORLD.fogDirty) return;
  const circles = (Array.isArray(OVERWORLD.fogReveals) ? OVERWORLD.fogReveals : [])
    .map((pt) => `<circle cx="${toSafeNum(pt?.xPct, 0)}" cy="${toSafeNum(pt?.yPct, 0)}" r="${toSafeNum(pt?.radiusPct, OVERWORLD.fogRevealRadiusPct)}" fill="black" />`)
    .join('');
  if (circles !== OVERWORLD.fogCachedMarkup) {
    holesEl.innerHTML = circles;
    OVERWORLD.fogCachedMarkup = circles;
  }
  OVERWORLD.fogDirty = false;
}

  function resetOverworld() {
    const startNode = getLeftmostRoadNode();
    OVERWORLD.xPct = toSafeNum(startNode?.xPct, 46);
    OVERWORLD.yPct = toSafeNum(startNode?.yPct, 52);
    OVERWORLD.targetX = null;
    OVERWORLD.targetY = null;
    OVERWORLD.hasPointerGuide = false;
    OVERWORLD.pathNodeIds = [];
    OVERWORLD.keyboardNodeTarget = null;
    resetOverworldFog();
    snapOverworldToRoad();
    stampFogReveal(OVERWORLD.xPct, OVERWORLD.yPct, OVERWORLD.fogRevealRadiusPct + 1.5, true);
  }

  function nearestBattleLocation() {
    let bestId = null;
    let bestDist = Infinity;

    for (const id of getOverworldVisibleBattleIds()) {
      const m = getOverworldPos(id);
      if (!m) continue;
      const dx = (OVERWORLD.xPct - toSafeNum(m.leftPct, 0));
      const dy = (OVERWORLD.yPct - toSafeNum(m.topPct, 0));
      const d = Math.hypot(dx, dy);
      if (d < bestDist) {
        bestDist = d;
        bestId = id;
      }
    }

    if (bestId && bestDist <= OVERWORLD.snapRadiusPct) return bestId;
    return null;
  }

  
  function nearestShopLocation() {
    let bestId = null;
    let bestDist = Infinity;

    for (const id of OVERWORLD_SHOP_IDS) {
      const m = getOverworldPos(id);
      if (!m) continue;
      const dx = (OVERWORLD.xPct - toSafeNum(m.leftPct, 0));
      const dy = (OVERWORLD.yPct - toSafeNum(m.topPct, 0));
      const d = Math.hypot(dx, dy);
      if (d < bestDist) { bestDist = d; bestId = id; }
    }

    if (bestId && bestDist <= OVERWORLD.snapRadiusPct) return bestId;
    return null;
  }

  function getNearestOverworldSpot() {
    // Pick the closest "interactive" spot (battle or shop).
    const bId = nearestBattleLocation();
    const sId = nearestShopLocation();

    const distTo = (id) => {
      const m = id ? getOverworldPos(id) : null;
      if (!m) return Infinity;
      const dx = (OVERWORLD.xPct - toSafeNum(m.leftPct, 0));
      const dy = (OVERWORLD.yPct - toSafeNum(m.topPct, 0));
      return Math.hypot(dx, dy);
    };

    const bd = bId ? distTo(bId) : Infinity;
    const sd = sId ? distTo(sId) : Infinity;

    if (!bId && !sId) return null;
    // Tie-break in favor of shop so you can reliably open it when markers overlap.
    if (sId && sd <= bd) return { kind: "shop", id: sId };
    return { kind: "battle", id: bId };
  }
function currentLocId() {
    return nearestBattleLocation();
  }

  function getBattleableOverworldLocation() {
    const locId = nearestBattleLocation();
    if (!locId) return null;
    if (locId === FINAL_LOCATION_ID && !isCampaignFinalUnlocked()) return null;
    // Only consider it battle-ready if the RPG location picker actually includes it.
    // (Avoids falling back to LOCATIONS[0] when an ID is missing.)
    const loc = (typeof LOCATIONS !== 'undefined' && Array.isArray(LOCATIONS))
      ? (LOCATIONS.find((l) => l && l.id === locId) || null)
      : null;
    return loc;
  }

  function setOwPos(leftPct, topPct) {
    OVERWORLD.xPct = clamp(toSafeNum(leftPct, OVERWORLD.xPct), 0, 100);
    OVERWORLD.yPct = clamp(toSafeNum(topPct, OVERWORLD.yPct), 0, 100);
    snapOverworldToRoad();
  }


  function setOverworldTarget(leftPct, topPct) {
    const x = clamp(toSafeNum(leftPct, OVERWORLD.xPct), 0, 100);
    const y = clamp(toSafeNum(topPct, OVERWORLD.yPct), 0, 100);
    const path = buildRoadPathToPoint(x, y);
    if (!path.length) {
      clearOverworldTarget();
      return;
    }
    setOverworldPathByNodeIndices(path);
  }

  function clearOverworldTarget() {
    OVERWORLD.targetX = null;
    OVERWORLD.targetY = null;
    OVERWORLD.hasPointerGuide = false;
    OVERWORLD.pathNodeIds = [];
    OVERWORLD.keyboardNodeTarget = null;
  }

  function setOverworldZoom(nextScale) {
    const scale = clamp(toSafeNum(nextScale, OVERWORLD.worldScale), OVERWORLD.minScale, OVERWORLD.maxScale);
    if (Math.abs(scale - OVERWORLD.worldScale) < 0.001) return;
    OVERWORLD.worldScale = scale;
    renderOverworldPositions();
  }

  function getOverworldInputVector() {
    const keys = OVERWORLD.keys || {};
    const x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const y = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (!x && !y) return null;
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  }

  function renderOverworldCamera() {
    if (!(els.locationChoices instanceof HTMLElement)) return;
    const frameEl = els.locationChoices.querySelector('#owFrame');
    const worldEl = els.locationChoices.querySelector('#owWorld');
    const hudZoom = els.locationChoices.querySelector('[data-ow-zoom-label]');
    const zoomOutBtn = els.locationChoices.querySelector('button[data-ow-zoom="out"]');
    const zoomInBtn = els.locationChoices.querySelector('button[data-ow-zoom="in"]');
    if (!(frameEl instanceof HTMLElement) || !(worldEl instanceof HTMLElement)) return;

    const frameRect = frameEl.getBoundingClientRect();
    const frameW = Math.max(1, frameRect.width || frameEl.clientWidth || 1);
    const frameH = Math.max(1, frameRect.height || frameEl.clientHeight || 1);
    const scale = clamp(toSafeNum(OVERWORLD.worldScale, 1.55), OVERWORLD.minScale, OVERWORLD.maxScale);
    const worldW = frameW * scale;
    const worldH = frameH * scale;
    const playerX = (OVERWORLD.xPct / 100) * worldW;
    const playerY = (OVERWORLD.yPct / 100) * worldH;
    const rawX = (frameW / 2) - playerX;
    const rawY = (frameH / 2) - playerY;
    const minX = Math.min(0, frameW - worldW);
    const minY = Math.min(0, frameH - worldH);
    const tx = clamp(rawX, minX, 0);
    const ty = clamp(rawY, minY, 0);

    worldEl.style.width = `${scale * 100}%`;
    worldEl.style.height = `${scale * 100}%`;
    worldEl.style.transform = `translate(${tx}px, ${ty}px)`;

    if (hudZoom instanceof HTMLElement) hudZoom.textContent = `${Math.round(scale * 100)}%`;
    if (zoomOutBtn instanceof HTMLButtonElement) zoomOutBtn.disabled = scale <= OVERWORLD.minScale + 0.01;
    if (zoomInBtn instanceof HTMLButtonElement) zoomInBtn.disabled = scale >= OVERWORLD.maxScale - 0.01;
  }

  function ensureOverworldAnimation() {
    if (OVERWORLD.rafId) return;
    let lastTs = 0;
    const tick = (ts) => {
      if (!isLocationOpen()) {
        OVERWORLD.rafId = 0;
        return;
      }
      const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : (1 / 60);
      lastTs = ts;
      let moved = false;
      const input = getOverworldInputVector();
      const step = OVERWORLD.moveSpeedPct * dt;

      if (input) {
        OVERWORLD.pathNodeIds = [];
        const nextIdx = chooseKeyboardRoadNode(input);
        if (Number.isFinite(nextIdx)) {
          OVERWORLD.keyboardNodeTarget = nextIdx;
          const reached = moveTowardRoadNode(nextIdx, step);
          moved = true;
          if (reached) OVERWORLD.keyboardNodeTarget = null;
          OVERWORLD.hasPointerGuide = false;
        }
      } else if (OVERWORLD.pathNodeIds.length) {
        const nextIdx = OVERWORLD.pathNodeIds[0];
        const reached = moveTowardRoadNode(nextIdx, step);
        moved = true;
        if (reached) {
          OVERWORLD.pathNodeIds.shift();
          if (!OVERWORLD.pathNodeIds.length) clearOverworldTarget();
        }
      } else {
        OVERWORLD.keyboardNodeTarget = null;
      }

      if (moved) {
        stampFogReveal();
        const nearSpot = getNearestOverworldSpot();
        if (nearSpot && !OVERWORLD.fogRevealedSpotIds[nearSpot.id]) {
          const nearPos = getOverworldPos(nearSpot.id);
          if (nearPos) {
            OVERWORLD.fogRevealedSpotIds[nearSpot.id] = true;
            stampFogReveal(nearPos.leftPct, nearPos.topPct, OVERWORLD.fogRevealRadiusPct + 2.5, true);
          }
        }
        updateOverworldUI();
        renderOverworldPositions();
      }
      const shouldContinue = !!getOverworldInputVector() || OVERWORLD.pathNodeIds.length > 0 || Number.isFinite(OVERWORLD.keyboardNodeTarget);
      if (shouldContinue) OVERWORLD.rafId = window.requestAnimationFrame(tick);
      else OVERWORLD.rafId = 0;
    };
    OVERWORLD.rafId = window.requestAnimationFrame(tick);
  }

  function renderOverworldPositions() {
    if (!(els.locationChoices instanceof HTMLElement)) return;
    renderOverworldCamera();
    const playerEl = els.locationChoices.querySelector('.rpgOverworldPlayer');
    const targetEl = els.locationChoices.querySelector('#owTarget');
    if (playerEl instanceof HTMLElement) {
      playerEl.style.left = `${OVERWORLD.xPct}%`;
      playerEl.style.top = `${OVERWORLD.yPct}%`;
      playerEl.classList.toggle('isTraveling', !!getOverworldInputVector() || Number.isFinite(OVERWORLD.targetX));
    }
    if (targetEl instanceof HTMLElement) {
      const showTarget = OVERWORLD.hasPointerGuide && Number.isFinite(OVERWORLD.targetX) && Number.isFinite(OVERWORLD.targetY);
      targetEl.toggleAttribute('hidden', !showTarget);
      if (showTarget) {
        targetEl.style.left = `${OVERWORLD.targetX}%`;
        targetEl.style.top = `${OVERWORLD.targetY}%`;
      }
    }
    renderFogOverlay();

    const spot = getNearestOverworldSpot();
    const nearId = spot ? spot.id : null;
    const pins = els.locationChoices.querySelectorAll('button.rpgOverworldPin[data-ow-loc]');
    pins.forEach((pin) => {
      if (!(pin instanceof HTMLElement)) return;
      const id = pin.getAttribute('data-ow-loc');
      if (!id) return;
      pin.classList.toggle('isNearby', id === nearId);
    });

    if (playerEl instanceof HTMLElement) {
      playerEl.classList.toggle('isNearLocation', !!nearId);
    }

    // Tooltip sync:
    // - If you're hovering/focusing a marker, show that marker's name.
    // - Otherwise, if the player is standing on/near a marker, show that marker's name.
    // - Suppress while dragging the map.
    const frameEl = els.locationChoices.querySelector('#owFrame');
    const tooltipEl = els.locationChoices.querySelector('#owTooltip');
    if (frameEl instanceof HTMLElement && tooltipEl instanceof HTMLElement) {
      const hide = () => {
        tooltipEl.setAttribute('hidden','');
        tooltipEl.setAttribute('aria-hidden','true');
      };

      if (OVERWORLD.isDragging) {
        hide();
        return;
      }

      const targetId = (OVERWORLD.hoveredLocId || nearId);
      if (!targetId) { hide(); return; }
      const pin = els.locationChoices.querySelector(`button.rpgOverworldPin[data-ow-loc="${targetId}"]`);
      if (!(pin instanceof HTMLElement)) { hide(); return; }
      const raw = (pin.getAttribute('data-ow-name') || '').trim();
      if (!raw) { hide(); return; }

      tooltipEl.textContent = raw;
      tooltipEl.removeAttribute('hidden');
      tooltipEl.setAttribute('aria-hidden','false');

      const fr = frameEl.getBoundingClientRect();
      // Default: anchor tooltip to the marker center.
      let x = 0;
      let y = 0;
      let place = "top";

      const pr = pin.getBoundingClientRect();
      x = (pr.left - fr.left) + (pr.width / 2);
      y = (pr.top - fr.top) + (pr.height / 2);

      // If the action bubble is visible for this same marker, anchor the tooltip to the bubble
      // so the name + button feel like one tidy stack (and don't overlap).
      const bubble = els.locationChoices.querySelector('#owBubble');
      if (bubble instanceof HTMLElement && !bubble.hasAttribute('hidden')) {
        const bubbleId = (bubble.getAttribute('data-ow-loc') || '').trim();
        if (bubbleId && bubbleId === targetId) {
          const br = bubble.getBoundingClientRect();
          x = (br.left - fr.left) + (br.width / 2);

          // Prefer above the bubble; if that would clip, flip below.
          const topY = (br.top - fr.top);
          const bottomY = (br.bottom - fr.top);
          if (topY < 64) {
            y = bottomY;
            place = "bottom";
          } else {
            y = topY;
            place = "top";
          }
        }
      }

      const pad = 12;
      const cx = clamp(x, pad, Math.max(pad, fr.width - pad));
      const cy = clamp(y, pad, Math.max(pad, fr.height - pad));
      tooltipEl.style.left = `${cx}px`;
      tooltipEl.style.top = `${cy}px`;
      tooltipEl.setAttribute('data-place', (place === "bottom") ? 'bottom' : 'top');
    }
  }

  function updateOverworldUI() {
    const battleLoc = getBattleableOverworldLocation();
    const shopId = nearestShopLocation();
    const shopMeta = shopId ? getMapLocationData(shopId) : null;
    const shopTitle = shopMeta?.title || shopMeta?.name || "Shop";
    const isAtShop = !!shopId;
    const loc = battleLoc;

    // Bubble UI: show the actionable button anchored next to the nearby marker.
    const bubble = (els.locationChoices instanceof HTMLElement)
      ? els.locationChoices.querySelector('#owBubble')
      : null;
    const bubbleBattleBtn = (bubble instanceof HTMLElement)
      ? bubble.querySelector('button[data-ow-action="battle"]')
      : null;
    const bubbleShopBtn = (bubble instanceof HTMLElement)
      ? bubble.querySelector('button[data-ow-action="shop"]')
      : null;
    const activeId = loc ? loc.id : (isAtShop ? shopId : null);
    const activeKind = loc ? 'battle' : (isAtShop ? 'shop' : null);

    if (els.overworldPos instanceof HTMLElement) {
      els.overworldPos.textContent = `Position: ${OVERWORLD.xPct.toFixed(1)}%, ${OVERWORLD.yPct.toFixed(1)}%`;
    }

    // If the bubble UI exists, we prefer it over the row of buttons under the map.
    // (Keeps the UI tight: action appears right next to the marker you’re standing on.)
    const actionRow =
      ((els.overworldBattleBtn instanceof HTMLElement) ? els.overworldBattleBtn.closest('.rpgOverworldActionRow') : null)
      || ((els.overworldShopBtn instanceof HTMLElement) ? els.overworldShopBtn.closest('.rpgOverworldActionRow') : null);
    if (actionRow instanceof HTMLElement) {
      actionRow.toggleAttribute('hidden', true);
    }

    if (bubble instanceof HTMLElement) {
      if (!activeId || !activeKind || !(els.locationChoices instanceof HTMLElement)) {
        bubble.setAttribute('hidden', '');
        bubble.setAttribute('aria-hidden', 'true');
        bubble.removeAttribute('data-ow-loc');
        bubble.removeAttribute('data-side');
      } else {
        const pin = els.locationChoices.querySelector(`button.rpgOverworldPin[data-ow-loc="${activeId}"]`);
        if (pin instanceof HTMLElement) {
          // Anchor the bubble to the pin and pick a side to avoid clipping.
          const leftStr = pin.style.left || '50%';
          const topStr = pin.style.top || '50%';
          bubble.style.left = leftStr;
          bubble.style.top = topStr;
          const leftPct = parseFloat(String(leftStr).replace('%',''));
          bubble.setAttribute('data-side', (Number.isFinite(leftPct) && leftPct > 75) ? 'left' : 'right');
          bubble.setAttribute('data-ow-loc', String(activeId));

          bubble.removeAttribute('hidden');
          bubble.setAttribute('aria-hidden', 'false');
        } else {
          bubble.setAttribute('hidden', '');
          bubble.setAttribute('aria-hidden', 'true');
          bubble.removeAttribute('data-ow-loc');
          bubble.removeAttribute('data-side');
        }
      }

      // Configure bubble buttons.
      if (bubbleBattleBtn instanceof HTMLButtonElement) {
        bubbleBattleBtn.toggleAttribute('hidden', !loc);
        bubbleBattleBtn.disabled = !loc;
        bubbleBattleBtn.title = loc ? `Explore: ${loc.name || loc.id}` : 'Explore';
        if (loc) bubbleBattleBtn.textContent = loc.id === FINAL_LOCATION_ID ? 'Enter Palace' : 'Explore';
      }
      if (bubbleShopBtn instanceof HTMLButtonElement) {
        const showShop = !loc && isAtShop;
        bubbleShopBtn.toggleAttribute('hidden', !showShop);
        bubbleShopBtn.disabled = !showShop;
        bubbleShopBtn.title = `Shop: ${shopTitle}`;
      }
    }

    if (els.overworldBattleBtn instanceof HTMLButtonElement) {
      // Only show the battle button when you're actually at a battle-ready location.
      // (Otherwise it clutters the UI and implies you can fight anywhere.)
      els.overworldBattleBtn.toggleAttribute('hidden', !loc);
      els.overworldBattleBtn.disabled = !loc;
      els.overworldBattleBtn.textContent = loc ? `${loc.id === FINAL_LOCATION_ID ? 'Enter Palace' : 'Explore'}: ${loc.name || loc.id}` : "Explore here";
    }

    if (els.overworldShopBtn instanceof HTMLButtonElement) {
      const showShop = !loc && isAtShop;
      els.overworldShopBtn.disabled = !showShop;
      if (showShop) {
        els.overworldShopBtn.removeAttribute('hidden');
        els.overworldShopBtn.textContent = `Shop: ${shopTitle}`;
      } else {
        els.overworldShopBtn.setAttribute('hidden','');
      }
    }
  }

  function moveOverworld(dx, dy) {
    if (!isLocationOpen()) return;
    const path = getSingleStepRoadPath(dx, dy);
    if (!path.length) return;
    setOverworldPathByNodeIndices(path);
    ensureOverworldAnimation();
  }


  const prefersReducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /**
   * Effect preview state.
   * Only visible while hovering (or focusing) an action.
   */
  let previewMove = /** @type {null | {name:string, type: MagicType, baseCost:number, extra?: string, customHtml?: string, tone?: "good"|"bad"|"neutral"}} */ (null);
  let previewVisible = false;

  function clearEffectPreview() {
    previewVisible = false;
    previewMove = null;
    if (els.effectPreview instanceof HTMLElement) {
      // Empty content so :empty { display:none } collapses the row.
      els.effectPreview.innerHTML = "";
      // Remove all tone/tier classes so the next hover is always accurate.
      els.effectPreview.classList.remove(
        "isGood",
        "isBad",
        "isNeutral",
        "isSuper",
        "isEffective",
        "isNot",
        "isExtremeNot"
      );
      els.effectPreview.classList.add("isNeutral");
      // Reset tooltip positioning (so it doesn't 'stick' somewhere)
      els.effectPreview.style.left = "";
      els.effectPreview.style.top = "";
      els.effectPreview.style.transform = "";
    }
  }


  /**
   * Play a one-shot CSS animation class by toggling it.
   * @param {HTMLElement|null} el
   * @param {string} cls
   */
  function playAnim(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    // Force reflow so the animation restarts reliably.
    // eslint-disable-next-line no-unused-expressions
    el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener(
      "animationend",
      () => {
        el.classList.remove(cls);
      },
      { once: true }
    );
    window.setTimeout(() => el.classList.remove(cls), 650);
  }

  /**
   * Spawn a one-shot type FX overlay.
   * @param {"wind"|"water"|"fire"|"earth"|"earthCenter"|"sight"|"touch"|"sound"|"smell"|"heal"|"guard"} kind
   * @param {"player"|"enemy"|"center"} side
   */
  function spawnFx(kind, side) {
    if (prefersReducedMotion) return;
    if (!(els.fxLayer instanceof HTMLElement)) return;
    const fx = document.createElement("div");
    fx.className = `rpgFx rpgFx--${kind} rpgFx--${side}`;
    els.fxLayer.appendChild(fx);
    const kill = () => {
      fx.removeEventListener("animationend", kill);
      if (fx.parentElement) fx.parentElement.removeChild(fx);
    };
    // In case no animationend fires (rare), remove anyway.
    fx.addEventListener("animationend", kill, { once: true });
    window.setTimeout(kill, 900);
  }

  /**
   * Floating text pop (damage/heal).
   * @param {string} text
   * @param {"player"|"enemy"} side
   * @param {"dmg"|"heal"} variant
   * @param {number|null} overallMult
   */
  function spawnFloat(text, side, variant = "dmg", overallMult = null) {
    if (prefersReducedMotion) return;
    if (!(els.fxLayer instanceof HTMLElement)) return;
    const f = document.createElement("div");
    f.className = `rpgFloat rpgFloat--${side} rpgFloat--${variant}`;
    if (typeof overallMult === "number") {
      if (overallMult >= 1.30) f.classList.add("rpgFloat--super");
      else if (overallMult <= 0.90) f.classList.add("rpgFloat--weak");
    }
    f.textContent = text;
    els.fxLayer.appendChild(f);
    const kill = () => {
      f.removeEventListener("animationend", kill);
      if (f.parentElement) f.parentElement.removeChild(f);
    };
    f.addEventListener("animationend", kill, { once: true });
    window.setTimeout(kill, 950);
  }

  // Center banner: show the move/action name on the battlefield, then fade away.
  let moveBannerTimer = 0;

  /**
   * @param {string} name
   * @param {MagicType} type
   */
  function showMoveBanner(name, type) {
    if (prefersReducedMotion) return;
    const banner = els.moveBanner;
    const textEl = els.moveBannerText;
    if (!(banner instanceof HTMLElement) || !(textEl instanceof HTMLElement)) return;

    textEl.textContent = name || "";
    banner.setAttribute("data-type", String(type || "Sight"));
    banner.classList.remove("isShow");
    // Force reflow to restart the animation reliably.
    // eslint-disable-next-line no-unused-expressions
    banner.offsetWidth;
    banner.classList.add("isShow");

    if (moveBannerTimer) window.clearTimeout(moveBannerTimer);
    moveBannerTimer = window.setTimeout(() => banner.classList.remove("isShow"), 560);
  }



// Boss intro callout ("BOSS APPEARS") on the battlefield.
let __bossAppearsTimer = 0;

function showBossAppearsCallout() {
  const el = els.bossAppears;
  if (!(el instanceof HTMLElement)) return;

  if (__bossAppearsTimer) window.clearTimeout(__bossAppearsTimer);

  // Play the boss stinger SFX when the callout appears.
  playBossAppearsSfx();

  // Show and (if allowed) animate.
  el.hidden = false;
  el.classList.remove("isShow");

  if (prefersReducedMotion) {
    // Keep it readable without animation, but still respect the 2s timing.
    el.style.opacity = "1";
    __bossAppearsTimer = window.setTimeout(() => {
      el.style.opacity = "";
      el.hidden = true;
    }, 2000);
    return;
  }

  // Force reflow to restart the CSS animation reliably.
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth;
  el.classList.add("isShow");

  __bossAppearsTimer = window.setTimeout(() => {
    el.classList.remove("isShow");
    el.hidden = true;
  }, 2050);
}

  // Center toast between fighters (used for Skill Point gain, etc.)
  let __centerToastTimer = 0;

  /**
   * Spawn a brief center toast on the battlefield (between the sprites).
   * @param {string} text
   * @param {string} kind
   */
  function spawnCenterToast(text, kind = "sp") {
    if (prefersReducedMotion) return;
    if (!(els.fxLayer instanceof HTMLElement)) return;

    const t = document.createElement("div");
    t.className = `rpgCenterToast rpgCenterToast--${kind}`;
    t.textContent = String(text || "");
    els.fxLayer.appendChild(t);

    const kill = () => {
      t.removeEventListener("animationend", kill);
      if (t.parentElement) t.parentElement.removeChild(t);
    };

    // Remove on animation end (and also via timeout as a safety net).
    t.addEventListener("animationend", kill, { once: true });
    window.setTimeout(kill, 850);

    if (__centerToastTimer) window.clearTimeout(__centerToastTimer);
    __centerToastTimer = window.setTimeout(() => {}, 0);
  }

  /**
   * Show a brief Skill Point notification between characters.
   * @param {number} n
   */
  function showSkillPointToast(n) {
    const nn = Math.max(0, toSafeInt(n, 0));
    if (nn <= 0) return;
    const label = nn === 1 ? "+1 Skill Point" : `+${nn} Skill Points`;
    spawnCenterToast(label, "sp");
  }




  function stageShake() {
    if (prefersReducedMotion) return;
    if (!(els.stageInner instanceof HTMLElement)) return;
    els.stageInner.classList.remove("isShaking");
    // eslint-disable-next-line no-unused-expressions
    els.stageInner.offsetWidth;
    els.stageInner.classList.add("isShaking");
    window.setTimeout(() => els.stageInner && els.stageInner.classList.remove("isShaking"), 260);
  }

// --------------------
// SFX: Wave clear (uses the same sound as badge unlock)
// --------------------
const WAVE_CLEAR_SFX_SRC = "assets/audio/badge-unlock.mp3";
let __waveClearAudio = null;
let __waveClearPrimed = false;

function __getWaveClearAudio() {
  if (__waveClearAudio) return __waveClearAudio;
  try {
    const a = new Audio(WAVE_CLEAR_SFX_SRC);
    a.preload = "none";
    a.volume = 0.75;
    __waveClearAudio = a;
    return a;
  } catch {
    return null;
  }
}

// --------------------
// SFX: Boss appears callout
// --------------------
const BOSS_APPEARS_SFX_SRC = "assets/audio/boss-appears.mp3";
let __bossAppearsAudio = null;

function __getBossAppearsAudio() {
  if (__bossAppearsAudio) return __bossAppearsAudio;
  try {
    const a = new Audio(BOSS_APPEARS_SFX_SRC);
    a.preload = "none";
    a.volume = 0.9;
    __bossAppearsAudio = a;
    return a;
  } catch {
    return null;
  }
}

function __primeWaveClearAudioOnce() {
  if (__waveClearPrimed) return;
  __waveClearPrimed = true;

  const wave = __getWaveClearAudio();
  const boss = __getBossAppearsAudio();
  if (!wave && !boss) return;

  const prime = (a) => {
    if (!a) return;
    try {
      const prevMuted = a.muted;
      a.muted = true;
      const p = a.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          a.pause();
          a.currentTime = 0;
          a.muted = prevMuted;
        }).catch(() => {
          a.muted = prevMuted;
        });
      } else {
        a.pause();
        a.currentTime = 0;
        a.muted = prevMuted;
      }
    } catch {
      // ignore
    }
  };

  prime(wave);
  prime(boss);
}

// Prime audio on the first user gesture (needed on many browsers)
["pointerdown", "keydown", "touchstart"].forEach((evt) => {
  window.addEventListener(evt, __primeWaveClearAudioOnce, { once: true, passive: true });
});

function playWaveClearSfx() {
  const a = __getWaveClearAudio();
  if (!a) return;
  try {
    a.currentTime = 0;
  } catch {
    // ignore
  }
  const p = a.play();
  if (p && typeof p.catch === "function") {
    p.catch(() => {});
  }
}

function playBossAppearsSfx() {
  const a = __getBossAppearsAudio();
  if (!a) return;
  try {
    a.currentTime = 0;
  } catch {
    // ignore
  }
  const p = a.play();
  if (p && typeof p.catch === "function") {
    p.catch(() => {});
  }
}


  // --------------------
  // Background music (game page only)
  // --------------------
  const MUSIC_TRACKS = modules.MUSIC_TRACKS || [
    { src: "assets/audio/crystal-fields-of-aeria.mp3", title: "Crystal Fields of Aeria" },
    { src: "assets/audio/crystal-fields-of-aeria-alt.mp3", title: "Crystal Fields of Aeria (Alt)" },
  ];

  const MUSIC_PREF_KEY = modules.MUSIC_PREF_KEY || "rpg_music_enabled_v1";
  const MUSIC_VOL_KEY = modules.MUSIC_VOL_KEY || "rpg_music_volume_v1";

  let __musicAudio = null;
  let __musicIndex = 0;
  let __musicEnabled = false;
  let __musicNeedGesture = false;
  let __musicWasPlayingBeforeHide = false;

  // Boss music (plays during boss wave)
  const BOSS_TRACK = modules.BOSS_TRACK || { src: "assets/audio/arcane-showdown.mp3", title: "Arcane Showdown" };

  let __bossAudio = null;
  let __bossActive = false;
  let __bossNeedGesture = false;
  let __savedBg = null; // {idx:number,time:number,wasPlaying:boolean}

  function __getBossAudio() {
    if (__bossAudio) return __bossAudio;
    try {
      const a = new Audio();
      a.preload = "none";
      a.loop = true;
      a.volume = 0.35;
      __bossAudio = a;
      return a;
    } catch {
      return null;
    }
  }

  function __pauseAllMusic() {
    const bg = __getMusicAudio();
    if (bg) { try { bg.pause(); } catch {} }
    const b = __bossAudio;
    if (b) { try { b.pause(); } catch {} }
  }

  function __tryStartBossMusic() {
    if (!__musicEnabled) return;
    if (!__bossActive) return;
    const a = __getBossAudio();
    if (!a) return;
    if (!a.src) a.src = BOSS_TRACK.src;
    const p = a.play();
    if (p && typeof p.then === "function") {
      p.then(() => { __bossNeedGesture = false; }).catch(() => { __bossNeedGesture = true; });
    }
  }

  function __enterBossMusic() {
    if (__bossActive) return;
    __bossActive = true;

    // Snapshot current background state so we can resume after the boss.
    const bg = __getMusicAudio();
    let time = 0;
    let wasPlaying = false;
    if (bg) {
      try { time = bg.currentTime || 0; } catch {}
      wasPlaying = !bg.paused;
      try { bg.pause(); } catch {}
    }
    __savedBg = { idx: __musicIndex, time, wasPlaying };

    const b = __getBossAudio();
    if (!b) return;
    // Match volume to the current background music volume.
    try { b.volume = bg ? bg.volume : b.volume; } catch {}
    b.src = BOSS_TRACK.src;
    try { b.currentTime = 0; } catch {}
    __tryStartBossMusic();
  }

  function __exitBossMusic() {
    if (!__bossActive) return;
    __bossActive = false;

    const b = __bossAudio;
    if (b) {
      try { b.pause(); } catch {}
      try { b.currentTime = 0; } catch {}
    }

    if (!__musicEnabled) { __savedBg = null; return; }
    const bg = __getMusicAudio();
    if (!bg) { __savedBg = null; return; }

    const saved = __savedBg;
    __savedBg = null;
    if (saved && typeof saved.idx === "number") {
      __setMusicTrack(saved.idx);
      try { bg.currentTime = saved.time || 0; } catch {}
      if (saved.wasPlaying) __tryStartMusic();
    } else {
      __tryStartMusic();
    }
  }


  function __musicLsGet(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }

  function __musicLsSet(key, val) {
    try { window.localStorage.setItem(key, val); } catch { /* ignore */ }
  }

  function __getMusicAudio() {
    if (__musicAudio) return __musicAudio;
    try {
      const a = new Audio();
      a.preload = "none";
      a.loop = false;
      a.volume = 0.35;

      a.addEventListener("ended", () => {
        if (!__musicEnabled) return;
        __musicIndex = (__musicIndex + 1) % MUSIC_TRACKS.length;
        __setMusicTrack(__musicIndex);
        const p = a.play();
        if (p && typeof p.catch === "function") p.catch(() => { __musicNeedGesture = true; });
      });

      __musicAudio = a;
      return a;
    } catch {
      return null;
    }
  }

  function __setMusicTrack(i) {
    const a = __getMusicAudio();
    if (!a) return;
    const len = MUSIC_TRACKS.length || 1;
    const idx = ((toSafeInt(i, 0) % len) + len) % len;
    __musicIndex = idx;

    const src = MUSIC_TRACKS[idx]?.src;
    if (!src) return;
    // Always assign (relative paths may resolve to absolute URLs in .src)
    a.src = src;
    try { a.currentTime = 0; } catch { /* ignore */ }
  }

  function __updateMusicBtn() {
    if (!(els.musicBtn instanceof HTMLButtonElement)) return;
    const label = __musicEnabled ? "Music: On" : "Music: Off";
    if (els.musicBtnLabel instanceof HTMLElement) {
      els.musicBtnLabel.textContent = label;
    } else {
      els.musicBtn.textContent = label;
    }
    els.musicBtn.setAttribute("aria-pressed", __musicEnabled ? "true" : "false");
    els.musicBtn.classList.toggle("isActive", __musicEnabled);
  }

  function __pauseMusic() {
    const a = __getMusicAudio();
    if (!a) return;
    try { a.pause(); } catch { /* ignore */ }
  }

  function __tryStartMusic() {
    if (!__musicEnabled) return;
    if (__bossActive) return;
    const a = __getMusicAudio();
    if (!a) return;
    if (!a.src) __setMusicTrack(__musicIndex);

    const p = a.play();
    if (p && typeof p.then === "function") {
      p.then(() => { __musicNeedGesture = false; }).catch(() => { __musicNeedGesture = true; });
    }
  }

  function __unlockMusicIfNeeded() {
    if (!__musicEnabled) return;
    if (__bossActive) {
      if (!__bossNeedGesture) return;
      __tryStartBossMusic();
      return;
    }
    if (!__musicNeedGesture) return;
    __tryStartMusic();
  }

  function __setMusicEnabled(on) {
    __musicEnabled = !!on;
    __musicLsSet(MUSIC_PREF_KEY, __musicEnabled ? "1" : "0");
    __updateMusicBtn();
    if (!__musicEnabled) {
      __pauseAllMusic();
    } else {
      if (__bossActive) __tryStartBossMusic();
      else __tryStartMusic();
    }
  }

  function __loadMusicPrefs() {
    const rawEnabled = __musicLsGet(MUSIC_PREF_KEY);
    if (rawEnabled === "0" || rawEnabled === "false") __musicEnabled = false;
    if (rawEnabled === "1" || rawEnabled === "true") __musicEnabled = true;

    const rawVol = __musicLsGet(MUSIC_VOL_KEY);
    if (rawVol != null && rawVol !== "") {
      const v = Number(rawVol);
      if (isFinite(v)) {
        const a = __getMusicAudio();
        if (a) a.volume = clamp(v, 0, 1);
        if (__bossAudio) __bossAudio.volume = clamp(v, 0, 1);
      }
    }
  }

  // Init music on the game page only
  (function __initMusic() {
    __loadMusicPrefs();
    __updateMusicBtn();

    // Don't preload/download music on page load.
    // If music is enabled, wait for the first user gesture to start it.
    if (__musicEnabled) __musicNeedGesture = true;

    // Gesture unlock (needed in many browsers)
    ["pointerdown", "keydown", "touchstart"].forEach((evt) => {
      window.addEventListener(evt, __unlockMusicIfNeeded, { passive: true });
    });

    // Music button toggles enabled/disabled
    if (els.musicBtn instanceof HTMLButtonElement) {
      els.musicBtn.addEventListener("click", (e) => {
        // Alt/Option click: skip to next track (optional).
        // During boss music, this simply restarts the boss track.
        if (e && (e.altKey || e.metaKey)) {
          if (__bossActive) {
            const b = __getBossAudio();
            if (b) { try { b.currentTime = 0; } catch {} }
            if (__musicEnabled) __tryStartBossMusic();
            return;
          }
          __musicIndex = (__musicIndex + 1) % MUSIC_TRACKS.length;
          __setMusicTrack(__musicIndex);
          if (__musicEnabled) __tryStartMusic();
          return;
        }
        __setMusicEnabled(!__musicEnabled);
      });
    }

    // Pause when tab is hidden; resume if it was playing
    document.addEventListener("visibilitychange", () => {
      const bg = __getMusicAudio();
      const b = __bossAudio;
      if (document.hidden) {
        __musicWasPlayingBeforeHide = __bossActive ? (b ? !b.paused : false) : (bg ? !bg.paused : false);
        __pauseAllMusic();
      } else {
        if (__musicEnabled && __musicWasPlayingBeforeHide) {
          if (__bossActive) __tryStartBossMusic();
          else __tryStartMusic();
        }
      }
    });

    window.addEventListener("beforeunload", __pauseAllMusic);
  })();


  // --------------------
  // Magic menu helpers
  // --------------------

  function setMagicMenuOpen(open) {
    if (els.magicMenu instanceof HTMLElement) {
      els.magicMenu.hidden = !open;
    }
    if (els.magicToggle instanceof HTMLButtonElement) {
      els.magicToggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
  }

  function toggleMagicMenu() {
    if (!(els.magicMenu instanceof HTMLElement)) return;
    // Keep only one dropdown open at a time.
    if (isInventoryOpen()) closeInventoryMenu();
    setMagicMenuOpen(els.magicMenu.hidden);
  }

  function closeMagicMenu() {
    setMagicMenuOpen(false);
  }

  // Close the magic menu when clicking outside or pressing Escape.
  document.addEventListener("click", (e) => {
    if (!(els.magicMenu instanceof HTMLElement)) return;
    if (!(els.magicToggle instanceof HTMLElement)) return;

    const t = e.target;
    if (t instanceof Node) {
      const inMenu = els.magicMenu.contains(t);
      const inToggle = els.magicToggle.contains(t);
      if (!inMenu && !inToggle) closeMagicMenu();
    }
  });

  // --------------------
  // Inventory menu helpers (combined Items + Gear)
  // --------------------

  /** @param {"gear"|"items"} which */
  function setInventoryTab(which) {
    if (!(els.inventoryMenu instanceof HTMLElement)) return;
    const tab = which === "items" ? "items" : "gear";
    els.inventoryMenu.dataset.invTab = tab;

    // Panes
    if (els.inventoryGearPane instanceof HTMLElement) {
      els.inventoryGearPane.hidden = tab !== "gear";
    }
    if (els.inventoryItemsPane instanceof HTMLElement) {
      els.inventoryItemsPane.hidden = tab !== "items";
    }

    // Tab buttons
    els.inventoryMenu.querySelectorAll('button[data-inv-tab]').forEach((b) => {
      if (!(b instanceof HTMLButtonElement)) return;
      const t = b.getAttribute('data-inv-tab');
      const active = t === tab;
      b.classList.toggle('isActive', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function isInventoryOpen() {
    return (els.inventoryMenu instanceof HTMLElement) && !els.inventoryMenu.hidden;
  }

  function setInventoryMenuOpen(open) {
    if (els.inventoryMenu instanceof HTMLElement) {
      els.inventoryMenu.hidden = !open;
      if (!open) {
        delete els.inventoryMenu.dataset.invFocus;
      }
    }
    const exp = open ? "true" : "false";
    if (els.inventoryToggle instanceof HTMLButtonElement) {
      els.inventoryToggle.setAttribute("aria-expanded", exp);
    }
    if (els.inventoryItemsShortcut instanceof HTMLButtonElement) {
      els.inventoryItemsShortcut.setAttribute("aria-expanded", exp);
    }
  }

  function flashInvFocus(which) {
    if (!(els.inventoryMenu instanceof HTMLElement)) return;
    if (!which) return;
    els.inventoryMenu.dataset.invFocus = which;
    window.setTimeout(() => {
      if (els.inventoryMenu instanceof HTMLElement) delete els.inventoryMenu.dataset.invFocus;
    }, prefersReducedMotion ? 0 : 900);
  }

  /** @param {"gear"|"items"|null=} focus */
  function openInventoryMenu(focus = null) {
    if (!(els.inventoryMenu instanceof HTMLElement)) return;
    // Keep only one dropdown open at a time.
    if (els.magicMenu instanceof HTMLElement && !els.magicMenu.hidden) closeMagicMenu();
    setInventoryMenuOpen(true);

    const tab = focus === "items" ? "items" : "gear";
    setInventoryTab(tab);

    // Reset scroll + focus first available action.
    if (tab === "items" && (els.inventoryItemsPane instanceof HTMLElement)) {
      els.inventoryItemsPane.scrollTop = 0;
      window.setTimeout(() => {
        const b = els.inventoryItemsPane.querySelector('button:not([disabled])');
        if (b instanceof HTMLButtonElement) b.focus({ preventScroll: true });
      }, 0);
      flashInvFocus("items");
    }
    if (tab === "gear" && (els.inventoryGearPane instanceof HTMLElement)) {
      els.inventoryGearPane.scrollTop = 0;
      window.setTimeout(() => {
        const b = els.inventoryGearPane.querySelector('button:not([disabled])');
        if (b instanceof HTMLButtonElement) b.focus({ preventScroll: true });
      }, 0);
      flashInvFocus("gear");
    }
  }

  function toggleInventoryMenu() {
    if (!(els.inventoryMenu instanceof HTMLElement)) return;
    if (isInventoryOpen()) {
      setInventoryMenuOpen(false);
      return;
    }
    openInventoryMenu("gear");
  }

  function closeInventoryMenu() {
    setInventoryMenuOpen(false);
  }

  // Close inventory menu when clicking outside.
  document.addEventListener("click", (e) => {
    if (!(els.inventoryMenu instanceof HTMLElement)) return;

    const toggles = [els.inventoryToggle, els.inventoryItemsShortcut].filter((x) => x instanceof HTMLElement);
    if (toggles.length === 0) return;

    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    const t = e.target;

    const inMenu = (Array.isArray(path) && path.includes(els.inventoryMenu)) || (t instanceof Node && els.inventoryMenu.contains(t));
    const inToggle = toggles.some((el) => (Array.isArray(path) && path.includes(el)) || (t instanceof Node && el.contains(t)));
    if (!inMenu && !inToggle) closeInventoryMenu();
  });

const TYPE_META = /** @type {Record<MagicType, {icon: string, label: string}>} */ ({
  Wind:  { icon: "🍃", label: "Wind" },
  Water: { icon: "💧", label: "Water" },
  Fire:  { icon: "🔥", label: "Fire" },
  Earth: { icon: "🪨", label: "Earth" },
  Sight: { icon: "👁", label: "Sight" },
  Sound: { icon: "🔊", label: "Sound" },
  SmellTaste: { icon: "👃🍯", label: "Smell/Taste" },
  Touch: { icon: "✋", label: "Touch" },
});

/** @param {MagicType} t */
function typeIcon(t) {
  return TYPE_META[t]?.icon ?? "✦";
}

/** @param {MagicType} t */
function fxKindForType(t) {
  /** @type {Record<MagicType, "wind"|"water"|"fire"|"earth"|"sight"|"touch"|"sound"|"smell">} */
  const m = { Wind: "wind", Water: "water", Fire: "fire", Earth: "earth", Sight: "sight", Sound: "sound", SmellTaste: "smell", Touch: "touch" };
  return m[t] || "sight";
}

/**
 * Player "basic" attack type.
 * Rule: Attack matches your hero's primary type so your baseline move always correlates with your hero.
 * @returns {MagicType}
 */
function playerPrimaryType() {
  const t = state && state.player && Array.isArray(state.player.types) ? state.player.types[0] : null;
  return /** @type {MagicType} */ (t || "Sight");
}

/** @param {MagicType} t */
function playerHasType(t) {
  return !!(state && state.player && Array.isArray(state.player.types) && state.player.types.includes(t));
}

// --------------------
// Spells (unlock on level-up)
// --------------------

/**
 * @typedef {Object} Spell
 * @property {string} id
 * @property {string} name
 * @property {MagicType} type
 * @property {number} unlock   // level requirement
 * @property {number} baseCost // Mana (before Bind +1)
 * @property {number} baseDamage
 * @property {string[]} [hooksBefore]
 * @property {string[]} [hooksAfter]
 * @property {number} [piercePct]   // 0..1, reduces the effectiveness of enemy defenses
 * @property {boolean} [noReflect]  // ward reflects 0 if true
 */

/** @type {Spell[]} */
const SPELLBOOK = [
  // Wind
  { id: "wind_gust", name: "Gust", type: "Wind", unlock: 1, baseCost: 2, baseDamage: 4, hooksAfter: ["gusted", "evade"] },
  { id: "wind_razor", name: "Razorwind", type: "Wind", unlock: 3, baseCost: 2, baseDamage: 5, hooksAfter: ["gusted"] },
  { id: "wind_slip", name: "Slipstream", type: "Wind", unlock: 6, baseCost: 2, baseDamage: 3, hooksAfter: ["evade", "mana+1"] },

  // Water
  { id: "water_lash", name: "Tidal Lash", type: "Water", unlock: 1, baseCost: 2, baseDamage: 5, hooksAfter: ["douse"] },
  { id: "water_rain", name: "Soothing Rain", type: "Water", unlock: 3, baseCost: 2, baseDamage: 3, hooksAfter: ["heal+2", "douse"] },
  { id: "water_undertow", name: "Undertow", type: "Water", unlock: 6, baseCost: 3, baseDamage: 6, hooksAfter: ["douse", "drainEnemyMana+1"] },

  // Fire
  { id: "fire_ignite", name: "Ignite", type: "Fire", unlock: 1, baseCost: 3, baseDamage: 6, hooksAfter: ["burn2"] },
  { id: "fire_cinder", name: "Cinder Shot", type: "Fire", unlock: 3, baseCost: 2, baseDamage: 4, hooksAfter: ["burn1"] },
  { id: "fire_inferno", name: "Inferno Spiral", type: "Fire", unlock: 6, baseCost: 4, baseDamage: 8, hooksAfter: ["burn2"] },

  // Sound
  { id: "sound_burst", name: "Resonant Burst", type: "Sound", unlock: 1, baseCost: 2, baseDamage: 5, hooksBefore: ["breakDefenses"] },
  { id: "sound_disson", name: "Dissonance", type: "Sound", unlock: 3, baseCost: 2, baseDamage: 4, hooksBefore: ["breakDefenses"], hooksAfter: ["drainEnemyMana+1"] },
  { id: "sound_cresc", name: "Crescendo", type: "Sound", unlock: 6, baseCost: 3, baseDamage: 7, hooksBefore: ["breakDefenses"] },

  // Smell/Taste
  { id: "smell_hex", name: "Aroma Hex", type: "SmellTaste", unlock: 1, baseCost: 2, baseDamage: 4, hooksAfter: ["scent2"] },
  { id: "smell_bloom", name: "Bitter Bloom", type: "SmellTaste", unlock: 3, baseCost: 2, baseDamage: 5, hooksAfter: ["scent3"] },
  { id: "smell_savor", name: "Savor Siphon", type: "SmellTaste", unlock: 6, baseCost: 3, baseDamage: 6, hooksAfter: ["scent2", "heal+3"] },

  // Sight
  { id: "sight_lance", name: "Arcane Lance", type: "Sight", unlock: 1, baseCost: 2, baseDamage: 5, noReflect: true },
  { id: "sight_glare", name: "Piercing Glare", type: "Sight", unlock: 3, baseCost: 2, baseDamage: 4, piercePct: 0.45 },
  { id: "sight_prism", name: "Prism Ray", type: "Sight", unlock: 6, baseCost: 3, baseDamage: 7, piercePct: 0.6, noReflect: true },

  // Earth
  { id: "earth_quake", name: "Quake", type: "Earth", unlock: 1, baseCost: 2, baseDamage: 5, piercePct: 0.35 },
  { id: "earth_shatter", name: "Shatterstone", type: "Earth", unlock: 3, baseCost: 3, baseDamage: 6, piercePct: 0.6 },
  { id: "earth_spikes", name: "Crystal Spikes", type: "Earth", unlock: 6, baseCost: 3, baseDamage: 7, piercePct: 0.25 },

  // Touch
  { id: "touch_grasp", name: "Grasp", type: "Touch", unlock: 1, baseCost: 2, baseDamage: 4, hooksAfter: ["drainEnemyMana+1"] },
  { id: "touch_press", name: "Pressure Point", type: "Touch", unlock: 3, baseCost: 2, baseDamage: 5, piercePct: 0.35 },
  { id: "touch_surge", name: "Vital Surge", type: "Touch", unlock: 6, baseCost: 3, baseDamage: 4, hooksAfter: ["heal+4"] },
];

/** @type {Record<string, Spell>} */
const SPELLS_BY_ID = Object.fromEntries(SPELLBOOK.map((s) => [s.id, s]));

/**
 * Compute spells known for a hero at a given level.
 * @param {MagicType[]} types
 * @param {number} level
 */
function knownSpellIdsFor(types, level) {
  const L = Math.max(1, toSafeInt(level, 1));
  const has = new Set(types || []);
  return SPELLBOOK
    .filter((s) => has.has(s.type) && L >= s.unlock)
    .sort((a, b) => (a.unlock - b.unlock) || (a.type.localeCompare(b.type)) || (a.baseCost - b.baseCost))
    .map((s) => s.id);
}

/** @param {MagicType[]} types */
function startingSpellIdsFor(types) {
  const has = new Set(types || []);
  return SPELLBOOK.filter((s) => has.has(s.type) && s.unlock === 1).map((s) => s.id);
}

/**
 * Sanitize spell ids to those valid for hero (types) and unlocked by level.
 * @param {string[]} ids
 * @param {MagicType[]} types
 * @param {number} level
 * @returns {string[]}
 */
function sanitizeKnownSpellIds(ids, types, level) {
  const L = Math.max(1, toSafeInt(level, 1));
  const hasType = new Set(types || []);
  const out = [];
  const seen = new Set();
  for (const id of Array.isArray(ids) ? ids : []) {
    if (seen.has(id)) continue;
    const sp = SPELLS_BY_ID[id];
    if (!sp) continue;
    if (!hasType.has(sp.type)) continue;
    if (L < toSafeInt(sp.unlock, 1)) continue;
    seen.add(id);
    out.push(id);
  }
  // Keep the menu stable/readable.
  out.sort((a, b) => {
    const A = SPELLS_BY_ID[a];
    const B = SPELLS_BY_ID[b];
    if (!A || !B) return 0;
    return (toSafeInt(A.unlock, 1) - toSafeInt(B.unlock, 1))
      || String(A.type).localeCompare(String(B.type))
      || (toSafeInt(A.baseCost, 0) - toSafeInt(B.baseCost, 0))
      || String(A.name).localeCompare(String(B.name));
  });
  return out;
}

/**
 * Compute pending spell-pick pools (one pool per unlock level > 1).
 * A pool is "resolved" when the player learns ANY spell from that unlock level.
 * @param {MagicType[]} types
 * @param {number} level
 * @param {string[]} learnedIds
 * @returns {string[][]}
 */
function computePendingSpellPools(types, level, learnedIds) {
  const L = Math.max(1, toSafeInt(level, 1));
  const hasType = new Set(types || []);
  const learned = new Set(Array.isArray(learnedIds) ? learnedIds : []);
  const unlockLevels = Array.from(
    new Set(
      SPELLBOOK
        .filter((s) => hasType.has(s.type) && toSafeInt(s.unlock, 1) > 1 && toSafeInt(s.unlock, 1) <= L)
        .map((s) => toSafeInt(s.unlock, 1))
    )
  ).sort((a, b) => a - b);

  const pools = [];
  for (const u of unlockLevels) {
    const pool = SPELLBOOK
      .filter((s) => hasType.has(s.type) && toSafeInt(s.unlock, 1) === u)
      .map((s) => s.id);

    if (!pool.length) continue;

    const resolved = pool.some((id) => learned.has(id));
    if (!resolved) pools.push(pool);
  }
  return pools;
}

/**
 * Sync the player's spell list without auto-learning level-up spells.
 * - Ensures starting spells (unlock 1) are present.
 * - Recomputes pending spell choices (one choice per unlock level).
 * Returns {addedBase, pendingAdded}.
 * @param {boolean} announce
 */
function syncKnownSpells(announce = false) {
  const types = Array.isArray(state?.player?.types) ? state.player.types : [];
  const lvl = Math.max(1, toSafeInt(state?.player?.level, 1));

  const before = Array.isArray(state?.player?.spells) ? state.player.spells : [];
  const beforePending = Array.isArray(state?.player?.pendingSpellQueue) ? state.player.pendingSpellQueue.length : 0;

  let ids = sanitizeKnownSpellIds(before, types, lvl);

  // Always keep the "core" (unlock 1) spells for your types.
  const base = startingSpellIdsFor(types);
  const addedBase = [];
  base.forEach((id) => {
    if (!ids.includes(id) && SPELLS_BY_ID[id]) {
      ids.push(id);
      addedBase.push(id);
    }
  });

  ids = sanitizeKnownSpellIds(ids, types, lvl);
  state.player.spells = ids;

  const pending = computePendingSpellPools(types, lvl, ids);
  state.player.pendingSpellQueue = pending;

  updateSpellPickButtonUI();
  updatePerkButtonUI();

  const pendingAdded = Math.max(0, pending.length - beforePending);

  if (announce) {
    // Don't spam on initial load. This is mainly used on level-up.
    if (pendingAdded > 0) {
      addLog("📜 New spell choice available! Click “Choose spell” to learn one.");
    }
  }

  return { addedBase, pendingAdded };
}

/** @returns {Spell[]} */
function getKnownSpells() {
  const ids = Array.isArray(state?.player?.spells) ? state.player.spells : [];
  return ids.map((id) => SPELLS_BY_ID[id]).filter(Boolean);
}

/**
 * Render the dynamic spell list inside the Magic menu.
 * @param {Spell[]} spells
 * @param {boolean} isPlayerTurn
 * @param {number} focus
 * @param {number} boundExtra
 */
function renderSpellMenu(spells, isPlayerTurn, focus, boundExtra) {
  if (!(els.magicMenu instanceof HTMLElement)) return;
  els.magicMenu.replaceChildren();

  if (!Array.isArray(spells) || spells.length === 0) {
    const empty = document.createElement("div");
    empty.className = "rpgMagicEmpty";
    empty.textContent = "No spells yet.";
    els.magicMenu.appendChild(empty);
    return;
  }

  spells.forEach((spell) => {
    const typed = computeTypedDamage("player", "enemy", spell.baseDamage, spell.type);
    const cost = Math.max(0, toSafeInt(spell.baseCost, 0) + boundExtra);

    // Surface extra spell properties in the menu label (e.g., pierce, no-reflect, burns, etc.)
    // We avoid the default filler text to keep the menu readable.
    const extra = (() => {
      const s = spellHookSummary(spell);
      if (!s || s === "A direct damage spell.") return "";
      return s;
    })();

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn secondary rpgMagicItem";
    btn.setAttribute("role", "menuitem");
    btn.dataset.spellId = spell.id;
    btn.dataset.type = spell.type;

    // Show the spell type icon next to the spell name in the menu.
    // Details (cost, effectiveness, extra effects) are surfaced via tooltip + hover/focus preview line.
    const iconSpan = document.createElement("span");
    iconSpan.className = "btnTypeIcon";
    iconSpan.setAttribute("aria-hidden", "true");
    iconSpan.textContent = typeIcon(spell.type);

    const textSpan = document.createElement("span");
    textSpan.className = "btnTypeText";
    const pow = toSafeInt(spell.baseDamage, 0);
    textSpan.textContent = `${spell.name} (Pow ${pow})`;

    btn.replaceChildren(iconSpan, textSpan);

    const tipBits = [];
    tipBits.push(String(cost) + " Mana");
    tipBits.push(`Pow ${toSafeInt(spell.baseDamage, 0)}`);
    tipBits.push("x" + fmtMult(typed.eff));
    if (extra) tipBits.push(extra);
    btn.title = tipBits.join(" • ");
    btn.disabled = !isPlayerTurn || focus < cost;
    els.magicMenu.appendChild(btn);
  });
}

// --------------------
// Items UI (simple)
// --------------------

/** @param {string} itemId */
function itemCanUse(itemId) {
  if (!state || !state.player || !state.enemy) return false;

  if (itemId === "potion") return state.player.hp < state.player.max;
  if (itemId === "ether") return state.player.focus < state.player.focusMax;
  if (itemId === "cleanse") return (state.player.burn > 0) || (state.player.bound > 0);

  // Offense / tactics
  if (itemId === "bomb") return state.enemy.hp > 0;
  if (itemId === "ember") return state.enemy.hp > 0 && (state.enemy.burn ?? 0) < 2;
  if (itemId === "stun") return state.enemy.hp > 0 && (state.enemy.stunned ?? 0) <= 0;

  // Setups (best used before your action)
  if (itemId === "rune") return state.enemy.hp > 0 && !(state.player.damageBoost > 1);
  if (itemId === "barrier") return !(state.player.barrier > 0);

  return false;
}

/**
 * Render the Items pane inside Inventory.
 * @param {boolean} isPlayerTurn
 * @param {HTMLElement=} container
 */
function renderItemMenu(isPlayerTurn, container = els.inventoryItemsPane) {
  if (!(container instanceof HTMLElement)) return;
  container.replaceChildren();

  const usedThisTurn = !!(state?.player?.itemUsedThisTurn);

  const tip = document.createElement("div");
  tip.className = "rpgMagicEmpty";
  tip.textContent = usedThisTurn ? "One-use items. (Used 1 item this turn.)" : "One-use items. You can use 1 item per turn without ending your turn.";
  container.appendChild(tip);

  const inv = state?.player?.items && typeof state.player.items === "object" ? state.player.items : {};
  const rows = ITEM_IDS
    .map((id) => ({ id, count: Math.max(0, toSafeInt(inv[id], 0)) }))
    .filter((r) => r.count > 0);

  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "rpgMagicEmpty";
    empty.textContent = "No items.";
    container.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "rpgInvItemsList";
  container.appendChild(list);

  rows.forEach(({ id, count }) => {
    const def = ITEM_DEFS[id];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn ghost rpgInvItemRow";
    btn.setAttribute("role", "menuitem");
    btn.dataset.itemId = id;

    const label = def ? `${def.icon} ${def.name}` : id;
    const desc = def?.desc ? String(def.desc) : "";

    const main = document.createElement("span");
    main.className = "rpgInvItemMain";

    const name = document.createElement("span");
    name.className = "rpgInvItemName";
    name.textContent = label;
    main.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "rpgInvItemMeta";

    const countPill = document.createElement("span");
    countPill.className = "rpgInvCountPill";
    countPill.textContent = `x${count}`;
    meta.appendChild(countPill);

    const pill = document.createElement("span");
    const rarKey = def?.rarity ? def.rarity : "common";
    pill.className = `rpgRarityPill rarity--${rarKey}`;
    pill.textContent = def?.rarity ? rarityLabel(def.rarity) : "Common";
    meta.appendChild(pill);

    const sub = document.createElement("div");
    sub.className = "rpgInvItemSub";
    sub.textContent = desc;

    btn.appendChild(main);
    btn.appendChild(meta);
    if (desc) btn.appendChild(sub);

    const usable = itemCanUse(id);
    const usableNow = usable && !usedThisTurn;
    btn.disabled = !isPlayerTurn || !usableNow;
    list.appendChild(btn);
  });
}


// --------------------
// Gear UI (equipment slots)
// --------------------

/**
 * Render the Gear pane inside Inventory.
 * @param {boolean} isPlayerTurn
 * @param {HTMLElement=} container
 */
function renderGearMenu(isPlayerTurn, container = els.inventoryGearPane) {
  if (!(container instanceof HTMLElement)) return;
  if (!state?.player) return;

  container.replaceChildren();

  // Keep player gear state sanitized.
  state.player.gear = sanitizeGearCounts(state.player.gear);
  state.player.equipSlots = sanitizeEquipSlots(state.player.equipSlots ?? state.player.equip, state.player.gear);

  const canChange = !!isPlayerTurn && state.phase === "player" && !isGameOver();


  const wrap = document.createElement("div");
  wrap.className = "rpgGearMenuWrap";
  container.appendChild(wrap);

  // Slots
  const slotsGrid = document.createElement("div");
  slotsGrid.className = "rpgGearSlots";
  wrap.appendChild(slotsGrid);

  const slots = state.player.equipSlots;

  const mkGearName = (id) => {
    const g = id && GEAR_DEFS[id] ? GEAR_DEFS[id] : null;
    return g ? `${g.icon} ${g.name}` : "—";
  };

  const highlight = (el, on) => {
    if (!(el instanceof HTMLElement)) return;
    el.classList.toggle("rpgDropHover", !!on);
  };

  const onDropEquip = (e, slot) => {
    if (!canChange) return;
    e.preventDefault();
    const id = e.dataTransfer?.getData("text/gear") || e.dataTransfer?.getData("text/plain") || "";
    const gearId = String(id || "").trim();
    if (!gearId) return;
    playerEquipGear(gearId, slot);
  };

  const onDragStartFromSlot = (e, slot, gearId) => {
    try {
      e.dataTransfer?.setData("text/plain", gearId);
      e.dataTransfer?.setData("text/gear", gearId);
      e.dataTransfer?.setData("text/gearFromSlot", slot);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    } catch { /* ignore */ }
  };

  // Drop onto inventory to unequip
  const inventoryDropZone = document.createElement("div");
  inventoryDropZone.className = "rpgGearInventoryDrop";
  inventoryDropZone.textContent = "Drop here to unequip";
  inventoryDropZone.setAttribute("aria-hidden", canChange ? "false" : "true");
  if (canChange) {
    inventoryDropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      highlight(inventoryDropZone, true);
    });
    inventoryDropZone.addEventListener("dragleave", () => highlight(inventoryDropZone, false));
    inventoryDropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      highlight(inventoryDropZone, false);
      const fromSlot = e.dataTransfer?.getData("text/gearFromSlot") || "";
      if (!fromSlot) return;
      playerUnequipGear(/** @type {"weapon"|"armor"|"trinket"} */ (fromSlot));
    });
  }

  for (const slot of EQUIP_SLOTS) {
    const curId = slots?.[slot] || null;

    const card = document.createElement("div");
    card.className = "rpgGearSlotCard";
    card.setAttribute("data-gear-slot", slot);

    // Rarity tint (visual quick-read)
    const curDefForTint = curId && GEAR_DEFS[curId] ? GEAR_DEFS[curId] : null;
    if (curDefForTint && curDefForTint.rarity) card.dataset.rarity = curDefForTint.rarity;
    slotsGrid.appendChild(card);

    const head = document.createElement("div");
    head.className = "rpgGearSlotHead";
    card.appendChild(head);

    const label = document.createElement("span");
    label.className = "rpgGearSlotLabel";
    label.textContent = EQUIP_SLOT_LABEL[slot];
    head.appendChild(label);


    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "btn ghost rpgGearSlotDrop";
    drop.dataset.gearSlot = slot;
    drop.disabled = !canChange;
    drop.textContent = mkGearName(curId);
    drop.title = canChange ? "Drop gear here to equip" : "You can change gear on your turn.";
    card.appendChild(drop);

    // Drag from slot (to unequip via inventory drop zone)
    drop.draggable = !!canChange && !!curId;
    if (canChange && curId) {
      drop.addEventListener("dragstart", (e) => onDragStartFromSlot(e, slot, curId));
    }

    // Drop onto slot to equip
    if (canChange) {
      drop.addEventListener("dragover", (e) => {
        e.preventDefault();
        highlight(drop, true);
      });
      drop.addEventListener("dragleave", () => highlight(drop, false));
      drop.addEventListener("drop", (e) => {
        highlight(drop, false);
        onDropEquip(e, slot);
      });
    }
  }

  wrap.appendChild(inventoryDropZone);

  // Inventory
  const invWrap = document.createElement("div");
  invWrap.className = "rpgGearInvWrap";
  wrap.appendChild(invWrap);

  const invTitle = document.createElement("div");
  invTitle.className = "rpgGearInvTitle";
  invTitle.textContent = "Owned gear";
  invWrap.appendChild(invTitle);

  const inv = state.player.gear && typeof state.player.gear === "object" ? state.player.gear : {};

  // Sort by slot, then name.
  const ownedIds = Object.keys(inv)
    .filter((id) => GEAR_DEFS[id] && Math.max(0, toSafeInt(inv[id], 0)) > 0)
    .sort((a, b) => {
      const A = GEAR_DEFS[a], B = GEAR_DEFS[b];
      if (!A || !B) return 0;
      if (A.slot !== B.slot) {
        const order = { weapon: 0, armor: 1, trinket: 2 };
        return (order[A.slot] ?? 99) - (order[B.slot] ?? 99);
      }
      // Higher rarity first within a slot
      const ra = rarityRank(A.rarity);
      const rb = rarityRank(B.rarity);
      if (ra !== rb) return rb - ra;
      return A.name.localeCompare(B.name);
    });

  if (!ownedIds.length) {
    const empty = document.createElement("div");
    empty.className = "rpgMagicEmpty";
    empty.textContent = "No gear yet. Win battles to find some.";
    invWrap.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "rpgGearInvList";
  invWrap.appendChild(list);

  ownedIds.forEach((id) => {
    const def = GEAR_DEFS[id];
    const have = Math.max(0, toSafeInt(inv[id], 0));

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn ghost rpgGearInvItem";
    btn.dataset.gearId = id;
    btn.dataset.gearAction = "equip";
    btn.disabled = !canChange;

    // Drag from inventory
    btn.draggable = !!canChange;
    if (canChange) {
      btn.addEventListener("dragstart", (e) => {
        try {
          e.dataTransfer?.setData("text/plain", id);
          e.dataTransfer?.setData("text/gear", id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
        } catch { /* ignore */ }
      });
    }

    const slotPill = document.createElement("span");
    slotPill.className = "rpgGearSlotPill";
    slotPill.textContent = EQUIP_SLOT_LABEL[def.slot];
    btn.appendChild(slotPill);

    const main = document.createElement("span");
    main.className = "rpgGearInvMain";

    const nm = document.createElement("span");
    nm.className = "rpgGearInvName";
    nm.textContent = `${def.icon} ${def.name}`;
    // Help with long names (hover to see the full text).
    nm.title = def.name;
    main.appendChild(nm);

    // Put rarity on the main row so it doesn't steal space from the description.
    const rp = document.createElement("span");
    rp.className = `rpgRarityPill rpgGearInvRarity rarity--${(def.rarity || "common")}`;
    rp.textContent = rarityLabel(def.rarity || "common");
    main.appendChild(rp);

    btn.appendChild(main);

    // Compact meta row: count + (clamped) description.
    const sub = document.createElement("span");
    sub.className = "rpgGearInvSub";

    const countPill = document.createElement("span");
    countPill.className = "rpgInvCountPill";
    countPill.textContent = `x${have}`;
    sub.appendChild(countPill);

    if (def.desc) {
      const desc = document.createElement("span");
      desc.className = "rpgGearInvDesc";
      desc.textContent = String(def.desc);
      desc.title = String(def.desc);
      sub.appendChild(desc);
    }

    btn.appendChild(sub);

    // Full details on hover.
    btn.title = `${def.name} (${rarityLabel(def.rarity || "common")})${def.desc ? `\n${def.desc}` : ""}`.trim();

    // Mark as equipped in its slot
    const isEq = slots?.[def.slot] === id;
    if (isEq) btn.classList.add("isEquipped");

    list.appendChild(btn);
  });
}



/** @param {MagicType[]} types */
function formatTypesDisplay(types) {
  return types.join(" • ");
}

/** @param {MagicType[]} types */
function formatTypeLineHTML(types) {
  const pieces = types
    .map((t) => `<span class="typeInline typeInline--${t}">${typeIcon(t)} ${TYPE_META[t]?.label ?? t}</span>`)
    .join('<span class="rpgDot">•</span>');
  return `<span class="typeLabel">Type:</span> ${pieces}`;
}

/** @param {HTMLElement|null} el @param {MagicType[]} types */
function setTypeLine(el, types) {
  if (!(el instanceof HTMLElement)) return;
  el.innerHTML = formatTypeLineHTML(types);
}

/** @param {HTMLElement|null} el @param {MagicType[]} types */
function setTypeAccent(el, types) {
  if (!(el instanceof HTMLElement)) return;
  const primary = types[0] || "";
  el.dataset.primaryType = primary;
  el.dataset.types = formatTypesDisplay(types);
}

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // The loot/victory screen is intentionally not dismissible via Escape.
      // (Player must explicitly continue.)
      if (isLootOpen()) {
        if (els.lootContinueBtn instanceof HTMLButtonElement) els.lootContinueBtn.focus();
        return;
      }

      if (isSpellPickOpen()) closeSpellPicker();
      if (isPerkOpen()) closePerks();
      if (isExplainOpen()) closeExplain();
      if (isCodexOpen()) closeCodex();
      if (isHeroOpen()) closeHeroPicker();
      if (isLocationOpen()) closeLocationPicker();
      closeMagicMenu();
      closeInventoryMenu();
      if (isDefeatOpen()) closeDefeatScreen();
    }
  });

  // --------------------
  // Explain modal helpers
  // --------------------

  let explainLastFocus = null;

  function isExplainOpen() {
    return (els.explainModal instanceof HTMLElement) && !els.explainModal.hasAttribute("hidden");
  }

  function openExplain() {
  if (!(els.explainModal instanceof HTMLElement)) return;
  closeMagicMenu();
  closeInventoryMenu();
  els.explainModal.removeAttribute("hidden");
  explainLastFocus = document.activeElement;
  updateBodyModalOpen();

  // focus close button for keyboard users
  if (els.explainClose instanceof HTMLButtonElement) els.explainClose.focus();
}


  function closeExplain() {
  if (!(els.explainModal instanceof HTMLElement)) return;
  els.explainModal.setAttribute("hidden", "");
  const prev = explainLastFocus;
  explainLastFocus = null;
  updateBodyModalOpen();
  if (prev && prev instanceof HTMLElement) prev.focus();
}




  // --------------------
  // Codex / Compendium modal helpers
  // --------------------

  let codexLastFocus = null;

  function isCodexOpen() {
    return (els.codexModal instanceof HTMLElement) && !els.codexModal.hasAttribute("hidden");
  }

  function openCodex() {
    if (!(els.codexModal instanceof HTMLElement)) return;
    closeMagicMenu();
    closeInventoryMenu();
    // Build/update the lists on open so they stay in sync with defs.
    renderCodex();
    els.codexModal.removeAttribute("hidden");
    codexLastFocus = document.activeElement;
    updateBodyModalOpen();
    if (els.codexClose instanceof HTMLButtonElement) els.codexClose.focus();
  }

  function closeCodex() {
    if (!(els.codexModal instanceof HTMLElement)) return;
    els.codexModal.setAttribute("hidden", "");
    const prev = codexLastFocus;
    codexLastFocus = null;
    updateBodyModalOpen();
    if (prev && prev instanceof HTMLElement) prev.focus();
  }

  // --------------------
  // Perks modal helpers
  // --------------------

  let perkLastFocus = null;
  // Remember the currently inspected perk inside the modal so the list can stay compact.
  let perkSelectedId = null;

  function isPerkOpen() {
    return (els.perkModal instanceof HTMLElement) && !els.perkModal.hasAttribute("hidden");
  }

  function openPerks() {
    if (!(els.perkModal instanceof HTMLElement)) return;
    closeMagicMenu();
    closeInventoryMenu();
    renderPerks();
    els.perkModal.removeAttribute("hidden");
    perkLastFocus = document.activeElement;
    updateBodyModalOpen();
    if (els.perkClose instanceof HTMLButtonElement) els.perkClose.focus();
  }

  function closePerks() {
    if (!(els.perkModal instanceof HTMLElement)) return;
    els.perkModal.setAttribute("hidden", "");
    const prev = perkLastFocus;
    perkLastFocus = null;
    updateBodyModalOpen();
    if (prev && prev instanceof HTMLElement) prev.focus();
  }

    function renderPerks() {
    if (!(els.perkList instanceof HTMLElement)) return;
    if (!(els.perkPoints instanceof HTMLElement)) return;

    const heroId = state?.player?.id || activeHeroId;
    const hero = getHeroById(heroId);
    const defs = getPerkDefsForHero(heroId);

    // Pull the most up-to-date view (state when available, otherwise localStorage).
    const prog = loadHeroProgress(heroId);
    const points = state?.player?.id === heroId
      ? clamp(toSafeInt(state.player.skillPoints, 0), 0, 99)
      : clamp(toSafeInt(prog.skillPoints, 0), 0, 99);
    const unlocked = state?.player?.id === heroId
      ? sanitizePerkIds(state.player.perks ?? state.player.perkIds, heroId)
      : sanitizePerkIds(prog.perks ?? prog.perkIds, heroId);

    els.perkPoints.textContent = `Skill Points: ${points}`;

    if (els.perkHeroLine instanceof HTMLElement) {
      const heroName = hero?.name ? String(hero.name) : "your hero";
      els.perkHeroLine.innerHTML = `Current hero: <strong>${escapeHtml(heroName)}</strong> • Unlocked <strong>${unlocked.length}</strong>/<strong>${defs.length}</strong> perks`;
    }

    if (!defs.length) {
      if (els.perkDetails instanceof HTMLElement) els.perkDetails.setAttribute("hidden", "");
      els.perkList.innerHTML = `<div class="muted">No perks defined for this hero yet.</div>`;
      return;
    }

    const unlockedSet = new Set(unlocked);
    const byId = new Map(defs.map((p) => [p.id, p]));

    // Pick a default selection early so nodes can highlight correctly.
    if (!perkSelectedId || !byId.has(perkSelectedId)) {
      perkSelectedId = defs[0]?.id || null;
    }

    const GROUP_ORDER = ["Offense", "Defense", "Utility"];

    // Group -> Line -> Perks (tiers)
    /** @type {Map<string, Map<string, any[]>>} */
    const grouped = new Map();

    defs.forEach((p) => {
      const g = (p.group && typeof p.group === "string") ? p.group : "Utility";
      const line = (p.line && typeof p.line === "string") ? p.line : g;
      if (!grouped.has(g)) grouped.set(g, new Map());
      const lines = grouped.get(g);
      if (!lines.has(line)) lines.set(line, []);
      lines.get(line).push(p);
    });

    function groupSort(a, b) {
      const ia = GROUP_ORDER.indexOf(a);
      const ib = GROUP_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    }

    function lineSort(a, b, linesMap) {
      const la = linesMap.get(a) || [];
      const lb = linesMap.get(b) || [];
      const oa = Math.min(...la.map((p) => (typeof p.lineOrder === "number" ? p.lineOrder : 999)));
      const ob = Math.min(...lb.map((p) => (typeof p.lineOrder === "number" ? p.lineOrder : 999)));
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    }

    function perkNodeHtml(p) {
      const isUnlocked = unlockedSet.has(p.id);
      const cost = Math.max(0, toSafeInt(p.cost, 1));
      const icon = (p.icon && typeof p.icon === "string") ? p.icon : "✨";

      const reqs = Array.isArray(p.requires) ? p.requires : [];
      const missing = reqs.filter((rid) => !unlockedSet.has(rid));
      const prereqMet = missing.length === 0;

      const need = Math.max(0, cost - points);
      const canBuy = !isUnlocked && prereqMet && points >= cost;

      const pillText = isUnlocked ? "Unlocked"
        : (canBuy ? `Cost ${cost}`
          : (!prereqMet ? "Locked" : `Need ${need}`));

      const tier = Math.max(1, toSafeInt(p.tier, 1));
      const tierTag = `Tier ${tier}`;
      const isSelected = perkSelectedId === p.id;

      return `
        <button type="button"
          class="rpgPerkNode ${isUnlocked ? "isUnlocked" : ""} ${(!isUnlocked && !canBuy) ? "isLocked" : ""} ${isSelected ? "isSelected" : ""}"
          data-perk-node="${escapeHtml(p.id)}"
          aria-pressed="${isSelected ? "true" : "false"}">
          <span class="rpgPerkIcon" aria-hidden="true">${escapeHtml(icon)}</span>
          <span class="rpgPerkNodeTopText">
            <span class="rpgPerkNodeTitle" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
            <span class="rpgPerkNodeTier muted tiny">${escapeHtml(tierTag)}</span>
          </span>
          <span class="rpgPerkPill ${isUnlocked ? "isUnlocked" : "isNeed"}">${escapeHtml(pillText)}</span>
        </button>
      `;
    }

    function renderPerkDetails(heroId, perkId) {
      if (!(els.perkDetails instanceof HTMLElement)) return;
      const def = byId.get(perkId);
      if (!def) {
        els.perkDetails.setAttribute("hidden", "");
        return;
      }

      const isUnlocked = unlockedSet.has(def.id);
      const cost = Math.max(0, toSafeInt(def.cost, 1));
      const icon = (def.icon && typeof def.icon === "string") ? def.icon : "✨";
      const tier = Math.max(1, toSafeInt(def.tier, 1));

      const reqs = Array.isArray(def.requires) ? def.requires : [];
      const missing = reqs.filter((rid) => !unlockedSet.has(rid));
      const prereqMet = missing.length === 0;
      const canBuy = !isUnlocked && prereqMet && points >= cost;

      const missingNames = missing.map((rid) => {
        const r = byId.get(rid);
        return r?.name ? String(r.name) : String(rid);
      });

      // Small, readable effect chips.
      const fx = (def.effects && typeof def.effects === "object") ? def.effects : {};
      /** @type {string[]} */
      const chips = [];
      const hpB = Math.max(0, toSafeInt(fx.hpBonus, 0));
      const mB = Math.max(0, toSafeInt(fx.focusBonus, 0));
      const pP = clamp(Number(fx.powerPct ?? 0), 0, 0.50);
      const hP = clamp(Number(fx.healPct ?? 0), 0, 0.50);
      const dR = clamp(Number(fx.drPct ?? 0), 0, 0.50);
      const xP = clamp(Number(fx.xpPct ?? 0), 0, 0.50);
      const sM = clamp(toSafeInt(fx.startMana ?? 0, 0), 0, 3);

      if (hpB) chips.push(`+${hpB} Max HP`);
      if (mB) chips.push(`+${mB} Max Mana`);
      if (pP) chips.push(`+${Math.round(pP * 100)}% Damage`);
      if (hP) chips.push(`+${Math.round(hP * 100)}% Healing`);
      if (dR) chips.push(`-${Math.round(dR * 100)}% Dmg Taken`);
      if (xP) chips.push(`+${Math.round(xP * 100)}% XP`);
      if (sM) chips.push(`+${sM} Start Mana`);

      const prereqLine = prereqMet
        ? (reqs.length ? `Prereqs met` : `No prerequisites`)
        : `Requires: ${missingNames.join(", ")}`;

      const btnText = isUnlocked
        ? "Unlocked"
        : (canBuy ? `Unlock (${cost} SP)`
          : (!prereqMet ? "Locked" : `Need ${Math.max(0, cost - points)} SP`));

      els.perkDetails.removeAttribute("hidden");
      els.perkDetails.innerHTML = `
        <div class="rpgPerkDetailsTop">
          <div class="rpgPerkDetailsTitle">
            <span class="rpgPerkDetailsIcon" aria-hidden="true">${escapeHtml(icon)}</span>
            <div class="rpgPerkDetailsTitleText">
              <div class="rpgPerkDetailsName">${escapeHtml(def.name)}</div>
              <div class="muted tiny">Tier ${tier} • ${escapeHtml(prereqLine)}</div>
            </div>
          </div>
          <button type="button" class="btn ${isUnlocked ? "ghost" : "primary"} rpgPerkDetailsBtn" ${canBuy ? "" : "disabled"} data-perk-unlock="${escapeHtml(def.id)}">${escapeHtml(btnText)}</button>
        </div>
        <div class="rpgPerkDetailsDesc">${escapeHtml(def.desc || "")}</div>
        ${chips.length ? `<div class="rpgPerkFx">${chips.map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      `;

      const unlockBtn = els.perkDetails.querySelector("button[data-perk-unlock]");
      if (unlockBtn instanceof HTMLButtonElement) {
        unlockBtn.addEventListener("click", () => {
          const id = unlockBtn.getAttribute("data-perk-unlock") || "";
          if (!id) return;
          tryUnlockPerk(heroId, id);
        }, { once: true });
      }
    }

    // Build sections
    const groupKeys = Array.from(grouped.keys()).sort(groupSort);

    els.perkList.innerHTML = groupKeys.map((g) => {
      const linesMap = grouped.get(g) || new Map();
      const lineKeys = Array.from(linesMap.keys()).sort((a, b) => lineSort(a, b, linesMap));

      const note = g === "Offense" ? "Damage & pressure"
        : (g === "Defense" ? "Survival & mitigation" : "Mana, starts, recovery & XP");

      const treeHtml = `
        <div class="rpgPerkTree">
          ${lineKeys.map((lineName) => {
            const list = (linesMap.get(lineName) || []).slice();

            // Sort by tier, then by cost, then by name.
            list.sort((a, b) => {
              const ta = Math.max(1, toSafeInt(a.tier, 1));
              const tb = Math.max(1, toSafeInt(b.tier, 1));
              if (ta !== tb) return ta - tb;
              const ca = Math.max(0, toSafeInt(a.cost, 1));
              const cb = Math.max(0, toSafeInt(b.cost, 1));
              if (ca !== cb) return ca - cb;
              return String(a.name || "").localeCompare(String(b.name || ""));
            });

            const nodes = list.map(perkNodeHtml).join("");

            return `
              <div class="rpgPerkLineRow">
                <div class="rpgPerkLineLabel">
                  <div class="rpgPerkLineName">${escapeHtml(lineName)}</div>
                  <div class="muted tiny">${list.length} tiers</div>
                </div>
                <div class="rpgPerkLineNodes" role="list">
                  ${nodes}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;

      return `
        <div class="rpgPerkSection">
          <div class="rpgPerkSectionHead">
            <h3 class="rpgPerkSectionTitle">${escapeHtml(g)}</h3>
            <div class="rpgPerkSectionNote muted">${escapeHtml(note)}</div>
          </div>
          ${treeHtml}
        </div>
      `;
    }).join("");

    // Render the compact detail pane.
    if (perkSelectedId) renderPerkDetails(heroId, perkSelectedId);

    // Clicking a node selects it (details update). Unlocking happens from the detail pane.
    Array.from(els.perkList.querySelectorAll("[data-perk-node]")).forEach((n) => {
      if (!(n instanceof HTMLButtonElement)) return;
      n.addEventListener("click", () => {
        const id = n.getAttribute("data-perk-node") || "";
        if (!id) return;
        perkSelectedId = id;
        // Visual highlight
        Array.from(els.perkList.querySelectorAll(".rpgPerkNode.isSelected")).forEach((old) => old.classList.remove("isSelected"));
        n.classList.add("isSelected");
        Array.from(els.perkList.querySelectorAll("[data-perk-node]")).forEach((b) => {
          if (b instanceof HTMLButtonElement) b.setAttribute("aria-pressed", (b === n) ? "true" : "false");
        });
        renderPerkDetails(heroId, id);
      });
    });
  }

  /** @param {string} heroId @param {string} perkId */
    /** @param {string} heroId @param {string} perkId */
  function tryUnlockPerk(heroId, perkId) {
    const defs = getPerkDefsForHero(heroId);
    const def = defs.find((p) => p.id === perkId);
    if (!def) return;

    const prog = loadHeroProgress(heroId);
    const unlocked = sanitizePerkIds(prog.perks ?? prog.perkIds, heroId);
    if (unlocked.includes(perkId)) return;

    const unlockedSet = new Set(unlocked);
    const reqs = Array.isArray(def.requires) ? def.requires : [];
    const prereqMet = reqs.every((rid) => unlockedSet.has(rid));
    if (!prereqMet) {
      // Optional feedback in battle log (only if currently in a run).
      if (state?.log && Array.isArray(state.log)) {
        const byId = new Map(defs.map((p) => [p.id, p]));
        const missing = reqs.filter((rid) => !unlockedSet.has(rid)).map((rid) => byId.get(rid)?.name || rid);
        addLog(`🔒 Perk locked. Requires: ${missing.join(", ")}.`);
      }
      return;
    }

    const cost = Math.max(0, toSafeInt(def.cost, 1));
    const points = clamp(toSafeInt(prog.skillPoints, 0), 0, 99);
    if (points < cost) return;

    const next = {
      ...prog,
      skillPoints: clamp(points - cost, 0, 99),
      perks: [...unlocked, perkId],
    };

    saveHeroProgress(heroId, next);

    // Sync live state if this hero is active.
    if (state?.player?.id === heroId) {
      state.player.skillPoints = next.skillPoints;
      state.player.perks = next.perks;
      syncPlayerLevel(false);
      persistPlayerProgress();
      render();
    }

    // Feedback (log only when in-game).
    if (state?.log && Array.isArray(state.log)) {
      addLog(`✨ Perk unlocked: ${def.name}.`);
    }

    renderPerks();
  }

// --------------------
// Spell picker modal helpers
// --------------------

let __spellPickLastFocus = null;

function isSpellPickOpen() {
  return !!(els.spellPickModal instanceof HTMLElement && !els.spellPickModal.hidden);
}

function updateSpellPickButtonUI() {
  if (!(els.spellPickBtn instanceof HTMLButtonElement)) return;
  const pending = Array.isArray(state?.player?.pendingSpellQueue) ? state.player.pendingSpellQueue.length : 0;
  els.spellPickBtn.hidden = pending <= 0;
  els.spellPickBtn.disabled = pending <= 0;
  const label = pending <= 1 ? "Choose spell" : `Choose spell (${pending})`;
  els.spellPickBtn.innerHTML = `<span aria-hidden="true" class="rpgTopBtnIcon">📜</span>${label}`;
}

function updatePerkButtonUI() {
  if (!(els.perkBtn instanceof HTMLButtonElement)) return;
  const heroId = state?.player?.id || activeHeroId;
  const prog = loadHeroProgress(heroId);
  const points = state?.player?.id === heroId ? clamp(toSafeInt(state.player.skillPoints, 0), 0, 99) : clamp(toSafeInt(prog.skillPoints, 0), 0, 99);
  const badge = points > 0 ? ` <span class="pill">+${points}</span>` : "";
  els.perkBtn.innerHTML = `<span aria-hidden="true" class="rpgTopBtnIcon">✨</span>Perks${badge}`;
}

/** @param {Spell} spell */
function spellHookSummary(spell) {
  const parts = [];
  const before = Array.isArray(spell.hooksBefore) ? spell.hooksBefore : [];
  const after = Array.isArray(spell.hooksAfter) ? spell.hooksAfter : [];

  if (spell.piercePct && spell.piercePct > 0) parts.push(`Pierces ${Math.round(spell.piercePct * 100)}% defenses`);
  if (spell.noReflect) parts.push("No reflect");

  if (before.includes("breakDefenses")) parts.push("Breaks Guard first");

  for (const h of after) {
    if (h === "gusted") parts.push("Gusts: enemy next hit -2");
    else if (h === "evade") parts.push("Evade: your next hit -2");
    else if (h === "douse") parts.push("Douse: clears Burn");
    else if (h === "burn1") parts.push("Burn (1)");
    else if (h === "burn2") parts.push("Burn (2)");
    else if (h.startsWith("scent")) {
      const n = Math.max(0, toSafeInt(h.replace("scent", ""), 0));
      if (n > 0) parts.push(`Scented (${n})`);
    } else if (h.startsWith("mana+")) {
      const n = Math.max(0, toSafeInt(h.replace("mana+", ""), 0));
      if (n > 0) parts.push(`Mana +${n}`);
    } else if (h.startsWith("heal+")) {
      const n = Math.max(0, toSafeInt(h.replace("heal+", ""), 0));
      if (n > 0) parts.push(`Heal +${n}`);
    } else if (h.startsWith("drainEnemyMana+")) {
      const n = Math.max(0, toSafeInt(h.replace("drainEnemyMana+", ""), 0));
      if (n > 0) parts.push(`Drain enemy Mana -${n}`);
    }
  }

  return parts.length ? parts.join(" • ") : "A direct damage spell.";
}

/** @param {string[]} poolIds */
function renderSpellPickChoices(poolIds) {
  if (!(els.spellPickChoices instanceof HTMLElement)) return;
  els.spellPickChoices.replaceChildren();

  const ids = Array.isArray(poolIds) ? poolIds : [];
  const types = new Set(Array.isArray(state?.player?.types) ? state.player.types : []);
  const lvl = Math.max(1, toSafeInt(state?.player?.level, 1));

  ids
    .map((id) => SPELLS_BY_ID[id])
    .filter((sp) => !!sp && types.has(sp.type) && lvl >= toSafeInt(sp.unlock, 1))
    .forEach((spell) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn ghost rpgSpellChoice";
      btn.dataset.spellId = spell.id;

      const top = document.createElement("div");
      top.className = "rpgSpellTop";

      const title = document.createElement("div");
      title.className = "rpgSpellTitle";
      title.textContent = spell.name;

      const lvlPill = document.createElement("span");
      lvlPill.className = "pill";
      lvlPill.textContent = `Lv ${toSafeInt(spell.unlock, 1)}`;

      top.appendChild(title);
      top.appendChild(lvlPill);

      const meta = document.createElement("div");
      meta.className = "rpgSpellMeta";

      const typeSpan = document.createElement("span");
      typeSpan.className = `typeInline typeInline--${spell.type}`;
      typeSpan.textContent = `${typeIcon(spell.type)} ${TYPE_META[spell.type]?.label ?? spell.type}`;

      const costPill = document.createElement("span");
      costPill.className = "pill";
      costPill.textContent = `Cost ${toSafeInt(spell.baseCost, 0)} Mana`;

      const dmgPill = document.createElement("span");
      dmgPill.className = "pill";
      dmgPill.textContent = `Pow ${toSafeInt(spell.baseDamage, 0)}`;

      meta.appendChild(typeSpan);
      meta.appendChild(costPill);
      meta.appendChild(dmgPill);

      const desc = document.createElement("div");
      desc.className = "rpgSpellDesc";
      desc.textContent = spellHookSummary(spell);

      btn.appendChild(top);
      btn.appendChild(meta);
      btn.appendChild(desc);

      btn.addEventListener("click", () => {
        learnSpell(spell.id, true);
      });

      els.spellPickChoices.appendChild(btn);
    });

  if (els.spellPickChoices.childElementCount === 0) {
    const empty = document.createElement("div");
    empty.className = "rpgMagicEmpty";
    empty.textContent = "No eligible spells right now.";
    els.spellPickChoices.appendChild(empty);
  }
}

/** Open the spell picker for the earliest unresolved unlock level. */
function openNextSpellPick() {
  const queue = Array.isArray(state?.player?.pendingSpellQueue) ? state.player.pendingSpellQueue : [];
  const pool = queue.length ? queue[0] : null;
  if (!pool || !(els.spellPickModal instanceof HTMLElement)) return;

  __spellPickLastFocus = document.activeElement;

  // Close any other transient UI.
  closeMagicMenu();

  renderSpellPickChoices(pool);
  els.spellPickModal.hidden = false;
  updateBodyModalOpen();

  // Focus the first choice for keyboard users.
  const firstBtn = els.spellPickChoices instanceof HTMLElement ? els.spellPickChoices.querySelector("button") : null;
  if (firstBtn instanceof HTMLButtonElement) firstBtn.focus();
}

function closeSpellPicker() {
  if (!(els.spellPickModal instanceof HTMLElement)) return;
  els.spellPickModal.hidden = true;
  updateBodyModalOpen();
  if (__spellPickLastFocus instanceof HTMLElement) {
    try { __spellPickLastFocus.focus(); } catch {}
  }
  __spellPickLastFocus = null;
}

/**
 * Learn a spell (if eligible), persist, and advance the pending queue.
 * @param {string} spellId
 * @param {boolean} fromPicker
 */
function learnSpell(spellId, fromPicker = false) {
  const sp = SPELLS_BY_ID[spellId];
  if (!sp) return;

  const types = Array.isArray(state?.player?.types) ? state.player.types : [];
  const hasType = new Set(types);
  const lvl = Math.max(1, toSafeInt(state?.player?.level, 1));
  if (!hasType.has(sp.type) || lvl < toSafeInt(sp.unlock, 1)) {
    addLog("That spell isn't eligible right now.");
    render();
    return;
  }

  const before = Array.isArray(state.player.spells) ? state.player.spells : [];
  if (!before.includes(spellId)) {
    state.player.spells = sanitizeKnownSpellIds([...before, spellId], types, lvl);
    addLog(`📜 Learned: ${sp.name}.`);
    if (!prefersReducedMotion) showMoveBanner(`Learned: ${sp.name}`, sp.type);
  }

  // Recompute pending picks after learning.
  syncKnownSpells(false);
  persistPlayerProgress();
  render();

  if (fromPicker) {
    // Close, then immediately open the next pending pick (if any).
    closeSpellPicker();
    if (Array.isArray(state.player.pendingSpellQueue) && state.player.pendingSpellQueue.length > 0) {
      window.setTimeout(() => openNextSpellPick(), 120);
    }
  }
}

  function isHeroOpen() {
  return (els.characterModal instanceof HTMLElement) && !els.characterModal.hasAttribute("hidden");
}

function isLootOpen() {
  return (els.lootModal instanceof HTMLElement) && !els.lootModal.hasAttribute("hidden");
}

function isDefeatOpen() {
  return (els.defeatModal instanceof HTMLElement) && !els.defeatModal.hasAttribute("hidden");
}

let lootLastFocus = null;
let lootTimer = 0;

let lootResolve = null; // {battleId:number,isFinal:boolean,nextIndex:number}
/** @param {string} title @param {string} subtitle @param {string} line @param {Array<any>} summary */
function openLootScreen(title, subtitle, line, summary = []) {
  if (!(els.lootModal instanceof HTMLElement)) return;
  closeMagicMenu();
  closeInventoryMenu();

  if (els.lootTitle instanceof HTMLElement) els.lootTitle.textContent = title || "Victory";
  if (els.lootSubtitle instanceof HTMLElement) els.lootSubtitle.textContent = subtitle || "";
  if (els.lootLine instanceof HTMLElement) els.lootLine.textContent = line || "No items.";

  // Summary chips (level ups, skill points, spell choices)
  if (els.lootSummary instanceof HTMLElement) {
    els.lootSummary.innerHTML = "";
    const items = Array.isArray(summary) ? summary : [];
    if (items.length === 0) {
      els.lootSummary.setAttribute("hidden", "");
    } else {
      els.lootSummary.removeAttribute("hidden");
      for (const it of items) {
        const text = (typeof it === "string") ? it : String(it?.text || "");
        const kind = (typeof it === "object" && it && it.kind) ? String(it.kind) : "neutral";
        const chip = document.createElement("div");
        chip.className = `rpgLootChip rpgLootChip--${kind}`;
        chip.textContent = text;
        els.lootSummary.appendChild(chip);
      }
    }
  }


  els.lootModal.removeAttribute("hidden");
  lootLastFocus = document.activeElement;
  updateBodyModalOpen();

  // Put focus on the explicit Continue button so keyboard users can press Enter.
  if (els.lootContinueBtn instanceof HTMLButtonElement) {
    els.lootContinueBtn.focus();
  } else {
    const inner = els.lootModal.querySelector(".rpgLootInner");
    if (inner instanceof HTMLElement) inner.focus();
  }
}

function closeLootScreen() {
  if (!(els.lootModal instanceof HTMLElement)) return;
  els.lootModal.setAttribute("hidden", "");
  const prev = lootLastFocus;
  lootLastFocus = null;
  updateBodyModalOpen();
  if (prev && prev instanceof HTMLElement) prev.focus();

  // If the loot screen was dismissed early (or auto-timed out), continue the flow.
  const lr = lootResolve;
  if (lr && state && state.battleId === lr.battleId) {
    lootResolve = null;
    resolveLootDismissal(lr);
  }
}

/**
 * Continue the battle flow after the loot screen is dismissed.
 * @param {{battleId:number,isFinal:boolean,nextIndex:number}} lr
 */
function resolveLootDismissal(lr) {
  if (!lr || !state || state.battleId !== lr.battleId) return;

  // Final wave: return to the character menu after rewards.
  if (lr.isFinal) {
    if (state.battleMode === 'approach-skirmish') {
      const snap = state.returnToApproach ? JSON.parse(JSON.stringify(state.returnToApproach)) : null;
      reopenApproachFromSnapshot(snap, 'The skirmish sigil burns out after a brief clash.');
      return;
    }
    // Boss fight is over; return to normal background music.
    __exitBossMusic();
    const district = CAMPAIGN_DISTRICT_BY_ID[state.locationId || ''];
    const msg = state.locationId === FINAL_LOCATION_ID
      ? "The Palace is restored. You complete the campaign!"
      : (district
          ? `${district.bossName} is defeated. The district artifact is reclaimed.`
          : "The duel ends. You win!");
    endGame(msg);
    // Pop the character menu after the win is logged/rendered.
    window.setTimeout(() => {
      if (!state || state.battleId !== lr.battleId) return;
      if (isDefeatOpen()) return;
      openHeroPicker();
    }, 140);
    return;
  }

  // Between-wave breather (fixed, not random).
  const bonus = 3;
  const before = state.player.hp;
  state.player.hp = clamp(state.player.hp + bonus, 0, state.player.max);
  const actual = state.player.hp - before;
  if (actual > 0) addLog(`You catch a second wind (+${actual} HP).`);

  // Clear tactical one-turn states.
  state.player.guarding = false;
  state.player.evading = false;

// Spawn next enemy.
const nextIndex = lr.nextIndex;
state.wave = nextIndex;
state.enemy = makeEnemy(state.wave, state.enemySet, state.player.level);

const isBossWave = state.wave >= 2 || state.enemy.profile === "bossEclipse";

// Boss wave: switch to boss theme.
if (isBossWave) __enterBossMusic();

addLog(`Wave ${state.wave + 1}: ${state.enemy.name} arrives.`);

// Set new intent for readability.
state.enemy.intent = computeEnemyIntent();
renderIntent(state.enemy.intent);

setEffectBanner("—", "neutral");

if (isBossWave) {
  // Brief pre-combat callout, then give control to the player.
  setPhase("resolving");
  render();
  showBossAppearsCallout();

  const bid = state.battleId;
  const waveAtShow = state.wave;
  window.setTimeout(() => {
    if (!state || state.battleId !== bid) return;
    if (state.wave !== waveAtShow) return;
    addLog("Your turn.");
    setPhase("player");
    render();
  }, 2000);
  return;
}

addLog("Your turn.");
setPhase("player");
render();
}


let defeatLastFocus = null;

/** @param {string} subtitle */
function openDefeatScreen(subtitle) {
  // Stop boss music when a run ends.
  __exitBossMusic();
  if (!(els.defeatModal instanceof HTMLElement)) return;

  // Close transient UI so the defeat screen is the clear focus.
  closeMagicMenu();
  closeInventoryMenu();
  if (isSpellPickOpen()) closeSpellPicker();
  if (isExplainOpen()) closeExplain();
  if (isLocationOpen()) closeLocationPicker();
  if (isLootOpen()) { lootResolve = null; closeLootScreen(); if (lootTimer) window.clearTimeout(lootTimer); lootTimer = 0; }

  if (els.defeatTitle instanceof HTMLElement) els.defeatTitle.textContent = "Defeated";
  if (els.defeatSubtitle instanceof HTMLElement) {
    els.defeatSubtitle.textContent = subtitle || "You were defeated.";
  }

  els.defeatModal.removeAttribute("hidden");
  defeatLastFocus = document.activeElement;
  updateBodyModalOpen();

  const inner = els.defeatModal.querySelector(".rpgDefeatInner");
  if (inner instanceof HTMLElement) inner.focus();
}

function closeDefeatScreen() {
  if (!(els.defeatModal instanceof HTMLElement)) return;
  els.defeatModal.setAttribute("hidden", "");
  const prev = defeatLastFocus;
  defeatLastFocus = null;
  updateBodyModalOpen();
  if (prev && prev instanceof HTMLElement) prev.focus();
}

function updateBodyModalOpen() {
  const any = isExplainOpen() || isCodexOpen() || isPerkOpen() || isHeroOpen() || isLocationOpen() || isSpellPickOpen() || isLootOpen() || isDefeatOpen() || isShopOpen();
  document.body.classList.toggle("modalOpen", any);
}

function renderHeroChoices() {
  if (!(els.characterChoices instanceof HTMLElement)) return;

  const active = pendingHeroId || activeHeroId;

  els.characterChoices.innerHTML = PLAYABLE_HEROES.map((h) => {
    const types = h.typesLabel || formatTypesDisplay(h.types);
    const prog = loadHeroProgress(h.id);
    const scaled = applyLevelToHero(h, prog.level);
    const xpNeed = xpToNext(prog.level);
    return `
      <button type="button" class="btn ghost rpgCharChoice ${h.id === active ? "isSelected" : ""}" data-hero="${h.id}">
        <div class="rpgCharSprite"><img src="${h.sprite}" alt="" /></div>
        <div>
          <div class="rpgCharTitle">${h.name}</div>
          <div class="rpgCharMeta muted small"><span class="pill">${types}</span></div>
          <div class="rpgCharStats muted">Lv ${prog.level} • XP ${prog.xp}/${xpNeed} • SP ${toSafeInt(prog.skillPoints, 0)}</div>
          <div class="rpgCharStats muted">HP ${scaled.maxHp} • Mana ${scaled.focusStart}/${scaled.focusMax} • Heals ${h.healCharges}</div>
        </div>
      </button>
    `;
  }).join("");

  // Normalize sprite sizing inside the hero picker so all portraits feel consistent.
  autoScaleSpritesIn(els.characterChoices);
}

function openHeroPicker() {
  if (!(els.characterModal instanceof HTMLElement)) return;
  closeMagicMenu();

  pendingHeroId = activeHeroId;
  renderHeroChoices();

  els.characterModal.removeAttribute("hidden");
  heroLastFocus = document.activeElement;
  updateBodyModalOpen();

  setPhase("hero");
  renderIntent(null);
  setEffectBanner("—", "neutral");
  render();

  const first = els.characterModal.querySelector("button[data-hero]");
  if (first instanceof HTMLButtonElement) first.focus();
}

function closeHeroPicker() {
  if (!(els.characterModal instanceof HTMLElement)) return;
  els.characterModal.setAttribute("hidden", "");
  const prev = heroLastFocus;
  heroLastFocus = null;
  updateBodyModalOpen();
  if (prev && prev instanceof HTMLElement) prev.focus();
}

function confirmHeroSelection() {
  const id = pendingHeroId || activeHeroId;
  setActiveHero(id);
  pendingHeroId = null;
  closeHeroPicker();

  closeMagicMenu();
  resetVisuals();
  state = makeLobbyState();
  syncKnownSpells(false);
  renderIntent(null);
  setEffectBanner("—", "neutral");
  render();
  openLocationPicker();
}

// --------------------
// Location picker (pre-combat)
// --------------------
let locationLastFocus = null;

function isLocationOpen() {
  return (els.locationModal instanceof HTMLElement) && !els.locationModal.hasAttribute("hidden");
}


function renderLocationChoices() {
  // Map-based overworld using the same city map art as /map.html.
  if (!(els.locationChoices instanceof HTMLElement)) return;
  resetLocationApproach();
  const titleEl = document.getElementById('locationTitle');
  if (titleEl instanceof HTMLElement) titleEl.textContent = 'Overworld';

  // Ensure the container has the correct class for styling.
  els.locationChoices.classList.remove("rpgOverworldGrid");
  els.locationChoices.classList.remove('rpgApproachStage');
  els.locationChoices.classList.add("rpgOverworldMapStage");
  els.locationChoices.style.removeProperty("--ow-cols");

  const heroLabel = (() => {
    const n = (state?.player?.name || "Hero").trim();
    return n ? n.slice(0, 1).toUpperCase() : "H";
  })();

  const hero = getActiveHero();
  const heroSpriteRaw = (hero && typeof hero.sprite === "string" && hero.sprite.trim()) ? hero.sprite.trim() : "./assets/images/characters/axel.webp";
  const heroSprite = (heroSpriteRaw.startsWith(".") || heroSpriteRaw.startsWith("/")) ? heroSpriteRaw : `./${heroSpriteRaw}`;

  const data = window.MAP_LOCATIONS_DATA;
  const mapUrlRaw = (data && data.image && typeof data.image.url === "string") ? data.image.url : "assets/images/city-map.webp";
  const mapUrl = (mapUrlRaw.startsWith(".") || mapUrlRaw.startsWith("/")) ? mapUrlRaw : `./${mapUrlRaw}`;

  const campaign = getCampaignProgress();
  const pinIds = [...getOverworldVisibleBattleIds(), ...OVERWORLD_SHOP_IDS];
  const pinHtml = pinIds.map((id) => {
    const m = getMapLocationData(id);
    const isShop = OVERWORLD_SHOP_IDS.includes(id);
    const isCleared = !isShop && !!campaign.clears[id];
    // IMPORTANT: getLocationById() can fall back to a default when an ID is missing.
    // The shop is not a battle location, so we must NOT use that fallback or the shop
    // pin can inherit the wrong name (e.g., "Arena").
    const loc = isShop ? null : getLocationById(id);
    const pos = getOverworldPos(id);
    const left = toSafeNum(pos?.leftPct, toSafeNum(m?.leftPct, 50));
    const top = toSafeNum(pos?.topPct, toSafeNum(m?.topPct, 50));
    // Prefer the map metadata title first (matches the main site map), then battle-location name.
    const title = (m?.title || loc?.name || id);
    const isLocked = !isShop && id === FINAL_LOCATION_ID && !campaign.finalUnlocked;
    const kindLabel = isShop ? "Shop" : (getOverworldVisibleBattleIds().includes(id) ? "Battle marker" : "Location");
    const stateLabel = isCleared ? 'Completed' : (isLocked ? 'Locked' : (id === FINAL_LOCATION_ID ? 'Final battle' : 'Active'));
    const markerClass = `rpgOverworldPin${isShop ? " rpgOverworldPin--shop" : ""}${isCleared ? " isCleared" : ""}${isLocked ? " isLocked" : ""}`;
    return `
      <button type="button" class="${markerClass}" data-ow-loc="${id}" data-ow-kind="${isShop ? "shop" : "battle"}" data-ow-name="${escapeHtml(title)}" data-ow-state="${isCleared ? 'cleared' : (isLocked ? 'locked' : 'active')}" style="left:${left}%; top:${top}%;" aria-label="${escapeHtml(kindLabel)}: ${escapeHtml(title)}${isShop ? '' : ` (${stateLabel})`}">
        <span class="srOnly">${escapeHtml(title)}${isShop ? '' : `, ${stateLabel}`}</span>
      </button>
    `;
  }).join("");

  els.locationChoices.innerHTML = `
    ${getCampaignTrackerHtml(campaign)}
    <div class="rpgOverworldTopbar">
      <div class="rpgOverworldHint">Explore with WASD / arrow keys, click to walk, or tap a marker. Defeat each district boss to recover its artifact. ${campaign.finalUnlocked ? "The Palace is now open." : "The Palace opens after all four artifacts are reclaimed."}</div>
      <div class="rpgOverworldTopbarActions">
        <button type="button" class="btn ghost rpgOverworldGuideBtn" id="owGuideToggle" aria-pressed="true">Movement guide: On</button>
        <button type="button" class="btn ghost rpgOverworldGuideBtn" id="owFogToggle" aria-pressed="true">Fog of war: On</button>
        <div class="rpgOverworldZoomControls" aria-label="Map zoom controls">
        <button type="button" class="btn ghost rpgOverworldZoomBtn" data-ow-zoom="out" aria-label="Zoom out">−</button>
        <span class="rpgOverworldZoomLabel" data-ow-zoom-label>155%</span>
        <button type="button" class="btn ghost rpgOverworldZoomBtn" data-ow-zoom="in" aria-label="Zoom in">+</button>
      </div>
    </div>
    </div>
    <div class="rpgOverworldMapFrame isGuideVisible" id="owFrame" aria-label="City map">
      <div class="rpgOverworldWorld" id="owWorld">
        <img class="rpgOverworldMapImage" src="${mapUrl}" alt="City map" loading="eager" />
        <svg class="rpgOverworldRoadOverlay" id="owRoadOverlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${getOverworldRoadOverlaySvg()}</svg>
        <svg class="rpgOverworldFogOverlay" id="owFog" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <mask id="owFogMask">
              <rect width="100" height="100" fill="white"></rect>
              <g id="owFogMaskHoles"></g>
            </mask>
          </defs>
          <rect class="owFogFill" width="100" height="100" mask="url(#owFogMask)"></rect>
        </svg>
        <div class="rpgOverworldMapShade" aria-hidden="true"></div>
        <div class="rpgOverworldPins" id="owPins" role="group" aria-label="Battle markers">
          ${pinHtml}
        </div>
        <div class="rpgOverworldTarget" id="owTarget" hidden aria-hidden="true"></div>
        <div class="rpgOverworldBubble" id="owBubble" hidden aria-hidden="true">
          <button type="button" class="btn primary magentaGlow rpgOverworldBubbleBtn" data-ow-action="battle">Battle</button>
          <button type="button" class="btn primary magentaGlow rpgOverworldBubbleBtn" data-ow-action="shop" hidden>Shop</button>
        </div>
        <div class="rpgOverworldPlayer" id="owPlayer" aria-hidden="true" data-hero="${hero?.id || "hero"}">
          <div class="rpgOverworldAvatar" aria-hidden="true">
            <img class="rpgOverworldAvatarImg" src="${heroSprite}" alt="" draggable="false" loading="eager" onerror="this.remove()" />
          </div>
          <div class="rpgOverworldFoot" aria-hidden="true"></div>
        </div>
      </div>
      <div class="rpgOverworldTooltip" id="owTooltip" hidden aria-hidden="true"></div>
      <div class="rpgOverworldLegend rpgOverworldLegend--overlay" aria-label="Overworld legend">
        <div class="rpgLegendPills" role="list">
          <span class="rpgLegendChip rpgLegendChip--loc" role="listitem"><span class="rpgLegendDot" aria-hidden="true"></span>Battle marker</span>
          <span class="rpgLegendChip rpgLegendChip--road" role="listitem"><span class="rpgLegendDot rpgLegendDot--road" aria-hidden="true"></span>Allowed travel lanes</span>
          <span class="rpgLegendChip rpgLegendChip--shop" role="listitem"><span class="rpgLegendDot rpgLegendDot--shop" aria-hidden="true"></span>Shop</span>
        </div>
      </div>
    </div>
  `;

  // Allow click/tap/drag to move the avatar around the map.
  const frameEl = els.locationChoices.querySelector('#owFrame');
  if (frameEl instanceof HTMLElement) {
    // Prevent scroll-jank while dragging inside the modal.
    frameEl.style.touchAction = 'none';

    // Tooltip: show the location name when hovering/focusing a marker.
    const tooltipEl = els.locationChoices.querySelector('#owTooltip');
    const hideTooltip = () => {
      if (!(tooltipEl instanceof HTMLElement)) return;
      tooltipEl.setAttribute('hidden','');
      tooltipEl.setAttribute('aria-hidden','true');
    };
    const showTooltip = (pinEl) => {
      if (!(tooltipEl instanceof HTMLElement)) return;
      if (!(pinEl instanceof HTMLElement)) return;
      const raw = (pinEl.getAttribute('data-ow-name') || '').trim();
      if (!raw) { hideTooltip(); return; }
      tooltipEl.textContent = raw;
      tooltipEl.removeAttribute('hidden');
      tooltipEl.setAttribute('aria-hidden','false');

      const fr = frameEl.getBoundingClientRect();
      let x = 0;
      let y = 0;
      let place = "top";

      const pr = pinEl.getBoundingClientRect();
      x = (pr.left - fr.left) + (pr.width / 2);
      y = (pr.top - fr.top) + (pr.height / 2);

      // If the action bubble is visible for this same marker, anchor the tooltip to the bubble
      // so the label doesn't collide with the action button.
      const bubble = els.locationChoices.querySelector('#owBubble');
      if (bubble instanceof HTMLElement && !bubble.hasAttribute('hidden')) {
        const bubbleId = (bubble.getAttribute('data-ow-loc') || '').trim();
        const pinId = (pinEl.getAttribute('data-ow-loc') || '').trim();
        if (bubbleId && pinId && bubbleId === pinId) {
          const br = bubble.getBoundingClientRect();
          x = (br.left - fr.left) + (br.width / 2);

          const topY = (br.top - fr.top);
          const bottomY = (br.bottom - fr.top);
          if (topY < 64) {
            y = bottomY;
            place = "bottom";
          } else {
            y = topY;
            place = "top";
          }
        }
      }

      const pad = 12;
      const cx = clamp(x, pad, Math.max(pad, fr.width - pad));
      const cy = clamp(y, pad, Math.max(pad, fr.height - pad));
      tooltipEl.style.left = `${cx}px`;
      tooltipEl.style.top = `${cy}px`;

      tooltipEl.setAttribute('data-place', (place === "bottom") ? 'bottom' : 'top');
    };

    let dragging = false;
    let activePointerId = null;

    const eventToPct = (ev) => {
      const worldEl = els.locationChoices.querySelector('#owWorld');
      const r = (worldEl instanceof HTMLElement) ? worldEl.getBoundingClientRect() : frameEl.getBoundingClientRect();
      const x = (ev.clientX - r.left) / Math.max(1, r.width);
      const y = (ev.clientY - r.top) / Math.max(1, r.height);
      return {
        xPct: clamp(x * 100, 0, 100),
        yPct: clamp(y * 100, 0, 100),
      };
    };

    const onDown = (ev) => {
      // If you clicked a pin, let the pin handler handle it.
      const t = ev.target;
      if (
        t &&
        t instanceof HTMLElement &&
        (t.closest('button.rpgOverworldPin') || t.closest('#owBubble') || t.closest('button[data-ow-action]'))
      ) return;
      if (!isLocationOpen()) return;
      OVERWORLD.isDragging = true;
      OVERWORLD.hoveredLocId = null;
      hideTooltip();
      dragging = true;
      activePointerId = ev.pointerId;
      try { frameEl.setPointerCapture(ev.pointerId); } catch {}
      ev.preventDefault();
      const { xPct, yPct } = eventToPct(ev);
      setOverworldTarget(xPct, yPct);
      ensureOverworldAnimation();
      updateOverworldUI();
      renderOverworldPositions();
    };

    const onMove = (ev) => {
      if (!dragging) return;
      if (activePointerId !== null && ev.pointerId !== activePointerId) return;
      OVERWORLD.isDragging = true;
      ev.preventDefault();
      const { xPct, yPct } = eventToPct(ev);
      setOverworldTarget(xPct, yPct);
      ensureOverworldAnimation();
      updateOverworldUI();
      renderOverworldPositions();
    };

    const onUp = (ev) => {
      if (activePointerId !== null && ev.pointerId !== activePointerId) return;
      dragging = false;
      activePointerId = null;
      OVERWORLD.isDragging = false;
      try { frameEl.releasePointerCapture(ev.pointerId); } catch {}
      ensureOverworldAnimation();
      renderOverworldPositions();
    };

    frameEl.addEventListener('pointerdown', onDown);
    frameEl.addEventListener('pointermove', onMove);
    frameEl.addEventListener('pointerup', onUp);
    frameEl.addEventListener('pointercancel', onUp);
    frameEl.addEventListener('lostpointercapture', () => { dragging = false; activePointerId = null; OVERWORLD.isDragging = false; renderOverworldPositions(); });

    // Hover/focus handlers for tooltips.
    frameEl.addEventListener('pointerover', (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      const pin = t.closest('button.rpgOverworldPin');
      if (pin instanceof HTMLElement) {
        OVERWORLD.hoveredLocId = pin.getAttribute('data-ow-loc') || null;
        showTooltip(pin);
      }
    });
    frameEl.addEventListener('pointerout', (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      const fromPin = t.closest('button.rpgOverworldPin');
      if (!(fromPin instanceof HTMLElement)) return;
      const rt = ev.relatedTarget;
      if (rt && rt instanceof HTMLElement) {
        const toPin = rt.closest('button.rpgOverworldPin');
        if (toPin) return;
      }
      OVERWORLD.hoveredLocId = null;
      hideTooltip();
      // If the player is parked on a marker, bring the tooltip back for that marker.
      renderOverworldPositions();
    });
    frameEl.addEventListener('pointerleave', () => {
      OVERWORLD.hoveredLocId = null;
      hideTooltip();
      renderOverworldPositions();
    });
    frameEl.addEventListener('focusin', (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      const pin = t.closest('button.rpgOverworldPin');
      if (pin instanceof HTMLElement) {
        OVERWORLD.hoveredLocId = pin.getAttribute('data-ow-loc') || null;
        showTooltip(pin);
      }
    });
    frameEl.addEventListener('focusout', () => {
      window.setTimeout(() => {
        const a = document.activeElement;
        if (a && a instanceof HTMLElement && a.closest('button.rpgOverworldPin')) return;
        OVERWORLD.hoveredLocId = null;
        hideTooltip();
        renderOverworldPositions();
      }, 0);
    });
  }

  const zoomOutBtn = els.locationChoices.querySelector('button[data-ow-zoom="out"]');
  const zoomInBtn = els.locationChoices.querySelector('button[data-ow-zoom="in"]');
  if (zoomOutBtn instanceof HTMLButtonElement) {
    zoomOutBtn.addEventListener('click', () => setOverworldZoom(OVERWORLD.worldScale - 0.15));
  }
  if (zoomInBtn instanceof HTMLButtonElement) {
    zoomInBtn.addEventListener('click', () => setOverworldZoom(OVERWORLD.worldScale + 0.15));
  }

  const guideToggleBtn = els.locationChoices.querySelector('#owGuideToggle');
  if (guideToggleBtn instanceof HTMLButtonElement && frameEl instanceof HTMLElement) {
    const syncGuideUi = () => {
      frameEl.classList.toggle('isGuideVisible', !!OVERWORLD.showRoadOverlay);
      guideToggleBtn.setAttribute('aria-pressed', OVERWORLD.showRoadOverlay ? 'true' : 'false');
      guideToggleBtn.textContent = `Movement guide: ${OVERWORLD.showRoadOverlay ? 'On' : 'Off'}`;
    };
    syncGuideUi();
    guideToggleBtn.addEventListener('click', () => {
      OVERWORLD.showRoadOverlay = !OVERWORLD.showRoadOverlay;
      syncGuideUi();
    });
  }

  const fogToggleBtn = els.locationChoices.querySelector('#owFogToggle');
  if (fogToggleBtn instanceof HTMLButtonElement) {
    const syncFogUi = () => {
      fogToggleBtn.setAttribute('aria-pressed', OVERWORLD.showFog ? 'true' : 'false');
      fogToggleBtn.textContent = `Fog of war: ${OVERWORLD.showFog ? 'On' : 'Off'}`;
      renderFogOverlay();
    };
    syncFogUi();
    fogToggleBtn.addEventListener('click', () => {
      OVERWORLD.showFog = !OVERWORLD.showFog;
      syncFogUi();
    });
  }

  // Position player + highlight nearby marker.
  updateOverworldUI();
  renderOverworldPositions();
  renderFogOverlay();
}


function getOverworldRoadOverlaySvg() {
  const src = getOverworldRoadSource();
  if (!src.length) return '';
  const polylines = src.map((poly) => {
    const pts = Array.isArray(poly?.points) ? poly.points : [];
    if (pts.length < 2) return '';
    const coords = pts
      .map((pt) => `${toSafeNum(pt?.xPct, 0)},${toSafeNum(pt?.yPct, 0)}`)
      .join(' ');
    return `<polyline class="owRoadLine owRoadLine--glow" points="${coords}" />
<polyline class="owRoadLine owRoadLine--lane" points="${coords}" />`;
  }).join('');
  const graph = getOverworldRoadGraph();
  const intersections = (graph.intersections || [])
    .map((idx) => graph.nodes[idx])
    .filter(Boolean)
    .map((pt) => `<circle class="owRoadNode" cx="${toSafeNum(pt?.xPct, 0)}" cy="${toSafeNum(pt?.yPct, 0)}" r="0.75" />`)
    .join('');
  return `<g class="owRoadGroup">${polylines}${intersections}</g>`;
}


function openLocationPicker() {
  if (!(els.locationModal instanceof HTMLElement)) return;
  closeMagicMenu();

  resetOverworld();
  resetLocationApproach();
  renderLocationChoices();
  els.locationModal.removeAttribute("hidden");
  locationLastFocus = document.activeElement;
  updateBodyModalOpen();

  // Ensure the overworld opens scrolled to the top.
  // Focusing a button lower in the modal can cause the browser to auto-scroll.
  const modalInner = els.locationModal.querySelector('.rpgModalInner');
  const modalBody = els.locationModal.querySelector('.rpgModalBody');
  if (modalInner instanceof HTMLElement) {
    // Make the container focusable for keyboard users without scrolling.
    if (!modalInner.hasAttribute('tabindex')) modalInner.setAttribute('tabindex', '-1');
    modalInner.scrollTop = 0;
  }
  if (modalBody instanceof HTMLElement) modalBody.scrollTop = 0;
  els.locationModal.scrollTop = 0;

  setPhase("select");
  renderIntent(null);
  setEffectBanner("—", "neutral");
  render();

  // Keep focus at the top so the modal doesn't open scrolled down.
  // Movement + Enter still work via the document key handler.
  if (modalInner instanceof HTMLElement) {
    modalInner.focus({ preventScroll: true });
  } else {
    const title = els.locationModal.querySelector('#locationTitle');
    if (title instanceof HTMLElement && typeof title.focus === 'function') title.focus({ preventScroll: true });
  }

  // In case any late layout shifts happen (fonts/images), re-pin scroll to top.
  window.setTimeout(() => {
    if (modalInner instanceof HTMLElement) modalInner.scrollTop = 0;
    if (modalBody instanceof HTMLElement) modalBody.scrollTop = 0;
    if (els.locationModal instanceof HTMLElement) els.locationModal.scrollTop = 0;
    renderOverworldPositions();
  }, 0);
}

function closeLocationPicker() {
  if (!(els.locationModal instanceof HTMLElement)) return;
  els.locationModal.setAttribute("hidden", "");
  resetLocationApproach();
  OVERWORLD.keys = Object.create(null);
  clearOverworldTarget();
  if (OVERWORLD.rafId) {
    window.cancelAnimationFrame(OVERWORLD.rafId);
    OVERWORLD.rafId = 0;
  }
  const prev = locationLastFocus;
  locationLastFocus = null;
  updateBodyModalOpen();
  if (prev && prev instanceof HTMLElement) prev.focus();
}

function resetVisuals() {
  const clear = [
    "rpgAnim-attack",
    "rpgAnim-hit",
    "rpgAnim-heal",
    "rpgAnim-guard",
    "rpgAnim-faint",
  ];

  if (els.enemySprite instanceof HTMLElement) {
    clear.forEach((c) => els.enemySprite.classList.remove(c));
    els.enemySprite.classList.remove("is-guarding");
    els.enemySprite.classList.remove("is-phase2");
  }
  if (els.playerSprite instanceof HTMLElement) {
    clear.forEach((c) => els.playerSprite.classList.remove(c));
    els.playerSprite.classList.remove("is-guarding");
  }
}

function startBattleWithLocation(locId) {
  const loc = setActiveLocation(locId);
  if (loc.id === FINAL_LOCATION_ID && !isCampaignFinalUnlocked()) {
    addLog("The Palace is still sealed. Reclaim all four artifacts first.");
    render();
    return;
  }

  const pendingApproachBonuses = (APPROACH.active && APPROACH.locationId === loc.id && Array.isArray(APPROACH.bonuses) && APPROACH.bonuses.length)
    ? APPROACH.bonuses.map((bonus) => cloneApproachBonus(bonus)).filter(Boolean)
    : [];

  closeMagicMenu();
  closeInventoryMenu();
  lootResolve = null;
  if (isLootOpen()) closeLootScreen();
  if (lootTimer) window.clearTimeout(lootTimer);
  lootTimer = 0;
  closeLocationPicker();

  resetVisuals();

  // Ensure boss music is not stuck on from a previous run.
  __exitBossMusic();

  const encounterSet = buildEncounterSetForLocation(loc);
  activeEnemySet = encounterSet;
  state = makeInitialState(encounterSet, loc.id);
  pendingApproachBonuses.forEach((bonus) => applyApproachBonusToBattle(bonus, loc));
  syncKnownSpells(false);
  state.enemy.intent = computeEnemyIntent();
  renderIntent(state.enemy.intent);

  setEffectBanner("—", "neutral");
  setPhase("player");
  render();
}



  // Open/close wiring
  if (els.explainBtn instanceof HTMLButtonElement) {
    els.explainBtn.addEventListener("click", () => openExplain());
  }
  if (els.codexBtn instanceof HTMLButtonElement) {
    els.codexBtn.addEventListener("click", () => openCodex());
  }
  if (els.perkBtn instanceof HTMLButtonElement) {
    els.perkBtn.addEventListener("click", () => openPerks());
  }
  if (els.explainClose instanceof HTMLButtonElement) {
    els.explainClose.addEventListener("click", () => closeExplain());
  }
  if (els.explainOk instanceof HTMLButtonElement) {
    els.explainOk.addEventListener("click", () => closeExplain());
  }

  if (els.codexClose instanceof HTMLButtonElement) {
    els.codexClose.addEventListener("click", () => closeCodex());
  }
  if (els.codexOk instanceof HTMLButtonElement) {
    els.codexOk.addEventListener("click", () => closeCodex());
  }

  // Perks wiring
  if (els.perkClose instanceof HTMLButtonElement) {
    els.perkClose.addEventListener("click", () => closePerks());
  }
  if (els.perkOk instanceof HTMLButtonElement) {
    els.perkOk.addEventListener("click", () => closePerks());
  }

  // Loot/Victory wiring (manual continue)
  if (els.lootMapBtn instanceof HTMLButtonElement) {
    els.lootMapBtn.addEventListener("click", () => {
      // Exit the battle flow and return to the overworld map.
      // Rewards (coins/items/xp) are already granted before this screen opens.
      restart();
    });
  }
  if (els.lootContinueBtn instanceof HTMLButtonElement) {
    els.lootContinueBtn.addEventListener("click", () => {
      // Only close if the modal is currently open.
      if (isLootOpen()) closeLootScreen();
    });
  }

  // Spell picker wiring
  if (els.spellPickBtn instanceof HTMLButtonElement) {
    els.spellPickBtn.addEventListener("click", () => openNextSpellPick());
  }
  if (els.spellPickClose instanceof HTMLButtonElement) {
    els.spellPickClose.addEventListener("click", () => closeSpellPicker());
  }
  if (els.spellPickLater instanceof HTMLButtonElement) {
    els.spellPickLater.addEventListener("click", () => closeSpellPicker());
  }
  if (els.spellPickModal instanceof HTMLElement) {
    els.spellPickModal.addEventListener("click", (e) => {
      if (e.target === els.spellPickModal) closeSpellPicker();
    });
  }

  // Click outside modal content closes it
  if (els.explainModal instanceof HTMLElement) {
    els.explainModal.addEventListener("click", (e) => {
      if (e.target === els.explainModal) closeExplain();
    });
  }

  if (els.codexModal instanceof HTMLElement) {
    els.codexModal.addEventListener("click", (e) => {
      if (e.target === els.codexModal) closeCodex();
    });
  }

  if (els.perkModal instanceof HTMLElement) {
    els.perkModal.addEventListener("click", (e) => {
      if (e.target === els.perkModal) closePerks();
    });
  }

  /** @param {number} value @param {number} min @param {number} max */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /** @param {number} n */
  function fmtMult(n) {
    const s = (Math.round(n * 100) / 100).toString();
    return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  }

  // --------------------
  // Type system
  // --------------------

  /** @typedef {"Wind"|"Water"|"Fire"|"Sight"|"Earth"|"Touch"|"Sound"|"SmellTaste"} MagicType */

  /**
   * Base type chart (3 tiers). We'll derive a 5-tier chart from this so the "strongest" and "weakest"
   * relationships show up as Super / Extremely-not-effective even on single-type matchups.
   */
  const TYPE_ORDER = /** @type {MagicType[]} */ (["Wind", "Water", "Fire", "Earth", "Sight", "Sound", "Touch", "SmellTaste"]);

  const TYPE_CHART_BASE = /** @type {Record<MagicType, Record<MagicType, number>>} */ ({
Wind: { Wind: 1.0, Water: 1.0, Fire: 0.9, Sight: 1.15, Earth: 0.9, Touch: 1.0, Sound: 1.0, SmellTaste: 1.15 },
Water: { Wind: 1.0, Water: 1.0, Fire: 1.15, Sight: 1.0, Earth: 1.15, Touch: 0.9, Sound: 0.9, SmellTaste: 1.0 },
Fire: { Wind: 1.15, Water: 0.9, Fire: 1.0, Sight: 1.0, Earth: 1.15, Touch: 1.0, Sound: 0.9, SmellTaste: 1.0 },
Sight: { Wind: 0.9, Water: 1.0, Fire: 1.0, Sight: 1.0, Earth: 0.9, Touch: 1.15, Sound: 1.0, SmellTaste: 1.15 },
Earth: { Wind: 1.15, Water: 0.9, Fire: 0.9, Sight: 1.15, Earth: 1.0, Touch: 1.0, Sound: 1.0, SmellTaste: 1.0 },
Touch: { Wind: 1.0, Water: 1.15, Fire: 1.0, Sight: 0.9, Earth: 1.0, Touch: 1.0, Sound: 1.15, SmellTaste: 0.9 },
Sound: { Wind: 1.0, Water: 1.15, Fire: 1.15, Sight: 1.0, Earth: 1.0, Touch: 0.9, Sound: 1.0, SmellTaste: 0.9 },
SmellTaste: { Wind: 0.9, Water: 1.0, Fire: 1.0, Sight: 0.9, Earth: 1.0, Touch: 1.15, Sound: 1.15, SmellTaste: 1.0 },
  });


/** @param {MagicType} attackType @param {MagicType[]} defenderTypes */
  // Tier multipliers (match the chart’s strong/weak values).
  const TYPE_WEAK = 0.9;
  const TYPE_STRONG = 1.15;

  /**
   * Derive a 5-tier chart from the base chart:
   * - For each defender type, choose ONE "strongest" attacker among the strongest set (if any) => Super (TYPE_STRONG^2)
   * - For each defender type, choose ONE "worst" attacker among the weakest set (if any) => Extremely-not (TYPE_WEAK^2)
   * This makes the 5 tiers appear in the full chart while staying grounded in the base strengths.
   */
  function buildFiveTierChart(base) {
    /** @type {Record<MagicType, Record<MagicType, number>>} */
    const out = /** @type {any} */ ({});
    for (const atk of TYPE_ORDER) out[atk] = { ...(base[atk] || {}) };

    for (const def of TYPE_ORDER) {
      let max = -Infinity;
      let min = Infinity;
      for (const atk of TYPE_ORDER) {
        const m = base[atk]?.[def] ?? 1;
        if (m > max) max = m;
        if (m < min) min = m;
      }

      // Pick a single "strongest" attacker for this defender (stable order tie-break).
      if (max > 1) {
        const superAtk = TYPE_ORDER.find((atk) => (base[atk]?.[def] ?? 1) === max);
        if (superAtk) out[superAtk][def] = TYPE_STRONG * TYPE_STRONG;
      }

      // Pick a single "worst" attacker for this defender (stable order tie-break).
      if (min < 1) {
        const extremeAtk = TYPE_ORDER.find((atk) => (base[atk]?.[def] ?? 1) === min);
        if (extremeAtk) out[extremeAtk][def] = TYPE_WEAK * TYPE_WEAK;
      }
    }

    return out;
  }

  const TYPE_CHART = buildFiveTierChart(TYPE_CHART_BASE);

  /** @param {MagicType} attackType @param {MagicType[]} defenderTypes */
  function typeEffectScore(attackType, defenderTypes) {
    // Discrete scoring: each defender type contributes -2/-1/0/+1/+2 based on the 5-tier chart.
    // This keeps outcomes readable (and prevents in-between multipliers like 1.28 on mixed dual types).
    let score = 0;
    for (const dt of defenderTypes) {
      const m = TYPE_CHART[attackType]?.[dt] ?? 1;
      if (m >= (TYPE_STRONG * TYPE_STRONG) - 1e-6) score += 2;
      else if (m > 1) score += 1;
      else if (m <= (TYPE_WEAK * TYPE_WEAK) + 1e-6) score -= 2;
      else if (m < 1) score -= 1;
    }
    return clamp(score, -2, 2);
  }

  const TYPE_TIER_MULT = /** @type {Record<string, number>} */ ({
    "-2": TYPE_WEAK * TYPE_WEAK,
    "-1": TYPE_WEAK,
    "0": 1.0,
    "1": TYPE_STRONG,
    "2": TYPE_STRONG * TYPE_STRONG,
  });

  const EFFECT_TIER_CUTS = {
    extreme: (TYPE_TIER_MULT["-2"] + TYPE_TIER_MULT["-1"]) / 2,
    weak: (TYPE_TIER_MULT["-1"] + TYPE_TIER_MULT["0"]) / 2,
    strong: (TYPE_TIER_MULT["0"] + TYPE_TIER_MULT["1"]) / 2,
    super: (TYPE_TIER_MULT["1"] + TYPE_TIER_MULT["2"]) / 2,
  };

  /** @param {MagicType} attackType @param {MagicType[]} defenderTypes */
  function typeMultiplier(attackType, defenderTypes) {
    const s = typeEffectScore(attackType, defenderTypes);
    return TYPE_TIER_MULT[String(s)] ?? 1;
  }

  /** @param {number} mult */
  function effectivenessTier(mult) {
    if (mult < EFFECT_TIER_CUTS.extreme) return { score: -2, label: "Extremely not effective", tone: "bad", bannerTone: "not" };
    if (mult < EFFECT_TIER_CUTS.weak) return { score: -1, label: "Not effective", tone: "bad", bannerTone: "not" };
    if (mult < EFFECT_TIER_CUTS.strong) return { score: 0, label: "Neutral", tone: "neutral", bannerTone: "neutral" };
    if (mult < EFFECT_TIER_CUTS.super) return { score: 1, label: "Effective", tone: "good", bannerTone: "super" };
    return { score: 2, label: "Super effective", tone: "good", bannerTone: "super" };
  }

  /** @param {number} mult */
  function effectivenessText(mult) {
    const t = effectivenessTier(mult);
    if (t.score === 0) return "";
    if (t.score === 2) return "Super effective";
    if (t.score === 1) return "Effective";
    if (t.score === -1) return "Not effective";
    return "Extremely not effective";
  }

  /** @param {number} mult */
  function effectivenessTierLabel(mult) {
    const t = effectivenessTier(mult);
    if (t.score === 2) return { label: "Super effective", tone: "good" };
    if (t.score === 1) return { label: "Effective", tone: "good" };
    if (t.score === -1) return { label: "Not effective", tone: "bad" };
    if (t.score === -2) return { label: "Extremely not effective", tone: "bad" };
    return { label: "Neutral", tone: "neutral" };
  }

  /**
   * Render the "before you click" effectiveness preview line.
   * @param {{name:string, type: MagicType, baseCost:number, extra?: string}} move
   */
  function renderEffectPreview(move) {
    if (!(els.effectPreview instanceof HTMLElement)) return;
    const pv = els.effectPreview;

    const clearToneClasses = () => {
      pv.classList.remove(
        "isGood",
        "isBad",
        "isNeutral",
        "isSuper",
        "isEffective",
        "isNot",
        "isExtremeNot"
      );
    };

    // Custom preview (used for non-typed actions like Heal).
    if (move && typeof move.customHtml === "string" && move.customHtml.trim()) {
      const tone = move.tone === "good" || move.tone === "bad" ? move.tone : "neutral";
      clearToneClasses();
      if (tone === "good") pv.classList.add("isGood");
      else if (tone === "bad") pv.classList.add("isBad");
      else pv.classList.add("isNeutral");
      pv.innerHTML = move.customHtml;
      return;
    }

    // Typed preview: match the *exact* 5-tier outcomes and colors used by the type chart.
    const eff = typeMultiplier(move.type, state.enemy.types);
    const tier = effectivenessTier(eff);

    clearToneClasses();
    if (tier.score === 2) pv.classList.add("isSuper");
    else if (tier.score === 1) pv.classList.add("isEffective");
    else if (tier.score === -1) pv.classList.add("isNot");
    else if (tier.score === -2) pv.classList.add("isExtremeNot");
    else pv.classList.add("isNeutral");

    // Mana cost note (only for magic)
    const boundExtra = state.player.bound > 0 ? 1 : 0;
    const cost = move.baseCost > 0 ? move.baseCost + boundExtra : 0;
    const needs = cost > 0 && state.player.focus < cost;

    const costText = needs ? `Need ${cost} Mana` : (cost > 0 ? `${cost} Mana` : "+1 Mana");

    const power = Math.max(0, toSafeInt(move.basePower, 0));
    const powerText = power > 0 ? `Pow ${power}` : "";

    // Extra helper text (spell hook summary, etc.)
    const extraText = (move && typeof move.extra === "string" && move.extra.trim()) ? move.extra.trim() : "";

    // Match the chart’s format (xN) and keep the tooltip compact.
    const metaParts = [`x${fmtMult(eff)}`, costText];
    if (powerText) metaParts.unshift(powerText);
    if (extraText) metaParts.push(extraText);
    const meta = metaParts.join(" • ");

    pv.innerHTML =
      `${move.name}: <span class="rpgEffectPreviewText">${tier.label}</span> ` +
      `<span class="rpgEffectPreviewMeta">(${meta})</span>`;
  }

/**
 * Position the effect preview near the hovered/focused element.
 * This prevents layout shifts (which can cause hover flicker in the magic menu)
 * and keeps the preview from stealing pointer events.
 * @param {HTMLElement|null} anchorEl
 */
function positionEffectPreview(anchorEl) {
  if (!(els.effectPreview instanceof HTMLElement)) return;
  const pv = els.effectPreview;
  if (!(anchorEl instanceof HTMLElement)) return;

  const rect = anchorEl.getBoundingClientRect();
  const margin = 10;
  const x = rect.left + rect.width / 2;

  // Prefer above the button, but flip below if we're too close to the top.
  const preferAbove = rect.top > 84;
  pv.style.top = `${preferAbove ? (rect.top - 8) : (rect.bottom + 8)}px`;
  pv.style.transform = preferAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)";
  pv.style.left = `${x}px`;

  // Clamp after render so we know the tooltip width.
  requestAnimationFrame(() => {
    if (!(pv instanceof HTMLElement)) return;
    const r = pv.getBoundingClientRect();
    const minX = margin + r.width / 2;
    const maxX = window.innerWidth - margin - r.width / 2;
    const cx = clamp(x, minX, maxX);
    pv.style.left = `${cx}px`;

    // If still off-screen vertically, flip.
    const r2 = pv.getBoundingClientRect();
    if (r2.top < margin) {
      pv.style.top = `${rect.bottom + 8}px`;
      pv.style.transform = "translate(-50%, 0)";
    } else if (r2.bottom > window.innerHeight - margin) {
      pv.style.top = `${rect.top - 8}px`;
      pv.style.transform = "translate(-50%, -100%)";
    }
  });
}


  /** @param {string} name @param {MagicType} type @param {number} baseCost */
  
  /**
   * Render a short, always-visible hint so the game explains itself while you play.
   * The goal is not to "play for you", but to make the mechanics readable.
   */
  function renderHint() {
    if (!(els.hintLine instanceof HTMLElement)) return;

    if (state.over) {
      els.hintLine.textContent = "Tip: Restart to play again. Use Explain if you want the full rules.";
      return;
    }

    const extra = state.player.bound > 0 ? 1 : 0;
    const healCost = 1 + extra;
    const hpRatio = state.player.hp / Math.max(1, state.player.max);

    // If low HP, prioritize the healing explanation.
    if (hpRatio <= 0.35 && state.player.healCharges > 0) {
      if (state.player.focus >= healCost) {
        els.hintLine.textContent = `Low HP: Heal now (${healCost} Mana).`;
        return;
      }
      els.hintLine.textContent = `Low HP: Build Mana with Attack/Guard to Heal (need ${healCost}).`;
      return;
    }

    // Otherwise keep the advice generic (no enemy intent / no "best hit" coaching).
    const bindNote = state.player.bound > 0 ? "You are Bound: magic costs +1 Mana. Guard breaks Bind." : "";
    const baseTip = "";
    els.hintLine.textContent = [baseTip, bindNote].filter(Boolean).join(" ");
  }

function setPreviewMove(name, type, baseCost, basePower = 0, extra = "", anchorEl = null) {
    previewVisible = true;
    previewMove = { name, type, baseCost, basePower, extra };
    renderEffectPreview(previewMove);
    positionEffectPreview(anchorEl);
  }

	/**
	 * Set a custom preview line (used for non-typed actions like Heal).
	 * @param {string} html
	 * @param {"good"|"bad"|"neutral"} tone
	 */
	function setPreviewText(html, tone = "neutral", anchorEl = null) {
	  previewVisible = true;
	  const t = state?.player?.types?.[0] || "Touch";
	  previewMove = { name: "Preview", type: t, baseCost: 0, customHtml: html, tone };
	  renderEffectPreview(previewMove);
	  positionEffectPreview(anchorEl);
	}

	/**
	 * Predict how much HP Heal will restore right now (after capping at Max HP).
	 * This mirrors the actual heal formula so the preview is always accurate.
	 */
	function previewHealAmount() {
	  const healMult = typeof state?.player?.healMult === "number" ? state.player.healMult : 1;
	  const maxHp = Math.max(1, toSafeInt(state?.player?.max, 1));
	  const curHp = clamp(toSafeInt(state?.player?.hp, 0), 0, maxHp);
	  const hpRatio = maxHp > 0 ? curHp / maxHp : 1;
	  let heal = Math.round(maxHp * 0.28 + 4 * healMult);
	  if (hpRatio <= 0.35) heal += Math.round(maxHp * 0.08);
	  heal = Math.max(1, heal);
	  const next = clamp(curHp + heal, 0, maxHp);
	  return Math.max(0, next - curHp);
	}

	function showHealPreview(anchorEl = null) {
	  const amt = previewHealAmount();
	  setPreviewText(`Heal: <span class="rpgEffectPreviewText">+${amt} HP</span>`, "neutral", anchorEl);
	}

  /** @param {MagicType[]} types */
  function formatTypes(types) {
    return `Type: ${formatTypesDisplay(types)}`;
  }

  /** @param {HTMLElement|null} el @param {MagicType[]} types */
  function renderTypePills(el, types) {
    if (!(el instanceof HTMLElement)) return;
    el.innerHTML = "";
    for (const t of types) {
      const span = document.createElement("span");
      span.className = `typePill typePill--${t}`;
      span.textContent = `${typeIcon(t)} ${TYPE_META[t]?.label ?? t}`;
      el.appendChild(span);
    }
  }

  
  /** @param {number} mult */
  function matchupLabel(mult) {
    if (mult >= 1.30) return { text: "Strong", cls: "isStrong" };
    if (mult <= 0.90) return { text: "Weak", cls: "isWeak" };
    return { text: "Even", cls: "isNeutral" };
  }

  /**
   * Render a single matchup row.
   * @param {HTMLElement|null} listEl
   * @param {{type: MagicType, label: string, mult: number}} item
   */
  function appendMatchupRow(listEl, item) {
    if (!(listEl instanceof HTMLElement)) return;
    const li = document.createElement("li");
    const tone = matchupLabel(item.mult);
    li.className = `rpgTypeRow ${tone.cls}`;

    const left = document.createElement("span");
    left.className = "rpgTypeLeft";

    const pill = document.createElement("span");
    pill.className = `typePill typePill--${item.type}`;
    pill.textContent = item.type;

    const name = document.createElement("span");
    name.className = "rpgTypeName";
    name.textContent = item.label;

    left.appendChild(pill);
    left.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "rpgTypeMeta";

    const mult = document.createElement("span");
    mult.className = "rpgMult";
    mult.textContent = `x${fmtMult(item.mult)}`;

    const tag = document.createElement("span");
    tag.className = "rpgTag";
    tag.textContent = tone.text;

    meta.appendChild(mult);
    meta.appendChild(tag);

    li.appendChild(left);
    li.appendChild(meta);

    listEl.appendChild(li);
  }

  /**
   * Render the simple matchup lists (no giant chart required).
   */
  function renderMatchupLists() {
    // Clear
    if (els.atkVsEnemyList instanceof HTMLElement) els.atkVsEnemyList.innerHTML = "";
    if (els.enemyVsYouList instanceof HTMLElement) els.enemyVsYouList.innerHTML = "";

    // Player moves (what the UI actually offers)
    const atkType = playerPrimaryType();
    const atkPrev = computeTypedDamage("player", "enemy", 5, atkType, { ignoreEffectiveness: true });
    const windPrev = computeTypedDamage("player", "enemy", 4, "Wind");
    const waterPrev = computeTypedDamage("player", "enemy", 5, "Water");
    const soundPrev = computeTypedDamage("player", "enemy", 5, "Sound");
    const smellPrev = computeTypedDamage("player", "enemy", 4, "SmellTaste");
    const firePrev = computeTypedDamage("player", "enemy", 6, "Fire");

    appendMatchupRow(els.atkVsEnemyList, { type: atkType, label: "Attack", mult: atkPrev.overall });
    appendMatchupRow(els.atkVsEnemyList, { type: "Wind", label: "Wind spell", mult: windPrev.overall });
    appendMatchupRow(els.atkVsEnemyList, { type: "Water", label: "Water spell", mult: waterPrev.overall });

    const offSound = !state.player.types.includes("Sound");
    appendMatchupRow(els.atkVsEnemyList, { type: "Sound", label: offSound ? "Sound spell (off-type)" : "Sound spell", mult: soundPrev.overall });

    const offSmell = !state.player.types.includes("SmellTaste");
    appendMatchupRow(els.atkVsEnemyList, { type: "SmellTaste", label: offSmell ? "Smell/Taste spell (off-type)" : "Smell/Taste spell", mult: smellPrev.overall });

    const offType = !state.player.types.includes("Fire");
    appendMatchupRow(els.atkVsEnemyList, { type: "Fire", label: offType ? "Fire spell (off-type)" : "Fire spell", mult: firePrev.overall });

    // Enemy core move types (based on their types)
    const seen = new Set();
    for (const t of state.enemy.types) {
      if (seen.has(t)) continue;
      seen.add(t);
      const prev = computeTypedDamage("enemy", "player", 5, t);
      appendMatchupRow(els.enemyVsYouList, { type: t, label: `${t} move`, mult: prev.overall });
    }
  }

  /**
   * Render a full type chart as an easy-to-scan grid.
   * Rows = attacker type, columns = defender type.
   */
  function renderTypeMatrix() {
    if (!(els.typeMatrix instanceof HTMLElement)) return;
    if (els.typeMatrix.dataset.ready === "1") return;

    /** @type {MagicType[]} */
    const order = ["Wind", "Water", "Fire", "Earth", "Sight", "Sound", "Touch", "SmellTaste"];

    const table = els.typeMatrix;
    table.innerHTML = "";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");

    const corner = document.createElement("th");
    corner.className = "rpgCorner";
    corner.innerHTML = '<span class="muted tiny">Atk\\Def</span>';
    headRow.appendChild(corner);

    for (const def of order) {
      const th = document.createElement("th");
      th.className = "rpgColHead";
      const chip = document.createElement("span");
      chip.className = `typeInline typeInline--${def}`;
      chip.textContent = `${typeIcon(def)} ${TYPE_META[def]?.label ?? def}`;
      th.appendChild(chip);
      headRow.appendChild(th);
    }

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    for (const atk of order) {
      const tr = document.createElement("tr");

      const rowHead = document.createElement("th");
      rowHead.className = "rpgRowHead";
      const chip = document.createElement("span");
      chip.className = `typeInline typeInline--${atk}`;
      chip.textContent = `${typeIcon(atk)} ${TYPE_META[atk]?.label ?? atk}`;
      rowHead.appendChild(chip);
      tr.appendChild(rowHead);

      for (const def of order) {
        // Use the same tiered effectiveness logic the battle system uses.
        // (Even though this matrix is single-type columns today, this keeps it consistent.)
        const mult = typeMultiplier(atk, [def]);
        const tier = effectivenessTier(mult);
        const td = document.createElement("td");
        td.className = "rpgTypeCell";

        // 5 discrete outcomes: extremely not effective, not effective, neutral, effective, super effective.
        if (tier.score === 2) td.classList.add("isSuper");
        else if (tier.score === 1) td.classList.add("isEffective");
        else if (tier.score === -1) td.classList.add("isNot");
        else if (tier.score === -2) td.classList.add("isExtremeNot");
        else td.classList.add("isNeutral");

        // Display a number in the grid (so players can scan exact values).
        // Values remain discrete because typeMultiplier() snaps to the 5-tier system.
        td.textContent = `x${fmtMult(mult)}`;
        td.title = `${TYPE_META[atk]?.label ?? atk} → ${TYPE_META[def]?.label ?? def}: ${tier.label} (x${fmtMult(mult)})`;
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    table.dataset.ready = "1";
  }

/** @param {string} text @param {"super"|"not"|"neutral"} tone */
  function setEffectBanner(text, tone) {
    if (!(els.effectBanner instanceof HTMLElement)) return;
    els.effectBanner.classList.remove("isSuper", "isNot", "isNeutral");
    if (tone === "super") els.effectBanner.classList.add("isSuper");
    else if (tone === "not") els.effectBanner.classList.add("isNot");
    else els.effectBanner.classList.add("isNeutral");
    els.effectBanner.textContent = text || "—";
  }

  /** @param {number} overall */
  function toneFromMultiplier(overall) {
    if (overall >= 1.30) return "super";
    if (overall <= 0.90) return "not";
    return "neutral";
  }

  /**
   * Compute typed damage with STAB + effectiveness (defenses applied later).
   * @param {"player"|"enemy"} attackerKey
   * @param {"player"|"enemy"} defenderKey
   * @param {number} base
   * @param {MagicType} moveType
   * @param {{ ignoreEffectiveness?: boolean }=} opts
   */
  function computeTypedDamage(attackerKey, defenderKey, base, moveType, opts = {}) {
    const attacker = state[attackerKey];
    const defender = state[defenderKey];
    let stab = attacker.types.includes(moveType) ? 1.1 : 1.0;

    // Effectiveness is tiered (5 discrete outcomes) so it stays readable.
    const ignoreEff = !!opts.ignoreEffectiveness;
    // Basic strikes can be flagged to ignore type advantage entirely.
    const eff = ignoreEff ? 1.0 : typeMultiplier(moveType, defender.types);
    if (ignoreEff) stab = 1.0;
    const tier = effectivenessTier(eff);

    const scaled = Math.max(1, Math.round(base * stab * eff));
    return {
      scaled,
      stab,
      eff,
      overall: stab * eff,
      tierLabel: tier.label,
      tierScore: tier.score,
      bannerTone: tier.bannerTone,
      // Log note (only when not neutral)
      note: effectivenessText(eff),
    };
  }

  // --------------------
  // Combatants + waves
  // --------------------

const HERO_STORAGE_KEY = "dragonstone_rpg_hero";

// --------------------
// Leveling + XP (saved per-hero)
// --------------------

const PROGRESS_KEY_PREFIX = "dragonstone_rpg_progress_";

/** @param {any} n @param {number} fallback */
function toSafeNum(n, fallback) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function toSafeInt(n, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.trunc(x);
}

/** @param {any} v */
function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}



// --------------------
// Rarity (simple)
// --------------------

/** @typedef {"common"|"uncommon"|"rare"|"epic"|"legendary"} RarityKey */

const RARITY_ORDER = /** @type {RarityKey[]} */ (["common", "uncommon", "rare", "epic", "legendary"]);

const RARITY_META = /** @type {Record<RarityKey, {label:string}>} */ ({
  common: { label: "Common" },
  uncommon: { label: "Uncommon" },
  rare: { label: "Rare" },
  epic: { label: "Epic" },
  legendary: { label: "Legendary" },
});

const ITEM_RARITY_WEIGHTS = /** @type {Record<RarityKey, number>} */ ({
  common: 60,
  uncommon: 28,
  rare: 10,
  epic: 2,
  legendary: 0,
});

const GEAR_RARITY_WEIGHTS = /** @type {Record<RarityKey, number>} */ ({
  common: 55,
  uncommon: 28,
  rare: 13,
  epic: 4,
  legendary: 0,
});

/** @param {RarityKey|any} r */
function rarityLabel(r) {
  /** @type {RarityKey} */
  const key = (RARITY_META && RARITY_META[r]) ? r : "common";
  return RARITY_META[key].label;
}

/** @param {Record<RarityKey, number>} weights */
function rollRarity(weights) {
  const entries = Object.entries(weights || {}).filter(([, w]) => Number(w) > 0);
  if (!entries.length) return /** @type {RarityKey} */ ("common");
  const total = entries.reduce((s, [, w]) => s + Number(w), 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) {
    r -= Number(w);
    if (r <= 0) return /** @type {RarityKey} */ (k);
  }
  return /** @type {RarityKey} */ (entries[entries.length - 1][0]);
}

/** @param {any[]} list */
function pickOne(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Pick an ID from pools by rarity, falling back to more common rarities.
 * @param {Record<RarityKey, string[]>} pools
 * @param {RarityKey} wanted
 */
function pickByRarity(pools, wanted) {
  const idx = Math.max(0, RARITY_ORDER.indexOf(wanted));
  for (let i = idx; i >= 0; i--) {
    const r = RARITY_ORDER[i];
    const list = pools?.[r];
    const pick = pickOne(list);
    if (pick) return pick;
  }
  // last resort: any
  for (const r of RARITY_ORDER) {
    const pick = pickOne(pools?.[r]);
    if (pick) return pick;
  }
  return null;
}

/** @param {RarityKey|any} r */
function rarityRank(r) {
  const key = (RARITY_META && RARITY_META[r]) ? r : "common";
  return RARITY_ORDER.indexOf(key);
}

// --------------------
// Items (extremely simple)
// - One-use consumables
// - Found randomly after each cleared wave (equal chance per item)
// - Saved per-hero
// --------------------

const ITEM_DEFS = /** @type {Record<string, {id:string,name:string,icon:string,desc:string,rarity:RarityKey}>} */ ({
  potion: { id: "potion", name: "Potion", icon: "🧪", desc: "Heal 7 HP", rarity: "common" },
  ether: { id: "ether", name: "Mana Shard", icon: "💠", desc: "Restore 2 Mana", rarity: "common" },
  cleanse: { id: "cleanse", name: "Cleanse Charm", icon: "🧿", desc: "Clear Burn + Bind", rarity: "uncommon" },

  // Slightly more interesting drops (still very simple)
  bomb: { id: "bomb", name: "Bomb", icon: "💣", desc: "Deal 6 damage (ignores defenses)", rarity: "uncommon" },
  ember: { id: "ember", name: "Ember Oil", icon: "🕯️", desc: "Apply Burn (2) to enemy", rarity: "uncommon" },
  stun: { id: "stun", name: "Stun Dust", icon: "🌫️", desc: "Enemy skips next turn", rarity: "rare" },
  rune: { id: "rune", name: "Power Rune", icon: "🗡️", desc: "Next damage x1.3", rarity: "rare" },
  barrier: { id: "barrier", name: "Barrier Scroll", icon: "🛡️", desc: "Next hit −30%", rarity: "epic" },
});
const ITEM_IDS = Object.keys(ITEM_DEFS);

const ITEM_IDS_BY_RARITY = /** @type {Record<RarityKey, string[]>} */ ({
  common: ITEM_IDS.filter((id) => ITEM_DEFS[id]?.rarity === "common"),
  uncommon: ITEM_IDS.filter((id) => ITEM_DEFS[id]?.rarity === "uncommon"),
  rare: ITEM_IDS.filter((id) => ITEM_DEFS[id]?.rarity === "rare"),
  epic: ITEM_IDS.filter((id) => ITEM_DEFS[id]?.rarity === "epic"),
  legendary: ITEM_IDS.filter((id) => ITEM_DEFS[id]?.rarity === "legendary"),
});


const STARTING_ITEMS = /** @type {Record<string, number>} */ ({ potion: 1, ether: 1, bomb: 1 });

/** @param {any} raw */
function sanitizeItemCounts(raw) {
  /** @type {Record<string, number>} */
  const out = {};
  const src = raw && typeof raw === "object" ? raw : {};
  for (const id of ITEM_IDS) {
    const n = Math.max(0, toSafeInt(src[id], 0));
    if (n > 0) out[id] = clamp(n, 0, 99);
  }
  return out;
}


// --------------------
// Gear (equipment)
// - Persistent, NOT consumed
// - Three slots: Weapon / Armor / Trinket
// - Saved per-hero
// - Drag & drop in Gear menu (click also works, for mobile)
// --------------------

const EQUIP_SLOTS = /** @type {("weapon"|"armor"|"trinket")[]} */ (["weapon", "armor", "trinket"]);
const EQUIP_SLOT_LABEL = /** @type {Record<"weapon"|"armor"|"trinket", string>} */ ({
  weapon: "Weapon",
  armor: "Armor",
  trinket: "Trinket",
});

/** @type {Record<string, {id:string,slot:"weapon"|"armor"|"trinket",name:string,icon:string,desc:string, rarity:RarityKey, bossUnique?:boolean, hpBonus?:number, focusBonus?:number, powerPct?:number, healPct?:number, drPct?:number}>} */
const GEAR_DEFS = {
  // Trinkets (small, flexible bonuses)
  apprentice_ring: { id: "apprentice_ring", slot: "trinket", name: "Apprentice Ring", icon: "💍", desc: "+2 Max HP", rarity: "common", hpBonus: 2 },
  focus_band: { id: "focus_band", slot: "trinket", name: "Focus Band", icon: "🔷", desc: "+1 Max Mana", rarity: "common", focusBonus: 1 },
  ward_clasp: { id: "ward_clasp", slot: "trinket", name: "Ward Clasp", icon: "🧷", desc: "10% damage reduction", rarity: "uncommon", drPct: 0.10 },
  ember_charm: { id: "ember_charm", slot: "trinket", name: "Ember Charm", icon: "🔥", desc: "+8% damage", rarity: "uncommon", powerPct: 0.08 },
  sage_brooch: { id: "sage_brooch", slot: "trinket", name: "Sage Brooch", icon: "🌿", desc: "+8% healing", rarity: "uncommon", healPct: 0.08 },
  quartz_charm: { id: "quartz_charm", slot: "trinket", name: "Quartz Charm", icon: "💎", desc: "+3 Max HP", rarity: "uncommon", hpBonus: 3 },
  anchor_talisman: { id: "anchor_talisman", slot: "trinket", name: "Anchor Talisman", icon: "⚓", desc: "6% damage reduction", rarity: "common", drPct: 0.06 },
  duelist_coin: { id: "duelist_coin", slot: "trinket", name: "Duelist Coin", icon: "🪙", desc: "+6% damage", rarity: "common", powerPct: 0.06 },
  wisp_locket: { id: "wisp_locket", slot: "trinket", name: "Wisp Locket", icon: "🫧", desc: "+1 Max Mana, +4% healing", rarity: "rare", focusBonus: 1, healPct: 0.04 },
  bulwark_token: { id: "bulwark_token", slot: "trinket", name: "Bulwark Token", icon: "🛡️", desc: "8% damage reduction", rarity: "uncommon", drPct: 0.08 },

  // Weapons (lean into offense / Mana)
  tidal_blade: { id: "tidal_blade", slot: "weapon", name: "Tidal Blade", icon: "🗡️", desc: "+10% damage", rarity: "uncommon", powerPct: 0.10 },
  emberbrand_sabre: { id: "emberbrand_sabre", slot: "weapon", name: "Emberbrand Sabre", icon: "🗡️", desc: "+12% damage", rarity: "epic", powerPct: 0.12 },
  gale_dagger: { id: "gale_dagger", slot: "weapon", name: "Gale Dagger", icon: "🗡️", desc: "+9% damage", rarity: "uncommon", powerPct: 0.09 },
  echo_lance: { id: "echo_lance", slot: "weapon", name: "Echo Lance", icon: "🪓", desc: "+8% damage", rarity: "common", powerPct: 0.08 },
  duelist_foil: { id: "duelist_foil", slot: "weapon", name: "Duelist Foil", icon: "🗡️", desc: "+6% damage, +1 Max Mana", rarity: "rare", powerPct: 0.06, focusBonus: 1 },
  runic_mace: { id: "runic_mace", slot: "weapon", name: "Runic Mace", icon: "🔨", desc: "+2 Max HP, +6% damage", rarity: "uncommon", hpBonus: 2, powerPct: 0.06 },
  spring_wand: { id: "spring_wand", slot: "weapon", name: "Spring Wand", icon: "🪄", desc: "+10% healing", rarity: "uncommon", healPct: 0.10 },
  mana_scepter: { id: "mana_scepter", slot: "weapon", name: "Mana Scepter", icon: "🪄", desc: "+1 Max Mana", rarity: "common", focusBonus: 1 },
  prism_rod: { id: "prism_rod", slot: "weapon", name: "Prism Rod", icon: "🔮", desc: "+2 Max Mana", rarity: "rare", focusBonus: 2 },

  // Armor (survivability)
  stoneguard_vest: { id: "stoneguard_vest", slot: "armor", name: "Stoneguard Vest", icon: "🛡️", desc: "+4 Max HP", rarity: "common", hpBonus: 4 },
  ironbark_mail: { id: "ironbark_mail", slot: "armor", name: "Ironbark Mail", icon: "🥋", desc: "+6 Max HP, 6% damage reduction", rarity: "rare", hpBonus: 6, drPct: 0.06 },
  warded_coat: { id: "warded_coat", slot: "armor", name: "Warded Coat", icon: "🧥", desc: "12% damage reduction", rarity: "epic", drPct: 0.12 },
  mirrorweave_mantle: { id: "mirrorweave_mantle", slot: "armor", name: "Mirrorweave Mantle", icon: "🪞", desc: "8% damage reduction, +1 Max Mana", rarity: "rare", drPct: 0.08, focusBonus: 1 },
  mossweave_cloak: { id: "mossweave_cloak", slot: "armor", name: "Mossweave Cloak", icon: "🧶", desc: "+2 Max HP, +6% healing", rarity: "uncommon", hpBonus: 2, healPct: 0.06 },
  emberproof_jacket: { id: "emberproof_jacket", slot: "armor", name: "Emberproof Jacket", icon: "🧥", desc: "10% damage reduction", rarity: "uncommon", drPct: 0.10 },
  scholar_robe: { id: "scholar_robe", slot: "armor", name: "Scholar Robe", icon: "🎓", desc: "+2 Max HP, +1 Max Mana", rarity: "uncommon", hpBonus: 2, focusBonus: 1 },
  tidebreaker_coat: { id: "tidebreaker_coat", slot: "armor", name: "Tidebreaker Coat", icon: "🌊", desc: "+3 Max HP, 6% damage reduction", rarity: "uncommon", hpBonus: 3, drPct: 0.06 },
  pactwarden_wrap: { id: "pactwarden_wrap", slot: "armor", name: "Pactwarden Wrap", icon: "🧣", desc: "6% damage reduction, +6% healing", rarity: "rare", drPct: 0.06, healPct: 0.06 },

  // Boss relics (unique per area boss; NOT in the random drop pool)
  arena_victor_blade: { id: "arena_victor_blade", slot: "weapon", name: "Victor's Blade", icon: "🏆", desc: "+14% damage", rarity: "legendary", powerPct: 0.14, bossUnique: true },
  market_ledger_mail: { id: "market_ledger_mail", slot: "armor", name: "Ledger Mail", icon: "🧾", desc: "+1 Max Mana, 10% damage reduction", rarity: "legendary", focusBonus: 1, drPct: 0.10, bossUnique: true },
  feyleaf_circlet: { id: "feyleaf_circlet", slot: "trinket", name: "Feyleaf Circlet", icon: "🍃", desc: "+2 Max HP, +10% healing", rarity: "legendary", hpBonus: 2, healPct: 0.10, bossUnique: true },
  gutterglass_prism: { id: "gutterglass_prism", slot: "weapon", name: "Gutterglass Prism", icon: "🪞", desc: "+1 Max Mana, +8% damage", rarity: "legendary", focusBonus: 1, powerPct: 0.08, bossUnique: true },
};
const GEAR_IDS = Object.keys(GEAR_DEFS);

const HIDDEN_LEGACY_ENEMY_NAMES = new Set(['Candlecrown Matron']);

const BOSS_COMPENDIUM_NAMES = new Set([
  ...CAMPAIGN_DISTRICTS.map((d) => String(d?.bossName || '')),
  'Corrupted Regent',
]);

function isBossEnemyIndex(idx) {
  const enemy = Array.isArray(ENEMIES) ? ENEMIES[idx] : null;
  const name = String(enemy?.name || '');
  return !!name && BOSS_COMPENDIUM_NAMES.has(name);
}

function getBossEnemyCompendiumMeta(enemyName) {
  const district = CAMPAIGN_DISTRICTS.find((d) => d.bossName === enemyName);
  if (district) {
    return {
      tag: district.label,
      appear: `Appears: ${district.label} boss`,
      note: `Guards the ${district.artifactName}.`,
    };
  }
  if (enemyName === 'Corrupted Regent') {
    return {
      tag: 'Final Boss',
      appear: 'Appears: Palace final battle',
      note: 'Unlocked after all four artifacts are reclaimed.',
    };
  }
  return {
    tag: 'Boss',
    appear: 'Appears: boss encounter',
    note: '',
  };
}


// --------------------
// Compendium rendering
// --------------------

function clearEl(el) {
  if (!(el instanceof HTMLElement)) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** @param {RarityKey|any} r */
function makeRarityPill(r) {
  const span = document.createElement('span');
  span.className = `rpgRarityPill rarity--${(RARITY_META && RARITY_META[r]) ? r : 'common'}`;
  span.textContent = rarityLabel(r);
  return span;
}

/**
 * @param {{icon?:string,title:string, sub?:string, types?:MagicType[], rightPill?:HTMLElement|null, tag?:string, sprite?:string, className?:string}} opts
 */
function makeCodexEntry(opts) {
  const row = document.createElement('div');
  row.className = `rpgCodexEntry${(typeof opts.className === 'string' && opts.className.trim()) ? ` ${opts.className.trim()}` : ''}`;

  const icon = document.createElement('div');
  icon.className = 'rpgCodexIcon';

  const spriteSrc = (typeof opts.sprite === 'string' && opts.sprite.trim()) ? opts.sprite.trim() : '';
  if (spriteSrc) {
    const img = document.createElement('img');
    img.className = 'rpgCodexSprite';
    img.loading = 'lazy';
    img.alt = '';
    img.src = spriteSrc;
    icon.appendChild(img);

    // Keep compendium sprites visually consistent even when the PNGs have different padding.
    autoScaleSprite(img, { target: 0.92, max: 1.32 });
  } else {
    icon.textContent = opts.icon || '✦';
  }

  row.appendChild(icon);

  const main = document.createElement('div');
  main.className = 'rpgCodexMain';

  const top = document.createElement('div');
  top.className = 'rpgCodexTopRow';

  const name = document.createElement('div');
  name.className = 'rpgCodexName';
  name.textContent = opts.title;
  top.appendChild(name);

  if (opts.tag) {
    const tag = document.createElement('span');
    tag.className = 'rpgCodexTag';
    tag.textContent = opts.tag;
    top.appendChild(tag);
  }

  if (opts.rightPill) {
    top.appendChild(opts.rightPill);
  }

  main.appendChild(top);

  if (Array.isArray(opts.types) && opts.types.length) {
    const tWrap = document.createElement('div');
    tWrap.className = 'rpgCodexTypes';
    for (const t of opts.types) {
      const pill = document.createElement('span');
      pill.className = `typeInline typeInline--${t}`;
      pill.textContent = `${typeIcon(t)} ${TYPE_META[t]?.label ?? t}`;
      tWrap.appendChild(pill);
    }
    main.appendChild(tWrap);
  }

  if (opts.sub) {
    const sub = document.createElement('div');
    sub.className = 'rpgCodexSub';
    sub.textContent = opts.sub;
    main.appendChild(sub);
  }

  row.appendChild(main);
  return row;
}

/**
 * Compute approximate enemy encounter rates for the current weighted system.
 * Rates are calculated for Wave 1 and Wave 2; Wave 3 is always the boss.
 * The Wave 2 rates account for the 70% anti-repeat reroll (when Wave 2 initially matches Wave 1).
 * @returns {Map<number, {w1:number,w2:number,any:number,boss:boolean}>}
 */
function computeEnemyEncounterRates() {
  /** @type {Map<number, {w1:number,w2:number,any:number,boss:boolean}>} */
  const out = new Map();

  const bossIdx = (typeof BOSS_ENEMY_INDEX === 'number') ? BOSS_ENEMY_INDEX : -1;
  if (bossIdx >= 0) {
    // Boss appears only on Wave 3.
    out.set(bossIdx, { w1: 0, w2: 0, any: 1, boss: true });
  }

  // Waves 1-2: equal odds across all non-boss enemies.
  const pool = Array.isArray(NON_BOSS_ENEMY_INDICES) ? NON_BOSS_ENEMY_INDICES : [];
  const n = pool.length;
  if (!n) return out;

  const p = 1 / n;
  const any = clamp(1 - Math.pow(1 - p, 2), 0, 1); // independent waves, repeats allowed

  for (const idx of pool) {
    out.set(idx, { w1: p, w2: p, any, boss: false });
  }

  return out;
}

function formatPct(p) {
  const n = Math.max(0, Number(p) || 0);
  if (n <= 0) return '0%';
  const v = n * 100;
  if (v < 0.1) return '<0.1%';
  const s = v.toFixed(1);
  return s.endsWith('.0') ? `${Math.round(v)}%` : `${s}%`;
}

function renderCodex() {
  const rates = computeEnemyEncounterRates();
  const allEnemies = (Array.isArray(ENEMIES) ? ENEMIES : []).filter((e) => !HIDDEN_LEGACY_ENEMY_NAMES.has(String(e?.name || '')));
  const regularEnemies = allEnemies.filter((_, idx) => !isBossEnemyIndex(idx));
  const bossEnemies = allEnemies.filter((_, idx) => isBossEnemyIndex(idx));

  // ENEMIES
  if (els.codexEnemiesCount instanceof HTMLElement) {
    els.codexEnemiesCount.textContent = `${regularEnemies.length}`;
  }
  if (els.codexEnemies instanceof HTMLElement) {
    clearEl(els.codexEnemies);
    regularEnemies.forEach((e) => {
      const idx = allEnemies.indexOf(e);
      const r = rates.get(idx);
      const appear = r ? `Appears: W1 ${formatPct(r.w1)} • W2 ${formatPct(r.w2)}` : 'Appears: —';
      const sub = `HP ${toSafeInt(e?.maxHp, 0)} • Heals ${toSafeInt(e?.healCharges, 0)} • ${appear}`;
      els.codexEnemies.appendChild(makeCodexEntry({
        icon: '⚔️',
        title: String(e?.name || 'Enemy'),
        types: Array.isArray(e?.types) ? e.types : [],
        sub,
        sprite: String(e?.sprite || ''),
        className: 'rpgCodexEntry--enemy',
      }));
    });
  }

  // BOSS ENEMIES
  if (els.codexBossEnemiesCount instanceof HTMLElement) {
    els.codexBossEnemiesCount.textContent = `${bossEnemies.length}`;
  }
  if (els.codexBossEnemies instanceof HTMLElement) {
    clearEl(els.codexBossEnemies);
    bossEnemies.forEach((e) => {
      const meta = getBossEnemyCompendiumMeta(String(e?.name || ''));
      const lines = [
        `HP ${toSafeInt(e?.maxHp, 0)}`,
        `Heals ${toSafeInt(e?.healCharges, 0)}`,
        meta.appear,
      ];
      if (meta.note) lines.push(meta.note);
      els.codexBossEnemies.appendChild(makeCodexEntry({
        icon: '👑',
        title: String(e?.name || 'Boss'),
        types: Array.isArray(e?.types) ? e.types : [],
        sub: lines.join(' • '),
        tag: meta.tag,
        sprite: String(e?.sprite || ''),
        className: 'rpgCodexEntry--enemy rpgCodexEntry--bossEnemy',
      }));
    });
  }

  // ITEMS
  const itemList = Object.values(ITEM_DEFS || {});
  if (els.codexItemsCount instanceof HTMLElement) {
    els.codexItemsCount.textContent = `${itemList.length}`;
  }
  if (els.codexItems instanceof HTMLElement) {
    clearEl(els.codexItems);
    itemList
      .slice()
      .sort((a, b) => (rarityRank(a?.rarity) - rarityRank(b?.rarity)) || String(a?.name||'').localeCompare(String(b?.name||'')))
      .forEach((it) => {
        els.codexItems.appendChild(makeCodexEntry({
          icon: String(it?.icon || '🎒'),
          title: String(it?.name || it?.id || 'Item'),
          sub: String(it?.desc || ''),
          rightPill: makeRarityPill(it?.rarity),
        }));
      });
  }

  // GEAR
  const gearList = Object.values(GEAR_DEFS || {});
  if (els.codexGearCount instanceof HTMLElement) {
    els.codexGearCount.textContent = `${gearList.length}`;
  }
  if (els.codexGear instanceof HTMLElement) {
    clearEl(els.codexGear);

    const bySlot = { weapon: [], armor: [], trinket: [] };
    gearList.forEach((g) => {
      const slot = g?.slot;
      if (slot === 'weapon' || slot === 'armor' || slot === 'trinket') bySlot[slot].push(g);
    });

    for (const slot of EQUIP_SLOTS) {
      const header = document.createElement('div');
      header.className = 'rpgCodexTag';
      header.style.width = 'fit-content';
      header.textContent = `${EQUIP_SLOT_LABEL[slot]}`;
      els.codexGear.appendChild(header);

      const list = bySlot[slot]
        .slice()
        .sort((a, b) => {
          const bossA = a?.bossUnique ? 1 : 0;
          const bossB = b?.bossUnique ? 1 : 0;
          if (bossA != bossB) return bossA - bossB; // normal gear first, boss relics last
          return (rarityRank(a?.rarity) - rarityRank(b?.rarity)) || String(a?.name||'').localeCompare(String(b?.name||''));
        });

      list.forEach((g) => {
        const tag = g?.bossUnique ? 'Boss Relic' : '';
        els.codexGear.appendChild(makeCodexEntry({
          icon: String(g?.icon || '🧰'),
          title: String(g?.name || g?.id || 'Gear'),
          sub: String(g?.desc || ''),
          rightPill: makeRarityPill(g?.rarity),
          tag,
        }));
      });
    }
  }
}

// Exclude boss relics from the random drop pool (they are awarded only by bosses).
const GEAR_DROP_IDS = GEAR_IDS.filter((id) => !GEAR_DEFS[id]?.bossUnique);

// Precompute lists by slot (used for balanced drops and clean UI logic).
const GEAR_IDS_BY_SLOT = /** @type {Record<"weapon"|"armor"|"trinket", string[]>} */ ({
  weapon: GEAR_DROP_IDS.filter((id) => GEAR_DEFS[id]?.slot === "weapon"),
  armor: GEAR_DROP_IDS.filter((id) => GEAR_DEFS[id]?.slot === "armor"),
  trinket: GEAR_DROP_IDS.filter((id) => GEAR_DEFS[id]?.slot === "trinket"),
});
const GEAR_DROP_SLOTS = EQUIP_SLOTS.filter((s) => Array.isArray(GEAR_IDS_BY_SLOT[s]) && GEAR_IDS_BY_SLOT[s].length > 0);

const GEAR_IDS_BY_SLOT_RARITY = /** @type {Record<"weapon"|"armor"|"trinket", Record<RarityKey, string[]>>} */ ({
  weapon: {
    common: GEAR_IDS_BY_SLOT.weapon.filter((id) => (GEAR_DEFS[id]?.rarity || "common") === "common"),
    uncommon: GEAR_IDS_BY_SLOT.weapon.filter((id) => (GEAR_DEFS[id]?.rarity || "common") === "uncommon"),
    rare: GEAR_IDS_BY_SLOT.weapon.filter((id) => (GEAR_DEFS[id]?.rarity || "common") === "rare"),
    epic: GEAR_IDS_BY_SLOT.weapon.filter((id) => (GEAR_DEFS[id]?.rarity || "common") === "epic"),
    legendary: [],
  },
  armor: {
    common: GEAR_IDS_BY_SLOT.armor.filter((id) => (GEAR_DEFS[id]?.rarity || "common") === "common"),
    uncommon: GEAR_IDS_BY_SLOT.armor.filter((id) => (GEAR_DEFS[id]?.rarity || "common") === "uncommon"),
    rare: GEAR_IDS_BY_SLOT.armor.filter((id) => (GEAR_DEFS[id]?.rarity || "common") === "rare"),
    epic: GEAR_IDS_BY_SLOT.armor.filter((id) => (GEAR_DEFS[id]?.rarity || "common") === "epic"),
    legendary: [],
  },
  trinket: {
    common: GEAR_IDS_BY_SLOT.trinket.filter((id) => (GEAR_DEFS[id]?.rarity || "common") === "common"),
    uncommon: GEAR_IDS_BY_SLOT.trinket.filter((id) => (GEAR_DEFS[id]?.rarity || "common") === "uncommon"),
    rare: GEAR_IDS_BY_SLOT.trinket.filter((id) => (GEAR_DEFS[id]?.rarity || "common") === "rare"),
    epic: GEAR_IDS_BY_SLOT.trinket.filter((id) => (GEAR_DEFS[id]?.rarity || "common") === "epic"),
    legendary: [],
  },
});


// Only new heroes get starter gear. Existing saves remain unchanged.
const STARTING_GEAR = /** @type {Record<string, number>} */ ({ apprentice_ring: 1 });

/** @param {any} raw */
function sanitizeGearCounts(raw) {
  /** @type {Record<string, number>} */
  const out = {};
  const src = raw && typeof raw === "object" ? raw : {};
  for (const id of GEAR_IDS) {
    const n = Math.max(0, toSafeInt(src[id], 0));
    if (n > 0) out[id] = clamp(n, 0, 99);
  }
  return out;
}

/** @param {any} raw */
function sanitizeBossUniques(raw) {
  /** @type {Record<string, boolean>} */
  const out = {};
  const src = raw && typeof raw === "object" ? raw : {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof k !== "string") continue;
    if (v) out[k] = true;
  }
  return out;
}

/** @param {any} id @param {Record<string, number>} inv @param {"weapon"|"armor"|"trinket"} slot */
function sanitizeEquippedGearId(id, inv, slot) {
  if (typeof id !== "string") return null;
  const def = GEAR_DEFS[id];
  if (!def) return null;
  if (def.slot !== slot) return null;
  const n = Math.max(0, toSafeInt(inv?.[id], 0));
  return n > 0 ? id : null;
}

/**
 * Accepts either:
 * - legacy string `equip` (treated as trinket)
 * - {weapon, armor, trinket}
 * @param {any} raw
 * @param {Record<string, number>} inv
 * @returns {{weapon:string|null, armor:string|null, trinket:string|null}}
 */
function sanitizeEquipSlots(raw, inv) {
  /** @type {{weapon:string|null, armor:string|null, trinket:string|null}} */
  const out = { weapon: null, armor: null, trinket: null };

  // Backwards compatible: old saves used a single `equip` string.
  if (typeof raw === "string") {
    out.trinket = sanitizeEquippedGearId(raw, inv, "trinket");
    return out;
  }

  const src = raw && typeof raw === "object" ? raw : {};
  out.weapon = sanitizeEquippedGearId(src.weapon, inv, "weapon");
  out.armor = sanitizeEquippedGearId(src.armor, inv, "armor");
  out.trinket = sanitizeEquippedGearId(src.trinket, inv, "trinket");
  return out;
}

/**
 * Aggregate bonuses from equipped slots.
 * @param {{weapon:string|null, armor:string|null, trinket:string|null}} slots
 */
function gearBonusesFromSlots(slots) {
  const ids = [slots.weapon, slots.armor, slots.trinket].filter((x) => typeof x === "string");
  let hpBonus = 0;
  let focusBonus = 0;
  let powerPct = 0;
  let healPct = 0;
  let drPct = 0;

  ids.forEach((id) => {
    const g = id && GEAR_DEFS[id] ? GEAR_DEFS[id] : null;
    if (!g) return;
    hpBonus += Math.max(0, toSafeInt(g.hpBonus, 0));
    focusBonus += Math.max(0, toSafeInt(g.focusBonus, 0));
    powerPct += clamp(Number(g.powerPct ?? 0), 0, 0.50);
    healPct += clamp(Number(g.healPct ?? 0), 0, 0.50);
    drPct += clamp(Number(g.drPct ?? 0), 0, 0.50);
  });

  // Keep stacking sane.
  powerPct = clamp(powerPct, 0, 0.50);
  healPct = clamp(healPct, 0, 0.50);
  drPct = clamp(drPct, 0, 0.50);

  return { hpBonus, focusBonus, powerPct, healPct, drPct, ids };
}

/** @param {number} level */
function xpToNext(level) {
  const L = Math.max(1, toSafeInt(level, 1));
  const t = L - 1;
  // Smooth curve: early levels are quick, later levels take longer.
  return Math.max(12, Math.round(20 + t * 12 + t * t * 4));
}

// --------------------
// Perks (skill points)
// --------------------

/**
 * A perk is a tiny, passive bonus you unlock with skill points for a specific hero.
 * Keep effects small: this system is meant to add flavor without turning fights into a pure perk race.
 *
 * @typedef {{
 *  id:string,
 *  name:string,
 *  group?:"Offense"|"Defense"|"Utility"|string,
 *  line?:string,        // "skill tree" row label
 *  tier?:number,        // 1..N within a line
 *  requires?:string[],  // prerequisite perk ids
 *  lineOrder?:number,   // optional sorting within a group
 *  desc:string,
 *  cost:number,
 *  icon?:string,
 *  effects?:{
 *    hpBonus?:number,
 *    focusBonus?:number,
 *    powerPct?:number,
 *    healPct?:number,
 *    drPct?:number,
 *    xpPct?:number,
 *    startMana?:number,
 *  }
 * }} PerkDef
 */

/** Generic perks for any playable hero that doesn't have a custom list yet. */
/** @type {PerkDef[]} */
const GENERIC_PERKS = [
  // Offense: Damage (tiered)
  { id: "gen_damage_1", name: "Sharpened Intent", group: "Offense", line: "Damage", tier: 1, lineOrder: 1, icon: "⚔️", cost: 1, desc: "+4% damage dealt.", effects: { powerPct: 0.04 } },
  { id: "gen_damage_2", name: "Edge Control", group: "Offense", line: "Damage", tier: 2, lineOrder: 1, icon: "🗡️", cost: 1, desc: "+7% damage dealt.", effects: { powerPct: 0.07 } },
  { id: "gen_damage_3", name: "Finishing Angle", group: "Offense", line: "Damage", tier: 3, lineOrder: 1, icon: "🎯", cost: 2, desc: "+10% damage dealt.", effects: { powerPct: 0.10 } },

  // Defense: Guard (tiered)
  { id: "gen_guard_1", name: "Basic Guard", group: "Defense", line: "Guard", tier: 1, lineOrder: 1, icon: "🛡️", cost: 1, desc: "+4% damage reduction.", effects: { drPct: 0.04 } },
  { id: "gen_guard_2", name: "Firm Stance", group: "Defense", line: "Guard", tier: 2, lineOrder: 1, icon: "🧱", cost: 1, desc: "+7% damage reduction.", effects: { drPct: 0.07 } },
  { id: "gen_guard_3", name: "Iron Wall", group: "Defense", line: "Guard", tier: 3, lineOrder: 1, icon: "🏰", cost: 2, desc: "+10% damage reduction.", effects: { drPct: 0.10 } },

  // Defense: Vitality (tiered)
  { id: "gen_vital_1", name: "Sturdy Frame", group: "Defense", line: "Vitality", tier: 1, lineOrder: 2, icon: "🫀", cost: 1, desc: "+2 Max HP.", effects: { hpBonus: 2 } },
  { id: "gen_vital_2", name: "Hardy Body", group: "Defense", line: "Vitality", tier: 2, lineOrder: 2, icon: "💪", cost: 1, desc: "+4 Max HP.", effects: { hpBonus: 4 } },
  { id: "gen_vital_3", name: "Unbreakable", group: "Defense", line: "Vitality", tier: 3, lineOrder: 2, icon: "🪨", cost: 2, desc: "+6 Max HP.", effects: { hpBonus: 6 } },

  // Utility: Mana (tiered)
  { id: "gen_mana_1", name: "Mana Pocket", group: "Utility", line: "Mana", tier: 1, lineOrder: 1, icon: "🔷", cost: 1, desc: "+1 Max Mana.", effects: { focusBonus: 1 } },
  { id: "gen_mana_2", name: "Mana Reservoir", group: "Utility", line: "Mana", tier: 2, lineOrder: 1, icon: "💠", cost: 2, desc: "+2 Max Mana.", effects: { focusBonus: 2 } },
  { id: "gen_mana_3", name: "Mana Well", group: "Utility", line: "Mana", tier: 3, lineOrder: 1, icon: "🌌", cost: 2, desc: "+3 Max Mana.", effects: { focusBonus: 3 } },

  // Utility: Opening (tiered)
  { id: "gen_open_1", name: "Quick Start", group: "Utility", line: "Opening", tier: 1, lineOrder: 2, icon: "⚡", cost: 1, desc: "Start battles with +1 Mana.", effects: { startMana: 1 } },
  { id: "gen_open_2", name: "Strong Start", group: "Utility", line: "Opening", tier: 2, lineOrder: 2, icon: "⚡", cost: 2, desc: "Start battles with +2 Mana.", effects: { startMana: 2 } },
  { id: "gen_open_3", name: "Perfect Start", group: "Utility", line: "Opening", tier: 3, lineOrder: 2, icon: "⚡", cost: 2, desc: "Start battles with +3 Mana.", effects: { startMana: 3 } },

  // Utility: Recovery (tiered)
  { id: "gen_heal_1", name: "Minor Remedy", group: "Utility", line: "Recovery", tier: 1, lineOrder: 3, icon: "🩹", cost: 1, desc: "+8% healing.", effects: { healPct: 0.08 } },
  { id: "gen_heal_2", name: "Steady Remedy", group: "Utility", line: "Recovery", tier: 2, lineOrder: 3, icon: "🧪", cost: 1, desc: "+12% healing.", effects: { healPct: 0.12 } },
  { id: "gen_heal_3", name: "Major Remedy", group: "Utility", line: "Recovery", tier: 3, lineOrder: 3, icon: "🏥", cost: 2, desc: "+16% healing.", effects: { healPct: 0.16 } },

  // Utility: Study (tiered)
  { id: "gen_xp_1", name: "Practice Notes", group: "Utility", line: "Study", tier: 1, lineOrder: 4, icon: "📒", cost: 1, desc: "+10% XP gained.", effects: { xpPct: 0.10 } },
  { id: "gen_xp_2", name: "Field Notes", group: "Utility", line: "Study", tier: 2, lineOrder: 4, icon: "📓", cost: 1, desc: "+12% XP gained.", effects: { xpPct: 0.12 } },
  { id: "gen_xp_3", name: "Master Notes", group: "Utility", line: "Study", tier: 3, lineOrder: 4, icon: "📚", cost: 2, desc: "+15% XP gained.", effects: { xpPct: 0.15 } },
];

/** @type {Record<string, PerkDef[]>} */
const PERKS_BY_HERO = {
  // Sight + Wind (Relen)
  relen: [
    // Damage line
    { id: "relen_crosswind_timing", name: "Crosswind Timing", group: "Offense", line: "Damage", tier: 1, lineOrder: 1, icon: "🌀", cost: 1, desc: "+4% damage dealt.", effects: { powerPct: 0.04 } },
    { id: "relen_keen_angles", name: "Keen Angles", group: "Offense", line: "Damage", tier: 2, lineOrder: 1, icon: "🔭", cost: 1, desc: "+6% damage dealt.", effects: { powerPct: 0.06 } },
    { id: "relen_vector_thesis", name: "Vector Thesis", group: "Offense", line: "Damage", tier: 3, lineOrder: 1, icon: "📐", cost: 2, desc: "+10% damage dealt.", effects: { powerPct: 0.10 } },

    // Guard line
    { id: "relen_slipstream_guard", name: "Slipstream Guard", group: "Defense", line: "Guard", tier: 1, lineOrder: 1, icon: "🪽", cost: 1, desc: "+4% damage reduction.", effects: { drPct: 0.04 } },
    { id: "relen_windveil", name: "Windveil", group: "Defense", line: "Guard", tier: 2, lineOrder: 1, icon: "🌫️", cost: 1, desc: "+6% damage reduction.", effects: { drPct: 0.06 } },
    { id: "relen_cyclone_aegis", name: "Cyclone Aegis", group: "Defense", line: "Guard", tier: 3, lineOrder: 1, icon: "🛡️", cost: 2, desc: "+10% damage reduction.", effects: { drPct: 0.10 } },

    // Vitality line
    { id: "relen_feather_padding", name: "Feather Padding", group: "Defense", line: "Vitality", tier: 1, lineOrder: 2, icon: "🪶", cost: 1, desc: "+2 Max HP.", effects: { hpBonus: 2 } },
    { id: "relen_featherfall", name: "Featherfall", group: "Defense", line: "Vitality", tier: 2, lineOrder: 2, icon: "🪶", cost: 1, desc: "+3 Max HP.", effects: { hpBonus: 3 } },
    { id: "relen_aerie_fortitude", name: "Aerie Fortitude", group: "Defense", line: "Vitality", tier: 3, lineOrder: 2, icon: "🪶", cost: 2, desc: "+6 Max HP.", effects: { hpBonus: 6 } },

    // Mana line
    { id: "relen_updraft_reserve", name: "Updraft Reserve", group: "Utility", line: "Mana", tier: 1, lineOrder: 1, icon: "🌬️", cost: 1, desc: "+1 Max Mana.", effects: { focusBonus: 1 } },
    { id: "relen_deep_reserve", name: "Deep Reserve", group: "Utility", line: "Mana", tier: 2, lineOrder: 1, icon: "💠", cost: 2, desc: "+2 Max Mana.", effects: { focusBonus: 2 } },
    { id: "relen_cloudwell", name: "Cloudwell", group: "Utility", line: "Mana", tier: 3, lineOrder: 1, icon: "☁️", cost: 2, desc: "+3 Max Mana.", effects: { focusBonus: 3 } },

    // Opening line
    { id: "relen_first_breath", name: "First Breath", group: "Utility", line: "Opening", tier: 1, lineOrder: 2, icon: "🌤️", cost: 1, desc: "Start battles with +1 Mana.", effects: { startMana: 1 } },
    { id: "relen_second_breath", name: "Second Breath", group: "Utility", line: "Opening", tier: 2, lineOrder: 2, icon: "🌥️", cost: 2, desc: "Start battles with +2 Mana.", effects: { startMana: 2 } },
    { id: "relen_third_breath", name: "Third Breath", group: "Utility", line: "Opening", tier: 3, lineOrder: 2, icon: "⛅", cost: 2, desc: "Start battles with +3 Mana.", effects: { startMana: 3 } },

    // Recovery line
    { id: "relen_gale_mending", name: "Gale Mending", group: "Utility", line: "Recovery", tier: 1, lineOrder: 3, icon: "🩹", cost: 1, desc: "+8% healing.", effects: { healPct: 0.08 } },
    { id: "relen_windstitch", name: "Windstitch", group: "Utility", line: "Recovery", tier: 2, lineOrder: 3, icon: "🧵", cost: 1, desc: "+12% healing.", effects: { healPct: 0.12 } },
    { id: "relen_eye_of_calm", name: "Eye of Calm", group: "Utility", line: "Recovery", tier: 3, lineOrder: 3, icon: "🧿", cost: 2, desc: "+16% healing.", effects: { healPct: 0.16 } },

    // Study line
    { id: "relen_archivist", name: "Archivist Habit", group: "Utility", line: "Study", tier: 1, lineOrder: 4, icon: "📚", cost: 1, desc: "+10% XP gained.", effects: { xpPct: 0.10 } },
    { id: "relen_margin_notes", name: "Margin Notes", group: "Utility", line: "Study", tier: 2, lineOrder: 4, icon: "📝", cost: 1, desc: "+12% XP gained.", effects: { xpPct: 0.12 } },
    { id: "relen_skybound_thesis", name: "Skybound Thesis", group: "Utility", line: "Study", tier: 3, lineOrder: 4, icon: "📖", cost: 2, desc: "+15% XP gained.", effects: { xpPct: 0.15 } },
  ],

  // Sound + Fire (Axel)
  axel: [
    // Damage line
    { id: "axel_reverb_strikes", name: "Reverb Strikes", group: "Offense", line: "Damage", tier: 1, lineOrder: 1, icon: "📣", cost: 1, desc: "+4% damage dealt.", effects: { powerPct: 0.04 } },
    { id: "axel_resonant_core", name: "Resonant Core", group: "Offense", line: "Damage", tier: 2, lineOrder: 1, icon: "🎶", cost: 1, desc: "+8% damage dealt.", effects: { powerPct: 0.08 } },
    { id: "axel_crescendo", name: "Crescendo", group: "Offense", line: "Damage", tier: 3, lineOrder: 1, icon: "🔥", cost: 2, desc: "+12% damage dealt.", effects: { powerPct: 0.12 } },

    // Guard line
    { id: "axel_cindershield", name: "Cindershield", group: "Defense", line: "Guard", tier: 1, lineOrder: 1, icon: "🛡️", cost: 1, desc: "+4% damage reduction.", effects: { drPct: 0.04 } },
    { id: "axel_ashward", name: "Ashward", group: "Defense", line: "Guard", tier: 2, lineOrder: 1, icon: "🌫️", cost: 1, desc: "+7% damage reduction.", effects: { drPct: 0.07 } },
    { id: "axel_coalplate", name: "Coalplate", group: "Defense", line: "Guard", tier: 3, lineOrder: 1, icon: "🪨", cost: 2, desc: "+10% damage reduction.", effects: { drPct: 0.10 } },

    // Vitality line
    { id: "axel_matchbright_lungs", name: "Matchbright Lungs", group: "Defense", line: "Vitality", tier: 1, lineOrder: 2, icon: "🫁", cost: 1, desc: "+2 Max HP.", effects: { hpBonus: 2 } },
    { id: "axel_furnace_heart", name: "Furnace Heart", group: "Defense", line: "Vitality", tier: 2, lineOrder: 2, icon: "❤️‍🔥", cost: 2, desc: "+4 Max HP.", effects: { hpBonus: 4 } },
    { id: "axel_inferno_heart", name: "Inferno Heart", group: "Defense", line: "Vitality", tier: 3, lineOrder: 2, icon: "🫀", cost: 2, desc: "+6 Max HP.", effects: { hpBonus: 6 } },

    // Mana line
    { id: "axel_spare_breath", name: "Spare Breath", group: "Utility", line: "Mana", tier: 1, lineOrder: 1, icon: "🔷", cost: 1, desc: "+1 Max Mana.", effects: { focusBonus: 1 } },
    { id: "axel_reserve_tank", name: "Reserve Tank", group: "Utility", line: "Mana", tier: 2, lineOrder: 1, icon: "💠", cost: 2, desc: "+2 Max Mana.", effects: { focusBonus: 2 } },
    { id: "axel_backstage_cache", name: "Backstage Cache", group: "Utility", line: "Mana", tier: 3, lineOrder: 1, icon: "🎒", cost: 2, desc: "+3 Max Mana.", effects: { focusBonus: 3 } },

    // Opening line
    { id: "axel_overtones", name: "Overtones", group: "Utility", line: "Opening", tier: 1, lineOrder: 2, icon: "✨", cost: 1, desc: "Start battles with +1 Mana.", effects: { startMana: 1 } },
    { id: "axel_hot_mic", name: "Hot Mic", group: "Utility", line: "Opening", tier: 2, lineOrder: 2, icon: "🎤", cost: 2, desc: "Start battles with +2 Mana.", effects: { startMana: 2 } },
    { id: "axel_headliner", name: "Headliner", group: "Utility", line: "Opening", tier: 3, lineOrder: 2, icon: "🌟", cost: 2, desc: "Start battles with +3 Mana.", effects: { startMana: 3 } },

    // Recovery line
    { id: "axel_afterglow", name: "Afterglow", group: "Utility", line: "Recovery", tier: 1, lineOrder: 3, icon: "🩹", cost: 1, desc: "+8% healing.", effects: { healPct: 0.08 } },
    { id: "axel_warm_hands", name: "Warm Hands", group: "Utility", line: "Recovery", tier: 2, lineOrder: 3, icon: "🫶", cost: 1, desc: "+12% healing.", effects: { healPct: 0.12 } },
    { id: "axel_flare_aid", name: "Flare Aid", group: "Utility", line: "Recovery", tier: 3, lineOrder: 3, icon: "🚑", cost: 2, desc: "+16% healing.", effects: { healPct: 0.16 } },

    // Study line
    { id: "axel_stage_practice", name: "Stage Practice", group: "Utility", line: "Study", tier: 1, lineOrder: 4, icon: "📝", cost: 1, desc: "+10% XP gained.", effects: { xpPct: 0.10 } },
    { id: "axel_tour_journal", name: "Tour Journal", group: "Utility", line: "Study", tier: 2, lineOrder: 4, icon: "📓", cost: 1, desc: "+12% XP gained.", effects: { xpPct: 0.12 } },
    { id: "axel_masterclass", name: "Masterclass", group: "Utility", line: "Study", tier: 3, lineOrder: 4, icon: "📚", cost: 2, desc: "+15% XP gained.", effects: { xpPct: 0.15 } },
  ],

  // Smell/Taste + Fire (Mira)
  mira: [
    // Damage line
    { id: "mira_zestful_jolt", name: "Zestful Jolt", group: "Offense", line: "Damage", tier: 1, lineOrder: 1, icon: "🍋", cost: 1, desc: "+4% damage dealt.", effects: { powerPct: 0.04 } },
    { id: "mira_bittersweet_edge", name: "Bittersweet Edge", group: "Offense", line: "Damage", tier: 2, lineOrder: 1, icon: "🍊", cost: 1, desc: "+6% damage dealt.", effects: { powerPct: 0.06 } },
    { id: "mira_infusion_burst", name: "Infusion Burst", group: "Offense", line: "Damage", tier: 3, lineOrder: 1, icon: "🫖", cost: 2, desc: "+10% damage dealt.", effects: { powerPct: 0.10 } },

    // Guard line
    { id: "mira_saffron_ward", name: "Saffron Ward", group: "Defense", line: "Guard", tier: 1, lineOrder: 1, icon: "🌾", cost: 1, desc: "+4% damage reduction.", effects: { drPct: 0.04 } },
    { id: "mira_aromatic_guard", name: "Aromatic Guard", group: "Defense", line: "Guard", tier: 2, lineOrder: 1, icon: "🛡️", cost: 1, desc: "+8% damage reduction.", effects: { drPct: 0.08 } },
    { id: "mira_incense_armor", name: "Incense Armor", group: "Defense", line: "Guard", tier: 3, lineOrder: 1, icon: "🕯️", cost: 2, desc: "+10% damage reduction.", effects: { drPct: 0.10 } },

    // Vitality line
    { id: "mira_hearthy_meal", name: "Hearty Meal", group: "Defense", line: "Vitality", tier: 1, lineOrder: 2, icon: "🥘", cost: 1, desc: "+2 Max HP.", effects: { hpBonus: 2 } },
    { id: "mira_spice_bloom", name: "Spice Bloom", group: "Defense", line: "Vitality", tier: 2, lineOrder: 2, icon: "🌶️", cost: 1, desc: "+4 Max HP.", effects: { hpBonus: 4 } },
    { id: "mira_iron_kettle", name: "Iron Kettle", group: "Defense", line: "Vitality", tier: 3, lineOrder: 2, icon: "🫖", cost: 2, desc: "+6 Max HP.", effects: { hpBonus: 6 } },

    // Mana line
    { id: "mira_smoldering_reserve", name: "Smoldering Reserve", group: "Utility", line: "Mana", tier: 1, lineOrder: 1, icon: "🧪", cost: 1, desc: "+1 Max Mana.", effects: { focusBonus: 1 } },
    { id: "mira_pantry_stash", name: "Pantry Stash", group: "Utility", line: "Mana", tier: 2, lineOrder: 1, icon: "🥫", cost: 2, desc: "+2 Max Mana.", effects: { focusBonus: 2 } },
    { id: "mira_cellar_stock", name: "Cellar Stock", group: "Utility", line: "Mana", tier: 3, lineOrder: 1, icon: "🍯", cost: 2, desc: "+3 Max Mana.", effects: { focusBonus: 3 } },

    // Opening line
    { id: "mira_quick_sip", name: "Quick Sip", group: "Utility", line: "Opening", tier: 1, lineOrder: 2, icon: "🥤", cost: 1, desc: "Start battles with +1 Mana.", effects: { startMana: 1 } },
    { id: "mira_hot_pour", name: "Hot Pour", group: "Utility", line: "Opening", tier: 2, lineOrder: 2, icon: "☕", cost: 2, desc: "Start battles with +2 Mana.", effects: { startMana: 2 } },
    { id: "mira_rolling_boil", name: "Rolling Boil", group: "Utility", line: "Opening", tier: 3, lineOrder: 2, icon: "♨️", cost: 2, desc: "Start battles with +3 Mana.", effects: { startMana: 3 } },

    // Recovery line
    { id: "mira_simmering_remedy", name: "Simmering Remedy", group: "Utility", line: "Recovery", tier: 1, lineOrder: 3, icon: "🩺", cost: 1, desc: "+8% healing.", effects: { healPct: 0.08 } },
    { id: "mira_herbal_blend", name: "Herbal Blend", group: "Utility", line: "Recovery", tier: 2, lineOrder: 3, icon: "🌿", cost: 1, desc: "+12% healing.", effects: { healPct: 0.12 } },
    { id: "mira_full_tonic", name: "Full Tonic", group: "Utility", line: "Recovery", tier: 3, lineOrder: 3, icon: "🧴", cost: 2, desc: "+16% healing.", effects: { healPct: 0.16 } },

    // Study line
    { id: "mira_recipe_notes", name: "Recipe Notes", group: "Utility", line: "Study", tier: 1, lineOrder: 4, icon: "🧾", cost: 1, desc: "+10% XP gained.", effects: { xpPct: 0.10 } },
    { id: "mira_margin_recipe", name: "Margin Recipe", group: "Utility", line: "Study", tier: 2, lineOrder: 4, icon: "📝", cost: 1, desc: "+12% XP gained.", effects: { xpPct: 0.12 } },
    { id: "mira_master_chef", name: "Master Chef", group: "Utility", line: "Study", tier: 3, lineOrder: 4, icon: "👩‍🍳", cost: 2, desc: "+15% XP gained.", effects: { xpPct: 0.15 } },
  ],

  // Water + Sound (Devante)
  devante: [
    // Damage line
    { id: "devante_ripple_strike", name: "Ripple Strike", group: "Offense", line: "Damage", tier: 1, lineOrder: 1, icon: "〰️", cost: 1, desc: "+4% damage dealt.", effects: { powerPct: 0.04 } },
    { id: "devante_tidecut", name: "Tidecut", group: "Offense", line: "Damage", tier: 2, lineOrder: 1, icon: "🌊", cost: 1, desc: "+6% damage dealt.", effects: { powerPct: 0.06 } },
    { id: "devante_surge_chord", name: "Surge Chord", group: "Offense", line: "Damage", tier: 3, lineOrder: 1, icon: "🔊", cost: 2, desc: "+10% damage dealt.", effects: { powerPct: 0.10 } },

    // Guard line
    { id: "devante_breakwater", name: "Breakwater", group: "Defense", line: "Guard", tier: 1, lineOrder: 1, icon: "🧱", cost: 1, desc: "+4% damage reduction.", effects: { drPct: 0.04 } },
    { id: "devante_undertow", name: "Undertow", group: "Defense", line: "Guard", tier: 2, lineOrder: 1, icon: "🪨", cost: 1, desc: "+6% damage reduction.", effects: { drPct: 0.06 } },
    { id: "devante_reefwall", name: "Reefwall", group: "Defense", line: "Guard", tier: 3, lineOrder: 1, icon: "🪸", cost: 2, desc: "+10% damage reduction.", effects: { drPct: 0.10 } },

    // Vitality line
    { id: "devante_salt_hardening", name: "Salt Hardening", group: "Defense", line: "Vitality", tier: 1, lineOrder: 2, icon: "🧂", cost: 1, desc: "+2 Max HP.", effects: { hpBonus: 2 } },
    { id: "devante_seaglass_skin", name: "Sea Glass Skin", group: "Defense", line: "Vitality", tier: 2, lineOrder: 2, icon: "🟦", cost: 1, desc: "+3 Max HP.", effects: { hpBonus: 3 } },
    { id: "devante_tidebone", name: "Tidebone", group: "Defense", line: "Vitality", tier: 3, lineOrder: 2, icon: "🦴", cost: 2, desc: "+6 Max HP.", effects: { hpBonus: 6 } },

    // Mana line
    { id: "devante_tidal_focus", name: "Tidal Focus", group: "Utility", line: "Mana", tier: 1, lineOrder: 1, icon: "💧", cost: 1, desc: "+1 Max Mana.", effects: { focusBonus: 1 } },
    { id: "devante_deep_reservoir", name: "Deep Reservoir", group: "Utility", line: "Mana", tier: 2, lineOrder: 1, icon: "🌌", cost: 2, desc: "+2 Max Mana.", effects: { focusBonus: 2 } },
    { id: "devante_abyssal_reserve", name: "Abyssal Reserve", group: "Utility", line: "Mana", tier: 3, lineOrder: 1, icon: "🕳️", cost: 2, desc: "+3 Max Mana.", effects: { focusBonus: 3 } },

    // Opening line
    { id: "devante_bubble_start", name: "Bubble Start", group: "Utility", line: "Opening", tier: 1, lineOrder: 2, icon: "🫧", cost: 1, desc: "Start battles with +1 Mana.", effects: { startMana: 1 } },
    { id: "devante_surge_start", name: "Surge Start", group: "Utility", line: "Opening", tier: 2, lineOrder: 2, icon: "🌊", cost: 2, desc: "Start battles with +2 Mana.", effects: { startMana: 2 } },
    { id: "devante_undertone_start", name: "Undertone Start", group: "Utility", line: "Opening", tier: 3, lineOrder: 2, icon: "🎚️", cost: 2, desc: "Start battles with +3 Mana.", effects: { startMana: 3 } },

    // Recovery line
    { id: "devante_echo_current", name: "Echo Current", group: "Utility", line: "Recovery", tier: 1, lineOrder: 3, icon: "🩹", cost: 1, desc: "+8% healing.", effects: { healPct: 0.08 } },
    { id: "devante_rippling_relief", name: "Rippling Relief", group: "Utility", line: "Recovery", tier: 2, lineOrder: 3, icon: "💦", cost: 1, desc: "+12% healing.", effects: { healPct: 0.12 } },
    { id: "devante_choir_of_tides", name: "Choir of Tides", group: "Utility", line: "Recovery", tier: 3, lineOrder: 3, icon: "🎵", cost: 2, desc: "+16% healing.", effects: { healPct: 0.16 } },

    // Study line
    { id: "devante_cartographer", name: "Cartographer", group: "Utility", line: "Study", tier: 1, lineOrder: 4, icon: "🗺️", cost: 1, desc: "+10% XP gained.", effects: { xpPct: 0.10 } },
    { id: "devante_sea_log", name: "Sea Log", group: "Utility", line: "Study", tier: 2, lineOrder: 4, icon: "📓", cost: 1, desc: "+12% XP gained.", effects: { xpPct: 0.12 } },
    { id: "devante_soundings", name: "Soundings", group: "Utility", line: "Study", tier: 3, lineOrder: 4, icon: "📚", cost: 2, desc: "+15% XP gained.", effects: { xpPct: 0.15 } },
  ],

  // Binding + ??? (Elroy)
  elroy: [
    // Damage line
    { id: "elroy_quick_knots", name: "Quick Knots", group: "Offense", line: "Damage", tier: 1, lineOrder: 1, icon: "🧷", cost: 1, desc: "+4% damage dealt.", effects: { powerPct: 0.04 } },
    { id: "elroy_binding_cut", name: "Binding Cut", group: "Offense", line: "Damage", tier: 2, lineOrder: 1, icon: "🪢", cost: 1, desc: "+6% damage dealt.", effects: { powerPct: 0.06 } },
    { id: "elroy_sigiled_edge", name: "Sigiled Edge", group: "Offense", line: "Damage", tier: 3, lineOrder: 1, icon: "🔷", cost: 2, desc: "+10% damage dealt.", effects: { powerPct: 0.10 } },

    // Guard line
    { id: "elroy_ward_stitch", name: "Ward Stitch", group: "Defense", line: "Guard", tier: 1, lineOrder: 1, icon: "🧿", cost: 1, desc: "+4% damage reduction.", effects: { drPct: 0.04 } },
    { id: "elroy_guarded_thread", name: "Guarded Thread", group: "Defense", line: "Guard", tier: 2, lineOrder: 1, icon: "🧵", cost: 1, desc: "+6% damage reduction.", effects: { drPct: 0.06 } },
    { id: "elroy_warding_weave", name: "Warding Weave", group: "Defense", line: "Guard", tier: 3, lineOrder: 1, icon: "🪡", cost: 2, desc: "+10% damage reduction.", effects: { drPct: 0.10 } },

    // Vitality line
    { id: "elroy_fiber_padding", name: "Fiber Padding", group: "Defense", line: "Vitality", tier: 1, lineOrder: 2, icon: "🧶", cost: 1, desc: "+2 Max HP.", effects: { hpBonus: 2 } },
    { id: "elroy_hardened_charm", name: "Hardened Charm", group: "Defense", line: "Vitality", tier: 2, lineOrder: 2, icon: "🪬", cost: 2, desc: "+4 Max HP.", effects: { hpBonus: 4 } },
    { id: "elroy_iron_bind", name: "Iron Bind", group: "Defense", line: "Vitality", tier: 3, lineOrder: 2, icon: "⛓️", cost: 2, desc: "+6 Max HP.", effects: { hpBonus: 6 } },

    // Mana line
    { id: "elroy_steady_focus", name: "Steady Focus", group: "Utility", line: "Mana", tier: 1, lineOrder: 1, icon: "🧠", cost: 1, desc: "+1 Max Mana.", effects: { focusBonus: 1 } },
    { id: "elroy_sigiled_focus", name: "Sigiled Focus", group: "Utility", line: "Mana", tier: 2, lineOrder: 1, icon: "🔷", cost: 2, desc: "+2 Max Mana.", effects: { focusBonus: 2 } },
    { id: "elroy_etched_reserve", name: "Etched Reserve", group: "Utility", line: "Mana", tier: 3, lineOrder: 1, icon: "🗝️", cost: 2, desc: "+3 Max Mana.", effects: { focusBonus: 3 } },

    // Opening line
    { id: "elroy_first_sigil", name: "First Sigil", group: "Utility", line: "Opening", tier: 1, lineOrder: 2, icon: "✨", cost: 1, desc: "Start battles with +1 Mana.", effects: { startMana: 1 } },
    { id: "elroy_second_sigil", name: "Second Sigil", group: "Utility", line: "Opening", tier: 2, lineOrder: 2, icon: "✨", cost: 2, desc: "Start battles with +2 Mana.", effects: { startMana: 2 } },
    { id: "elroy_third_sigil", name: "Third Sigil", group: "Utility", line: "Opening", tier: 3, lineOrder: 2, icon: "✨", cost: 2, desc: "Start battles with +3 Mana.", effects: { startMana: 3 } },

    // Recovery line
    { id: "elroy_renewal_thread", name: "Renewal Thread", group: "Utility", line: "Recovery", tier: 1, lineOrder: 3, icon: "🩹", cost: 1, desc: "+8% healing.", effects: { healPct: 0.08 } },
    { id: "elroy_restitch", name: "Restitch", group: "Utility", line: "Recovery", tier: 2, lineOrder: 3, icon: "🪡", cost: 1, desc: "+12% healing.", effects: { healPct: 0.12 } },
    { id: "elroy_full_reweave", name: "Full Reweave", group: "Utility", line: "Recovery", tier: 3, lineOrder: 3, icon: "🧵", cost: 2, desc: "+16% healing.", effects: { healPct: 0.16 } },

    // Study line
    { id: "elroy_field_ledger", name: "Field Ledger", group: "Utility", line: "Study", tier: 1, lineOrder: 4, icon: "📒", cost: 1, desc: "+10% XP gained.", effects: { xpPct: 0.10 } },
    { id: "elroy_margin_ledger", name: "Margin Ledger", group: "Utility", line: "Study", tier: 2, lineOrder: 4, icon: "📝", cost: 1, desc: "+12% XP gained.", effects: { xpPct: 0.12 } },
    { id: "elroy_master_record", name: "Master Record", group: "Utility", line: "Study", tier: 3, lineOrder: 4, icon: "📚", cost: 2, desc: "+15% XP gained.", effects: { xpPct: 0.15 } },
  ],
};

/** @type {Set<string>} */
const ALL_PERK_IDS = new Set([
  ...Object.values(PERKS_BY_HERO).flat(),
  ...GENERIC_PERKS,
].map((p) => p.id));

/** @param {string} heroId */
function getPerkDefsForHero(heroId) {
  const key = String(heroId || "");
  if (!window.__perkDefCache) window.__perkDefCache = new Map();
  /** @type {Map<string, any[]>} */
  const cache = window.__perkDefCache;

  if (cache.has(key)) return cache.get(key);

  const base = (Array.isArray(PERKS_BY_HERO[key]) && PERKS_BY_HERO[key].length)
    ? PERKS_BY_HERO[key]
    : GENERIC_PERKS;

  const norm = normalizePerkDefs(base);
  cache.set(key, norm);
  return norm;
}

/**
 * Normalize perk defs into a simple "skill tree" shape:
 * - Ensures {group, line, tier} exist.
 * - Infers `requires` for perks in the same (group,line) when missing:
 *   Tier 2+ requires the previous tier.
 * @param {any[]} list
 */
function normalizePerkDefs(list) {
  const src = Array.isArray(list) ? list : [];
  /** @type {any[]} */
  const out = src.map((p) => ({ ...p }));

  // Build lines in insertion order for stable UI.
  /** @type {Map<string, any[]>} */
  const byLine = new Map();
  out.forEach((p) => {
    if (!p || typeof p !== "object") return;
    p.group = (p.group && typeof p.group === "string") ? p.group : "Utility";
    p.line = (p.line && typeof p.line === "string") ? p.line : p.group;
    const k = `${p.group}::${p.line}`;
    if (!byLine.has(k)) byLine.set(k, []);
    byLine.get(k).push(p);
  });

  byLine.forEach((arr) => {
    // Assign tiers if missing (use order within the line).
    arr.forEach((p, i) => {
      if (typeof p.tier !== "number" || !isFinite(p.tier)) p.tier = i + 1;
      p.tier = Math.max(1, toSafeInt(p.tier, 1));
      if (!Array.isArray(p.requires)) p.requires = null;
    });

    // Sort by tier, then keep stable for any ties.
    arr.sort((a, b) => {
      const ta = Math.max(1, toSafeInt(a.tier, 1));
      const tb = Math.max(1, toSafeInt(b.tier, 1));
      if (ta !== tb) return ta - tb;
      return 0;
    });

    // Infer requires: Tier 2+ requires previous tier, unless explicitly set.
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (Array.isArray(p.requires)) continue;
      if (i === 0) p.requires = [];
      else p.requires = [arr[i - 1].id];
    }
  });

  return out;
}

/** @param {any} raw @param {string} heroId */
function sanitizePerkIds(raw, heroId) {
  const allowed = new Set(getPerkDefsForHero(heroId).map((p) => p.id));
  const src = Array.isArray(raw) ? raw : [];
  return src.filter((id) => typeof id === "string" && allowed.has(id));
}

/** @param {string} heroId @param {string[]} perkIds */
function perkBonusesFromIds(heroId, perkIds) {
  const defs = getPerkDefsForHero(heroId);
  const byId = new Map(defs.map((p) => [p.id, p]));

  let hpBonus = 0;
  let focusBonus = 0;
  let powerPct = 0;
  let healPct = 0;
  let drPct = 0;
  let xpPct = 0;
  let startMana = 0;

  (Array.isArray(perkIds) ? perkIds : []).forEach((id) => {
    const p = byId.get(id);
    if (!p) return;
    const fx = p.effects || {};
    hpBonus += Math.max(0, toSafeInt(fx.hpBonus, 0));
    focusBonus += Math.max(0, toSafeInt(fx.focusBonus, 0));
    powerPct += clamp(Number(fx.powerPct ?? 0), 0, 0.50);
    healPct += clamp(Number(fx.healPct ?? 0), 0, 0.50);
    drPct += clamp(Number(fx.drPct ?? 0), 0, 0.50);
    xpPct += clamp(Number(fx.xpPct ?? 0), 0, 0.50);
    startMana += Math.max(0, toSafeInt(fx.startMana, 0));
  });

  // Keep stacking sane.
  powerPct = clamp(powerPct, 0, 0.50);
  healPct = clamp(healPct, 0, 0.50);
  drPct = clamp(drPct, 0, 0.50);
  xpPct = clamp(xpPct, 0, 0.50);
  startMana = clamp(startMana, 0, 3);

  return { hpBonus, focusBonus, powerPct, healPct, drPct, xpPct, startMana };
}

/** @param {string} heroId */

function loadHeroProgress(heroId) {
  const raw = localStorage.getItem(PROGRESS_KEY_PREFIX + heroId);
  if (!raw) {
    return {
      level: 1,
      xp: 0,
      skillPoints: 0,
      perks: [],
      spells: undefined,
      items: { ...STARTING_ITEMS },
      gear: { ...STARTING_GEAR },
      equipSlots: { weapon: null, armor: null, trinket: "apprentice_ring" },
      bossUniques: {},
      coins: 0,
    };
  }
  try {
    const obj = JSON.parse(raw);
    const level = clamp(toSafeInt(obj?.level, 1), 1, 99);
    const xp = Math.max(0, toSafeInt(obj?.xp, 0));
    const coins = Math.max(0, toSafeInt((obj?.coins ?? obj?.crowns), 0));
    const spells = Array.isArray(obj?.spells)
      ? obj.spells.filter((id) => typeof id === "string" && !!SPELLS_BY_ID[id])
      : undefined;
    const items = sanitizeItemCounts(obj?.items);
    const gear = sanitizeGearCounts(obj?.gear);

    // Prefer modern shape, but accept legacy `equip`.
    const rawSlots = obj?.equipSlots ?? obj?.equipment ?? obj?.equip;
    const equipSlots = sanitizeEquipSlots(rawSlots, gear);

    const bossUniques = sanitizeBossUniques(obj?.bossUniques);

    // Perks: backwards compatible and (optionally) retroactive points for existing saves.
    const perks = sanitizePerkIds(obj?.perks ?? obj?.perkIds, heroId);
    const defs = getPerkDefsForHero(heroId);
    const costById = new Map(defs.map((p) => [p.id, Math.max(0, toSafeInt(p.cost, 1))]));
    const spent = perks.reduce((sum, id) => sum + (costById.get(id) || 0), 0);

    let skillPoints = 0;
    if (typeof obj?.skillPoints === "number") {
      skillPoints = clamp(toSafeInt(obj.skillPoints, 0), 0, 99);
    } else {
      // If this save predates perks, grant points earned so far (level-1) minus anything already spent.
      skillPoints = clamp(Math.max(0, (level - 1) - spent), 0, 99);
    }

    return { level, xp, skillPoints, perks, spells, items, gear, equipSlots, bossUniques, coins };
  } catch {
    return {
      level: 1,
      xp: 0,
      skillPoints: 0,
      perks: [],
      spells: undefined,
      items: { ...STARTING_ITEMS },
      gear: { ...STARTING_GEAR },
      equipSlots: { weapon: null, armor: null, trinket: "apprentice_ring" },
      bossUniques: {},
      coins: 0,
    };
  }
}


/**
 * @param {string} heroId
 * @param {{level:number,xp:number,spells?:string[],items?:Record<string,number>,gear?:Record<string,number>,equipSlots?:{weapon?:string|null,armor?:string|null,trinket?:string|null},equip?:string|null}} prog
 */
function saveHeroProgress(heroId, prog) {
  try {
    const payload = {
      level: Math.max(1, toSafeInt(prog.level, 1)),
      xp: Math.max(0, toSafeInt(prog.xp, 0)),
    };

    payload.coins = Math.max(0, toSafeInt((prog?.coins ?? prog?.crowns), 0));
    // Back-compat for older builds
    payload.crowns = payload.coins;

    // Perks + skill points are hero-specific.
    payload.skillPoints = clamp(toSafeInt(prog?.skillPoints, 0), 0, 99);
    payload.perks = sanitizePerkIds(prog?.perks ?? prog?.perkIds, heroId);

    if (Array.isArray(prog.spells)) {
      payload.spells = prog.spells.filter((id) => typeof id === "string" && !!SPELLS_BY_ID[id]);
    }

    if (prog?.items && typeof prog.items === "object") {
      payload.items = sanitizeItemCounts(prog.items);
    }

    if (prog?.gear && typeof prog.gear === "object") {
      payload.gear = sanitizeGearCounts(prog.gear);
    }

    const inv = payload.gear || sanitizeGearCounts(prog.gear);

    // Accept either modern equipSlots or legacy equip string, then sanitize.
    const rawSlots = (prog?.equipSlots && typeof prog.equipSlots === "object") ? prog.equipSlots : prog?.equip;
    const slots = sanitizeEquipSlots(rawSlots, inv);
    payload.equipSlots = slots;

    // Back-compat for older builds: store trinket in `equip` too.
    payload.equip = slots.trinket;

    if (prog?.bossUniques && typeof prog.bossUniques === "object") {
      payload.bossUniques = sanitizeBossUniques(prog.bossUniques);
    }

    window.localStorage.setItem(PROGRESS_KEY_PREFIX + heroId, JSON.stringify(payload));
  } catch (e) {
    // localStorage may be blocked (private mode). Ignore.
  }
}


/** @param {number} level */
function levelBonuses(level) {
  const L = Math.max(1, toSafeInt(level, 1));
  const t = L - 1;
  return {
    hpBonus: t * 2,
    focusBonus: Math.floor(t / 4),
    powerMult: 1 + t * 0.04,
    healMult: 1 + t * 0.03,
  };
}

/** @param {{maxHp:number, focusMax:number, focusStart:number}} hero @param {number} level */
function applyLevelToHero(hero, level) {
  const b = levelBonuses(level);
  const maxHp = Math.max(1, toSafeInt(hero.maxHp, 18) + b.hpBonus);
  const focusMax = Math.max(1, toSafeInt(hero.focusMax, 6) + b.focusBonus);
  const focusStart = clamp(toSafeInt(hero.focusStart, 2), 0, focusMax);
  return { maxHp, focusMax, focusStart, ...b };
}

/** @type {MagicType[]} */
const __KNOWN_TYPES = ["Wind","Water","Fire","Sight","Earth","Touch","Sound","SmellTaste"];

/** Normalize a type label from site data into the game's MagicType strings. */
function normalizeMagicType(raw) {
  if (!raw) return null;

  const s = String(raw).trim();
  if (!s) return null;

  // Light normalization for common variants.
  const key = s
    .replace(/\+/g, " ")
    .replace(/\s*&\s*/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();

  const map = {
    "Air": "Wind",
    "Wind": "Wind",
    "Water": "Water",
    "Fire": "Fire",
    "Earth": "Earth",
    "Touch": "Touch",
    "Sight": "Sight",
    "Sound": "Sound",
    "Smell/Taste": "SmellTaste",
    "SmellTaste": "SmellTaste",
    "Smell Taste": "SmellTaste",
    "Smell+Taste": "SmellTaste",
  };

  const mapLower = {
    "air": "Wind",
    "wind": "Wind",
    "water": "Water",
    "fire": "Fire",
    "earth": "Earth",
    "touch": "Touch",
    "sight": "Sight",
    "sound": "Sound",
    "smell/taste": "SmellTaste",
    "smell taste": "SmellTaste",
    "smelltaste": "SmellTaste",
  };

  const normalized = map[key] || mapLower[key.toLowerCase()] || null;
  if (normalized && __KNOWN_TYPES.includes(normalized)) return /** @type {MagicType} */ (normalized);
  return null;
}

/** @param {any} c */
function heroFromCharacterData(c) {
  const rawPrimary = String(c?.school ?? "").trim();
  const rawSecondary = String(c?.element ?? "").trim();

  const t1 = normalizeMagicType(rawPrimary);
  const t2 = normalizeMagicType(rawSecondary);

  /** @type {MagicType[]} */
  const types = [];
  if (t1) types.push(t1);
  if (t2 && t2 !== t1) types.push(t2);

  /** @type {MagicType[]} */
  const safeTypes = (types.length ? types : /** @type {MagicType[]} */ (["Sight"]));

  const hasUnknownSecondary =
    !!rawSecondary &&
    !t2 &&
    rawSecondary.toLowerCase() !== "none" &&
    rawSecondary.toLowerCase() !== "n/a" &&
    rawSecondary.toLowerCase() !== "na";

  const typesLabel =
    safeTypes.map((t) => TYPE_META[t]?.label ?? t).join(" • ") +
    (hasUnknownSecondary ? " • TBD" : "");

  const cid = String(c?.id || "").toLowerCase();

  // Mild per-hero tuning (kept close to the old roster).
  const preset = {
    relen: { maxHp: 20, focusStart: 2 },
    axel: { maxHp: 22, focusStart: 2 },
    mira: { maxHp: 21, focusStart: 2 },
    devante: { maxHp: 19, focusStart: 2 },
    elroy: { maxHp: 23, focusStart: 2 },
  }[cid] || { maxHp: 20, focusStart: 2 };

  // Game-page-only sprite override(s)
  let sprite = String(c?.image || "./assets/images/characters/relen.webp");
  if (cid === "relen") sprite = "./assets/images/characters/relen-game.webp";

  return {
    id: String(c?.id || "hero"),
    name: String(c?.name || "Hero"),
    types: safeTypes,
    typesLabel,
    maxHp: preset.maxHp,
    healCharges: 3,
    focusMax: 6,
    focusStart: preset.focusStart,
    sprite,
    blurb: String(c?.summary || c?.hook || "").trim() || "A battle-ready mage.",
  };
}

/** Prefer building the playable roster from the same dataset used by the Characters/Search pages. */
function buildPlayableHeroes() {
  try {
    const db = window.CHARACTERS_DATA?.characters;
    if (!Array.isArray(db)) return null;

    // Use explicit flags first (so you can control who becomes playable).
    const flagged = db.filter((c) => c && c.playable === true);
    const picked = flagged.length ? flagged : db.filter((c) => ["axel","devante","elroy","relen","mira"].includes(String(c?.id || "")));

    if (!picked.length) return null;

    return picked.map(heroFromCharacterData);
  } catch {
    return null;
  }
}

const PLAYABLE_HEROES = buildPlayableHeroes() || [
  // Fallback roster if character data isn't available for any reason.
  {
    id: "relen",
    name: "Relen",
    types: /** @type {MagicType[]} */ (["Wind", "Sight"]),
    maxHp: 20,
    healCharges: 3,
    focusMax: 6,
    focusStart: 2,
    sprite: "./assets/images/characters/relen-game.webp",
    blurb: "Wind + Sight. A young prodigy with light-built precision.",
  },
  {
    id: "axel",
	    name: "Belle",
    types: /** @type {MagicType[]} */ (["Sound", "Fire"]),
    maxHp: 22,
    healCharges: 3,
    focusMax: 6,
    focusStart: 2,
    sprite: "./assets/images/characters/axel.webp",
    blurb: "Sound + Fire. Resonant pulse with matchbright snap.",
  },
  {
    id: "mira",
    name: "Mira",
    types: /** @type {MagicType[]} */ (["SmellTaste", "Fire"]),
    maxHp: 21,
    healCharges: 3,
    focusMax: 6,
    focusStart: 2,
    sprite: "./assets/images/characters/mira.webp",
    blurb: "Smell/Taste + Fire. Sealed record, sharp scent, hotter sparks.",
  },
  {
    id: "devante",
    name: "Devante",
    types: /** @type {MagicType[]} */ (["Water", "Sound"]),
    maxHp: 19,
    healCharges: 3,
    focusMax: 6,
    focusStart: 2,
    sprite: "./assets/images/characters/devante.webp",
    blurb: "Water + Sound. Calm resonance with a tide-tuned pulse.",
  },
];


/** @type {string} */
let activeHeroId = PLAYABLE_HEROES[0].id;

/** Rehydrate the last-picked hero if it's still playable. */
try {
  const saved = localStorage.getItem(HERO_STORAGE_KEY);
  if (saved && PLAYABLE_HEROES.some((h) => h.id === saved)) activeHeroId = saved;
} catch {
  // ignore
}


function getHeroById(id) {
  return PLAYABLE_HEROES.find((h) => h.id === id) || PLAYABLE_HEROES[0];
}

function loadSavedHero() {
  try {
    const saved = window.localStorage.getItem(HERO_STORAGE_KEY);
    if (saved) activeHeroId = getHeroById(saved).id;
  } catch (e) {
    // localStorage may be blocked.
  }
}

function saveHero(id) {
  try { window.localStorage.setItem(HERO_STORAGE_KEY, id); } catch (e) {}
}

function setActiveHero(id) {
  const h = getHeroById(id);
  activeHeroId = h.id;
  saveHero(activeHeroId);
  return h;
}

function getActiveHero() {
  return getHeroById(activeHeroId);
}

const ENEMIES = [
  {
    name: "Rival Mage",
    types: /** @type {MagicType[]} */ (["Fire", "Sight"]),
    maxHp: 22,
    healCharges: 2,
    profile: "fireSight",
    sprite: "./assets/images/enemy-blue.webp",
  },
  {
    name: "Stonebound Seer",
    types: /** @type {MagicType[]} */ (["Earth", "Touch"]),
    maxHp: 28,
    healCharges: 2,
    profile: "earthTouch",
    sprite: "./assets/images/enemy-blonde.webp",
  },
  {
    name: "Inkward Scribe",
    types: /** @type {MagicType[]} */ (["Sound", "Touch"]),
    maxHp: 25,
    healCharges: 1,
    profile: "soundTouch",
    sprite: "./assets/images/enemy-scribe.webp",
  },
  {
    name: "Tidehand Alchemist",
    types: /** @type {MagicType[]} */ (["Touch", "Water"]),
    maxHp: 27,
    healCharges: 1,
    profile: "waterTouch",
    sprite: "./assets/images/enemy-tidehand.webp",
    spriteIsPixel: false,
  },

  {
    name: "Chorusflame Knight",
    types: /** @type {MagicType[]} */ (["Sound", "Fire"]),
    maxHp: 31,
    healCharges: 1,
    profile: "soundFire",
    sprite: "./assets/images/enemy-chorusflame.webp",
    spriteIsPixel: false,
  },

  {
    name: "Ravenwind Oracle",
    types: /** @type {MagicType[]} */ (["Sight", "Wind"]),
    maxHp: 26,
    healCharges: 1,
    profile: "windSight",
    sprite: "./assets/images/enemy-ravenwind.webp",
    spriteIsPixel: false,
  },

  {
    name: "Verdant Scentwarden",
    types: /** @type {MagicType[]} */ (["SmellTaste", "Earth"]),
    maxHp: 28,
    healCharges: 1,
    profile: "smellEarth",
    sprite: "./assets/images/enemy-verdant-mender.webp",
    spriteIsPixel: false,
  },

  {
    name: "Iron Champion",
    types: /** @type {MagicType[]} */ (["Earth", "Touch"]),
    maxHp: 40,
    healCharges: 2,
    focusMax: 7,
    focusStart: 3,
    profile: "earthTouch",
    sprite: "./assets/images/enemy-blonde.webp",
  },
  {
    name: "Gilded Broker",
    types: /** @type {MagicType[]} */ (["Sound", "Touch"]),
    maxHp: 38,
    healCharges: 2,
    focusMax: 7,
    focusStart: 3,
    profile: "soundTouch",
    sprite: "./assets/images/enemy-scribe.webp",
  },
  {
    name: "Thorn Regent",
    types: /** @type {MagicType[]} */ (["SmellTaste", "Earth"]),
    maxHp: 39,
    healCharges: 2,
    focusMax: 7,
    focusStart: 3,
    profile: "smellEarth",
    sprite: "./assets/images/enemy-verdant-mender.webp",
    spriteIsPixel: false,
  },
  {
    name: "Shard Warden",
    types: /** @type {MagicType[]} */ (["Sight", "Touch"]),
    maxHp: 39,
    healCharges: 2,
    focusMax: 7,
    focusStart: 3,
    profile: "mirrorTouch",
    sprite: "./assets/images/enemy-candle-queen.webp",
  },
  {
    name: "Corrupted Regent",
    types: /** @type {MagicType[]} */ (["Sight", "Sound"]),
    maxHp: 48,
    healCharges: 3,
    focusMax: 8,
    focusStart: 4,
    profile: "bossEclipse",
    sprite: "./assets/images/enemy-candle-queen.webp",
  },

  {
    name: "Candlecrown Matron",
    types: /** @type {MagicType[]} */ (["Sight", "Sound"]),
    maxHp: 36,
    healCharges: 2,
    focusMax: 7,
    focusStart: 3,
    profile: "bossEclipse",
    sprite: "./assets/images/enemy-candle-queen.webp",
  },
];


// --- Random encounter system (not tied to locations) ---
// Non-boss enemies are chosen per-wave.
// As of this build: Wave 1 and Wave 2 are uniform-random across all non-boss enemies
// (equal chance per enemy per wave). Wave 3 is always a boss.
const BOSS_ENEMY_INDEX = Math.max(0, ENEMIES.findIndex((e) => e.name === "Iron Champion"));
const VERDANT_ENEMY_INDEX = Math.max(0, ENEMIES.findIndex((e) => e.profile === "smellEarth"));

const NON_BOSS_ENEMY_INDICES = ENEMIES.map((_, i) => i).filter((i) => !isBossEnemyIndex(i) && !HIDDEN_LEGACY_ENEMY_NAMES.has(String(ENEMIES[i]?.name || '')));

/**
 * Rough difficulty score for weighting.
 * (Higher means tougher.)
 */
function enemyDifficultyScore(tpl) {
  const hp = toSafeInt(tpl.maxHp, 20);
  const heals = toSafeInt(tpl.healCharges, 0);
  const focusMax = typeof tpl.focusMax === "number" ? tpl.focusMax : 6;
  // HP is the main signal; healing and extra focus add endurance.
  return hp + heals * 6 + Math.max(0, focusMax - 6) * 2;
}

/**
 * Weighted random choice.
 * @param {number[]} indices
 * @param {number[]} weights
 */
function weightedPick(indices, weights) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += Math.max(0, weights[i] || 0);
  if (total <= 0) return indices[0];

  let r = Math.random() * total;
  for (let i = 0; i < indices.length; i++) {
    r -= Math.max(0, weights[i] || 0);
    if (r <= 0) return indices[i];
  }
  return indices[indices.length - 1];
}

const NON_BOSS_SORTED = [...NON_BOSS_ENEMY_INDICES]
  .map((i) => ({ i, s: enemyDifficultyScore(ENEMIES[i]) }))
  .sort((a, b) => a.s - b.s);

// (Legacy weighting retained for potential future tuning; not used while uniform waves are enabled.)
// Stronger contrast so wave 2 feels meaningfully tougher on average.
const WAVE1_WEIGHTS_BY_RANK = [10, 6, 3, 1];
const WAVE2_WEIGHTS_BY_RANK = [1, 3, 6, 9];

function pickRandomEnemyIndexForWave(waveIndex) {
  // Equal chance per non-boss enemy on waves 1-2.
  // Wave 3 is always boss elsewhere.
  const pool = NON_BOSS_ENEMY_INDICES;
  if (!pool.length) return 0;
  const pick = Math.floor(Math.random() * pool.length);
  return pool[clamp(pick, 0, pool.length - 1)];
}

/**
 * Build a three-wave "enemy set" for one battle run.
 * @param {number} playerLevel
 */
function buildEnemySetForBattle(playerLevel) {
  const pLvl = Math.max(1, toSafeInt(playerLevel, 1));
  const w1i = pickRandomEnemyIndexForWave(0);

  // Wave 2: also uniform-random (independent of wave 1).
  // Repeats are allowed (and do not skew equal per-wave odds).
  const w2i = pickRandomEnemyIndexForWave(1);

  // Wave 3 is always the boss template.
  return [ENEMIES[w1i], ENEMIES[w2i], ENEMIES[BOSS_ENEMY_INDEX]];
}

const FALLBACK_LOCATIONS = [
  { id: "ember_plaza", name: "Ember Plaza", subtitle: "Warm stones. Hot tempers.", enemySet: [0, 1, BOSS_ENEMY_INDEX] },
  { id: "quartz_library", name: "Quartz Library", subtitle: "Quiet halls. Heavy secrets.", enemySet: [1, 2, BOSS_ENEMY_INDEX] },
  { id: "gale_rooftops", name: "Gale Rooftops", subtitle: "Open sky. Unstable footing.", enemySet: [0, 2, BOSS_ENEMY_INDEX] },
  { id: "mirror_tunnels", name: "Mirror Tunnels", subtitle: "Dim lights. Echoing steps.", enemySet: [0, 1, BOSS_ENEMY_INDEX] },
];


// Locations in-game are sourced from the Map dataset (data/map-locations.js) when available.
// This keeps the RPG in sync with the site's world map.
const GAME_LOCATION_IDS = ["arena", "market-central", "fey-forest", "gutterglass"];
const ARENA_BOSS_ENEMY_INDEX = ENEMIES.findIndex((e) => e.name === "Iron Champion");
const MARKET_BOSS_ENEMY_INDEX = ENEMIES.findIndex((e) => e.name === "Gilded Broker");
const FEY_BOSS_ENEMY_INDEX = ENEMIES.findIndex((e) => e.name === "Thorn Regent");
const GUTTERGLASS_BOSS_ENEMY_INDEX = ENEMIES.findIndex((e) => e.name === "Shard Warden");
const FINAL_BOSS_ENEMY_INDEX = ENEMIES.findIndex((e) => e.name === "Corrupted Regent");
const LOCATION_ENEMY_SETS_BY_ID = {
  "arena": [0, 1, ARENA_BOSS_ENEMY_INDEX],
  "market-central": [2, 4, MARKET_BOSS_ENEMY_INDEX],
  "fey-forest": [VERDANT_ENEMY_INDEX, 3, FEY_BOSS_ENEMY_INDEX],
  "gutterglass": [5, 2, GUTTERGLASS_BOSS_ENEMY_INDEX],
  [FINAL_LOCATION_ID]: [ARENA_BOSS_ENEMY_INDEX, GUTTERGLASS_BOSS_ENEMY_INDEX, FINAL_BOSS_ENEMY_INDEX],
};


function buildLocationsFromMap() {
  const data = window.MAP_LOCATIONS_DATA;
  if (!data || !Array.isArray(data.locations)) return null;

  const byId = new Map(data.locations.map((l) => [l.id, l]));
  const picks = GAME_LOCATION_IDS.map((id) => byId.get(id)).filter(Boolean);

  // If any IDs are missing, fall back to the first few map locations to avoid an empty picker.
  const finalPicks = picks.length ? picks : data.locations.slice(0, GAME_LOCATION_IDS.length);
  if (!finalPicks.length) return null;

  const base = finalPicks.slice(0, GAME_LOCATION_IDS.length).map((l) => ({
    id: l.id,
    name: l.title || l.id,
    subtitle: l.blurb || "",
    href: l.href || "",
    enemySet: LOCATION_ENEMY_SETS_BY_ID[l.id] || [0, 1, BOSS_ENEMY_INDEX],
  }));

  base.push({
    id: FINAL_LOCATION_ID,
    name: "Palace",
    subtitle: "The sealed royal heart of the city. It opens when all four artifacts return.",
    href: "",
    enemySet: LOCATION_ENEMY_SETS_BY_ID[FINAL_LOCATION_ID],
  });

  return base;
}

const LOCATIONS = buildLocationsFromMap() || [...FALLBACK_LOCATIONS, { id: FINAL_LOCATION_ID, name: "Palace", subtitle: "The sealed royal heart of the city.", enemySet: LOCATION_ENEMY_SETS_BY_ID[FINAL_LOCATION_ID] }];
// Unique boss relic per area (awarded on first boss clear per hero).
const BOSS_UNIQUE_GEAR_BY_LOCATION = /** @type {Record<string, string>} */ ({
  // Map-sourced game locations
  "arena": "arena_victor_blade",
  "market-central": "market_ledger_mail",
  "fey-forest": "feyleaf_circlet",
  "gutterglass": "gutterglass_prism",

  // Fallback locations (in case map data isn't present)
  "ember_plaza": "arena_victor_blade",
  "quartz_library": "feyleaf_circlet",
  "gale_rooftops": "gutterglass_prism",
  "mirror_tunnels": "market_ledger_mail",
});


/** @type {string|null} */
let activeLocationId = null;

/** @type {typeof ENEMIES} */
let activeEnemySet = [ENEMIES[0], ENEMIES[1], ENEMIES[BOSS_ENEMY_INDEX]];

function getLocationById(id) {
  return LOCATIONS.find((l) => l.id === id) || LOCATIONS[0];
}

function setActiveLocation(id) {
  const loc = getLocationById(id);
  activeLocationId = loc.id;
  return loc;
}

const LOCATION_APPROACH_SCENES = {
  "arena": {
    theme: "arena",
    blurb: "Cross the open practice yard, dip into side lanes, and raid the prep alcoves before you hit the arena gate.",
    tileSize: 72,
    skirmishField: { col: 11, row: 1, cols: 4, rows: 6, chance: 0.16, label: "Practice Switches" },
    layout: [
      "#####################",
      "#..c......#.........#",
      "#.S...#...#.........#",
      "#.....#.J.#.........#",
      "#..a..#...#.........#",
      "#.....#.......####..#",
      "#.....#.......#..#..#",
      "#.............#..#..#",
      "#..###....#.....I#..#",
      "#.........#...#..#..#",
      "#...K.....#...#..#..#",
      "#.......b.#...####..#",
      "#.........#.......G.#",
      "#..............d....#",
      "#####################",
    ],
    interactables: [
      {
        marker: "I", cls: "dummy", label: "Training Dummy", actionLabel: "Practice", radiusPct: 8,
        effect: { damageBoost: 1.22 },
        mazePuzzle: {
          hint: 'Find the two sparring sigils to lift the dummy-room seal. You can activate them in either order.',
          solvedText: 'The dummy alcove rumbles open.',
          lockedText: 'A sealed training wall blocks the dummy alcove. Find the sparring sigils.',
          steps: [
            { marker: 'a', label: 'West Sparring Sigil' },
            { marker: 'b', label: 'East Sparring Sigil' },
          ],
          wallTiles: [{ col: 14, row: 8 }],
        },
        foundText: "You run a fast form drill. Your next big hit is tighter and meaner.",
      },
      {
        marker: "J", cls: "rack", label: "Weapon Rack", actionLabel: "Sharpen", radiusPct: 8,
        effect: { focus: 1 },
        mazePuzzle: {
          hint: 'Trace the rack sigil to unbar the weapon lane.',
          solvedText: 'The rack lane unbars with a metallic snap.',
          lockedText: 'A training latch bars the weapon rack lane. Find the rack sigil.',
          steps: [
            { marker: 'c', label: 'Rack Sigil' },
          ],
          wallTiles: [{ col: 7, row: 3 }],
        },
        foundText: "A balanced edge settles your stance. Start battle with +1 mana.",
      },
      {
        marker: "K", cls: "medkit", label: "Field Kit", actionLabel: "Patch Up", radiusPct: 8,
        effect: { heal: 8 },
        mazePuzzle: {
          hint: 'Light the medic sigil to swing open the field-kit barrier.',
          solvedText: 'The field-kit barrier folds aside.',
          lockedText: 'A folding barrier keeps the field kit shut away. Find the medic sigil.',
          steps: [
            { marker: 'd', label: 'Medic Sigil' },
          ],
          wallTiles: [{ col: 4, row: 11 }],
        },
        foundText: "A fast wrap and tonic take the sting off. Start battle with extra health.",
      },
    ],
    props: [
      { col: 6, row: 1, colSpan: 1, rowSpan: 12, cls: "pillar", solid: false },
      { col: 13, row: 1, colSpan: 1, rowSpan: 12, cls: "pillar", solid: false },
      { col: 3, row: 5, colSpan: 2, rowSpan: 1, cls: "crate", solid: false },
      { col: 9, row: 7, colSpan: 3, rowSpan: 1, cls: "barricade", solid: false },
      { col: 16, row: 3, colSpan: 2, rowSpan: 1, cls: "rack", solid: false },
      { col: 18, row: 11, colSpan: 1, rowSpan: 2, cls: "banner", solid: false },
      { col: 10, row: 13, colSpan: 1, rowSpan: 1, cls: "medkit", solid: false },
    ],
  },
  "market-central": {
    theme: "market",
    blurb: "Wander the broad bazaar floor, slip into side alleys, and cut through a few stall branches before the market gate.",
    tileSize: 70,
    skirmishField: { col: 5, row: 8, cols: 4, rows: 6, chance: 0.16, label: "Bazaar Switches" },
    layout: [
      "#####################",
      "#....#....c.........#",
      "#.S..#.a.....#......#",
      "#..J.#.....K.#......#",
      "#....#...#...#.####.#",
      "#....#...#...#.#..#.#",
      "#........#...#..I.#.#",
      "#........#...#.#..#.#",
      "#..####..#.....####.#",
      "#........#.....#....#",
      "#........#.b...#....#",
      "#.d......#.....#....#",
      "#..............#..G.#",
      "#...................#",
      "#####################",
    ],
    interactables: [
      {
        marker: "I", cls: "vendor", label: "Spice Stall", actionLabel: "Browse", radiusPct: 8,
        effect: { focus: 1, barrier: 1 },
        mazePuzzle: {
          hint: 'Wake both stall sigils to slide open the shuttered stall lane. Either order works.',
          solvedText: 'A shuttered lane slides aside near the spice stall.',
          lockedText: 'The spice stall is tucked behind a shuttered lane. Find the market sigils.',
          steps: [
            { marker: 'a', label: 'Ledger Sigil' },
            { marker: 'b', label: 'Coin Sigil' },
          ],
          wallTiles: [{ col: 15, row: 6 }],
        },
        foundText: "A quick tonic clears your head and throws a ward over your shoulders.",
      },
      {
        marker: "J", cls: "coinpile", label: "Lucky Purse", actionLabel: "Pocket", radiusPct: 8,
        effect: { damageBoost: 1.14 },
        mazePuzzle: {
          hint: 'Tap the purse sigil to pop the coin latch.',
          solvedText: 'The purse latch clicks open.',
          lockedText: 'A little market latch keeps the lucky purse tucked away. Find the purse sigil.',
          steps: [
            { marker: 'c', label: 'Purse Sigil' },
          ],
          wallTiles: [{ col: 4, row: 3 }],
        },
        foundText: "A lucky glint boosts your nerve. Your opening strike will carry more bite.",
      },
      {
        marker: "K", cls: "stall", label: "Street Tonic", actionLabel: "Sip", radiusPct: 8,
        effect: { heal: 6 },
        mazePuzzle: {
          hint: 'Wake the tonic sigil to slide back the stall screen.',
          solvedText: 'A narrow stall screen rolls away near the tonic.',
          lockedText: 'A cloth screen hides the street tonic. Find the tonic sigil.',
          steps: [
            { marker: 'd', label: 'Tonic Sigil' },
          ],
          wallTiles: [{ col: 10, row: 3 }],
        },
        foundText: "A sharp little tonic puts color back in your blood.",
      },
    ],
    props: [
      { col: 6, row: 1, colSpan: 1, rowSpan: 12, cls: "stall", solid: false },
      { col: 13, row: 1, colSpan: 1, rowSpan: 12, cls: "stall", solid: false },
      { col: 3, row: 5, colSpan: 2, rowSpan: 1, cls: "cart", solid: false },
      { col: 16, row: 4, colSpan: 1, rowSpan: 2, cls: "lamp", solid: false },
      { col: 9, row: 8, colSpan: 2, rowSpan: 1, cls: "fountain", solid: false },
      { col: 10, row: 13, colSpan: 1, rowSpan: 1, cls: "coinpile", solid: false },
    ],
  },
  "fey-forest": {
    theme: "forest",
    blurb: "Move through the open glade, veer into shrine hollows, and branch around the overgrowth before the thorn arch.",
    tileSize: 72,
    skirmishField: { col: 11, row: 1, cols: 4, rows: 6, chance: 0.15, label: "Fey Switch Grove" },
    layout: [
      "#####################",
      "#.......#......####.#",
      "#...#...#......#..#.#",
      "#...#.a.#........J#.#",
      "#...#...#......#..#.#",
      "#...#...#......####.#",
      "#...#..........c....#",
      "#.........b.........#",
      "#...........#.......#",
      "#..I........#.......#",
      "#.....K.....#..####.#",
      "#....d......#.......#",
      "#.S.........#.....G.#",
      "#...................#",
      "#####################",
    ],
    interactables: [
      {
        marker: "I", cls: "flower", label: "Moonbloom", actionLabel: "Gather", radiusPct: 8,
        effect: { heal: 6, focus: 1 },
        mazePuzzle: {
          hint: 'Wake the bloom sigil to part the leaves around the moonbloom patch.',
          solvedText: 'The leaves peel back around the moonbloom.',
          lockedText: 'Thick leaves smother the moonbloom patch. Find the bloom sigil.',
          steps: [
            { marker: 'c', label: 'Bloom Sigil' },
          ],
          wallTiles: [{ col: 3, row: 8 }],
        },
        foundText: "The moonbloom steadies your pulse and clears the static from your thoughts.",
      },
      {
        marker: "J", cls: "shrine", label: "Root Shrine", actionLabel: "Pray", radiusPct: 8,
        effect: { barrier: 1 },
        mazePuzzle: {
          hint: 'Answer the hidden root sigils to peel back the briar wall around the shrine.',
          solvedText: 'The briars unwind and expose the root shrine path.',
          lockedText: 'Briars knot around the shrine hollow. Find the root sigils.',
          steps: [
            { marker: 'a', label: 'Moss Sigil' },
            { marker: 'b', label: 'Thorn Sigil' },
          ],
          wallTiles: [{ col: 15, row: 3 }],
        },
        foundText: "Old bark-light folds around you. Start battle with a barrier.",
      },
      {
        marker: "K", cls: "cache", label: "Hunter's Cache", actionLabel: "Open", radiusPct: 8,
        effect: { damageBoost: 1.16 },
        mazePuzzle: {
          hint: 'Touch the hunter sigil to pull back the cache briars.',
          solvedText: 'The cache briars loosen and sag away.',
          lockedText: 'A knot of briars hides the hunter\'s cache. Find the hunter sigil.',
          steps: [
            { marker: 'd', label: 'Hunter Sigil' },
          ],
          wallTiles: [{ col: 5, row: 11 }],
        },
        foundText: "A tucked-away charm sharpens your opening attack.",
      },
    ],
    props: [
      { col: 5, row: 1, colSpan: 1, rowSpan: 12, cls: "tree", solid: false },
      { col: 11, row: 3, colSpan: 1, rowSpan: 10, cls: "roots", solid: false },
      { col: 15, row: 4, colSpan: 2, rowSpan: 1, cls: "bramble", solid: false },
      { col: 3, row: 9, colSpan: 1, rowSpan: 1, cls: "shrine", solid: false },
      { col: 10, row: 13, colSpan: 1, rowSpan: 1, cls: "mushroom", solid: false },
    ],
  },
  "gutterglass": {
    theme: "gutterglass",
    blurb: "Pick through the central basin, duck down service spurs, and work the crystal branches before the shard gate.",
    tileSize: 70,
    skirmishField: { col: 9, row: 8, cols: 4, rows: 6, chance: 0.16, label: "Shard Switch Field" },
    layout: [
      "#####################",
      "#........#.....c....#",
      "#.S..#...#......#...#",
      "#....#...#.b....#...#",
      "#....#...#......#...#",
      "#....#...#......#...#",
      "#....#.....I...####.#",
      "#..............#..#.#",
      "#..#####.....#...J#.#",
      "#..d.........#.#..#.#",
      "#......K.....#.####.#",
      "#..a.........#......#",
      "#............#....G.#",
      "#...................#",
      "#####################",
    ],
    interactables: [
      {
        marker: "I", cls: "mirror", label: "Cracked Mirror", actionLabel: "Peer In", radiusPct: 8,
        effect: { barrier: 1, damageBoost: 1.12 },
        mazePuzzle: {
          hint: 'Wake the mirror sigil to crack open the glass seam.',
          solvedText: 'The glass seam splits and the mirror lane opens.',
          lockedText: 'A glass seam blocks the cracked mirror. Find the mirror sigil.',
          steps: [
            { marker: 'c', label: 'Mirror Sigil' },
          ],
          wallTiles: [{ col: 10, row: 6 }],
        },
        foundText: "A reflected path flickers through the glass. You leave with a ward and a sharpened first blow.",
      },
      {
        marker: "J", cls: "valve", label: "Pressure Valve", actionLabel: "Turn", radiusPct: 8,
        effect: { focus: 2 },
        mazePuzzle: {
          hint: 'Prime the sewer sigils to unlock the pressure-valve side chamber.',
          solvedText: 'Metal bolts slam back and the valve chamber opens.',
          lockedText: 'The pressure valve sits behind a locked service seam. Find the sewer sigils.',
          steps: [
            { marker: 'a', label: 'Steam Sigil' },
            { marker: 'b', label: 'Drain Sigil' },
          ],
          wallTiles: [{ col: 15, row: 8 }],
        },
        foundText: "Steam hisses loose and your thoughts click into place. Start battle with +2 mana.",
      },
      {
        marker: "K", cls: "crystal", label: "Shard Cache", actionLabel: "Chip", radiusPct: 8,
        effect: { heal: 5 },
        mazePuzzle: {
          hint: 'Charge the shard sigil to roll away the crystal lip.',
          solvedText: 'A crystal lip fractures and exposes the shard cache.',
          lockedText: 'A crystal lip blocks the shard cache. Find the shard sigil.',
          steps: [
            { marker: 'd', label: 'Shard Sigil' },
          ],
          wallTiles: [{ col: 6, row: 10 }],
        },
        foundText: "You pocket a resonant shard and shake off some pain.",
      },
    ],
    props: [
      { col: 6, row: 1, colSpan: 1, rowSpan: 12, cls: "pipe", solid: false },
      { col: 13, row: 1, colSpan: 1, rowSpan: 12, cls: "crystal", solid: false },
      { col: 3, row: 9, colSpan: 2, rowSpan: 1, cls: "glassbank", solid: false },
      { col: 16, row: 4, colSpan: 2, rowSpan: 1, cls: "glassbank", solid: false },
      { col: 10, row: 13, colSpan: 1, rowSpan: 1, cls: "valve", solid: false },
    ],
  },
  "palace": {
    theme: "palace",
    blurb: "Cross the open forecourt, explore the side courts, and branch through the royal grounds before the sealed gate.",
    tileSize: 72,
    skirmishField: { col: 11, row: 8, cols: 4, rows: 6, chance: 0.14, label: "Royal Switch Court" },
    layout: [
      "#####################",
      "#..............c....#",
      "#.S...#......#......#",
      "#.....#.aJ...#......#",
      "#.....#......#......#",
      "#.....#......#.####.#",
      "#.....#......#.#..#.#",
      "#................I#.#",
      "#..#####..#....#..#.#",
      "#..d......#....####.#",
      "#.........#....#....#",
      "#..K....b.#....#....#",
      "#.........#....#..G.#",
      "#...................#",
      "#####################",
    ],
    interactables: [
      {
        marker: "I", cls: "brazier", label: "Ward Brazier", actionLabel: "Kindle", radiusPct: 8,
        effect: { focus: 2, barrier: 1 },
        mazePuzzle: {
          hint: 'Kindle both royal sigils to unseal the brazier alcove. Either order works.',
          solvedText: 'A royal ward slides aside and reveals the brazier alcove.',
          lockedText: 'A royal ward seals the brazier alcove. Find the palace sigils.',
          steps: [
            { marker: 'a', label: 'West Court Sigil' },
            { marker: 'b', label: 'East Court Sigil' },
          ],
          wallTiles: [{ col: 15, row: 7 }],
        },
        foundText: "Royal embers gather around you. Start battle with +2 mana and a barrier.",
      },
      {
        marker: "J", cls: "fountain", label: "Royal Fountain", actionLabel: "Drink", radiusPct: 8,
        effect: { heal: 8 },
        mazePuzzle: {
          hint: 'Touch the fountain sigil to part the court rail around the spring.',
          solvedText: 'The court rail swings open around the fountain.',
          lockedText: 'A court rail blocks the royal fountain. Find the fountain sigil.',
          steps: [
            { marker: 'c', label: 'Fountain Sigil' },
          ],
          wallTiles: [{ col: 8, row: 3 }],
        },
        foundText: "Cold palace water steadies your nerves and patches some wear.",
      },
      {
        marker: "K", cls: "banner", label: "War Table", actionLabel: "Study", radiusPct: 8,
        effect: { damageBoost: 1.18 },
        mazePuzzle: {
          hint: 'Wake the strategy sigil to roll back the velvet cord around the war table.',
          solvedText: 'The velvet cord draws back from the war table.',
          lockedText: 'A velvet cord keeps the war table sealed off. Find the strategy sigil.',
          steps: [
            { marker: 'd', label: 'Strategy Sigil' },
          ],
          wallTiles: [{ col: 4, row: 11 }],
        },
        foundText: "A final glance at old battle routes sharpens your opening plan.",
      },
    ],
    props: [
      { col: 6, row: 1, colSpan: 1, rowSpan: 12, cls: "hedge", solid: false },
      { col: 13, row: 1, colSpan: 1, rowSpan: 12, cls: "hedge", solid: false },
      { col: 3, row: 4, colSpan: 1, rowSpan: 2, cls: "statue", solid: false },
      { col: 16, row: 4, colSpan: 1, rowSpan: 2, cls: "statue", solid: false },
      { col: 10, row: 13, colSpan: 1, rowSpan: 1, cls: "fountain", solid: false },
      { col: 18, row: 11, colSpan: 1, rowSpan: 2, cls: "banner", solid: false },
    ],
  },
  "default": {
    theme: "generic",
    blurb: "Scout an open approach zone, check a few side paths, and reach the encounter gate.",
    tileSize: 70,
    skirmishField: { col: 11, row: 8, cols: 4, rows: 6, chance: 0.16, label: "Skirmish Switches" },
    layout: [
      "#####################",
      "#S.a....#......#....#",
      "#.......#......#....#",
      "#..J....#..I...#....#",
      "#.......#......#....#",
      "#....####......####.#",
      "#.........b.........#",
      "#..###......###.....#",
      "#..#....K...#.......#",
      "#..#........#.......#",
      "#..#........#.......#",
      "#..####..####.......#",
      "#.................G.#",
      "#....c..............#",
      "#####################",
    ],
    interactables: [
      {
        marker: "I", cls: "cache", label: "Supply Cache", actionLabel: "Open", radiusPct: 8,
        effect: { focus: 1 },
        mazePuzzle: {
          hint: 'Touch the cache sigil to unlatch the supply nook.',
          solvedText: 'The supply nook unlatches with a small click.',
          lockedText: 'A latch bars the supply cache. Find the cache sigil.',
          steps: [
            { marker: 'a', label: 'Cache Sigil' },
          ],
          wallTiles: [{ col: 10, row: 3 }],
        },
        foundText: "You pocket a useful trinket. Start battle with +1 mana.",
      },
      {
        marker: "J", cls: "medkit", label: "Field Bandage", actionLabel: "Use", radiusPct: 8,
        effect: { heal: 5 },
        mazePuzzle: {
          hint: 'Light the bandage sigil to swing open the medic partition.',
          solvedText: 'The medic partition folds away.',
          lockedText: 'A medic partition blocks the field bandage. Find the bandage sigil.',
          steps: [
            { marker: 'b', label: 'Bandage Sigil' },
          ],
          wallTiles: [{ col: 3, row: 4 }],
        },
        foundText: "A quick patch job helps take the edge off.",
      },
      {
        marker: "K", cls: "mirror", label: "Scout Mirror", actionLabel: "Check", radiusPct: 8,
        effect: { damageBoost: 1.12 },
        mazePuzzle: {
          hint: 'Touch the scout sigil to slide back the mirror panel.',
          solvedText: 'The mirror panel slides aside.',
          lockedText: 'A small panel blocks the scout mirror. Find the scout sigil.',
          steps: [
            { marker: 'c', label: 'Scout Sigil' },
          ],
          wallTiles: [{ col: 7, row: 8 }],
        },
        foundText: "You catch a better angle on the coming fight.",
      },
    ],
    props: [
      { col: 5, row: 1, colSpan: 1, rowSpan: 8, cls: "crate", solid: false },
      { col: 11, row: 1, colSpan: 1, rowSpan: 8, cls: "barricade", solid: false },
    ],
  },
};

function normalizeApproachLayout(layout) {
  if (!Array.isArray(layout) || !layout.length) return null;
  const rows = layout.map((row) => String(row || ''));
  const cols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => row.padEnd(cols, '#'));
}

function getApproachLayoutMarkers(layoutRows) {
  if (!Array.isArray(layoutRows) || !layoutRows.length) return null;
  const markers = { interactables: Object.create(null), puzzleNodes: Object.create(null) };
  for (let row = 0; row < layoutRows.length; row += 1) {
    const line = String(layoutRows[row] || '');
    for (let col = 0; col < line.length; col += 1) {
      const ch = line[col];
      if (ch === 'S' && !markers.spawn) markers.spawn = { col, row };
      else if (ch === 'G' && !markers.gate) markers.gate = { col, row };
      else if (/[A-Z0-9]/.test(ch) && ch !== 'S' && ch !== 'G') markers.interactables[ch] = { col, row };
      else if (/[a-z]/.test(ch)) markers.puzzleNodes[ch] = { col, row };
    }
  }
  return markers;
}

function approachTileRectToPct(prop, cols, rows) {
  const col = clamp(Math.round(toSafeNum(prop?.col, 0)), 0, Math.max(0, cols - 1));
  const row = clamp(Math.round(toSafeNum(prop?.row, 0)), 0, Math.max(0, rows - 1));
  const colSpan = Math.max(1, Math.round(toSafeNum(prop?.colSpan, 1)));
  const rowSpan = Math.max(1, Math.round(toSafeNum(prop?.rowSpan, 1)));
  return {
    xPct: (col / Math.max(1, cols)) * 100,
    yPct: (row / Math.max(1, rows)) * 100,
    wPct: (colSpan / Math.max(1, cols)) * 100,
    hPct: (rowSpan / Math.max(1, rows)) * 100,
  };
}

function getApproachScene(locationId) {
  const src = LOCATION_APPROACH_SCENES[locationId] || LOCATION_APPROACH_SCENES.default;
  const layout = normalizeApproachLayout(src.layout);
  const layoutMarkers = getApproachLayoutMarkers(layout);
  const layoutCols = layout?.[0]?.length || 0;
  const layoutRows = layout?.length || 0;
  const gridCols = layoutCols || Math.round(toSafeNum(src.grid?.cols, APPROACH_GRID_DEFAULTS.cols));
  const gridRows = layoutRows || Math.round(toSafeNum(src.grid?.rows, APPROACH_GRID_DEFAULTS.rows));
  const tileToPct = (col, row) => ({
    xPct: ((clamp(Math.round(col), 0, Math.max(0, gridCols - 1)) + 0.5) / Math.max(1, gridCols)) * 100,
    yPct: ((clamp(Math.round(row), 0, Math.max(0, gridRows - 1)) + 0.5) / Math.max(1, gridRows)) * 100,
  });
  const spawnPos = layoutMarkers?.spawn ? tileToPct(layoutMarkers.spawn.col, layoutMarkers.spawn.row) : { xPct: toSafeNum(src.spawn?.xPct, 12), yPct: toSafeNum(src.spawn?.yPct, 74) };
  const gatePos = layoutMarkers?.gate ? tileToPct(layoutMarkers.gate.col, layoutMarkers.gate.row) : { xPct: toSafeNum(src.gate?.xPct, 86), yPct: toSafeNum(src.gate?.yPct, 50) };
  const legacyInteractables = src.interactable ? [{ ...src.interactable, marker: String(src.interactable?.marker || 'I') }] : [];
  const sourceInteractables = Array.isArray(src.interactables) && src.interactables.length ? src.interactables : legacyInteractables;
  const interactables = sourceInteractables.map((item, idx) => {
    const marker = String(item?.marker || String.fromCharCode(73 + idx));
    const markerPos = layoutMarkers?.interactables?.[marker] || null;
    const id = String(item?.id || marker.toLowerCase());
    const mazePuzzle = item?.mazePuzzle ? {
      hint: String(item?.mazePuzzle?.hint || ''),
      solvedText: String(item?.mazePuzzle?.solvedText || ''),
      lockedText: String(item?.mazePuzzle?.lockedText || ''),
      steps: (Array.isArray(item?.mazePuzzle?.steps) ? item.mazePuzzle.steps : []).map((step, stepIdx) => {
        const stepMarker = String(step?.marker || String.fromCharCode(97 + stepIdx));
        const nodePos = layoutMarkers?.puzzleNodes?.[stepMarker] || null;
        const pct = nodePos ? tileToPct(nodePos.col, nodePos.row) : { xPct: toSafeNum(step?.xPct, 20), yPct: toSafeNum(step?.yPct, 70) };
        return {
          id: `${id}-node-${stepMarker}`,
          marker: stepMarker,
          label: String(step?.label || `Rune ${stepIdx + 1}`),
          xPct: pct.xPct,
          yPct: pct.yPct,
          col: nodePos?.col ?? approachPctToTile(pct.xPct, pct.yPct, { _gridCache: { cols: gridCols, rows: gridRows } }).col,
          row: nodePos?.row ?? approachPctToTile(pct.xPct, pct.yPct, { _gridCache: { cols: gridCols, rows: gridRows } }).row,
          radiusPct: toSafeNum(step?.radiusPct, 7),
          stepIndex: stepIdx,
        };
      }),
      wallTiles: (Array.isArray(item?.mazePuzzle?.wallTiles) ? item.mazePuzzle.wallTiles : []).map((wall, wallIdx) => ({
        id: `${id}-wall-${wallIdx}`,
        col: clamp(Math.round(toSafeNum(wall?.col, 0)), 0, Math.max(0, gridCols - 1)),
        row: clamp(Math.round(toSafeNum(wall?.row, 0)), 0, Math.max(0, gridRows - 1)),
      })),
    } : null;
    return {
      id,
      marker,
      xPct: markerPos ? tileToPct(markerPos.col, markerPos.row).xPct : toSafeNum(item?.xPct, 20),
      yPct: markerPos ? tileToPct(markerPos.col, markerPos.row).yPct : toSafeNum(item?.yPct, 70),
      wPct: toSafeNum(item?.wPct, Math.max(7, 100 / Math.max(1, gridCols))),
      hPct: toSafeNum(item?.hPct, Math.max(9, 100 / Math.max(1, gridRows))),
      cls: String(item?.cls || 'cache'),
      label: String(item?.label || 'Supply Cache'),
      actionLabel: String(item?.actionLabel || 'Inspect'),
      radiusPct: toSafeNum(item?.radiusPct, 8),
      foundText: String(item?.foundText || 'You found a small edge for the next battle.'),
      mazePuzzle,
      effect: {
        heal: toSafeNum(item?.effect?.heal, 0),
        focus: toSafeNum(item?.effect?.focus, 0),
        barrier: toSafeNum(item?.effect?.barrier, 0),
        damageBoost: toSafeNum(item?.effect?.damageBoost, 0),
      },
    };
  });
  const puzzleNodes = [];
  const puzzleWalls = [];
  interactables.forEach((item) => {
    if (!item?.mazePuzzle) return;
    item.mazePuzzle.steps.forEach((step) => puzzleNodes.push({ ...step, interactableId: item.id, interactableLabel: item.label }));
    item.mazePuzzle.wallTiles.forEach((wall) => puzzleWalls.push({ ...wall, interactableId: item.id, interactableLabel: item.label }));
  });
  const skirmishFields = (Array.isArray(src.skirmishFields) ? src.skirmishFields : (src.skirmishField ? [src.skirmishField] : [])).map((field, fieldIdx) => ({
    id: String(field?.id || `${locationId || 'default'}-field-${fieldIdx + 1}`),
    col: clamp(Math.round(toSafeNum(field?.col, 0)), 0, Math.max(0, gridCols - 1)),
    row: clamp(Math.round(toSafeNum(field?.row, 0)), 0, Math.max(0, gridRows - 1)),
    cols: Math.max(1, Math.round(toSafeNum(field?.cols ?? field?.colSpan, 4))),
    rows: Math.max(1, Math.round(toSafeNum(field?.rows ?? field?.rowSpan, 6))),
    chance: clamp(toSafeNum(field?.chance, APPROACH_SKIRMISH_DEFAULT_CHANCE), 0.03, 1),
    label: String(field?.label || 'Skirmish Switches'),
  }));
  return {
    theme: src.theme,
    blurb: src.blurb,
    tileSize: clamp(Math.round(toSafeNum(src.tileSize, 72)), 52, 92),
    layout,
    layoutMarkers,
    spawn: spawnPos,
    gate: {
      xPct: gatePos.xPct,
      yPct: gatePos.yPct,
      label: String(src.gate?.label || 'Encounter Gate'),
      radiusPct: toSafeNum(src.gate?.radiusPct, 9),
    },
    grid: {
      cols: Math.max(8, Math.round(gridCols || APPROACH_GRID_DEFAULTS.cols)),
      rows: Math.max(6, Math.round(gridRows || APPROACH_GRID_DEFAULTS.rows)),
    },
    interactables,
    puzzleNodes,
    puzzleWalls,
    skirmishFields,
    props: Array.isArray(src.props) ? src.props.map((p) => {
      const rect = ('col' in (p || {})) ? approachTileRectToPct(p, gridCols, gridRows) : {
        xPct: toSafeNum(p?.xPct, 0),
        yPct: toSafeNum(p?.yPct, 0),
        wPct: toSafeNum(p?.wPct, 10),
        hPct: toSafeNum(p?.hPct, 10),
      };
      return {
        ...rect,
        cls: String(p?.cls || 'crate'),
        solid: p?.solid !== false,
      };
    }) : [],
  };
}

const APPROACH_GRID_DEFAULTS = { cols: 12, rows: 8 };

function getApproachGrid(scene = APPROACH.scene) {
  if (!scene) return null;
  if (scene._gridCache) return scene._gridCache;
  const cols = clamp(Math.round(toSafeNum(scene.grid?.cols, APPROACH_GRID_DEFAULTS.cols)), 8, 28);
  const rows = clamp(Math.round(toSafeNum(scene.grid?.rows, APPROACH_GRID_DEFAULTS.rows)), 6, 20);
  const blocked = Array.from({ length: rows }, () => Array(cols).fill(false));
  const cellW = 100 / cols;
  const cellH = 100 / rows;
  const layoutRows = Array.isArray(scene.layout) ? scene.layout : null;
  if (layoutRows?.length) {
    for (let row = 0; row < rows; row += 1) {
      const line = String(layoutRows[row] || '').padEnd(cols, '#');
      for (let col = 0; col < cols; col += 1) {
        const ch = line[col] || '#';
        blocked[row][col] = ch === '#';
      }
    }
  }
  const rectOverlapsTile = (rect, col, row) => {
    const left = col * cellW;
    const top = row * cellH;
    const right = left + cellW;
    const bottom = top + cellH;
    const insetX = cellW * 0.16;
    const insetY = cellH * 0.16;
    const rLeft = rect.xPct + insetX;
    const rTop = rect.yPct + insetY;
    const rRight = (rect.xPct + rect.wPct) - insetX;
    const rBottom = (rect.yPct + rect.hPct) - insetY;
    return rRight > left && rLeft < right && rBottom > top && rTop < bottom;
  };

  scene.props.forEach((prop) => {
    if (!prop?.solid) return;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (rectOverlapsTile(prop, col, row)) blocked[row][col] = true;
      }
    }
  });

  const cache = { cols, rows, cellW, cellH, blocked };
  scene._gridCache = cache;
  return cache;
}


function getApproachMazePuzzleState(interactableId) {
  if (!APPROACH.puzzleStates || typeof APPROACH.puzzleStates !== 'object') APPROACH.puzzleStates = Object.create(null);
  if (!APPROACH.puzzleStates[interactableId]) {
    APPROACH.puzzleStates[interactableId] = { solved: false, progress: 0, activated: Object.create(null) };
  }
  return APPROACH.puzzleStates[interactableId];
}

function isApproachMazePuzzleSolved(interactableId) {
  return !!(interactableId && getApproachMazePuzzleState(interactableId).solved);
}

function getApproachPuzzleNodeById(nodeId, scene = APPROACH.scene) {
  if (!scene || !Array.isArray(scene.puzzleNodes)) return null;
  return scene.puzzleNodes.find((node) => node.id === nodeId) || null;
}

function getApproachPuzzleNodeTile(nodeId, scene = APPROACH.scene) {
  const node = getApproachPuzzleNodeById(nodeId, scene);
  if (!node) return { col: 0, row: 0 };
  return { col: clamp(Math.round(toSafeNum(node.col, 0)), 0, Math.max(0, (scene?.grid?.cols || 1) - 1)), row: clamp(Math.round(toSafeNum(node.row, 0)), 0, Math.max(0, (scene?.grid?.rows || 1) - 1)) };
}

function isApproachPuzzleWallClosedAt(col, row, scene = APPROACH.scene) {
  if (!scene || !Array.isArray(scene.puzzleWalls)) return false;
  return scene.puzzleWalls.some((wall) => wall.col === col && wall.row === row && !isApproachMazePuzzleSolved(wall.interactableId));
}

function approachPctToTile(xPct, yPct, scene = APPROACH.scene) {
  const grid = getApproachGrid(scene);
  if (!grid) return { col: 0, row: 0 };
  const col = clamp(Math.round(((toSafeNum(xPct, 0) / 100) * grid.cols) - 0.5), 0, grid.cols - 1);
  const row = clamp(Math.round(((toSafeNum(yPct, 0) / 100) * grid.rows) - 0.5), 0, grid.rows - 1);
  return { col, row };
}

function approachTileToPct(col, row, scene = APPROACH.scene) {
  const grid = getApproachGrid(scene);
  if (!grid) return { xPct: 50, yPct: 50 };
  return {
    xPct: ((clamp(Math.round(col), 0, grid.cols - 1) + 0.5) / grid.cols) * 100,
    yPct: ((clamp(Math.round(row), 0, grid.rows - 1) + 0.5) / grid.rows) * 100,
  };
}

function isApproachTileWalkable(col, row, scene = APPROACH.scene) {
  const grid = getApproachGrid(scene);
  if (!grid) return false;
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
  if (grid.blocked[row][col]) return false;
  if (isApproachPuzzleWallClosedAt(col, row, scene)) return false;
  return true;
}

function findNearestWalkableApproachTile(start, scene = APPROACH.scene) {
  const grid = getApproachGrid(scene);
  if (!grid) return { col: 0, row: 0 };
  const origin = {
    col: clamp(Math.round(toSafeNum(start?.col, 0)), 0, grid.cols - 1),
    row: clamp(Math.round(toSafeNum(start?.row, 0)), 0, grid.rows - 1),
  };
  if (isApproachTileWalkable(origin.col, origin.row, scene)) return origin;
  const queue = [origin];
  const seen = new Set([`${origin.col},${origin.row}`]);
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  while (queue.length) {
    const cur = queue.shift();
    for (const [dx, dy] of dirs) {
      const next = { col: cur.col + dx, row: cur.row + dy };
      if (next.col < 0 || next.row < 0 || next.col >= grid.cols || next.row >= grid.rows) continue;
      const key = `${next.col},${next.row}`;
      if (seen.has(key)) continue;
      if (isApproachTileWalkable(next.col, next.row, scene)) return next;
      seen.add(key);
      queue.push(next);
    }
  }
  return origin;
}

function getApproachInteractableById(interactableId, scene = APPROACH.scene) {
  if (!scene || !Array.isArray(scene.interactables)) return null;
  if (interactableId == null) return scene.interactables[0] || null;
  return scene.interactables.find((item) => item.id === interactableId || item.marker === interactableId) || null;
}

function getApproachAnchorTile(kind, scene = APPROACH.scene, interactableId = null) {
  const grid = getApproachGrid(scene);
  if (!grid) return { col: 0, row: 0 };
  let cacheKey = '_spawnTile';
  let source = scene.spawn;
  if (kind === 'gate') {
    cacheKey = '_gateTile';
    source = scene.gate;
  } else if (kind === 'interactable') {
    const interactable = getApproachInteractableById(interactableId, scene);
    if (!interactable) return { col: 0, row: 0 };
    if (!scene._interactableTiles) scene._interactableTiles = Object.create(null);
    cacheKey = interactable.id;
    if (scene._interactableTiles[cacheKey]) return scene._interactableTiles[cacheKey];
    source = interactable;
    const tile = findNearestWalkableApproachTile(approachPctToTile(source?.xPct, source?.yPct, scene), scene);
    scene._interactableTiles[cacheKey] = tile;
    return tile;
  }
  if (scene[cacheKey]) return scene[cacheKey];
  const tile = findNearestWalkableApproachTile(approachPctToTile(source?.xPct, source?.yPct, scene), scene);
  scene[cacheKey] = tile;
  return tile;
}

function getApproachTileDistanceToAnchor(kind, scene = APPROACH.scene, interactableId = null) {
  const anchor = getApproachAnchorTile(kind, scene, interactableId);
  return Math.hypot(APPROACH.tileCol - anchor.col, APPROACH.tileRow - anchor.row);
}

function getApproachAnchorRadiusTiles(kind, scene = APPROACH.scene, interactableId = null) {
  const grid = getApproachGrid(scene);
  if (!grid) return 1;
  const source = kind === 'gate'
    ? scene?.gate
    : getApproachInteractableById(interactableId, scene);
  const radiusPct = toSafeNum(source?.radiusPct, 10);
  return Math.max(1, radiusPct / Math.min(grid.cellW, grid.cellH));
}

function setApproachTilePosition(col, row, scene = APPROACH.scene) {
  const tile = findNearestWalkableApproachTile({ col, row }, scene);
  const pos = approachTileToPct(tile.col, tile.row, scene);
  APPROACH.tileCol = tile.col;
  APPROACH.tileRow = tile.row;
  APPROACH.xPct = pos.xPct;
  APPROACH.yPct = pos.yPct;
  return tile;
}

function startApproachMoveToTile(col, row, scene = APPROACH.scene) {
  const tile = findNearestWalkableApproachTile({ col, row }, scene);
  if (!isApproachTileWalkable(tile.col, tile.row, scene)) return false;
  if (tile.col === APPROACH.tileCol && tile.row === APPROACH.tileRow) return false;
  APPROACH.moving = true;
  APPROACH.moveElapsed = 0;
  APPROACH.moveFromX = APPROACH.xPct;
  APPROACH.moveFromY = APPROACH.yPct;
  const pos = approachTileToPct(tile.col, tile.row, scene);
  APPROACH.moveToX = pos.xPct;
  APPROACH.moveToY = pos.yPct;
  APPROACH.moveToCol = tile.col;
  APPROACH.moveToRow = tile.row;
  return true;
}

function findApproachPath(start, goal, scene = APPROACH.scene) {
  const grid = getApproachGrid(scene);
  if (!grid) return [];
  const from = findNearestWalkableApproachTile(start, scene);
  const to = findNearestWalkableApproachTile(goal, scene);
  const startKey = `${from.col},${from.row}`;
  const goalKey = `${to.col},${to.row}`;
  if (startKey === goalKey) return [from];
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  const queue = [from];
  const parents = new Map([[startKey, null]]);
  while (queue.length) {
    const cur = queue.shift();
    for (const [dx, dy] of dirs) {
      const next = { col: cur.col + dx, row: cur.row + dy };
      if (!isApproachTileWalkable(next.col, next.row, scene)) continue;
      const key = `${next.col},${next.row}`;
      if (parents.has(key)) continue;
      parents.set(key, cur);
      if (key === goalKey) {
        const path = [to];
        let cursor = cur;
        while (cursor) {
          path.push(cursor);
          const cKey = `${cursor.col},${cursor.row}`;
          cursor = parents.get(cKey) || null;
        }
        path.reverse();
        return path;
      }
      queue.push(next);
    }
  }
  return [from];
}

function queueApproachPathTo(goalTile, scene = APPROACH.scene) {
  const path = findApproachPath({ col: APPROACH.tileCol, row: APPROACH.tileRow }, goalTile, scene);
  APPROACH.pathTiles = Array.isArray(path) ? path.slice(1) : [];
  const finalTile = APPROACH.pathTiles[APPROACH.pathTiles.length - 1] || findNearestWalkableApproachTile(goalTile, scene);
  const pos = approachTileToPct(finalTile.col, finalTile.row, scene);
  APPROACH.targetX = pos.xPct;
  APPROACH.targetY = pos.yPct;
  ensureLocationApproachAnimation();
}

function attemptApproachStep(dir, scene = APPROACH.scene) {
  const deltas = {
    left: [-1, 0],
    right: [1, 0],
    up: [0, -1],
    down: [0, 1],
  };
  const delta = deltas[dir];
  if (!delta) return false;
  const [dx, dy] = delta;
  const nextCol = APPROACH.tileCol + dx;
  const nextRow = APPROACH.tileRow + dy;
  if (!isApproachTileWalkable(nextCol, nextRow, scene)) return false;
  APPROACH.pathTiles = [];
  APPROACH.targetX = null;
  APPROACH.targetY = null;
  return startApproachMoveToTile(nextCol, nextRow, scene);
}

function getApproachHeldDir() {
  if (APPROACH.preferredDir && APPROACH.keys[APPROACH.preferredDir]) return APPROACH.preferredDir;
  const fallbackOrder = ['up', 'down', 'left', 'right'];
  return fallbackOrder.find((dir) => !!APPROACH.keys[dir]) || null;
}

function getApproachTileGridHtml(scene = APPROACH.scene) {
  const grid = getApproachGrid(scene);
  if (!grid) return '';
  const cells = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const blocked = !!grid.blocked[row][col];
      const sealed = isApproachPuzzleWallClosedAt(col, row, scene);
      cells.push(`<span class="rpgApproachTile${blocked ? ' isBlocked' : ''}${sealed ? ' isSealed' : ''}" aria-hidden="true"></span>`);
    }
  }
  return `<div class="rpgApproachTileGrid" style="grid-template-columns:repeat(${grid.cols},1fr); grid-template-rows:repeat(${grid.rows},1fr);" aria-hidden="true">${cells.join('')}</div>`;
}

function isApproachOpen() {
  return !!APPROACH.active && isLocationOpen();
}

function resetLocationApproach() {
  APPROACH.active = false;
  APPROACH.locationId = null;
  APPROACH.scene = null;
  APPROACH.grid = null;
  APPROACH.xPct = 12;
  APPROACH.yPct = 74;
  APPROACH.tileCol = 0;
  APPROACH.tileRow = 0;
  APPROACH.targetX = null;
  APPROACH.targetY = null;
  APPROACH.pathTiles = [];
  APPROACH.queuedDir = null;
  APPROACH.preferredDir = null;
  APPROACH.moving = false;
  APPROACH.moveElapsed = 0;
  APPROACH.moveFromX = 12;
  APPROACH.moveFromY = 74;
  APPROACH.moveToX = 12;
  APPROACH.moveToY = 74;
  APPROACH.moveToCol = 0;
  APPROACH.moveToRow = 0;
  APPROACH.lastTs = 0;
  APPROACH.keys = Object.create(null);
  APPROACH.nearGate = false;
  APPROACH.nearInteractableId = null;
  APPROACH.nearPuzzleNodeId = null;
  APPROACH.nearEncounterTileId = null;
  APPROACH.interactedIds = Object.create(null);
  APPROACH.bonuses = [];
  APPROACH.puzzleStates = Object.create(null);
  APPROACH.encounterTiles = [];
  APPROACH.encounterTileStates = Object.create(null);
  APPROACH.statusMessage = '';
  APPROACH.puzzle = {
    active: false,
    interactableId: null,
    prompt: '',
    hint: '',
    sequence: [],
    entered: [],
    message: '',
  };
  if (APPROACH.rafId) {
    window.cancelAnimationFrame(APPROACH.rafId);
    APPROACH.rafId = 0;
  }
}


function captureApproachSnapshot() {
  if (!APPROACH.active || !APPROACH.scene) return null;
  return {
    locationId: APPROACH.locationId,
    tileCol: APPROACH.tileCol,
    tileRow: APPROACH.tileRow,
    xPct: APPROACH.xPct,
    yPct: APPROACH.yPct,
    interactedIds: { ...(APPROACH.interactedIds || {}) },
    bonuses: Array.isArray(APPROACH.bonuses) ? APPROACH.bonuses.map((bonus) => cloneApproachBonus(bonus)).filter(Boolean) : [],
    puzzleStates: JSON.parse(JSON.stringify(APPROACH.puzzleStates || {})),
    encounterTiles: Array.isArray(APPROACH.encounterTiles) ? APPROACH.encounterTiles.map((tile) => ({ ...tile })) : [],
    encounterTileStates: JSON.parse(JSON.stringify(APPROACH.encounterTileStates || {})),
    statusMessage: String(APPROACH.statusMessage || ''),
  };
}

function getApproachReservedTileKeySet(scene = APPROACH.scene) {
  const reserved = new Set();
  const push = (col, row) => {
    if (!Number.isFinite(col) || !Number.isFinite(row)) return;
    reserved.add(`${Math.round(col)},${Math.round(row)}`);
  };
  const spawn = getApproachAnchorTile('spawn', scene);
  const gate = getApproachAnchorTile('gate', scene);
  push(spawn.col, spawn.row);
  push(gate.col, gate.row);
  (Array.isArray(scene?.interactables) ? scene.interactables : []).forEach((item) => {
    const tile = getApproachAnchorTile('interactable', scene, item.id);
    push(tile.col, tile.row);
  });
  (Array.isArray(scene?.puzzleNodes) ? scene.puzzleNodes : []).forEach((node) => push(node.col, node.row));
  (Array.isArray(scene?.puzzleWalls) ? scene.puzzleWalls : []).forEach((wall) => push(wall.col, wall.row));
  return reserved;
}

function buildApproachEncounterTiles(scene = APPROACH.scene, locationId = APPROACH.locationId) {
  const grid = getApproachGrid(scene);
  if (!grid) return [];
  const reserved = getApproachReservedTileKeySet(scene);
  const fields = Array.isArray(scene?.skirmishFields) ? scene.skirmishFields : [];

  if (fields.length) {
    const picked = [];
    fields.forEach((field, fieldIdx) => {
      const startCol = clamp(Math.round(toSafeNum(field?.col, 0)), 0, Math.max(0, grid.cols - 1));
      const startRow = clamp(Math.round(toSafeNum(field?.row, 0)), 0, Math.max(0, grid.rows - 1));
      const fieldCols = Math.max(1, Math.round(toSafeNum(field?.cols, 4)));
      const fieldRows = Math.max(1, Math.round(toSafeNum(field?.rows, 6)));
      for (let row = startRow; row < Math.min(grid.rows, startRow + fieldRows); row += 1) {
        for (let col = startCol; col < Math.min(grid.cols, startCol + fieldCols); col += 1) {
          if (!isApproachTileWalkable(col, row, scene)) continue;
          const key = `${col},${row}`;
          if (reserved.has(key)) continue;
          picked.push({
            id: `${locationId || 'default'}-skirmish-${fieldIdx + 1}-${col}-${row}`,
            fieldId: String(field?.id || `${locationId || 'default'}-field-${fieldIdx + 1}`),
            col,
            row,
            chance: clamp(toSafeNum(field?.chance, APPROACH_SKIRMISH_DEFAULT_CHANCE), 0.03, 1),
            label: String(field?.label || 'Skirmish Switch'),
          });
        }
      }
    });
    return picked;
  }

  const gate = getApproachAnchorTile('gate', scene);
  const spawn = getApproachAnchorTile('spawn', scene);
  const candidates = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      if (!isApproachTileWalkable(col, row, scene)) continue;
      const key = `${col},${row}`;
      if (reserved.has(key)) continue;
      const spawnDist = Math.abs(col - spawn.col) + Math.abs(row - spawn.row);
      const gateDist = Math.abs(col - gate.col) + Math.abs(row - gate.row);
      if (spawnDist < 3 || gateDist < 3) continue;
      let openNeighbors = 0;
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx, dy]) => {
        if (isApproachTileWalkable(col + dx, row + dy, scene)) openNeighbors += 1;
      });
      if (openNeighbors < 2) continue;
      candidates.push({ col, row, bias: Math.random() });
    }
  }
  candidates.sort((a, b) => a.bias - b.bias);
  const fallback = [];
  for (const candidate of candidates) {
    if (fallback.length >= 4) break;
    const tooClose = fallback.some((item) => (Math.abs(item.col - candidate.col) + Math.abs(item.row - candidate.row)) < 2);
    if (tooClose) continue;
    fallback.push({
      id: `${locationId || 'default'}-skirmish-fallback-${fallback.length + 1}`,
      col: candidate.col,
      row: candidate.row,
      chance: APPROACH_SKIRMISH_DEFAULT_CHANCE,
      label: 'Skirmish Switch',
    });
  }
  return fallback;
}

function getApproachEncounterTileById(tileId) {
  return (Array.isArray(APPROACH.encounterTiles) ? APPROACH.encounterTiles : []).find((tile) => tile.id === tileId) || null;
}

function getApproachEncounterTileAt(col, row) {
  return (Array.isArray(APPROACH.encounterTiles) ? APPROACH.encounterTiles : []).find((tile) => tile.col === col && tile.row === row) || null;
}

function isApproachEncounterTileSpent(tileId) {
  return !!(tileId && APPROACH.encounterTileStates && APPROACH.encounterTileStates[tileId]?.spent);
}

function getNearbyApproachEncounterTile() {
  if (!Array.isArray(APPROACH.encounterTiles) || !APPROACH.encounterTiles.length) return null;
  return APPROACH.encounterTiles.find((tile) => !isApproachEncounterTileSpent(tile.id) && tile.col === APPROACH.tileCol && tile.row === APPROACH.tileRow) || null;
}

function buildApproachSkirmishEnemy(loc) {
  const set = buildEncounterSetForLocation(loc).slice(0, 2).filter(Boolean);
  if (!set.length) return ENEMIES[0];
  return set[Math.floor(Math.random() * set.length)] || set[0];
}

function reopenApproachFromSnapshot(snapshot, fallbackMessage = '') {
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : null;
  const locId = snap?.locationId || activeLocationId || (APPROACH.locationId || null) || LOCATIONS[0]?.id || null;
  if (!locId) return;
  __exitBossMusic();
  closeMagicMenu();
  closeInventoryMenu();
  resetVisuals();
  state = makeLobbyState();
  syncKnownSpells(false);
  renderIntent(null);
  setEffectBanner('—', 'neutral');
  setPhase('select');
  render();
  openLocationPicker();
  const mergedSnapshot = snap ? { ...snap } : { locationId: locId };
  if (fallbackMessage) {
    mergedSnapshot.statusMessage = snap?.statusMessage ? `${fallbackMessage} ${snap.statusMessage}` : fallbackMessage;
  }
  renderLocationApproach(locId, mergedSnapshot);
}

function startApproachSkirmishEncounter(tile) {
  if (!tile || !APPROACH.active) return false;
  const loc = getLocationById(APPROACH.locationId || activeLocationId || '') || LOCATIONS[0] || null;
  const snapshot = captureApproachSnapshot();
  if (!snapshot || !loc) return false;
  if (!snapshot.encounterTileStates) snapshot.encounterTileStates = {};
  snapshot.encounterTileStates[tile.id] = { spent: true, triggered: true };
  const pendingApproachBonuses = Array.isArray(snapshot.bonuses)
    ? snapshot.bonuses.map((bonus) => cloneApproachBonus(bonus)).filter(Boolean)
    : [];

  window.setTimeout(() => {
    try {
      const safeLoc = setActiveLocation(loc.id) || loc;
      const enemy = buildApproachSkirmishEnemy(safeLoc);
      closeMagicMenu();
      closeInventoryMenu();
      lootResolve = null;
      if (isLootOpen()) closeLootScreen();
      if (lootTimer) window.clearTimeout(lootTimer);
      lootTimer = 0;
      closeLocationPicker();
      resetVisuals();
      __exitBossMusic();
      activeEnemySet = [enemy];
      state = makeInitialState([enemy], safeLoc.id, { preserveEnemySetLength: true, battleMode: 'approach-skirmish', returnToApproach: snapshot });
      pendingApproachBonuses.forEach((bonus) => applyApproachBonusToBattle(bonus, safeLoc));
      state.log = [
        `A skirmish sigil flares in ${safeLoc?.name || 'the approach'}.`,
        `${enemy.name} lunges from the side path.`,
        'Your turn.',
      ];
      syncKnownSpells(false);
      state.enemy.intent = computeEnemyIntent();
      renderIntent(state.enemy.intent);
      setEffectBanner('—', 'neutral');
      setPhase('player');
      render();
    } catch (err) {
      console.error('Approach skirmish failed to start.', err);
      reopenApproachFromSnapshot(snapshot, 'The skirmish sigil sputters and fails to fully ignite.');
    }
  }, 0);
  return true;
}

function maybeTriggerApproachEncounterTile() {
  const tile = getApproachEncounterTileAt(APPROACH.tileCol, APPROACH.tileRow);
  if (!tile || isApproachEncounterTileSpent(tile.id)) return false;
  if (!APPROACH.encounterTileStates || typeof APPROACH.encounterTileStates !== 'object') APPROACH.encounterTileStates = Object.create(null);
  APPROACH.encounterTileStates[tile.id] = { spent: true, triggered: false };
  if (Math.random() <= clamp(toSafeNum(tile.chance, APPROACH_SKIRMISH_DEFAULT_CHANCE), 0.05, 1)) {
    APPROACH.encounterTileStates[tile.id].triggered = true;
    APPROACH.statusMessage = `${tile.label || 'A skirmish switch'} flares and pulls a foe into the path!`;
    startApproachSkirmishEncounter(tile);
    return true;
  }
  APPROACH.statusMessage = `${tile.label || 'The skirmish switches'} crackle, but nothing answers this time.`;
  return false;
}

function getApproachActionRow() {
  return ((els.overworldBattleBtn instanceof HTMLElement) ? els.overworldBattleBtn.closest('.rpgOverworldActionRow') : null)
    || ((els.overworldShopBtn instanceof HTMLElement) ? els.overworldShopBtn.closest('.rpgOverworldActionRow') : null);
}

function getApproachHeroSprite() {
  const hero = getActiveHero();
  const raw = (hero && typeof hero.sprite === 'string' && hero.sprite.trim()) ? hero.sprite.trim() : './assets/images/characters/axel.webp';
  return (raw.startsWith('.') || raw.startsWith('/')) ? raw : `./${raw}`;
}

function cloneApproachBonus(src) {
  if (!src || typeof src !== 'object') return null;
  return {
    label: String(src.label || 'Approach Bonus'),
    foundText: String(src.foundText || ''),
    heal: toSafeNum(src.heal, 0),
    focus: toSafeNum(src.focus, 0),
    barrier: toSafeNum(src.barrier, 0),
    damageBoost: toSafeNum(src.damageBoost, 0),
  };
}

function getApproachBonusSummary(bonus) {
  if (!bonus || typeof bonus !== 'object') return '';
  const parts = [];
  if (toSafeNum(bonus.heal, 0) > 0) parts.push(`+${Math.round(toSafeNum(bonus.heal, 0))} HP`);
  if (toSafeNum(bonus.focus, 0) > 0) parts.push(`+${Math.round(toSafeNum(bonus.focus, 0))} mana`);
  if (toSafeNum(bonus.barrier, 0) > 0) parts.push('barrier');
  if (toSafeNum(bonus.damageBoost, 0) > 1) parts.push('stronger first hit');
  return parts.join(' • ');
}

function getApproachCollectedBonusSummary() {
  if (!Array.isArray(APPROACH.bonuses) || !APPROACH.bonuses.length) return '';
  const pieces = APPROACH.bonuses.map((bonus) => `${bonus.label}${getApproachBonusSummary(bonus) ? ` (${getApproachBonusSummary(bonus)})` : ''}`);
  return pieces.join(' | ');
}

function getApproachPuzzleArrowLabel(dir) {
  return ({ up: '↑', down: '↓', left: '←', right: '→' })[String(dir || '').toLowerCase()] || '•';
}

function hasApproachPuzzle(interactable) {
  return !!(interactable?.mazePuzzle && Array.isArray(interactable.mazePuzzle.steps) && interactable.mazePuzzle.steps.length);
}

function openApproachPuzzle() { return false; }

function closeApproachPuzzle() {
  APPROACH.puzzle = {
    active: false,
    interactableId: null,
    prompt: '',
    hint: '',
    sequence: [],
    entered: [],
    message: '',
  };
}

function resetApproachPuzzleInput() {
  return false;
}

function finalizeApproachInteractable(src) {
  if (!src) return false;
  APPROACH.interactedIds[src.id] = true;
  const bonus = cloneApproachBonus({
    label: src.label,
    foundText: src.foundText,
    heal: src.effect?.heal,
    focus: src.effect?.focus,
    barrier: src.effect?.barrier,
    damageBoost: src.effect?.damageBoost,
  });
  APPROACH.bonuses.push(bonus);
  APPROACH.statusMessage = src.foundText || `${src.label} helps before the fight.`;
  return true;
}

function submitApproachPuzzleInput() {
  return false;
}

function updateApproachPuzzleUi() {
  return;
}

function getNearbyApproachPuzzleNode(scene = APPROACH.scene) {
  if (!scene || !Array.isArray(scene.puzzleNodes) || !scene.puzzleNodes.length) return null;
  let best = null;
  let bestDist = Infinity;
  for (const node of scene.puzzleNodes) {
    if (!node || isApproachMazePuzzleSolved(node.interactableId)) continue;
    const tile = getApproachPuzzleNodeTile(node.id, scene);
    const dist = Math.hypot(APPROACH.tileCol - tile.col, APPROACH.tileRow - tile.row);
    const grid = getApproachGrid(scene);
    const radius = Math.max(1, toSafeNum(node.radiusPct, 7) / Math.min(grid?.cellW || 1, grid?.cellH || 1));
    if (dist <= radius && dist < bestDist) {
      best = node;
      bestDist = dist;
    }
  }
  return best;
}

function triggerApproachPuzzleNode(nodeId = APPROACH.nearPuzzleNodeId) {
  if (!APPROACH.active || !APPROACH.scene) return false;
  const node = getApproachPuzzleNodeById(nodeId, APPROACH.scene);
  if (!node || isApproachMazePuzzleSolved(node.interactableId)) return false;
  const tile = getApproachPuzzleNodeTile(node.id, APPROACH.scene);
  const grid = getApproachGrid(APPROACH.scene);
  const dist = Math.hypot(APPROACH.tileCol - tile.col, APPROACH.tileRow - tile.row);
  const radius = Math.max(1, toSafeNum(node.radiusPct, 7) / Math.min(grid?.cellW || 1, grid?.cellH || 1));
  if (dist > radius) return false;
  const interactable = getApproachInteractableById(node.interactableId, APPROACH.scene);
  if (!interactable || !hasApproachPuzzle(interactable)) return false;
  const puzzle = interactable.mazePuzzle;
  const state = getApproachMazePuzzleState(interactable.id);
  if (state.activated[node.id]) {
    APPROACH.statusMessage = `${node.label} is already glowing.`;
    updateApproachStatus();
    return true;
  }
  state.activated[node.id] = true;
  const activatedCount = Object.keys(state.activated).length;
  state.progress = activatedCount;
  if (activatedCount >= puzzle.steps.length) {
    state.solved = true;
    APPROACH.statusMessage = puzzle.solvedText || `A hidden wall opens near ${interactable.label}.`;
  } else {
    APPROACH.statusMessage = `${node.label} answers. ${puzzle.steps.length - activatedCount} sigil${(puzzle.steps.length - activatedCount) === 1 ? '' : 's'} remain.`;
  }
  updateApproachStatus();
  return true;
}

function isApproachInteractableRevealed(interactable) {
  if (!interactable) return false;
  if (APPROACH.interactedIds?.[interactable.id]) return true;
  return !hasApproachPuzzle(interactable) || isApproachMazePuzzleSolved(interactable.id);
}

function getNearbyApproachInteractable(scene = APPROACH.scene) {

  if (!scene || !Array.isArray(scene.interactables) || !scene.interactables.length) return null;
  let best = null;
  let bestDist = Infinity;
  for (const interactable of scene.interactables) {
    if (!interactable || APPROACH.interactedIds?.[interactable.id] || !isApproachInteractableRevealed(interactable)) continue;
    const dist = getApproachTileDistanceToAnchor('interactable', scene, interactable.id);
    const radius = getApproachAnchorRadiusTiles('interactable', scene, interactable.id);
    if (dist <= radius && dist < bestDist) {
      best = interactable;
      bestDist = dist;
    }
  }
  return best;
}

function triggerApproachInteractable(interactableId = APPROACH.nearInteractableId) {
  if (!APPROACH.active || !APPROACH.scene) return false;
  const src = getApproachInteractableById(interactableId, APPROACH.scene);
  if (!src || APPROACH.interactedIds?.[src.id]) return false;
  if (!isApproachInteractableRevealed(src)) {
    APPROACH.statusMessage = src.mazePuzzle?.lockedText || `A hidden find still lies sealed away.`;
    updateApproachStatus();
    return false;
  }
  const dist = getApproachTileDistanceToAnchor('interactable', APPROACH.scene, src.id);
  const radius = getApproachAnchorRadiusTiles('interactable', APPROACH.scene, src.id);
  if (dist > radius) return false;
  if (hasApproachPuzzle(src) && !isApproachMazePuzzleSolved(src.id)) {
    APPROACH.statusMessage = src.mazePuzzle?.lockedText || `A sealed wall still blocks ${src.label}.`;
    updateApproachStatus();
    return false;
  }
  finalizeApproachInteractable(src);
  updateApproachStatus();
  return true;
}

function triggerApproachPrimaryAction() {
  if (APPROACH.nearPuzzleNodeId) return triggerApproachPuzzleNode(APPROACH.nearPuzzleNodeId);
  if (APPROACH.nearInteractableId) return triggerApproachInteractable(APPROACH.nearInteractableId);
  return false;
}

function applyApproachBonusToBattle(bonus, loc) {
  if (!bonus || !state?.player) return;
  const summary = getApproachBonusSummary(bonus);
  if (toSafeNum(bonus.heal, 0) > 0) {
    state.player.hp = clamp(state.player.hp + Math.round(toSafeNum(bonus.heal, 0)), 0, state.player.max);
  }
  if (toSafeNum(bonus.focus, 0) > 0) {
    state.player.focus = clamp(state.player.focus + Math.round(toSafeNum(bonus.focus, 0)), 0, state.player.focusMax);
  }
  if (toSafeNum(bonus.barrier, 0) > 0) {
    state.player.barrier = Math.max(toSafeInt(state.player.barrier, 0), Math.round(toSafeNum(bonus.barrier, 0)));
  }
  if (toSafeNum(bonus.damageBoost, 0) > 1) {
    state.player.damageBoost = Math.max(toSafeNum(state.player.damageBoost, 0), toSafeNum(bonus.damageBoost, 0));
  }
  addLog(`${bonus.label} helps in ${loc?.name || 'this encounter'}${summary ? `: ${summary}.` : '.'}`);
}

function approachSceneCollides(xPct, yPct) {
  const tile = approachPctToTile(xPct, yPct);
  return !isApproachTileWalkable(tile.col, tile.row);
}

function updateApproachCamera() {
  if (!(els.locationChoices instanceof HTMLElement) || !APPROACH.scene) return;
  const viewport = els.locationChoices.querySelector('#approachViewport');
  const sceneEl = els.locationChoices.querySelector('#approachScene');
  if (!(viewport instanceof HTMLElement) || !(sceneEl instanceof HTMLElement)) return;
  const grid = getApproachGrid(APPROACH.scene);
  if (!grid) return;
  const tileSize = clamp(Math.round(toSafeNum(APPROACH.scene?.tileSize, 72)), 52, 92);
  const viewportW = Math.max(1, viewport.clientWidth);
  const viewportH = Math.max(1, viewport.clientHeight);
  const sceneW = Math.max(viewportW, grid.cols * tileSize);
  const sceneH = Math.max(viewportH, grid.rows * tileSize);
  sceneEl.style.width = `${sceneW}px`;
  sceneEl.style.height = `${sceneH}px`;
  const centerX = (toSafeNum(APPROACH.xPct, 50) / 100) * sceneW;
  const centerY = (toSafeNum(APPROACH.yPct, 50) / 100) * sceneH;
  const offsetX = clamp((viewportW / 2) - centerX, viewportW - sceneW, 0);
  const offsetY = clamp((viewportH / 2) - centerY, viewportH - sceneH, 0);
  sceneEl.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
}

function updateApproachStatus() {
  if (!(els.locationChoices instanceof HTMLElement) || !APPROACH.scene) return;
  const playerEl = els.locationChoices.querySelector('#approachPlayer');
  const targetEl = els.locationChoices.querySelector('#approachTarget');
  const gateEl = els.locationChoices.querySelector('#approachGate');
  const statusEl = els.locationChoices.querySelector('#approachStatus');
  const battleBtn = els.locationChoices.querySelector('button[data-approach-action="battle"]');
  const interactBtn = els.locationChoices.querySelector('button[data-approach-action="interact"]');
  const interactEls = Array.from(els.locationChoices.querySelectorAll('.rpgApproachInteractable'));
  const nodeEls = Array.from(els.locationChoices.querySelectorAll('.rpgApproachPuzzleNode'));
  const wallEls = Array.from(els.locationChoices.querySelectorAll('.rpgApproachSealWall'));
  const encounterEls = Array.from(els.locationChoices.querySelectorAll('.rpgApproachEncounterTile'));
  const loc = getLocationById(APPROACH.locationId || '');
  const gate = APPROACH.scene.gate;
  const interactables = Array.isArray(APPROACH.scene.interactables) ? APPROACH.scene.interactables : [];
  const isLocked = !!(APPROACH.locationId === FINAL_LOCATION_ID && !isCampaignFinalUnlocked());
  const gateTile = getApproachAnchorTile('gate');
  const gatePos = approachTileToPct(gateTile.col, gateTile.row);

  if (playerEl instanceof HTMLElement) {
    playerEl.style.left = `${APPROACH.xPct}%`;
    playerEl.style.top = `${APPROACH.yPct}%`;
  }
  if (targetEl instanceof HTMLElement) {
    const hasTarget = Number.isFinite(APPROACH.targetX) && Number.isFinite(APPROACH.targetY);
    targetEl.toggleAttribute('hidden', !hasTarget);
    if (hasTarget) {
      targetEl.style.left = `${APPROACH.targetX}%`;
      targetEl.style.top = `${APPROACH.targetY}%`;
    }
  }

  updateApproachCamera();

  APPROACH.nearGate = getApproachTileDistanceToAnchor('gate') <= getApproachAnchorRadiusTiles('gate');
  const nearbyPuzzleNode = getNearbyApproachPuzzleNode(APPROACH.scene);
  const nearbyInteractable = getNearbyApproachInteractable(APPROACH.scene);
  const nearbyEncounterTile = getNearbyApproachEncounterTile();
  APPROACH.nearPuzzleNodeId = nearbyPuzzleNode?.id || null;
  APPROACH.nearInteractableId = nearbyInteractable?.id || null;
  APPROACH.nearEncounterTileId = nearbyEncounterTile?.id || null;

  if (gateEl instanceof HTMLElement) {
    gateEl.style.left = `${gatePos.xPct}%`;
    gateEl.style.top = `${gatePos.yPct}%`;
    gateEl.classList.toggle('isNearby', APPROACH.nearGate);
    gateEl.classList.toggle('isLocked', isLocked);
    gateEl.setAttribute('data-label', gate.label);
  }

  interactEls.forEach((el) => {
    const id = el.getAttribute('data-interactable-id') || '';
    const interactable = getApproachInteractableById(id, APPROACH.scene);
    if (!interactable) return;
    const tile = getApproachAnchorTile('interactable', APPROACH.scene, interactable.id);
    const pos = approachTileToPct(tile.col, tile.row, APPROACH.scene);
    const revealed = isApproachInteractableRevealed(interactable);
    el.style.left = `${pos.xPct}%`;
    el.style.top = `${pos.yPct}%`;
    el.hidden = !revealed;
    el.setAttribute('aria-hidden', revealed ? 'false' : 'true');
    el.classList.toggle('isHiddenUntilSolved', !revealed);
    el.classList.toggle('isNearby', revealed && APPROACH.nearInteractableId === interactable.id);
    el.classList.toggle('isUsed', !!APPROACH.interactedIds?.[interactable.id]);
    el.classList.toggle('hasPuzzle', hasApproachPuzzle(interactable) && !APPROACH.interactedIds?.[interactable.id] && !isApproachMazePuzzleSolved(interactable.id));
    el.classList.toggle('isLockedSeal', hasApproachPuzzle(interactable) && !isApproachMazePuzzleSolved(interactable.id));
  });

  nodeEls.forEach((el) => {
    const id = el.getAttribute('data-puzzle-node-id') || '';
    const node = getApproachPuzzleNodeById(id, APPROACH.scene);
    if (!node) return;
    const pos = approachTileToPct(node.col, node.row, APPROACH.scene);
    el.style.left = `${pos.xPct}%`;
    el.style.top = `${pos.yPct}%`;
    const state = getApproachMazePuzzleState(node.interactableId);
    el.classList.toggle('isNearby', APPROACH.nearPuzzleNodeId === node.id);
    el.classList.toggle('isSolved', !!state.solved);
    el.classList.toggle('isActive', !!state.activated?.[node.id]);
  });

  wallEls.forEach((el) => {
    const id = el.getAttribute('data-seal-for') || '';
    el.classList.toggle('isOpen', isApproachMazePuzzleSolved(id));
  });

  encounterEls.forEach((el) => {
    const id = el.getAttribute('data-encounter-tile-id') || '';
    const tile = getApproachEncounterTileById(id);
    if (!tile) return;
    const pos = approachTileToPct(tile.col, tile.row, APPROACH.scene);
    const spent = isApproachEncounterTileSpent(id);
    el.style.left = `${pos.xPct}%`;
    el.style.top = `${pos.yPct}%`;
    el.hidden = spent;
    el.setAttribute('aria-hidden', spent ? 'true' : 'false');
    el.classList.toggle('isSpent', spent);
    el.classList.toggle('isNearby', !spent && APPROACH.nearEncounterTileId === id);
  });

  if (battleBtn instanceof HTMLButtonElement) {
    battleBtn.disabled = isLocked || !APPROACH.nearGate;
    battleBtn.textContent = isLocked ? 'Sealed' : (APPROACH.locationId === FINAL_LOCATION_ID ? 'Challenge Final Boss' : `Begin ${loc?.name || 'Encounter'}`);
  }
  if (interactBtn instanceof HTMLButtonElement) {
    const show = !!(interactables.length || (APPROACH.scene?.puzzleNodes?.length));
    interactBtn.hidden = !show;
    if (nearbyPuzzleNode) {
      interactBtn.disabled = false;
      interactBtn.textContent = 'Activate Sigil';
    } else if (nearbyInteractable) {
      interactBtn.disabled = false;
      interactBtn.textContent = nearbyInteractable.actionLabel || 'Interact';
    } else {
      interactBtn.disabled = true;
      interactBtn.textContent = 'Interact';
    }
  }
  if (statusEl instanceof HTMLElement) {
    const collectedSummary = getApproachCollectedBonusSummary();
    const usedCount = Object.keys(APPROACH.interactedIds || {}).length;
    const totalCount = interactables.length;
    const summarySuffix = collectedSummary ? ` Collected: ${collectedSummary}.` : '';
    const extra = APPROACH.statusMessage ? ` ${APPROACH.statusMessage}` : '';
    statusEl.textContent = (isLocked
      ? `The Palace gate is sealed. Reclaim all four artifacts to break the seal.${summarySuffix}${extra}`
      : (APPROACH.nearGate
        ? `You reached the ${gate.label}. Press Enter or use the battle button to begin. ${usedCount}/${totalCount} interactables claimed.${summarySuffix}${extra}`
        : nearbyPuzzleNode
          ? `You are beside the ${nearbyPuzzleNode.label}. Press E or use Activate Sigil. ${usedCount}/${totalCount} interactables claimed.${summarySuffix}${extra}`
          : nearbyInteractable
            ? `You are close to the ${nearbyInteractable.label}. Press E or use ${nearbyInteractable.actionLabel}. ${usedCount}/${totalCount} interactables claimed.${summarySuffix}${extra}`
            : nearbyEncounterTile
              ? `You are in the ${nearbyEncounterTile.label || 'skirmish switch field'}. This tile may spark a one-wave ambush. ${usedCount}/${totalCount} interactables claimed.${summarySuffix}${extra}`
              : `Explore the tile-map with WASD / arrow keys or click a route. Reach the ${gate.label} to start combat. ${usedCount}/${totalCount} interactables claimed.${summarySuffix}${extra}`));
  }
}

function getApproachAmbientHtml(theme) {
  const safeTheme = escapeHtml(theme || 'default');
  const makeSprite = (cls, style='') => `<span class="rpgApproachAmbientSprite ${cls}"${style ? ` style="${style}"` : ''} aria-hidden="true"></span>`;
  const sprites = [];
  switch (theme) {
    case 'forest':
      sprites.push(
        makeSprite('rpgApproachAmbientSprite--leaf', 'left:12%; top:16%; animation-delay:-1.2s;'),
        makeSprite('rpgApproachAmbientSprite--leaf', 'left:36%; top:10%; animation-delay:-3.1s;'),
        makeSprite('rpgApproachAmbientSprite--leaf', 'left:68%; top:18%; animation-delay:-2.3s;'),
        makeSprite('rpgApproachAmbientSprite--firefly', 'left:24%; top:46%; animation-delay:-0.8s;'),
        makeSprite('rpgApproachAmbientSprite--firefly', 'left:74%; top:38%; animation-delay:-2.4s;'),
        makeSprite('rpgApproachAmbientSprite--firefly', 'left:84%; top:26%; animation-delay:-1.6s;')
      );
      break;
    case 'market':
      sprites.push(
        makeSprite('rpgApproachAmbientSprite--banner', 'left:18%; top:12%; animation-delay:-1.8s;'),
        makeSprite('rpgApproachAmbientSprite--banner', 'left:58%; top:14%; animation-delay:-3.0s;'),
        makeSprite('rpgApproachAmbientSprite--coin', 'left:32%; top:33%; animation-delay:-0.9s;'),
        makeSprite('rpgApproachAmbientSprite--coin', 'left:66%; top:29%; animation-delay:-2.2s;'),
        makeSprite('rpgApproachAmbientSprite--coin', 'left:80%; top:22%; animation-delay:-3.4s;')
      );
      break;
    case 'gutterglass':
      sprites.push(
        makeSprite('rpgApproachAmbientSprite--shard', 'left:16%; top:18%; animation-delay:-1.0s;'),
        makeSprite('rpgApproachAmbientSprite--shard', 'left:38%; top:12%; animation-delay:-2.8s;'),
        makeSprite('rpgApproachAmbientSprite--shard', 'left:72%; top:16%; animation-delay:-1.7s;'),
        makeSprite('rpgApproachAmbientSprite--glint', 'left:28%; top:40%; animation-delay:-0.6s;'),
        makeSprite('rpgApproachAmbientSprite--glint', 'left:62%; top:36%; animation-delay:-2.5s;')
      );
      break;
    case 'palace':
      sprites.push(
        makeSprite('rpgApproachAmbientSprite--mote', 'left:22%; top:18%; animation-delay:-0.9s;'),
        makeSprite('rpgApproachAmbientSprite--mote', 'left:48%; top:12%; animation-delay:-2.6s;'),
        makeSprite('rpgApproachAmbientSprite--mote', 'left:74%; top:17%; animation-delay:-1.8s;'),
        makeSprite('rpgApproachAmbientSprite--ray', 'left:18%; top:0%; animation-delay:-1.3s;'),
        makeSprite('rpgApproachAmbientSprite--ray', 'left:68%; top:0%; animation-delay:-3.1s;')
      );
      break;
    case 'arena':
    default:
      sprites.push(
        makeSprite('rpgApproachAmbientSprite--ember', 'left:18%; top:36%; animation-delay:-0.7s;'),
        makeSprite('rpgApproachAmbientSprite--ember', 'left:36%; top:24%; animation-delay:-2.1s;'),
        makeSprite('rpgApproachAmbientSprite--ember', 'left:62%; top:32%; animation-delay:-1.4s;'),
        makeSprite('rpgApproachAmbientSprite--ember', 'left:80%; top:22%; animation-delay:-3.0s;'),
        makeSprite('rpgApproachAmbientSprite--dust', 'left:20%; top:64%; animation-delay:-1.1s;'),
        makeSprite('rpgApproachAmbientSprite--dust', 'left:68%; top:58%; animation-delay:-2.9s;')
      );
      break;
  }
  return `<div class="rpgApproachAmbient rpgApproachAmbient--${safeTheme}" aria-hidden="true">${sprites.join('')}</div>`;
}

function renderLocationApproach(locationId, restoreSnapshot = null) {
  if (!(els.locationChoices instanceof HTMLElement)) return;
  const loc = getLocationById(locationId);
  const scene = getApproachScene(loc.id);
  resetLocationApproach();
  APPROACH.active = true;
  APPROACH.locationId = loc.id;
  APPROACH.scene = scene;
  APPROACH.grid = getApproachGrid(scene);
  APPROACH.gridCols = APPROACH.grid?.cols || APPROACH_GRID_DEFAULTS.cols;
  APPROACH.gridRows = APPROACH.grid?.rows || APPROACH_GRID_DEFAULTS.rows;
  const startTile = restoreSnapshot ? { col: toSafeInt(restoreSnapshot.tileCol, getApproachAnchorTile('spawn', scene).col), row: toSafeInt(restoreSnapshot.tileRow, getApproachAnchorTile('spawn', scene).row) } : getApproachAnchorTile('spawn', scene);
  setApproachTilePosition(startTile.col, startTile.row, scene);
  APPROACH.interactedIds = restoreSnapshot?.interactedIds ? { ...restoreSnapshot.interactedIds } : Object.create(null);
  APPROACH.bonuses = Array.isArray(restoreSnapshot?.bonuses) ? restoreSnapshot.bonuses.map((bonus) => cloneApproachBonus(bonus)).filter(Boolean) : [];
  APPROACH.puzzleStates = restoreSnapshot?.puzzleStates ? JSON.parse(JSON.stringify(restoreSnapshot.puzzleStates)) : Object.create(null);
  APPROACH.encounterTiles = Array.isArray(restoreSnapshot?.encounterTiles) && restoreSnapshot.encounterTiles.length
    ? restoreSnapshot.encounterTiles.map((tile) => ({ ...tile }))
    : buildApproachEncounterTiles(scene, loc.id);
  APPROACH.encounterTileStates = restoreSnapshot?.encounterTileStates ? JSON.parse(JSON.stringify(restoreSnapshot.encounterTileStates)) : Object.create(null);
  APPROACH.statusMessage = String(restoreSnapshot?.statusMessage || '');

  const titleEl = document.getElementById('locationTitle');
  if (titleEl instanceof HTMLElement) titleEl.textContent = `${loc.name} Approach`;
  const actionRow = getApproachActionRow();
  if (actionRow instanceof HTMLElement) actionRow.toggleAttribute('hidden', true);

  els.locationChoices.classList.remove('rpgOverworldMapStage');
  els.locationChoices.classList.add('rpgApproachStage');
  els.locationChoices.setAttribute('aria-label', `${loc.name} approach area`);

  const heroSprite = getApproachHeroSprite();
  const propsHtml = scene.props.map((prop) => `
    <div class="rpgApproachProp rpgApproachProp--${escapeHtml(prop.cls)}${prop.solid ? ' isSolid' : ''}" style="left:${prop.xPct}%; top:${prop.yPct}%; width:${prop.wPct}%; height:${prop.hPct}%;"></div>
  `).join('');
  const tileGridHtml = getApproachTileGridHtml(scene);
  const gateTile = getApproachAnchorTile('gate', scene);
  const gatePos = approachTileToPct(gateTile.col, gateTile.row, scene);
  const interactHtml = (Array.isArray(scene.interactables) ? scene.interactables : []).map((interactable) => {
    const tile = getApproachAnchorTile('interactable', scene, interactable.id);
    const pos = approachTileToPct(tile.col, tile.row, scene);
    const revealed = isApproachInteractableRevealed(interactable);
    return `
    <button type="button" class="rpgApproachInteractable rpgApproachInteractable--${escapeHtml(interactable.cls)}${hasApproachPuzzle(interactable) && !APPROACH.interactedIds?.[interactable.id] && !isApproachMazePuzzleSolved(interactable.id) ? ' hasPuzzle isLockedSeal isHiddenUntilSolved' : ''}" data-interactable-id="${escapeHtml(interactable.id)}" style="left:${pos.xPct}%; top:${pos.yPct}%; width:${interactable.wPct}%; height:${interactable.hPct}%;" aria-label="${escapeHtml(interactable.label)}" ${revealed ? '' : 'hidden aria-hidden="true"'}>
      <span class="rpgApproachInteractableCore" aria-hidden="true"></span>
      <span class="rpgApproachInteractableLabel">${escapeHtml(interactable.label)}</span>
    </button>`;
  }).join('');
  const puzzleNodeHtml = (Array.isArray(scene.puzzleNodes) ? scene.puzzleNodes : []).map((node) => {
    const pos = approachTileToPct(node.col, node.row, scene);
    return `<button type="button" class="rpgApproachPuzzleNode" data-puzzle-node-id="${escapeHtml(node.id)}" style="left:${pos.xPct}%; top:${pos.yPct}%;" aria-label="${escapeHtml(node.label)}"><span class="rpgApproachPuzzleNodeCore" aria-hidden="true"></span><span class="rpgApproachPuzzleNodeLabel">${escapeHtml(node.label)}</span></button>`;
  }).join('');
  const puzzleWallHtml = (Array.isArray(scene.puzzleWalls) ? scene.puzzleWalls : []).map((wall) => {
    const rect = approachTileRectToPct({ col: wall.col, row: wall.row, colSpan: 1, rowSpan: 1 }, scene.grid.cols, scene.grid.rows);
    return `<div class="rpgApproachSealWall" data-seal-for="${escapeHtml(wall.interactableId)}" style="left:${rect.xPct}%; top:${rect.yPct}%; width:${rect.wPct}%; height:${rect.hPct}%;" aria-hidden="true"></div>`;
  }).join('');
  const encounterTileHtml = (Array.isArray(APPROACH.encounterTiles) ? APPROACH.encounterTiles : []).map((tile) => {
    const pos = approachTileToPct(tile.col, tile.row, scene);
    const spent = isApproachEncounterTileSpent(tile.id);
    return `<button type="button" class="rpgApproachEncounterTile${spent ? ' isSpent' : ''}" data-encounter-tile-id="${escapeHtml(tile.id)}" style="left:${pos.xPct}%; top:${pos.yPct}%;" aria-label="${escapeHtml(tile.label || 'Skirmish Switch')}" ${spent ? 'disabled aria-hidden="true"' : ''}><span class="rpgApproachEncounterTileCore" aria-hidden="true"></span></button>`;
  }).join('');
  const isLocked = !!(loc.id === FINAL_LOCATION_ID && !isCampaignFinalUnlocked());
  els.locationChoices.innerHTML = `
    <div class="rpgApproachShell rpgApproachShell--${escapeHtml(scene.theme)}">
      <div class="rpgApproachTopbar">
        <div>
          <div class="rpgApproachKicker">Arrival Scene</div>
          <h3 class="rpgApproachTitle">${escapeHtml(loc.name)}</h3>
          <p class="rpgApproachBlurb">${escapeHtml(scene.blurb)}</p>
        </div>
        <div class="rpgApproachActions">
          <button type="button" class="btn ghost" data-approach-action="back">Return to Map</button>
          <button type="button" class="btn ghost" data-approach-action="interact" ${(Array.isArray(scene.interactables) && scene.interactables.length) ? 'disabled' : 'hidden disabled'}>Interact</button>
          <button type="button" class="btn primary magentaGlow" data-approach-action="battle" ${isLocked ? 'disabled' : ''}>${isLocked ? 'Sealed' : 'Begin Encounter'}</button>
        </div>
      </div>
      <div class="rpgApproachViewport" id="approachViewport" aria-label="${escapeHtml(loc.name)} approach area">
        <div class="rpgApproachScene" id="approachScene" data-cols="${scene.grid.cols}" data-rows="${scene.grid.rows}">
          <div class="rpgApproachBackdrop" aria-hidden="true"></div>
          ${tileGridHtml}
          ${getApproachAmbientHtml(scene.theme)}
          ${propsHtml}
          ${puzzleWallHtml}
          ${puzzleNodeHtml}
          ${encounterTileHtml}
          ${interactHtml}
          <div class="rpgApproachGate${isLocked ? ' isLocked' : ''}" id="approachGate" style="left:${gatePos.xPct}%; top:${gatePos.yPct}%">
            <span class="rpgApproachGateCore" aria-hidden="true"></span>
            <span class="rpgApproachGateLabel">${escapeHtml(scene.gate.label)}</span>
          </div>
          <div class="rpgApproachTarget" id="approachTarget" hidden aria-hidden="true"></div>
          <div class="rpgApproachPlayer" id="approachPlayer" aria-hidden="true">
            <div class="rpgApproachPlayerGlow"></div>
            <img src="${heroSprite}" alt="" draggable="false" loading="eager" onerror="this.remove()" />
          </div>
        </div>
      </div>
      <div class="rpgApproachStatus" id="approachStatus"></div>
    </div>
  `;

  const viewport = els.locationChoices.querySelector('#approachViewport');
  if (viewport instanceof HTMLElement) {
    viewport.style.touchAction = 'none';
    viewport.addEventListener('pointerdown', (ev) => {
      const target = ev.target;
      if (target instanceof HTMLElement && target.closest('button[data-approach-action]')) return;
      const puzzleHit = (target instanceof HTMLElement) ? target.closest('.rpgApproachPuzzleNode') : null;
      if (puzzleHit instanceof HTMLElement) {
        const nodeId = puzzleHit.getAttribute('data-puzzle-node-id') || '';
        if (APPROACH.nearPuzzleNodeId === nodeId) {
          triggerApproachPuzzleNode(nodeId);
        } else {
          queueApproachPathTo(getApproachPuzzleNodeTile(nodeId, scene), scene);
          updateApproachStatus();
        }
        return;
      }
      const interactHit = (target instanceof HTMLElement) ? target.closest('.rpgApproachInteractable') : null;
      if (interactHit instanceof HTMLElement) {
        const interactableId = interactHit.getAttribute('data-interactable-id') || '';
        if (APPROACH.nearInteractableId === interactableId) {
          triggerApproachInteractable(interactableId);
        } else {
          queueApproachPathTo(getApproachAnchorTile('interactable', scene, interactableId), scene);
          updateApproachStatus();
        }
        return;
      }
      const encounterHit = (target instanceof HTMLElement) ? target.closest('.rpgApproachEncounterTile') : null;
      if (encounterHit instanceof HTMLElement) {
        const tileId = encounterHit.getAttribute('data-encounter-tile-id') || '';
        const tile = getApproachEncounterTileById(tileId);
        if (tile && !isApproachEncounterTileSpent(tile.id)) {
          queueApproachPathTo({ col: tile.col, row: tile.row }, scene);
          updateApproachStatus();
        }
        return;
      }
      const sceneEl = els.locationChoices.querySelector('#approachScene');
      const rect = (sceneEl instanceof HTMLElement) ? sceneEl.getBoundingClientRect() : viewport.getBoundingClientRect();
      const xPct = clamp(((ev.clientX - rect.left) / Math.max(1, rect.width)) * 100, 1, 99);
      const yPct = clamp(((ev.clientY - rect.top) / Math.max(1, rect.height)) * 100, 1, 99);
      queueApproachPathTo(approachPctToTile(xPct, yPct, scene), scene);
      updateApproachStatus();
    });
  }

  const backBtn = els.locationChoices.querySelector('button[data-approach-action="back"]');
  if (backBtn instanceof HTMLButtonElement) {
    backBtn.addEventListener('click', () => {
      renderLocationChoices();
      renderOverworldPositions();
    });
  }
  const interactBtn = els.locationChoices.querySelector('button[data-approach-action="interact"]');
  if (interactBtn instanceof HTMLButtonElement) {
    interactBtn.addEventListener('click', () => {
      triggerApproachPrimaryAction();
    });
  }
  const battleBtn = els.locationChoices.querySelector('button[data-approach-action="battle"]');
  if (battleBtn instanceof HTMLButtonElement) {
    battleBtn.addEventListener('click', () => {
      if (APPROACH.puzzle?.active) return;
      if (!APPROACH.nearGate) return;
      startBattleWithLocation(loc.id);
    });
  }

  updateApproachStatus();
  ensureLocationApproachAnimation();
}

function ensureLocationApproachAnimation() {
  if (!APPROACH.active || APPROACH.rafId) return;
  const tick = (ts) => {
    if (!APPROACH.active || !APPROACH.scene) {
      APPROACH.rafId = 0;
      return;
    }
    const prev = APPROACH.lastTs || ts;
    APPROACH.lastTs = ts;
    const dt = Math.min(0.05, Math.max(0.001, (ts - prev) / 1000));

    if (APPROACH.moving) {
      APPROACH.moveElapsed += dt;
      const t = clamp(APPROACH.moveElapsed / Math.max(0.05, APPROACH.moveDuration), 0, 1);
      const eased = t < 0.5 ? (2 * t * t) : (1 - Math.pow(-2 * t + 2, 2) / 2);
      APPROACH.xPct = APPROACH.moveFromX + ((APPROACH.moveToX - APPROACH.moveFromX) * eased);
      APPROACH.yPct = APPROACH.moveFromY + ((APPROACH.moveToY - APPROACH.moveFromY) * eased);
      if (t >= 1) {
        APPROACH.moving = false;
        APPROACH.moveElapsed = 0;
        APPROACH.xPct = APPROACH.moveToX;
        APPROACH.yPct = APPROACH.moveToY;
        APPROACH.tileCol = APPROACH.moveToCol;
        APPROACH.tileRow = APPROACH.moveToRow;
      }
    }

    if (!APPROACH.moving && APPROACH.pathTiles.length) {
      const next = APPROACH.pathTiles.shift();
      startApproachMoveToTile(next.col, next.row, APPROACH.scene);
      if (!APPROACH.pathTiles.length && !APPROACH.moving) {
        APPROACH.targetX = null;
        APPROACH.targetY = null;
      }
    }

    if (!APPROACH.moving && !APPROACH.pathTiles.length && APPROACH.queuedDir) {
      const nextDir = APPROACH.queuedDir;
      APPROACH.queuedDir = null;
      attemptApproachStep(nextDir, APPROACH.scene);
    }

    if (!APPROACH.moving && !APPROACH.pathTiles.length) {
      const heldDir = getApproachHeldDir();
      if (heldDir) attemptApproachStep(heldDir, APPROACH.scene);
    }

    if (!APPROACH.moving && !APPROACH.pathTiles.length && !APPROACH.queuedDir && !getApproachHeldDir()) {
      APPROACH.targetX = null;
      APPROACH.targetY = null;
    }

    if (!APPROACH.moving && !APPROACH.pathTiles.length) {
      if (maybeTriggerApproachEncounterTile()) return;
    }

    updateApproachStatus();

    const stillMoving = !!(APPROACH.moving || APPROACH.pathTiles.length || APPROACH.queuedDir || getApproachHeldDir());
    if (stillMoving) {
      APPROACH.rafId = window.requestAnimationFrame(tick);
    } else {
      APPROACH.rafId = 0;
      APPROACH.lastTs = 0;
    }
  };
  APPROACH.rafId = window.requestAnimationFrame(tick);
}


function buildEncounterSetForLocation(loc) {
  const raw = Array.isArray(loc?.enemySet) && loc.enemySet.length ? loc.enemySet : buildEnemySetForBattle(getActiveHero().level);
  const set = raw.map((entry) => {
    if (typeof entry === 'number') return ENEMIES[entry] || ENEMIES[0];
    return entry || ENEMIES[0];
  }).filter(Boolean);

  if (set.length === 1) return [set[0], set[0], ENEMIES[BOSS_ENEMY_INDEX]];
  if (set.length === 2) return [set[0], set[1], ENEMIES[BOSS_ENEMY_INDEX]];
  return [set[0], set[1], set[2] || ENEMIES[BOSS_ENEMY_INDEX]];
}

function isCampaignLocation(id) {
  return !!CAMPAIGN_DISTRICT_BY_ID[id] || id === FINAL_LOCATION_ID;
}

function awardCampaignBossClear(locationId) {
  if (!locationId || !state?.player) return { newlyCleared: false, gearId: null };
  if (!state.player.bossUniques || typeof state.player.bossUniques !== 'object') state.player.bossUniques = {};
  if (state.player.bossUniques[locationId]) return { newlyCleared: false, gearId: null };
  state.player.bossUniques[locationId] = true;
  const gearId = BOSS_UNIQUE_GEAR_BY_LOCATION?.[locationId] || null;
  if (gearId && GEAR_DEFS[gearId]) {
    gainGear(gearId, 1);
  } else {
    persistPlayerProgress();
  }
  return { newlyCleared: true, gearId };
}


  /**
   * Create a fresh enemy state from template.
   * @param {number} waveIndex
   */
  function makeEnemy(waveIndex, enemySet, playerLevel = 1) {
  const set = enemySet || activeEnemySet || ENEMIES;
  const t = set[waveIndex] ?? set[0] ?? ENEMIES[0];

  // Scaling philosophy:
  // - Enemies *do* scale with you so fights stay relevant...
  // - ...but they scale *slower* than the player so leveling still feels rewarding.
  // - Higher waves remain tougher primarily because their base templates are tougher.
  const pLvl = Math.max(1, toSafeInt(playerLevel, 1));
  const w = Math.max(0, toSafeInt(waveIndex, 0));
  // Enemies "catch up" to only a portion of your levels.
  // (0.55 means: when you gain 10 levels, enemies gain about 5 of them.)
  // Bosses scale even slower so you can eventually outgrow an area boss.
  const isBossTemplate = t.profile === "bossEclipse" || w >= 2;
  const ENEMY_LEVEL_CATCHUP = isBossTemplate ? 0.45 : 0.55;

  // Displayed level: your (partial) level + a wave bump.
  // Boss wave already has a huge base template, so its bump is smaller.
  const waveBump = isBossTemplate ? 1 : w;
  const lvl = Math.max(1, 1 + Math.floor((pLvl - 1) * ENEMY_LEVEL_CATCHUP) + waveBump);

  // Stat growth per enemy level.
  // Boss growth is gentler so Lv ~8 is a real "you can win" threshold.
  const hpRate = isBossTemplate ? 0.03 : 0.04;
  const powRate = isBossTemplate ? 0.02 : 0.025;
  const hpScale = 1 + (lvl - 1) * hpRate;
  const powScale = 1 + (lvl - 1) * powRate;

  const scaledMaxHp = Math.max(1, Math.round(toSafeInt(t.maxHp, 18) * hpScale));

  const focusMax = typeof t.focusMax === "number" ? t.focusMax : 6;
  const focusStart = typeof t.focusStart === "number" ? t.focusStart : 2;

  return {
    name: t.name,
    types: t.types,
    level: lvl,
    powerMult: powScale,
    hp: scaledMaxHp,
    max: scaledMaxHp,
    healCharges: t.healCharges,

    // resources (Mana)
    focus: clamp(focusStart, 0, focusMax),
    focusMax: focusMax,

    // statuses
    guarding: false,     // brace (50% next hit)
    ward: 0,             // mirror ward: 40% reduction + reflect
    fortified: 0,        // earth fortify: 30% reduction
    gusted: false,       // next damage -2
    scented: 0,          // next attacks -1 (Smell/Taste)
    burn: 0,             // ticks 2 at start of turn
    stunned: 0,          // skips next turn
    enraged: false,

    // AI
    profile: t.profile,
    aiStep: 0,
    intent: null,        // filled at start of player's turn
    sprite: t.sprite,
    spriteIsPixel: t.spriteIsPixel !== false,
  };
}

  /** @param {ReturnType<typeof getHeroById>} pt */
  function makePlayerFromHero(pt) {
    const prog = loadHeroProgress(pt.id);
    const scaled = applyLevelToHero(pt, prog.level);
    const items = sanitizeItemCounts(prog.items);
    const gear = sanitizeGearCounts(prog.gear);

    // Backwards compatible: accept legacy `equip` and modern `equipSlots`.
    const equipSlots = sanitizeEquipSlots(prog.equipSlots ?? prog.equip, gear);
    const bonus = gearBonusesFromSlots(equipSlots);

    // Perks are tied to the hero (stored in progress).
    const perkIds = sanitizePerkIds(prog.perks ?? prog.perkIds, pt.id);
    const perkBonus = perkBonusesFromIds(pt.id, perkIds);

    const bossUniques = sanitizeBossUniques(prog.bossUniques);

    const maxWithGear = scaled.maxHp + bonus.hpBonus + perkBonus.hpBonus;
    const focusMaxWithGear = scaled.focusMax + bonus.focusBonus + perkBonus.focusBonus;

    const powerPct = clamp(bonus.powerPct + perkBonus.powerPct, 0, 0.75);
    const healPct = clamp(bonus.healPct + perkBonus.healPct, 0, 0.75);
    const drPct = clamp(bonus.drPct + perkBonus.drPct, 0, 0.75);

    const savedSpells = Array.isArray(prog.spells) ? prog.spells : knownSpellIdsFor(pt.types, prog.level);
    let spells = sanitizeKnownSpellIds(savedSpells, pt.types, prog.level);
    startingSpellIdsFor(pt.types).forEach((id) => { if (!spells.includes(id)) spells.push(id); });
    spells = sanitizeKnownSpellIds(spells, pt.types, prog.level);

    return {
      id: pt.id,
      name: pt.name,
      types: pt.types,
      sprite: pt.sprite,

      // Spells are chosen on level-up (with starting spells always available).
      spells,
      pendingSpellQueue: [],

      // progression
      level: prog.level,
      xp: prog.xp,
      coins: Math.max(0, toSafeInt((prog.coins ?? prog.crowns), 0)),
      xpToNext: xpToNext(prog.level),
      powerMult: scaled.powerMult * (1 + powerPct),
      healMult: scaled.healMult * (1 + healPct),
      equipDR: drPct,
      xpMult: 1 + clamp(perkBonus.xpPct, 0, 0.50),
      baseMaxHp: pt.maxHp,
      baseFocusMax: pt.focusMax,

      // skill points
      skillPoints: clamp(toSafeInt(prog.skillPoints, 0), 0, 99),
      perks: perkIds,

      // vitals
      hp: maxWithGear,
      max: maxWithGear,

      // statuses
      guarding: false,
      evading: false,
      burn: 0,
      bound: 0,

      // tactical item effects
      barrier: 0,          // next hit −30%
      damageBoost: 0,      // e.g. 1.3 for next damage

      // items (one-use consumables)
      items,

      // gear
      gear,
      equipSlots,
      bossUniques,

      // turn flag: allow 1 item per turn without ending the turn
      itemUsedThisTurn: false,

      // resources
      healCharges: pt.healCharges,
      focus: clamp(scaled.focusStart + perkBonus.startMana, 0, focusMaxWithGear),
      focusMax: focusMaxWithGear,
    };
  }


  function makeInitialState(enemySet = null, locationId = activeLocationId, options = null) {
  const loc = locationId ? getLocationById(locationId) : null;
  const pt = getActiveHero();
  const player = makePlayerFromHero(pt);

  // If no set was provided (or it looks incomplete), generate a fresh random encounter lineup.
  let set = Array.isArray(enemySet) && enemySet.length ? enemySet : null;
  if (!set || set.length < 3) {
    set = buildEnemySetForBattle(player.level);
  }

  const preserveEnemySetLength = !!(options && options.preserveEnemySetLength);

  // Normalize length (Wave 3 is usually a boss) unless a one-wave skirmish explicitly opts out.
  if (!preserveEnemySetLength) {
    if (set.length < 3) {
      const w1 = set[0] || ENEMIES[0];
      const w2 = set[1] || w1;
      set = [w1, w2, ENEMIES[BOSS_ENEMY_INDEX]];
    } else {
      // Preserve an explicit third-wave boss when a location provides one.
      set = [set[0], set[1] || set[0], set[2] || ENEMIES[BOSS_ENEMY_INDEX]];
    }
  } else {
    set = set.slice();
  }

  // Keep global in sync so wave spawns use the same lineup.
  activeEnemySet = set;

  return {
    battleId: ++battleSerial,
    turn: 1,
    phase: "player",
    wave: 0,
    locationId: loc ? loc.id : null,
    enemySet: set,
    player,
    enemy: makeEnemy(0, set, player.level),
    over: false,
    battleMode: String(options?.battleMode || 'campaign'),
    returnToApproach: options?.returnToApproach || null,
    log: [
      `Location: ${loc ? loc.name : "—"}.`,
      `Wave 1: ${set[0].name} steps into view.`,
      "Your turn.",
    ],
  };
}

function makeLobbyState() {
  const loc = LOCATIONS[0];
  const pt = getActiveHero();
  const player = makePlayerFromHero(pt);
  const set = buildEnemySetForBattle(player.level);

  // Keep global in sync so other helpers have a consistent reference.
  activeEnemySet = set;

  return {
    battleId: ++battleSerial,
    turn: 1,
    phase: "select",
    wave: 0,
    locationId: null,
    enemySet: set,
    player,
    enemy: makeEnemy(0, set, player.level),
    over: false,
    log: [
      "Choose a hero, then a location to begin.",
      "Your hero changes stats and type bonuses (STAB).",
    ],
  };
}


  const GAME_BUILD = modules.GAME_BUILD || "2026-02-16-random-encounters";


  // Load saved hero choice (if any)

  let battleSerial = 0;

  loadSavedHero();

  /** @type {ReturnType<typeof makeInitialState>} */
  let state = makeInitialState();
syncKnownSpells(false);

  if (els.buildTag instanceof HTMLElement) els.buildTag.textContent = `Build: ${GAME_BUILD}`;

  // "How to play" helper: open by default on first visit, remember your choice.
  try {
    const KEY = "dragonstone_rpg_howto_open";
    if (els.howtoDetails instanceof HTMLDetailsElement) {
      const saved = window.localStorage.getItem(KEY);
      if (saved === null) els.howtoDetails.open = true;
      else els.howtoDetails.open = saved === "1";
      els.howtoDetails.addEventListener("toggle", () => {
        window.localStorage.setItem(KEY, els.howtoDetails.open ? "1" : "0");
      });
    }
  } catch (e) {
    // localStorage may be blocked (private mode). Ignore.
  }


  /** @param {string} message */
  function addLog(message) {
    state.log.unshift(message);
    if (state.log.length > 18) state.log = state.log.slice(0, 18);
  }

  function isGameOver() {
    return state.over || state.player.hp <= 0;
  }

  /** @param {HTMLElement|null} el @param {string} text */
  function setText(el, text) {
    if (!el) return;
    el.textContent = text;
  }

  /** Render enemy header with distinct typography (name vs level/wave badges). */
  function setEnemyHeader(el, name, level, waveIndex1, waveTotal, isBoss) {
    if (!el) return;
    const safeName = escapeHtml(name);
    const lvText = `Lv ${Number.isFinite(level) ? level : 1}`;
    const waveText = `Wave ${Number.isFinite(waveIndex1) ? waveIndex1 : 1}/${Number.isFinite(waveTotal) ? waveTotal : 1}`;
    el.innerHTML = `
      <span class="enemyTitle">${safeName}</span>
      <span class="enemyBadge enemyBadge--lv">${escapeHtml(lvText)}</span>
      <span class="enemyBadge enemyBadge--wave">${escapeHtml(waveText)}</span>
      ${isBoss ? '<span class="enemyBadge enemyBadge--boss">BOSS</span>' : ''}
    `.trim();
  }

  /** @param {HTMLElement|null} el @param {number} ratio */
  function setBar(el, ratio) {
    if (!el) return;
    const safe = clamp(ratio, 0, 1);
    el.style.width = `${Math.round(safe * 100)}%`;
  }


  // HP bar turns red under this fraction (e.g. 0.30 = 30%).
  const HP_LOW_THRESHOLD = 0.30;

  /** @param {HTMLElement|null} el @param {number} ratio */
  function setHpBar(el, ratio) {
    setBar(el, ratio);
    if (!el) return;
    const safe = clamp(ratio, 0, 1);
    el.classList.toggle("isLowHp", safe <= HP_LOW_THRESHOLD);
  }


  
function persistPlayerProgress() {
  const heroId = state?.player?.id || activeHeroId;
  if (!heroId) return;
  saveHeroProgress(heroId, {
    level: Math.max(1, toSafeInt(state.player.level, 1)),
    xp: Math.max(0, toSafeInt(state.player.xp, 0)),
    coins: Math.max(0, toSafeInt(state.player.coins, 0)),
    skillPoints: clamp(toSafeInt(state.player.skillPoints, 0), 0, 99),
    perks: sanitizePerkIds(state.player.perks ?? state.player.perkIds, heroId),
    spells: Array.isArray(state.player.spells) ? state.player.spells : [],
    items: sanitizeItemCounts(state.player.items),
    gear: sanitizeGearCounts(state.player.gear),
    equipSlots: (state.player && typeof state.player.equipSlots === "object") ? state.player.equipSlots : undefined,
    bossUniques: (state.player && typeof state.player.bossUniques === "object") ? state.player.bossUniques : undefined,
  });
}

  /** Recompute scaled stats/multipliers for the current level.
   *  @param {boolean} onLevelUp
   */
  function syncPlayerLevel(onLevelUp = false) {
    const hero = getHeroById(state?.player?.id || activeHeroId);
    const lvl = Math.max(1, toSafeInt(state.player.level, 1));
    const scaled = applyLevelToHero(hero, lvl);


    // Apply gear bonuses (3-slot equipment). Back-compat: accept legacy `equip` string.
    state.player.gear = sanitizeGearCounts(state.player.gear);
    state.player.equipSlots = sanitizeEquipSlots(state.player.equipSlots ?? state.player.equip, state.player.gear);
    const bonus = gearBonusesFromSlots(state.player.equipSlots);

    // Perks (skill points) bonuses.
    state.player.perks = sanitizePerkIds(state.player.perks ?? state.player.perkIds, hero.id);
    state.player.skillPoints = clamp(toSafeInt(state.player.skillPoints, 0), 0, 99);
    const perkBonus = perkBonusesFromIds(hero.id, state.player.perks);

    const newMax = scaled.maxHp + bonus.hpBonus + perkBonus.hpBonus;
    const newFocusMax = scaled.focusMax + bonus.focusBonus + perkBonus.focusBonus;
    const powerPct = clamp(bonus.powerPct + perkBonus.powerPct, 0, 0.75);
    const healPct = clamp(bonus.healPct + perkBonus.healPct, 0, 0.75);
    const drPct = clamp(bonus.drPct + perkBonus.drPct, 0, 0.75);
    const newPowerMult = scaled.powerMult * (1 + powerPct);
    const newHealMult = scaled.healMult * (1 + healPct);

    const oldMax = toSafeInt(state.player.max, newMax);
    const oldFocusMax = toSafeInt(state.player.focusMax, newFocusMax);

    state.player.max = newMax;
    state.player.focusMax = newFocusMax;
    state.player.powerMult = newPowerMult;
    state.player.healMult = newHealMult;
    state.player.equipDR = drPct;
    state.player.xpMult = 1 + clamp(perkBonus.xpPct, 0, 0.50);
    state.player.xpToNext = xpToNext(lvl);
    state.player.baseMaxHp = hero.maxHp;
    state.player.baseFocusMax = hero.focusMax;

    // Preserve current HP/Mana, but allow a small "level-up refresh".
    const gainedMax = state.player.max - oldMax;
    state.player.hp = clamp(toSafeInt(state.player.hp, state.player.max) + gainedMax, 0, state.player.max);
    state.player.focus = clamp(toSafeInt(state.player.focus, 0) + (state.player.focusMax - oldFocusMax), 0, state.player.focusMax);

    if (onLevelUp) {
      state.player.hp = clamp(state.player.hp + 2, 0, state.player.max);
      state.player.focus = clamp(state.player.focus + 1, 0, state.player.focusMax);
    }
  }

  /** @param {any} enemy */
  function xpForEnemy(enemy) {
    const lvl = Math.max(1, toSafeInt(enemy?.level, 1));
    const maxHp = Math.max(1, toSafeInt(enemy?.max, 18));
    // Simple readable reward: tougher enemies give more XP.
    return Math.max(6, Math.round(8 + lvl * 4 + maxHp / 6));
  }

  /** @param {number} amount */
  function gainXp(amount) {
    const base = Math.max(0, toSafeInt(amount, 0));
    const xpMult = clamp(Number(state.player.xpMult ?? 1), 1, 1.50);
    const add = Math.max(0, Math.round(base * xpMult));
    if (add <= 0) return { xpAdded: 0, leveled: false, levelsGained: 0, levelBefore: Math.max(1, toSafeInt(state.player.level, 1)), levelAfter: Math.max(1, toSafeInt(state.player.level, 1)), spGained: 0, pendingSpellChoices: 0 };

    state.player.xp = Math.max(0, toSafeInt(state.player.xp, 0) + add);
    addLog(`✨ You gain ${add} XP.`);

    let leveled = false;
    let pendingAdded = 0;
    let spGained = 0;
    let levelsGained = 0;
    const levelBefore = Math.max(1, toSafeInt(state.player.level, 1));

    while (state.player.xp >= state.player.xpToNext) {
      state.player.xp -= state.player.xpToNext;
      state.player.level = Math.max(1, toSafeInt(state.player.level, 1) + 1);
      levelsGained += 1;
      state.player.skillPoints = clamp(toSafeInt(state.player.skillPoints, 0) + 1, 0, 99);
      spGained += 1;
      state.player.xpToNext = xpToNext(state.player.level);
      syncPlayerLevel(true);

      const { pendingAdded: addPending } = syncKnownSpells(true);
      pendingAdded += Math.max(0, toSafeInt(addPending, 0));

      leveled = true;
      addLog(`🌟 Level up! You are now Lv ${state.player.level}.`);
      addLog(`✨ You earned 1 skill point.`);
    }

    if (leveled) {
      if (spGained > 0) {
        addLog(`🧠 You earned ${spGained} skill point${spGained === 1 ? "" : "s"}. Open Perks to spend them.`);
      }
      // A little celebration without interrupting flow.
      showMoveBanner("Level Up", "Sight");

      // If a new spell choice unlocked, prompt immediately.
      if (pendingAdded > 0) {
        window.setTimeout(() => openNextSpellPick(), 180);
      }
    }

    persistPlayerProgress();
    render();

    return {
      xpAdded: add,
      leveled,
      levelsGained,
      levelBefore,
      levelAfter: Math.max(1, toSafeInt(state.player.level, 1)),
      spGained,
      pendingSpellChoices: pendingAdded,
    };
  }

  /** @param {number} base */
  function scaledPlayerBase(base) {
    const mult = typeof state.player.powerMult === "number" ? state.player.powerMult : 1;
    return Math.max(1, Math.round(toSafeInt(base, 1) * mult));
  }

  /** @param {number} base */
  function scaledEnemyBase(base) {
    const mult = typeof state.enemy.powerMult === "number" ? state.enemy.powerMult : 1;
    return Math.max(1, Math.round(toSafeInt(base, 1) * mult));
  }

  function statusLineForPlayer() {
    const parts = [];
    if (!state.over && state.player.guarding) parts.push("Guarding (next hit −50%)");
    if (!state.over && state.player.evading) parts.push("Evasive veil (next hit softened)");
    if (!state.over && state.player.barrier > 0) parts.push("Barrier (next hit −30%)");
    if (!state.over && state.player.damageBoost > 1) parts.push("Power Rune (next damage x1.3)");
    if (!state.over && state.player.bound > 0) parts.push("Bound (next move weakened)");
    if (!state.over && state.player.burn > 0) parts.push(`Burning (${state.player.burn})`);
    return parts.length ? parts.join(" • ") : "Ready";
  }

  function statusLineForEnemy() {
    const parts = [];
    if (!state.over && state.enemy.enraged) parts.push("Enraged");
    if (!state.over && state.enemy.stunned > 0) parts.push("Stunned (skips next turn)");
    if (!state.over && state.enemy.ward > 0) parts.push("Mirror ward (reflect)");
    if (!state.over && state.enemy.fortified > 0) parts.push("Fortified (next hit −30%)");
    if (!state.over && state.enemy.guarding) parts.push("Bracing (next hit −50%)");
    if (!state.over && state.enemy.gusted) parts.push("Gusted (next hit weakened)");
    if (!state.over && state.enemy.scented > 0) parts.push(`Scented (${state.enemy.scented})`);
    if (!state.over && state.enemy.burn > 0) parts.push(`Burning (${state.enemy.burn})`);
    return parts.length ? parts.join(" • ") : "Channeling";
  }

  function setEnemyVisuals() {
    if (!(els.enemySprite instanceof HTMLElement)) return;

    const isBoss =
      Array.isArray(state?.enemySet) &&
      state.enemySet.length >= 3 &&
      state.wave === state.enemySet.length - 1;

    // Visual cue: Wave 2 gets a subtle boost, and the final wave gets a BOSS badge.
    els.enemySprite.classList.toggle("is-phase2", state.wave === 1);
    els.enemySprite.classList.toggle("is-boss", isBoss);
  }

  // --------------------
  // Intent (telegraph)
  // --------------------

  /**
   * @typedef {object} Intent
   * @property {string} id
   * @property {string} name
   * @property {MagicType|null} type
   * @property {number} base
   * @property {string} note
   */

  /**
   * Decide what the enemy will do next (deterministic, readable).
   * Runs at the start of the player's turn so you can plan.
   * @returns {Intent}
   */

  const ENEMY_MANA_COST = {
    // 0-cost moves build Mana
    attack: 0,
    ward: 0,
    fortify: 0,

    // spending moves
    heal: 2,
    arcane: 2,
    lance: 2,
    glare: 2,
    squall: 2,
    resonant: 2,
    resonate: 2,
    quake: 2,
    shatter: 2,
    mirrorbind: 2,
    stonebind: 2,
    hushbind: 2,
    wavebind: 2,
    surge: 2,
    ignite: 3,
    siphon: 3,
  };

  function enemyManaCost(id) {
    return ENEMY_MANA_COST[id] ?? 0;
  }

  function computeEnemyIntent() {
  const p = state.player;
  const e = state.enemy;

  // Emergency heal if low.
  if (e.hp > 0 && e.hp < e.max && e.healCharges > 0) {
    const ratio = e.hp / e.max;
    if (ratio <= 0.32) return { id: "heal", name: "Heal", type: null, base: 0, note: "Heals for 8" };
  }

  // Profiles (deterministic patterns)

  if (e.profile === "bossEclipse") {
    // Boss pattern: mixes defense, control, and heavy hits.
    // Mana gating (below) will force a basic Strike when the boss can't afford a spell,
    // which naturally creates breathing room.
    const pattern = ["ward", "mirrorbind", "lance", "resonate", "ignite", "shatter", "siphon", "quake", "attack"];
    let next = pattern[e.aiStep % pattern.length];

    if (next === "ignite" && p.burn > 0) next = "resonate";
    if (next === "mirrorbind" && p.bound > 0) next = "lance";
    if (next === "ward" && e.ward > 0) next = "attack";

    if (next === "ward") return { id: "ward", name: "Mirror Ward", type: null, base: 0, note: "Next hit reduced + reflects" };
    if (next === "mirrorbind") return { id: "mirrorbind", name: "Mirrorbind", type: "Touch", base: 3, note: "Applies Bind" };
    if (next === "lance") return { id: "lance", name: "Arcane Lance", type: "Sight", base: 7, note: "" };
    if (next === "resonate") return { id: "resonate", name: "Resonant Blast", type: "Sound", base: 6, note: "" };
    if (next === "ignite") return { id: "ignite", name: "Ignite", type: "Fire", base: 4, note: "Applies Burn (2)" };
    if (next === "shatter") return { id: "shatter", name: "Shatter", type: "Earth", base: 6, note: "Punishes Guard" };
    if (next === "siphon") return { id: "siphon", name: "Siphon", type: "Sight", base: 4, note: "Heals enemy for 3" };
    if (next === "quake") return { id: "quake", name: "Quake", type: "Earth", base: 7, note: "Shakes through guard" };
    return { id: "attack", name: "Strike", type: "Sight", base: 4, note: "" };
  }
  if (e.profile === "fireSight") {
    const pattern = ["ignite", "lance", "ward", "siphon", "attack"];
    let next = pattern[e.aiStep % pattern.length];

    // If you're already burning, they don't waste a turn re-igniting.
    if (next === "ignite" && p.burn > 0) next = "lance";

    if (next === "ignite") return { id: "ignite", name: "Ignite", type: "Fire", base: 4, note: "Applies Burn (2)" };
    if (next === "lance") return { id: "lance", name: "Arcane Lance", type: "Sight", base: 6, note: "" };
    if (next === "ward") return { id: "ward", name: "Mirror Ward", type: null, base: 0, note: "Next hit reduced + reflects" };
    if (next === "siphon") return { id: "siphon", name: "Siphon", type: "Sight", base: 4, note: "Heals enemy for 3" };
    return { id: "attack", name: "Strike", type: "Sight", base: 4, note: "" };
  }





  if (e.profile === "soundFire") {
    const pattern = ["ignite", "resonate", "ward", "resonate", "attack"];
    let next = pattern[e.aiStep % pattern.length];

    // If you're already burning, they don't waste a turn re-igniting.
    if (next === "ignite" && p.burn > 0) next = "resonate";
    if (next === "ward" && e.ward > 0) next = "attack";

    if (next === "ignite") return { id: "ignite", name: "Ignite", type: "Fire", base: 4, note: "Applies Burn (2)" };
    if (next === "resonate") return { id: "resonate", name: "Resonant Blast", type: "Sound", base: 6, note: "" };
    if (next === "ward") return { id: "ward", name: "Mirror Ward", type: null, base: 0, note: "Next hit reduced + reflects" };
    return { id: "attack", name: "Strike", type: "Sound", base: 4, note: "" };
  }
  if (e.profile === "waterTouch") {
    const pattern = ["surge", "wavebind", "fortify", "surge", "attack"];
    let next = pattern[e.aiStep % pattern.length];

    // If burn is present (either side), prioritize Surging Current to douse it.
    if (next !== "surge" && (p.burn > 0 || e.burn > 0)) next = "surge";

    // If you're already bound, they pivot to water damage.
    if (next === "wavebind" && p.bound > 0) next = "surge";

    if (next === "surge") return { id: "surge", name: "Surging Current", type: "Water", base: 5, note: "Douses Burn" };
    if (next === "wavebind") return { id: "wavebind", name: "Wavebind", type: "Touch", base: 3, note: "Applies Bind" };
    if (next === "fortify") return { id: "fortify", name: "Brineguard", type: null, base: 0, note: "Next hit reduced" };
    return { id: "attack", name: "Strike", type: "Sight", base: 4, note: "" };
  }
  if (e.profile === "windSight") {
    const pattern = ["squall", "lance", "ward", "squall", "attack"];
    const next = pattern[e.aiStep % pattern.length];

    if (next === "squall") return { id: "squall", name: "Squall", type: "Wind", base: 5, note: "" };
    if (next === "lance") return { id: "lance", name: "Arcane Lance", type: "Sight", base: 6, note: "" };
    if (next === "ward") return { id: "ward", name: "Mirror Ward", type: null, base: 0, note: "Next hit reduced + reflects" };
    return { id: "attack", name: "Strike", type: "Sight", base: 4, note: "" };
  }

  if (e.profile === "mirrorTouch") {
    const pattern = ["mirrorbind", "glare", "fortify", "glare", "attack"];
    let next = pattern[e.aiStep % pattern.length];

    // If you're already bound, they pivot to damage.
    if (next === "mirrorbind" && p.bound > 0) next = "glare";

    if (next === "mirrorbind") return { id: "mirrorbind", name: "Mirrorbind", type: "Touch", base: 3, note: "Applies Bind" };
    if (next === "glare") return { id: "glare", name: "Glare", type: "Sight", base: 5, note: "" };
    if (next === "fortify") return { id: "fortify", name: "Fortify", type: null, base: 0, note: "Next hit reduced" };
    return { id: "attack", name: "Strike", type: "Sight", base: 4, note: "" };
  }

  
  if (e.profile === "soundTouch") {
    const pattern = ["hushbind", "resonate", "ward", "resonate", "attack"];
    let next = pattern[e.aiStep % pattern.length];

    if (next === "hushbind" && p.bound > 0) next = "resonate";

    if (next === "hushbind") return { id: "hushbind", name: "Hushbind", type: "Touch", base: 3, note: "Applies Bind" };
    if (next === "resonate") return { id: "resonate", name: "Resonant Blast", type: "Sound", base: 5, note: "" };
    if (next === "ward") return { id: "ward", name: "Mirror Ward", type: null, base: 0, note: "Next hit reduced + reflects" };
    return { id: "attack", name: "Strike", type: "Sight", base: 4, note: "" };
  }


  if (e.profile === "smellEarth") {
    const pattern = ["attack", "quake", "fortify", "shatter", "attack"];
    let next = pattern[e.aiStep % pattern.length];

    // Avoid wasting a turn re-fortifying.
    if (next === "fortify" && e.fortified > 0) next = "attack";

    if (next === "quake") return { id: "quake", name: "Quake", type: "Earth", base: 6, note: "Shakes through guard" };
    if (next === "fortify") return { id: "fortify", name: "Fortify", type: null, base: 0, note: "Next hit reduced" };
    if (next === "shatter") return { id: "shatter", name: "Shatter", type: "Earth", base: 5, note: "Punishes Guard" };
    return { id: "attack", name: "Scented Swipe", type: "SmellTaste", base: 4, note: "" };
  }

// Default: Earth/Touch pattern.
  const pattern = ["stonebind", "quake", "fortify", "shatter", "quake"];
  let next = pattern[e.aiStep % pattern.length];

  // If you're already bound, they pivot to damage.
  if (next === "stonebind" && p.bound > 0) next = "quake";

  if (next === "stonebind") return { id: "stonebind", name: "Stonebind", type: "Touch", base: 3, note: "Applies Bind" };
  if (next === "quake") return { id: "quake", name: "Quake", type: "Earth", base: 6, note: "Shakes through guard" };
  if (next === "fortify") return { id: "fortify", name: "Fortify", type: null, base: 0, note: "Next hit reduced" };
  return { id: "shatter", name: "Shatter", type: "Earth", base: 5, note: "Punishes Guard" };
}


  /** @param {Intent|null} intent */
  function renderIntent(intent) {
    if (!(els.enemyIntentText instanceof HTMLElement)) return;
    if (!intent) {
      els.enemyIntentText.textContent = "Intent: —";
      return;
    }

    if (!intent.type) {
      els.enemyIntentText.textContent = `Intent: ${intent.name} (${intent.note || "—"})`;
      return;
    }

    const typed = computeTypedDamage("enemy", "player", intent.base, intent.type);
    const badge = typed.note ? `, ${typed.note}` : "";
    els.enemyIntentText.textContent = `Intent: ${intent.name} (${intent.type}${badge})`;
  }

  // --------------------
  // Defenses + statuses
  // --------------------

  /**
   * Apply enemy defenses. Returns {final, reflected}.
   * @param {number} incoming
   */
  function applyEnemyDefenses(incoming, opts = {}) {
    let final = incoming;
    let reflected = 0;

    const pierce = clamp(Number(opts?.piercePct ?? 0), 0, 1);
    const noReflect = !!opts?.noReflect;

    // Mirror ward: reduction + reflect (can be pierced / reflect suppressed).
    if (!opts?.ignoreWard && state.enemy.ward > 0) {
      const before = final;
      const mult = 0.6 + 0.4 * pierce;
      final = Math.ceil(final * mult);

      const reflFactor = noReflect ? 0 : (0.25 * (1 - pierce));
      const refl = Math.floor(before * reflFactor);
      if (refl > 0) reflected = Math.max(reflected, refl);

      state.enemy.ward = 0;
      const note = pierce > 0.01 ? " (partially pierced)" : "";
      const back = refl > 0 ? ` and bites back (${refl}).` : ".";
      addLog(`A mirror ward bends the strike (${before} → ${final})${note}${back}`);
      playAnim(els.enemySprite, "rpgAnim-guard");
      spawnFx("guard", "enemy");
    }

    // Fortify: reduction (can be pierced)
    if (!opts?.ignoreFortify && state.enemy.fortified > 0) {
      const before = final;
      const mult = 0.7 + 0.3 * pierce;
      final = Math.ceil(final * mult);
      state.enemy.fortified = 0;
      const note = pierce > 0.01 ? " (pierced)" : "";
      addLog(`${state.enemy.name} is fortified (${before} → ${final})${note}.`);
      playAnim(els.enemySprite, "rpgAnim-guard");
      spawnFx("guard", "enemy");
    }

    // Brace: reduction (can be pierced)
    if (!opts?.ignoreGuard && state.enemy.guarding) {
      const before = final;
      const mult = 0.5 + 0.5 * pierce;
      final = Math.floor(final * mult);
      state.enemy.guarding = false;
      const note = pierce > 0.01 ? " (pierced)" : "";
      addLog(`${state.enemy.name} braces (${before} → ${final})${note}.`);
      playAnim(els.enemySprite, "rpgAnim-guard");
      spawnFx("guard", "enemy");
    }

    return { final, reflected };
  }

  /**
   * Apply player defenses. Returns final.
   * @param {number} incoming
   * @param {{quake?: boolean, shatter?: boolean}} flags
   */
  function applyPlayerDefenses(incoming, flags = {}) {
    let final = incoming;

    // Evasion veil: reduce next hit by 60%
    if (state.player.evading) {
      const before = final;
      final = Math.ceil(final * 0.4);
      state.player.evading = false;
      addLog(`You slip in an evasive veil (${before} → ${final}).`);
      playAnim(els.playerSprite, "rpgAnim-guard");
    }

    // Barrier (from item): reduce next hit by 30%
    if (state.player.barrier > 0) {
      const before = final;
      final = Math.ceil(final * 0.7);
      state.player.barrier = 0;
      addLog(`A barrier absorbs part of the blow (${before} → ${final}).`);
      playAnim(els.playerSprite, "rpgAnim-guard");
      spawnFx("guard", "player");
    }

    // Guard: usually halves next hit, but Quake pushes through.
    if (state.player.guarding) {
      const before = final;
      if (flags.quake) {
        final = Math.ceil(final * 0.75); // only 25% reduction
        addLog(`The quake pushes through your guard (${before} → ${final}).`);
      } else if (flags.shatter) {
        // Shatter breaks guard and adds pressure.
        final = final + 2;
        addLog(`Shatter cracks your guard (${before} → ${final}).`);
      } else {
        final = Math.floor(final / 2);
        addLog(`You guard and soften the blow (${before} → ${final}).`);
      }
      state.player.guarding = false;
      playAnim(els.playerSprite, "rpgAnim-guard");
    }

    // Equipment passive: constant damage reduction (after other defenses)
    const dr = clamp(Number(state.player.equipDR ?? 0), 0, 0.50);
    if (final > 0 && dr > 0) {
      const before = final;
      final = Math.max(0, Math.ceil(final * (1 - dr)));
      if (final !== before) {
        const slots = (state?.player?.equipSlots && typeof state.player.equipSlots === "object")
          ? state.player.equipSlots
          : sanitizeEquipSlots(state?.player?.equip, sanitizeGearCounts(state?.player?.gear));

        const ids = [slots.weapon, slots.armor, slots.trinket].filter((x) => typeof x === "string");
        const label = ids.length
          ? ids.map((id) => `${GEAR_DEFS[id].icon} ${GEAR_DEFS[id].name}`).join(", ")
          : "Your gear";

        addLog(`${label} dampens the hit (${before} → ${final}).`);
      }
    }

    return final;
  }

  /**
   * Burn ticks at start of unit's turn: -2 HP, burn-1.
   * @param {"player"|"enemy"} who
   */
  function tickBurn(who) {
    const unit = state[who];
    if (!unit || unit.burn <= 0) return false;

    const dmg = 2;
    unit.hp = clamp(unit.hp - dmg, 0, unit.max);
    unit.burn = Math.max(0, unit.burn - 1);

    // Show burn as a center-screen "move" so it reads like an event.
    showMoveBanner("Burn", "Fire");

    const label = who === "player" ? "You" : state.enemy.name;
    // Make it visually obvious this is a status tick, not a second attack.
    addLog(`🔥 Burn ticks: ${label} take${who === "player" ? "" : "s"} ${dmg} damage.`);
    if (who === "player") {
      playAnim(els.playerSprite, "rpgAnim-hit");
      spawnFx("fire", "player");
      spawnFloat(`-${dmg}`, "player", "dmg", null);
    }
    if (who === "enemy") {
      playAnim(els.enemySprite, "rpgAnim-hit");
      spawnFx("fire", "enemy");
      spawnFloat(`-${dmg}`, "enemy", "dmg", null);
    }

    return true;
  }

  // --------------------
  // Render
  // --------------------

  function render() {
    const playerHp = clamp(state.player.hp, 0, state.player.max);
    const enemyHp = clamp(state.enemy.hp, 0, state.enemy.max);

    // Resource helpers (used throughout render)
    const focus = state.player.focus;
    const boundExtra = state.player.bound > 0 ? 1 : 0;
    const healCost = 1 + boundExtra;

    // Names + types
    setText(els.playerName, state.player.name);
    const enemyLv = typeof state.enemy.level === "number" ? state.enemy.level : 1;
    const isBossWave = Array.isArray(state.enemySet) && state.enemySet.length >= 3 && state.wave === state.enemySet.length - 1;
    setEnemyHeader(els.enemyName, state.enemy.name, enemyLv, state.wave + 1, state.enemySet.length, isBossWave);
    setTypeLine(els.playerTypeText, state.player.types);
    setTypeLine(els.enemyTypeText, state.enemy.types);

    // Equipment (Weapon / Armor / Trinket)
    if (els.playerEquipText instanceof HTMLElement) {
      const slots = (state?.player?.equipSlots && typeof state.player.equipSlots === "object")
        ? state.player.equipSlots
        : sanitizeEquipSlots(state?.player?.equip, sanitizeGearCounts(state?.player?.gear));

      const parts = EQUIP_SLOTS.map((slot) => {
        const id = slots[slot];
        const g = id && GEAR_DEFS[id] ? GEAR_DEFS[id] : null;
        return `${EQUIP_SLOT_LABEL[slot]}: ${g ? `${g.icon} ${g.name} (${rarityLabel(g.rarity || "common")})` : "—"}`;
      });

      els.playerEquipText.textContent = `Equipment: ${parts.join(" • ")}`;
    }
    updateSpellPickButtonUI();
    updatePerkButtonUI();

    // Focus + intent
    if (els.playerFocusText instanceof HTMLElement) {
      els.playerFocusText.textContent = `Mana: ${focus} / ${state.player.focusMax}`;
    }
    // Focus bar (visual) + keep the hover preview accurate as focus changes.
    setBar(els.playerFocusFill, focus / state.player.focusMax);

    // Level + XP
    if (els.playerLevelText instanceof HTMLElement) {
      const lvl = typeof state.player.level === "number" ? state.player.level : 1;
      const xp = typeof state.player.xp === "number" ? state.player.xp : 0;
      const need = typeof state.player.xpToNext === "number" ? state.player.xpToNext : xpToNext(lvl);
      els.playerLevelText.textContent = `Lv ${lvl} • XP ${xp} / ${need}`;
      setBar(els.playerXpFill, need > 0 ? (xp / need) : 0);
    }

    // Enemy Mana
    if (els.enemyFocusText instanceof HTMLElement) {
      const eMana = typeof state.enemy.focus === "number" ? state.enemy.focus : 0;
      const eMax = typeof state.enemy.focusMax === "number" ? state.enemy.focusMax : 6;
      els.enemyFocusText.textContent = `Mana: ${eMana} / ${eMax}`;
      setBar(els.enemyFocusFill, eMax > 0 ? (eMana / eMax) : 0);
    }

    renderIntent(state.enemy.intent);

    // Effect preview is only visible while hovering/focusing an action.
    if (previewVisible && previewMove) {
      // Keep hover preview consistent when you swap heroes (Attack type changes with hero).
      if (previewMove.name === "Attack") previewMove.type = playerPrimaryType();
      renderEffectPreview(previewMove);
    } else {
      clearEffectPreview();
    }
    renderHint();

    // Sprite swap (wave-based enemies)
    if (els.enemySpriteImg instanceof HTMLImageElement && state.enemy.sprite) {
      if (els.enemySpriteImg.getAttribute("src") !== state.enemy.sprite) {
        els.enemySpriteImg.setAttribute("src", state.enemy.sprite);
      }
      // Normalize visual size across different sprite padding.
      autoScaleSprite(els.enemySpriteImg, { target: 0.82, min: 0.88, max: 1.6, fillH: 0.68 });
      // Pixel-art enemies stay crisp, but allow portrait-style enemy art too.
      const enemyIsPortrait = state.enemy.spriteIsPixel === false;
      els.enemySpriteImg.classList.toggle("isPixel", !enemyIsPortrait);
    }

    // Player sprite swap (hero selection)
    if (els.playerSpriteImg instanceof HTMLImageElement && state.player.sprite) {
      if (els.playerSpriteImg.getAttribute("src") !== state.player.sprite) {
        els.playerSpriteImg.setAttribute("src", state.player.sprite);
      }

      // Normalize visual size across different sprite padding.
      autoScaleSprite(els.playerSpriteImg, { target: 0.82, min: 0.88, max: 1.6, fillH: 0.68 });

      // Use crisp pixel rendering for pixel sprites, but keep portraits smooth.
      const isPortrait = String(state.player.sprite).includes("/assets/images/characters/") ||
        String(state.player.sprite).includes("./assets/images/characters/");
      els.playerSpriteImg.classList.toggle("isPixel", !isPortrait);
    }


    // Type pills
    renderTypePills(els.playerTypePills, state.player.types);
    renderTypePills(els.enemyTypePills, state.enemy.types);

    // Accent cues: make types visually obvious on cards and sprites
    setTypeAccent(els.playerCard, state.player.types);
    setTypeAccent(els.enemyCard, state.enemy.types);
    setTypeAccent(els.playerSprite, state.player.types);
    setTypeAccent(els.enemySprite, state.enemy.types);

    // Simple matchup lists
    renderMatchupLists();

    // Full chart (static grid)
    renderTypeMatrix();

    // Button labels show multiplier + cost (so choices are readable)
    const atkType = playerPrimaryType();
    const atkPrev = computeTypedDamage("player", "enemy", 5, atkType, { ignoreEffectiveness: true });

    if (els.attackBtn instanceof HTMLButtonElement) {
      const atkLabel = TYPE_META[atkType]?.label ?? atkType;
      // Add a small type icon next to the Attack button label.
      const atkIcon = typeIcon(atkType);
      els.attackBtn.classList.add("hasTypeIcon");
      els.attackBtn.innerHTML = `<span class="btnTypeIcon" aria-hidden="true">${atkIcon}</span><span class="btnTypeText">Attack (${atkLabel} | Pow 5)</span>`;
      els.attackBtn.dataset.type = atkType;
    }
    // Spells unlock on level-up and are rendered dynamically.
    const spells = getKnownSpells();


    // Add type icons next to the Magic button (based on the spell types you currently know).
    // If you know spells of multiple types, we show a small cluster of icons.
    if (els.magicToggle instanceof HTMLButtonElement) {
      const uniqTypes = Array.from(new Set(spells.map((s) => s.type)));
      const iconTypes = uniqTypes.length ? uniqTypes : [playerPrimaryType()];
      const icons = iconTypes.map((t) => typeIcon(t)).join("");
      els.magicToggle.classList.add("hasTypeIcon");
      els.magicToggle.innerHTML = `<span class="btnTypeIcon" aria-hidden="true">${icons}</span><span class="btnTypeText">Magic</span>`;
      if (iconTypes[0]) els.magicToggle.dataset.type = iconTypes[0];
    }

    if (els.healBtn instanceof HTMLButtonElement) {
	      els.healBtn.textContent = `Heal (${healCost} Mana, ${state.player.healCharges})`;
	      // Hover/focus preview shows the exact heal amount; keep the tooltip accurate too.
	      const amt = previewHealAmount();
	      els.healBtn.title = `Heals ${amt} HP`;
    }

    // HP
    setText(els.playerHpText, `HP ${playerHp} / ${state.player.max}`);
    setText(els.enemyHpText, `HP ${enemyHp} / ${state.enemy.max}`);
    setHpBar(els.playerHpFill, playerHp / state.player.max);
    setHpBar(els.enemyHpFill, enemyHp / state.enemy.max);

    // Status
    if (state.over) {
      setText(els.playerStatus, playerHp <= 0 ? "Defeated" : "Victorious");
      setText(els.enemyStatus, enemyHp <= 0 ? "Defeated" : "Silent");
    } else {
      setText(els.playerStatus, statusLineForPlayer());
      setText(els.enemyStatus, statusLineForEnemy());
    }

    // Sprite states
    if (els.playerSprite) {
      els.playerSprite.classList.toggle("is-guarding", !state.over && state.player.guarding);
    }
    if (els.enemySprite) {
      els.enemySprite.classList.toggle("is-guarding", !state.over && state.enemy.guarding);
    }
    setEnemyVisuals();

    // Log
    if (els.log) {
      els.log.innerHTML = "";
      state.log.forEach((line) => {
        const li = document.createElement("li");
        li.textContent = line;
        els.log.appendChild(li);
      });
    }

    // Enable/disable actions
    const isPlayerTurn = !state.over && state.phase === "player";
    const disableActions = !isPlayerTurn;
    if (disableActions) {
      closeMagicMenu();
      closeInventoryMenu();
    }

    // Render spell menu with up-to-date enable/disable state.
    renderSpellMenu(spells, isPlayerTurn, focus, boundExtra);

    // Render items menu (inventory) with up-to-date enable/disable state.
    renderItemMenu(isPlayerTurn);

    // Render gear menu (equipment) with up-to-date enable/disable state.
    renderGearMenu(isPlayerTurn);

    const canHeal = isPlayerTurn && state.player.healCharges > 0 && focus >= healCost;

    if (els.attackBtn instanceof HTMLButtonElement) els.attackBtn.disabled = disableActions;
    if (els.guardBtn instanceof HTMLButtonElement) els.guardBtn.disabled = disableActions;
    const hasAnySpell = spells.length > 0;
    if (els.magicToggle instanceof HTMLButtonElement) els.magicToggle.disabled = disableActions || !hasAnySpell;

    if (els.inventoryToggle instanceof HTMLButtonElement) els.inventoryToggle.disabled = disableActions;
    if (els.inventoryItemsShortcut instanceof HTMLButtonElement) els.inventoryItemsShortcut.disabled = disableActions;
    if (els.healBtn instanceof HTMLButtonElement) els.healBtn.disabled = !canHeal;
    if (els.restartBtn instanceof HTMLButtonElement) els.restartBtn.disabled = false;
  }

  function endGame(message) {
    state.over = true;
    addLog(message);
    if (state.enemy.hp <= 0) playAnim(els.enemySprite, "rpgAnim-faint");
    if (state.player.hp <= 0) playAnim(els.playerSprite, "rpgAnim-faint");
    render();
    if (state.player.hp <= 0) {
      openDefeatScreen(message || "You were defeated.");
    }

  }

  // --------------------
  // Items: inventory + deterministic loot
  // --------------------

  /** @param {string} itemId @param {number} count */
  
  function awardCoins(amount, silent=false) {
    const n = Math.max(0, toSafeInt(amount, 0));
    if (!n || !state?.player) return 0;
    const prev = Math.max(0, toSafeInt(state.player.coins, 0));
    state.player.coins = clamp(prev + n, 0, 999999);
    if (!silent) addLog(`🪙 +${n} Coins.`);
    persistPlayerProgress();
    return n;
  }

  const SHOP_STOCK = [
    { id: "potion", cost: 8, label: "Heal up" },
    { id: "ether", cost: 10, label: "Mana refill" },
    { id: "cleanse", cost: 14, label: "Status clear" },
    { id: "bomb", cost: 18, label: "Big hit" },
  ];

  function isShopOpen() {
    return (els.shopModal instanceof HTMLElement) && !els.shopModal.hasAttribute("hidden");
  }

  function renderShop() {
    if (!(els.shopList instanceof HTMLElement)) return;
    const coins = Math.max(0, toSafeInt(state?.player?.coins, 0));
    if (els.shopCoins instanceof HTMLElement) {
      els.shopCoins.textContent = `🪙 ${coins} Coins`;
    }
    els.shopList.innerHTML = "";
    for (const it of SHOP_STOCK) {
      const def = ITEM_DEFS[it.id];
      if (!def) continue;
      const owned = Math.max(0, toSafeInt(state?.player?.items?.[it.id], 0));
      const canBuy = coins >= it.cost;
      const row = document.createElement("div");
      row.className = "rpgShopRow";
      row.setAttribute("role", "listitem");
      row.innerHTML = `
        <div class="rpgShopInfo">
          <div class="rpgShopName">${def.icon} ${def.name}</div>
          <div class="rpgShopDesc muted small">${def.desc}</div>
        </div>
        <div class="rpgShopMeta">
          <div class="rpgShopOwned muted tiny">Owned: ${owned}</div>
          <button type="button" class="btn rpgShopBuy ${canBuy ? 'primary' : 'ghost'}" ${canBuy ? '' : 'disabled'} data-buy="${it.id}">
            Buy <span class="rpgShopPrice">🪙 ${it.cost}</span>
          </button>
        </div>
      `;
      els.shopList.appendChild(row);
    }
  }

  function openShop() {
    if (!(els.shopModal instanceof HTMLElement)) return;
    closeMagicMenu();
    closeInventoryMenu();
    els.shopModal.removeAttribute("hidden");
    updateBodyModalOpen();
    renderShop();
    // Focus close button for keyboard users.
    if (els.shopCloseBtn instanceof HTMLButtonElement) els.shopCloseBtn.focus();
  }

  function closeShop() {
    if (!(els.shopModal instanceof HTMLElement)) return;
    els.shopModal.setAttribute("hidden", "");
    updateBodyModalOpen();
  }

  function buyFromShop(itemId) {
    const def = ITEM_DEFS[itemId];
    const entry = SHOP_STOCK.find((s) => s.id === itemId);
    if (!def || !entry) return;
    const coins = Math.max(0, toSafeInt(state?.player?.coins, 0));
    if (coins < entry.cost) return;
    state.player.coins = coins - entry.cost;
    gainItem(itemId, 1);
    addLog(`🛍️ Bought: ${def.icon} ${def.name} for 🪙 ${entry.cost}.`);
    persistPlayerProgress();
    renderShop();
    render();
  }

function gainItem(itemId, count = 1) {
    if (!ITEM_DEFS[itemId]) return;
    if (!state.player.items || typeof state.player.items !== "object") state.player.items = {};
    const prev = Math.max(0, toSafeInt(state.player.items[itemId], 0));
    const next = clamp(prev + Math.max(1, toSafeInt(count, 1)), 0, 99);
    state.player.items[itemId] = next;
    const def = ITEM_DEFS[itemId];
    addLog(`🎁 Found: ${def.icon} ${def.name} [${rarityLabel(def.rarity)}] (x${Math.max(1, toSafeInt(count, 1))}).`);
    persistPlayerProgress();
  }

  /** @param {string} itemId */
  function consumeItem(itemId) {
    const inv = state?.player?.items && typeof state.player.items === "object" ? state.player.items : {};
    const prev = Math.max(0, toSafeInt(inv[itemId], 0));
    if (prev <= 0) return false;
    const next = prev - 1;
    if (next <= 0) delete inv[itemId];
    else inv[itemId] = next;
    state.player.items = inv;
    persistPlayerProgress();
    return true;
  }

  /** @param {string} gearId */
  function gainGear(gearId, count = 1) {
    if (!GEAR_DEFS[gearId]) return;
    if (!state.player.gear || typeof state.player.gear !== "object") state.player.gear = {};
    const prev = Math.max(0, toSafeInt(state.player.gear[gearId], 0));
    const next = clamp(prev + Math.max(1, toSafeInt(count, 1)), 0, 99);
    state.player.gear[gearId] = next;
    const def = GEAR_DEFS[gearId];
    addLog(`🧰 Found gear: ${def.icon} ${def.name} [${rarityLabel(def.rarity)}] (x${Math.max(1, toSafeInt(count, 1))}).`);
    persistPlayerProgress();
  }


  /**
   * Award a one-time boss relic for the current location (per hero).
   * Returns the awarded gearId, or null if none/already claimed.
   * @param {string|null} locationId
   */
  function awardBossRelicIfEligible(locationId) {
    const res = awardCampaignBossClear(locationId);
    return res && res.gearId ? res.gearId : null;
  }

  /** @param {number} waveIndex */
  function lootForWave(waveIndex) {
    // Loot is split into: consumables + (rare) gear.
    // Items: equal chance per item, small chance of none.
    // Gear: fairly common (about 1 in 4 victories).
    const isBossWave = waveIndex >= 2;
    const result = { itemId: null, gearId: null };

    if (!isBossWave) {
      const NONE_CHANCE = 0.25;
      if (Math.random() >= NONE_CHANCE && Array.isArray(ITEM_IDS) && ITEM_IDS.length > 0) {
        const wanted = rollRarity(ITEM_RARITY_WEIGHTS);
        const pick = pickByRarity(ITEM_IDS_BY_RARITY, wanted);
        result.itemId = pick && ITEM_DEFS[pick] ? pick : null;
      }
    }

    // Gear chance: ~25% per cleared wave.
    // Note: we allow this on boss waves too so the overall feel stays consistent.
    const gearChance = 0.25;

    // Pick a slot first, then a random piece within that slot (keeps drops varied across Weapon/Armor/Trinket).
    if (Math.random() < gearChance && Array.isArray(GEAR_DROP_SLOTS) && GEAR_DROP_SLOTS.length > 0) {
      const slot = GEAR_DROP_SLOTS[Math.floor(Math.random() * GEAR_DROP_SLOTS.length)];
      const pools = GEAR_IDS_BY_SLOT_RARITY?.[slot];
      const wanted = rollRarity(GEAR_RARITY_WEIGHTS);
      const pick = pickByRarity(pools || /** @type {any} */ ({}), wanted);
      result.gearId = pick && GEAR_DEFS[pick] ? pick : null;
    }

    return result;
  }


  /**
   * Transition to next wave if available.
   */
  function advanceWave(defeatMessage) {
    if (state.over) return;

    addLog(defeatMessage);
    // Award XP for the defeated enemy (before swapping to the next wave).
    const xpRes = gainXp(xpForEnemy(state.enemy));

    // Play the badge-unlock SFX when you clear Wave 1.
    if (state.wave === 0) playWaveClearSfx();

    // Coins (shop currency)
    const coinsEarned = awardCoins(state.wave >= 2 ? 18 : (state.wave === 1 ? 10 : 8), true);

    // Loot: random consumable and (rarer) gear.
    const loot = lootForWave(state.wave);
    const parts = [];
    if (loot?.itemId) {
      const d = ITEM_DEFS[loot.itemId];
      if (d) {
        gainItem(loot.itemId, 1);
        parts.push(`${d.icon} ${d.name} [${rarityLabel(d.rarity)}] (x1)`);
      }
    }
    if (loot?.gearId) {
      const g = GEAR_DEFS[loot.gearId];
      if (g) {
        gainGear(loot.gearId, 1);
        parts.push(`${g.icon} ${g.name} [${rarityLabel(g.rarity)}] (Gear)`);
      }
    }

    if (coinsEarned > 0) {
      parts.push(`🪙 ${coinsEarned} Coins`);
    }

    const lootLine = () => parts.length ? `Picked up: ${parts.join(' + ')}` : 'No loot this time.';

    playAnim(els.enemySprite, "rpgAnim-faint");

    const nextIndex = state.wave + 1;
    const isFinal = nextIndex >= state.enemySet.length;

    // Campaign rewards / boss relics (one-time per location per hero)
    let bossRelicId = null;
    let artifactAward = null;
    let finalGateUnlockedNow = false;
    let campaignCompletedNow = false;
    if (isFinal && state.wave >= 2) {
      const beforeCampaign = getCampaignProgress(state.player);
      const clearRes = awardCampaignBossClear(state.locationId || null);
      bossRelicId = clearRes?.gearId || null;
      if (bossRelicId) {
        const rg = GEAR_DEFS[bossRelicId];
        if (rg) parts.unshift(`${rg.icon} ${rg.name} [${rarityLabel(rg.rarity)}] (Boss Relic)`);
      }
      if (clearRes?.newlyCleared && CAMPAIGN_DISTRICT_BY_ID[state.locationId || '']) {
        artifactAward = CAMPAIGN_DISTRICT_BY_ID[state.locationId || ''];
        parts.unshift(`${artifactAward.artifactIcon} ${artifactAward.artifactName} (Artifact)`);
      }
      const afterCampaign = getCampaignProgress(state.player);
      finalGateUnlockedNow = !beforeCampaign.finalUnlocked && afterCampaign.finalUnlocked;
      campaignCompletedNow = !beforeCampaign.campaignComplete && afterCampaign.campaignComplete;
    }

    // Lock controls and show the victory/loot screen until the player continues.
    setPhase("loot");
    const title = state.battleMode === 'approach-skirmish'
      ? 'Skirmish Cleared!'
      : (isFinal
          ? (state.locationId === FINAL_LOCATION_ID ? "Campaign Complete!" : (artifactAward ? `${artifactAward.artifactName} reclaimed!` : "Victory!"))
          : `Wave ${state.wave + 1} cleared!`);
    const subtitle = state.battleMode === 'approach-skirmish'
      ? 'The surprise encounter breaks and the side path falls quiet again.'
      : (state.locationId === FINAL_LOCATION_ID
          ? "The Palace falls quiet as the final guardian breaks."
          : (artifactAward
              ? `${artifactAward.bossName} falls, and the artifact is yours.`
              : "You collect your spoils."));
    const summary = [];
    if (xpRes && xpRes.leveled && xpRes.levelsGained > 0) {
      summary.push({ kind: "lvl", text: `🌟 Level ${xpRes.levelBefore} → ${xpRes.levelAfter}` });
    }
    if (coinsEarned > 0) {
      summary.push({ kind: "coin", text: `🪙 +${coinsEarned} Coins` });
    }
    if (xpRes && xpRes.spGained > 0) {
      const n = xpRes.spGained;
      summary.push({ kind: "sp", text: n === 1 ? "🧠 +1 Skill Point" : `🧠 +${n} Skill Points` });
    }
    if (xpRes && xpRes.pendingSpellChoices > 0) {
      const n = xpRes.pendingSpellChoices;
      summary.push({ kind: "spell", text: n === 1 ? "📜 New spell choice" : `📜 ${n} new spell choices` });
    }
    if (artifactAward) {
      summary.unshift({ kind: "artifact", text: `${artifactAward.artifactIcon} Artifact recovered: ${artifactAward.artifactName}` });
    }
    if (finalGateUnlockedNow) {
      summary.push({ kind: "unlock", text: "🔓 Palace unlocked" });
    }
    if (campaignCompletedNow) {
      summary.unshift({ kind: "campaign", text: "🏁 Campaign complete" });
    }

    openLootScreen(title, subtitle, lootLine(), summary);
    render();

    const myBattle = state.battleId;

    // Remember what should happen after the loot screen closes (Continue button).
    lootResolve = { battleId: myBattle, isFinal, nextIndex };
  }


  // --------------------
  // Turn flow
  // --------------------

  // Turn pacing: slow enough to read, fast enough to feel snappy.
  // NOTE: A short "status window" makes it clearer that burn/bind ticks are not
  // a second enemy attack.
  const TURN_DELAY_MS = prefersReducedMotion ? 120 : 650;      // after you act, before enemy acts
  const BETWEEN_TURN_MS = prefersReducedMotion ? 120 : 520;    // after enemy acts, before your turn begins
  const STATUS_WINDOW_MS = prefersReducedMotion ? 0 : 520;     // show status resolution before "Your turn"

  function setTurnBanner(text, who) {
    if (!(els.turnBanner instanceof HTMLElement)) return;
    els.turnBanner.textContent = text;
    els.turnBanner.classList.toggle("isPlayer", who === "player");
    els.turnBanner.classList.toggle("isEnemy", who === "enemy");
  }

  function setPhase(phase) {
    state.phase = phase;

    // New turn = items refresh (1 item per turn).
    if (phase === "player" && state && state.player) state.player.itemUsedThisTurn = false;
    const locked = phase !== "player" && !state.over;

    if (els.actionsWrap instanceof HTMLElement) {
      els.actionsWrap.classList.toggle("isLocked", locked);
    }

    // Lock/unlock action controls (Restart stays available).
    const lockBtn = (b, on) => {
      if (b instanceof HTMLButtonElement && b.id !== "restartBtn" && b.id !== "heroBtn") b.disabled = on;
    };
    lockBtn(els.attackBtn, locked);
    lockBtn(els.healBtn, locked);
    lockBtn(els.guardBtn, locked);
    lockBtn(els.magicToggle, locked);
    lockBtn(els.inventoryToggle, locked);
    lockBtn(els.inventoryItemsShortcut, locked);
    lockBtn(els.windBtn, locked);
    lockBtn(els.waterBtn, locked);
    lockBtn(els.soundBtn, locked);
    lockBtn(els.smellTasteBtn, locked);
    lockBtn(els.fireBtn, locked);
    lockBtn(els.explainBtn, locked);

    // Dynamic spell buttons inside the Magic menu.
    if (els.magicMenu instanceof HTMLElement) {
      els.magicMenu.querySelectorAll("button[data-spell-id]").forEach((b) => {
        if (b instanceof HTMLButtonElement) b.disabled = locked;
      });
    }

    // Dynamic buttons inside the Inventory menu.
    if (els.inventoryMenu instanceof HTMLElement) {
      els.inventoryMenu.querySelectorAll("button").forEach((b) => {
        if (b instanceof HTMLButtonElement) b.disabled = locked && b.id !== "restartBtn";
      });
    }

    if (locked) {
      closeMagicMenu();
      closeInventoryMenu();
    }

    if (phase === "player") setTurnBanner("Your turn", "player");
    else if (phase === "enemy") setTurnBanner("Enemy turn", "enemy");
    else if (phase === "hero") setTurnBanner("Choose a hero", null);
    else if (phase === "select") setTurnBanner("Choose a location", null);
    else setTurnBanner("Resolving…", "enemy");
  }

  function queueEnemyTurn() {
    if (isGameOver()) return;
    if (state.enemy.hp <= 0) return;

    setPhase("enemy");
    addLog("Enemy turn.");
    render();
    // This tiny pause is the whole point: it visually separates turns.
    window.setTimeout(() => {
      enemyTurn();
    }, TURN_DELAY_MS);
  }

  function queuePlayerTurn() {
    if (isGameOver()) return;
    if (state.enemy.hp <= 0) return;

    // Brief "in-between" phase so the next status tick doesn't look like
    // the enemy attacked twice.
    setPhase("resolving");
    render();
    window.setTimeout(() => {
      beginPlayerTurn();
    }, BETWEEN_TURN_MS);
  }


  function beginPlayerTurn() {
    if (isGameOver()) return;
    if (state.enemy.hp <= 0) return;

    const finishStart = () => {
      // Telegraph the next enemy move now (strategy).
      state.enemy.intent = computeEnemyIntent();
      renderIntent(state.enemy.intent);

      addLog("Your turn.");
      setPhase("player");
      render();
    };

    // Start-of-turn effects on player (shown as a separate mini-phase).
    if (state.player.burn > 0 && STATUS_WINDOW_MS > 0) {
      setPhase("resolving");
      setTurnBanner("Status effects", "player");
      addLog("Status effects resolve.");
      render();
      window.setTimeout(() => {
        tickBurn("player");
        if (state.player.hp <= 0) {
          endGame("The burn finishes you. Game over.");
          return;
        }
        finishStart();
      }, STATUS_WINDOW_MS);
      return;
    }

    tickBurn("player");
    if (state.player.hp <= 0) {
      endGame("The burn finishes you. Game over.");
      return;
    }
    finishStart();
  }

  function enemyTurn() {
    if (isGameOver()) return;
    if (state.enemy.hp <= 0) return;

    // Start-of-turn effects on enemy
    const didBurnTick = tickBurn("enemy");
    if (didBurnTick) render();
    if (state.enemy.hp <= 0) {
      advanceWave(`${state.enemy.name} collapses from lingering flame.`);
      return;
    }

    // If a burn tick happened, give it a brief moment to read before
    // the enemy's action banner appears (otherwise it gets overwritten).
    const continueEnemyTurn = () => {

    // Stun: skip the enemy's action once (burn already ticked above).
    if ((state.enemy.stunned ?? 0) > 0) {
      state.enemy.stunned = Math.max(0, toSafeInt(state.enemy.stunned, 0) - 1);
      showMoveBanner("Stunned", "Sight");
      addLog(`${state.enemy.name} is stunned and loses the turn.`);
      playAnim(els.enemySprite, "rpgAnim-guard");
      spawnFx("guard", "enemy");
      render();
      queuePlayerTurn();
      return;
    }


    // Enrage phase (deterministic)
    if (!state.enemy.enraged && state.enemy.hp <= Math.ceil(state.enemy.max * 0.4)) {
      state.enemy.enraged = true;
      addLog(`${state.enemy.name} hardens their stance (enraged).`);
    }

    const e = state.enemy;
    const p = state.player;

    /** @type {Intent} */
    let intent = e.intent || computeEnemyIntent();

    // Mana gating: if the planned move costs more Mana than the enemy has,
    // the enemy performs a basic Strike to build Mana and tries the same step next turn.
    const plannedCost = enemyManaCost(intent.id);
    const holdStep = plannedCost > 0 && e.focus < plannedCost;
    if (holdStep) {
      intent = { id: "attack", name: "Strike", type: "Sight", base: 4, note: "Builds Mana" };
    }

    // Show the enemy move name in the center (clear turn readability)
    // NOTE: Impact FX for elemental/types should appear on the *target* getting hit,
    // not on the caster. Wind impacts are spawned during damage resolution below,
    // so we intentionally avoid spawning Wind FX here.
    showMoveBanner(intent.name || "Enemy action", /** @type {MagicType} */ (intent.type || "Sight"));


    // Consume the step only if the intended move was executed
    if (!holdStep) e.aiStep += 1;

    // Pay or build Mana
    const cost = enemyManaCost(intent.id);
    if (cost > 0) spendEnemyFocus(cost);
    else gainEnemyFocus(1);

    // Execute intent
    if (intent.id === "heal") {
      const heal = scaledEnemyBase(6);
      const before = e.hp;
      e.hp = clamp(e.hp + heal, 0, e.max);
      const actual = e.hp - before;
      e.healCharges = Math.max(0, e.healCharges - 1);
      addLog(actual > 0 ? `${e.name} mends for ${actual} HP.` : `${e.name} tries to mend, but is already at full HP.`);
      playAnim(els.enemySprite, "rpgAnim-heal");
      spawnFx("heal", "enemy");
      if (actual > 0) spawnFloat(`+${actual}`, "enemy", "heal", null);
      render();
      queuePlayerTurn();
      return;
    }

    if (intent.id === "ward") {
      e.ward = 1;
      addLog(`${e.name} conjures a mirror ward.`);
      playAnim(els.enemySprite, "rpgAnim-guard");
      spawnFx("guard", "enemy");
      render();
      queuePlayerTurn();
      return;
    }

    if (intent.id === "fortify") {
      e.fortified = 1;
      addLog(`${e.name} fortifies their stance.`);
      playAnim(els.enemySprite, "rpgAnim-guard");
      spawnFx("guard", "enemy");
      render();
      queuePlayerTurn();
      return;
    }

    // Damage moves
    playAnim(els.enemySprite, "rpgAnim-attack");

    // Type FX telegraph (visual, not random)
    if (intent.id === "quake" || intent.id === "shatter") {
      stageShake();
      spawnFx("earthCenter", "center");
    }

    let base = scaledEnemyBase(intent.base + (e.enraged ? 1 : 0));

    // Gusted: deterministic -2 on next hit
    if (e.gusted) {
      base = Math.max(1, base - 2);
      e.gusted = false;
      addLog("A lingering gust throws off their focus (−2 damage).");
    }

    // Scented: deterministic -1 on next attacks
    if (e.scented > 0) {
      base = Math.max(1, base - 1);
      e.scented = Math.max(0, e.scented - 1);
      addLog("A clinging aroma dulls their strike (−1 damage).");
    }

    const moveType = /** @type {MagicType} */ (intent.type || "Sight");
    const typed = computeTypedDamage("enemy", "player", base, moveType, { ignoreEffectiveness: intent.id === "attack" });

    // Visual: show the type of what hits you.
    spawnFx(fxKindForType(moveType), "player");

    // Special flags for certain moves
    const flags = {
      quake: intent.id === "quake",
      shatter: intent.id === "shatter",
    };

    // Apply player defenses
    const afterDef = applyPlayerDefenses(typed.scaled, flags);
    p.hp = clamp(p.hp - afterDef, 0, p.max);

    addLog(`${e.name} uses ${intent.name} for ${afterDef} damage.`);
    if (typed.note) addLog(typed.note);
    setEffectBanner(`${typed.tierLabel}`, typed.bannerTone);
    playAnim(els.playerSprite, "rpgAnim-hit");
    spawnFloat(`-${afterDef}`, "player", "dmg", typed.eff);

    // Apply deterministic status effects
    if (intent.id === "ignite") {
      p.burn = Math.max(p.burn, 2);
      addLog("Flame clings to you (burn).");
    }

    if (intent.id === "surge") {
      let did = false;
      if (p.burn > 0) {
        p.burn = 0;
        did = true;
      }
      if (e.burn > 0) {
        e.burn = 0;
        did = true;
      }
      if (did) addLog("💧 The surge douses the flames.");
    }
    if (intent.id === "stonebind" || intent.id === "mirrorbind" || intent.id === "hushbind" || intent.id === "wavebind") {
  p.bound = 1;
  addLog(
    intent.id === "stonebind"
      ? "Stonebind locks your movement (bind)."
      : intent.id === "hushbind"
        ? "Hushbind seals your motion (bind)."
        : intent.id === "wavebind"
          ? "Wavebind tethers your limbs (bind)."
          : "Mirrorbind locks your movement (bind)."
  );
}
    if (intent.id === "siphon") {
      const heal = 3;
      e.hp = clamp(e.hp + heal, 0, e.max);
      addLog(`${e.name} siphons power and heals for ${heal}.`);
      spawnFx("heal", "enemy");
      spawnFloat(`+${heal}`, "enemy", "heal", null);
    }

    if (p.hp <= 0) {
      endGame("You collapse. Game over.");
      return;
    }

    render();
    queuePlayerTurn();
  }

    if (didBurnTick && STATUS_WINDOW_MS > 0) {
      window.setTimeout(continueEnemyTurn, STATUS_WINDOW_MS);
      return;
    }
    continueEnemyTurn();
  }

  // --------------------
  // Player actions (deterministic)
  // --------------------

  function onEnemyDown(message) {
    closeMagicMenu();
    if (state.enemy.hp > 0) return;
    advanceWave(message);
  }

  function spendFocus(cost) {
    state.player.focus = clamp(state.player.focus - cost, 0, state.player.focusMax);
  }

  function gainFocus(amount) {
    state.player.focus = clamp(state.player.focus + amount, 0, state.player.focusMax);
  }

  function spendEnemyFocus(cost) {
    if (cost <= 0) return;
    state.enemy.focus = clamp(state.enemy.focus - cost, 0, state.enemy.focusMax);
  }

  function gainEnemyFocus(amount) {
    if (amount <= 0) return;
    state.enemy.focus = clamp(state.enemy.focus + amount, 0, state.enemy.focusMax);
  }

  function clearBindIfAny() {
    if (state.player.bound > 0) {
      state.player.bound = 0;
      addLog("You shake off the bind.");
    }
  }

  function playerAttack() {
    if (isGameOver()) return;
    if (state.phase !== "player") return;
    closeMagicMenu();
    closeInventoryMenu();

    const atkType = playerPrimaryType();
    showMoveBanner("Attack", atkType);
    playAnim(els.playerSprite, "rpgAnim-attack");

    // Attack: fixed base, generates Mana (scaled by level)
    let base = scaledPlayerBase(5);

    // Bind weakens next move
    if (state.player.bound > 0) {
      base = Math.max(1, base - 2);
      state.player.bound = 0;
      addLog("Bind dulls your strike (−2).");
    }


    if (state.player.damageBoost > 1) {
      const before = base;
      base = Math.max(1, Math.round(base * state.player.damageBoost));
      state.player.damageBoost = 0;
      addLog(`🗡️ Power Rune empowers your damage (${before} → ${base}).`);
    }

    const typed = computeTypedDamage("player", "enemy", base, atkType, { ignoreEffectiveness: true });
    const def = applyEnemyDefenses(typed.scaled);

    state.enemy.hp = clamp(state.enemy.hp - def.final, 0, state.enemy.max);
    addLog(`You strike ${state.enemy.name} for ${def.final} damage.`);
    if (typed.note) addLog(typed.note);
    setEffectBanner(`${typed.tierLabel}`, typed.bannerTone);
    playAnim(els.enemySprite, "rpgAnim-hit");
    spawnFx(fxKindForType(atkType), "enemy");
    spawnFloat(`-${def.final}`, "enemy", "dmg", typed.eff);

    // Mirror reflect
    if (def.reflected > 0) {
      state.player.hp = clamp(state.player.hp - def.reflected, 0, state.player.max);
      addLog(`Reflected magic nicks you for ${def.reflected}.`);
      playAnim(els.playerSprite, "rpgAnim-hit");
      spawnFx("sight", "player");
      spawnFloat(`-${def.reflected}`, "player", "dmg", null);
      if (state.player.hp <= 0) {
        endGame("Reflected magic drops you. Game over.");
        return;
      }
    }

    gainFocus(1);

    if (state.enemy.hp <= 0) {
      onEnemyDown(`${state.enemy.name} falls.`);
      return;
    }

    render();

    queueEnemyTurn();
  }

  /**
   * Cast a spell by id (spells unlock automatically based on level).
   * @param {string} spellId
   */
  function playerCastSpell(spellId) {
    if (isGameOver()) return;
    if (state.phase !== "player") return;
    closeMagicMenu();
    closeInventoryMenu();

    const spell = SPELLS_BY_ID[spellId];
    if (!spell) {
      addLog("That spell isn't in your spellbook.");
      render();
      return;
    }

    if (!playerHasType(spell.type)) {
      addLog("Your hero can't use that kind of magic.");
      render();
      return;
    }

    const extra = state.player.bound > 0 ? 1 : 0;
    const cost = Math.max(0, toSafeInt(spell.baseCost, 0) + extra);
    if (state.player.focus < cost) {
      addLog("Not enough Mana.");
      render();
      return;
    }

    showMoveBanner(spell.name, spell.type);
    playAnim(els.playerSprite, "rpgAnim-attack");

    const hooksBefore = Array.isArray(spell.hooksBefore) ? spell.hooksBefore : [];
    const hooksAfter = Array.isArray(spell.hooksAfter) ? spell.hooksAfter : [];

    // Before-hit hooks
    if (hooksBefore.includes("breakDefenses")) {
      if (state.enemy.ward > 0 || state.enemy.fortified > 0 || state.enemy.guarding) {
        state.enemy.ward = 0;
        state.enemy.fortified = 0;
        state.enemy.guarding = false;
        addLog("You shatter the enemy's defenses.");
      }
    }

    // Damage is level-scaled.
    let base = scaledPlayerBase(toSafeInt(spell.baseDamage, 1));

    // Bind weakens next move (after cost is computed).
    if (state.player.bound > 0) {
      base = Math.max(1, base - 2);
      state.player.bound = 0;
      addLog("Bind dulls your spell (−2).");
    }


    if (state.player.damageBoost > 1) {
      const before = base;
      base = Math.max(1, Math.round(base * state.player.damageBoost));
      state.player.damageBoost = 0;
      addLog(`🗡️ Power Rune empowers your damage (${before} → ${base}).`);
    }

    const typed = computeTypedDamage("player", "enemy", base, spell.type);
    const piercePct = typeof spell.piercePct === "number" ? spell.piercePct : Number(spell.piercePct) || 0;
    const def = applyEnemyDefenses(typed.scaled, {
      piercePct,
      noReflect: !!spell.noReflect,
    });

    state.enemy.hp = clamp(state.enemy.hp - def.final, 0, state.enemy.max);

    addLog(`You cast ${spell.name} for ${def.final} damage.`);
    if (typed.note) addLog(typed.note);
    setEffectBanner(`${typed.tierLabel}`, typed.bannerTone);

    playAnim(els.enemySprite, "rpgAnim-hit");
    spawnFx(fxKindForType(spell.type), "enemy");
    spawnFloat(`-${def.final}`, "enemy", "dmg", typed.eff);

    // Mirror ward reflection (if any)
    if (def.reflected > 0) {
      state.player.hp = clamp(state.player.hp - def.reflected, 0, state.player.max);
      addLog(`Reflected magic nicks you for ${def.reflected}.`);
      playAnim(els.playerSprite, "rpgAnim-hit");
      spawnFx("sight", "player");
      spawnFloat(`-${def.reflected}`, "player", "dmg", null);
      if (state.player.hp <= 0) {
        endGame("Reflected magic drops you. Game over.");
        return;
      }
    }

    // After-hit hooks
    for (const hook of hooksAfter) {
      if (hook === "gusted") {
        state.enemy.gusted = true;
        addLog("💨 Gusted: enemy's next hit is softened.");
      } else if (hook === "evade") {
        state.player.evading = true;
        addLog("🕊️ Evading: your next hit is softened.");
        spawnFx("guard", "player");
      } else if (hook === "douse") {
        let did = false;
        if (state.enemy.burn > 0) {
          state.enemy.burn = 0;
          did = true;
        }
        if (state.player.burn > 0) {
          state.player.burn = 0;
          did = true;
        }
        if (did) addLog("💧 Flames are doused.");
      } else if (hook === "burn1" || hook === "burn2") {
        const n = hook === "burn1" ? 1 : 2;
        state.enemy.burn = Math.max(state.enemy.burn, n);
        addLog(`🔥 Burn applied (${n}).`);
      } else if (hook.startsWith("scent")) {
        const n = Math.max(0, toSafeInt(hook.replace("scent", ""), 0));
        if (n > 0) {
          state.enemy.scented = Math.max(state.enemy.scented, n);
          addLog(`👃 Scented (${n}).`);
        }
      } else if (hook.startsWith("mana+")) {
        const n = Math.max(0, toSafeInt(hook.replace("mana+", ""), 0));
        if (n > 0) {
          gainFocus(n);
          addLog(`✨ Mana +${n}.`);
        }
      } else if (hook.startsWith("heal+")) {
        const n = Math.max(0, toSafeInt(hook.replace("heal+", ""), 0));
        if (n > 0) {
          const before = state.player.hp;
          state.player.hp = clamp(state.player.hp + n, 0, state.player.max);
          const healed = state.player.hp - before;
          if (healed > 0) {
            addLog(`💚 Healed ${healed}.`);
            spawnFx("heal", "player");
            spawnFloat(`+${healed}`, "player", "heal", null);
          }
        }
      } else if (hook.startsWith("drainEnemyMana+")) {
        const n = Math.max(0, toSafeInt(hook.replace("drainEnemyMana+", ""), 0));
        if (n > 0) {
          const before = state.enemy.focus;
          spendEnemyFocus(n);
          const drained = Math.max(0, before - state.enemy.focus);
          if (drained > 0) addLog(`🔻 Drained ${drained} enemy Mana.`);
        }
      }
    }

    spendFocus(cost);

    if (state.enemy.hp <= 0) {
      onEnemyDown(`${state.enemy.name} is defeated.`);
      return;
    }

    render();
    queueEnemyTurn();
  }

  function playerWindAttack() {
    if (isGameOver()) return;
    if (state.phase !== "player") return;
    closeMagicMenu();

    if (!playerHasType("Wind")) {
      addLog("Your hero can't use Wind magic.");
      render();
      return;
    }

    const extra = state.player.bound > 0 ? 1 : 0;
    const cost = 2 + extra;
    if (state.player.focus < cost) {
      addLog("Not enough Mana.");
      render();
      return;
    }

    showMoveBanner("Wind attack", "Wind");
    playAnim(els.playerSprite, "rpgAnim-attack");

    let base = scaledPlayerBase(4);

    if (state.player.bound > 0) {
      base = Math.max(1, base - 2);
      state.player.bound = 0;
      addLog("Bind drags your wind blade (−2).");
    }


    if (state.player.damageBoost > 1) {
      const before = base;
      base = Math.max(1, Math.round(base * state.player.damageBoost));
      state.player.damageBoost = 0;
      addLog(`🗡️ Power Rune empowers your damage (${before} → ${base}).`);
    }

    const typed = computeTypedDamage("player", "enemy", base, "Wind");
    const def = applyEnemyDefenses(typed.scaled);

    state.enemy.hp = clamp(state.enemy.hp - def.final, 0, state.enemy.max);
    addLog(`You send a wind blade for ${def.final} damage.`);
    if (typed.note) addLog(typed.note);
    setEffectBanner(`${typed.tierLabel}`, typed.bannerTone);
    playAnim(els.enemySprite, "rpgAnim-hit");

    spawnFx("wind", "enemy");
    if (def.reflected > 0) {
      state.player.hp = clamp(state.player.hp - def.reflected, 0, state.player.max);
      addLog(`Reflected magic nicks you for ${def.reflected}.`);
      playAnim(els.playerSprite, "rpgAnim-hit");
      spawnFx("sight", "player");
      spawnFloat(`-${def.reflected}`, "player", "dmg", null);
      if (state.player.hp <= 0) {
        endGame("Reflected magic drops you. Game over.");
        return;
      }
    }

    // Deterministic tactical effects
    state.enemy.gusted = true;       // next enemy hit -2
    state.player.evading = true;     // next hit reduced
    addLog("Gust rattles their aim (next enemy hit −2).");
    addLog("An evasive veil surrounds you (next hit softened).");
    // The wind icon FX is reserved for the character being *hit* by a wind attack.
    // Use a neutral defensive shimmer to indicate your self-buff.
    spawnFx("guard", "player");

    spendFocus(cost);

    if (state.enemy.hp <= 0) {
      onEnemyDown(`${state.enemy.name} falls.`);
      return;
    }

    render();

    queueEnemyTurn();
  }

  function playerWaterAttack() {
    if (isGameOver()) return;
    if (state.phase !== "player") return;
    closeMagicMenu();

    if (!playerHasType("Water")) {
      addLog("Your hero can't use Water magic.");
      render();
      return;
    }

    const extra = state.player.bound > 0 ? 1 : 0;
    const cost = 2 + extra;

    if (state.player.focus < cost) {
      addLog("Not enough Mana.");
      render();
      return;
    }

    showMoveBanner("Water attack", "Water");
    playAnim(els.playerSprite, "rpgAnim-attack");

    let base = scaledPlayerBase(5);

    if (state.player.bound > 0) {
      base = Math.max(1, base - 2);
      state.player.bound = 0;
      addLog("Bind dulls your water lash (−2).");
    }


    if (state.player.damageBoost > 1) {
      const before = base;
      base = Math.max(1, Math.round(base * state.player.damageBoost));
      state.player.damageBoost = 0;
      addLog(`🗡️ Power Rune empowers your damage (${before} → ${base}).`);
    }

    const typed = computeTypedDamage("player", "enemy", base, "Water");
    const def = applyEnemyDefenses(typed.scaled);

    state.enemy.hp = clamp(state.enemy.hp - def.final, 0, state.enemy.max);
    addLog(`You crash water onto ${state.enemy.name} for ${def.final} damage.`);
    if (typed.note) addLog(typed.note);
    setEffectBanner(`${typed.tierLabel}`, typed.bannerTone);
    playAnim(els.enemySprite, "rpgAnim-hit");
    spawnFx("water", "enemy");
    spawnFloat(`-${def.final}`, "enemy", "dmg", typed.eff);

    // Mirror reflect (if any ward remained)
    if (def.reflected > 0) {
      state.player.hp = clamp(state.player.hp - def.reflected, 0, state.player.max);
      addLog(`Reflected magic nicks you for ${def.reflected}.`);
      playAnim(els.playerSprite, "rpgAnim-hit");
      spawnFx("sight", "player");
      spawnFloat(`-${def.reflected}`, "player", "dmg", null);
      if (state.player.hp <= 0) {
        endGame("Reflected magic drops you. Game over.");
        return;
      }
    }

    // Water utility: douse burns (yours and theirs).
    if (state.enemy.burn > 0) {
      state.enemy.burn = 0;
      addLog("Water douses the flames.");
    }
    if (state.player.burn > 0) {
      state.player.burn = 0;
      addLog("You douse your burn.");
    }

    spendFocus(cost);

    if (state.enemy.hp <= 0) {
      onEnemyDown(`${state.enemy.name} falls.`);
      return;
    }

    render();
    queueEnemyTurn();
  }

  function playerSoundAttack() {
    if (isGameOver()) return;
    if (state.phase !== "player") return;
    closeMagicMenu();

    if (!playerHasType("Sound")) {
      addLog("Your hero can't use Sound magic.");
      render();
      return;
    }

    const extra = state.player.bound > 0 ? 1 : 0;
    const cost = 2 + extra;

    if (state.player.focus < cost) {
      addLog("Not enough Mana.");
      render();
      return;
    }

    showMoveBanner("Sound attack", "Sound");
    playAnim(els.playerSprite, "rpgAnim-attack");

    let base = scaledPlayerBase(5);

    if (state.player.bound > 0) {
      base = Math.max(1, base - 2);
      state.player.bound = 0;
      addLog("Bind muddies your rhythm (−2).");
    }


    if (state.player.damageBoost > 1) {
      const before = base;
      base = Math.max(1, Math.round(base * state.player.damageBoost));
      state.player.damageBoost = 0;
      addLog(`🗡️ Power Rune empowers your damage (${before} → ${base}).`);
    }

    // Resonance disrupts defensive wards and braces before the hit lands.
    const had = state.enemy.ward > 0 || state.enemy.fortified > 0 || state.enemy.guarding;
    state.enemy.ward = 0;
    state.enemy.fortified = 0;
    state.enemy.guarding = false;
    if (had) addLog("Resonance shatters their defenses.");

    const typed = computeTypedDamage("player", "enemy", base, "Sound");
    const def = applyEnemyDefenses(typed.scaled);

    state.enemy.hp = clamp(state.enemy.hp - def.final, 0, state.enemy.max);
    addLog(`You unleash a sonic burst for ${def.final} damage.`);
    if (typed.note) addLog(typed.note);
    setEffectBanner(`${typed.tierLabel}`, typed.bannerTone);
    playAnim(els.enemySprite, "rpgAnim-hit");
    spawnFx("sound", "enemy");
    spawnFloat(`-${def.final}`, "enemy", "dmg", typed.eff);

    if (def.reflected > 0) {
      state.player.hp = clamp(state.player.hp - def.reflected, 0, state.player.max);
      addLog(`Reflected magic nicks you for ${def.reflected}.`);
      playAnim(els.playerSprite, "rpgAnim-hit");
      spawnFx("sight", "player");
      spawnFloat(`-${def.reflected}`, "player", "dmg", null);
      if (state.player.hp <= 0) {
        endGame("Reflected magic drops you. Game over.");
        return;
      }
    }

    spendFocus(cost);

    if (state.enemy.hp <= 0) {
      onEnemyDown(`${state.enemy.name} falls.`);
      return;
    }

    render();
    queueEnemyTurn();
  }

  
function playerSmellTasteAttack() {
  if (isGameOver()) return;
  if (state.phase !== "player") return;
  closeMagicMenu();

  if (!playerHasType("SmellTaste")) {
    addLog("Your hero can't use Smell/Taste magic.");
    render();
    return;
  }

  const extra = state.player.bound > 0 ? 1 : 0;
  const cost = 2 + extra;

  if (state.player.focus < cost) {
    addLog("Not enough Mana.");
    render();
    return;
  }

  showMoveBanner("Smell/Taste attack", "SmellTaste");
  playAnim(els.playerSprite, "rpgAnim-attack");

  let base = scaledPlayerBase(4);

  if (state.player.bound > 0) {
    base = Math.max(1, base - 2);
    state.player.bound = 0;
    addLog("Bind muddles your senses (−2).");
  }


  if (state.player.damageBoost > 1) {
    const before = base;
    base = Math.max(1, Math.round(base * state.player.damageBoost));
    state.player.damageBoost = 0;
    addLog(`🗡️ Power Rune empowers your damage (${before} → ${base}).`);
  }

  const typed = computeTypedDamage("player", "enemy", base, "SmellTaste");
  const def = applyEnemyDefenses(typed.scaled);

  state.enemy.hp = clamp(state.enemy.hp - def.final, 0, state.enemy.max);
  addLog(`You release an aroma hex for ${def.final} damage.`);
  if (typed.note) addLog(typed.note);
  setEffectBanner(`${typed.tierLabel}`, typed.bannerTone);
  playAnim(els.enemySprite, "rpgAnim-hit");
  spawnFx("smell", "enemy");
  spawnFloat(`-${def.final}`, "enemy", "dmg", typed.eff);

  // Mirror reflect (if any ward remained)
  if (def.reflected > 0) {
    state.player.hp = clamp(state.player.hp - def.reflected, 0, state.player.max);
    addLog(`Reflected magic nicks you for ${def.reflected}.`);
    playAnim(els.playerSprite, "rpgAnim-hit");
    spawnFx("sight", "player");
    spawnFloat(`-${def.reflected}`, "player", "dmg", null);
    if (state.player.hp <= 0) {
      endGame("Reflected magic drops you. Game over.");
      return;
    }
  }

  // Smell/Taste utility: dampen their next strikes (deterministic).
  state.enemy.scented = Math.max(state.enemy.scented || 0, 2);
  addLog("A clinging scent dulls their next strikes (scented).");

  spendFocus(cost);

  if (state.enemy.hp <= 0) {
    onEnemyDown(`${state.enemy.name} falls.`);
    return;
  }

  render();
  queueEnemyTurn();
}
function playerFireAttack() {
    if (isGameOver()) return;
    if (state.phase !== "player") return;
    closeMagicMenu();

    if (!playerHasType("Fire")) {
      addLog("Your hero can't use Fire magic.");
      render();
      return;
    }

    const extra = state.player.bound > 0 ? 1 : 0;
    const cost = 3 + extra;
    if (state.player.focus < cost) {
      addLog("Not enough Mana.");
      render();
      return;
    }

    showMoveBanner("Fire attack", "Fire");
    playAnim(els.playerSprite, "rpgAnim-attack");

    let base = scaledPlayerBase(6);

    if (state.player.bound > 0) {
      base = Math.max(1, base - 2);
      state.player.bound = 0;
      addLog("Bind makes your flame falter (−2).");
    }


    if (state.player.damageBoost > 1) {
      const before = base;
      base = Math.max(1, Math.round(base * state.player.damageBoost));
      state.player.damageBoost = 0;
      addLog(`🗡️ Power Rune empowers your damage (${before} → ${base}).`);
    }

    const typed = computeTypedDamage("player", "enemy", base, "Fire");
    const def = applyEnemyDefenses(typed.scaled);

    state.enemy.hp = clamp(state.enemy.hp - def.final, 0, state.enemy.max);
    addLog(`You hurl flame for ${def.final} damage.`);
    if (typed.note) addLog(typed.note);
    setEffectBanner(`${typed.tierLabel}`, typed.bannerTone);
    playAnim(els.enemySprite, "rpgAnim-hit");
    spawnFx("fire", "enemy");
    spawnFloat(`-${def.final}`, "enemy", "dmg", typed.eff);

    if (def.reflected > 0) {
      state.player.hp = clamp(state.player.hp - def.reflected, 0, state.player.max);
      addLog(`Reflected magic nicks you for ${def.reflected}.`);
      playAnim(els.playerSprite, "rpgAnim-hit");
      spawnFx("sight", "player");
      spawnFloat(`-${def.reflected}`, "player", "dmg", null);
      if (state.player.hp <= 0) {
        endGame("Reflected magic drops you. Game over.");
        return;
      }
    }

    // Always applies burn (no RNG)
    state.enemy.burn = Math.max(state.enemy.burn, 2);
    addLog(`${state.enemy.name} catches flame (burn).`);

    spendFocus(cost);

    if (state.enemy.hp <= 0) {
      onEnemyDown(`${state.enemy.name} falls.`);
      return;
    }

    render();

    queueEnemyTurn();
  }

  /** @param {MagicType} t */
  function magicBaseCost(t) {
    return t === "Fire" ? 3 : 2;
  }

  /** @param {MagicType} t */
  function magicBaseDamage(t) {
    if (t === "Fire") return 6;
    if (t === "Wind") return 4;
    if (t === "SmellTaste") return 4;
    if (t === "Touch") return 4;
    return 5;
  }

  /**
   * Secondary-type magic attack: only shown for secondary types that don't already
   * have a dedicated spell button (currently Sight/Earth/Touch).
   */
  function playerSecondaryTypeAttack() {
    if (isGameOver()) return;
    if (state.phase !== "player") return;
    closeMagicMenu();

    const t = Array.isArray(state.player.types) ? state.player.types[1] : null;
    if (!t) {
      addLog("No secondary type equipped.");
      render();
      return;
    }

    // If a dedicated spell exists, route to it (safety).
    if (t === "Wind") return playerWindAttack();
    if (t === "Water") return playerWaterAttack();
    if (t === "Sound") return playerSoundAttack();
    if (t === "SmellTaste") return playerSmellTasteAttack();
    if (t === "Fire") return playerFireAttack();

    if (!playerHasType(t)) {
      addLog(`Your hero can't use ${TYPE_META[t]?.label ?? t} magic.`);
      render();
      return;
    }

    const extra = state.player.bound > 0 ? 1 : 0;
    const cost = magicBaseCost(t) + extra;
    if (state.player.focus < cost) {
      addLog("Not enough Mana.");
      render();
      return;
    }

    const label = TYPE_META[t]?.label ?? t;
    showMoveBanner(`${label} attack`, t);
    playAnim(els.playerSprite, "rpgAnim-attack");

    let base = scaledPlayerBase(magicBaseDamage(t));
    if (state.player.bound > 0) {
      base = Math.max(1, base - 2);
      state.player.bound = 0;
      addLog("Bind blurs your casting (−2).");
    }


    if (state.player.damageBoost > 1) {
      const before = base;
      base = Math.max(1, Math.round(base * state.player.damageBoost));
      state.player.damageBoost = 0;
      addLog(`🗡️ Power Rune empowers your damage (${before} → ${base}).`);
    }

    const typed = computeTypedDamage("player", "enemy", base, t);
    const def = applyEnemyDefenses(typed.scaled);

    state.enemy.hp = clamp(state.enemy.hp - def.final, 0, state.enemy.max);
    addLog(`You channel ${label} magic for ${def.final} damage.`);
    if (typed.note) addLog(typed.note);
    setEffectBanner(`${typed.tierLabel}`, typed.bannerTone);
    playAnim(els.enemySprite, "rpgAnim-hit");
    spawnFx(fxKindForType(t), "enemy");
    spawnFloat(`-${def.final}`, "enemy", "dmg", typed.eff);

    if (def.reflected > 0) {
      state.player.hp = clamp(state.player.hp - def.reflected, 0, state.player.max);
      addLog(`Reflected magic nicks you for ${def.reflected}.`);
      playAnim(els.playerSprite, "rpgAnim-hit");
      spawnFx("sight", "player");
      spawnFloat(`-${def.reflected}`, "player", "dmg", null);
      if (state.player.hp <= 0) {
        endGame("Reflected magic drops you. Game over.");
        return;
      }
    }

    spendFocus(cost);

    if (state.enemy.hp <= 0) {
      onEnemyDown(`${state.enemy.name} falls.`);
      return;
    }

    render();
    queueEnemyTurn();
  }

  function playerHeal() {
    if (isGameOver()) return;
    if (state.phase !== "player") return;
    closeMagicMenu();
    closeInventoryMenu();

    const extra = state.player.bound > 0 ? 1 : 0;
    const cost = 1 + extra;

    if (state.player.healCharges <= 0) {
      addLog("Your healing focus is spent.");
      render();
      return;
    }
    if (state.player.focus < cost) {
      addLog("Not enough Mana.");
      render();
      return;
    }

    showMoveBanner("Heal", "Touch");
    playAnim(els.playerSprite, "rpgAnim-heal");
    spawnFx("heal", "player");

    const healMult = typeof state.player.healMult === "number" ? state.player.healMult : 1;

    // Healing should be a meaningful tempo choice, not a button that gets erased immediately.
    // Scale primarily off Max HP (so it stays relevant), with a small level/gear multiplier.
    const maxHp = Math.max(1, toSafeInt(state.player.max, 1));
    const hpRatio = maxHp > 0 ? state.player.hp / maxHp : 1;

    // Baseline: ~28% max HP + a small scaling term.
    let heal = Math.round(maxHp * 0.28 + 4 * healMult);

    // Emergency bump when you're low.
    if (hpRatio <= 0.35) heal += Math.round(maxHp * 0.08);

    heal = Math.max(1, heal);
    const before = state.player.hp;
    state.player.hp = clamp(state.player.hp + heal, 0, state.player.max);
    const actual = state.player.hp - before;

    if (actual > 0) spawnFloat(`+${actual}`, "player", "heal", null);

    state.player.healCharges = Math.max(0, state.player.healCharges - 1);
    spendFocus(cost);

    // A small "afterglow" shield so healing isn't immediately undone by the enemy's next swing.
    // Uses the existing Barrier status (next hit −30%).
    if (!(state.player.barrier > 0)) {
      state.player.barrier = 1;
      spawnFx("guard", "player");
      addLog("🛡️ A gentle ward settles around you (next hit −30%).");
    }

    // Cleanse one negative (strategy lever)
    if (state.player.burn > 0) {
      state.player.burn = 0;
      addLog("You cleanse the burn.");
    }
    clearBindIfAny();

    addLog(actual > 0 ? `You heal for ${actual} HP.` : "You try to heal, but you're already at full HP.");

    render();

    queueEnemyTurn();
  }

  function playerGuard() {
    if (isGameOver()) return;
    if (state.phase !== "player") return;
    closeMagicMenu();
    closeInventoryMenu();

    if (!state.player.guarding) {
      state.player.guarding = true;
      showMoveBanner("Guard", "Wind");
      addLog("You raise your guard (+1 Mana).");
      playAnim(els.playerSprite, "rpgAnim-guard");
      spawnFx("guard", "player");
      gainFocus(1);

      // Guarding breaks bind immediately (a clear decision).
      clearBindIfAny();
    } else {
      addLog("You're already guarding.");
    }

    render();

    queueEnemyTurn();
  }

  /** @param {string} itemId */
  function playerUseItem(itemId) {
    if (isGameOver()) return;
    if (state.phase !== "player") return;

    if (state.player.itemUsedThisTurn) {
      addLog("You already used an item this turn.");
      render();
      return;
    }

    closeMagicMenu();


    const def = ITEM_DEFS[itemId];
    if (!def) {
      addLog("That item doesn't exist.");
      render();
      return;
    }

    const inv = state?.player?.items && typeof state.player.items === "object" ? state.player.items : {};
    const have = Math.max(0, toSafeInt(inv[itemId], 0));
    if (have <= 0) {
      addLog(`You don't have any ${def.name} left.`);
      render();
      return;
    }

    if (!itemCanUse(itemId)) {
      // Don't waste it.
      addLog(`${def.name} would have no effect right now.`);
      render();
      return;
    }

    // Consume first so the UI stays honest even if something throws later.
    if (!consumeItem(itemId)) {
      addLog(`You don't have any ${def.name} left.`);
      render();
      return;
    }
    // Apply effect (simple + readable)
    if (itemId === "potion") {
      const amount = 7;
      const before = state.player.hp;
      state.player.hp = clamp(state.player.hp + amount, 0, state.player.max);
      const actual = state.player.hp - before;
      showMoveBanner(`${def.name}`, "Touch");
      playAnim(els.playerSprite, "rpgAnim-heal");
      spawnFx("heal", "player");
      if (actual > 0) spawnFloat(`+${actual}`, "player", "heal", null);
      addLog(`You use ${def.name} (+${actual} HP).`);
    } else if (itemId === "ether") {
      const before = state.player.focus;
      gainFocus(2);
      const actual = state.player.focus - before;
      showMoveBanner(`${def.name}`, "Sight");
      playAnim(els.playerSprite, "rpgAnim-heal");
      spawnFx("sight", "player");
      addLog(`You use ${def.name} (+${actual} Mana).`);
    } else if (itemId === "cleanse") {
      const b = Math.max(0, toSafeInt(state.player.burn, 0));
      const bd = Math.max(0, toSafeInt(state.player.bound, 0));
      state.player.burn = 0;
      state.player.bound = 0;
      showMoveBanner(`${def.name}`, "Touch");
      playAnim(els.playerSprite, "rpgAnim-heal");
      spawnFx("touch", "player");
      const parts = [];
      if (b > 0) parts.push("Burn");
      if (bd > 0) parts.push("Bind");
      addLog(`You use ${def.name} (cleared ${parts.join(" and ")}).`);
    } else if (itemId === "bomb") {
      const dmg = 6;
      showMoveBanner(`${def.name}`, "Fire");
      playAnim(els.playerSprite, "rpgAnim-attack");
      spawnFx("fire", "enemy");
      state.enemy.hp = clamp(state.enemy.hp - dmg, 0, state.enemy.max);
      addLog(`You throw a ${def.name} for ${dmg} damage.`);
      spawnFloat(`-${dmg}`, "enemy", "dmg", null);
      playAnim(els.enemySprite, "rpgAnim-hit");
    } else if (itemId === "ember") {
      showMoveBanner(`${def.name}`, "Fire");
      playAnim(els.playerSprite, "rpgAnim-attack");
      spawnFx("fire", "enemy");
      state.enemy.burn = Math.max(toSafeInt(state.enemy.burn, 0), 2);
      addLog(`🔥 ${def.name} coats ${state.enemy.name} (burn 2).`);
    } else if (itemId === "stun") {
      showMoveBanner(`${def.name}`, "Sound");
      playAnim(els.playerSprite, "rpgAnim-attack");
      spawnFx("sound", "enemy");
      state.enemy.stunned = Math.max(toSafeInt(state.enemy.stunned, 0), 1);
      addLog(`🌫️ ${state.enemy.name} staggers (stunned).`);
    } else if (itemId === "rune") {
      showMoveBanner(`${def.name}`, "Sight");
      playAnim(els.playerSprite, "rpgAnim-heal");
      spawnFx("sight", "player");
      state.player.damageBoost = 1.3;
      addLog(`🗡️ ${def.name} flares (next damage x1.3).`);
    } else if (itemId === "barrier") {
      showMoveBanner(`${def.name}`, "Earth");
      playAnim(els.playerSprite, "rpgAnim-guard");
      spawnFx("guard", "player");
      state.player.barrier = 1;
      addLog(`🛡️ ${def.name} surrounds you (next hit −30%).`);
    }

    state.player.itemUsedThisTurn = true;

    if (state.enemy.hp <= 0) {
      onEnemyDown(`${state.enemy.name} is defeated.`);
      return;
    }

    addLog("Choose an action.");
    render();
  }

  /** @param {string} gearId */
    /**
   * Equip a piece of gear into its slot (or a slot override).
   * @param {string} gearId
   * @param {"weapon"|"armor"|"trinket"|null} slotOverride
   */
  function playerEquipGear(gearId, slotOverride = null) {
    if (isGameOver()) return;
    if (state.phase !== "player") return;

    closeMagicMenu();
    // Keep Inventory open so you can rapidly swap/compare equipment.

    const def = GEAR_DEFS[gearId];
    if (!def) {
      addLog("That gear doesn't exist.");
      render();
      return;
    }

    const inv = state?.player?.gear && typeof state.player.gear === "object" ? state.player.gear : {};
    const have = Math.max(0, toSafeInt(inv[gearId], 0));
    if (have <= 0) {
      addLog(`You don't own ${def.name}.`);
      render();
      return;
    }

    const slot = slotOverride || def.slot;
    if (slot !== def.slot) {
      addLog(`${def.icon} ${def.name} doesn't fit that slot.`);
      render();
      return;
    }

    state.player.gear = sanitizeGearCounts(state.player.gear);
    state.player.equipSlots = sanitizeEquipSlots(state.player.equipSlots ?? state.player.equip, state.player.gear);

    const prev = state.player.equipSlots[slot];

    if (prev === gearId) {
      addLog(`You're already using ${def.icon} ${def.name} as your ${EQUIP_SLOT_LABEL[slot]}.`);
      render();
      return;
    }

    state.player.equipSlots[slot] = gearId;

    // Legacy compatibility: keep `equip` as the trinket for older code paths.
    state.player.equip = state.player.equipSlots.trinket;

    syncPlayerLevel(false);
    persistPlayerProgress();

    if (prev && GEAR_DEFS[prev]) {
      addLog(`🧰 ${EQUIP_SLOT_LABEL[slot]}: replaced ${GEAR_DEFS[prev].icon} ${GEAR_DEFS[prev].name} with ${def.icon} ${def.name}.`);
    } else {
      addLog(`🧰 ${EQUIP_SLOT_LABEL[slot]} equipped: ${def.icon} ${def.name}.`);
    }

    render();
  }

  /** @param {"weapon"|"armor"|"trinket"} slot */
  function playerUnequipGear(slot) {
    if (isGameOver()) return;
    if (state.phase !== "player") return;

    closeMagicMenu();
    // Keep Inventory open so you can rapidly swap/compare equipment.

    state.player.gear = sanitizeGearCounts(state.player.gear);
    state.player.equipSlots = sanitizeEquipSlots(state.player.equipSlots ?? state.player.equip, state.player.gear);

    const curId = state.player.equipSlots[slot];
    if (!curId || !GEAR_DEFS[curId]) {
      addLog(`No ${EQUIP_SLOT_LABEL[slot]} equipped.`);
      render();
      return;
    }

    const cur = GEAR_DEFS[curId];
    state.player.equipSlots[slot] = null;

    // Legacy compatibility
    state.player.equip = state.player.equipSlots.trinket;

    syncPlayerLevel(false);
    persistPlayerProgress();
    addLog(`🧰 ${EQUIP_SLOT_LABEL[slot]} unequipped: ${cur.icon} ${cur.name}.`);
    render();
  }


  function restartToHeroSelect() {
    __exitBossMusic();
    closeMagicMenu();
    closeInventoryMenu();
    closeHeroPicker();
    closeLocationPicker();
    lootResolve = null;
    if (isLootOpen()) closeLootScreen();
    if (lootTimer) window.clearTimeout(lootTimer);
    lootTimer = 0;
    if (isDefeatOpen()) closeDefeatScreen();
    resetVisuals();
    state = makeLobbyState();
    syncKnownSpells(false);
    renderIntent(null);
    setEffectBanner("—", "neutral");
    render();
    openHeroPicker();
  }

  function restart() {
    __exitBossMusic();
    closeMagicMenu();
    closeInventoryMenu();
    closeHeroPicker();
    closeLocationPicker();
    lootResolve = null;
    if (isLootOpen()) closeLootScreen();
    if (lootTimer) window.clearTimeout(lootTimer);
    lootTimer = 0;
    if (isDefeatOpen()) closeDefeatScreen();
    resetVisuals();
    state = makeLobbyState();
  syncKnownSpells(false);
    renderIntent(null);
    setEffectBanner("—", "neutral");
    setPhase("select");
    render();
    openLocationPicker();
  }


  // --------------------
  // Wire up events
  // --------------------

  if (els.magicToggle instanceof HTMLButtonElement) {
    els.magicToggle.addEventListener("click", toggleMagicMenu);
  }

  if (els.inventoryToggle instanceof HTMLButtonElement) {
    els.inventoryToggle.addEventListener("click", toggleInventoryMenu);
  }

  
  // --------------------
  // Overworld wiring (movement + battle)
  // --------------------

  // Click a battle marker to snap to it.
  if (els.locationChoices instanceof HTMLElement) {
    els.locationChoices.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;

      // Bubble actions (Battle / Shop) live inside the map frame.
      const actionBtn = t.closest('button[data-ow-action]');
      if (actionBtn instanceof HTMLButtonElement) {
        const action = actionBtn.getAttribute('data-ow-action');
        if (action === 'battle') {
          const loc = getBattleableOverworldLocation();
          if (!loc) return;
          e.preventDefault();
          e.stopPropagation();
          renderLocationApproach(loc.id);
          return;
        }
        if (action === 'shop') {
          const loc = getBattleableOverworldLocation();
          const shopId = nearestShopLocation();
          if (loc || !shopId) return;
          e.preventDefault();
          e.stopPropagation();
          openShop();
          return;
        }
      }

      const btn = t.closest('button[data-ow-loc]');
      if (!(btn instanceof HTMLButtonElement)) return;
      const id = btn.getAttribute('data-ow-loc');
      if (!id) return;
      const pos = getOverworldPos(id);
      if (pos) {
        setOverworldTarget(pos.leftPct, pos.topPct);
        ensureOverworldAnimation();
        updateOverworldUI();
        renderOverworldPositions();
      }
    });
  }
  if (els.overworldBattleBtn instanceof HTMLButtonElement) {
    els.overworldBattleBtn.addEventListener("click", () => {
      const loc = getBattleableOverworldLocation();
      if (!loc) return;
      renderLocationApproach(loc.id);
    });
  }

  // Open the shop when standing on the shop marker.
  if (els.overworldShopBtn instanceof HTMLButtonElement) {
    els.overworldShopBtn.addEventListener("click", () => {
      const loc = getBattleableOverworldLocation();
      const shopId = nearestShopLocation();
      // Keep precedence consistent with the UI: battle wins if available.
      if (loc || !shopId) return;
      openShop();
    });
  }

  // Back button (close the overworld modal)
  if (els.overworldBackBtn instanceof HTMLButtonElement) {
    els.overworldBackBtn.addEventListener("click", () => {
      closeLocationPicker();
    });
  }

  const bindMoveBtn = (btn, dx, dy) => {
    if (!(btn instanceof HTMLButtonElement)) return;
    btn.addEventListener("click", () => moveOverworld(dx, dy));
  };

  bindMoveBtn(els.owUp, 0, -1);
  bindMoveBtn(els.owDown, 0, 1);
  bindMoveBtn(els.owLeft, -1, 0);
  bindMoveBtn(els.owRight, 1, 0);

  // Keyboard traversal while the overworld modal is open.
  document.addEventListener("keydown", (e) => {
    if (!isLocationOpen()) return;
    if (isShopOpen()) return;
    const t = e.target;
    if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;

    const k = e.key;
    const map = {
      "w": "up",
      "s": "down",
      "a": "left",
      "d": "right",
      "W": "up",
      "S": "down",
      "A": "left",
      "D": "right",
      "ArrowUp": "up",
      "ArrowDown": "down",
      "ArrowLeft": "left",
      "ArrowRight": "right",
    };

    if (isApproachOpen()) {
      if (k === 'Escape') {
        e.preventDefault();
        renderLocationChoices();
        renderOverworldPositions();
        return;
      }
      if (k === 'Enter') {
        e.preventDefault();
        if (APPROACH.nearGate && APPROACH.locationId) startBattleWithLocation(APPROACH.locationId);
        return;
      }
      if (k === 'e' || k === 'E') {
        e.preventDefault();
        triggerApproachPrimaryAction();
        return;
      }
      const dir = map[k];
      if (!dir) return;
      e.preventDefault();
      const wasHeld = !!APPROACH.keys[dir];
      APPROACH.keys[dir] = true;
      APPROACH.preferredDir = dir;
      APPROACH.queuedDir = dir;
      APPROACH.pathTiles = [];
      // Let the animation loop handle held-key repetition. Browser key-repeat
      // events can arrive while a tile step is still animating, which would
      // otherwise keep restarting the same move and make long holds stall out.
      if (!wasHeld && !APPROACH.moving && !APPROACH.pathTiles.length) {
        attemptApproachStep(dir);
      }
      ensureLocationApproachAnimation();
      return;
    }

    if (k === "+" || k === "=") {
      e.preventDefault();
      setOverworldZoom(OVERWORLD.worldScale + 0.15);
      return;
    }
    if (k === "-" || k === "_") {
      e.preventDefault();
      setOverworldZoom(OVERWORLD.worldScale - 0.15);
      return;
    }
    if (k === "Enter") {
      const loc = getBattleableOverworldLocation();
      const shopId = nearestShopLocation();
      if (loc) {
        e.preventDefault();
        renderLocationApproach(loc.id);
      } else if (shopId) {
        e.preventDefault();
        openShop();
      }
      return;
    }
    const dir = map[k];
    if (!dir) return;
    e.preventDefault();
    OVERWORLD.keys[dir] = true;
    ensureOverworldAnimation();
  });

  document.addEventListener("keyup", (e) => {
    const map = {
      "w": "up",
      "s": "down",
      "a": "left",
      "d": "right",
      "W": "up",
      "S": "down",
      "A": "left",
      "D": "right",
      "ArrowUp": "up",
      "ArrowDown": "down",
      "ArrowLeft": "left",
      "ArrowRight": "right",
    };
    const dir = map[e.key];
    if (!dir) return;
    if (isApproachOpen()) {
      APPROACH.keys[dir] = false;
      if (APPROACH.queuedDir === dir) APPROACH.queuedDir = null;
      if (APPROACH.preferredDir === dir) APPROACH.preferredDir = getApproachHeldDir();
      return;
    }
    OVERWORLD.keys[dir] = false;
  });

  window.addEventListener('resize', () => {
    if (!isLocationOpen()) return;
    renderOverworldPositions();
  });

  // Shop modal bindings
  const returnFocusToOverworld = () => {
    if (els.locationModal instanceof HTMLElement && !els.locationModal.hasAttribute("hidden")) {
      // Return focus to an overworld control (prefer the on-map bubble buttons).
      const bubble = (els.locationChoices instanceof HTMLElement)
        ? els.locationChoices.querySelector('#owBubble')
        : null;
      const bubbleShop = (bubble instanceof HTMLElement)
        ? bubble.querySelector('button[data-ow-action="shop"]:not([hidden])')
        : null;
      const bubbleBattle = (bubble instanceof HTMLElement)
        ? bubble.querySelector('button[data-ow-action="battle"]:not([hidden])')
        : null;

      if (bubbleShop instanceof HTMLButtonElement) bubbleShop.focus({ preventScroll: true });
      else if (bubbleBattle instanceof HTMLButtonElement) bubbleBattle.focus({ preventScroll: true });
      else {
        const modalInner = els.locationModal.querySelector('.rpgModalInner');
        if (modalInner instanceof HTMLElement) modalInner.focus({ preventScroll: true });
      }
    }
  };

  if (els.shopCloseBtn instanceof HTMLButtonElement) {
    els.shopCloseBtn.addEventListener("click", () => {
      closeShop();
      returnFocusToOverworld();
    });
  }

  if (els.shopXBtn instanceof HTMLButtonElement) {
    els.shopXBtn.addEventListener("click", () => {
      closeShop();
      returnFocusToOverworld();
    });
  }

  if (els.shopList instanceof HTMLElement) {
    els.shopList.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const btn = t.closest("button[data-buy]");
      if (!(btn instanceof HTMLButtonElement)) return;
      const id = btn.getAttribute("data-buy");
      if (!id) return;
      buyFromShop(id);
    });
  }


  // Inventory menu: tabs + items + gear actions
  if (els.inventoryMenu instanceof HTMLElement) {
    els.inventoryMenu.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

	      // Tabs (Gear / Items)
	      const tabBtn = target.closest('button[data-inv-tab]');
	      if (tabBtn instanceof HTMLButtonElement) {
	        const tab = tabBtn.getAttribute('data-inv-tab');
	        if (tab === 'gear' || tab === 'items') {
	          setInventoryTab(tab);
	          if (tab === 'items' && (els.inventoryItemsPane instanceof HTMLElement)) {
	            els.inventoryItemsPane.scrollTop = 0;
	            window.setTimeout(() => {
	              const b = els.inventoryItemsPane.querySelector('button:not([disabled])');
	              if (b instanceof HTMLButtonElement) b.focus({ preventScroll: true });
	            }, 0);
	          }
	          if (tab === 'gear' && (els.inventoryGearPane instanceof HTMLElement)) {
	            els.inventoryGearPane.scrollTop = 0;
	            window.setTimeout(() => {
	              const b = els.inventoryGearPane.querySelector('button:not([disabled])');
	              if (b instanceof HTMLButtonElement) b.focus({ preventScroll: true });
	            }, 0);
	          }
	        }
	        return;
	      }

      // Items
      const itemBtn = target.closest("button[data-item-id]");
      if (itemBtn instanceof HTMLButtonElement) {
        const id = itemBtn.getAttribute("data-item-id");
        if (id) playerUseItem(id);
        return;
      }

      // Gear
      const gearBtn = target.closest("button[data-gear-action]");
      if (gearBtn instanceof HTMLButtonElement) {
        const action = gearBtn.getAttribute("data-gear-action");
        if (action === "unequip-slot") {
          const slot = gearBtn.getAttribute("data-gear-slot");
          if (slot === "weapon" || slot === "armor" || slot === "trinket") {
            playerUnequipGear(slot);
          }
          return;
        }

        const id = gearBtn.getAttribute("data-gear-id");
        if (id) playerEquipGear(id);
      }
    });
  }

  // Dynamic spell menu: buttons are generated each render.
  if (els.magicMenu instanceof HTMLElement) {
    els.magicMenu.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const btn = target.closest("button[data-spell-id]");
      if (!(btn instanceof HTMLButtonElement)) return;
      const id = btn.getAttribute("data-spell-id");
      if (!id) return;
      playerCastSpell(id);
    });

    const preview = (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const btn = target.closest("button[data-spell-id]");
      if (!(btn instanceof HTMLButtonElement)) {
        clearEffectPreview();
        return;
      }
      const id = btn.getAttribute("data-spell-id");
      if (!id) return;
      const sp = SPELLS_BY_ID[id];
      if (!sp) return;
      const extra = (() => {
        const s = spellHookSummary(sp);
        if (!s || s === "A direct damage spell.") return "";
        return s;
      })();
      setPreviewMove(sp.name, sp.type, sp.baseCost, toSafeInt(sp.baseDamage, 0), extra, btn);
    };

    els.magicMenu.addEventListener("mouseover", preview);
    els.magicMenu.addEventListener("focusin", preview);
    els.magicMenu.addEventListener("mouseleave", clearEffectPreview);
    els.magicMenu.addEventListener("focusout", (e) => {
      const rt = /** @type {any} */ (e).relatedTarget;
      if (!(rt instanceof Node) || !els.magicMenu.contains(rt)) clearEffectPreview();
    });
  }

  if (els.attackBtn instanceof HTMLButtonElement) els.attackBtn.addEventListener("click", playerAttack);
  if (els.healBtn instanceof HTMLButtonElement) els.healBtn.addEventListener("click", playerHeal);
  if (els.guardBtn instanceof HTMLButtonElement) els.guardBtn.addEventListener("click", playerGuard);
  if (els.restartBtn instanceof HTMLButtonElement) els.restartBtn.addEventListener("click", restart);


  if (els.heroBtn instanceof HTMLButtonElement) {
        els.heroBtn.addEventListener("click", () => {
      restartToHeroSelect();
    });
  }


  if (els.defeatRestartBtn instanceof HTMLButtonElement) {
    els.defeatRestartBtn.addEventListener("click", () => {
      restartToHeroSelect();
    });
  }

  if (els.characterChoices instanceof HTMLElement) {
    els.characterChoices.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const btn = target.closest("button[data-hero]");
      if (!(btn instanceof HTMLButtonElement)) return;
      const id = btn.getAttribute("data-hero");
      if (!id) return;
      pendingHeroId = id;
      renderHeroChoices();
    });
  }
  if (els.characterOk instanceof HTMLButtonElement) els.characterOk.addEventListener("click", confirmHeroSelection);
  if (els.characterClose instanceof HTMLButtonElement) els.characterClose.addEventListener("click", confirmHeroSelection);

  if (els.resetProgressBtn instanceof HTMLButtonElement) {
    els.resetProgressBtn.addEventListener("click", () => {
      const id = pendingHeroId || activeHeroId;
      if (!id) return;
      const hero = getHeroById(id);
      const baseSpells = startingSpellIdsFor(hero.types);
      saveHeroProgress(id, {
        level: 1,
        xp: 0,
        spells: baseSpells,
        items: { ...STARTING_ITEMS },
        gear: { ...STARTING_GEAR },
        equip: "apprentice_ring",
      });
      addLog(`Progress reset for ${hero.name}.`);

      if (state?.player?.id === id) {
        state.player.level = 1;
        state.player.xp = 0;
        state.player.xpToNext = xpToNext(1);
        state.player.spells = baseSpells;
        state.player.pendingSpellQueue = [];
        state.player.items = { ...STARTING_ITEMS };
        state.player.gear = { ...STARTING_GEAR };
        state.player.equipSlots = { weapon: null, armor: null, trinket: "apprentice_ring" };
        state.player.equip = "apprentice_ring";
        syncPlayerLevel(false);
        syncKnownSpells(false);
      }

      renderHeroChoices();
      setEffectBanner("Hero progress reset.", "neutral");
      render();
    });
  }

  
  // Effectiveness preview (hover/focus shows tiered effectiveness before you click)
  /**
   * @param {HTMLElement|null} btn
   * @param {string | (() => string)} nameOrFn
   * @param {MagicType | (() => MagicType)} typeOrFn
   * @param {number | (() => number)} baseCostOrFn
   */
  const wirePreview = (btn, nameOrFn, typeOrFn, baseCostOrFn, basePowerOrFn = 0) => {
    if (!(btn instanceof HTMLElement)) return;
    const resolveName = () => (typeof nameOrFn === "function" ? nameOrFn() : nameOrFn);
    const resolveType = () => (typeof typeOrFn === "function" ? typeOrFn() : typeOrFn);
    const resolveCost = () => (typeof baseCostOrFn === "function" ? baseCostOrFn() : baseCostOrFn);
    const resolvePower = () => (typeof basePowerOrFn === "function" ? basePowerOrFn() : basePowerOrFn);
    const show = () => setPreviewMove(resolveName(), resolveType(), resolveCost(), resolvePower(), "", btn);
    const hide = () => clearEffectPreview();
    btn.addEventListener("mouseenter", show);
    btn.addEventListener("focus", show);
    btn.addEventListener("mouseleave", hide);
    btn.addEventListener("blur", hide);
  };
  wirePreview(els.attackBtn, "Attack", () => playerPrimaryType(), 0, 5);
  // Heal has no type matchup, so it uses a custom preview showing exact HP restored.
  const wireHealPreview = (btn) => {
    if (!(btn instanceof HTMLElement)) return;
    const show = () => showHealPreview(btn);
    btn.addEventListener("mouseenter", show);
    btn.addEventListener("focus", show);
    btn.addEventListener("mouseleave", clearEffectPreview);
    btn.addEventListener("blur", clearEffectPreview);
  };
  wireHealPreview(els.healBtn);
  wirePreview(els.windBtn, "Wind attack", "Wind", 2, 4);
  wirePreview(
    els.secondaryTypeBtn,
    () => {
      const t = Array.isArray(state.player.types) ? state.player.types[1] : null;
      const label = t ? (TYPE_META[t]?.label ?? t) : "Secondary";
      return `${label} attack`;
    },
    () => {
      const t = Array.isArray(state.player.types) ? state.player.types[1] : null;
      return t || playerPrimaryType();
    },
    () => {
      const t = Array.isArray(state.player.types) ? state.player.types[1] : null;
      return t ? magicBaseCost(t) : 2;
    },
    () => {
      const t = Array.isArray(state.player.types) ? state.player.types[1] : null;
      if (t === "Fire") return 6;
      if (t === "Water") return 5;
      if (t === "Sound") return 5;
      if (t === "SmellTaste") return 4;
      if (t === "Wind") return 4;
      if (t === "Sight") return 5;
      if (t === "Earth") return 5;
      if (t === "Touch") return 4;
      return 5;
    }
  );
  wirePreview(els.waterBtn, "Water attack", "Water", 2, 5);
  wirePreview(els.soundBtn, "Sound attack", "Sound", 2, 5);
  wirePreview(els.smellTasteBtn, "Smell/Taste attack", "SmellTaste", 2, 4);
  wirePreview(els.fireBtn, "Fire attack", "Fire", 3, 6);

// Initialize (hero → location)
  state = makeLobbyState();
  syncKnownSpells(false);
  renderIntent(null);
  setEffectBanner("—", "neutral");
  setPhase("hero");
  render();
  openHeroPicker();
}