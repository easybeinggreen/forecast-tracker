// Ballot Miner: Victorian election 2026.
// Players see seat data and Sportsbet chances only; nothing from the model is in office.json.
import { decodeTopo, projector, bboxOf, pathOf } from "./map.js";
import { locatorSVG, insideShell, renderInside, placeHTML, resultsHTML, changesHTML } from "./seatx.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const PARTY = { ALP: "Labor", LIB: "Liberal", NAT: "Nationals", GRN: "Greens", ON: "One Nation", IND: "Independent",
  RMIN: "Other right", PROG: "Other progressive", OTH: "Any other" };
const SHORT = { ALP: "ALP", LIB: "LIB", NAT: "NAT", GRN: "GRN", ON: "ON", IND: "IND", RMIN: "RMIN", PROG: "PROG", OTH: "OTH" };
const col = (p) => `var(--${p in PARTY ? p : "NONE"})`;
const ORDER = ["GRN", "ALP", "IND", "PROG", "OTH", "unset", "RMIN", "ON", "LIB", "NAT"];
const DARK_TEXT = new Set(["NAT", "ON", "unset", "OTH", "RMIN", "PROG", "NONE"]);
const ABBR = {"albert-park":"AP","bendigo-east":"BE","bendigo-west":"BW","box-hill":"BH","gippsland-east":"GE","gippsland-south":"GS","glen-waverley":"GW","mill-park":"MP","murray-plains":"MuP","narre-warren-north":"NN","narre-warren-south":"NS","ovens-valley":"OV","pascoe-vale":"PV","point-cook":"PC","south-barwon":"SB","south-west-coast":"SW","st-albans":"SA","yan-yean":"YY","ashwood":"As","bass":"Ba","bayswater":"By","bellarine":"Bl","benambra":"Bn","bentleigh":"Bt","berwick":"Bk","brighton":"Bg","broadmeadows":"Bd","brunswick":"Br","bulleen":"Bu","bundoora":"Bo","carrum":"Ca","caulfield":"Cf","clarinda":"Cl","cranbourne":"Cr","croydon":"Cy","dandenong":"Da","eildon":"Ei","eltham":"El","essendon":"Es","eureka":"Eu","euroa":"Er","evelyn":"Ev","footscray":"Fo","frankston":"Fr","geelong":"Gl","greenvale":"Gv","hastings":"Ha","hawthorn":"Hw","ivanhoe":"Iv","kalkallo":"Ka","kew":"Ke","kororoit":"Ko","lara":"La","laverton":"Lv","lowan":"Lo","macedon":"Ma","malvern":"Mv","melbourne":"Me","melton":"Mt","mildura":"Mi","monbulk":"Mo","mordialloc":"Md","mornington":"Mn","morwell":"Mw","mulgrave":"Mu","narracan":"Na","nepean":"Ne","niddrie":"Ni","northcote":"No","oakleigh":"Oa","pakenham":"Pa","polwarth":"Po","prahran":"Pr","preston":"Ps","richmond":"Ri","ringwood":"Rw","ripon":"Rp","rowville":"Ro","sandringham":"Sd","shepparton":"Sh","sunbury":"Su","sydenham":"Sy","tarneit":"Ta","thomastown":"Th","warrandyte":"Wa","wendouree":"We","werribee":"Wr","williamstown":"Wi"};
const BANKROLL = 1000;
const CLOSE = new Date("2026-11-27T07:00:00Z"); // 6pm Melbourne, Fri 27 Nov
const pct = (v) => `${Math.round(v * 100)}%`;
const n0 = (v) => Math.round(v).toLocaleString("en-AU");
const store = { get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

const S = { D: null, geo: null, me: null, picks: {}, view: "2022", mapView: "2022", listView: "2022", filter: "all", sort: "sure", dir: -1, q: "", seat: null, draft: {} };
const seatBy = (slug) => S.D.seats.find((s) => s.slug === slug);
const outName = (s, k) => s.sportsbet?.names?.[k] || PARTY[k] || k;
const photo = (name) => S.D.photos?.[name];

// ---------------------------------------------------------------- API (preview mode keeps everything in the page)
const PREVIEW = !!window.OFFICE_DEMO;
const mem = {};
async function api(path, body) {
  if (PREVIEW) return previewApi(path, body);
  const r = await fetch(`/api/${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", authorization: `Bearer ${store.get("team.token") || ""}` }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
function previewApi(path, b) {
  if (path === "join" || path === "login") {
    const team = { alliance: "Alliance", aimates: "AI Mates" }[String(b.code || "aimates").toLowerCase().replace(/\s/g, "")];
    if (!team) throw new Error("That team code isn't right. Try alliance or aimates.");
    return { token: "preview", player: { name: b.name || "You", team } };
  }
  if (path === "me") return S.me ? { player: S.me, picks: Object.values(mem) } : {};
  if (path === "pick") {
    if (mem[b.seat]) throw new Error("You've already locked this seat.");
    const staked = Object.values(mem).reduce((a, p) => a + p.stake, 0);
    if (staked + b.stake > BANKROLL) throw new Error(`You have ${BANKROLL - staked} points left to bet.`);
    const sb = seatBy(b.seat).sportsbet;
    return { pick: (mem[b.seat] = { ...b, odds: sb?.odds?.[b.pick] ?? null, odds_as_of: sb?.as_of, created_at: new Date().toISOString() }) };
  }
}

// ---------------------------------------------------------------- boot
async function boot() {
  S.D = window.OFFICE_DATA || await (await fetch("data/office.json")).json();
  const topo = window.OFFICE_TOPO || await fetch("data/vic_districts.topojson").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (topo) S.geo = decodeTopo(topo, "districts");
  if (!PREVIEW && store.get("team.token")) {
    try { const r = await api("me"); if (r.player) { S.me = r.player; setPicks(r.picks); return renderApp(); } } catch {}
  }
  renderSignin("join");
}
const setPicks = (list) => { S.picks = Object.fromEntries((list || []).map((p) => [p.seat, p])); };

function renderSignin(mode) {
  $("#app").innerHTML = `<div class="signin">
    ${PREVIEW ? `<div class="preview-note"><b>Preview.</b> Nothing is saved. Any name and PIN; team code <b>alliance</b> or <b>aimates</b>.</div>` : ""}
    <div class="brand"><svg class="brand-mark" viewBox="0 0 32 20" aria-hidden="true"><path d="M3 18a13 13 0 0 1 26 0"/><path class="inner" d="M10.5 18a5.5 5.5 0 0 1 11 0"/></svg><div><h1>Ballot Miner</h1><p class="sub">Victorian election, Saturday 28 November 2026</p></div></div>
    <div class="seg" style="margin-top:18px"><button type="button" data-mode="join" aria-pressed="${mode === "join"}">First time: I have a team code</button><button type="button" data-mode="login" aria-pressed="${mode === "login"}">I've joined before</button></div>
    <form id="signin-f">
      ${mode === "join" ? `<label>Team code<input name="code" autocomplete="off" required></label>` : ""}
      <label>Your name, as the leaderboard shows it<input name="name" maxlength="40" required></label>
      <label>${mode === "join" ? "Choose a PIN (4 to 6 digits)" : "Your PIN"}<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required></label>
      <button class="btn" type="submit">${mode === "join" ? "Join the challenge" : "Sign in"}</button>
      <p class="err" id="signin-err" role="alert"></p>
    </form></div>`;
  document.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => renderSignin(b.dataset.mode)));
  $("#signin-f").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await api(mode, { name: f.name.value.trim(), pin: f.pin.value, code: f.code?.value });
      store.set("team.token", r.token); S.me = r.player;
      setPicks((await api("me")).picks); renderApp();
    } catch (x) { $("#signin-err").textContent = x.message; }
  };
}

// ---------------------------------------------------------------- page
const VIEWS = [["2022", "2022 result"], ["2025", "2025 federal"], ["sb", "2026 Sportsbet"], ["mine", "My picks"]];
const viewSeg = (attr = "view", cur = S.view, list = VIEWS) => `<div class="seg" role="group" aria-label="Colour seats by">${list.map(([k, l]) => `<button type="button" data-${attr}="${k}" aria-pressed="${cur === k}">${l}</button>`).join("")}</div>`;

function renderApp() {
  const seen = store.get("team.seen-rules");
  $("#app").innerHTML = `
  <header class="top">
    <div class="brand"><svg class="brand-mark" viewBox="0 0 32 20" aria-hidden="true"><path d="M3 18a13 13 0 0 1 26 0"/><path class="inner" d="M10.5 18a5.5 5.5 0 0 1 11 0"/></svg>
      <div><h1>Ballot Miner</h1><p class="sub">Victorian election, Saturday 28 November 2026</p></div></div>
    <p class="countdown" id="countdown"></p>
    <div class="who">${PREVIEW ? '<span class="preview-note" style="margin:0;padding:3px 10px">Preview: nothing is saved</span>' : ""}<b>${esc(S.me.name)}</b><span class="team">${esc(S.me.team)}</span><button class="btn btn-quiet" type="button" id="signout">Sign out</button></div>
  </header>
  <main>
    <details class="first" id="first" ${seen ? "" : "open"}><summary><span>Read this first: how the challenge works</span><span class="more"></span></summary>${rulesHTML()}</details>


    <section class="overview" aria-labelledby="chamber-title">
      <div class="chamber-panel">
        <div class="panel-head"><h2 id="chamber-title">The Legislative Assembly, 88 seats</h2>${viewSeg()}</div>
        <div class="chamber-wrap"><svg id="chamber" role="img" aria-labelledby="chamber-desc"></svg><div class="tip" hidden></div></div>
        <p class="caption" id="chamber-desc"></p>
        <ul class="legend" id="legend"></ul>
      </div>
      <div class="outcome-panel"><div class="panel-head"><h2>Your challenge</h2></div><div class="ledger-grid stats2" id="stats"></div><p class="caption" id="stats-note"></p></div>
    </section>

    <details class="maps" id="maps"><summary><div class="panel-head"><h2>Constituency map</h2><span class="more"></span></div></summary>
      <div class="panel-head" style="justify-content:flex-start">${viewSeg("mapview", S.mapView)}</div>
      <div class="map-grid">
        <figure class="map-fig"><div class="map-wrap" id="wrap-vic"><svg id="map-vic" role="img" aria-label="Map of Victoria's 88 districts"></svg><div class="tip" hidden></div></div><figcaption>Victoria</figcaption></figure>
        <figure class="map-fig"><div class="map-wrap" id="wrap-mel"><svg id="map-mel" role="img" aria-label="Map of Melbourne's districts"></svg><div class="tip" hidden></div></div><figcaption>Greater Melbourne</figcaption></figure>
      </div>
      <p class="caption" id="map-cap"></p>
    </details>

    <section class="seats" aria-labelledby="seats-title">
      <div class="panel-head">
        <h2 id="seats-title">Every seat</h2>
        <div class="toolbar">
          <div class="chips" role="group" aria-label="Show">
            ${[["all", "All 88"], ["todo", "Still to call"], ["called", "Called"], ["close", "Close contests"]].map(([k, l]) => `<button type="button" data-filter="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join("")}
          </div>
          <label class="search"><span class="sr">Find a seat</span><input id="search" type="search" placeholder="Find a seat or MP"></label>
        </div>
      </div>
      <div class="list-view">${viewSeg("listview", S.listView, VIEWS.filter(([k]) => k !== "mine"))}<span class="caption">Your pick and bet stay put whichever view you're on.</span></div>
      <div class="table-wrap">
        <table id="seat-table">
          <thead><tr>
            <th scope="col"><button type="button" data-sort="name">Seat</button></th>
            <th scope="col" class="num"><button type="button" data-sort="margin">Margin</button></th>
            <th scope="col"><button type="button" data-sort="sure" id="guide-h">Guide</button></th>
            <th scope="col">Your pick</th>
            <th scope="col">Bet</th>
            <th scope="col"></th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </section>

    <footer class="foot"><p>Sources: Victorian Electoral Commission 2022 results, AEC 2025 federal results rebuilt on state boundaries, ABS census, Google News. Sportsbet chances are its odds with the bookmaker's margin removed, last read ${new Date(latestOdds()).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}. Play points only; no money changes hands.</p></footer>
  </main>
  <aside class="drawer" id="drawer" aria-hidden="true" tabindex="-1"></aside><div class="scrim" id="scrim" hidden></div><div class="toast" id="toast" role="status"></div>`;
  $("#first").addEventListener("toggle", () => store.set("team.seen-rules", true));
  $("#maps").addEventListener("toggle", (e) => e.target.open && renderMap());
  $("#signout").onclick = () => { store.set("team.token", null); S.me = null; renderSignin("login"); };
  $("#search").oninput = (e) => { S.q = e.target.value.trim().toLowerCase(); renderTable(); };
  wireTips($(".chamber-wrap"), ".seat"); wireTips($("#wrap-vic"), ".district", () => S.mapView); wireTips($("#wrap-mel"), ".district", () => S.mapView);
  document.addEventListener("click", onClick);
  document.addEventListener("input", onInput);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSeat(); });
  $("#scrim").onclick = closeSeat;
  renderAll();
}
const latestOdds = () => S.D.seats.map((s) => s.sportsbet?.as_of).filter(Boolean).sort().at(-1);
function renderAll() { renderTop(); renderChamber(); renderTable(); if ($("#maps")?.open) renderMap(); }

function rulesHTML() {
  return `<div class="three two">
    <div><h3>1. Most seats right</h3><p>Pick the winner in each seat. One point for every seat you get right. A seat you don't call can't score, so call as many as you can. No betting needed.</p></div>
    <div><h3>2. Best bets (optional)</h3><p>You have ${n0(BANKROLL)} play points to back your judgement, on any seats you choose. A bet pays out at Sportsbet's price when you lock it: 100 points on a pick it gives a 40% chance pays about 240 if it wins. Bet more where you're surer, bet where you think the bookies have it wrong, and skip the rest. Most points at the end wins.</p></div>
  </div>
  <div class="foot-note"><p>One set of picks counts for both. Add your reasoning to any pick, typed or dictated; everyone's reasoning is revealed after the count. A locked pick is final. Nobody sees anyone else's picks, or the leaderboards, until the count. Picks close at <b>6pm Friday 27 November</b> (Melbourne time). Leaderboards for Alliance, AI Mates and everyone together.</p></div>`;
}

function renderTop() {
  const P = Object.values(S.picks), staked = P.reduce((a, p) => a + p.stake, 0), bets = P.filter((p) => p.stake);
  const days = Math.max(0, Math.ceil((CLOSE - Date.now()) / 864e5));
  $("#countdown").textContent = `Picks close in ${days} day${days === 1 ? "" : "s"}`;
  $("#stats").innerHTML = `
    <div><div class="v">${P.length}</div><div class="l">Seats called · ${88 - P.length ? `${88 - P.length} to go` : "all 88 done"}</div></div>
    <div><div class="v">${n0(BANKROLL - staked)}</div><div class="l">Points left to bet, of ${n0(BANKROLL)}</div></div>
    <div><div class="v">${bets.length}</div><div class="l">Bets placed · ${n0(bets.reduce((a, p) => a + p.stake * p.odds, 0))} back if all win</div></div>
    <div><div class="v">${P.filter((p) => p.pick !== sbFair(seatBy(p.seat))?.[0][0]).length}</div><div class="l">Picks against Sportsbet's favourite</div></div>`;
  $("#stats-note").textContent = P.length ? `Picks close 6pm Friday 27 November. Locked picks are final.` : "Nothing locked yet. Choose a winner in the table below, or click a seat in the chamber.";
}

// ---------------------------------------------------------------- what each view says about a seat
function sbFair(s) { const f = s.sportsbet?.fair; return f ? Object.entries(f).sort((a, b) => b[1] - a[1]) : null; }
function fed2025(s) {
  const f = s.fed2025; if (!f?.prims) return null;
  const top = Object.entries(f.prims).sort((a, b) => b[1] - a[1]), two = top.slice(0, 2).map(([k]) => k), coal = two.find((k) => k === "LIB" || k === "NAT");
  // The AEC two-party count is always Labor v Coalition. It only decides the seat where those two led the primary vote.
  if (two.includes("ALP") && coal && f.alp_tpp != null) { const k = f.alp_tpp >= 50 ? "ALP" : coal; return { k, o: k === "ALP" ? coal : "ALP", tpp: true, tppv: Math.max(f.alp_tpp, 100 - f.alp_tpp), m: Math.abs(f.alp_tpp - 50), top }; }
  return { k: top[0][0], tpp: false, m: 0, top };
}
const NO_TPP = "No two-party figure: Labor v Coalition wasn't the real contest here (Greens or independent in the top two).";
function seatColour(s, view = S.view) {
  if (view === "mine") { const p = S.picks[s.slug]; return p ? { p: p.pick, op: 1 } : { p: "unset", op: 1 }; }
  if (view === "2022") return { p: s.mp.party, op: 0.35 + 0.65 * Math.min(1, (s.margin?.value ?? 10) / 12) };
  if (view === "2025") { const f = fed2025(s); return f ? { p: f.k, op: f.tpp ? 0.35 + 0.65 * Math.min(1, f.m / 12) : 0.3 } : { p: "unset", op: 1 }; }
  const f = sbFair(s); return f ? { p: f[0][0], op: 0.3 + 0.7 * Math.min(1, Math.max(0, (f[0][1] - 0.34) / 0.6)) } : { p: "unset", op: 1 };
}
// The guide: top row is what decides the seat for the chosen view, second row the vote behind it.
const pr = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v / 100]);
function guideRows(s) {
  const v = S.listView, t = tpp22(s);
  const two22 = t ? { parts: [[t.a, t.av / 100], [t.b, t.bv / 100]], lead: null, text: `${SHORT[t.a]} ${t.av.toFixed(1)} v ${SHORT[t.b] || t.b} ${t.bv.toFixed(1)}`, sub: "2022 two-party", tpp: true } : null;
  if (v === "sb") { const f = sbFair(s); return [two22, f ? { parts: f.filter(([, x]) => x >= 0.01), lead: f[0][0], text: `${SHORT[f[0][0]] || f[0][0]} ${pct(f[0][1])}`, sub: "2026 Sportsbet chance", thin: true } : null]; }
  if (v === "2022") return [two22, { parts: pr(s.prims_2022_grouped), lead: null, text: "", sub: "2022 primary vote", thin: true }];
  const f = fed2025(s); if (!f) return [null, null];
  const prim = { parts: pr(s.fed2025.prims), lead: null, text: "", sub: "2025 primary vote", thin: true };
  return [f.tpp ? { parts: [[f.k, f.tppv / 100], [f.o, 1 - f.tppv / 100]], lead: null, text: `${SHORT[f.k]} ${f.tppv.toFixed(1)} v ${SHORT[f.o]} ${(100 - f.tppv).toFixed(1)}`, sub: "2025 two-party", tpp: true }
    : { parts: [], text: "No two-party", sub: "not Labor v Coalition here", none: true }, prim];
}
function sureOf(s) {
  const v = S.listView;
  if (v === "sb") return sbFair(s)?.[0][1] ?? 0;
  if (v === "2022") return 0.5 + (s.margin?.value ?? 0) / 100;
  const f = fed2025(s); return f?.tpp ? f.tppv / 100 : 0.5;
}
const tpp22 = (s) => (s.margin ? { a: s.held_2022, av: 50 + s.margin.value, b: s.margin.vs, bv: 50 - s.margin.value } : null);

function tipHTML(slug, view = S.view) {
  const s = seatBy(slug), p = S.picks[slug], ph = photo(s.mp.name);
  const rows = (list, fmt) => list.map(([k, v]) => `<div class="row"><span><span class="sw" style="background:${col(k)}"></span> ${esc(PARTY[k] || k)}</span><b>${fmt(v)}</b></div>`).join("");
  let body = "";
  if (view === "2022") body = `<p class="muted" style="margin-top:6px">2022 primary vote</p>${rows(Object.entries(s.prims_2022_grouped || {}).sort((a, b) => b[1] - a[1]).slice(0, 4), (v) => v.toFixed(1) + "%")}`;
  else if (view === "2025") { const f = fed2025(s); body = f ? `<p class="muted" style="margin-top:6px">2025 federal vote on these booths</p>${rows(f.top.slice(0, 4), (v) => v.toFixed(1) + "%")}<p class="muted">${f.tpp ? `Two-party: ${PARTY[f.k]} ${f.tppv.toFixed(1)}%` : NO_TPP}</p>` : ""; }
  else { const f = sbFair(s); body = f ? `<p class="muted" style="margin-top:6px">Sportsbet chance</p>${rows(f.filter(([, v]) => v >= 0.01).slice(0, 4), pct)}` : ""; }
  return `<h4>${esc(s.name)}</h4>${s.margin ? `<p class="muted">2022: ${PARTY[s.held_2022] || s.held_2022} by ${s.margin.value}% v ${PARTY[s.margin.vs] || s.margin.vs}</p>` : ""}${body}
    <p class="muted" style="margin-top:6px;font-size:11.5px">MP: ${esc(s.mp.name)}${s.mp.retiring ? " (retiring)" : ""}</p>
    ${p ? `<p class="muted" style="margin-top:6px">Your pick: <b>${esc(outName(s, p.pick))}</b>${p.stake ? `, ${p.stake} pts bet` : ""}</p>` : ""}`;
}
function wireTips(wrap, sel, view) {
  if (!wrap) return;
  wrap.addEventListener("mousemove", (e) => {
    const t = e.target.closest(sel), tip = wrap.querySelector(".tip");
    if (!t) { tip.hidden = true; return; }
    tip.innerHTML = tipHTML(t.dataset.slug, view ? view() : S.view); tip.hidden = false;
    const r = wrap.getBoundingClientRect();
    tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 270) + "px"; tip.style.top = Math.max(e.clientY - r.top - 20, 0) + "px";
  });
  wrap.addEventListener("mouseleave", () => (wrap.querySelector(".tip").hidden = true));
}

const CAPTION = { sb: "Coloured by Sportsbet's favourite (bookmaker margin removed). Fainter = less certain.",
  "2022": "Coloured by who won in 2022 (by-elections included). Fainter = closer two-party margin.",
  "2025": "Coloured by who won the 2025 federal two-party vote on this seat's booths. Where Labor v Coalition wasn't the real contest (Greens or teal seats), the faint colour is just the primary-vote leader.",
  mine: "Your locked picks. Empty dots are seats you haven't called yet." };

// ---------------------------------------------------------------- chamber
let layout;
function chamberLayout(n = 88, rows = 6) {
  const r0 = 0.4, radii = [...Array(rows)].map((_, i) => r0 + ((1 - r0) * i) / (rows - 1)), tot = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.round((n * r) / tot)); let diff = n - counts.reduce((a, b) => a + b, 0), i = rows - 1;
  while (diff) { counts[i] += Math.sign(diff); diff -= Math.sign(diff); i = (i + rows - 1) % rows; }
  const out = []; radii.forEach((r, ri) => { const c = counts[ri]; for (let k = 0; k < c; k++) { const a = Math.PI * (1 - k / (c - 1)); out.push({ x: r * Math.cos(a), y: r * Math.sin(a), a, ri }); } });
  return out.sort((p, q) => q.a - p.a || p.ri - q.ri);
}
function renderChamber(pulse) {
  layout ||= chamberLayout();
  const W = 800, H = 452, cx = 400, cy = 428, R = 380, dot = 15.5;
  const seats = S.D.seats.map((s) => ({ s, ...seatColour(s) }));
  const right = (p) => ORDER.indexOf(p) > ORDER.indexOf("unset");
  seats.sort((a, b) => ORDER.indexOf(a.p) - ORDER.indexOf(b.p) || (right(a.p) ? a.op - b.op : b.op - a.op));
  const tally = {}; seats.forEach((x) => (tally[x.p] = (tally[x.p] || 0) + 1));
  const circles = seats.map((x, i) => {
    const pt = layout[i], X = (cx + pt.x * R).toFixed(1), Y = (cy - pt.y * R).toFixed(1), ab = ABBR[x.s.slug] || "", called = !!S.picks[x.s.slug];
    const light = x.op > 0.6 && !DARK_TEXT.has(x.p);
    return `<g class="seat-g${called ? " called" : ""}${pulse === x.s.slug ? " pulse" : ""}"><circle class="seat${x.p === "unset" ? " unset" : ""}" tabindex="0" role="button" aria-label="${esc(x.s.name)}" data-slug="${x.s.slug}" cx="${X}" cy="${Y}" r="${dot}" style="${x.p === "unset" ? "" : `fill:${col(x.p)};opacity:${x.op.toFixed(2)}`}"></circle>${called ? `<circle class="ring" cx="${X}" cy="${Y}" r="${dot + 3.5}"/>` : ""}<text class="ab${light ? " light" : ""}" x="${X}" y="${Y}" dy="0.35em" text-anchor="middle" font-size="${ab.length > 2 ? 9.5 : 11.5}">${ab}</text></g>`;
  }).join("");
  const n = Object.keys(S.picks).length, lnp = (tally.LIB || 0) + (tally.NAT || 0);
  const big = S.view === "mine"
    ? `<text class="tally" x="${cx}" y="${cy - 52}" text-anchor="middle" font-size="44">${n}</text><text class="tally-sub" x="${cx}" y="${cy - 28}" text-anchor="middle">seats called, ${88 - n ? `${88 - n} to go` : "all 88 done"}</text>`
    : `<text class="tally" x="${cx - 74}" y="${cy - 50}" text-anchor="middle" font-size="46" style="fill:${col("ALP")}">${tally.ALP || 0}</text><text class="tally-sub" x="${cx - 74}" y="${cy - 26}" text-anchor="middle">Labor</text><text class="tally" x="${cx + 74}" y="${cy - 50}" text-anchor="middle" font-size="46" style="fill:${col("LIB")}">${lnp}</text><text class="tally-sub" x="${cx + 74}" y="${cy - 26}" text-anchor="middle">Coalition</text>`;
  const svg = $("#chamber"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `<line class="maj" x1="${cx}" y1="${cy - R - 24}" x2="${cx}" y2="${cy - R * 0.36}"/><text class="maj-label" x="${cx}" y="${cy - R - 30}" text-anchor="middle">45 seats to govern</text>${circles}${big}`;
  $("#chamber-desc").textContent = CAPTION[S.view];
  $("#legend").innerHTML = ORDER.filter((p) => tally[p]).map((p) => `<li><span class="sw" style="background:${p === "unset" ? "transparent;border:1px solid var(--rule)" : col(p)}"></span>${p === "unset" ? "Not called" : PARTY[p]} ${tally[p]}</li>`).join("");
}

// ---------------------------------------------------------------- map (folded)
const MEL_BBOX = [144.55, -38.33, 145.62, -37.48];
function renderMap() {
  if (!S.geo) { $("#maps").hidden = true; return; }
  const draw = (svg, bbox, W, H, clip) => {
    const proj = projector(bbox, W, H, 6);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const inBox = (f) => !clip || f.polys.some((poly) => poly[0].some(([x, y]) => x > bbox[0] && x < bbox[2] && y > bbox[1] && y < bbox[3]));
    svg.innerHTML = S.geo.filter(inBox).map((f) => { const s = seatBy(f.props.slug); if (!s) return ""; const st = seatColour(s, S.mapView);
      return `<path class="district${st.p === "unset" ? " unset" : ""}${S.picks[s.slug] ? " called" : ""}" data-slug="${s.slug}" tabindex="0" role="button" aria-label="${esc(s.name)}" d="${pathOf(f, proj)}" style="fill:${st.p === "unset" ? "var(--sheet)" : col(st.p)};fill-opacity:${st.op.toFixed(2)}"></path>`; }).join("");
  };
  const vb = bboxOf(S.geo);
  draw($("#map-vic"), vb, 640, 440, false);
  draw($("#map-mel"), MEL_BBOX, 640, 520, true);
  $("#map-cap").textContent = CAPTION[S.mapView] + " Hover a district for its details; click to open it.";
  const pv = projector(vb, 640, 440, 6), [a, b] = [pv([MEL_BBOX[0], MEL_BBOX[3]]), pv([MEL_BBOX[2], MEL_BBOX[1]])];
  $("#map-vic").insertAdjacentHTML("beforeend", `<rect x="${a[0].toFixed(1)}" y="${a[1].toFixed(1)}" width="${(b[0] - a[0]).toFixed(1)}" height="${(b[1] - a[1]).toFixed(1)}" fill="none" stroke="var(--ink-2)" stroke-width="1" stroke-dasharray="3 2" pointer-events="none"/>`);
}

// ---------------------------------------------------------------- every seat
function rows() {
  let list = S.D.seats.filter((s) => !S.q || s.name.toLowerCase().includes(S.q) || s.mp.name.toLowerCase().includes(S.q));
  if (S.filter === "todo") list = list.filter((s) => !S.picks[s.slug]);
  if (S.filter === "called") list = list.filter((s) => S.picks[s.slug]);
  if (S.filter === "close") list = list.filter((s) => { const f = sbFair(s); return f && f[0][1] < 0.6; });
  const key = { name: (s) => s.name, margin: (s) => s.margin?.value ?? 99, sure: (s) => sureOf(s) }[S.sort];
  return list.sort((a, b) => S.dir * (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
const stackHTML = (parts, lead, cls = "") => `<span class="stack${cls}" aria-hidden="true">${parts.map(([k, v]) => `<i class="${k === lead ? "lead" : ""}" style="width:${v * 100}%;background:${col(k)}"></i>`).join("")}</span>`;
function pickCells(s) {
  const d = S.draft[s.slug] || {}, f = sbFair(s) || [];
  const sel = `<select class="pick" data-slug="${s.slug}" data-f="pick" aria-label="Your pick for ${esc(s.name)}"><option value="">Choose…</option>${f.map(([k, v]) => `<option value="${k}"${d.pick === k ? " selected" : ""}>${esc(outName(s, k))}</option>`).join("")}</select>`;
  const st = `<input class="stake" data-slug="${s.slug}" data-f="stake" inputmode="numeric" placeholder="0" value="${d.stake ?? ""}" aria-label="Points to bet"><span class="pays" data-pays="${s.slug}">${paysText(s, d)}</span>`;
  const ready = !!d.pick;
  return { sel, st, why: `<button class="btn btn-quiet why-btn" type="button" data-why="${s.slug}" title="Add your reasoning (type or dictate)">${d.why ? "Why ✓" : "Why?"}</button>`, lock: `<button class="btn" type="button" data-lock="${s.slug}" ${ready ? "" : "disabled"} title="${ready ? "Lock this pick. It can't be changed." : "Choose a winner first"}">Lock</button><div class="row-err" data-err="${s.slug}"></div>` };
}
function paysText(s, d) { const o = d.pick ? s.sportsbet?.odds?.[d.pick] : null, st = Number(d.stake || 0); return o && st ? `pays ${n0(st * o)} if right` : ""; }
function renderTable() {
  document.querySelectorAll("#seat-table th button").forEach((b) => (b.dataset.sort === S.sort ? b.setAttribute("aria-sort", S.dir > 0 ? "ascending" : "descending") : b.removeAttribute("aria-sort")));
  $("#guide-h").textContent = { sb: "Guide: 2026 Sportsbet", "2022": "Guide: 2022 result", "2025": "Guide: 2025 federal" }[S.listView];
  $("#seat-table tbody").innerHTML = rows().map((s) => {
    const p = S.picks[s.slug];
    const head = `<td>${p ? `<span class="ring-dot" style="background:${col(p.pick)}"></span>` : ""}<button class="seatname link" type="button" data-open="${s.slug}">${esc(s.name)}</button>${s.region === "regional" ? '<span class="tag">regional</span>' : ""}<span class="mp-s"><span class="sw" style="background:${col(s.mp.party)}"></span>${esc(s.mp.name)}${s.mp.retiring ? ", retiring" : ""}</span></td>
      <td class="num">${s.margin ? `${s.margin.value.toFixed(1)}<span class="dim"> v ${esc(s.margin.vs)}</span>` : "—"}</td>
      <td><div class="guide-cell">${guideRows(s).filter(Boolean).map((r) => `<span class="model-cell${r.thin ? " thin" : ""}">${r.none ? `<span class="stack none"></span>` : stackHTML(r.parts, r.lead, r.tpp ? " two" : r.thin ? " tpp" : "")}${r.text ? `<b>${r.text}</b>` : ""}<span class="sub">${r.sub}</span></span>`).join("")}</div></td>`;
    if (p) return `<tr>${head}<td colspan="3"><span class="lockd">✓ <b>${esc(outName(s, p.pick))}</b>${p.stake ? ` · ${p.stake} pts bet, pays ${n0(p.stake * p.odds)} if right` : " · no bet"}${p.why ? ` · <span class="dim" title="${esc(p.why)}">with reasoning</span>` : ""}</span></td></tr>`;
    const c = pickCells(s);
    return `<tr>${head}<td>${c.sel}</td><td>${c.st}</td><td class="act">${c.why}${c.lock}</td></tr>`;
  }).join("") || `<tr class="empty-row"><td colspan="7">No seats match. Clear the search or pick another filter.</td></tr>`;
}

// ---------------------------------------------------------------- seat page: Count Room's sections, minus the model
const GROUP = { FF: "RMIN", FPV: "RMIN", DLP: "RMIN", LDP: "RMIN", SFF: "RMIN", AVP: "RMIN", HAP: "RMIN", AJP: "PROG", VS: "PROG", REA: "PROG", LCV: "PROG", DHJ: "OTH", ND: "OTH", TMP: "OTH", CPP: "OTH" };
const groupOf = (code) => GROUP[code] || code;
const initials = (n) => n.replace(/\(.*?\)|[^A-Za-z\s'-]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
function openSeat(slug) { S.seat = slug; renderDrawer(); const d = $("#drawer"); d.setAttribute("aria-hidden", "false"); $("#scrim").hidden = false; d.scrollTop = 0; d.focus(); }
function closeSeat() { stopDictation(); if (!S.seat) return; S.seat = null; $("#drawer").setAttribute("aria-hidden", "true"); $("#scrim").hidden = true; }
function avatar(name, party) {
  const ph = photo(name);
  if (!ph) return `<div class="monogram" style="background:${col(party)}" aria-hidden="true">${esc(initials(name))}</div>`;
  return `<figure class="avatar"><img src="${esc(ph.img)}" alt="${esc(name)}" style="border-color:${col(party)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('figure').classList.add('noimg')">
    <figcaption><a href="${esc(ph.file || ph.page)}" target="_blank" rel="noopener" title="${esc(ph.credit)}, ${esc(ph.license)}">Photo: ${esc(ph.license)}</a></figcaption></figure>`;
}
// Sportsbet's chance for each candidate over time, margin removed. No odds, no model.
function sbChart(s) {
  const d = s.sportsbet, H = d?.history; if (!H?.length) return "";
  const fair = (h) => { const tot = Object.values(h.odds).reduce((a, o) => a + 1 / o, 0); return Object.fromEntries(Object.entries(h.odds).map(([k, o]) => [k, 1 / o / tot])); };
  const F_ = H.map((h) => ({ t: Date.parse(h.t), f: fair(h) }));
  const keys = Object.keys(d.odds).filter((k) => k !== "OTH" && Math.max(...F_.map((x) => x.f[k] || 0)) >= 0.04);
  const W = 560, Ht = 170, L = 34, R = 130, T = 10, B = 24, t0 = F_[0].t, t1 = Math.max(F_.at(-1).t, t0 + 864e5);
  const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R), Y = (v) => T + (1 - v) * (Ht - T - B);
  const fd = (t) => new Date(t).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  let g = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="vg"/><text x="${L - 4}" y="${Y(v) + 3}" class="vt" text-anchor="end">${v * 100}%</text>`).join("");
  g += `<text x="${L}" y="${Ht - 6}" class="vt">${fd(t0)}</text><text x="${W - R}" y="${Ht - 6}" class="vt" text-anchor="end">${fd(t1)}</text>`;
  const ends = [];
  for (const k of keys) {
    const pts = F_.filter((x) => x.f[k] != null).map((x) => [X(x.t), Y(x.f[k])]); if (pts.length === 1) pts.push([X(t1), pts[0][1]]);
    g += `<path d="${pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("")}" fill="none" style="stroke:${col(k)}" stroke-width="2"/>`;
    g += F_.filter((x) => x.f[k] != null).map((x) => `<circle cx="${X(x.t).toFixed(1)}" cy="${Y(x.f[k]).toFixed(1)}" r="2.5" style="fill:${col(k)}"><title>${fd(x.t)}: ${esc(outName(s, k))} ${pct(x.f[k])}</title></circle>`).join("");
    ends.push({ k, y: Y(F_.at(-1).f[k] ?? 0) });
  }
  ends.sort((a, b) => a.y - b.y); for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
  g += ends.map((e) => `<text x="${W - R + 10}" y="${e.y + 3}" class="vt sbl" style="fill:${col(e.k)}">${esc(outName(s, e.k))} ${pct(F_.at(-1).f[e.k])}</text>`).join("");
  return `<figure class="sb-chart"><svg viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Sportsbet chances over time">${g}</svg>
    <figcaption class="hint">Sportsbet's chance for each candidate, bookmaker margin removed, at each snapshot.${H.length < 3 ? " Few snapshots so far, so the lines are flat until the market moves." : ""}</figcaption></figure>`;
}
function sbSec(s) {
  const d = s.sportsbet; if (!d) return "";
  const keys = Object.keys(d.odds).sort((a, b) => d.odds[a] - d.odds[b]);
  return `<section class="d-sec" aria-labelledby="h-sb"><h3 id="h-sb">What Sportsbet thinks</h3>
    ${sbChart(s)}
    <div class="sheet-wrap"><table class="sheet sb-t"><thead><tr><th></th><th>Chance</th><th>A 100-point bet pays</th></tr></thead><tbody>
    ${keys.map((k) => `<tr><td>${k === "OTH" ? "" : `<span class="sw" style="background:${col(k)}"></span> `}${esc(outName(s, k))}</td><td class="num"><b>${pct(d.fair[k])}</b></td><td class="num">${n0(100 * d.odds[k])}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="hint">As of ${new Date(d.as_of).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}. Your bet is priced when you lock.</p></section>`;
}
function newsSec(s) {
  const items = s.news || [];
  if (!items.length) return "";
  return `<section class="d-sec" aria-labelledby="h-news"><h3 id="h-news">In the news</h3><p class="hint">Recent headlines mentioning the seat or ${esc(s.mp.name)}.</p>
    <ul class="news-list">${items.map((n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="dim">${esc(n.source || "")}${n.date ? `, ${esc(String(n.date).slice(0, 10))}` : ""}</span></li>`).join("")}</ul></section>`;
}
function pickSec(s) {
  const p = S.picks[s.slug];
  if (p) return `<section class="d-sec" id="pick-sec" aria-labelledby="h-pick"><h3 id="h-pick">Your pick</h3><p class="lockd">✓ <b>${esc(outName(s, p.pick))}</b>${p.stake ? ` · ${p.stake} pts bet, pays ${n0(p.stake * p.odds)} if right` : " · no bet"}</p>${p.why ? `<blockquote class="why-locked">${esc(p.why)}</blockquote>` : ""}<p class="hint">Locked ${new Date(p.created_at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}. Locked picks are final.</p></section>`;
  const c = pickCells(s), d = S.draft[s.slug] || {};
  return `<section class="d-sec" id="pick-sec" aria-labelledby="h-pick"><h3 id="h-pick">Your pick</h3>
    <div class="pick-form"><label>Who wins ${esc(s.name)}?${c.sel}</label><label>Bet (optional)${c.st}</label></div>
    <div class="why">
      <label for="why-${s.slug}">Why? <span class="dim">Your reasoning, locked with your pick and revealed after the count</span></label>
      <textarea id="why-${s.slug}" data-slug="${s.slug}" data-f="why" rows="4" maxlength="2000" placeholder="e.g. Teal candidate is strong locally, Liberal margin is only 3%, and the Greens will preference her.">${esc(d.why || "")}</textarea>
      <div class="why-bar">${SpeechRec ? `<button class="btn btn-quiet" type="button" data-dictate="${s.slug}" aria-pressed="false">🎤 Dictate</button>` : `<span class="hint">Tip: use your keyboard's microphone to dictate.</span>`}<span class="hint" data-dictate-status="${s.slug}"></span>${c.lock}</div>
    </div>
    <p class="hint">Points left to bet: ${n0(BANKROLL - Object.values(S.picks).reduce((a, x) => a + x.stake, 0))}. Locked picks are final.</p></section>`;
}
function renderDrawer() {
  const s = seatBy(S.seat), p = S.picks[s.slug];
  $("#drawer").innerHTML = `
    <div class="d-head">
      ${avatar(s.mp.name, s.mp.party)}
      <div><h2 id="d-title">${esc(s.name)}</h2>
        <p>${esc(s.mp.name)}, ${PARTY[s.mp.party]}${s.mp.retiring ? ", retiring at this election" : ""}</p>
        <p>${s.margin ? `Margin ${s.margin.value}% v ${PARTY[s.margin.vs] || s.margin.vs} (2022)` : ""}${p ? ` · <b>Your pick: ${esc(outName(s, p.pick))}</b>` : ` · <button class="linkish" type="button" data-act="to-pick">Make your pick ↓</button>`}</p></div>
      <button class="close back" type="button" data-act="close" aria-label="Back to the chamber">← Chamber</button>
    </div>
    ${placeHTML(s, locatorSVG(S.geo, s.slug), PARTY)}
    ${resultsHTML(s, PARTY)}
    ${insideShell(s.slug)}
    ${changesHTML(s, PARTY)}
    ${newsSec(s)}
    ${sbSec(s)}
    ${pickSec(s)}`;
  loadInside(s);
}
const boothCache = {};
async function loadInside(s) {
  const el = $("#inside"); if (!el) return;
  try {
    boothCache[s.slug] ||= window.OFFICE_BOOTHS?.[s.slug] || await (await fetch(`data/booths/${s.slug}.json`)).json();
    if (S.seat === s.slug) renderInside($("#inside"), boothCache[s.slug], s, PARTY, groupOf);
  } catch { el.innerHTML = '<p class="hint">Polling-place results not available for this seat.</p>'; }
}
function showOnMap(slug) {
  closeSeat(); const m = $("#maps"); m.open = true; renderMap();
  m.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelectorAll(`.district[data-slug="${slug}"]`).forEach((x) => { x.classList.add("flash"); setTimeout(() => x.classList.remove("flash"), 4000); });
}

// ---------------------------------------------------------------- dictation (browser speech recognition; Chrome, Edge, Safari)
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
function stopDictation() { if (rec) { rec.onend = null; rec.stop(); rec = null; document.querySelectorAll("[data-dictate]").forEach((b) => { b.setAttribute("aria-pressed", "false"); b.textContent = "🎤 Dictate"; }); } }
function toggleDictation(btn) {
  if (rec) return stopDictation();
  const slug = btn.dataset.dictate, ta = $(`#why-${slug}`), status = document.querySelector(`[data-dictate-status="${slug}"]`), d = (S.draft[slug] ||= {});
  rec = new SpeechRec(); rec.lang = "en-AU"; rec.continuous = true; rec.interimResults = true;
  const base = () => (d.why ? d.why.replace(/\s*$/, " ") : "");
  let start = base();
  rec.onresult = (e) => {
    let fin = "", tmp = "";
    for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (tmp += e.results[i][0].transcript));
    if (fin) { start = (start + fin.trim() + ". ").replace(/^\s+/, ""); d.why = start; }
    ta.value = start + tmp;
  };
  rec.onerror = (e) => { status.textContent = e.error === "not-allowed" ? "Microphone blocked. Allow it in your browser, or type instead." : `Dictation stopped (${e.error}).`; stopDictation(); };
  rec.onend = () => stopDictation();
  try { rec.start(); btn.setAttribute("aria-pressed", "true"); btn.textContent = "■ Stop"; status.textContent = "Listening… speak your reasoning."; }
  catch { status.textContent = "Dictation isn't available here. Type instead."; rec = null; }
}

// ---------------------------------------------------------------- events
function onClick(e) {
  const t = e.target;
  const v = t.closest("[data-view]"); if (v) { S.view = v.dataset.view; document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === S.view))); renderChamber(); return; }
  const lv = t.closest("[data-listview]"); if (lv) { S.listView = lv.dataset.listview; document.querySelectorAll("[data-listview]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.listview === S.listView))); renderTable(); return; }
  const mv = t.closest("[data-mapview]"); if (mv) { S.mapView = mv.dataset.mapview; document.querySelectorAll("[data-mapview]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mapview === S.mapView))); renderMap(); return; }
  const f = t.closest("[data-filter]"); if (f) { S.filter = f.dataset.filter; document.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === f))); renderTable(); return; }
  const so = t.closest("#seat-table th button"); if (so) { const k = so.dataset.sort; S.dir = S.sort === k ? -S.dir : k === "sure" ? -1 : 1; S.sort = k; renderTable(); return; }
  const o = t.closest("[data-open]") || t.closest("#chamber .seat") || t.closest(".district"); if (o) { openSeat(o.dataset.open || o.dataset.slug); return; }
  if (t.closest("[data-act=close]")) { closeSeat(); return; }
  if (t.closest("[data-act=show-on-map]")) { showOnMap(S.seat); return; }
  if (t.closest("[data-act=to-pick]")) { $("#pick-sec")?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  const w = t.closest("[data-why]"); if (w) { openSeat(w.dataset.why); setTimeout(() => { $("#pick-sec")?.scrollIntoView({ block: "start" }); $(`#why-${w.dataset.why}`)?.focus(); }, 50); return; }
  const dc = t.closest("[data-dictate]"); if (dc) { toggleDictation(dc); return; }
  const l = t.closest("[data-lock]"); if (l) lock(l.dataset.lock);
}
function onInput(e) {
  const t = e.target, slug = t.dataset?.slug; if (!t.dataset?.f || !slug) return;
  const d = (S.draft[slug] ||= {});
  if (t.dataset.f === "stake") { t.value = t.value.replace(/\D/g, ""); d.stake = t.value; document.querySelectorAll(`[data-pays="${slug}"]`).forEach((x) => (x.textContent = paysText(seatBy(slug), d))); return; }
  if (t.dataset.f === "why") { d.why = t.value; return; }
  d.pick = t.value; refreshRow(slug);
}
function refreshRow(slug) { renderTable(); if (S.seat === slug) renderDrawer(); }
async function lock(slug) {
  const d = S.draft[slug] || {}, stake = Number(d.stake || 0), s = seatBy(slug);
  const err = (m) => document.querySelectorAll(`[data-err="${slug}"]`).forEach((x) => (x.textContent = m));
  if (!d.pick) return err("Choose a winner first.");
  try {
    stopDictation();
    const r = await api("pick", { seat: slug, pick: d.pick, stake, why: (d.why || "").trim() });
    S.picks[slug] = r.pick; delete S.draft[slug];
    closeSeat(); renderTop(); renderChamber(slug); renderTable(); if ($("#maps").open) renderMap();
    toast(`<b>${esc(s.name)} locked.</b> ${esc(outName(s, d.pick))}${stake ? `, ${stake} points bet` : ", no bet"}. ${88 - Object.keys(S.picks).length} seats to go.`);
  } catch (x) { err(x.message); }
}
function toast(html) { const t = $("#toast"); t.innerHTML = html; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 5000); }

boot();
