// In-browser seat calculator: the same count and preference model as the Python simulation,
// run for one seat so drivers can be adjusted live.

export const GROUPS = ["ALP", "LIB", "NAT", "GRN", "ON", "RMIN", "PROG", "OTH", "IND"];
const G = Object.fromEntries(GROUPS.map((g, i) => [g, i]));
const ON_FLOWS = [
  ["LIB", "ALP", "lib_to_on_vs_alp"], ["NAT", "ALP", "nat_to_on_vs_alp"], ["ALP", "LIB", "alp_to_on_vs_lib"],
  ["GRN", "ALP", "grn_to_on_vs_alp"], ["RMIN", "LIB", "rmin_to_on_vs_lib"], ["PROG", "ALP", "prog_to_on_vs_alp"],
  ["IND", "ALP", "ind_to_on_vs_alp"], ["OTH", "ALP", "oth_to_on_vs_alp"],
];

export function makeW(W0, flows, vals) {
  const W = W0.map((r) => r.slice());
  const odds = (q) => q / (1 - q);
  const c = flows.coalition_internal;
  W[G.LIB][G.NAT] = W[G.LIB][G.ALP] * odds(c);
  W[G.NAT] = W[G.LIB].slice();
  W[G.NAT][G.LIB] = W[G.NAT][G.ALP] * odds(c);
  W[G.LIB][G.GRN] = W[G.LIB][G.ALP] * odds(vals.lib_to_grn_vs_alp);
  W[G.NAT][G.GRN] = W[G.LIB][G.GRN];
  for (const [f, ref, k] of ON_FLOWS) W[G[f]][G.ON] = W[G[f]][G[ref]] * odds(vals[k]);
  W[G.ON] = W[G.RMIN].slice();
  W[G.ON][G.LIB] = W[G.ON][G.ALP] * odds(vals.on_to_lib_vs_alp);
  W[G.ON][G.NAT] = W[G.ON][G.LIB];
  W[G.ON][G.GRN] = W[G.ON][G.ALP] * odds(vals.on_to_grn_vs_alp ?? 0.23);
  return W;
}

// Full preferential count. prim: votes per candidate; party: group index per candidate.
export function count(prim, party, W, trace = false) {
  const C = prim.length;
  const b = Array.from({ length: C }, (_, i) => { const r = new Float64Array(C); r[i] = prim[i]; return r; }); // holder x origin
  const active = new Array(C).fill(true);
  const total0 = prim.reduce((a, v) => a + v, 0);
  const outright = Math.max(...prim) / total0 > 0.5;
  const rounds = trace ? [{ excluded: null, totals: prim.slice() }] : null;
  const sumRow = (r) => r.reduce((a, v) => a + v, 0);
  for (let k = 0; k < C - 2; k++) {
    let ex = -1, lo = Infinity;
    for (let i = 0; i < C; i++) if (active[i]) { const t = sumRow(b[i]); if (t < lo) { lo = t; ex = i; } }
    active[ex] = false;
    const moving = b[ex]; b[ex] = new Float64Array(C);
    for (let o = 0; o < C; o++) {
      const v = moving[o]; if (!v) continue;
      let den = 0; for (let r = 0; r < C; r++) if (active[r]) den += W[party[o]][party[r]];
      for (let r = 0; r < C; r++) if (active[r]) b[r][o] += v * W[party[o]][party[r]] / den;
    }
    if (trace) rounds.push({ excluded: ex, totals: b.map((r, i) => (active[i] ? sumRow(r) : null)) });
  }
  const live = [...Array(C).keys()].filter((i) => active[i]).map((i) => [i, sumRow(b[i])]).sort((a, z) => z[1] - a[1]);
  const [w, l] = live;
  return { winner: w[0], final: [w[0], l[0]], share: w[1] / (w[1] + l[1]), outright, rounds };
}

function rng(seed) {
  let a = seed >>> 0;
  const u = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return () => { let x = 0, y = 0; while (x === 0) x = u(); y = u(); return Math.sqrt(-2 * Math.log(x)) * Math.cos(2 * Math.PI * y); };
}

export const FLOW_KEYS = ["lib_to_on_vs_alp", "nat_to_on_vs_alp", "on_to_lib_vs_alp", "alp_to_on_vs_lib", "grn_to_on_vs_alp",
  "rmin_to_on_vs_lib", "prog_to_on_vs_alp", "ind_to_on_vs_alp", "oth_to_on_vs_alp", "lib_to_grn_vs_alp", "on_to_grn_vs_alp"];

// Adjusted mean primaries (fractions) for a seat after shifts in percentage points.
export function adjustedMeans(seat, shifts = {}) {
  const { slots, mean } = seat.model.sim;
  const m = slots.map((s, i) => Math.max(mean[i] + (shifts[s] || 0) / 100, 0.0005));
  const t = m.reduce((a, v) => a + v, 0);
  return m.map((v) => v / t);
}

export function simulateSeat(seat, base, { shifts = {}, flows = {}, S = 3000, seed = 11 } = {}) {
  const { slots, logsd } = seat.model.sim;
  const party = slots.map((s) => G[s]);
  const mu = adjustedMeans(seat, shifts);
  const drv = base.drivers.flows;
  const z = rng(seed);
  const win = {}, pairs = {};
  let outright = 0;
  for (let s = 0; s < S; s++) {
    const x = mu.map((m, i) => m * Math.exp(logsd[i] * z() - 0.5 * logsd[i] * logsd[i]));
    const vals = {};
    for (const k of FLOW_KEYS) {
      const d = drv[k]; const m = flows[k] ?? d.mean;
      vals[k] = Math.min(0.98, Math.max(0.02, m + d.sd * z()));
    }
    const W = makeW(base.flows_base.W0, drv, vals);
    const r = count(x, party, W);
    const ws = slots[r.winner];
    win[ws] = (win[ws] || 0) + 1;
    if (r.outright) outright++;
    const key = [slots[r.final[0]], slots[r.final[1]]].sort().join("|");
    const p = pairs[key] || (pairs[key] = { n: 0, wins: {} });
    p.n++; p.wins[ws] = (p.wins[ws] || 0) + 1;
  }
  const winP = Object.fromEntries(Object.entries(win).map(([k, v]) => [k, v / S]).sort((a, b) => b[1] - a[1]));
  const pairList = Object.entries(pairs).map(([k, v]) => ({ pair: k.split("|"), p: v.n / S,
    wins: Object.fromEntries(Object.entries(v.wins).map(([q, n]) => [q, n / v.n])) })).sort((a, b) => b.p - a.p);
  return { win: winP, outright: outright / S, pairs: pairList };
}

// Central count (mean primaries, mean or adjusted flows) for the round-by-round sheet.
export function centralCount(seat, base, { shifts = {}, flows = {} } = {}) {
  const { slots } = seat.model.sim;
  const vals = Object.fromEntries(FLOW_KEYS.map((k) => [k, flows[k] ?? base.drivers.flows[k].mean]));
  const W = makeW(base.flows_base.W0, base.drivers.flows, vals);
  const mu = adjustedMeans(seat, shifts);
  const r = count(mu.map((v) => v * 100), slots.map((s) => G[s]), W, true);
  return { slots, rounds: r.rounds, winner: slots[r.winner] };
}
