// Automatische Vorbelegung der Positionen
//
// Ziel: möglichst viele freie Plätze besetzen (1. Priorität), dabei möglichst
// gute Wünsche erfüllen (Rang 1 vor Rang 2 ...) und die Arbeit gleichmäßig
// verteilen (wer zuletzt oft eingeteilt war, kommt bei Gleichstand später dran).
// Jede Person wird höchstens auf EINE Position automatisch eingeteilt.
//
// Verfahren: kostenminimaler maximaler Fluss
//   Quelle -> Person (1 Platz) -> Position (Kosten = Rang) -> Senke (freie Plätze)

class MinCostFlow {
  constructor(n) {
    this.n = n;
    this.g = Array.from({ length: n }, () => []);
  }
  add(u, v, cap, cost) {
    this.g[u].push({ v, cap, cost, rev: this.g[v].length });
    this.g[v].push({ v: u, cap: 0, cost: -cost, rev: this.g[u].length - 1 });
  }
  run(s, t) {
    let flow = 0;
    let cost = 0;
    const n = this.n;
    for (;;) {
      // Bellman-Ford / SPFA (Netz ist klein)
      const dist = new Array(n).fill(Infinity);
      const inQ = new Array(n).fill(false);
      const prev = new Array(n).fill(null);
      dist[s] = 0;
      const queue = [s];
      inQ[s] = true;
      while (queue.length) {
        const u = queue.shift();
        inQ[u] = false;
        this.g[u].forEach((e, i) => {
          if (e.cap > 0 && dist[u] + e.cost < dist[e.v]) {
            dist[e.v] = dist[u] + e.cost;
            prev[e.v] = [u, i];
            if (!inQ[e.v]) { inQ[e.v] = true; queue.push(e.v); }
          }
        });
      }
      if (dist[t] === Infinity) break;
      let f = Infinity;
      for (let v = t; v !== s; v = prev[v][0]) {
        const [u, i] = prev[v];
        f = Math.min(f, this.g[u][i].cap);
      }
      for (let v = t; v !== s; v = prev[v][0]) {
        const [u, i] = prev[v];
        const e = this.g[u][i];
        e.cap -= f;
        this.g[v][e.rev].cap += f;
      }
      flow += f;
      cost += f * dist[t];
    }
    return { flow, cost };
  }
}

/**
 * @param {Object} input
 * @param {Array<{id, typeId, open}>} input.positions  Positionen mit freien Plätzen
 * @param {Array<{userId, typeId, rank}>} input.preferences  Wünsche (Rang 1..5)
 * @param {Set<string>} input.busy  Personen, die schon eine aktive Position im Event haben
 * @param {Set<string>} input.taken  "positionId:userId" – Person hat schon einen Eintrag bei dieser Position
 * @param {Object<string, number>} [input.load]  bisherige Einsätze je Person (für faire Verteilung)
 * @param {(userId, positionId) => boolean} [input.allowed]  z. B. Verfügbarkeit: darf die Person hier eingeteilt werden?
 * @param {(userId, positionId) => number} [input.extraCost]  kleine Zusatzkosten bei Gleichstand (0–99)
 * @param {(userId, positionId) => number} [input.bonus]  Rabatt bei Gleichstand, z. B. Wunschpartner (0–400)
 * @returns {Array<{positionId, userId, rank}>}
 */
export function autoAssign({ positions, preferences, busy, taken, load = {}, allowed = () => true, extraCost = () => 0, bonus = () => 0 }) {
  const open = positions.filter((p) => p.open > 0 && p.typeId);
  const byType = new Map();
  preferences.forEach((p) => {
    if (busy.has(p.userId)) return;
    if (!byType.has(p.typeId)) byType.set(p.typeId, []);
    byType.get(p.typeId).push(p);
  });

  const people = [...new Set(preferences.map((p) => p.userId).filter((u) => !busy.has(u)))].sort();
  const pIndex = new Map(people.map((u, i) => [u, 1 + i]));
  const posBase = 1 + people.length;
  const sink = posBase + open.length;
  const net = new MinCostFlow(sink + 1);
  const edges = [];

  people.forEach((u) => net.add(0, pIndex.get(u), 1, 0));
  open.forEach((pos, j) => {
    net.add(posBase + j, sink, pos.open, 0);
    (byType.get(pos.typeId) || []).forEach((pref) => {
      if (taken.has(pos.id + ':' + pref.userId)) return;
      if (!allowed(pref.userId, pos.id)) return;
      // Rang zählt viel, frühere Einsätze und unklare Verfügbarkeit nur bei Gleichstand.
      // Wunschpartner (bonus) senken die Kosten, bleiben aber unter einer Rangstufe.
      const cost = pref.rank * 1000 + Math.min(899, (load[pref.userId] || 0) * 10)
        + Math.min(99, extraCost(pref.userId, pos.id)) - Math.min(400, Math.max(0, bonus(pref.userId, pos.id)));
      const u = pIndex.get(pref.userId);
      edges.push({ u, at: net.g[u].length, positionId: pos.id, userId: pref.userId, rank: pref.rank });
      net.add(u, posBase + j, 1, cost);
    });
  });

  net.run(0, sink);
  return edges
    .filter((e) => net.g[e.u][e.at].cap === 0)
    .map(({ positionId, userId, rank }) => ({ positionId, userId, rank }));
}
