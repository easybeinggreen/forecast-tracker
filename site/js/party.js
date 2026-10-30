// Party profiles: the strip of party cards and the party drawer.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const col = (p) => `var(--${p})`;
const pct = (x) => (x == null ? "—" : x > 0 && x < 0.005 ? "<1%" : x > 0.995 && x < 1 ? ">99%" : `${Math.round(x * 100)}%`);
const day = (iso) => new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
export const PARTY_ORDER = ["ALP", "LIB", "NAT", "GRN", "ON"];

// Poll trend: each poll a dot, a running average line, 2022 result dashed.
function trend(P, F, { w = 520, h = 170, mini = false } = {}) {
  const t0 = Date.parse("2026-02-01"), t1 = Date.parse(F.election_date), ymax = 40;
  const pad = mini ? { l: 0, r: 0, t: 4, b: 4 } : { l: 28, r: 56, t: 10, b: 22 };
  const x = (d) => pad.l + ((Date.parse(d) - t0) / (t1 - t0)) * (w - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v / ymax) * (h - pad.t - pad.b);
  const pts = P.polls.map((p) => ({ ...p, t: Date.parse(p.date) }));
  // running average of polls in the previous 45 days
  const avg = pts.map((p) => { const win = pts.filter((q) => q.t <= p.t && q.t > p.t - 45 * 864e5); return { d: p.date, v: win.reduce((a, q) => a + q.v, 0) / win.length }; });
  const line = avg.map((a, i) => `${i ? "L" : "M"}${x(a.d).toFixed(1)},${y(a.v).toFixed(1)}`).join("");
  const ref = P.code === "LIB" || P.code === "NAT" ? P.coalition_2022 : P.primary_2022;
  const c = col(P.code);
  if (mini) return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${w}" y1="${y(ref)}" y2="${y(ref)}" stroke="var(--ink-3)" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/><path d="${line}" fill="none" stroke="${c}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  const grid = [0, 10, 20, 30, 40].map((v) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${pad.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}%</text>`).join("");
  const months = ["2026-03-01", "2026-05-01", "2026-07-01", "2026-09-01", "2026-11-01"].map((d) => `<text x="${x(d)}" y="${h - 6}" text-anchor="middle">${new Date(d).toLocaleDateString("en-AU", { month: "short" })}</text>`).join("");
  const last = avg.at(-1);
  const dots = pts.map((p) => `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.2" fill="${c}" opacity=".35"><title>${esc(p.pollster)}, ${day(p.date)}: ${p.v}%</title></circle>`).join("");
  return `<svg class="trend" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(P.poll_label)} first-preference polls in 2026">
    <g class="axis">${grid}${months}</g>
    <line x1="${pad.l}" x2="${w - pad.r}" y1="${y(ref)}" y2="${y(ref)}" stroke="var(--ink-3)" stroke-dasharray="4 4"/>
    <text x="${w - pad.r + 6}" y="${y(ref) + 4}" class="lab">2022 ${ref}%</text>
    <line x1="${x(F.election_date)}" x2="${x(F.election_date)}" y1="${pad.t}" y2="${h - pad.b}" stroke="var(--ink-3)"/><text x="${x(F.election_date) - 4}" y="${pad.t + 10}" text-anchor="end" class="lab">Election</text>
    ${dots}<path d="${line}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="${x(last.d)}" cy="${y(last.v)}" r="4.5" fill="${c}" stroke="var(--sheet)" stroke-width="2"/>
    <text x="${x(last.d) + 8}" y="${y(last.v) - 6}" class="lab strong" style="fill:${c}">${last.v.toFixed(1)}%</text>
  </svg>`;
}

export function partyCards(F) {
  return PARTY_ORDER.filter((k) => F.parties[k]).map((k) => {
    const P = F.parties[k], f = P.forecast;
    return `<button class="party-card" type="button" data-party="${k}" style="--pc:${col(k)}">
      <span class="pc-name">${F.photos?.[P.leader.name] ? `<img class="pc-img" src="${esc(F.photos[P.leader.name].img)}" alt="" referrerpolicy="no-referrer">` : ""}${esc(P.name)}</span>
      <span class="pc-leader">${esc(P.leader.name)}</span>
      <span class="pc-seats"><b>${P.seats_now}</b><span class="arrow">→</span><b style="color:${col(k)}">${f.p50}</b><small>seats now → forecast (${f.p10}–${f.p90})</small></span>
      <span class="pc-spark">${trend(P, F, { w: 200, h: 34, mini: true })}</span>
      <span class="pc-poll">${P.poll_avg}% in polls${k === "LIB" || k === "NAT" ? " (Coalition)" : ""}, ${k === "LIB" || k === "NAT" ? P.coalition_2022 : P.primary_2022}% in 2022</span>
    </button>`;
  }).join("");
}

let CALLED = new Set();
const chip = (s, p, code) => `<button class="seat-chip${CALLED.has(s.slug) ? " called" : ""}" type="button" title="${CALLED.has(s.slug) ? "You've locked a call here" : "No call yet"}" data-open-seat="${s.slug}" style="--a:${(0.12 + 0.6 * p).toFixed(2)};--pc:${col(code)}">${esc(s.name)} <b>${pct(p)}</b></button>`;

// "Who votes for them": one small scatter per trait, each dot a seat (hollow = regional). Hover enlarges.
const TRAITS = [["band", "City to country", "band"], ["km_cbd", "Distance from Melbourne CBD (km)", "km", "log"], ["density", "People per km²", "", "log"],
  ["uni", "University degree", "%"], ["cert", "Trade or certificate", "%"], ["inc", "Household income ($/wk)", "$"],
  ["rent", "Renting", "%"], ["age", "Median age", "y"], ["kids", "Families with children", "%"],
  ["lang", "Other language at home", "%"], ["christian", "Christian", "%"], ["born_os", "Born overseas", "%"]];
const BANDS = [["inner", "Inner"], ["middle", "Middle"], ["outer", "Outer"], ["city", "Reg. city"], ["rural", "Rural"]];
const ELECTIONS = [["s22", "2022 state"], ["f25", "2025 federal"], ["m26", "Model 2026"]];
const OVERLAY = [["ALP", "Labor"], ["COAL", "Coalition"], ["ON", "One Nation"], ["GRN", "Greens"]];
const VOPT = { el: "f25", mode: "one" };
export function setVoterOpt(k, v) { VOPT[k] = v; }

function voteIn(s, party, el) {
  const one = (p) => {
    if (el === "s22") return s.prims_2022_grouped?.[p] || 0;
    if (el === "f25") return s.fed2025?.prims?.[p] || 0;
    const sl = s.model.sim.slots, i = sl.indexOf(p); return i < 0 ? 0 : 100 * s.model.sim.mean[i];
  };
  return party === "COAL" ? one("LIB") + one("NAT") : one(party);
}
function fit(pts) {
  const n = pts.length; if (n < 3) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0; for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (!sxx || !syy) return null;
  return { b: sxy / sxx, a: my - (sxy / sxx) * mx, r: sxy / Math.sqrt(sxx * syy) };
}
function scatterSVG(F, trait, series) {
  const W = 200, H = 130, L = 26, R = 6, T = 8, B = 20;
  if (trait[2] === "band") return stripSVG(trait, series);
  const lg = trait[3] === "log", tx = (v) => (lg ? Math.log10(Math.max(v, 0.5)) : v);
  const xs = F.seats.filter((s) => s.demo?.[trait[0]] != null).map((s) => tx(s.demo[trait[0]]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  for (const se of series) se.pts = se.pts.map(([x, y, s]) => [tx(x), y, s, x]);
  const ymax = Math.max(10, ...series.flatMap((se) => se.pts.map((p) => p[1]))) * 1.05;
  const X = (v) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - R), Y = (v) => H - B - (v / ymax) * (H - T - B);
  const fmt = (v) => lg ? Math.round(10 ** v).toLocaleString("en-AU") + (trait[2] ? " " + trait[2] : "") : trait[2] === "$" ? "$" + Math.round(v).toLocaleString("en-AU") : Math.round(v) + (trait[2] === "%" ? "%" : "");
  const yt = [0, Math.round(ymax / 2 / 5) * 5, Math.floor(ymax / 10) * 10].filter((v, i, a) => a.indexOf(v) === i);
  let g = yt.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="vg"/><text x="${L - 3}" y="${Y(v) + 3}" class="vt" text-anchor="end">${v}</text>`).join("");
  g += `<text x="${L}" y="${H - 6}" class="vt">${fmt(x0)}</text><text x="${W - R}" y="${H - 6}" class="vt" text-anchor="end">${fmt(x1)}</text>`;
  for (const se of series) {
    g += se.pts.map(([x, y, s]) => `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="${se.faint ? 1.6 : 2.2}" style="${s.region === "regional" ? `fill:none;stroke:${col(se.code)}` : `fill:${col(se.code)}`};opacity:${se.faint ? 0.35 : 0.75}"><title>${esc(s.name)}: ${esc(se.name)} ${y.toFixed(1)}%, ${esc(trait[1].toLowerCase())} ${fmt(x)}</title></circle>`).join("");
  }
  for (const se of series) {
    const f = fit(se.pts); if (!f) continue;
    g += `<line x1="${X(x0)}" x2="${X(x1)}" y1="${Y(Math.max(0, f.a + f.b * x0))}" y2="${Y(Math.max(0, f.a + f.b * x1))}" style="stroke:${col(se.code)}" class="vfit"/>`;
  }
  const rs = series.map((se) => ({ se, f: fit(se.pts) })).filter((o) => o.f);
  return `<div class="vchart"><div class="vc-h">${esc(trait[1])}${rs.length === 1 ? ` <span class="dim">r ${rs[0].f.r.toFixed(2)}</span>` : ""}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(trait[1])} against vote share">${g}</svg></div>`;
}
// Categorical: seats grouped into city-to-country bands, jittered dots, a bar at each band's average
function stripSVG(trait, series) {
  const W = 200, H = 130, L = 26, R = 6, T = 8, B = 20, n = BANDS.length, bw = (W - L - R) / n;
  const ymax = Math.max(10, ...series.flatMap((se) => se.pts.map((p) => p[1]))) * 1.05;
  const Y = (v) => H - B - (v / ymax) * (H - T - B);
  const jit = (slug) => { let h = 0; for (const c of slug) h = (h * 31 + c.charCodeAt(0)) % 997; return h / 997 - 0.5; };
  const yt = [0, Math.round(ymax / 2 / 5) * 5, Math.floor(ymax / 10) * 10].filter((v, i, a) => a.indexOf(v) === i);
  let g = yt.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="vg"/><text x="${L - 3}" y="${Y(v) + 3}" class="vt" text-anchor="end">${v}</text>`).join("");
  g += BANDS.map(([, l], i) => `<text x="${L + bw * (i + 0.5)}" y="${H - 6}" class="vt" text-anchor="middle">${l}</text>`).join("");
  const off = (k) => series.length > 1 ? ((k - (series.length - 1) / 2) * bw) / (series.length + 1) : 0;
  series.forEach((se, k) => {
    BANDS.forEach(([b, bl], i) => {
      const pts = se.pts.filter((p) => p[2].band === b); if (!pts.length) return;
      const cx = L + bw * (i + 0.5) + off(k), spread = series.length > 1 ? bw / (series.length + 2) : bw * 0.55;
      g += pts.map(([, y, s]) => `<circle cx="${(cx + jit(s.slug) * spread).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="${se.faint ? 1.5 : 2.1}" style="fill:${col(se.code)};opacity:${se.faint ? 0.35 : 0.7}"><title>${esc(s.name)} (${bl}): ${esc(se.name)} ${y.toFixed(1)}%</title></circle>`).join("");
      const avg = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      g += `<line x1="${cx - spread / 2 - 2}" x2="${cx + spread / 2 + 2}" y1="${Y(avg)}" y2="${Y(avg)}" style="stroke:${col(se.code)}" class="vfit"><title>${bl} average: ${esc(se.name)} ${avg.toFixed(1)}%</title></line>`;
    });
  });
  return `<div class="vchart"><div class="vc-h">${esc(trait[1])} <span class="dim">bar = average</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Vote share by city-to-country band">${g}</svg></div>`;
}
function votersHTML(P, code, F) {
  if (!F?.seats?.[0]?.demo) return "";
  const seats = F.seats.filter((s) => s.demo);
  const mk = (pc, name, faint) => ({ code: pc === "COAL" ? (code === "NAT" ? "NAT" : "LIB") : pc, name,
    faint, pts: seats.map((s) => [null, voteIn(s, pc, VOPT.el), s]).filter((p) => !((pc === "NAT" || pc === "LIB") && p[1] === 0)) });
  const btn = (k, v, label) => `<button type="button" class="vseg${VOPT[k] === v ? " on" : ""}" data-vopt="${k}" data-v="${v}" aria-pressed="${VOPT[k] === v}">${label}</button>`;
  const charts = TRAITS.map((tr) => {
    const series = VOPT.mode === "all" ? OVERLAY.map(([pc, n]) => mk(pc, n, true)) : [mk(code, P.name, false)];
    for (const se of series) se.pts = tr[0] === "band" ? se.pts.filter((p) => p[2].band) : se.pts.map(([, y, s]) => [s.demo[tr[0]], y, s]).filter((p) => p[0] != null);
    return scatterSVG(F, tr, series);
  }).join("");
  return `<section class="d-sec" aria-labelledby="h-voters">
    <h3 id="h-voters">Who votes for them</h3>
    <p class="hint">Each dot is a seat: the trait along the bottom, the vote (%) up the side. Filled dots are Melbourne, hollow dots regional. The first three charts are geography: city-to-country bands (inner, middle and outer Melbourne, regional cities, rural and coast), then distance and density on a log scale. The line is the trend; r near ±1 means a strong link, near 0 none. Hover a chart to enlarge it, a dot for the seat.${code === "NAT" || code === "LIB" ? ` ${code === "NAT" ? "Nationals" : "Liberals"}: only seats they contested in that election.` : ""}</p>
    <div class="vctl"><span class="segs">${ELECTIONS.map(([v, l]) => btn("el", v, l)).join("")}</span>
      <span class="segs">${btn("mode", "one", esc(P.name))}${btn("mode", "all", "All parties")}</span></div>
    ${VOPT.mode === "all" ? `<div class="keyline vkey">${OVERLAY.map(([pc, n]) => `<span><i style="background:${col(pc === "COAL" ? "LIB" : pc)}"></i>${n}</span>`).join("")}</div>` : ""}
    <div class="vgrid">${charts}</div>
  </section>`;
}

export function partyHTML(code, F, news, PARTY, called = new Set()) {
  CALLED = called;
  const P = F.parties[code], seat = (slug) => F.seats.find((s) => s.slug === slug);
  const f = P.forecast, L = P.leader, ls = seat(L.seat);
  const held = P.held.map(seat).map((s) => ({ s, p: s.model.win[code] || 0 })).sort((a, b) => a.p - b.p);
  const risky = held.filter((h) => h.p < 0.75), safe = held.filter((h) => h.p >= 0.75);
  const gains = P.gains.map(seat).filter((s) => !P.targets.some((t) => t.slug === s.slug));
  const coalition = code === "LIB" || code === "NAT";
  const items = news?.parties?.[code] || [];
  const target = (t) => {
    const s = seat(t.slug); if (!s) return "";
    const p = s.model.win[code] || 0;
    const [fp, fv] = Object.entries(s.model.win).sort((a, b) => b[1] - a[1])[0];
    return `<li class="target${CALLED.has(s.slug) ? " called" : ""}">
      <div class="t-top"><button class="linkish" type="button" data-open-seat="${s.slug}">${esc(s.name)}</button>
        <span class="kind ${t.kind}">${t.kind === "stated" ? "Party says" : "Reported"}</span>
        ${CALLED.has(t.slug) ? '<span class="kind mine">✓ Called</span>' : ""}<span class="t-held">held by ${esc(s.mp.name.startsWith("Vacant") ? "nobody (vacant)" : PARTY[s.mp.party] || s.mp.party)}, margin ${Number(s.margin.value).toFixed(1)}%</span></div>
      <div class="t-bar"><span class="bars"><i style="width:${p * 100}%;background:${col(code)}"></i></span><b>${pct(p)}</b></div>
      <div class="t-note">${esc(t.note)}${fp !== code ? `. Model favourite: ${esc(PARTY[fp] || fp)} ${pct(fv)}` : ""}. <a href="${esc(t.url)}" target="_blank" rel="noopener">Source</a></div>
    </li>`;
  };
  return `
    <div class="d-head" style="border-top:5px solid ${col(code)}">
      ${F.photos?.[L.name] ? `<figure class="avatar"><img src="${esc(F.photos[L.name].img)}" alt="" style="border-color:${col(code)}" referrerpolicy="no-referrer" onerror="this.closest('figure').classList.add('noimg')"><figcaption><a href="${esc(F.photos[L.name].file || F.photos[L.name].page)}" target="_blank" rel="noopener" title="${esc(F.photos[L.name].credit)}">Photo: ${esc(F.photos[L.name].license)}</a></figcaption></figure>`
        : `<div class="monogram" style="background:${col(code)}" aria-hidden="true">${esc(L.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join(""))}</div>`}
      <div><h2 id="d-title">${esc(P.name)}</h2>
        <p><b>${esc(L.name)}</b>, ${esc(L.role)}${ls ? `, ${ls.mp.name === L.name ? "MP for" : "standing in"} <button class="linkish" type="button" data-open-seat="${ls.slug}">${esc(ls.name)}</button>` : ""}. Leader since ${day(L.since)}.</p>
        ${P.others?.length ? `<p>${P.others.map((o) => `${esc(o.name)} (${esc(o.role)})`).join(" · ")}</p>` : ""}</div>
      <button class="close back" type="button" data-act="close" aria-label="Back to the count room">← Count room</button>
    </div>

    <section class="d-sec"><p class="lede">${esc(P.summary)}</p></section>

    <section class="d-sec" aria-labelledby="h-pseats">
      <h3 id="h-pseats">Seats</h3>
      <div class="stat-row">
        <div><div class="v">${P.seats_2022}</div><div class="l">Won in 2022</div></div>
        <div><div class="v">${P.seats_now}</div><div class="l">Held now</div></div>
        <div><div class="v" style="color:${col(code)}">${f.p50}</div><div class="l">Forecast, middle</div></div>
        <div><div class="v">${f.p10}–${f.p90}</div><div class="l">Likely range (80%)</div></div>
      </div>
      ${coalition ? `<p class="hint" style="margin-top:8px">With the ${code === "LIB" ? "Nationals" : "Liberals"}, the Coalition is forecast ${F.summary.seats.LNP.p50} seats (${F.summary.seats.LNP.p10}–${F.summary.seats.LNP.p90}); 45 needed. Majority in ${pct(F.summary.p_lnp_majority)} of simulations.</p>` : ""}
    </section>

    <section class="d-sec" aria-labelledby="h-poll">
      <h3 id="h-poll">Popularity</h3>
      <p class="hint">${esc(P.poll_label)} first preferences in every published poll this year (dots), with a 45-day running average. Dashed: the 2022 result. Current average used by the model: <b>${P.poll_avg}%</b>.</p>
      ${trend(P, F)}
    </section>

    ${votersHTML(P, code, F)}
    <section class="d-sec" aria-labelledby="h-targets">
      <h3 id="h-targets">${esc(P.targets_label || "Target seats")}</h3>
      <p class="hint">"Party says" means the party named the seat on the record; "Reported" is media reporting of its plans. The bar is the model's chance ${esc(P.name)} wins it.</p>
      <ul class="targets">${P.targets.map(target).join("")}</ul>
    </section>

    ${held.length ? `<section class="d-sec" aria-labelledby="h-held">
      <h3 id="h-held">Its own seats</h3>
      <p class="hint">Chance of holding each seat it holds now${code === "ALP" ? " (including the two seats whose Labor-elected MPs now sit as independents)" : ""}, most at risk first.</p>
      <div class="chips-wrap">${risky.map((h) => chip(h.s, h.p, code)).join("") || '<span class="hint">None below 75%.</span>'}</div>
      ${safe.length ? `<details><summary>${safe.length} safer seat${safe.length > 1 ? "s" : ""} (75%+)</summary><div class="chips-wrap">${safe.map((h) => chip(h.s, h.p, code)).join("")}</div></details>` : ""}
    </section>` : ""}

    ${gains.length ? `<section class="d-sec" aria-labelledby="h-gains">
      <h3 id="h-gains">Other seats the model thinks it could win</h3>
      <p class="hint">Not on its stated or reported list, but over 5% in the model.</p>
      <div class="chips-wrap">${gains.map((s) => chip(s, s.model.win[code] || 0, code)).join("")}</div>
    </section>` : ""}

    <section class="d-sec" aria-labelledby="h-record">
      <h3 id="h-record">Track record</h3>
      <ul class="facts">${P.record.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      <p class="stance"><b>On deals:</b> ${esc(P.stance)}</p>
    </section>

    <section class="d-sec" aria-labelledby="h-quotes">
      <h3 id="h-quotes">In their words</h3>
      ${P.quotes.map((q) => `<blockquote class="quote"><p>“${esc(q.text)}”</p><footer>${esc(q.who)}, <a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.source)}</a>, ${day(q.date)}</footer></blockquote>`).join("")}
    </section>

    <!--research-->
    <section class="d-sec" aria-labelledby="h-pnews">
      <h3 id="h-pnews">In the news</h3>
      ${items.length ? `<ul class="news">${items.map((n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a><span>${esc(n.source)}${n.published ? `, ${day(n.published.slice(0, 10))}` : ""}</span></li>`).join("")}</ul>`
        : `<p class="hint">Party coverage arrives with the next morning's news refresh.</p>`}
    </section>
    <section class="d-sec"><p class="hint">Profile text is hand-curated in <code>vic2026/config/parties.yaml</code>; seat counts, polls and odds update with each model run.</p></section>`;
}
