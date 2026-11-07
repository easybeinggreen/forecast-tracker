// Ballot Miner: Victorian election 2026.
// Players see seat data and Sportsbet chances only; nothing from the model is in office.json.
import { decodeTopo, projector, bboxOf, pathOf } from "./map.js";
import { locatorSVG, insideShell, renderInside, placeHTML, resultsHTML, changesHTML } from "./seatx.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const PARTY = { ALP: "Labor", LIB: "Liberal", NAT: "Nationals", GRN: "Greens", ON: "One Nation", IND: "Independent",
  RMIN: "Other right", PROG: "Other progressive", OTH: "Any other" };
const SHORT = { FIELD: "field", LNP: "LNP", OTHERS: "OTH", ALP: "ALP", LIB: "LIB", NAT: "NAT", GRN: "GRN", ON: "ON", IND: "IND", RMIN: "RMIN", PROG: "PROG", OTH: "OTH" };
const col = (p) => (p === "FIELD" ? "var(--rule)" : p === "LNP" ? "var(--LIB)" : p === "OTHERS" ? "var(--OTH)" : `var(--${p in PARTY ? p : "NONE"})`);
const ORDER = ["GRN", "ALP", "IND", "PROG", "OTH", "unset", "RMIN", "ON", "LIB", "NAT"];
const DARK_TEXT = new Set(["NAT", "ON", "unset", "OTH", "RMIN", "PROG", "NONE"]);
const ABBR = {"albert-park":"AP","bendigo-east":"BE","bendigo-west":"BW","box-hill":"BH","gippsland-east":"GE","gippsland-south":"GS","glen-waverley":"GW","mill-park":"MP","murray-plains":"MuP","narre-warren-north":"NN","narre-warren-south":"NS","ovens-valley":"OV","pascoe-vale":"PV","point-cook":"PC","south-barwon":"SB","south-west-coast":"SW","st-albans":"SA","yan-yean":"YY","ashwood":"As","bass":"Ba","bayswater":"By","bellarine":"Bl","benambra":"Bn","bentleigh":"Bt","berwick":"Bk","brighton":"Bg","broadmeadows":"Bd","brunswick":"Br","bulleen":"Bu","bundoora":"Bo","carrum":"Ca","caulfield":"Cf","clarinda":"Cl","cranbourne":"Cr","croydon":"Cy","dandenong":"Da","eildon":"Ei","eltham":"El","essendon":"Es","eureka":"Eu","euroa":"Er","evelyn":"Ev","footscray":"Fo","frankston":"Fr","geelong":"Gl","greenvale":"Gv","hastings":"Ha","hawthorn":"Hw","ivanhoe":"Iv","kalkallo":"Ka","kew":"Ke","kororoit":"Ko","lara":"La","laverton":"Lv","lowan":"Lo","macedon":"Ma","malvern":"Mv","melbourne":"Me","melton":"Mt","mildura":"Mi","monbulk":"Mo","mordialloc":"Md","mornington":"Mn","morwell":"Mw","mulgrave":"Mu","narracan":"Na","nepean":"Ne","niddrie":"Ni","northcote":"No","oakleigh":"Oa","pakenham":"Pa","polwarth":"Po","prahran":"Pr","preston":"Ps","richmond":"Ri","ringwood":"Rw","ripon":"Rp","rowville":"Ro","sandringham":"Sd","shepparton":"Sh","sunbury":"Su","sydenham":"Sy","tarneit":"Ta","thomastown":"Th","warrandyte":"Wa","wendouree":"We","werribee":"Wr","williamstown":"Wi"};
const BANKROLL = 1000;
const SEAT_CAP = 100; // most points on any one seat, all bets there combined
const CLOSE = new Date("2026-11-27T07:00:00Z"); // 6pm Melbourne, Fri 27 Nov
const pct = (v) => `${Math.round(v * 100)}%`;
const n0 = (v) => Math.round(v).toLocaleString("en-AU");
const store = { get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

const S = { more: {}, calls: [], bets: [], votes: [], D: null, geo: null, me: null, picks: {}, view: "2022", mapView: "2022", listView: "2022", order: null, sortView: "2022", filter: "all", sort: "sure", dir: -1, q: "", seat: null, draft: {} };
const seatBy = (slug) => S.D.seats.find((s) => s.slug === slug);
const seatPicks = () => Object.values(S.picks);
const outName = (s, k) => s.sportsbet?.names?.[k] || PARTY[k] || k;
const photo = (name) => S.D.photos?.[name];

// ---------------------------------------------------------------- API (preview mode keeps everything in the page)
const PREVIEW = !!window.OFFICE_DEMO;
const mem = { calls: [], bets: [], votes: [] };
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
  if (path === "me") return S.me ? { player: S.me, calls: [...mem.calls], bets: [...mem.bets], votes: [...mem.votes] } : {};
  if (path === "vote") {
    const tot = VOTE_KEYS.reduce((a, k) => a + Number(b.vote[k] || 0), 0);
    if (Math.abs(tot - 100) > 0.05) throw new Error(`Your numbers add to ${tot.toFixed(1)}; they need to add to 100.`);
    const v = { vote: b.vote, why: b.why || "", created_at: new Date().toISOString() }; mem.votes.push(v); return { vote: v };
  }
  const now = new Date().toISOString(), sb = seatBy(b.seat)?.sportsbet;
  if (path === "call") {
    const last = mem.calls.filter((c) => c.seat === b.seat).at(-1);
    if (last && last.pick === b.pick) throw new Error("That's already your call.");
    if (last && !b.why) throw new Error("Say what changed, in a line.");
    const c = { seat: b.seat, pick: b.pick, why: b.why || "", created_at: now }; mem.calls.push(c); return { call: c };
  }
  if (path === "bet") {
    const staked = mem.bets.reduce((a, x) => a + x.stake, 0);
    if (!(b.stake > 0)) throw new Error("Enter the points to bet.");
    if (staked + b.stake > BANKROLL) throw new Error(`You have ${BANKROLL - staked} points left to bet.`);
    const onSeat = mem.bets.filter((x) => x.seat === b.seat).reduce((a, x) => a + x.stake, 0);
    if (onSeat + b.stake > SEAT_CAP) throw new Error(capMsg(onSeat));
    const x = { seat: b.seat, pick: b.pick, stake: b.stake, odds: sb?.odds?.[b.pick] ?? null, odds_as_of: sb?.as_of, created_at: now }; mem.bets.push(x); return { bet: x };
  }
}

// ---------------------------------------------------------------- boot
async function boot() {
  S.D = window.OFFICE_DATA || await (await fetch("data/office.json")).json();
  const topo = window.OFFICE_TOPO || await fetch("data/vic_districts.topojson").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (topo) S.geo = decodeTopo(topo, "districts");
  if (!PREVIEW && store.get("team.token")) {
    try { const r = await api("me"); if (r.player) { S.me = r.player; setPicks(r); return renderApp(); } } catch {}
  }
  renderSignin("join");
}
// Calls and bets are append-only; a seat's current state is derived from them. The latest call is the one that counts.
const setPicks = (r) => { S.calls = r.calls || []; S.bets = r.bets || []; S.votes = r.votes || []; derive(); };
const VOTE_KEYS = ["ALP", "LNP", "ON", "GRN", "OTHERS"], VOTE_NAMES = { ALP: "Labor", LNP: "Coalition", ON: "One Nation", GRN: "Greens", OTHERS: "Others" };
function derive() {
  S.picks = {};
  for (const c of S.calls) (S.picks[c.seat] ||= { seat: c.seat, calls: [], bets: [] }).calls.push(c);
  for (const b of S.bets) (S.picks[b.seat] ||= { seat: b.seat, calls: [], bets: [] }).bets.push(b);
  for (const p of Object.values(S.picks)) {
    const last = p.calls.at(-1);
    Object.assign(p, { pick: last?.pick, why: last?.why, created_at: p.calls[0]?.created_at, changes: Math.max(0, p.calls.length - 1),
      stake: p.bets.reduce((a, b) => a + b.stake, 0), pays: p.bets.reduce((a, b) => a + b.stake * b.odds, 0) });
  }
  for (const k of Object.keys(S.picks)) if (!S.picks[k].pick) delete S.picks[k];
}
const staked = () => (S.bets || []).reduce((a, b) => a + b.stake, 0);
const stakedOn = (slug) => (S.bets || []).filter((b) => b.seat === slug).reduce((a, b) => a + b.stake, 0);
const roomOn = (slug) => Math.max(0, Math.min(SEAT_CAP - stakedOn(slug), BANKROLL - staked()));
function capMsg(on) { return on ? `Up to ${SEAT_CAP} points a seat. You have ${on} on this one, so ${Math.max(0, SEAT_CAP - on)} more at most.` : `Up to ${SEAT_CAP} points a seat.`; }

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
      setPicks(await api("me")); renderApp();
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
      <div class="outcome-panel"><div class="panel-head"><h2>Your challenge</h2></div><div class="chal" id="stats"></div><p class="caption" id="stats-note"></p></div>
    </section>

    <h2 class="band">Statewide <span>Challenge 1: Call the vote</span></h2>
    <section class="overall" id="big" aria-labelledby="big-title"></section>

    <h2 class="band">Seat by seat <span>Challenges 2 and 3: Pick the seats, Back your picks</span></h2>

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
        <div><h2 id="seats-title">Every seat</h2><p class="sub-hint">Click a seat for its full page: history, booth map, candidates, news and Sportsbet.</p></div>
        <div class="toolbar">
          <div class="chips" role="group" aria-label="Show">
            ${[["all", "All 88"], ["todo", "Still to call"], ["called", "Called"], ["close", "Close contests"]].map(([k, l]) => `<button type="button" data-filter="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join("")}
          </div>
          <label class="search"><span class="sr">Find a seat</span><input id="search" type="search" placeholder="Find a seat or MP"></label>
        </div>
      </div>
      <div class="list-view">${viewSeg("listview", S.listView)}<span class="caption">Switching view keeps the seats in the same order. Your pick and bet stay put whichever view you're on.</span></div>
      <div class="table-wrap">
        <table id="seat-table">
          <thead><tr>
            <th scope="col"><button type="button" data-sort="name">Seat</button></th>
            <th scope="col" class="num"><button type="button" data-sort="margin">Margin</button></th>
            <th scope="col"><button type="button" data-sort="sure" id="guide-h">Guide</button></th>
            <th scope="col">2. Pick the seats</th>
            <th scope="col">3. Back your picks</th>
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
function renderAll() { renderTop(); renderChamber(); renderBig(); renderTable(); if ($("#maps")?.open) renderMap(); }

function rulesHTML() {
  return `<div class="three">
    <div><h3>1. Call the vote</h3><p>Forecast each group's share of the statewide primary vote (Labor, Coalition, One Nation, Greens, Others), adding to 100.</p><p>Your miss for each group is the gap in points between your number and the actual result; over or under counts the same. Your score is the average of the five misses. Lower is better. Example: you say Labor 25; if Labor gets 23 or 27, that's a miss of 2.</p><p><b>Beat the pollsters:</b> get a smaller average miss than the final poll average.</p></div>
    <div><h3>2. Pick the seats</h3><p>Pick the winner in each of the 88 seats. One point for every seat you get right. A seat you don't pick can't score, so pick as many as you can.</p><p><b>Beat the bookies:</b> get more right than Sportsbet's favourites at close.</p></div>
    <div><h3>3. Back your picks (optional)</h3><p>You have ${n0(BANKROLL)} play points to bet on any seats you choose, up to ${SEAT_CAP} on any one seat. A bet pays at Sportsbet's price when you place it: 100 points on a pick it gives a 40% chance pays about 250 if it wins. Bet where you think the bookies have it wrong and skip the rest. Most points at the end wins.</p></div>
  </div>
  <div class="foot-note"><p>Click any seat (in the chamber, map or list) for its full page of history, booth results, polls, candidates and news. Add your reasoning to any pick, typed or dictated. You can change a pick before close (say what changed) and add bets, but bets already placed stand. The pick standing at close is the one scored; ties go to whoever changed fewer picks. Nobody sees anyone else's picks, or the leaderboards, until the count; then everyone's picks, changes and reasoning are revealed. Picks close at <b>6pm Friday 27 November</b> (Melbourne time). Leaderboards for Alliance, AI Mates and everyone together.</p></div>`;
}

function renderTop() {
  const P = seatPicks(), bets = S.bets || [], myVote = (S.votes || []).at(-1);
  const days = Math.max(0, Math.ceil((CLOSE - Date.now()) / 864e5));
  $("#countdown").textContent = `Picks close in ${days} day${days === 1 ? "" : "s"}`;
  const against = P.filter((p) => p.pick !== sbFair(seatBy(p.seat))?.[0][0]).length;
  const tile = (n, name, go, v, sub) => `<a class="chal-t" href="#${go}"><span class="chal-n">${n}. ${name}</span><b>${v}</b><span class="dim">${sub}</span></a>`;
  $("#stats").innerHTML =
    tile(1, "Call the vote", "vote-sec", myVote ? "Set ✓" : "Not set", myVote ? `last set ${when(myVote.created_at)}` : "your statewide vote forecast") +
    tile(2, "Pick the seats", "seats-title", `${P.length} of 88`, P.length ? `${against} against Sportsbet's favourite` : "seats picked") +
    tile(3, "Back your picks", "seats-title", `${n0(BANKROLL - staked())} left`, bets.length ? `${bets.length} bet${bets.length === 1 ? "" : "s"} · ${n0(bets.reduce((a, b) => a + b.stake * b.odds, 0))} back if all win` : `of ${n0(BANKROLL)} points, optional`);
  $("#stats-note").textContent = `Picks close 6pm Friday 27 November (Melbourne time).`;
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
// The guide, same shape in every view: top row is the head-to-head, bottom row the full split behind it.
const pr = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v / 100]);
const h2h = (a, av, b, bv, sub) => ({ parts: [[a, av / 100], [b, bv / 100]], text: `${SHORT[a] || a} ${av.toFixed(av < 10 ? 1 : 0)} v ${SHORT[b] || b} ${bv.toFixed(bv < 10 ? 1 : 0)}`, sub, tpp: true });
function guideRows(s, v = S.listView) {
  const t = tpp22(s);
  if (v === "2022") return [t && h2h(t.a, t.av, t.b, t.bv, "2022 two-party"), { parts: pr(s.prims_2022_grouped), sub: "2022 primary vote", thin: true }];
  if (v === "2025") {
    const f = fed2025(s); if (!f) return [null, null];
    const prim = { parts: pr(s.fed2025.prims), sub: "2025 primary vote", thin: true };
    if (f.tpp) return [h2h(f.k, f.tppv, f.o, 100 - f.tppv, "2025 two-party"), prim];
    const [[a, av], [b, bv]] = f.top; // no two-party count here: show the top two on primaries, scaled to 100
    return [h2h(a, (100 * av) / (av + bv), b, (100 * bv) / (av + bv), "top two on primaries (no two-party count)"), prim];
  }
  if (v === "sb") {
    const f = sbFair(s); if (!f) return [null, null];
    return [h2h(f[0][0], 100 * f[0][1], "FIELD", 100 * (1 - f[0][1]), "Sportsbet: favourite v the field"), { parts: f.filter(([, x]) => x >= 0.01), sub: "Sportsbet chance, every candidate", thin: true }];
  }
  const p = S.picks[s.slug], f = sbFair(s);
  if (!p) return [{ parts: [], text: "Not called yet", sub: "", none: true }, f ? { parts: f.filter(([, x]) => x >= 0.01), sub: "Sportsbet chance, every candidate", thin: true } : null];
  const ch = s.sportsbet?.fair?.[p.pick] ?? 0;
  return [{ parts: [[p.pick, 1]], text: `${SHORT[p.pick] || p.pick}${p.stake ? ` · ${p.stake} pts` : ""}`, sub: "your call", tpp: true },
    { parts: [[p.pick, ch], ["FIELD", 1 - ch]], text: `${pct(ch)}`, sub: "Sportsbet's chance for your call", thin: true }];
}
function sureOf(s, v = S.listView) {
  if (v === "sb") return sbFair(s)?.[0][1] ?? 0;
  if (v === "2022") return 0.5 + (s.margin?.value ?? 0) / 100;
  if (v === "mine") { const p = S.picks[s.slug]; return p ? s.sportsbet?.fair?.[p.pick] ?? 0 : -1; }
  const f = fed2025(s); if (!f) return 0.5; return f.tpp ? f.tppv / 100 : f.top[0][1] / (f.top[0][1] + f.top[1][1]);
}
const tpp22 = (s) => s.tcp_2022 || (s.margin ? { a: s.held_2022, av: 50 + s.margin.value, b: s.margin.vs, bv: 50 - s.margin.value } : null);

function tipHTML(slug, view = S.view) {
  const s = seatBy(slug), p = S.picks[slug], ph = photo(s.mp.name);
  const rows = (list, fmt) => list.map(([k, v]) => `<div class="row"><span><span class="sw" style="background:${col(k)}"></span> ${esc(PARTY[k] || k)}</span><b>${fmt(v)}</b></div>`).join("");
  let body = "";
  if (view === "2022") body = `<p class="muted" style="margin-top:6px">2022 primary vote</p>${rows(Object.entries(s.prims_2022_grouped || {}).sort((a, b) => b[1] - a[1]).slice(0, 4), (v) => v.toFixed(1) + "%")}`;
  else if (view === "2025") { const f = fed2025(s); body = f ? `<p class="muted" style="margin-top:6px">2025 federal vote on these booths</p>${rows(f.top.slice(0, 4), (v) => v.toFixed(1) + "%")}<p class="muted">${f.tpp ? `Two-party: ${PARTY[f.k]} ${f.tppv.toFixed(1)}%` : NO_TPP}</p>` : ""; }
  else { const f = sbFair(s); body = f ? `<p class="muted" style="margin-top:6px">Sportsbet chance</p>${rows(f.filter(([, v]) => v >= 0.01).slice(0, 4), pct)}` : ""; }
  return `<h4>${esc(s.name)}</h4>${s.margin ? `<p class="muted">2022: ${PARTY[s.held_2022] || s.held_2022} by ${s.margin.value}% v ${PARTY[s.margin.vs] || s.margin.vs}</p>` : ""}${body}
    <p class="muted" style="margin-top:6px;font-size:11.5px">MP: ${esc(s.mp.name)}${s.mp.retiring ? " (retiring)" : ""}</p><p class="tip-go">Click for the full seat page ›</p>
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
  const n = seatPicks().length, lnp = (tally.LIB || 0) + (tally.NAT || 0);
  const big = S.view === "mine"
    ? `<text class="tally" x="${cx}" y="${cy - 52}" text-anchor="middle" font-size="44">${n}</text><text class="tally-sub" x="${cx}" y="${cy - 28}" text-anchor="middle">seats called, ${88 - n ? `${88 - n} to go` : "all 88 done"}</text>`
    : `<text class="tally" x="${cx - 74}" y="${cy - 50}" text-anchor="middle" font-size="46" style="fill:${col("ALP")}">${tally.ALP || 0}</text><text class="tally-sub" x="${cx - 74}" y="${cy - 26}" text-anchor="middle">Labor</text><text class="tally" x="${cx + 74}" y="${cy - 50}" text-anchor="middle" font-size="46" style="fill:${col("LIB")}">${lnp}</text><text class="tally-sub" x="${cx + 74}" y="${cy - 26}" text-anchor="middle">Coalition</text>`;
  const svg = $("#chamber"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `<line class="maj" x1="${cx}" y1="${cy - R - 24}" x2="${cx}" y2="${cy - R * 0.36}"/><text class="maj-label" x="${cx}" y="${cy - R - 30}" text-anchor="middle">45 seats to govern</text>${circles}${big}`;
  $("#chamber-desc").textContent = CAPTION[S.view] + " Click a seat for its full page.";
  $("#legend").innerHTML = ORDER.filter((p) => tally[p]).map((p) => `<li><span class="sw" style="background:${p === "unset" ? "transparent;border:1px solid var(--rule)" : col(p)}"></span>${p === "unset" ? "Not called" : PARTY[p]} ${tally[p]}</li>`).join("");
}

// ---------------------------------------------------------------- the overall result
function tallyOf(fn) { const t = {}; for (const s of S.D.seats) { const k = fn(s); if (k) t[k] = (t[k] || 0) + 1; } return t; }
const COAL = (k) => (k === "LIB" || k === "NAT" ? "LNP" : k);
function stackRow(entries, total, label) {
  const list = entries.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const nm = (k) => VOTE_NAMES[k] || PARTY[k] || k, ex = (k, v) => (label === "seats" ? `${nm(k)}: ${v} seat${v === 1 ? "" : "s"}` : `${nm(k)}: ${Number(v).toFixed(1)}%`);
  return `<div class="bigbar"><span class="stack wide">${list.map(([k, v]) => `<i style="width:${(100 * v) / total}%;background:${col(k)}" title="${esc(ex(k, v))}"></i>`).join("")}${label === "seats" ? '<b class="maj45" title="45 seats to govern"></b>' : ""}</span>
    <span class="bigtxt">${list.map(([k, v]) => `<span title="${esc(ex(k, v))}"><span class="sw" style="background:${col(k)}"></span>${SHORT[k] || k} <b>${label === "seats" ? v : v.toFixed(0)}</b></span>`).join("")}</span></div>`;
}
const POLLSTER = (k) => ({ "roy-morgan": "Roy Morgan", "newspoll": "Newspoll", "redbridge": "RedBridge", "resolve": "Resolve", "yougov": "YouGov", "ucomms": "uComms", "demos-au": "DemosAU", "freshwater": "Freshwater", "essential": "Essential" }[k] || k.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
const fmtDay = (d) => new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
function pollChoice(W) {
  const sel = S.pollSel ?? "avg";
  if (sel === "avg") { const pp = W.polls.primaries; return { sub: `Election Tracker average, ${fmtDay(W.polls.as_of)}`, vote: { ALP: pp.alp, LNP: pp.lnp, ON: pp.onp, GRN: pp.grn, OTHERS: pp.others } }; }
  const x = W.polls.list[Number(sel)];
  return { sub: `${POLLSTER(x.pollster)}, ended ${fmtDay(x.fieldwork_end)}, ${n0(Number(x.sample_size) || 0)} people`, vote: { ALP: +x.alp, LNP: +x.lnp, ON: +x.onp, GRN: +x.grn, OTHERS: +x.others }, url: x.source_url };
}
function renderBig() {
  const W = S.D.statewide; if (!W) return;
  const vote22 = Object.entries(W.y2022);
  const f = W.fed2025.prims, vote25 = Object.entries({ ALP: f.ALP, LNP: (f.LIB || 0) + (f.NAT || 0), GRN: f.GRN, ON: f.ON, OTHERS: 100 - f.ALP - (f.LIB || 0) - (f.NAT || 0) - f.GRN - f.ON });
  const pc = pollChoice(W);
  const s22 = tallyOf((s) => COAL(s.held_2022)), s25 = tallyOf((s) => COAL(fed2025(s)?.k)), ssb = tallyOf((s) => COAL(sbFair(s)?.[0][0])), smine = tallyOf((s) => COAL(S.picks[s.slug]?.pick));
  const n = seatPicks().length;
  const row = (lab, sub, vote, seats, none = "—") => `<tr><th scope="row">${lab}<span class="dim">${sub}</span></th><td>${vote ? stackRow(vote, 100, "vote") : `<span class="dim">${none}</span>`}</td><td>${seats}</td></tr>`;
  const myVote = (S.votes || []).at(-1);
  const pollSel = `<select class="poll-sel" id="poll-sel" aria-label="Which poll"><option value="avg"${(S.pollSel ?? "avg") === "avg" ? " selected" : ""}>Average of all polls</option>${W.polls.list.map((x, i) => `<option value="${i}"${String(S.pollSel) === String(i) ? " selected" : ""}>${esc(POLLSTER(x.pollster))}, ${fmtDay(x.fieldwork_end)}</option>`).join("")}</select>`;
  const lead = Object.entries(smine).sort((a, b) => b[1] - a[1])[0];
  const outcome = n === 88 && lead ? (lead[1] >= 45 ? `${VOTE_NAMES[lead[0]] || PARTY[lead[0]] || lead[0]} majority (${lead[1]} seats)` : `Hung parliament: ${VOTE_NAMES[lead[0]] || PARTY[lead[0]] || lead[0]} largest on ${lead[1]}`) : "";
  $("#big").innerHTML = `<div class="panel-head"><div><h2 id="big-title">The statewide result</h2><p class="sub-hint">Votes and seats differ: in 2022 Labor won 37% of the vote but 56 of 88 seats. Hover a bar for exact figures.</p></div></div>
    <div class="table-wrap"><table class="sheet bigt"><thead><tr><th></th><th>Primary vote (%)</th><th>Seats won (45 to govern)</th></tr></thead><tbody>
      ${row("2022 result", "Victorian election", vote22, stackRow(Object.entries(s22), 88, "seats"))}
      ${row("2025 federal", "Victorian booths", vote25, stackRow(Object.entries(s25), 88, "seats"))}
      ${row(`2026 polls ${pollSel}`, `${esc(pc.sub)}${pc.url ? ` · <a href="${esc(pc.url)}" target="_blank" rel="noopener">source</a>` : ""}`, Object.entries(pc.vote), '<span class="dim">Not published seat by seat</span>')}
      ${row("2026 Sportsbet", "favourite in each seat", null, stackRow(Object.entries(ssb), 88, "seats"), "No vote market")}
      ${row("2026 My forecast", `${n} of 88 seats picked${outcome ? ` · <b>${esc(outcome)}</b>` : ""}`, myVote ? Object.entries(myVote.vote).map(([k, v]) => [k, Number(v)]) : null, n ? stackRow(Object.entries(smine), 88, "seats") : '<span class="dim">No seats picked yet</span>', "Not set: Call the vote below")}
    </tbody></table></div>
    ${voteForm(myVote)}`;
}

function voteForm(myVote) {
  const dv = (S.draft.vote ||= myVote ? { ...myVote.vote } : {}), tot = VOTE_KEYS.reduce((a, k) => a + Number(dv[k] || 0), 0), pp = S.D.statewide.polls.primaries;
  const poll = { ALP: pp.alp, LNP: pp.lnp, ON: pp.onp, GRN: pp.grn, OTHERS: pp.others };
  return `<div class="gov vote-f" id="vote-sec"><h3>1. Call the vote</h3>
    <p class="hint">Your forecast of each group's share of the statewide primary vote, adding to 100. Your score is your average miss in points across the five groups (over or under counts the same); lower is better. Beat the pollsters by missing by less than the final poll average. ${myVote ? `You can update it until close; the latest counts. Last set ${when(myVote.created_at)}.` : ""}</p>
    <div class="vote-grid">${VOTE_KEYS.map((k) => `<label><span><span class="sw" style="background:${col(k)}"></span>${VOTE_NAMES[k]}</span><input class="stake" data-vote="${k}" inputmode="decimal" value="${dv[k] ?? ""}" placeholder="${poll[k]}"><span class="dim">poll average ${poll[k]}</span></label>`).join("")}
      <div class="vote-tot ${Math.abs(tot - 100) < 0.05 ? "ok" : ""}" id="vote-tot">Total ${tot.toFixed(1)}${Math.abs(tot - 100) < 0.05 ? " ✓" : " (needs 100)"}</div></div>
    <div class="why"><label for="why-vote">Why? <span class="dim">optional</span></label><textarea id="why-vote" data-slug="vote" data-f="why" rows="2" maxlength="2000" placeholder="e.g. Polls overstate One Nation; Labor recovers in the last fortnight.">${esc(S.draft.vote_why || "")}</textarea>
      ${dictateBar("why-vote", `<button class="btn" type="button" id="vote-save">${myVote ? "Update my forecast" : "Lock my forecast"}</button>`)}<span class="row-err" id="vote-err"></span></div>
  </div>`;
}
async function saveVote() {
  const dv = S.draft.vote || {}, vote = Object.fromEntries(VOTE_KEYS.map((k) => [k, Number(dv[k] || 0)]));
  try { stopDictation(); const r = await api("vote", { vote, why: (S.draft.vote_why || "").trim() }); S.votes.push(r.vote); S.draft.vote = null; S.draft.vote_why = "";
    renderBig(); toast(`<b>Statewide vote forecast saved.</b> ${VOTE_KEYS.map((k) => `${SHORT[k] || k} ${vote[k]}`).join(" · ")}`);
  } catch (x) { $("#vote-err").textContent = x.message; }
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
  if (!S.order) {
    const v = S.sortView || S.listView;
    const key = { name: (s) => s.name, margin: (s) => s.margin?.value ?? 99, sure: (s) => sureOf(s, v) }[S.sort];
    S.order = Object.fromEntries([...S.D.seats].sort((a, b) => S.dir * (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) || a.name.localeCompare(b.name)).map((s, i) => [s.slug, i]));
  }
  return list.sort((a, b) => S.order[a.slug] - S.order[b.slug]);
}const stackHTML = (parts, lead, cls = "") => `<span class="stack${cls}" aria-hidden="true">${parts.map(([k, v]) => `<i class="${k === lead ? "lead" : ""}" style="width:${v * 100}%;background:${col(k)}"></i>`).join("")}</span>`;
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
  $("#guide-h").textContent = { sb: "2026 Sportsbet", "2022": "2022 result", "2025": "2025 federal", mine: "My calls" }[S.listView] + (S.sort === "sure" ? ` (sorted by ${({ sb: "2026 Sportsbet", "2022": "2022 result", "2025": "2025 federal", mine: "my calls" })[S.sortView || S.listView]})` : "");
  $("#seat-table tbody").innerHTML = rows().map((s) => {
    const p = S.picks[s.slug];
    const head = `<td>${p ? `<span class="ring-dot" style="background:${col(p.pick)}"></span>` : ""}<button class="seatname link" type="button" data-open="${s.slug}" title="Open the full seat page">${esc(s.name)} <span class="go" aria-hidden="true">›</span></button>${s.region === "regional" ? '<span class="tag">regional</span>' : ""}<span class="mp-s"><span class="sw" style="background:${col(s.mp.party)}"></span>${esc(s.mp.name)}${s.mp.retiring ? ", retiring" : ""}</span></td>
      <td class="num">${s.margin ? `${s.margin.value.toFixed(1)}<span class="dim"> v ${esc(s.margin.vs)}</span>` : "—"}</td>
      <td><div class="guide-cell">${guideRows(s).filter(Boolean).map((r) => `<span class="model-cell${r.thin ? " thin" : ""}">${r.none ? `<span class="stack none"></span>` : stackHTML(r.parts, r.lead, r.tpp ? " two" : r.thin ? " tpp" : "")}${r.text ? `<b>${r.text}</b>` : ""}<span class="sub">${r.sub}</span></span>`).join("")}</div></td>`;
    if (p) return `<tr>${head}<td colspan="2"><span class="lockd">✓ <b>${esc(outName(s, p.pick))}</b>${p.changes ? ` <span class="dim">(changed ${p.changes}×)</span>` : ""}${p.stake ? ` · ${p.stake} pts bet` : " · no bet"}</span></td>
      <td class="act"><button class="btn btn-quiet why-btn" type="button" data-more="${s.slug}" data-mode="change">Change call</button><button class="btn btn-quiet why-btn" type="button" data-more="${s.slug}" data-mode="bet">Add bet</button></td></tr>`;
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
  const tag = (n) => (n.rel === 2 ? "names the seat or a candidate" : "names a town or the region");
  return `<section class="d-sec" aria-labelledby="h-news"><h3 id="h-news">In the news</h3>
    <p class="hint">Headlines from the last fortnight that name ${esc(s.name)}, a candidate, or a town in the seat in an election story. Paywall labels are by publisher; some articles may be free.</p>
    ${items.length ? `<ul class="news-list">${items.map((n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="dim">${esc(n.source || "")}${n.date ? `, ${esc(fmtDay(n.date))}` : ""}${n.paywalled ? " · paywalled" : ""} · ${tag(n)}</span></li>`).join("")}</ul>`
      : `<p class="muted">No local election headlines in the last fortnight.</p>`}</section>`;
}
function pollsSec(s) {
  const P = s.polls; if (!P?.regional?.length && !P?.seat?.length) return "";
  const pp = S.D.statewide.polls.primaries, avg = { LNP: pp.lnp, ALP: pp.alp, ON: pp.onp, GRN: pp.grn, OTHERS: pp.others };
  const fill = (v) => { const o = { ...v }; const t = VOTE_KEYS.filter((k) => k !== "OTHERS").reduce((a, k) => a + (o[k] || 0), 0); if (o.OTHERS == null) o.OTHERS = Math.max(0, 100 - t); return Object.entries(o).filter(([k]) => VOTE_KEYS.includes(k)); };
  const row = (lab, sub, v) => `<tr><th scope="row">${lab}<span class="dim">${sub}</span></th><td>${stackRow(fill(v), 100, "vote")}</td></tr>`;
  return `<section class="d-sec" aria-labelledby="h-polls"><h3 id="h-polls">2026 polls</h3>
    <p class="hint">Polls aren't published for most seats. These are for the region this seat sits in (${esc(P.region)}, an Upper House region), which may be how people plan to vote for the Upper House. Around 250–360 people per region, so expect several points of error.</p>
    <div class="table-wrap"><table class="sheet bigt"><tbody>
      ${(P.seat || []).map((q) => row(`Seat poll`, `${esc(q.pollster)}, ${fmtDay(q.date)} · about ${q.n} people here · <a href="${esc(q.url)}" target="_blank" rel="noopener">source</a>`, q.primaries)).join("")}
      ${P.regional.map((q) => row(esc(P.region), `${esc(q.source)} · <a href="${esc(q.url)}" target="_blank" rel="noopener">source</a>`, q.primaries)).join("")}
      ${row("Victoria", `poll average, ${fmtDay(S.D.statewide.polls.as_of)}`, avg)}
    </tbody></table></div>
    ${P.seat?.length ? `<p class="hint">The seat poll was published as one combined figure for Hastings, Morwell and Pakenham, so each of those seats shows the same numbers.</p>` : ""}</section>`;
}
function pickSec(s) {
  const p = S.picks[s.slug];
  if (p) return calledSec(s, p);
  const c = pickCells(s), d = S.draft[s.slug] || {};
  return `<section class="d-sec" id="pick-sec" aria-labelledby="h-pick"><h3 id="h-pick">Your pick</h3>
    <div class="pick-form"><label>2. Pick the seats: who wins ${esc(s.name)}?${c.sel}</label><label>3. Back your picks (optional)${c.st}</label></div>
    <div class="why">
      <label for="why-${s.slug}">Why? <span class="dim">Your reasoning, for both; locked with your pick and revealed after the count</span></label>
      <textarea id="why-${s.slug}" data-slug="${s.slug}" data-f="why" rows="4" maxlength="2000" placeholder="e.g. Teal candidate is strong locally, Liberal margin is only 3%, and the Greens will preference her.">${esc(d.why || "")}</textarea>
      <div class="why-bar">${dictateBar(`why-${s.slug}`, c.lock)}
    </div>
    <p class="hint">Points left to bet: ${n0(BANKROLL - staked())}, up to ${SEAT_CAP} on this seat. You can change your pick or add bets later; the pick standing at close is the one that counts.</p></section>`;
}
const when = (t) => new Date(t).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const dictateBar = (id, extra = "") => `<div class="why-bar">${SpeechRec ? `<button class="btn btn-quiet" type="button" data-dictate="${id}" aria-pressed="false">🎤 Dictate</button>` : `<span class="hint">Tip: use your keyboard's microphone to dictate.</span>`}<span class="hint" data-dictate-status="${id}"></span>${extra}</div>`;
function calledSec(s, p) {
  const d = S.draft[s.slug] || {}, outs = (sbFair(s) || []).map(([k]) => k);
  const events = [...p.calls.map((c, i) => ({ t: c.created_at, html: `${i ? "Changed call to" : "Called"} <b>${esc(outName(s, c.pick))}</b>${c.why ? `<blockquote class="why-locked">${esc(c.why)}</blockquote>` : ""}` })),
    ...p.bets.map((b) => ({ t: b.created_at, html: `Bet <b>${b.stake} pts</b> on ${esc(outName(s, b.pick))}, pays ${n0(b.stake * b.odds)} if right` }))].sort((a, b) => a.t.localeCompare(b.t));
  const opt = (sel, skip) => outs.filter((k) => k !== skip).map((k) => `<option value="${k}"${sel === k ? " selected" : ""}>${esc(outName(s, k))}</option>`).join("");
  const bo = d.bpick ? s.sportsbet?.odds?.[d.bpick] : null;
  return `<section class="d-sec" id="pick-sec"><h3>2. Pick the seats: ${esc(outName(s, p.pick))}</h3>
    <ol class="trail">${events.map((e) => `<li><span class="dim">${when(e.t)}</span> ${e.html}</li>`).join("")}</ol>
    <details class="pickmore" ${S.more?.[s.slug] === "change" ? "open" : ""}><summary>Change your pick</summary>
      <div class="pick-form"><label>New call<select class="pick" data-slug="${s.slug}" data-f="cpick"><option value="">Choose…</option>${opt(d.cpick, p.pick)}</select></label></div>
      <div class="why"><label for="cwhy-${s.slug}">What changed? <span class="dim">Required; shown with your call trail after the count</span></label>
        <textarea id="cwhy-${s.slug}" data-slug="${s.slug}" data-f="cwhy" rows="2" maxlength="1000" placeholder="e.g. Nominations closed and the independent didn't stand.">${esc(d.cwhy || "")}</textarea>
        ${dictateBar(`cwhy-${s.slug}`, `<button class="btn" type="button" data-change="${s.slug}">Change call</button>`)}<span class="row-err" data-err-c="${s.slug}"></span></div>
    </details>
    <details class="pickmore" ${S.more?.[s.slug] === "bet" ? "open" : ""}><summary>3. Back your picks: add a bet</summary>
      <div class="pick-form"><label>On<select class="pick" data-slug="${s.slug}" data-f="bpick">${opt(d.bpick || p.pick)}</select></label>
        <label>Points<input class="stake" data-slug="${s.slug}" data-f="bstake" inputmode="numeric" placeholder="0" value="${d.bstake ?? ""}"><span class="pays" data-bpays="${s.slug}">${bo && d.bstake ? `pays ${n0(d.bstake * bo)} if right` : ""}</span></label>
        <button class="btn" type="button" data-addbet="${s.slug}">Add bet</button></div><span class="row-err" data-err-b="${s.slug}"></span>
      <p class="hint">Priced at Sportsbet's odds now. Earlier bets stand at their own price. You can add up to ${n0(roomOn(s.slug))} more here (${SEAT_CAP} a seat).</p>
    </details></section>`;
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
    ${placeHTML(s, locatorSVG(S.geo, s.slug), PARTY, S.D.seats)}
    ${resultsHTML(s, PARTY)}
    ${insideShell(s.slug)}
    ${changesHTML(s, PARTY)}
    ${pollsSec(s)}
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
  const id = btn.dataset.dictate, ta = document.getElementById(id), status = document.querySelector(`[data-dictate-status="${id}"]`);
  rec = new SpeechRec(); rec.lang = "en-AU"; rec.continuous = true; rec.interimResults = true;
  let start = ta.value ? ta.value.replace(/\s*$/, " ") : "";
  rec.onresult = (e) => {
    let fin = "", tmp = "";
    for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (tmp += e.results[i][0].transcript));
    if (fin) start = (start + fin.trim() + ". ").replace(/^\s+/, "");
    ta.value = start + tmp; ta.dispatchEvent(new Event("input", { bubbles: true }));
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
  const so = t.closest("#seat-table th button"); if (so) { const k = so.dataset.sort; S.dir = S.sort === k ? -S.dir : k === "sure" ? -1 : 1; S.sort = k; S.sortView = S.listView; S.order = null; renderTable(); return; }
  const o = t.closest("[data-open]") || t.closest("#chamber .seat") || t.closest(".district"); if (o) { openSeat(o.dataset.open || o.dataset.slug); return; }
  if (t.closest("[data-act=close]")) { closeSeat(); return; }
  if (t.closest("[data-act=show-on-map]")) { showOnMap(S.seat); return; }
  const go = t.closest(".chal-t"); if (go) { e.preventDefault(); document.getElementById(go.getAttribute("href").slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (t.closest("[data-act=to-pick]")) { $("#pick-sec")?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  const w = t.closest("[data-why]"); if (w) { openSeat(w.dataset.why); setTimeout(() => { $("#pick-sec")?.scrollIntoView({ block: "start" }); $(`#why-${w.dataset.why}`)?.focus(); }, 50); return; }
  const mo = t.closest("[data-more]"); if (mo) { S.more = { [mo.dataset.more]: mo.dataset.mode }; openSeat(mo.dataset.more); setTimeout(() => $("#pick-sec")?.scrollIntoView({ block: "start" }), 50); return; }
  if (t.closest("#vote-save")) { saveVote(); return; }
  const ch = t.closest("[data-change]"); if (ch) { changeCall(ch.dataset.change); return; }
  const ab = t.closest("[data-addbet]"); if (ab) { addBet(ab.dataset.addbet); return; }
  const dc = t.closest("[data-dictate]"); if (dc) { toggleDictation(dc); return; }
  const l = t.closest("[data-lock]"); if (l) lock(l.dataset.lock);
}
function onInput(e) {
  if (e.target.id === "poll-sel") { S.pollSel = e.target.value; renderBig(); return; }
  if (e.target.dataset?.vote) { const t = e.target; t.value = t.value.replace(/[^0-9.]/g, ""); (S.draft.vote ||= {})[t.dataset.vote] = t.value;
    const tot = VOTE_KEYS.reduce((a, k) => a + Number(S.draft.vote[k] || 0), 0), el = $("#vote-tot"), ok = Math.abs(tot - 100) < 0.05;
    el.textContent = `Total ${tot.toFixed(1)}${ok ? " ✓" : " (needs 100)"}`; el.classList.toggle("ok", ok); return; }
  if (e.target.id === "why-vote") { S.draft.vote_why = e.target.value; return; }
  const t = e.target, slug = t.dataset?.slug; if (!t.dataset?.f || !slug) return;
  const d = (S.draft[slug] ||= {});
  if (t.dataset.f === "stake") { t.value = t.value.replace(/\D/g, ""); d.stake = t.value; document.querySelectorAll(`[data-pays="${slug}"]`).forEach((x) => (x.textContent = paysText(seatBy(slug), d))); return; }
  if (t.dataset.f === "why" || t.dataset.f === "cwhy") { d[t.dataset.f] = t.value; return; }
  if (t.dataset.f === "bstake") { t.value = t.value.replace(/\D/g, ""); d.bstake = t.value; const o = d.bpick || S.picks[slug]?.pick, odds = seatBy(slug).sportsbet?.odds?.[o]; document.querySelectorAll(`[data-bpays="${slug}"]`).forEach((x) => (x.textContent = odds && d.bstake ? `pays ${n0(d.bstake * odds)} if right` : "")); return; }
  if (t.dataset.f === "cpick" || t.dataset.f === "bpick") { d[t.dataset.f] = t.value; return; }
  d.pick = t.value; refreshRow(slug);
}
function refreshRow(slug) { renderTable(); if (S.seat === slug) renderDrawer(); }
async function lock(slug) {
  const d = S.draft[slug] || {}, stake = Number(d.stake || 0), s = seatBy(slug);
  const err = (m) => document.querySelectorAll(`[data-err="${slug}"]`).forEach((x) => (x.textContent = m));
  if (!d.pick) return err("Choose a winner first.");
  try {
    stopDictation();
    if (stake && staked() + stake > BANKROLL) return err(`You have ${BANKROLL - staked()} points left to bet.`);
    if (stake && stakedOn(slug) + stake > SEAT_CAP) return err(capMsg(stakedOn(slug)));
    const r = await api("call", { seat: slug, pick: d.pick, why: (d.why || "").trim() }); S.calls.push(r.call);
    if (stake) { const b = await api("bet", { seat: slug, pick: d.pick, stake }); S.bets.push(b.bet); }
    derive(); delete S.draft[slug];
    closeSeat(); renderTop(); renderChamber(slug); renderTable(); renderBig(); if ($("#maps").open) renderMap();
    toast(`<b>${esc(s.name)} locked.</b> ${esc(outName(s, d.pick))}${stake ? `, ${stake} points bet` : ", no bet"}. ${88 - seatPicks().length} seats to go.`);
  } catch (x) { err(x.message); }
}
async function changeCall(slug) {
  const d = S.draft[slug] || {}, s = seatBy(slug), err = (m) => document.querySelectorAll(`[data-err-c="${slug}"]`).forEach((x) => (x.textContent = m));
  if (!d.cpick) return err("Choose the new call.");
  if (!(d.cwhy || "").trim()) return err("Say what changed, in a line.");
  try { stopDictation(); const r = await api("call", { seat: slug, pick: d.cpick, why: d.cwhy.trim() }); S.calls.push(r.call); derive(); delete S.draft[slug]; S.more = {};
    closeSeat(); renderTop(); renderChamber(slug); renderTable(); renderBig(); if ($("#maps").open) renderMap();
    toast(`<b>${esc(s.name)}:</b> call changed to ${esc(outName(s, r.call.pick))}.`);
  } catch (x) { err(x.message); }
}
async function addBet(slug) {
  const s = seatBy(slug), d = S.draft[slug] || {}, pick = d.bpick || S.picks[slug].pick, stake = Number(d.bstake || 0), err = (m) => document.querySelectorAll(`[data-err-b="${slug}"]`).forEach((x) => (x.textContent = m));
  if (stake && stakedOn(slug) + stake > SEAT_CAP) return err(capMsg(stakedOn(slug)));
  try { const r = await api("bet", { seat: slug, pick, stake }); S.bets.push(r.bet); derive(); delete S.draft[slug]; S.more = {};
    closeSeat(); renderTop(); renderTable(); renderBig();
    toast(`<b>${esc(s.name)}:</b> ${stake} points on ${esc(outName(s, pick))}, pays ${n0(stake * r.bet.odds)} if right.`);
  } catch (x) { err(x.message); }
}
function toast(html) { const t = $("#toast"); t.innerHTML = html; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 5000); }

boot();
