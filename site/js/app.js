import { simulateSeat, centralCount } from "./sim.js";
import { decodeTopo, projector, bboxOf, pathOf } from "./map.js";
import { partyCards, partyHTML } from "./party.js";
import { whyHTML, locatorSVG, insideShell, renderInside, placeHTML } from "./seatx.js";

// ---------------------------------------------------------------- state & helpers
const S = {
  F: null, geo: null, news: null, lens: "fav", mode: "model", filter: "all", sort: "close", q: "",
  ledger: null, pass: null, seat: null, shifts: {}, flows: {}, calc: null, central: null,
};
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const col = (p) => `var(--${p in PARTY ? p : "NONE"})`;
const PARTY = { ALP: "Labor", LIB: "Liberal", NAT: "Nationals", GRN: "Greens", ON: "One Nation", IND: "Independent",
  RMIN: "Other right", PROG: "Other progressive", OTH: "Others" };
const SHORT = { ALP: "Labor", LIB: "Liberal", NAT: "Nationals", GRN: "Greens", ON: "One Nation", IND: "Ind.", RMIN: "Oth. right", PROG: "Oth. prog.", OTH: "Others" };
const ORDER = ["GRN", "ALP", "IND", "PROG", "OTH", "unset", "RMIN", "ON", "LIB", "NAT"];
const pct = (x, d = 0) => (x == null ? "—" : x > 0 && x < 0.005 ? "<1%" : x > 0.995 && x < 1 ? ">99%" : `${(x * 100).toFixed(d)}%`);
const pts = (n) => `${Number(n).toLocaleString("en-AU")} pts`;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const fav = (win) => Object.entries(win).sort((a, b) => b[1] - a[1])[0];
const seatBy = (slug) => S.F.seats.find((s) => s.slug === slug);
const callsFor = (slug) => (S.ledger?.predictions || []).filter((p) => p.seat === slug);
const lastCall = (slug) => callsFor(slug).at(-1);
const lastOdds = (slug) => (S.ledger?.odds || []).filter((o) => o.seat === slug).at(-1);
// two-letter seat codes for the chamber dots (initials for two-word names)
const ABBR = {"albert-park":"AP","bendigo-east":"BE","bendigo-west":"BW","box-hill":"BH","gippsland-east":"GE","gippsland-south":"GS","glen-waverley":"GW","mill-park":"MP","murray-plains":"MuP","narre-warren-north":"NN","narre-warren-south":"NS","ovens-valley":"OV","pascoe-vale":"PV","point-cook":"PC","south-barwon":"SB","south-west-coast":"SW","st-albans":"SA","yan-yean":"YY","ashwood":"As","bass":"Ba","bayswater":"By","bellarine":"Bl","benambra":"Bn","bentleigh":"Bt","berwick":"Bk","brighton":"Bg","broadmeadows":"Bd","brunswick":"Br","bulleen":"Bu","bundoora":"Bo","carrum":"Ca","caulfield":"Cf","clarinda":"Cl","cranbourne":"Cr","croydon":"Cy","dandenong":"Da","eildon":"Ei","eltham":"El","essendon":"Es","eureka":"Eu","euroa":"Er","evelyn":"Ev","footscray":"Fo","frankston":"Fr","geelong":"Gl","greenvale":"Gv","hastings":"Ha","hawthorn":"Hw","ivanhoe":"Iv","kalkallo":"Ka","kew":"Ke","kororoit":"Ko","lara":"La","laverton":"Lv","lowan":"Lo","macedon":"Ma","malvern":"Mv","melbourne":"Me","melton":"Mt","mildura":"Mi","monbulk":"Mo","mordialloc":"Md","mornington":"Mn","morwell":"Mw","mulgrave":"Mu","narracan":"Na","nepean":"Ne","niddrie":"Ni","northcote":"No","oakleigh":"Oa","pakenham":"Pa","polwarth":"Po","prahran":"Pr","preston":"Ps","richmond":"Ri","ringwood":"Rw","ripon":"Rp","rowville":"Ro","sandringham":"Sd","shepparton":"Sh","sunbury":"Su","sydenham":"Sy","tarneit":"Ta","thomastown":"Th","warrandyte":"Wa","wendouree":"We","werribee":"Wr","williamstown":"Wi"};
const DARK_TEXT = new Set(["NAT", "ON", "unset", "OTH", "RMIN", "PROG", "NONE"]);
const STATEWIDE = { slug: "statewide", name: "Statewide result" };
const STATE_OUT = { LNP_MAJ: "Coalition majority", HUNG: "Hung parliament", ALP_MAJ: "Labor majority" };
const outName = (k) => STATE_OUT[k] || PARTY[k] || k;
const outCol = (k) => ({ LNP_MAJ: col("LIB"), HUNG: "var(--ink-3)", ALP_MAJ: col("ALP") }[k] || col(k));

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { "content-type": "application/json", "x-ledger-passcode": S.pass || "", ...(opts.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || `Request failed (${r.status})`), { status: r.status });
  return body;
}

// ---------------------------------------------------------------- boot
async function boot() {
  S.F = await (await fetch("data/forecast.json")).json();
  const [topo, news] = await Promise.all([
    fetch("data/vic_districts.topojson").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("data/news.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  S.news = news;
  S.sb = await fetch("data/sportsbet.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  S.mk = await fetch("data/markets.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  S.changes = await fetch("data/changes.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const raw = await fetch("data/photos.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const key = (n) => n.toLowerCase().replace(/\s+/g, " ").trim();
  const byKey = Object.fromEntries(Object.entries(raw).map(([k, v]) => [key(k), v]));
  S.F.photos = new Proxy(byKey, { get: (o, n) => (typeof n === "string" ? o[key(n)] : undefined) });
  if (topo) S.geo = decodeTopo(topo, "districts").filter((f) => seatBy(f.props.slug));
  S.pass = store.get("countroom.pass");
  wire();
  renderAll();
  if (S.pass) await loadLedger();
  const m = location.hash.match(/seat=([a-z-]+)/), mp = location.hash.match(/party=([A-Z]+)/);
  if (m) openSeat(m[1]); else if (mp) openParty(mp[1]);
}

async function loadLedger() {
  try {
    S.ledger = await api("/api/ledger");
  } catch (e) {
    S.ledger = null;
    if (e.status === 401) { S.pass = null; store.set("countroom.pass", null); }
  }
  renderAll();
  if (S.seat) renderDrawer();
}

function renderAll() {
  renderTop(); renderChamber(); renderMap(); renderOutcome(); renderTable(); renderLedger(); renderCoverage(); renderMine(); renderChanges(); renderPolls();
  if (S.F.parties) $("#party-grid").innerHTML = partyCards(S.F);
  $("#foot-model").textContent = `Model run ${S.F.generated} from ${S.F.simulations.toLocaleString("en-AU")} simulated elections, each with a full preference count in all 88 seats.`;
}

// ---------------------------------------------------------------- header
function renderTop() {
  const days = Math.ceil((new Date(S.F.election_date + "T08:00:00+11:00") - new Date()) / 864e5);
  $("#countdown").innerHTML = days > 0 ? `<strong>${days}</strong>days to polling day` : "Polling day has passed";
  const b = S.ledger?.budget;
  $("#budget").innerHTML = b
    ? `<span>Stake budget</span><span class="bar" title="${b.committed} of ${b.total} points committed"><i style="width:${(100 * b.committed) / b.total}%"></i></span><span><strong>${b.remaining.toLocaleString("en-AU")}</strong> of ${b.total.toLocaleString("en-AU")} pts left</span>`
    : `<span>1,000-point stake budget</span>`;
  $("#unlock").textContent = S.ledger ? "Lock ledger" : "Unlock ledger";
}

// ---------------------------------------------------------------- chamber
let layout;
function chamberLayout(n = 88, rows = 6) {
  const r0 = 0.4, radii = [...Array(rows)].map((_, i) => r0 + ((1 - r0) * i) / (rows - 1));
  const tot = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.round((n * r) / tot));
  let diff = n - counts.reduce((a, b) => a + b, 0), i = rows - 1;
  while (diff) { counts[i] += Math.sign(diff); diff -= Math.sign(diff); i = (i + rows - 1) % rows; }
  const out = [];
  radii.forEach((r, ri) => { const c = counts[ri]; for (let k = 0; k < c; k++) { const a = Math.PI * (1 - k / (c - 1)); out.push({ x: r * Math.cos(a), y: r * Math.sin(a), a, ri }); } });
  return out.sort((p, q) => q.a - p.a || p.ri - q.ri);
}

function seatParty(seat) {
  if (S.mode === "held") return { p: seat.mp.party, op: 1 };
  if (S.mode === "mine") { const c = lastCall(seat.slug); return c?.backed ? { p: c.backed, op: 0.35 + 0.65 * Math.min(1, Math.max(0, (Number(c.probs[c.backed]) - 0.34) / 0.6)) } : { p: "unset", op: 1 }; }
  const [p, v] = fav(seat.model.win);
  return { p, op: 0.3 + 0.7 * Math.min(1, Math.max(0, (v - 0.34) / 0.6)) };
}

function renderChamber() {
  layout ||= chamberLayout();
  const W = 800, H = 452, cx = 400, cy = 428, R = 380, dot = 15.5;
  const seats = S.F.seats.map((s) => ({ s, ...seatParty(s) }));
  seats.sort((a, b) => ORDER.indexOf(a.p) - ORDER.indexOf(b.p) || (b.op - a.op));
  const tally = {};
  seats.forEach((x) => (tally[x.p] = (tally[x.p] || 0) + 1));
  const lnp = (tally.LIB || 0) + (tally.NAT || 0);
  const svg = $("#chamber");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const circles = seats.map((x, i) => {
    const pt = layout[i];
    const fill = x.p === "unset" ? "" : `fill:${col(x.p)};opacity:${x.op.toFixed(2)}`;
    const X = (cx + pt.x * R).toFixed(1), Y = (cy - pt.y * R).toFixed(1), ab = ABBR[x.s.slug] || "";
    const light = x.op > 0.6 && !DARK_TEXT.has(x.p);
    const q = S.q.trim().toLowerCase(), isCode = q && Object.values(ABBR).some((v) => v.toLowerCase() === q);
    const words = (n) => n.toLowerCase().split(/[\s-]+/);
    const hit = q && (isCode ? ab.toLowerCase() === q : words(x.s.name).some((w) => w.startsWith(q)) || words(x.s.mp.name).some((w) => w.startsWith(q)));
    const called = !!lastCall(x.s.slug);
    return `<g class="seat-g${q ? (hit ? " hit" : " dim") : ""}${called ? " called" : ""}"><circle class="seat${x.p === "unset" ? " unset" : ""}" tabindex="0" role="button" aria-label="${esc(x.s.name)}" data-slug="${x.s.slug}" cx="${X}" cy="${Y}" r="${dot}" style="${fill}"></circle><text class="ab${light ? " light" : ""}" x="${X}" y="${Y}" dy="0.35em" text-anchor="middle" font-size="${ab.length > 2 ? 9.5 : 11.5}">${ab}</text></g>`;
  }).join("");
  const big = S.mode === "mine"
    ? `<text class="tally" x="${cx}" y="${cy - 52}" text-anchor="middle" font-size="44">${88 - (tally.unset || 0)}</text><text class="tally-sub" x="${cx}" y="${cy - 28}" text-anchor="middle">seats called, 88 to go${tally.unset ? "" : ""}</text>`
    : `<text class="tally" x="${cx - 74}" y="${cy - 50}" text-anchor="middle" font-size="46" style="fill:${col("ALP")}">${tally.ALP || 0}</text><text class="tally-sub" x="${cx - 74}" y="${cy - 26}" text-anchor="middle">Labor</text>
       <text class="tally" x="${cx + 74}" y="${cy - 50}" text-anchor="middle" font-size="46" style="fill:${col("LIB")}">${lnp}</text><text class="tally-sub" x="${cx + 74}" y="${cy - 26}" text-anchor="middle">Coalition</text>`;
  svg.innerHTML = `<line class="maj" x1="${cx}" y1="${cy - R - 24}" x2="${cx}" y2="${cy - R * 0.36}"/><text class="maj-label" x="${cx}" y="${cy - R - 30}" text-anchor="middle">45 seats to govern</text>${circles}${big}`;
  const desc = { held: "Each dot is a seat, coloured by the party that holds it now (by-elections and defections included).",
    model: "Each dot is coloured by the model's favourite. Fainter dots are less certain. Counting favourites is not the same as the expected seat total on the right.",
    mine: "Your locked calls. Empty dots are seats you haven't called yet." }[S.mode];
  $("#chamber-desc").textContent = desc;
  $("#legend").innerHTML = ORDER.filter((p) => tally[p]).map((p) => { const inner = `<span class="sw" style="background:${p === "unset" ? "transparent;border:1px solid var(--rule)" : col(p)}"></span>${p === "unset" ? "Not called" : PARTY[p]} ${tally[p]}`;
    return `<li>${S.F.parties?.[p] ? `<button type="button" class="linkish" data-party="${p}">${inner}</button>` : inner}</li>`; }).join("");
}

function showTip(e, slug, wrapEl = $(".chamber-wrap")) {
  const s = seatBy(slug), tip = wrapEl.querySelector(".tip");
  const top = Object.entries(s.model.win).filter(([, v]) => v >= 0.01).slice(0, 3);
  const c = lastCall(slug);
  const ph = S.F.photos?.[s.mp.name];
  tip.innerHTML = `${ph ? `<img class="tip-img" src="${esc(ph.img)}" alt="" referrerpolicy="no-referrer">` : ""}<h4>${esc(s.name)}</h4><p class="muted">${esc(s.mp.name)}, ${PARTY[s.mp.party]}${s.mp.retiring ? " (retiring)" : ""}</p>
    <p class="muted">Margin ${s.margin.value}% v ${PARTY[s.margin.vs] || s.margin.vs}</p>
    <div style="margin-top:6px">${top.map(([p, v]) => `<div class="row"><span><span class="sw" style="background:${col(p)}"></span> ${PARTY[p]}</span><b>${pct(v)}</b></div>`).join("")}</div>
    ${c ? `<p class="muted" style="margin-top:6px">My call: ${PARTY[c.backed] || "—"} ${pct(Number(c.probs[c.backed] || 0))}</p>` : ""}`;
  tip.hidden = false;
  const wrap = wrapEl.getBoundingClientRect();
  const x = e.clientX - wrap.left, y = e.clientY - wrap.top;
  tip.style.left = Math.min(x + 14, wrap.width - 270) + "px";
  tip.style.top = Math.max(y - 20, 0) + "px";
}

// ---------------------------------------------------------------- map
const MEL_BBOX = [144.55, -38.33, 145.62, -37.48];
function lensFill(s) {
  if (S.lens === "fav") { const x = seatParty(s); return x.p === "unset" ? { fill: "var(--sheet)", op: 1, stroke: true } : { fill: col(x.p), op: x.op }; }
  const w = s.model.win, p = S.lens === "LNP" ? (w.LIB || 0) + (w.NAT || 0) : w[S.lens] || 0;
  return { fill: col(S.lens === "LNP" ? "LIB" : S.lens), op: Math.max(0.04, p) };
}
function renderMap() {
  if (!S.geo) { $(".maps").hidden = true; return; }
  const draw = (svg, bbox, W, H, clip) => {
    const proj = projector(bbox, W, H, 6);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const inBox = (f) => !clip || f.polys.some((poly) => poly[0].some(([x, y]) => x > bbox[0] && x < bbox[2] && y > bbox[1] && y < bbox[3]));
    svg.innerHTML = S.geo.filter(inBox).map((f) => { const s = seatBy(f.props.slug), st = lensFill(s);
      return `<path class="district${st.stroke ? " unset" : ""}${lastCall(s.slug) ? " called" : ""}" data-slug="${s.slug}" tabindex="0" role="button" aria-label="${esc(s.name)}" d="${pathOf(f, proj)}" style="fill:${st.fill};fill-opacity:${st.op.toFixed(2)}"></path>`; }).join("");
  };
  const vb = bboxOf(S.geo);
  draw($("#map-vic"), vb, 640, 440, false);
  draw($("#map-mel"), MEL_BBOX, 640, 520, true);
  // outline where the Melbourne close-up sits on the state map
  const pv = projector(vb, 640, 440, 6), [a, b] = [pv([MEL_BBOX[0], MEL_BBOX[3]]), pv([MEL_BBOX[2], MEL_BBOX[1]])];
  $("#map-vic").insertAdjacentHTML("beforeend", `<rect x="${a[0].toFixed(1)}" y="${a[1].toFixed(1)}" width="${(b[0] - a[0]).toFixed(1)}" height="${(b[1] - a[1]).toFixed(1)}" fill="none" stroke="var(--ink-2)" stroke-width="1" stroke-dasharray="3 2" pointer-events="none"/>`);
  const lc = col(S.lens === "LNP" ? "LIB" : S.lens);
  $("#map-cap").innerHTML = S.lens === "fav"
    ? "Colours follow the chamber's setting above. In model view, fainter means less certain. The dashed box on the state map is the Melbourne close-up."
    : `<span class="ramp"><span>0%</span><i style="background:linear-gradient(90deg, color-mix(in srgb, ${lc} 4%, var(--sheet)), ${lc})"></i><span>100%</span></span> Stronger colour means a higher chance. Hover any district for every party's chance; click to open its calculator.`;
}

// ---------------------------------------------------------------- coverage
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "");
const newsList = (items) => `<ul class="news">${items.map((n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a><span>${esc(n.source)}${n.published ? `, ${fmtDay(n.published)}` : ""}</span></li>`).join("")}</ul>`;
function renderCoverage() {
  const el = $("#coverage-body");
  if (!S.news?.statewide?.length) { $(".coverage").hidden = true; return; }
  $(".coverage").hidden = false;
  el.innerHTML = newsList(S.news.statewide.slice(0, 8)) + `<p class="caption">From Google News, refreshed each morning. Open a seat for its local coverage.</p>`;
}

// ---------------------------------------------------------------- outcome panel
function renderOutcome() {
  const sm = S.F.summary;
  $("#odds").innerHTML = [["Coalition majority", sm.p_lnp_majority, "LIB"], ["Hung parliament", sm.p_hung, null], ["Labor majority", sm.p_alp_majority, "ALP"]]
    .map(([l, v, p]) => `<div><div class="v" style="${p ? `color:${col(p)}` : ""}">${pct(v)}</div><div class="l">${l}</div></div>`).join("");
  const rows = [["Coalition", "LNP", "LIB", true], ["Labor", "ALP", "ALP", true], ["One Nation", "ON", "ON"], ["Greens", "GRN", "GRN"], ["Independents", "IND", "IND"]];
  const max = 64, x = (v) => `${(100 * v) / max}%`;
  $("#ranges").innerHTML = rows.filter(([, k]) => sm.seats[k]).map(([name, k, c, maj]) => {
    const r = sm.seats[k];
    return `<div class="range"><span class="name">${S.F.parties?.[c] && k !== "LNP" ? `<button type="button" class="linkish" data-party="${c}">${name}</button>` : name}</span><span class="track">${maj ? `<i class="maj" style="left:${x(45)}"></i>` : ""}<i class="band" style="left:${x(r.p10)};width:calc(${x(r.p90 - r.p10)} + 2px);background:${col(c)}"></i><i class="dot" style="left:${x(r.p50)};background:${col(c)}"></i></span><span class="val">${r.p50} <small>${r.p10}–${r.p90}</small></span></div>`;
  }).join("") + `<p class="caption">Middle estimate of seats, with the range covering 80% of simulations. Dashed line: 45 seats for a majority.</p>`;

  // Coalition seat distribution
  const d = S.F.distribution.LNP, n = S.F.simulations;
  const lo = Math.max(0, d.findIndex((v) => v / n > 0.002) - 1), hi = d.length - 1 - [...d].reverse().findIndex((v) => v / n > 0.002) + 1;
  const vals = d.slice(lo, hi + 1).map((v) => v / n), vmax = Math.max(...vals);
  const W = 420, H = 120, bw = W / vals.length;
  const bars = vals.map((v, i) => { const seats = lo + i, h = (v / vmax) * (H - 26);
    return `<rect class="bar" x="${(i * bw + 1).toFixed(1)}" y="${(H - 18 - h).toFixed(1)}" width="${Math.max(bw - 2, 1).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${col("LIB")}" opacity="${seats >= 45 ? 1 : 0.35}"><title>${seats} seats: ${pct(v, 1)}</title></rect>`; }).join("");
  const mx = (45 - lo) * bw;
  const ticks = []; for (let t = Math.ceil(lo / 5) * 5; t <= hi; t += 5) ticks.push(`<text x="${((t - lo) * bw + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${t}</text>`);
  $("#dist").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribution of Coalition seat totals"><g class="axis"><line x1="0" x2="${W}" y1="${H - 17.5}" y2="${H - 17.5}"/>${ticks.join("")}</g>${bars}<line x1="${mx}" x2="${mx}" y1="4" y2="${H - 18}" stroke="var(--ink-3)" stroke-dasharray="3 3"/><text x="${mx + 4}" y="12" font-size="10.5" fill="var(--ink-2)">majority</text></svg>`;
  $("#dist-cap").textContent = `Coalition seat totals across ${n.toLocaleString("en-AU")} simulated elections. Solid bars reach a majority.`;

  $("#markets").innerHTML = `<h3>What the markets say</h3>${liveMarkets() || `<table>${S.F.markets.map((m) => `<tr><td><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.source)}</a>: ${esc(m.what)}<div class="muted">${esc(m.note)}, ${esc(m.as_of)}</div></td><td class="num">${pct(m.p)}</td></tr>`).join("")}</table>`}
    <table><tr><td><b>This model:</b> Coalition largest party<div class="muted">Majority in ${pct(sm.p_lnp_majority)} of simulations</div></td><td class="num">${pct(sm.p_lnp_largest)}</td></tr>
    ${(() => { const o = (S.ledger?.odds || []).filter((r) => r.seat === "statewide").at(-1); return o ? `<tr><td><b>${esc(o.source)}</b> (you recorded, ${esc(o.as_of || "")})<div class="muted">${Object.entries(o.odds).map(([k, v]) => `${esc(outName(k))} $${Number(v).toFixed(2)}`).join(" · ")}</div></td><td class="num">${pct(Number(Object.entries(o.implied).sort((a, b) => b[1] - a[1])[0][1]))}</td></tr>` : ""; })()}</table>`;
}

const POLLSTER = { "demosau": "DemosAU", "freshwater": "Freshwater Strategy", "redbridge": "RedBridge", "redbridge-accent": "RedBridge Accent",
  "resolve": "Resolve", "roy-morgan": "Roy Morgan" };
const COMM = { "the-australian": "The Australian", "premier-national": "Premier National", "herald-sun": "Herald Sun", "victorian-trades-hall": "Victorian Trades Hall",
  "australian-financial-review": "AFR", "the-age": "The Age", "self": "" };
const pollName = (p) => POLLSTER[p.pollster] || p.pollster;
const dshort = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" });
const IN = [["LNP", "Coalition", "LIB"], ["ALP", "Labor", "ALP"], ["ON", "One Nation", "ON"], ["GRN", "Greens", "GRN"]];
const arrow = (a, b, fmt, good = null) => { const d = b - a; return Math.abs(d) < 1e-9 ? `<b>${fmt(b)}</b>` : `${fmt(a)} → <b>${fmt(b)}</b>`; };

function renderChanges() {
  const C = S.changes, el = $("#changes");
  if (!C) { el.hidden = true; return; }
  el.hidden = false;
  const L = C.latest, P = C.previous;
  const when = new Date(L.run_at).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const np = C.new_polls.map((id) => C.polls.find((p) => p.id === id)).filter(Boolean);
  const pin = (k) => ({ LNP: L.inputs.LNP, ALP: L.inputs.ALP, ON: L.inputs.ON, GRN: L.inputs.GRN })[k];
  const flips = C.flips.slice(0, 10).map((f) => { const s = seatBy(f.slug); return s ? `<button class="seat-chip" type="button" data-open-seat="${f.slug}" style="--a:.35;--pc:${col(f.to[0])}">${esc(s.name)} <b>${f.from[0] !== f.to[0] ? `${SHORT[f.from[0]] || f.from[0]} → ` : ""}${SHORT[f.to[0]] || f.to[0]} ${pct(f.to[1])}</b></button>` : ""; }).join("");
  el.innerHTML = `<div class="changes-in">
    <div class="ch-head"><span class="ch-tag">Model v${esc(S.F.model_version || "1.0")}</span><span class="ch-tag" style="background:var(--ink-2)">Latest update</span><span>${when}</span>${P ? `<span class="dim">compared with ${new Date(P.run_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</span>` : ""}</div>
    ${L.note ? `<p class="ch-poll"><b>${esc(L.note.split(":")[0])}:</b>${esc(L.note.split(":").slice(1).join(":"))}</p>` : ""}
    ${np.length ? np.map((p) => `<p class="ch-poll"><b>New poll:</b> ${esc(pollName(p))}${COMM[p.commissioner] ? ` for ${COMM[p.commissioner]}` : ""}, ${dshort(p.start)}–${dshort(p.end)}: ${IN.map(([k, n, c]) => `<span style="color:${col(c)}">${n} ${p[{ LNP: "lnp", ALP: "alp", ON: "on", GRN: "grn" }[k]]}</span>`).join(" · ")} ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">source</a>` : ""}</p>`).join("")
      : L.note ? "" : `<p class="ch-poll dim">No new poll since the previous run.</p>`}
    ${P ? `<div class="ch-grid">
      <div><span class="l">Poll average</span>${IN.map(([k, n]) => `<span>${n} ${arrow(P.inputs[k], L.inputs[k], (v) => v.toFixed(1))}</span>`).join("")}</div>
      <div><span class="l">Who governs</span><span>Coalition majority ${arrow(P.summary.lnp_maj, L.summary.lnp_maj, pct)}</span><span>Hung ${arrow(P.summary.hung, L.summary.hung, pct)}</span><span>Labor majority ${arrow(P.summary.alp_maj, L.summary.alp_maj, pct)}</span></div>
      <div><span class="l">Seats (middle)</span>${[["LNP", "Coalition"], ["ALP", "Labor"], ["ON", "One Nation"], ["GRN", "Greens"]].map(([k, n]) => `<span>${n} ${arrow(P.summary.seats[k] ?? 0, L.summary.seats[k] ?? 0, (v) => v)}</span>`).join("")}</div>
    </div>
    ${flips ? `<div class="ch-flips"><span class="l">Seats that moved most</span><div class="chips-wrap">${flips}</div></div>` : ""}` : ""}
    <p class="ch-foot"><a href="#polls">All polls ↓</a></p></div>`;
}

function pollTrend(PA) {
  const tr = PA.trend, W = 760, H = 170, pad = { l: 30, r: 90, t: 10, b: 20 };
  const t0 = Date.parse(tr[0].date), t1 = Date.parse(S.F.election_date);
  const x = (d) => pad.l + ((Date.parse(d) - t0) / (t1 - t0)) * (W - pad.l - pad.r), y = (v) => pad.t + (1 - v / 40) * (H - pad.t - pad.b);
  const ser = [["lnp", "Coalition", "LIB"], ["alp", "Labor", "ALP"], ["onp", "One Nation", "ON"], ["grn", "Greens", "GRN"]];
  const polls = (S.changes?.polls || []);
  const key = { lnp: "lnp", alp: "alp", onp: "on", grn: "grn" };
  const ly = ser.map(([k, n]) => ({ k, y: y(tr.at(-1)[k]) + 4 })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ly.length; i++) ly[i].y = Math.max(ly[i].y, ly[i - 1].y + 12);
  const at = Object.fromEntries(ly.map((l) => [l.k, l.y]));
  return `<svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="Poll average over 2026">
    <g class="axis">${[0, 10, 20, 30, 40].map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${pad.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}%</text>`).join("")}
    ${["2026-03-01", "2026-05-01", "2026-07-01", "2026-09-01", "2026-11-01"].map((d) => `<text x="${x(d)}" y="${H - 5}" text-anchor="middle">${new Date(d).toLocaleDateString("en-AU", { month: "short" })}</text>`).join("")}</g>
    <line x1="${x(S.F.election_date)}" x2="${x(S.F.election_date)}" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--ink-3)"/>
    ${ser.map(([k, n, c]) => polls.map((p) => `<circle cx="${x(p.end).toFixed(1)}" cy="${y(Number(p[key[k]])).toFixed(1)}" r="2.6" fill="${col(c)}" opacity=".3"><title>${esc(pollName(p))} ${dshort(p.end)}: ${n} ${p[key[k]]}</title></circle>`).join("")
      + `<path d="${tr.map((d, i) => `${i ? "L" : "M"}${x(d.date).toFixed(1)},${y(d[k]).toFixed(1)}`).join("")}" fill="none" stroke="${col(c)}" stroke-width="2.4"/>
      <text x="${W - pad.r + 6}" y="${at[k].toFixed(1)}" class="lab" style="fill:${col(c)}">${n} ${tr.at(-1)[k].toFixed(1)}</text>`).join("")}
  </svg>`;
}

function renderPolls() {
  const C = S.changes, el = $("#polls");
  if (!C?.polls?.length) { el.hidden = true; return; }
  el.hidden = false;
  const avg = C.latest.inputs, PA = S.F.poll_avg;
  $("#polls-body").innerHTML = `${PA ? pollTrend(PA) : ""}<div class="table-wrap" style="margin:0"><table class="polls-t"><thead><tr><th>Pollster</th><th>For</th><th>Fieldwork</th><th class="num">Sample</th>
      ${IN.map(([, n, c]) => `<th class="num"><span class="sw" style="background:${col(c)}"></span> ${n}</th>`).join("")}<th class="num">Others</th><th></th></tr></thead><tbody>
      <tr class="avg"><td colspan="4"><b>Average the model uses</b> <span class="dim">(smoothed, house effects removed)</span></td>${IN.map(([k]) => `<td class="num"><b>${avg[k].toFixed(1)}</b></td>`).join("")}<td class="num"><b>${avg.OTHERS.toFixed(1)}</b></td><td class="num dim">weight</td></tr>
      ${PA?.election_tracker ? `<tr class="avg2"><td colspan="4">Election Tracker's average <span class="dim">(for comparison; reacts faster to new polls)</span></td>${["lnp", "alp", "onp", "grn", "others"].map((k) => `<td class="num">${PA.election_tracker[k]?.toFixed(1) ?? "—"}</td>`).join("")}<td></td></tr>` : ""}
      ${C.polls.map((p) => `<tr class="${p.in_average ? "in" : "out"}${C.new_polls.includes(p.id) ? " new" : ""}"><td>${esc(pollName(p))}${C.new_polls.includes(p.id) ? ' <span class="kind mine">New</span>' : ""}</td><td>${esc(COMM[p.commissioner] ?? p.commissioner)}</td><td>${dshort(p.start)}–${dshort(p.end)}</td><td class="num">${esc(p.n)}</td>
        ${["lnp", "alp", "on", "grn", "oth"].map((k) => `<td class="num">${esc(p[k])}</td>`).join("")}<td class="num dim">${PA?.weights?.[p.id] ? `${Math.round(PA.weights[p.id] * 100)}%` : "—"} ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">source</a>` : ""}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="caption">Polls collected nightly from Australian Election Tracker. The model's average weights each poll by sample size and age (half-life 30 days, up to 120 days old), removes each pollster's lean against the trend (${PA ? Object.entries(PA.house).filter(([, h]) => Math.abs(h.lnp) >= 0.7).map(([f, h]) => `${esc(POLLSTER[f] || f)} ${h.lnp > 0 ? "+" : ""}${h.lnp.toFixed(1)} Coalition`).join(", ") : ""}), and caps any one pollster's share, so a single poll moves it by about a third of the poll's gap from the average. Weight = that poll's share of today's average.</p>`;
}

function calledSet() { return new Set((S.ledger?.predictions || []).filter((p) => p.seat !== "statewide").map((p) => p.seat)); }

// Your picture: the model with your latest call swapped in for each seat you've called.
const PIC = [["Coalition", ["LIB", "NAT"], "LIB"], ["Labor", ["ALP"], "ALP"], ["One Nation", ["ON"], "ON"], ["Greens", ["GRN"], "GRN"], ["Independents", ["IND"], "IND"]];
function blended(preds) {
  const latest = {};
  for (const r of preds) if (r.seat !== "statewide") latest[r.seat] = r;
  const exp = Object.fromEntries(PIC.map(([n]) => [n, 0])), favs = Object.fromEntries(PIC.map(([n]) => [n, 0]));
  let differ = 0;
  for (const s of S.F.seats) {
    const pr = latest[s.slug] ? Object.fromEntries(Object.entries(latest[s.slug].probs).map(([k, v]) => [k, Number(v)])) : s.model.win;
    for (const [n, ks] of PIC) exp[n] += ks.reduce((a, k) => a + (pr[k] || 0), 0);
    const top = Object.entries(pr).sort((a, b) => b[1] - a[1])[0][0];
    const g = PIC.find(([, ks]) => ks.includes(top)); if (g) favs[g[0]] += 1;
    if (latest[s.slug] && top !== fav(s.model.win)[0]) differ += 1;
  }
  return { exp, fav: favs, differ, n: Object.keys(latest).length };
}

function renderMine() {
  const el = $("#mine"); if (!el) return;
  if (!S.ledger) { el.innerHTML = `<h3>Your picture</h3><p class="hint">Unlock your ledger to see the statewide result your calls add up to.</p>`; return; }
  const P = S.ledger.predictions.filter((r) => r.seat !== "statewide").sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const model = blended([]), mine = blended(P);
  const sw = S.ledger.predictions.filter((r) => r.seat === "statewide").at(-1);
  const rows = PIC.map(([n, , c]) => { const a = model.exp[n], b = mine.exp[n], d = b - a;
    return `<tr><td><span class="sw" style="background:${col(c)}"></span> ${n}</td><td class="num">${a.toFixed(1)}</td><td class="num"><b>${b.toFixed(1)}</b></td><td class="num ${Math.abs(d) < 0.05 ? "dim" : d > 0 ? "up" : "down"}">${Math.abs(d) < 0.05 ? "–" : (d > 0 ? "+" : "−") + Math.abs(d).toFixed(1)}</td><td class="num">${mine.fav[n]}</td></tr>`; }).join("");
  // how your expected seats have moved, one point per lock
  const steps = [{ t: null, ...model.exp }];
  P.forEach((r, i) => steps.push({ t: r.created_at, ...blended(P.slice(0, i + 1)).exp }));
  const W = 420, H = 120, pad = { l: 26, r: 92, t: 8, b: 18 };
  const series = [["Coalition", "LIB"], ["Labor", "ALP"], ["One Nation", "ON"], ["Greens", "GRN"]];
  const ymax = Math.max(50, ...steps.flatMap((s) => series.map(([n]) => s[n])));
  const x = (i) => pad.l + (steps.length > 1 ? (i / (steps.length - 1)) : 0.5) * (W - pad.l - pad.r), y = (v) => pad.t + (1 - v / ymax) * (H - pad.t - pad.b);
  const chart = P.length ? `<svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="Your expected seats after each locked call">
      <g class="axis"><line x1="${pad.l}" x2="${W - pad.r}" y1="${y(45)}" y2="${y(45)}" class="g" stroke-dasharray="3 3"/><text x="${pad.l - 4}" y="${y(45) + 3}" text-anchor="end">45</text><text x="${pad.l - 4}" y="${y(0) + 3}" text-anchor="end">0</text>
      <text x="${x(0)}" y="${H - 4}" text-anchor="middle">model</text><text x="${x(steps.length - 1)}" y="${H - 4}" text-anchor="middle">${P.length} call${P.length > 1 ? "s" : ""}</text></g>
      ${(() => { const ly = series.map(([n]) => ({ n, y: y(steps.at(-1)[n]) + 4 })).sort((a, b) => a.y - b.y);
          for (let i = 1; i < ly.length; i++) ly[i].y = Math.max(ly[i].y, ly[i - 1].y + 11);
          const at = Object.fromEntries(ly.map((l) => [l.n, l.y]));
          return series.map(([n, c]) => `<path d="${steps.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s[n]).toFixed(1)}`).join("")}" fill="none" stroke="${col(c)}" stroke-width="2"/><text x="${W - pad.r + 6}" y="${at[n].toFixed(1)}" class="lab" style="fill:${col(c)}">${n} ${steps.at(-1)[n].toFixed(0)}</text>`).join(""); })()}
    </svg>` : "";
  el.innerHTML = `<h3>Your picture <span class="dim">· ${mine.n} of 88 seats called</span></h3>
    <p class="hint">Expected seats if your locked calls replace the model where you've made them (the model fills the rest). ${mine.differ ? `You back a different favourite from the model in <b>${mine.differ}</b> seat${mine.differ > 1 ? "s" : ""}.` : ""}</p>
    <table class="sheet mine-t"><thead><tr><th></th><th>Model</th><th>With your calls</th><th>Change</th><th>Seats you favour</th></tr></thead><tbody>${rows}</tbody></table>
    ${chart}
    ${sw ? `<p class="hint" style="margin-top:6px">Your latest statewide call: ${Object.entries(sw.probs).map(([k, v]) => `${esc(outName(k))} ${pct(Number(v))}`).join(", ")}.</p>` : `<p class="hint" style="margin-top:6px">No statewide call yet. Use "Make a call" above when your seat picture settles.</p>`}`;
}

// Live prediction-market prices (data/markets.json, refreshed every 3 hours by GitHub Actions)
const MK_PICK = [
  [(m) => m.source === "Kalshi", "Who wins government", "real money, US"],
  [(m) => m.source === "Polymarket" && /most seats in the next Victorian state/i.test(m.title), "Most seats", "real money, crypto"],
  [(m) => m.source === "Manifold" && /Premier of Victoria will be from/i.test(m.title), "Premier's party", "play money"],
  [(m) => m.source === "Manifold" && /Number of Seats won by One Na/i.test(m.title), "One Nation seats", "play money"],
];
function liveMarkets() {
  const D = S.mk; if (!D?.markets?.length) return "";
  const ago = (h) => { const cut = Date.now() - 24 * 3600e3; return h.filter(([t]) => Date.parse(t) <= cut).at(-1)?.[1]; };
  const spark = (h) => { if (h.length < 2) return ""; const W = 60, H = 16, xs = h.map(([t]) => Date.parse(t)), x0 = Math.min(...xs), x1 = Math.max(...xs);
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${h.map(([t, v], i) => `${i ? "L" : "M"}${(((Date.parse(t) - x0) / (x1 - x0 || 1)) * W).toFixed(1)},${(H - 1 - v * (H - 2)).toFixed(1)}`).join("")}" fill="none" stroke="var(--ink-2)" stroke-width="1.3"/></svg>`; };
  const blocks = MK_PICK.map(([f, label, note]) => {
    const ms = D.markets.filter(f); if (!ms.length) return "";
    const byTitle = {}; ms.forEach((m) => (byTitle[m.title] ||= []).push(m));
    const grp = Object.values(byTitle).sort((a, b) => (b[0].volume || 0) - (a[0].volume || 0));
    const rows = (ms[0].source === "Polymarket" || ms[0].source === "Kalshi" ? ms : grp[0]).filter((m) => m.p >= 0.02).sort((a, b) => b.p - a.p).slice(0, 4);
    return `<tr class="mk-head"><td colspan="3"><a href="${esc(ms[0].url)}" target="_blank" rel="noopener">${esc(ms[0].source)}</a>: ${label} <span class="muted">(${note})</span></td></tr>
      ${rows.map((m) => { const a = ago(m.history || []), d = a == null ? null : m.p - a;
        return `<tr><td class="mk-out">${esc(m.outcome)}</td><td class="mk-sp">${spark(m.history || [])}${d != null && Math.abs(d) >= 0.005 ? `<span class="${d > 0 ? "pos" : "neg"}">${d > 0 ? "▲" : "▼"}${Math.abs(d * 100).toFixed(0)}</span>` : ""}</td><td class="num">${pct(m.p)}</td></tr>`; }).join("")}`;
  }).join("");
  return blocks ? `<table class="mk">${blocks}</table><p class="muted" style="margin-top:4px">Prices checked every 3 hours; last ${new Date(D.fetched).toLocaleString("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit" })}. ▲▼ = change over 24 hours. Sportsbet and other bookmakers: enter their odds yourself with "Make a call" → Record market odds.</p>` : "";
}

// ---------------------------------------------------------------- table
function rows() {
  const q = S.q.toLowerCase();
  let list = S.F.seats.filter((s) => !q || s.name.toLowerCase().includes(q) || s.mp.name.toLowerCase().includes(q));
  if (S.filter === "close") list = list.filter((s) => fav(s.model.win)[1] < 0.7);
  if (S.filter === "change") list = list.filter((s) => fav(s.model.win)[0] !== s.held_2022);
  if (S.filter === "mine") list = list.filter((s) => lastCall(s.slug));
  const key = { name: (s) => s.name, margin: (s) => s.margin.value, close: (s) => fav(s.model.win)[1] }[S.sort];
  return list.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

function marketFav(slug) {
  const o = lastOdds(slug);
  if (!o) return null;
  const [p, v] = fav(o.implied);
  return { p, v, src: o.source };
}

function renderTable() {
  const list = rows();
  const body = list.map((s) => {
    const win = Object.entries(s.model.win).filter(([, v]) => v >= 0.01);
    const [fp, fv] = fav(s.model.win);
    const m = marketFav(s.slug), c = lastCall(s.slug);
    const myP = c?.backed ? Number(c.probs[c.backed]) : null;
    const edge = c?.backed && c.price_p ? myP - Number(c.price_p) : null;
    return `<tr data-slug="${s.slug}" tabindex="0">
      <td><span class="seatname${c ? " called" : ""}">${esc(s.name)}</span>${c ? '<span class="tick" title="You\'ve locked a call here">✓</span>' : ""}${s.region === "regional" ? '<span class="tag">regional</span>' : ""}</td>
      <td><span class="mp"><span class="sw" style="background:${col(s.mp.party)}"></span>${esc(s.mp.name)}${s.mp.retiring ? '<span class="tag">retiring</span>' : ""}</span></td>
      <td class="num">${s.margin.value.toFixed(1)}<span class="dim"> v ${esc(s.margin.vs)}</span></td>
      <td><span class="model-cell"><span class="stack" aria-hidden="true">${win.map(([p, v]) => `<i style="width:${v * 100}%;background:${col(p)}"></i>`).join("")}</span><b>${SHORT[fp]} ${pct(fv)}</b></span></td>
      <td class="num">${m ? `${SHORT[m.p] || m.p} ${pct(m.v)}` : '<span class="dim">—</span>'}</td>
      <td class="num">${c?.backed ? `${SHORT[c.backed]} ${pct(myP)}` : '<span class="dim">—</span>'}</td>
      <td class="num">${edge == null ? '<span class="dim">—</span>' : `<span class="${edge >= 0 ? "pos" : "neg"}">${edge >= 0 ? "+" : "−"}${Math.abs(edge * 100).toFixed(0)}</span>`}</td>
      <td class="num">${c ? callsFor(s.slug).reduce((a, r) => a + Number(r.stake), 0) || '<span class="dim">0</span>' : '<span class="dim">—</span>'}</td></tr>`;
  }).join("");
  $("#seat-table tbody").innerHTML = body || `<tr class="empty-row"><td colspan="8">No seats match. Clear the search or pick another filter.</td></tr>`;
}

// ---------------------------------------------------------------- ledger section
function renderLedger() {
  const el = $("#ledger-body");
  if (!S.ledger) {
    el.innerHTML = `<p class="locked-note">Your calls and stakes live here once you unlock the ledger. Every call is timestamped and can't be edited: changing your mind adds a new call, so you can see what you believed and when.</p><div class="row-end" style="justify-content:flex-start"><button class="btn" type="button" data-act="unlock">Unlock ledger</button></div>`;
    return;
  }
  const P = S.ledger.predictions;
  const ev = P.reduce((a, r) => a + (r.stake && r.price_p ? Number(r.stake) * (Number(r.probs[r.backed]) / Number(r.price_p) - 1) : 0), 0);
  const called = new Set(P.map((p) => p.seat)).size;
  el.innerHTML = `<div class="ledger-grid">
      <div><div class="v">${S.ledger.budget.remaining.toLocaleString("en-AU")}</div><div class="l">Points left to stake</div></div>
      <div><div class="v">${S.ledger.budget.committed.toLocaleString("en-AU")}</div><div class="l">Points committed</div></div>
      <div><div class="v">${called}</div><div class="l">Seats called</div></div>
      <div><div class="v ${ev >= 0 ? "pos" : "neg"}">${ev >= 0 ? "+" : "−"}${Math.abs(ev).toFixed(0)}</div><div class="l">Expected profit, by your own odds</div></div></div>
    ${(() => { const sb = P.filter((r) => r.stake > 0 && r.sb_odds); const none = P.filter((r) => r.stake > 0 && r.sb_status === "not_offered").length;
      const unk = P.filter((r) => r.stake > 0 && !r.sb_odds && r.sb_status !== "not_offered").length;
      const staked = sb.reduce((a, r) => a + Number(r.stake), 0), back = sb.reduce((a, r) => a + Number(r.stake) * Number(r.sb_odds), 0);
      const sev = sb.reduce((a, r) => a + Number(r.stake) * (Number(r.probs[r.backed]) * Number(r.sb_odds) - 1), 0);
      return `<div class="sb-shadow"><h3>If it were real money at Sportsbet</h3><p class="hint">Each point treated as $1, placed at the Sportsbet odds you entered when you locked. Bookmaker odds include their margin, so this is tougher than the points ledger. Winnings are worked out once results are in.</p>
        <div class="ledger-grid"><div><div class="v">$${staked.toLocaleString("en-AU")}</div><div class="l">Staked on ${sb.length} bet${sb.length === 1 ? "" : "s"}</div></div>
        <div><div class="v">$${Math.round(back).toLocaleString("en-AU")}</div><div class="l">Back if every one wins</div></div>
        <div><div class="v ${sev >= 0 ? "pos" : "neg"}">${sev >= 0 ? "+" : "−"}$${Math.abs(sev).toFixed(0)}</div><div class="l">Expected profit, by your odds</div></div>
        <div><div class="v">${none}${unk ? ` <small>+${unk}</small>` : ""}</div><div class="l">Not offered${unk ? " (+ not checked)" : ""}</div></div></div></div>`; })()}
    ${P.length ? `<div class="table-wrap" style="margin:0"><table><thead><tr><th>Locked</th><th>Seat</th><th>Call</th><th class="num">Price</th><th class="num">Stake</th><th class="num">Returns if right</th><th class="num">Sportsbet</th><th>Why</th></tr></thead><tbody>
      ${[...P].reverse().map((r) => `<tr><td>${new Date(r.created_at).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</td><td>${esc(r.seat === "statewide" ? "Statewide" : seatBy(r.seat)?.name || r.seat)}</td>
        <td>${r.backed ? `${esc(outName(r.backed))} ${pct(Number(r.probs[r.backed]))}` : "Probabilities only"}</td>
        <td class="num">${r.price_p ? `${pct(Number(r.price_p))} <span class="dim">${esc(r.price_source || "")}</span>` : "—"}</td>
        <td class="num">${r.stake}</td><td class="num">${r.stake && r.price_p ? Math.round(Number(r.stake) / Number(r.price_p)) : "—"}</td>
        <td class="num">${r.sb_odds ? `$${Number(r.sb_odds).toFixed(2)} <span class="dim">→ $${Math.round(Number(r.stake) * Number(r.sb_odds))}</span>` : r.sb_status === "not_offered" ? '<span class="dim">not offered</span>' : '<span class="dim">—</span>'}</td><td>${esc(r.note || "")}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="locked-note">No calls yet. Open any seat, adjust the drivers if you disagree with the model, then lock your call.</p>`}`;
}

// ---------------------------------------------------------------- drawer
function openParty(code) {
  if (!S.F.parties?.[code]) return;
  S.seat = `party:${code}`;
  history.replaceState(null, "", `#party=${code}`);
  renderDrawer();
  const d = $("#drawer");
  d.setAttribute("aria-hidden", "false"); $("#scrim").hidden = false;
  d.scrollTop = 0; d.focus();
}
function openSeat(slug) {
  if (slug !== "statewide" && !seatBy(slug)) return;
  S.seat = slug; S.shifts = {}; S.flows = {}; S.calc = null; S.central = null;
  history.replaceState(null, "", `#seat=${slug}`);
  renderDrawer();
  const d = $("#drawer");
  d.setAttribute("aria-hidden", "false"); $("#scrim").hidden = false;
  d.scrollTop = 0; d.focus();
}
function closeSeat() {
  S.seat = null;
  $("#drawer").setAttribute("aria-hidden", "true"); $("#scrim").hidden = true;
  history.replaceState(null, "", location.pathname);
}

const DRIVERS = [
  ["lib_to_on_vs_alp", "Liberal voters putting One Nation ahead of Labor", ["LIB", "ON", "ALP"]],
  ["nat_to_on_vs_alp", "Nationals voters putting One Nation ahead of Labor", ["NAT", "ON", "ALP"]],
  ["on_to_lib_vs_alp", "One Nation voters putting the Coalition ahead of Labor", ["ON"]],
  ["alp_to_on_vs_lib", "Labor voters putting One Nation ahead of the Coalition", ["ALP", "ON"]],
  ["lib_to_grn_vs_alp", "Liberal voters putting the Greens ahead of Labor", ["LIB", "GRN", "ALP"]],
  ["grn_to_on_vs_alp", "Greens voters putting One Nation ahead of Labor", ["GRN", "ON"]],
  ["on_to_grn_vs_alp", "One Nation voters putting the Greens ahead of Labor", ["ON", "GRN", "ALP"]],
  ["rmin_to_on_vs_lib", "Other right-wing voters putting One Nation ahead of the Liberals", ["RMIN", "ON"]],
  ["ind_to_on_vs_alp", "Independent voters putting One Nation ahead of Labor", ["IND", "ON"]],
];
const adjusted = () => Object.values(S.shifts).some((v) => v) || Object.keys(S.flows).length > 0;

function currentProbs(seat) {
  return adjusted() && S.calc ? S.calc.win : seat.model.win;
}

function renderDrawer() {
  const d = $("#drawer");
  if (S.seat === "statewide") { d.innerHTML = statewideHTML(); bindLock(); return; }
  if (S.seat.startsWith("party:")) { d.innerHTML = partyHTML(S.seat.slice(6), S.F, S.news, PARTY, calledSet()).replace("<!--research-->", researchHTML(S.F.research_by_party?.[S.seat.slice(6)])); return; }
  const s = seatBy(S.seat);
  const slots = s.model.sim.slots;
  const prim = s.model.primaries;
  const old = Object.fromEntries(s.primaries_2022.reduce((m, c) => { const g = groupOf(c.party); m.set(g, (m.get(g) || 0) + c.pct); return m; }, new Map()));
  const drivers = DRIVERS.filter(([, , need]) => need.every((p) => slots.includes(p) || (p === "LIB" && slots.includes("NAT") && false)));
  d.innerHTML = `
    <div class="d-head">
      ${avatar(s.mp.name, s.mp.party)}
      <div><h2 id="d-title">${esc(s.name)}</h2>
        <p>${esc(s.mp.name)}, ${PARTY[s.mp.party]}${s.mp.retiring ? ", retiring at this election" : ""}${s.mp.note ? `. ${esc(s.mp.note)}` : ""}</p>
        <p>Margin ${s.margin.value}% v ${PARTY[s.margin.vs] || s.margin.vs} (2022)${s.on_federal_2025 != null ? `. One Nation polled ${(s.on_federal_2025 * 100).toFixed(1)}% here at the 2025 federal election` : ""}${s.ind_assumed ? `. Model assumes a strong independent in the mould of ${esc(s.ind_assumed)}` : ""}</p></div>
      <button class="close back" type="button" data-act="close" aria-label="Back to the count room">← Count room</button>
    </div>

    <section class="d-sec" aria-labelledby="h-win">
      <h3 id="h-win">Who wins</h3>
      <p class="hint" id="outright"></p>
      <div class="wins" id="wins"></div>
      <div class="keyline"><span><i class="k-m"></i>Model</span><span><i class="k-a"></i>With your adjustments</span><span><i class="k-me"></i>Your locked call</span></div>
    </section>

    ${whyHTML(s, S.F, PARTY)}
    ${placeHTML(s, locatorSVG(S.geo, s.slug), PARTY)}
    ${insideShell(s.slug)}

    <section class="d-sec" aria-labelledby="h-prim">
      <h3 id="h-prim">First preferences <button class="btn btn-ghost reset" type="button" data-act="reset">Reset adjustments</button></h3>
      <p class="hint">Dot: model estimate for 2026, band: likely range. Grey tick: 2022 result. Slide to shift a party's vote in this seat (other parties rebalance).</p>
      <div class="prims">${slots.map((p) => `
        <div class="prim"><span><span class="sw" style="background:${col(p)}"></span> ${SHORT[p]}</span><span class="scale" id="sc-${p}"></span><span class="val" id="pv-${p}"></span></div>
        <div class="shift"><span>adjust</span><input type="range" min="-10" max="10" step="0.5" value="${S.shifts[p] || 0}" data-shift="${p}" aria-label="Shift ${PARTY[p]} vote in ${esc(s.name)}"><span id="sv-${p}">${fmtShift(S.shifts[p] || 0)}</span></div>`).join("")}
      </div>
    </section>

    <section class="d-sec" aria-labelledby="h-pairs">
      <h3 id="h-pairs">Final two</h3>
      <p class="hint">After everyone else is excluded, who is left standing, and who wins from there.</p>
      <div class="pairs" id="pairs"></div>
    </section>

    <section class="d-sec" aria-labelledby="h-count">
      <h3 id="h-count">The count</h3>
      <p class="hint">How a typical count runs, round by round: the lowest candidate is excluded and their votes pass on by preference. Figures are percentages of formal votes.</p>
      <div class="sheet-wrap" id="sheet"></div>
    </section>

    <section class="d-sec" aria-labelledby="h-drv">
      <h3 id="h-drv">Preference drivers</h3>
      <p class="hint">How voters of an excluded party split between two that are still in. Defaults are the model's statewide assumptions; changes here only affect this seat's calculator.</p>
      <div class="drivers">${drivers.map(([k, label]) => { const def = S.F.drivers.flows[k].mean; const v = S.flows[k] ?? def; return `
        <div class="driver"><label for="f-${k}"><span>${label}</span><b id="fv-${k}">${pct(v)}</b></label>
        <input id="f-${k}" type="range" min="2" max="98" step="1" value="${Math.round(v * 100)}" data-flow="${k}"><span class="def">Statewide assumption ${pct(def)}</span></div>`; }).join("") || '<p class="hint">No contested preference flows in this seat.</p>'}
      </div>
    </section>

    ${researchHTML(s.research)}
    ${seatNewsHTML(s)}
    ${sportsbetHTML(s)}
    ${marketHTML(s.slug, outcomesFor(s))}
    ${lockHTML(s.slug, outcomesFor(s))}`;
  paintCalc(s, old);
  loadInside(s);
  bindLock();
  if (adjusted()) recompute();
}

const boothCache = {};
async function loadInside(s) {
  const el = $("#inside"); if (!el) return;
  try {
    boothCache[s.slug] ||= await (await fetch(`data/booths/${s.slug}.json`)).json();
    if (S.seat === s.slug) renderInside($("#inside"), boothCache[s.slug], s, PARTY, groupOf);
  } catch { el.innerHTML = '<p class="hint">Polling-place results not available for this seat.</p>'; }
}

function showOnMap(slug) {
  closeSeat();
  $(".maps").scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelectorAll(`.district[data-slug="${slug}"]`).forEach((p) => { p.classList.add("flash"); setTimeout(() => p.classList.remove("flash"), 4000); });
}

function avatar(name, party) {
  const ph = S.F.photos?.[name];
  if (!ph) return `<div class="monogram" style="background:${col(party)}" aria-hidden="true">${esc(initials(name))}</div>`;
  return `<figure class="avatar"><img src="${esc(ph.img)}" alt="${esc(name)}" style="border-color:${col(party)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('figure').classList.add('noimg')">
    <figcaption><a href="${esc(ph.file || ph.page)}" target="_blank" rel="noopener" title="${esc(ph.credit)}, ${esc(ph.license)}">Photo: ${esc(ph.license)}</a></figcaption></figure>`;
}

function researchHTML(items) {
  if (!items?.length) return "";
  const items2 = [...items].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return `<section class="d-sec" aria-labelledby="h-res"><h3 id="h-res">What the coverage says</h3>
    <p class="hint">Statements from articles I've read, with links. Paywalled sources are marked; where possible a free version is used.</p>
    ${items2.map((r) => `<div class="note"><p>${esc(r.text)}</p><p class="src"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.source)}: ${esc(r.title)}</a>${r.author ? `, ${esc(r.author)}` : ""}, ${esc(r.date)}${r.paywalled ? ' · <span class="pw">paywalled</span>' : r.paywalled === false ? " · free to read" : ""}</p></div>`).join("")}
  </section>`;
}

function seatNewsHTML(s) {
  const items = S.news?.seats?.[s.slug] || [];
  return `<section class="d-sec" aria-labelledby="h-news"><details><summary>Unread headlines (${items.length}), not yet checked</summary>${items.length
    ? `<p class="hint">Last 30 days, searching the seat and ${esc(s.mp.name)}. Log anything that should move your call in the note when you lock it.</p>${newsList(items)}`
    : `<p class="hint">No recent coverage found for this seat${S.news ? "" : " (news refreshes each morning)"}.</p>`}</details></section>`;
}

function groupOf(code) {
  return ({ FF: "RMIN", FPV: "RMIN", DLP: "RMIN", LDP: "RMIN", SFF: "RMIN", AVP: "RMIN", HAP: "RMIN", AJP: "PROG", VS: "PROG", REA: "PROG", LCV: "PROG", DHJ: "OTH", ND: "OTH", TMP: "OTH", CPP: "OTH" })[code] || code;
}
const initials = (n) => n.replace(/\(.*?\)|[^A-Za-z\s'-]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const fmtShift = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : "0");
const outcomesFor = (s) => Object.entries(s.model.win).filter(([, v]) => v >= 0.005).map(([k]) => k);

function paintCalc(s, old) {
  const probs = s.model.win, adj = adjusted() ? S.calc?.win : null, c = lastCall(s.slug);
  const show = Object.keys(probs).filter((k) => probs[k] >= 0.005 || (adj && adj[k] >= 0.005) || (c && Number(c.probs[k]) > 0));
  $("#wins").innerHTML = show.map((k) => `<div class="win"><span><span class="sw" style="background:${col(k)}"></span> ${PARTY[k]}</span>
      <span class="bars"><i class="m" style="width:${(probs[k] || 0) * 100}%;background:${col(k)};opacity:.55"></i>${adj ? `<i class="a" style="width:${(adj[k] || 0) * 100}%"></i>` : ""}${c && c.probs[k] != null ? `<i class="me" style="left:calc(${Number(c.probs[k]) * 100}% - 1px)" title="Your call ${pct(Number(c.probs[k]))}"></i>` : ""}</span>
      <span class="pct">${pct(probs[k] || 0)}${adj ? ` <small>→ ${pct(adj[k] || 0)}</small>` : ""}</span></div>`).join("");
  const out = adj ? S.calc.outright : s.model.outright;
  $("#outright").textContent = `Chance someone wins outright on first preferences (over 50%): ${pct(out)}. Otherwise preferences decide it.`;

  // primaries with optional shifted means
  const means = adjusted() ? adjMeans(s) : null;
  const sc = 60;
  for (const p of s.model.sim.slots) {
    const pr = s.model.primaries[p];
    const m = means ? means[p] * 100 : pr.mean;
    const x = (v) => `${Math.min(100, (100 * v) / sc)}%`;
    $(`#sc-${p}`).innerHTML = `<i class="band" style="left:${x(pr.p10)};width:${(100 * (pr.p90 - pr.p10)) / sc}%;background:${col(p)}"></i>${old[p] != null ? `<i class="old" style="left:${x(old[p])}" title="2022: ${old[p].toFixed(1)}%"></i>` : ""}<i class="mean" style="left:${x(m)};background:${col(p)}"></i>`;
    $(`#pv-${p}`).textContent = `${m.toFixed(1)}%`;
  }

  const pairs = adj ? S.calc.pairs.map((q) => ({ pair: q.pair, p: q.p, wins: q.wins })) : s.model.pairs.map((q) => ({ pair: q.pair, p: q.p, wins: { [q.pair[0]]: q.p_first_wins, [q.pair[1]]: 1 - q.p_first_wins } }));
  $("#pairs").innerHTML = pairs.filter((q) => q.p >= 0.01).slice(0, 4).map((q) => {
    const [a, b] = q.pair, wa = q.wins[a] || 0, wb = q.wins[b] || 0;
    const lead = wa >= wb ? a : b;
    return `<div class="pair"><span>${PARTY[a]} v ${PARTY[b]}</span><span class="p">${pct(q.p)}</span>
      <span class="split" aria-hidden="true"><i style="width:${wa * 100}%;background:${col(a)}"></i><i style="width:${wb * 100}%;background:${col(b)}"></i></span>
      <span class="sub2">If it comes to this, ${PARTY[lead]} wins ${pct(Math.max(wa, wb))} of the time.</span></div>`;
  }).join("");

  // the count sheet
  const cc = S.central || { slots: s.model.sim.slots, rounds: s.model.trace.map((r) => ({ excluded: r.excluded == null ? null : s.model.sim.slots.indexOf(r.excluded), totals: r.totals })), winner: null };
  const rs = cc.rounds, last = rs.at(-1), winIdx = last.totals.reduce((bi, v, i, arr) => (v != null && (arr[bi] == null || v > arr[bi]) ? i : bi), 0);
  const head = `<tr><th>Round</th>${cc.slots.map((p) => `<th><span class="sw" style="background:${col(p)}"></span>${SHORT[p]}</th>`).join("")}</tr>`;
  const body = rs.map((r, i) => {
    const label = i === 0 ? "First preferences" : `${i}. ${SHORT[cc.slots[r.excluded]]} out`;
    const isLast = i === rs.length - 1;
    return `<tr class="${isLast ? "final" : ""}"><td>${label}</td>${r.totals.map((v, j) => {
      if (v == null) { const exNow = r.excluded === j; return `<td class="${exNow ? "ex" : "gone"}">${exNow ? rs[i - 1].totals[j]?.toFixed(1) ?? "" : ""}</td>`; }
      return `<td class="${isLast && j === winIdx ? "won" : ""}" style="${isLast && j === winIdx ? `--wc:${col(cc.slots[j])}` : ""}">${v.toFixed(1)}</td>`;
    }).join("")}</tr>`;
  }).join("");
  $("#sheet").innerHTML = `<table class="sheet"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function adjMeans(s) {
  const { slots, mean } = s.model.sim;
  const m = slots.map((p, i) => Math.max(mean[i] + (S.shifts[p] || 0) / 100, 0.0005));
  const t = m.reduce((a, v) => a + v, 0);
  return Object.fromEntries(slots.map((p, i) => [p, m[i] / t]));
}

let timer;
function recompute() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const s = seatBy(S.seat); if (!s) return;
    if (adjusted()) {
      S.calc = simulateSeat(s, S.F, { shifts: S.shifts, flows: S.flows, S: 2500 });
      S.central = centralCount(s, S.F, { shifts: S.shifts, flows: S.flows });
    } else { S.calc = null; S.central = null; }
    const old = Object.fromEntries(s.primaries_2022.reduce((m, c) => { const g = groupOf(c.party); m.set(g, (m.get(g) || 0) + c.pct); return m; }, new Map()));
    paintCalc(s, old);
    const sbs = $("#sb-sec"); if (sbs) sbs.outerHTML = sportsbetHTML(s);
    refreshLockDefaults();
  }, 90);
}

// ---------------------------------------------------------------- market odds + lock
const odds$ = (p) => (p > 0 ? `$${(1 / p).toFixed(2)}` : "—");
const pc$ = (p) => `${pct(p)} <span class="dim">(${odds$(p)})</span>`;
function sbSpark(hist, k) {
  const pts = hist.filter((h) => h.odds[k]).map((h) => [Date.parse(h.t), 1 / h.odds[k]]);
  if (pts.length < 2) return '<span class="dim">—</span>';
  const W = 70, H = 18, x0 = pts[0][0], x1 = pts.at(-1)[0], lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-label="Implied chance over time"><path d="${pts.map(([x, v], i) => `${i ? "L" : "M"}${(((x - x0) / (x1 - x0 || 1)) * (W - 2) + 1).toFixed(1)},${(H - 2 - ((v - lo) / (hi - lo || 1)) * (H - 4)).toFixed(1)}`).join("")}" fill="none" stroke="var(--ink-2)" stroke-width="1.4"/></svg>`;
}
function sportsbetHTML(s) {
  const d = S.sb?.seats?.[s.slug]; if (!d) return "";
  const L = d.latest, mine = adjusted() && S.calc ? S.calc.win : null, c = lastCall(s.slug);
  const keys = Object.keys(L.odds).sort((a, b) => L.odds[a] - L.odds[b]);
  const name = (k) => (k === "OTH" ? "Any other" : k === "IND" && d.names?.IND ? `${esc(d.names.IND)} (Ind.)` : esc(PARTY[k] || k));
  const rows = keys.map((k) => {
    const o = L.odds[k], m = s.model.win[k] ?? (k === "OTH" ? 0 : null);
    const you = c && c.probs[k] != null ? Number(c.probs[k]) : mine ? mine[k] ?? null : null;
    const p = you ?? m, ev = p == null ? null : p * o - 1;
    return `<tr><td>${k === "OTH" ? "" : `<span class="sw" style="background:${col(k)}"></span> `}${name(k)}</td><td class="num"><b>$${o.toFixed(2)}</b></td><td class="num">${pct(L.implied[k])}</td><td class="num">${pct(L.fair[k])}</td>
      <td class="num">${m == null ? '<span class="dim">not in model</span>' : pc$(m)}</td><td class="num">${you == null ? '<span class="dim">—</span>' : pc$(you)}</td>
      <td class="num">${ev == null ? "—" : `<span class="${ev > 0 ? "pos" : "neg"}">${ev > 0 ? "+" : "−"}${Math.abs(ev * 100).toFixed(0)}c</span>`}</td><td>${sbSpark(d.history, k)}</td></tr>`;
  }).join("");
  const best = keys.map((k) => { const p = (c && c.probs[k] != null ? Number(c.probs[k]) : mine?.[k]) ?? s.model.win[k]; return p == null ? null : { k, ev: p * L.odds[k] - 1, p }; }).filter(Boolean).sort((a, b) => b.ev - a.ev)[0];
  return `<section class="d-sec" id="sb-sec" aria-labelledby="h-sb"><h3 id="h-sb">Sportsbet</h3>
    <p class="hint">Odds as of ${new Date(L.as_of).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} (${d.history.length} snapshot${d.history.length > 1 ? "s" : ""}). Margin on this seat: <b>${(L.margin * 100).toFixed(1)}%</b>. Implied = 1 ÷ odds; fair = with the margin removed. Value = chance × odds − 1, per $1, using your chance if you've set one, otherwise the model's.</p>
    <div class="sheet-wrap"><table class="sheet sb-t"><thead><tr><th></th><th>Odds</th><th>Implied</th><th>Fair</th><th>Model</th><th>You</th><th>Value</th><th>Trend</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${best && best.ev > 0.03 ? `<p class="verdict pos">Best value: <b>${name(best.k)} at $${L.odds[best.k].toFixed(2)}</b>: ${pct(best.p)} × ${L.odds[best.k].toFixed(2)} = ${(best.p * L.odds[best.k]).toFixed(2)}, about ${(best.ev * 100).toFixed(0)}c per $1 on average. Quarter-Kelly stake: <b>${Math.max(0, Math.round(250 * best.ev / (L.odds[best.k] - 1)))} points</b>. Only worth it if you believe ${pct(best.p)} (${odds$(best.p)}).</p>`
      : `<p class="verdict">No value at these odds: every price is shorter than ${c || mine ? "your" : "the model's"} chance justifies.</p>`}
    <p class="hint"><a href="${esc(S.sb.url)}" target="_blank" rel="noopener">Sportsbet seat markets ↗</a> · refreshed on request</p>
  </section>`;
}

function marketHTML(slug, outs) {
  const o = lastOdds(slug);
  const latest = o ? `<p class="mkt-latest">Latest: ${esc(o.source)}${o.as_of ? `, ${esc(String(o.as_of).slice(0, 10))}` : ""}. With the bookmaker's margin removed: ${Object.entries(o.implied).map(([k, v]) => `${esc(outName(k))} ${pct(Number(v))}`).join(", ")}.</p>` : `<p class="hint">No odds recorded for this ${slug === "statewide" ? "question" : "seat"} yet. Bookmakers usually open seat markets in the last few weeks.</p>`;
  if (!S.ledger) return `<section class="d-sec"><h3>Market odds</h3>${latest}<p class="locked-out">Unlock your ledger to record odds.</p></section>`;
  return `<section class="d-sec" aria-labelledby="h-mkt"><h3 id="h-mkt">Market odds</h3>${latest}
    <form id="mkt-form">
      <p class="hint">Enter the decimal odds as quoted (e.g. $2.10 is 2.10). The margin is removed automatically.</p>
      <div class="mkt-form">${outs.map((k) => `<label>${esc(outName(k))}<input name="o-${k}" inputmode="decimal" placeholder="2.10"></label>`).join("")}</div>
      <div class="mkt-foot">
        <label>Source<select name="source"><option>Sportsbet</option><option>TAB</option><option>Ladbrokes</option><option>Betfair</option><option>Neds</option><option>Other</option></select></label>
        <label>As of<input name="as_of" type="date" value="${new Date().toLocaleDateString("en-CA")}"></label>
        <button class="btn btn-quiet" type="submit">Save odds</button>
      </div>
    </form><p class="err" id="mkt-err" role="alert"></p></section>`;
}

function lockHTML(slug, outs) {
  if (!S.ledger) return `<section class="d-sec"><h3>Lock your call</h3><p class="locked-out">Unlock your ledger to lock a call and stake points.</p><div class="row-end" style="justify-content:flex-start"><button class="btn" type="button" data-act="unlock">Unlock ledger</button></div></section>`;
  const hist = callsFor(slug);
  return `<section class="d-sec" aria-labelledby="h-lock"><h3 id="h-lock">Lock your call</h3>
    <p class="hint">Your own probability for each outcome. Prefilled from the ${slug === "statewide" ? "model" : "calculator"}; change any you disagree with. Once locked it can't be edited.</p>
    <form id="lock-form">
      <div class="lock-grid">${outs.map((k) => `<label>${esc(outName(k))}<input name="p-${k}" inputmode="numeric" data-out="${k}"></label>`).join("")}</div>
      <p class="lock-sum" id="lock-sum"></p>
      <div class="lock-row">
        <label>Stake on<select name="backed">${outs.map((k) => `<option value="${k}">${esc(outName(k))}</option>`).join("")}</select></label>
        <label>Points (${S.ledger.budget.remaining} left)<input name="stake" type="number" min="0" max="${S.ledger.budget.remaining}" step="1" value="0"></label>
      </div>
      <div class="sb-row">
        <label>Sportsbet odds for this outcome <span class="dim">(decimal, at this moment)</span><input name="sb_odds" type="number" min="1.01" step="0.01" placeholder="e.g. 2.50"></label>
        <label class="chk"><input type="checkbox" name="sb_none"> Sportsbet doesn't offer it</label>
        <a class="dim" href="https://www.sportsbet.com.au/betting/politics" target="_blank" rel="noopener">Check Sportsbet ↗</a>
      </div>
      <div class="lock-out" id="lock-out"></div>
      <textarea name="note" placeholder="Why? The driver or story behind this call."></textarea>
      <div class="row-end"><button class="btn" type="submit">Lock call</button></div>
      <p class="err" id="lock-err" role="alert"></p>
    </form>
    ${hist.length ? `<div class="history"><h3>Earlier calls here</h3><ul>${[...hist].reverse().map((r) => `<li>${new Date(r.created_at).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}: ${r.backed ? `${esc(outName(r.backed))} ${pct(Number(r.probs[r.backed]))}, ${r.stake} pts at ${pct(Number(r.price_p))}` : "probabilities only"}${r.note ? `. ${esc(r.note)}` : ""}</li>`).join("")}</ul></div>` : ""}
  </section>`;
}

function statewideHTML() {
  const sm = S.F.summary;
  const outs = ["LNP_MAJ", "HUNG", "ALP_MAJ"];
  const model = { LNP_MAJ: sm.p_lnp_majority, HUNG: sm.p_hung, ALP_MAJ: sm.p_alp_majority };
  return `<div class="d-head"><div class="monogram" style="background:var(--ink)">88</div>
      <div><h2 id="d-title">Who governs</h2><p>Statewide call: majority or hung parliament. 45 seats needed.</p></div>
      <button class="close back" type="button" data-act="close" aria-label="Back to the count room">← Count room</button></div>
    <section class="d-sec"><h3>The model</h3>
      <div class="wins">${outs.map((k) => `<div class="win"><span>${outName(k)}</span><span class="bars"><i class="m" style="width:${model[k] * 100}%;background:${outCol(k)};opacity:.55"></i></span><span class="pct">${pct(model[k])}</span></div>`).join("")}</div>
      <p class="hint" style="margin-top:10px">Markets mostly ask who forms government, which in a hung parliament usually means the largest party. The model has the Coalition largest in ${pct(sm.p_lnp_largest)} of simulations.</p></section>
    ${marketHTML("statewide", outs)}${lockHTML("statewide", outs)}`;
}

function lockOutcomes() { return [...document.querySelectorAll("#lock-form [data-out]")].map((i) => i.dataset.out); }

function refreshLockDefaults(force = true) {
  const f = $("#lock-form"); if (!f) return;
  const outs = lockOutcomes();
  let src;
  if (S.seat === "statewide") { const sm = S.F.summary; src = { LNP_MAJ: sm.p_lnp_majority, HUNG: sm.p_hung, ALP_MAJ: sm.p_alp_majority }; }
  else src = currentProbs(seatBy(S.seat));
  const raw = outs.map((k) => (src[k] || 0) * 100);
  const tot = raw.reduce((a, v) => a + v, 0) || 1;
  const r = raw.map((v) => Math.round((v * 100) / tot));
  r[r.indexOf(Math.max(...r))] += 100 - r.reduce((a, v) => a + v, 0);
  if (force) outs.forEach((k, i) => (f.elements[`p-${k}`].value = r[i]));
  const best = outs[r.indexOf(Math.max(...r))];
  if (force) f.elements.backed.value = best;
  updateLockSummary();
}

function priceFor(slug, k) {
  const sb = S.sb?.seats?.[slug]?.latest;
  if (sb && sb.odds[k]) return { p: 1 / sb.odds[k], src: "Sportsbet", odds: sb.odds[k] };
  const o = lastOdds(slug);
  if (o && o.odds?.[k]) return { p: 1 / Number(o.odds[k]), src: o.source, odds: Number(o.odds[k]) };
  if (o && o.implied[k] != null) return { p: Number(o.implied[k]), src: o.source };
  const m = slug === "statewide" ? { LNP_MAJ: S.F.summary.p_lnp_majority, HUNG: S.F.summary.p_hung, ALP_MAJ: S.F.summary.p_alp_majority }[k] : seatBy(slug).model.win[k];
  return { p: Math.min(0.99, Math.max(0.01, m || 0.01)), src: "model" };
}

function sbRecorded(slug, k) {
  const sb = S.sb?.seats?.[slug]?.latest;
  if (sb && sb.odds[k]) return sb.odds[k];
  const o = (S.ledger?.odds || []).filter((r) => r.seat === slug && /sportsbet/i.test(r.source || "")).at(-1);
  return o && o.odds[k] ? Number(o.odds[k]) : null;
}

function updateLockSummary() {
  const f = $("#lock-form"); if (!f) return;
  const outs = lockOutcomes();
  const vals = Object.fromEntries(outs.map((k) => [k, Number(f.elements[`p-${k}`].value || 0)]));
  const sum = Object.values(vals).reduce((a, v) => a + v, 0);
  const s = $("#lock-sum");
  s.textContent = `Adds up to ${sum}%${sum === 100 ? "" : ", needs to be 100%"}.`;
  s.classList.toggle("bad", sum !== 100);
  const k = f.elements.backed.value, stake = Math.max(0, Math.floor(Number(f.elements.stake.value || 0)));
  const pr = priceFor(S.seat, k), mine = (vals[k] || 0) / 100;
  const edge = mine - pr.p, ev = stake * (mine / pr.p - 1);
  $("#lock-out").innerHTML = `<div class="row"><span>Price for ${esc(outName(k))} (${pr.src === "model" ? "model, no odds recorded" : esc(pr.src)})</span><b>${pct(pr.p)}</b></div>
    <div class="row"><span>Your edge</span><b class="${edge >= 0 ? "pos" : "neg"}">${edge >= 0 ? "+" : "−"}${Math.abs(edge * 100).toFixed(0)} points</b></div>
    <div class="row"><span>If right, ${stake} pts returns</span><b>${Math.round(stake / pr.p)} pts</b></div>
    <div class="row"><span>Expected profit by your own odds</span><b class="${ev >= 0 ? "pos" : "neg"}">${ev >= 0 ? "+" : "−"}${Math.abs(ev).toFixed(0)} pts</b></div>
    ${(() => { const sb = Number(f.elements.sb_odds.value || 0); if (!(sb > 1) || !stake) return f.elements.sb_none.checked ? `<div class="row"><span>Sportsbet</span><b class="dim">not offered, no shadow bet</b></div>` : "";
      const sev = stake * (mine * sb - 1);
      return `<div class="row"><span>As real money at Sportsbet: $${stake} at $${sb.toFixed(2)} returns</span><b>$${(stake * sb).toFixed(0)}</b></div>
        <div class="row"><span>Expected profit at Sportsbet, by your odds</span><b class="${sev >= 0 ? "pos" : "neg"}">${sev >= 0 ? "+" : "−"}$${Math.abs(sev).toFixed(0)}</b></div>`; })()}`;
}

function bindLock() {
  const f = $("#lock-form");
  if (f) {
    refreshLockDefaults();
    const prefillSb = () => { const v = sbRecorded(S.seat, f.elements.backed.value); f.elements.sb_odds.value = v ? v.toFixed(2) : ""; };
    prefillSb();
    f.addEventListener("input", (e) => { if (e.target.name === "backed") prefillSb(); if (e.target.name === "sb_none" && e.target.checked) f.elements.sb_odds.value = ""; if (e.target.name !== "note") updateLockSummary(); });
    f.elements.backed.addEventListener("change", () => { prefillSb(); updateLockSummary(); });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const outs = lockOutcomes();
      const probs = Object.fromEntries(outs.map((k) => [k, Number(f.elements[`p-${k}`].value || 0) / 100]));
      const total = Object.values(probs).reduce((a, v) => a + v, 0);
      const err = $("#lock-err");
      if (Math.abs(total - 1) > 0.005) { err.textContent = "Your probabilities need to add up to 100%."; return; }
      const backed = f.elements.backed.value, stake = Math.floor(Number(f.elements.stake.value || 0));
      const pr = priceFor(S.seat, backed);
      const model_probs = S.seat === "statewide" ? { LNP_MAJ: S.F.summary.p_lnp_majority, HUNG: S.F.summary.p_hung, ALP_MAJ: S.F.summary.p_alp_majority } : seatBy(S.seat).model.win;
      try {
        f.querySelector("button[type=submit]").disabled = true;
        await api("/api/predictions", { method: "POST", body: JSON.stringify({ seat: S.seat, probs, backed, stake, price_p: pr.p, price_source: pr.src, model_probs,
          adjustments: adjusted() ? { shifts: S.shifts, flows: S.flows } : null, note: f.elements.note.value,
          model_version: S.F.model_version, sb_odds: f.elements.sb_odds.value || null, sb_status: f.elements.sb_none.checked ? "not_offered" : null }) });
        await loadLedger();
        const sec = $("#lock-form")?.closest(".d-sec");
        if (sec) {
          sec.insertAdjacentHTML("afterbegin", `<div class="locked-card" role="status"><b>Locked.</b> ${stake ? `${stake} points on ${esc(outName(backed))} at ${pct(pr.p)}` : `Your probabilities are recorded`}. ${S.ledger.budget.remaining.toLocaleString("en-AU")} points left.
            <div class="row-end" style="justify-content:flex-start;margin-top:8px"><button class="btn" type="button" data-act="close">← Back to the count room</button><button class="btn btn-quiet" type="button" data-act="to-ledger">See my ledger</button></div></div>`);
          sec.scrollIntoView({ block: "start", behavior: "smooth" });
        }
      } catch (x) { err.textContent = x.message; f.querySelector("button[type=submit]").disabled = false; }
    });
  }
  const m = $("#mkt-form");
  if (m) m.addEventListener("submit", async (e) => {
    e.preventDefault();
    const odds = {};
    for (const el of m.elements) if (el.name?.startsWith("o-") && el.value) odds[el.name.slice(2)] = Number(el.value);
    try {
      await api("/api/odds", { method: "POST", body: JSON.stringify({ seat: S.seat, source: m.elements.source.value, as_of: m.elements.as_of.value, odds }) });
      await loadLedger();
    } catch (x) { $("#mkt-err").textContent = x.message; }
  });
}

// ---------------------------------------------------------------- events
function wire() {
  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
    S.mode = b.dataset.mode;
    document.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderChamber(); renderMap();
  }));
  document.querySelectorAll(".chips button").forEach((b) => b.addEventListener("click", () => {
    S.filter = b.dataset.filter;
    document.querySelectorAll(".chips button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderTable();
  }));
  document.querySelectorAll("#seat-table th button").forEach((b) => b.addEventListener("click", () => {
    S.sort = b.dataset.sort;
    document.querySelectorAll("#seat-table th button").forEach((x) => (x === b ? x.setAttribute("aria-sort", "ascending") : x.removeAttribute("aria-sort")));
    renderTable();
  }));
  $("#search").addEventListener("input", (e) => { S.q = e.target.value; renderTable(); renderChamber(); });
  $("#seat-table tbody").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-slug]"); if (tr) openSeat(tr.dataset.slug); });
  $("#seat-table tbody").addEventListener("keydown", (e) => { const tr = e.target.closest("tr[data-slug]"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openSeat(tr.dataset.slug); } });

  const ch = $("#chamber");
  ch.addEventListener("mousemove", (e) => { const c = e.target.closest(".seat"); if (c) showTip(e, c.dataset.slug); else $(".chamber-wrap .tip").hidden = true; });
  ch.addEventListener("mouseleave", () => ($(".chamber-wrap .tip").hidden = true));
  ch.addEventListener("click", (e) => { const c = e.target.closest(".seat"); if (c) openSeat(c.dataset.slug); });
  ch.addEventListener("keydown", (e) => { const c = e.target.closest(".seat"); if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openSeat(c.dataset.slug); } });
  $("#open-statewide").addEventListener("click", () => openSeat("statewide"));
  for (const id of ["#wrap-vic", "#wrap-mel"]) {
    const w = $(id);
    w.addEventListener("mousemove", (e) => { const d = e.target.closest(".district"); if (d) showTip(e, d.dataset.slug, w); else w.querySelector(".tip").hidden = true; });
    w.addEventListener("mouseleave", () => (w.querySelector(".tip").hidden = true));
    w.addEventListener("click", (e) => { const d = e.target.closest(".district"); if (d) openSeat(d.dataset.slug); });
    w.addEventListener("keydown", (e) => { const d = e.target.closest(".district"); if (d && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openSeat(d.dataset.slug); } });
  }
  $("#lens").addEventListener("change", (e) => { S.lens = e.target.value; renderMap(); });

  const drawer = $("#drawer");
  drawer.addEventListener("click", (e) => {
    const a = e.target.closest("[data-act]")?.dataset.act;
    if (a === "close") closeSeat();
    if (a === "reset") { S.shifts = {}; S.flows = {}; S.calc = null; S.central = null; renderDrawer(); }
    if (a === "unlock") openPass();
    if (a === "show-on-map") showOnMap(S.seat);
    if (a === "to-ledger") { closeSeat(); $("#ledger").scrollIntoView({ behavior: "smooth", block: "start" }); }
    const os = e.target.closest("[data-open-seat]"); if (os) openSeat(os.dataset.openSeat);
  });
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-party]"); if (b) openParty(b.dataset.party); });
  $("#changes").addEventListener("click", (e) => { const b = e.target.closest("[data-open-seat]"); if (b) openSeat(b.dataset.openSeat); });
  drawer.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.shift) { S.shifts[t.dataset.shift] = Number(t.value); $(`#sv-${t.dataset.shift}`).textContent = fmtShift(Number(t.value)); recompute(); }
    if (t.dataset.flow) { S.flows[t.dataset.flow] = Number(t.value) / 100; $(`#fv-${t.dataset.flow}`).textContent = pct(Number(t.value) / 100); recompute(); }
  });
  $("#scrim").addEventListener("click", closeSeat);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.seat) closeSeat(); });
  $("#ledger").addEventListener("click", (e) => { if (e.target.closest("[data-act=unlock]")) openPass(); });

  $("#unlock").addEventListener("click", () => {
    if (S.ledger) { S.ledger = null; S.pass = null; store.set("countroom.pass", null); renderAll(); if (S.seat) renderDrawer(); }
    else openPass();
  });
  $("#pass-cancel").addEventListener("click", () => $("#pass-dialog").close());
  $("#pass-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    S.pass = $("#pass-input").value;
    try {
      S.ledger = await api("/api/ledger");
      store.set("countroom.pass", S.pass);
      $("#pass-dialog").close();
      renderAll(); if (S.seat) renderDrawer();
    } catch (x) {
      $("#pass-err").textContent = x.status === 401 ? "That passcode doesn't match LEDGER_PASSCODE." : x.message;
      S.pass = null;
    }
  });
}
function openPass() { $("#pass-err").textContent = ""; $("#pass-input").value = ""; $("#pass-dialog").showModal(); }

boot();
