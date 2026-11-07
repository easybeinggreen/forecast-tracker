// Seat drawer extras: "why these numbers", locator map, and the booth map inside the seat.
import { projector, pathOf } from "./map.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const col = (p) => `var(--${p})`;
const MAIN = ["ALP", "LIB", "NAT", "GRN", "ON", "IND"];
const f1 = (v) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);
const sgn = (v) => (v > 0 ? `+${v.toFixed(1)}` : v < 0 ? `−${Math.abs(v).toFixed(1)}` : "0.0");
const MEL_BBOX = [144.55, -38.33, 145.62, -37.48];

// ---------------------------------------------------------------- why these numbers
export function whyHTML(s, F, PARTY) {
  const w = s.why || s.model.why, st = F.why_statewide;
  if (!w || !st) return "";
  const prim = s.model.primaries;
  const slots = Object.keys(prim).filter((k) => prim[k].mean >= 0.5 || (w.base[k] || 0) >= 0.5)
    .sort((a, b) => prim[b].mean - prim[a].mean);
  const on = w.on, ratio = on.fed / on.fed_vic;
  // sensitivity: the multiplier scales roughly as (local/state)^elasticity
  const at = (g) => Math.min(60, on.state * on.mult * Math.pow(ratio, g - on.elasticity));
  const eSet = on.elasticity, eLo = ratio >= 1 ? 0.3 : eSet - 0.3, eHi = ratio >= 1 ? 0.75 : eSet + 0.3;
  const fv = F.fed2025_vic?.prims || {}, fs = s.fed2025?.prims || {};
  const fedOf = (o, k) => (k === "LNP" ? (o.LIB || 0) + (o.NAT || 0) : o[k]);
  const sw = (k) => { const a = st["2022"][k], f = fedOf(fv, k), b = st["2026"][k];
    return `${a ? f1(a) : "—"} → <span class="fedc">${f != null ? f1(f) : "—"}</span> → <b>${f1(b)}</b>`; };
  const rows = slots.map((k) => {
    const a = w.base[k] || 0, b = prim[k].mean;
    const f = fs[k];
    return `<tr><td><span class="sw" style="background:${col(k)}"></span> ${esc(PARTY[k] || k)}</td><td class="num">${f1(a)}</td><td class="num fedc">${f != null ? f1(f) : "—"}</td><td class="num"><b>${f1(b)}</b></td><td class="num ${b - a >= 0 ? "up" : "down"}">${sgn(b - a)}</td><td class="num dim">${prim[k].p10}–${prim[k].p90}</td></tr>`;
  }).join("");
  const big = on.mult >= 1.3 ? "well above" : on.mult <= 0.7 ? "well below" : "close to";
  return `<section class="d-sec why" aria-labelledby="h-why">
    <h3 id="h-why">Why the model says this</h3>
    <ol class="steps">
      <li><b>Start from 2022 here.</b> The left column below is how this seat voted last time.</li>
      <li><b>Apply the statewide polls.</b> Victoria-wide, 2022 state → <span class="fedc">2025 federal</span> → <b>polls now</b>: Labor ${sw("ALP")}; Coalition ${sw("LNP")}; Greens ${sw("GRN")}; One Nation — → <span class="fedc">${f1(fv.ON)}</span> → <b>${f1(st["2026"].ON)}</b> (it stood in only 5 state seats in 2022). Each party's vote here is scaled by its statewide change, so a party that's down a third statewide is down about a third here too.</li>
      ${w.on.fed != null && !(s.model.sim?.slots || []).includes("ON") ? `<li><b>No One Nation candidate.</b> One Nation isn't standing here, so its vote is shared among the others.</li>` : `<li><b>Place One Nation.</b> It polled <b>${f1(on.fed)}</b> here at the 2025 federal election, against ${f1(fv.ON ?? on.fed_vic)} across Victoria (${ratio.toFixed(1)}×). The model assumes its 2026 vote lands in the same places, but ${ratio >= 1 ? "less extremely in its strong areas (calibrated so the best seats match South Australia's 2026 result)" : "stays low where it was weak (Roy Morgan's inner-Melbourne sample had it on 2%)"}: ${on.mult.toFixed(2)}× its statewide ${f1(on.state)} gives <b>${f1(Math.min(60, on.state * on.mult))}</b> here, ${big} its statewide figure. Everyone else shrinks to make room.</li>`}
      ${w.region && Object.keys(w.region_mult || {}).length ? (() => { const r = F.why_statewide?.regions?.[w.region] || {};
        const moved = Object.entries(w.region_mult).filter(([, m]) => Math.abs(m - 1) >= 0.03).map(([g, m]) => `${({ LNP: "Coalition", OTHERS: "others" })[g] || PARTY[g] || g} ${m > 1 ? "+" : "−"}${Math.abs(Math.round((m - 1) * 100))}%`);
        return `<li><b>Regional polling (${esc(w.region)}).</b> Roy Morgan's regional breakdown shows how this region differs from the state. The model moves 35% of the way toward it${moved.length ? `: ${moved.join(", ")} here` : ", which barely changes this seat"}.${r.ON ? ` One Nation: poll has this region ${r.ON.poll_gap >= 0 ? "+" : ""}${r.ON.poll_gap} points from the state figure, the model had ${r.ON.model_gap >= 0 ? "+" : ""}${r.ON.model_gap}.` : ""}</li>`; })() : ""}
      ${w.seat_poll ? `<li><b>Seat poll.</b> ${esc(w.seat_poll.pollster)} (${esc(w.seat_poll.date)}, n=${w.seat_poll.n}) moved this seat ${Math.round(w.seat_poll.weight * 100)}% of the way toward its numbers.</li>` : ""}
      ${w.retiring ? `<li><b>Sitting MP retiring.</b> ${esc(PARTY[w.retiring])} loses ${w.retire_pts} points of personal vote.</li>` : ""}
      ${w.shift ? `<li><b>Local adjustment.</b> ${Object.entries(w.shift).map(([k, v]) => `${esc(PARTY[k])} ${v > 0 ? "+" : ""}${v} points`).join(", ")}, set by hand in the drivers file.</li>` : ""}
      <li><b>Add uncertainty and count.</b> 10,000 runs, each with its own statewide swing, local noise and preference flows, then a full preference count.</li>
    </ol>
    ${s.byelection ? (() => { const b = s.byelection, ks = [...new Set([...Object.keys(b.primaries), ...Object.keys(b.base_2022)])].filter((k) => (b.primaries[k] || 0) >= 2 || (b.base_2022[k] || 0) >= 2).sort((a, c) => (b.primaries[c] || 0) - (b.primaries[a] || 0));
      return `<div class="byel"><b>By-election, ${esc(b.date)}.</b> ${b.labor_stood ? "" : "<b>Labor did not stand</b>, so its voters went elsewhere. "}The model doesn't use this directly (by-elections have their own candidates and protest votes), but it's the most recent real result here:
        <div class="sheet-wrap"><table class="sheet"><thead><tr><th></th><th>2022</th><th>By-election</th><th>Change</th></tr></thead><tbody>${ks.map((k) => { const a = b.base_2022[k] || 0, c = b.primaries[k] || 0;
          return `<tr><td><span class="sw" style="background:${col(k)}"></span> ${esc(PARTY[k] || k)}</td><td class="num">${f1(a)}</td><td class="num"><b>${f1(c)}</b></td><td class="num ${c - a >= 0 ? "up" : "down"}">${sgn(c - a)}</td></tr>`; }).join("")}</tbody></table></div></div>`; })() : ""}
    <div class="sheet-wrap"><table class="sheet why-t"><thead><tr><th>Party</th><th>2022 state</th><th class="fedc">2025 federal</th><th>2026 model</th><th>Change</th><th>Likely range</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${s.fed2025 ? `<p class="hint" style="margin-top:6px">2025 federal: votes at the polling places inside this district, regrouped to state parties (postal and absent votes not included). Labor two-party here: <b>${f1(s.fed2025.alp_tpp)}</b> (Victoria ${f1(F.fed2025_vic?.alp_tpp)}). Federal and state contests differ: different candidates, teal and Nationals candidates in some federal seats only, and the model does not use the federal column except for One Nation.</p>` : ""}
    <div class="sens"><b>The judgement call here: how concentrated One Nation's vote is.</b>
      <div class="sens-row">${[[eLo, "Spread more evenly"], [eSet, "Model's setting"], [eHi, "More concentrated"]].map(([g, l]) =>
        `<div${g === eSet ? ' class="on"' : ""}><span class="v" style="color:${col("ON")}">${at(g) >= 60 ? "60%+" : f1(at(g))}</span><span class="l">${l} (${g.toFixed(2)})</span></div>`).join("")}</div>
      <p class="hint">One Nation's primary vote here at each setting, other things equal. The setting is the <i>elasticity</i> driver in the model; if you think it's wrong, slide One Nation's vote in the calculator below and lock your own call.</p></div>
  </section>`;
}

// ---------------------------------------------------------------- locator
export function locatorSVG(geo, slug, onMap = true) {
  const f = geo?.find((g) => g.props.slug === slug);
  if (!f) return "";
  const pts = f.polys.flatMap((p) => p[0]);
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const metro = cx > MEL_BBOX[0] && cx < MEL_BBOX[2] && cy > MEL_BBOX[1] && cy < MEL_BBOX[3];
  const all = (b) => geo.filter((g) => !metro || g.polys.some((p) => p[0].some(([x, y]) => x > b[0] && x < b[2] && y > b[1] && y < b[3])));
  const vic = [140.96, -39.2, 149.98, -33.98];
  const box = metro ? MEL_BBOX : vic, W = 220, H = metro ? 180 : 130;
  const proj = projector(box, W, H, 4);
  return `<figure class="locator"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Where ${esc(f.props.name || slug)} is">
    ${all(box).map((g) => `<path d="${pathOf(g, proj)}" class="${g === f ? "hl" : "bg"}"/>`).join("")}</svg>
    <figcaption>${metro ? "Greater Melbourne" : "Victoria"}${onMap ? ` · <button class="linkish" type="button" data-act="show-on-map">Show on the big map</button>` : ""}</figcaption></figure>`;
}

// ---------------------------------------------------------------- inside the seat (booths)
const LENSES = [["tcp", "2022: who won each booth (final two)"], ["p:ALP", "2022: Labor first preferences"], ["p:LIB", "2022: Liberal first preferences"],
  ["p:NAT", "2022: Nationals first preferences"], ["p:GRN", "2022: Greens first preferences"], ["p:ON", "2022: One Nation first preferences"],
  ["p:IND", "2022: Independent first preferences"], ["fon", "2025 federal: One Nation %"], ["falp", "2025 federal: Labor two-party %"]];

export function insideShell(slug) {
  return `<section class="d-sec" aria-labelledby="h-inside"><h3 id="h-inside">Inside the seat</h3>
    <p class="hint">Results at each polling place. Bigger dots took more votes. Hover a dot for the numbers.</p>
    <div id="inside" data-slug="${slug}"><p class="hint">Loading polling places…</p></div></section>`;
}

let insideBase = "plain";
// Roads-and-towns view: MapLibre with free OpenFreeMap tiles (no account or key), the seat boundary and the same booth dots.
let mlLoading;
function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve();
  return (mlLoading ||= new Promise((ok, bad) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"; document.head.appendChild(css);
    const js = document.createElement("script"); js.src = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"; js.onload = ok; js.onerror = bad; document.head.appendChild(js);
  }));
}
function cssColour(v) { const m = /var\((--[\w-]+)\)/.exec(v); return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#888" : v; }
async function streetMap(box, polys, dots, bbox) {
  box.innerHTML = '<p class="hint">Loading the map…</p>';
  try { await loadMapLibre(); } catch { box.innerHTML = '<p class="hint">The street map could not load here.</p>'; return; }
  box.innerHTML = "";
  const map = new maplibregl.Map({ container: box, style: "https://tiles.openfreemap.org/styles/positron", bounds: [[bbox[0], bbox[1]], [bbox[2], bbox[3]]], fitBoundsOptions: { padding: 20 }, attributionControl: { compact: true }, cooperativeGestures: true });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.on("load", () => {
    map.addSource("seat", { type: "geojson", data: { type: "Feature", geometry: { type: "MultiPolygon", coordinates: polys } } });
    map.addLayer({ id: "seat-fill", type: "fill", source: "seat", paint: { "fill-color": "#1D232B", "fill-opacity": 0.04 } });
    map.addLayer({ id: "seat-line", type: "line", source: "seat", paint: { "line-color": "#1D232B", "line-width": 2 } });
    const feats = dots.filter((d) => d.lon != null).map((d, i) => ({ type: "Feature", properties: { i, c: cssColour(d.fill), o: d.op, r: d.r * 0.8 }, geometry: { type: "Point", coordinates: [d.lon, d.lat] } }));
    map.addSource("booths", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
    map.addLayer({ id: "booths", type: "circle", source: "booths", paint: { "circle-color": ["get", "c"], "circle-opacity": ["get", "o"], "circle-radius": ["get", "r"], "circle-stroke-color": "#fff", "circle-stroke-width": 0.5 } });
    const pop = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "240px" });
    map.on("mousemove", "booths", (e) => { map.getCanvas().style.cursor = "pointer"; pop.setLngLat(e.lngLat).setHTML(dots[e.features[0].properties.i].html).addTo(map); });
    map.on("mouseleave", "booths", () => { map.getCanvas().style.cursor = ""; pop.remove(); });
  });
}

export function renderInside(el, B, s, PARTY, groupOf, lens = "tcp") {
  const v = B.vec2022, fed = B.fed2025 || [];
  const cands = v ? v.cands.map((c) => ({ ...c, g: groupOf(c.party) })) : [];
  const present = new Set(cands.map((c) => c.g));
  const lenses = LENSES.filter(([k]) => !k.startsWith("p:") || present.has(k.slice(2)));
  const geom = B.outline, polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of polys) for (const [x, y] of p[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const W = 560, H = 380, proj = projector([x0, y0, x1, y1], W, H, 14);
  const fedLens = lens === "fon" || lens === "falp";
  let dots = [], legend = "";
  const tot = (b) => b.v.reduce((a, x) => a + x, 0);
  if (!fedLens && v) {
    const tcpIdx = v.tcp.map((n) => cands.findIndex((c) => c.name === n));
    const g = lens.startsWith("p:") ? lens.slice(2) : null;
    const maxT = Math.max(...v.booths.map(tot), 1);
    let maxShare = 0;
    if (g) for (const b of v.booths) { const t = tot(b); if (t) maxShare = Math.max(maxShare, cands.reduce((a, c, i) => a + (c.g === g ? b.v[i] : 0), 0) / t); }
    dots = v.booths.filter((b) => b.x != null).map((b) => {
      const t = tot(b), r = 3 + 11 * Math.sqrt(t / maxT);
      let fill, op, tip;
      const top = cands.map((c, i) => [c, b.v[i]]).sort((p, q) => q[1] - p[1]).slice(0, 3)
        .map(([c, n]) => `${esc(PARTY[c.g] || c.party)} ${(100 * n / t).toFixed(0)}%`).join(", ");
      if (g) {
        const sh = cands.reduce((a, c, i) => a + (c.g === g ? b.v[i] : 0), 0) / (t || 1);
        fill = col(g); op = 0.12 + 0.88 * (sh / (maxShare || 1)); tip = `${PARTY[g]} ${(100 * sh).toFixed(1)}%`;
      } else if (b.tcp) {
        const [a, c] = b.tcp, wi = a >= c ? 0 : 1, share = Math.max(a, c) / (a + c);
        const party = cands[tcpIdx[wi]]?.g || "OTH";
        fill = col(party); op = 0.25 + 0.75 * Math.min(1, (share - 0.5) / 0.25);
        tip = `${v.tcp.map((n, i) => `${esc(n.split(",")[0])} ${(100 * b.tcp[i] / (a + c)).toFixed(0)}%`).join(" v ")}`;
      } else { fill = "var(--ink-3)"; op = 0.4; tip = "No final-two count"; }
      const [px, py] = proj([b.x, b.y]);
      return { lon: b.x, lat: b.y, px, py, r, fill, op, html: `<b>${esc(b.n)}</b><br>${t.toLocaleString("en-AU")} votes<br>${tip}<br><span class="muted">Top: ${top}</span>` };
    });
    const g2 = lens.startsWith("p:") ? lens.slice(2) : null;
    legend = g2 ? `Darker = higher ${esc(PARTY[g2])} share (strongest booth darkest).`
      : `Colour = the party that won the booth after preferences; darker = bigger win.`;
  } else {
    const maxF = Math.max(...fed.map((b) => b.f), 1);
    const maxOn = Math.max(...fed.map((b) => b.on), 0.01);
    dots = fed.map((b) => {
      const [px, py] = proj([b.x, b.y]);
      const r = 3 + 11 * Math.sqrt(b.f / maxF);
      if (lens === "fon") return { lon: b.x, lat: b.y, px, py, r, fill: col("ON"), op: 0.12 + 0.88 * (b.on / maxOn), html: `<b>${esc(b.n)}</b><br>${b.f.toLocaleString("en-AU")} votes<br>One Nation ${(100 * b.on).toFixed(1)}%` };
      const a = b.alp ?? 0.5;
      return { lon: b.x, lat: b.y, px, py, r, fill: a >= 0.5 ? col("ALP") : col("LIB"), op: 0.25 + 0.75 * Math.min(1, Math.abs(a - 0.5) / 0.25), html: `<b>${esc(b.n)}</b><br>${b.f.toLocaleString("en-AU")} votes<br>Labor ${(100 * a).toFixed(1)}% v Coalition ${(100 * (1 - a)).toFixed(1)}%` };
    });
    legend = lens === "fon" ? "Darker = higher One Nation share at the 2025 federal election." : "Red = Labor ahead, blue = Coalition ahead, two-party, 2025 federal election.";
  }
  dots.sort((a, b) => b.r - a.r);
  const outline = pathOf({ polys }, proj);
  const placed = v ? v.booths.filter((b) => b.x != null).length : 0;
  const boothVotes = v ? v.booths.reduce((a, b) => a + tot(b) + (b.inf || 0), 0) : 0;
  const table = v ? (() => {
    return `<details class="booth-list"><summary>2022 results by polling place (${v.booths.length} places)</summary><div class="sheet-wrap"><table class="sheet"><thead><tr><th>Polling place</th><th>Votes</th><th>Top party</th>${v.tcp.map((n) => `<th>${esc(n.split(",")[0].replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()))}</th>`).join("")}</tr></thead><tbody>
      ${[...v.booths].sort((a, b) => tot(b) - tot(a)).map((b) => { const t = tot(b); const i = b.v.indexOf(Math.max(...b.v)); const tt = b.tcp ? b.tcp[0] + b.tcp[1] : 0;
        return `<tr><td>${esc(b.n)}${b.x == null ? ' <span class="dim">(not mapped)</span>' : ""}</td><td>${t.toLocaleString("en-AU")}</td><td>${esc(PARTY[cands[i]?.g] || cands[i]?.party || "")} ${t ? (100 * b.v[i] / t).toFixed(0) : 0}%</td>${b.tcp ? b.tcp.map((n) => `<td>${(100 * n / tt).toFixed(1)}%</td>`).join("") : "<td>—</td><td>—</td>"}</tr>`; }).join("")}
    </tbody></table></div></details>`;
  })() : "";
  // Biggest towns first; skip a label that would overlap one already placed.
  const towns = [];
  for (const [n, x, y] of s.towns || []) {
    const [px, py] = proj([x, y]), w = 6.4 * n.length;
    // try right-above, right-below, left-above, left-below of the dot
    const spot = [[px + 5, py - 5], [px + 5, py + 13], [px - 5 - w, py - 5], [px - 5 - w, py + 13]]
      .find(([lx, ly]) => lx > 0 && lx + w < W && !towns.some((t) => lx < t.lx + t.w && lx + w > t.lx && Math.abs(ly - t.ly) < 13));
    if (spot) towns.push({ n, px, py, w, lx: spot[0], ly: spot[1] });
  }
  el.innerHTML = `<div class="inside-bar"><label class="lens">Show <select id="booth-lens">${lenses.map(([k, l]) => `<option value="${k}"${k === lens ? " selected" : ""}>${l}</option>`).join("")}</select></label>
    <span class="seg" role="group" aria-label="Map style"><button type="button" data-base="plain" aria-pressed="${insideBase === "plain"}">Plain</button><button type="button" data-base="street" aria-pressed="${insideBase === "street"}">Roads and towns</button></span></div>
    <div class="booth-wrap"${insideBase === "street" ? " hidden" : ""}><svg viewBox="0 0 ${W} ${H}" class="booth-map" role="img" aria-label="Polling places in ${esc(s.name)}">
      <path d="${outline}" class="seat-outline"/>
      ${dots.map((d, i) => `<circle cx="${d.px.toFixed(1)}" cy="${d.py.toFixed(1)}" r="${d.r.toFixed(1)}" style="fill:${d.fill};fill-opacity:${d.op.toFixed(2)}" data-i="${i}"/>`).join("")}
      ${towns.map((t) => `<g class="town"><circle cx="${t.px.toFixed(1)}" cy="${t.py.toFixed(1)}" r="2"/><text x="${t.lx.toFixed(1)}" y="${t.ly.toFixed(1)}">${esc(t.n)}</text></g>`).join("")}
    </svg><div class="tip" hidden></div></div>
    <div class="street-map" id="street-map"${insideBase === "street" ? "" : " hidden"}></div>
    <p class="hint">${legend} ${fedLens ? `${fed.length} federal polling places inside the boundary.` : `${placed} of ${v?.booths.length || 0} voting centres mapped (located by matching names to the AEC's polling places). Polling-day booths took ${boothVotes.toLocaleString("en-AU")} votes in 2022; early, postal and absent votes aren't tied to a place.`}</p>
    ${table}`;
  const wrap = el.querySelector(".booth-wrap"), tip = wrap.querySelector(".tip");
  wrap.addEventListener("mousemove", (e) => {
    const c = e.target.closest("circle[data-i]");
    if (!c) { tip.hidden = true; return; }
    tip.innerHTML = dots[Number(c.dataset.i)].html; tip.hidden = false;
    const r = wrap.getBoundingClientRect();
    tip.style.left = Math.min(e.clientX - r.left + 12, r.width - 230) + "px"; tip.style.top = Math.max(e.clientY - r.top - 10, 0) + "px";
  });
  wrap.addEventListener("mouseleave", () => (tip.hidden = true));
  el.querySelector("#booth-lens").addEventListener("change", (e) => renderInside(el, B, s, PARTY, groupOf, e.target.value));
  el.querySelectorAll("[data-base]").forEach((b) => (b.onclick = () => { insideBase = b.dataset.base; renderInside(el, B, s, PARTY, groupOf, lens); }));
  if (insideBase === "street") streetMap(el.querySelector("#street-map"), polys, dots, [x0, y0, x1, y1]);
}

// ---------------------------------------------------------------- the place: locator, people, history, topics, links
const fmtN = (n) => Number(n).toLocaleString("en-AU");
function demoHTML(d, vic) {
  if (!d) return "";
  const row = (label, v, ref, unit = "%", fmt = (x) => x.toFixed(unit === "%" ? 0 : 0)) => {
    if (v == null) return "";
    const diff = ref == null ? null : v - ref;
    return `<tr><td>${label}</td><td class="num"><b>${unit === "$" ? "$" + fmtN(Math.round(v)) : fmt(v) + unit}</b></td><td class="num dim">${ref == null ? "" : unit === "$" ? "$" + fmtN(Math.round(ref)) : fmt(ref) + unit}</td>
      <td class="bar-cell">${ref == null ? "" : `<span class="dev"><i style="${diff >= 0 ? "left:50%" : `right:50%`};width:${Math.min(50, Math.abs(diff) / (Math.abs(ref) || 1) * 50)}%"></i></span>`}</td></tr>`;
  };
  return `<div class="sheet-wrap"><table class="sheet demo"><thead><tr><th></th><th>Here</th><th>Victoria</th><th>vs Victoria</th></tr></thead><tbody>
    ${row("People", d.pop, null, "", fmtN)}
    ${row("Median age", d.age, vic.age, " yrs")}
    ${row("Median household income (weekly)", d.inc, vic.inc, "$")}
    ${row("Born overseas", d.born_os, vic.born_os)}
    ${row("Speak another language at home", d.lang, vic.lang)}
    ${row("University degree", d.uni, vic.uni)}
    ${row("Trade or certificate qualification", d.cert, vic.cert)}
    ${row("Renting", d.rent, vic.rent)}
    ${row("Own outright", d.own, vic.own)}
    ${row("In a couple family with children", d.kids, vic.kids)}
    ${row("Christian", d.christian, vic.christian)}
    ${row("No religion", d.norel, vic.norel)}
    ${row("Aboriginal and Torres Strait Islander", d.atsi, vic.atsi, "%", (x) => x.toFixed(1))}
    </tbody></table></div>
    ${d.top_birth?.length ? `<p class="hint" style="margin-top:6px">Most common overseas birthplaces: ${d.top_birth.map((b) => `${esc(b[0])} ${b[1].toFixed(1)}%`).join(", ")}.</p>` : ""}`;
}

function historyHTML(h, PARTY) {
  if (!h?.members?.length) return "";
  const y0 = Math.min(...h.members.map((m) => m.from)), y1 = 2026;
  const x = (y) => (100 * (y - y0)) / (y1 - y0 || 1);
  const pc = (p) => (["ALP", "LIB", "NAT", "GRN", "ON", "IND"].includes(p) ? col(p) : "var(--OTH)");
  return `<h4>Who has held it</h4>
    <div class="timeline">${h.members.map((m) => `<i style="left:${x(m.from)}%;width:${x(m.to ?? y1) - x(m.from)}%;background:${pc(m.party)}" title="${esc(m.name)} (${esc(PARTY[m.party] || m.party_raw || m.party)}) ${m.from}–${m.to ?? "now"}"></i>`).join("")}</div>
    <div class="timeline-axis"><span>${y0}</span><span>${y1}</span></div>
    <ul class="members">${[...h.members].reverse().slice(0, 8).map((m) => `<li><span class="sw" style="background:${pc(m.party)}"></span>${esc(m.name)} <span class="dim">${esc(PARTY[m.party] || m.party_raw || m.party)}, ${m.from}–${m.to ?? "now"}</span></li>`).join("")}</ul>
    ${h.note ? `<p class="hint">${esc(h.note)}</p>` : ""}`;
}

const PCODE = [[/labor/i, "ALP"], [/liberal/i, "LIB"], [/national/i, "NAT"], [/green/i, "GRN"], [/one nation/i, "ON"], [/independent/i, "IND"]];
const pcode = (p) => (PCODE.find(([rx]) => rx.test(p)) || [null, "OTH"])[1];

function candidatesHTML(s, PARTY) {
  const C = s.candidates_2026 || [];
  if (!C.length) return "";
  const have = new Set(C.map((c) => pcode(c.party)));
  const modelled = (s.model?.sim?.slots || []).filter((k) => ["ALP", "LIB", "NAT", "GRN", "ON"].includes(k));
  const missing = modelled.filter((k) => !have.has(k));
  const newInd = s.model ? C.filter((c) => pcode(c.party) === "IND").filter(() => !(s.model.sim?.slots || []).includes("IND")) : [];
  return `<h4>Announced candidates <span class="dim">(Tally Room; nominations close 13 Nov)</span></h4>
    <div class="chips-wrap">${C.map((c) => { const k = pcode(c.party); return `<span class="cand"><span class="sw" style="background:${col(k === "OTH" ? "OTH" : k)}"></span>${esc(c.name)} <span class="dim">${esc(c.party)}</span></span>`; }).join("")}</div>
    ${missing.length || newInd.length ? `<p class="flag">${missing.length ? `The model assumes ${missing.map((k) => esc(PARTY[k])).join(" and ")} will stand here, but no candidate is listed yet. If that holds, their votes go elsewhere and the odds change. ` : ""}${newInd.length ? `${newInd.map((c) => esc(c.name)).join(", ")} (independent) isn't in the model, which only carries over independents who polled strongly in 2022.` : ""}</p>` : ""}`;
}

// Results: 2022 state, 2025 federal (same booths), model 2026, and how often the seat has changed hands
export function resultsHTML(s, PARTY) {
  const st = s.prims_2022_grouped || {}, fd = s.fed2025?.prims || {};
  // Seats without a model (the Team Challenge copy) drop the model column.
  const hasModel = !!s.model;
  const m26 = hasModel ? Object.fromEntries(s.model.sim.slots.map((p, i) => [p, 100 * s.model.sim.mean[i]])) : {};
  const rows = ["ALP", "LIB", "NAT", "GRN", "ON", "IND"].filter((p) => (st[p] || 0) + (fd[p] || 0) + (m26[p] || 0) >= 0.5);
  const other = (o) => Math.max(0, 100 - rows.reduce((a, p) => a + (o[p] || 0), 0));
  const cell = (v) => `<td class="num">${v == null || v < 0.05 ? '<span class="dim">–</span>' : v.toFixed(1)}</td>`;
  const h = s.history?.members || [];
  let changes = 0; for (let i = 1; i < h.length; i++) if (h[i].party !== h[i - 1].party) changes++;
  const since = h.length ? h[0].from : null;
  return `<section class="d-sec" aria-labelledby="h-vote">
    <h3 id="h-vote">How it has voted</h3>
    <p class="hint">First-preference vote, %. The 2025 federal column counts the same polling places, so it shows how this area voted most recently.</p>
    <div class="sheet-wrap"><table class="sheet"><thead><tr><th></th><th>2022 state</th><th>2025 federal</th>${hasModel ? "<th>Model 2026</th>" : ""}</tr></thead><tbody>
      ${rows.map((p) => `<tr><td><span class="sw" style="background:${col(p)}"></span>${esc(PARTY[p])}</td>${cell(st[p])}${cell(fd[p])}${hasModel ? cell(m26[p]) : ""}</tr>`).join("")}
      <tr><td class="dim">Others</td>${cell(other(st))}${cell(other(fd))}${hasModel ? cell(other(m26)) : ""}</tr>
    </tbody></table></div>
    <p class="facts-line"><span>2022: ${PARTY[s.held_2022] || s.held_2022} won by ${s.margin.value}% v ${PARTY[s.margin.vs] || s.margin.vs}</span>${s.fed2025?.alp_tpp != null ? `<span>2025 federal: Labor ${s.fed2025.alp_tpp.toFixed(1)}% two-party</span>` : ""}${since ? `<span>Changed party ${changes} time${changes === 1 ? "" : "s"} since ${since}</span>` : ""}</p>
    ${historyHTML(s.history, PARTY)}
  </section>`;
}

export function changesHTML(s, PARTY) {
  const c = candidatesHTML(s, PARTY);
  if (!c && !s.mp.retiring) return "";
  return `<section class="d-sec" aria-labelledby="h-chg"><h3 id="h-chg">What's different in 2026</h3>
    ${s.mp.retiring ? `<p class="flag">${esc(s.mp.name)} (${esc(PARTY[s.mp.party])}) is retiring, so the seat is open.</p>` : ""}
    ${c}</section>`;
}

// The five census figures where this seat differs most from Victoria, scaled by how much seats vary on each.
const KEY_STATS = [["age", "Median age", (v) => `${Math.round(v)}`], ["inc", "Household income", (v) => `$${fmtN(Math.round(v))} a week`],
  ["born_os", "Born overseas", (v) => `${v.toFixed(0)}%`], ["lang", "Other language at home", (v) => `${v.toFixed(0)}%`],
  ["uni", "University degree", (v) => `${v.toFixed(0)}%`], ["cert", "Trade or certificate", (v) => `${v.toFixed(0)}%`],
  ["rent", "Renting", (v) => `${v.toFixed(0)}%`], ["own", "Own home outright", (v) => `${v.toFixed(0)}%`],
  ["kids", "Couples with children", (v) => `${v.toFixed(0)}%`], ["christian", "Christian", (v) => `${v.toFixed(0)}%`],
  ["norel", "No religion", (v) => `${v.toFixed(0)}%`], ["atsi", "First Nations", (v) => `${v.toFixed(1)}%`]];
function keyStatsHTML(s, all) {
  const d = s.demo, vic = s.demo_vic || {};
  if (!d) return "";
  const sd = (k) => { const xs = (all || []).map((x) => x.demo?.[k]).filter((x) => x != null); if (xs.length < 2) return Math.abs(vic[k] || 1) || 1;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1; };
  const top = KEY_STATS.filter(([k]) => d[k] != null && vic[k] != null).map((r) => [...r, Math.abs(d[r[0]] - vic[r[0]]) / sd(r[0])]).sort((a, b) => b[3] - a[3]).slice(0, 5);
  return `<h4>Who lives here (census 2021)</h4>
    <dl class="key-stats">${top.map(([k, lab, f]) => `<div><dt>${lab}</dt><dd>${f(d[k])} <span class="dim">(Victoria ${f(vic[k])})</span></dd></div>`).join("")}</dl>`;
}

export function placeHTML(s, locator, PARTY, all) {
  const P = s.place || {}, Q = s.profile || {};
  const wiki = (s.links || []).find((l) => l.label === "Wikipedia");
  return `<section class="d-sec place" aria-labelledby="h-place">
    <h3 id="h-place">The place</h3>
    <div class="place-grid">${locator}<div>
      ${Q.kind ? `<p class="lede-s"><b>${esc(Q.kind)}</b> ${Q.work ? esc(Q.work) : ""}</p>` : ""}
      ${keyStatsHTML(s, all)}
      ${Q.issues?.length ? `<h4>Local issues</h4><ul class="issues">${Q.issues.map((i) => `<li>${esc(i.text)} <a class="dim" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.source)}${i.paywalled ? " (paywalled)" : ""}</a></li>`).join("")}</ul>` : ""}
      ${P.assessment ? `<blockquote class="quote small"><p>${esc(P.assessment)}</p><footer><a href="${esc(P.tr_url)}" target="_blank" rel="noopener">The Tally Room's assessment</a></footer></blockquote>` : ""}
      ${P.blurb ? `<details class="more-s"><summary>Background (Wikipedia)</summary><p>${esc(P.blurb)}${P.created ? ` Created ${esc(P.created)}.` : ""} ${wiki ? `<a class="dim" href="${esc(wiki.url)}" target="_blank" rel="noopener">Wikipedia</a>` : ""}</p></details>` : ""}
    </div></div>
    <details class="more-s"><summary>All census figures (2021), ${fmtN(s.demo?.pop || 0)} people</summary>${demoHTML(s.demo, s.demo_vic || {})}</details>
  </section>`;
}
