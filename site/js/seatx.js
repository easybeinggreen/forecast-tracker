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
  const sw = (k) => { const a = st["2022"][k], b = st["2026"][k]; return a ? `${f1(a)} → ${f1(b)}` : f1(b); };
  const rows = slots.map((k) => {
    const a = w.base[k] || 0, b = prim[k].mean;
    return `<tr><td><span class="sw" style="background:${col(k)}"></span> ${esc(PARTY[k] || k)}</td><td class="num">${f1(a)}</td><td class="num"><b>${f1(b)}</b></td><td class="num ${b - a >= 0 ? "up" : "down"}">${sgn(b - a)}</td><td class="num dim">${prim[k].p10}–${prim[k].p90}</td></tr>`;
  }).join("");
  const big = on.mult >= 1.3 ? "well above" : on.mult <= 0.7 ? "well below" : "close to";
  return `<section class="d-sec why" aria-labelledby="h-why">
    <h3 id="h-why">Why the model says this</h3>
    <ol class="steps">
      <li><b>Start from 2022 here.</b> The left column below is how this seat voted last time.</li>
      <li><b>Apply the statewide polls.</b> Labor ${sw("ALP")}, Coalition ${sw("LNP")}, Greens ${sw("GRN")}, One Nation ${f1(st["2026"].ON)} (it stood in only 5 seats in 2022). Each party's vote here is scaled by its statewide change, so a party that's down a third statewide is down about a third here too.</li>
      <li><b>Place One Nation.</b> It polled <b>${f1(on.fed)}</b> here at the 2025 federal election, against ${f1(on.fed_vic)} across Victoria (${ratio.toFixed(1)}×). The model assumes its 2026 vote lands in the same places, but less extremely: ${on.mult.toFixed(2)}× its statewide ${f1(on.state)} gives <b>${f1(Math.min(60, on.state * on.mult))}</b> here, ${big} its statewide figure. Everyone else shrinks to make room.</li>
      ${w.retiring ? `<li><b>Sitting MP retiring.</b> ${esc(PARTY[w.retiring])} loses ${w.retire_pts} points of personal vote.</li>` : ""}
      ${w.shift ? `<li><b>Local adjustment.</b> ${Object.entries(w.shift).map(([k, v]) => `${esc(PARTY[k])} ${v > 0 ? "+" : ""}${v} points`).join(", ")}, set by hand in the drivers file.</li>` : ""}
      <li><b>Add uncertainty and count.</b> 10,000 runs, each with its own statewide swing, local noise and preference flows, then a full preference count.</li>
    </ol>
    <div class="sheet-wrap"><table class="sheet why-t"><thead><tr><th>Party</th><th>2022 here</th><th>2026 model</th><th>Change</th><th>Likely range</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="sens"><b>The judgement call here: how concentrated One Nation's vote is.</b>
      <div class="sens-row">${[[0.3, "Spread more evenly"], [on.elasticity, "Model's setting"], [0.9, "More concentrated"]].map(([g, l]) =>
        `<div${g === on.elasticity ? ' class="on"' : ""}><span class="v" style="color:${col("ON")}">${at(g) >= 60 ? "60%+" : f1(at(g))}</span><span class="l">${l} (${g})</span></div>`).join("")}</div>
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
      return { px, py, r, fill, op, html: `<b>${esc(b.n)}</b><br>${t.toLocaleString("en-AU")} votes<br>${tip}<br><span class="muted">Top: ${top}</span>` };
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
      if (lens === "fon") return { px, py, r, fill: col("ON"), op: 0.12 + 0.88 * (b.on / maxOn), html: `<b>${esc(b.n)}</b><br>${b.f.toLocaleString("en-AU")} votes<br>One Nation ${(100 * b.on).toFixed(1)}%` };
      const a = b.alp ?? 0.5;
      return { px, py, r, fill: a >= 0.5 ? col("ALP") : col("LIB"), op: 0.25 + 0.75 * Math.min(1, Math.abs(a - 0.5) / 0.25), html: `<b>${esc(b.n)}</b><br>${b.f.toLocaleString("en-AU")} votes<br>Labor ${(100 * a).toFixed(1)}% v Coalition ${(100 * (1 - a)).toFixed(1)}%` };
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
  el.innerHTML = `<label class="lens">Show <select id="booth-lens">${lenses.map(([k, l]) => `<option value="${k}"${k === lens ? " selected" : ""}>${l}</option>`).join("")}</select></label>
    <div class="booth-wrap"><svg viewBox="0 0 ${W} ${H}" class="booth-map" role="img" aria-label="Polling places in ${esc(s.name)}">
      <path d="${outline}" class="seat-outline"/>
      ${dots.map((d, i) => `<circle cx="${d.px.toFixed(1)}" cy="${d.py.toFixed(1)}" r="${d.r.toFixed(1)}" style="fill:${d.fill};fill-opacity:${d.op.toFixed(2)}" data-i="${i}"/>`).join("")}
    </svg><div class="tip" hidden></div></div>
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
  return `<h4>Who lives here <span class="dim">(2021 Census)</span></h4>
    <div class="sheet-wrap"><table class="sheet demo"><thead><tr><th></th><th>Here</th><th>Victoria</th><th>vs Victoria</th></tr></thead><tbody>
    ${row("People", d.pop, null, "", fmtN)}
    ${row("Median age", d.age, vic.age, " yrs")}
    ${row("Median household income (weekly)", d.inc, vic.inc, "$")}
    ${row("Born overseas", d.born_os, vic.born_os)}
    ${row("Speak another language at home", d.lang, vic.lang)}
    ${row("University degree", d.uni, vic.uni)}
    ${row("Trade or certificate qualification", d.cert, vic.cert)}
    ${row("Renting", d.rent, vic.rent)}
    ${row("Own outright", d.own, vic.own)}
    ${row("Couples with children", d.kids, vic.kids)}
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
  const modelled = (s.model.sim?.slots || []).filter((k) => ["ALP", "LIB", "NAT", "GRN", "ON"].includes(k));
  const missing = modelled.filter((k) => !have.has(k));
  const newInd = C.filter((c) => pcode(c.party) === "IND").filter(() => !(s.model.sim?.slots || []).includes("IND"));
  return `<h4>Announced candidates <span class="dim">(Tally Room; nominations close 13 Nov)</span></h4>
    <div class="chips-wrap">${C.map((c) => { const k = pcode(c.party); return `<span class="cand"><span class="sw" style="background:${col(k === "OTH" ? "OTH" : k)}"></span>${esc(c.name)} <span class="dim">${esc(c.party)}</span></span>`; }).join("")}</div>
    ${missing.length || newInd.length ? `<p class="flag">${missing.length ? `The model assumes ${missing.map((k) => esc(PARTY[k])).join(" and ")} will stand here, but no candidate is listed yet. If that holds, their votes go elsewhere and the odds change. ` : ""}${newInd.length ? `${newInd.map((c) => esc(c.name)).join(", ")} (independent) isn't in the model, which only carries over independents who polled strongly in 2022.` : ""}</p>` : ""}`;
}

export function placeHTML(s, locator, PARTY) {
  const P = s.place || {};
  const links = s.links || [];
  return `<section class="d-sec place" aria-labelledby="h-place">
    <h3 id="h-place">The place</h3>
    <div class="place-grid">${locator}<div>
      ${P.blurb ? `<p class="lede-s">${esc(P.blurb)} <a class="dim" href="${esc((links.find((l) => l.label === "Wikipedia") || {}).url || "#")}" target="_blank" rel="noopener">Wikipedia</a></p>` : ""}
      ${P.created || P.demographic ? `<p class="facts-line">${P.demographic ? `<span>${esc(P.demographic)}</span>` : ""}${P.created ? `<span>Created ${esc(P.created)}</span>` : ""}</p>` : ""}
      ${P.assessment ? `<blockquote class="quote small"><p>${esc(P.assessment)}</p><footer><a href="${esc(P.tr_url)}" target="_blank" rel="noopener">The Tally Room's assessment</a></footer></blockquote>` : ""}
      ${s.topics?.length ? `<h4>What local coverage is about</h4><div class="chips-wrap">${s.topics.map((t) => `<span class="topic" title="${t.n} stor${t.n > 1 ? "ies" : "y"}">${esc(t.t)} <b>${t.n}</b></span>`).join("")}</div>` : ""}
      ${links.length ? `<h4>Follow it</h4><ul class="links">${links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>${l.note ? ` <span class="dim">${esc(l.note)}</span>` : ""}</li>`).join("")}</ul>` : ""}
    </div></div>
    ${candidatesHTML(s, PARTY)}
    ${demoHTML(s.demo, s.demo_vic || {})}
    ${historyHTML(s.history, PARTY)}
  </section>`;
}
