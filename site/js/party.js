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
