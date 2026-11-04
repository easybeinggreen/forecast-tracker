// Count Room Team Challenge: Victorian election 2026.
// Players see seat data and Sportsbet chances only; nothing from the model is in office.json.
import { decodeTopo, projector, bboxOf, pathOf } from "./map.js";

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
// How sure: scored with a quadratic (Brier) rule, scaled so a 50/50 guess scores 0. Honest is best:
// Lean pays best for calls you'd get right 55–67% of the time, Likely 67–82%, Safe above 82%.
const CONF = { lean: { label: "Lean", p: 0.6 }, likely: { label: "Likely", p: 0.75 }, safe: { label: "Safe", p: 0.9 } };
const judge = (p, right) => Math.round(400 * ((right ? 1 - (1 - p) ** 2 : 1 - p ** 2) - 0.75));
const pct = (v) => `${Math.round(v * 100)}%`;
const n0 = (v) => Math.round(v).toLocaleString("en-AU");
const store = { get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

const S = { D: null, geo: null, me: null, picks: {}, view: "sb", filter: "all", sort: "sure", dir: -1, q: "", seat: null, draft: {} };
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
    <div class="brand"><svg class="brand-mark" viewBox="0 0 32 20" aria-hidden="true"><path d="M3 18a13 13 0 0 1 26 0"/><circle cx="16" cy="18" r="2.6"/></svg><div><h1>Count Room Team Challenge</h1><p class="sub">Victorian election, Saturday 28 November 2026</p></div></div>
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
const VIEWS = [["sb", "Sportsbet"], ["2022", "2022 result"], ["2025", "2025 federal"], ["mine", "My picks"]];
const viewSeg = () => `<div class="seg" role="group" aria-label="Colour seats by">${VIEWS.map(([k, l]) => `<button type="button" data-view="${k}" aria-pressed="${S.view === k}">${l}</button>`).join("")}</div>`;

function renderApp() {
  const seen = store.get("team.seen-rules");
  $("#app").innerHTML = `
  <header class="top">
    <div class="brand"><svg class="brand-mark" viewBox="0 0 32 20" aria-hidden="true"><path d="M3 18a13 13 0 0 1 26 0"/><circle cx="16" cy="18" r="2.6"/></svg>
      <div><h1>Count Room Team Challenge</h1><p class="sub">Victorian election, Saturday 28 November 2026</p></div></div>
    <p class="countdown" id="countdown"></p>
    <div class="who">${PREVIEW ? '<span class="preview-note" style="margin:0;padding:3px 10px">Preview: nothing is saved</span>' : ""}<b>${esc(S.me.name)}</b><span class="team">${esc(S.me.team)}</span><button class="btn btn-quiet" type="button" id="signout">Sign out</button></div>
  </header>
  <main>
    <details class="first" id="first" ${seen ? "" : "open"}><summary><span>Read this first: how the challenge works</span><span class="more"></span></summary>${rulesHTML()}</details>

    <div class="ledger-grid" id="stats" style="margin:0"></div>

    <section class="overview" aria-labelledby="chamber-title">
      <div class="chamber-panel">
        <div class="panel-head"><h2 id="chamber-title">The Legislative Assembly, 88 seats</h2>${viewSeg()}</div>
        <div class="chamber-wrap"><svg id="chamber" role="img" aria-labelledby="chamber-desc"></svg><div class="tip" hidden></div></div>
        <p class="caption" id="chamber-desc"></p>
        <ul class="legend" id="legend"></ul>
      </div>
      <div class="outcome-panel" id="picture"></div>
    </section>

    <details class="maps" id="maps"><summary><div class="panel-head"><h2>Where the seats are</h2><span class="more"></span></div></summary>
      <div class="map-grid">
        <figure class="map-fig"><div class="map-wrap" id="wrap-vic"><svg id="map-vic" role="img" aria-label="Map of Victoria's 88 districts"></svg><div class="tip" hidden></div></div><figcaption>Victoria</figcaption></figure>
        <figure class="map-fig"><div class="map-wrap" id="wrap-mel"><svg id="map-mel" role="img" aria-label="Map of Melbourne's districts"></svg><div class="tip" hidden></div></div><figcaption>Greater Melbourne</figcaption></figure>
      </div>
      <p class="caption">Colours follow the chamber's setting above. Hover a district for its details; click to open it.</p>
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
      <p class="caption" style="margin:-4px 0 10px">The guide follows the view you choose above the chamber. Your pick, how sure you are and your bet stay put whichever view you're on.</p>
      <div class="table-wrap">
        <table id="seat-table">
          <thead><tr>
            <th scope="col"><button type="button" data-sort="name">Seat</button></th>
            <th scope="col">Sitting MP</th>
            <th scope="col" class="num"><button type="button" data-sort="margin">Margin</button></th>
            <th scope="col"><button type="button" data-sort="sure" id="guide-h">Guide</button></th>
            <th scope="col">Your pick</th>
            <th scope="col">How sure</th>
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
  wireTips($(".chamber-wrap"), ".seat"); wireTips($("#wrap-vic"), ".district"); wireTips($("#wrap-mel"), ".district");
  document.addEventListener("click", onClick);
  document.addEventListener("input", onInput);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSeat(); });
  $("#scrim").onclick = closeSeat;
  renderAll();
}
const latestOdds = () => S.D.seats.map((s) => s.sportsbet?.as_of).filter(Boolean).sort().at(-1);
function renderAll() { renderTop(); renderChamber(); renderPicture(); renderTable(); if ($("#maps")?.open) renderMap(); }

function rulesHTML() {
  const row = (k) => { const c = CONF[k], r = judge(c.p, true), w = judge(c.p, false); return `<tr><td><b>${c.label}</b></td><td class="p">+${r}</td><td class="n">${w}</td><td>${{ lean: "about 6 in 10", likely: "about 3 in 4", safe: "9 in 10 or better" }[k]}</td></tr>`; };
  return `<div class="three">
    <div><h3>1. Most seats right</h3><p>Pick the winner in each seat. One point for every seat you get right. A seat you don't call can't score, so call as many as you can.</p></div>
    <div><h3>2. Best judgement</h3><p>Each pick also says how sure you are. A right call wins points and a wrong one loses them. The surer you say you are, the more you win when right and the more you lose when wrong.</p>
      <table class="sc"><tr><th></th><th>Right</th><th>Wrong</th><th>Use it for calls you'd get right</th></tr>${row("lean")}${row("likely")}${row("safe")}</table>
      <p>So the way to win is to be honest: "Safe" on a seat you're only fairly sure of costs you over time. Highest total wins.</p></div>
    <div><h3>3. Best bets</h3><p>You have ${n0(BANKROLL)} play points to bet, on any seats you choose. A bet pays out at Sportsbet's price when you lock it: 100 points on a pick it gives a 40% chance pays about 240 if it wins. Bet where you think it has it wrong; skip the rest. Most points at the end wins.</p></div>
  </div>
  <div class="foot-note"><p>One set of picks counts for all three. A locked pick is final. Nobody sees anyone else's picks, or the leaderboards, until the count. Picks close at <b>6pm Friday 27 November</b> (Melbourne time). Leaderboards for Alliance, AI Mates and everyone together.</p></div>`;
}

function renderTop() {
  const P = Object.values(S.picks), staked = P.reduce((a, p) => a + p.stake, 0), bets = P.filter((p) => p.stake);
  const days = Math.max(0, Math.ceil((CLOSE - Date.now()) / 864e5));
  $("#countdown").textContent = `Picks close in ${days} day${days === 1 ? "" : "s"}`;
  $("#stats").innerHTML = `
    <div><div class="v">${P.length}</div><div class="l">Seats called · ${88 - P.length ? `${88 - P.length} to go` : "all 88 done"}</div></div>
    <div><div class="v">${n0(BANKROLL - staked)}</div><div class="l">Points left to bet, of ${n0(BANKROLL)}</div></div>
    <div><div class="v">${bets.length}</div><div class="l">Bets placed · ${n0(bets.reduce((a, p) => a + p.stake * p.odds, 0))} back if all win</div></div>
    <div><div class="v">${P.length ? `+${P.reduce((a, p) => a + judge(CONF[p.conf].p, true), 0)}` : "0"}</div><div class="l">Judgement points if every call is right</div></div>`;
}

// ---------------------------------------------------------------- what each view says about a seat
function sbFair(s) { const f = s.sportsbet?.fair; return f ? Object.entries(f).sort((a, b) => b[1] - a[1]) : null; }
function fed2025(s) {
  const f = s.fed2025; if (!f?.prims) return null;
  const top = Object.entries(f.prims).sort((a, b) => b[1] - a[1]), two = top.slice(0, 2).map(([k]) => k), coal = two.find((k) => k === "LIB" || k === "NAT");
  if (two.includes("ALP") && coal && f.alp_tpp != null) return { k: f.alp_tpp >= 50 ? "ALP" : coal, m: Math.abs(f.alp_tpp - 50), top };
  return { k: top[0][0], m: (top[0][1] - top[1][1]) / 2, top };
}
function seatColour(s) {
  if (S.view === "mine") { const p = S.picks[s.slug]; return p ? { p: p.pick, op: 0.45 + 0.55 * (CONF[p.conf].p - 0.5) / 0.4 } : { p: "unset", op: 1 }; }
  if (S.view === "2022") return { p: s.mp.party, op: 0.35 + 0.65 * Math.min(1, (s.margin?.value ?? 10) / 12) };
  if (S.view === "2025") { const f = fed2025(s); return f ? { p: f.k, op: 0.35 + 0.65 * Math.min(1, f.m / 12) } : { p: "unset", op: 1 }; }
  const f = sbFair(s); return f ? { p: f[0][0], op: 0.3 + 0.7 * Math.min(1, Math.max(0, (f[0][1] - 0.34) / 0.6)) } : { p: "unset", op: 1 };
}
// The guide bar: shares for the current view, the winner/favourite outlined, and the label.
function guide(s) {
  const v = S.view === "mine" ? "sb" : S.view;
  if (v === "sb") { const f = sbFair(s); return f ? { parts: f.filter(([, x]) => x >= 0.01), lead: f[0][0], label: `${SHORT[f[0][0]] || f[0][0]} ${pct(f[0][1])}`, sub: "Sportsbet chance", sure: f[0][1] } : null; }
  if (v === "2022") { const g = Object.entries(s.prims_2022_grouped || {}).sort((a, b) => b[1] - a[1]); return { parts: g.map(([k, x]) => [k, x / 100]), lead: s.held_2022, label: `${SHORT[s.held_2022]} won`, sub: `primary ${(s.prims_2022_grouped?.[s.held_2022] ?? 0).toFixed(0)}%`, sure: 0.5 + (s.margin?.value ?? 0) / 100 }; }
  const f = fed2025(s); if (!f) return null;
  return { parts: f.top.map(([k, x]) => [k, x / 100]), lead: f.k, label: `${SHORT[f.k]} ahead`, sub: s.fed2025.alp_tpp != null ? `two-party ALP ${s.fed2025.alp_tpp.toFixed(0)}%` : "", sure: 0.5 + f.m / 100 };
}
const tpp22 = (s) => (s.margin ? { a: s.held_2022, av: 50 + s.margin.value, b: s.margin.vs, bv: 50 - s.margin.value } : null);

function tipHTML(slug) {
  const s = seatBy(slug), p = S.picks[slug], ph = photo(s.mp.name);
  const rows = (list, fmt) => list.map(([k, v]) => `<div class="row"><span><span class="sw" style="background:${col(k)}"></span> ${esc(PARTY[k] || k)}</span><b>${fmt(v)}</b></div>`).join("");
  let body = "";
  if (S.view === "2022") body = `<p class="muted" style="margin-top:6px">2022 primary vote</p>${rows(Object.entries(s.prims_2022_grouped || {}).sort((a, b) => b[1] - a[1]).slice(0, 4), (v) => v.toFixed(1) + "%")}`;
  else if (S.view === "2025") { const f = fed2025(s); body = f ? `<p class="muted" style="margin-top:6px">2025 federal vote on these booths</p>${rows(f.top.slice(0, 4), (v) => v.toFixed(1) + "%")}${s.fed2025.alp_tpp != null ? `<p class="muted">Two-party: Labor ${s.fed2025.alp_tpp.toFixed(1)}%</p>` : ""}` : ""; }
  else { const f = sbFair(s); body = f ? `<p class="muted" style="margin-top:6px">Sportsbet chance</p>${rows(f.filter(([, v]) => v >= 0.01).slice(0, 4), pct)}` : ""; }
  return `${ph ? `<img class="tip-img" src="${esc(ph.img)}" alt="" referrerpolicy="no-referrer">` : ""}<h4>${esc(s.name)}</h4><p class="muted">${esc(s.mp.name)}, ${PARTY[s.mp.party]}${s.mp.retiring ? " (retiring)" : ""}</p>
    ${s.margin ? `<p class="muted">Margin ${s.margin.value}% v ${PARTY[s.margin.vs] || s.margin.vs}</p>` : ""}${body}
    ${p ? `<p class="muted" style="margin-top:6px">Your pick: <b>${esc(outName(s, p.pick))}</b>, ${CONF[p.conf].label}${p.stake ? `, ${p.stake} pts bet` : ""}</p>` : ""}`;
}
function wireTips(wrap, sel) {
  if (!wrap) return;
  wrap.addEventListener("mousemove", (e) => {
    const t = e.target.closest(sel), tip = wrap.querySelector(".tip");
    if (!t) { tip.hidden = true; return; }
    tip.innerHTML = tipHTML(t.dataset.slug); tip.hidden = false;
    const r = wrap.getBoundingClientRect();
    tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 270) + "px"; tip.style.top = Math.max(e.clientY - r.top - 20, 0) + "px";
  });
  wrap.addEventListener("mouseleave", () => (wrap.querySelector(".tip").hidden = true));
}

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
  $("#chamber-desc").textContent = { sb: "Each dot is coloured by Sportsbet's favourite (margin removed). Fainter dots are less certain.", "2022": "Each dot is coloured by who won in 2022 (by-elections included). Fainter dots were closer.", "2025": "Each dot is coloured by who led the 2025 federal vote on this seat's booths. Fainter dots were closer.", mine: "Your locked picks. Fainter dots are ones you're less sure of. Empty dots are seats you haven't called yet." }[S.view];
  $("#legend").innerHTML = ORDER.filter((p) => tally[p]).map((p) => `<li><span class="sw" style="background:${p === "unset" ? "transparent;border:1px solid var(--rule)" : col(p)}"></span>${p === "unset" ? "Not called" : PARTY[p]} ${tally[p]}</li>`).join("");
}

// ---------------------------------------------------------------- your picture (right of the chamber)
function renderPicture() {
  const P = Object.values(S.picks), t = {};
  P.forEach((p) => (t[p.pick] = (t[p.pick] || 0) + 1));
  const max = Math.max(1, ...Object.values(t)), lnp = (t.LIB || 0) + (t.NAT || 0);
  const bySure = Object.keys(CONF).map((k) => [CONF[k].label, P.filter((p) => p.conf === k).length]);
  $("#picture").innerHTML = `<div class="panel-head"><h2>Your picks so far</h2></div>
    ${P.length ? `<div class="odds"><div><div class="v" style="color:${col("ALP")}">${t.ALP || 0}</div><div class="l">Labor</div></div><div><div class="v" style="color:${col("LIB")}">${lnp}</div><div class="l">Coalition</div></div><div><div class="v">${P.length - (t.ALP || 0) - lnp}</div><div class="l">Others</div></div></div>
      <div class="pic-bars">${ORDER.filter((k) => t[k]).map((k) => `<span>${PARTY[k]}</span><i style="width:${(100 * t[k]) / max}%;background:${col(k)}"></i><span>${t[k]}</span>`).join("")}</div>
      <p class="caption" style="margin-top:12px">How sure: ${bySure.map(([l, c]) => `${l} ${c}`).join(" · ")}. ${45 - Math.max(t.ALP || 0, lnp) > 0 ? `` : `Your picks give ${(t.ALP || 0) >= 45 ? "Labor" : "the Coalition"} a majority.`}</p>`
      : `<p class="caption">Nothing locked yet. Pick a winner in any seat in the table below, or click a seat in the chamber.</p>`}`;
}

// ---------------------------------------------------------------- map (folded)
const MEL_BBOX = [144.55, -38.33, 145.62, -37.48];
function renderMap() {
  if (!S.geo) { $("#maps").hidden = true; return; }
  const draw = (svg, bbox, W, H, clip) => {
    const proj = projector(bbox, W, H, 6);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const inBox = (f) => !clip || f.polys.some((poly) => poly[0].some(([x, y]) => x > bbox[0] && x < bbox[2] && y > bbox[1] && y < bbox[3]));
    svg.innerHTML = S.geo.filter(inBox).map((f) => { const s = seatBy(f.props.slug); if (!s) return ""; const st = seatColour(s);
      return `<path class="district${st.p === "unset" ? " unset" : ""}${S.picks[s.slug] ? " called" : ""}" data-slug="${s.slug}" tabindex="0" role="button" aria-label="${esc(s.name)}" d="${pathOf(f, proj)}" style="fill:${st.p === "unset" ? "var(--sheet)" : col(st.p)};fill-opacity:${st.op.toFixed(2)}"></path>`; }).join("");
  };
  const vb = bboxOf(S.geo);
  draw($("#map-vic"), vb, 640, 440, false);
  draw($("#map-mel"), MEL_BBOX, 640, 520, true);
  const pv = projector(vb, 640, 440, 6), [a, b] = [pv([MEL_BBOX[0], MEL_BBOX[3]]), pv([MEL_BBOX[2], MEL_BBOX[1]])];
  $("#map-vic").insertAdjacentHTML("beforeend", `<rect x="${a[0].toFixed(1)}" y="${a[1].toFixed(1)}" width="${(b[0] - a[0]).toFixed(1)}" height="${(b[1] - a[1]).toFixed(1)}" fill="none" stroke="var(--ink-2)" stroke-width="1" stroke-dasharray="3 2" pointer-events="none"/>`);
}

// ---------------------------------------------------------------- every seat
function rows() {
  let list = S.D.seats.filter((s) => !S.q || s.name.toLowerCase().includes(S.q) || s.mp.name.toLowerCase().includes(S.q));
  if (S.filter === "todo") list = list.filter((s) => !S.picks[s.slug]);
  if (S.filter === "called") list = list.filter((s) => S.picks[s.slug]);
  if (S.filter === "close") list = list.filter((s) => { const f = sbFair(s); return f && f[0][1] < 0.6; });
  const key = { name: (s) => s.name, margin: (s) => s.margin?.value ?? 99, sure: (s) => guide(s)?.sure ?? 0 }[S.sort];
  return list.sort((a, b) => S.dir * (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
const stackHTML = (parts, lead, cls = "") => `<span class="stack${cls}" aria-hidden="true">${parts.map(([k, v]) => `<i class="${k === lead ? "lead" : ""}" style="width:${v * 100}%;background:${col(k)}"></i>`).join("")}</span>`;
function pickCells(s) {
  const d = S.draft[s.slug] || {}, f = sbFair(s) || [];
  const sel = `<select class="pick" data-slug="${s.slug}" data-f="pick" aria-label="Your pick for ${esc(s.name)}"><option value="">Choose…</option>${f.map(([k, v]) => `<option value="${k}"${d.pick === k ? " selected" : ""}>${esc(outName(s, k))} · ${pct(v)}</option>`).join("")}</select>`;
  const conf = `<span class="seg mini">${Object.entries(CONF).map(([k, c]) => `<button type="button" data-slug="${s.slug}" data-conf="${k}" aria-pressed="${d.conf === k}">${c.label}</button>`).join("")}</span>`;
  const st = `<input class="stake" data-slug="${s.slug}" data-f="stake" inputmode="numeric" placeholder="0" value="${d.stake ?? ""}" aria-label="Points to bet"><span class="pays" data-pays="${s.slug}">${paysText(s, d)}</span>`;
  const ready = d.pick && d.conf;
  return { sel, conf, st, lock: `<button class="btn" type="button" data-lock="${s.slug}" ${ready ? "" : "disabled"} title="${ready ? "Lock this pick. It can't be changed." : "Choose a winner and how sure you are first"}">Lock</button><div class="row-err" data-err="${s.slug}"></div>` };
}
function paysText(s, d) { const o = d.pick ? s.sportsbet?.odds?.[d.pick] : null, st = Number(d.stake || 0); return o && st ? `pays ${n0(st * o)} if right` : ""; }
function renderTable() {
  document.querySelectorAll("#seat-table th button").forEach((b) => (b.dataset.sort === S.sort ? b.setAttribute("aria-sort", S.dir > 0 ? "ascending" : "descending") : b.removeAttribute("aria-sort")));
  $("#guide-h").textContent = { sb: "Guide: Sportsbet", "2022": "Guide: 2022 result", "2025": "Guide: 2025 federal", mine: "Guide: Sportsbet" }[S.view];
  $("#seat-table tbody").innerHTML = rows().map((s) => {
    const p = S.picks[s.slug], g = guide(s), t = tpp22(s);
    const head = `<td>${p ? `<span class="ring-dot" style="background:${col(p.pick)}"></span>` : ""}<button class="seatname link" type="button" data-open="${s.slug}">${esc(s.name)}</button>${s.region === "regional" ? '<span class="tag">regional</span>' : ""}</td>
      <td><span class="mp"><span class="sw" style="background:${col(s.mp.party)}"></span>${esc(s.mp.name)}${s.mp.retiring ? '<span class="tag">retiring</span>' : ""}</span></td>
      <td class="num">${s.margin ? `${s.margin.value.toFixed(1)}<span class="dim"> v ${esc(s.margin.vs)}</span>` : "—"}</td>
      <td><div class="guide-cell">${g ? `<span class="model-cell">${stackHTML(g.parts, g.lead)}<b>${g.label}</b>${g.sub && S.view !== "sb" && S.view !== "mine" ? `<span class="sub">${g.sub}</span>` : ""}</span>` : "—"}
        ${t ? `<span class="model-cell">${stackHTML([[t.a, t.av / 100], [t.b, t.bv / 100]], null, " tpp")}<span class="sub">2022 two-party ${SHORT[t.a]} ${t.av.toFixed(1)}–${t.bv.toFixed(1)}</span></span>` : ""}</div></td>`;
    if (p) return `<tr>${head}<td colspan="4"><span class="lockd">✓ <b>${esc(outName(s, p.pick))}</b> · ${CONF[p.conf].label}${p.stake ? ` · ${p.stake} pts bet, pays ${n0(p.stake * p.odds)} if right` : " · no bet"}</span></td></tr>`;
    const c = pickCells(s);
    return `<tr>${head}<td>${c.sel}</td><td>${c.conf}</td><td>${c.st}</td><td>${c.lock}</td></tr>`;
  }).join("") || `<tr class="empty-row"><td colspan="8">No seats match. Clear the search or pick another filter.</td></tr>`;
}

// ---------------------------------------------------------------- seat page (to be redesigned)
function openSeat(slug) { S.seat = slug; renderDrawer(); const d = $("#drawer"); d.setAttribute("aria-hidden", "false"); $("#scrim").hidden = false; d.scrollTop = 0; d.focus(); }
function closeSeat() { if (!S.seat) return; S.seat = null; $("#drawer").setAttribute("aria-hidden", "true"); $("#scrim").hidden = true; }
function renderDrawer() {
  const s = seatBy(S.seat), p = S.picks[s.slug], c = p ? null : pickCells(s);
  $("#drawer").innerHTML = `<div class="d-head"><div><h2 id="d-title" style="font-size:22px">${esc(s.name)}</h2><p class="caption">${esc(s.profile?.kind || "")} ${esc(s.mp.name)}, ${PARTY[s.mp.party]}.</p></div><button class="close back" type="button" data-act="close">← Back</button></div>
    <section class="d-sec"><h3>Your pick</h3>${p ? `<p class="lockd">✓ <b>${esc(outName(s, p.pick))}</b> · ${CONF[p.conf].label}${p.stake ? ` · ${p.stake} pts bet` : " · no bet"}</p>`
      : `<table class="sc"><tr><td>Winner</td><td>${c.sel}</td></tr><tr><td>How sure</td><td>${c.conf}</td></tr><tr><td>Bet</td><td>${c.st}</td></tr><tr><td></td><td>${c.lock}</td></tr></table>`}</section>
    <section class="d-sec"><div class="tip" style="position:static;display:block;box-shadow:none;border:0;padding:0;max-width:none">${tipHTML(s.slug)}</div><p class="caption">The full seat page is still to come.</p></section>`;
}

// ---------------------------------------------------------------- events
function onClick(e) {
  const t = e.target;
  const v = t.closest("[data-view]"); if (v) { S.view = v.dataset.view; document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === S.view))); renderChamber(); renderTable(); if ($("#maps").open) renderMap(); return; }
  const f = t.closest("[data-filter]"); if (f) { S.filter = f.dataset.filter; document.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === f))); renderTable(); return; }
  const so = t.closest("#seat-table th button"); if (so) { const k = so.dataset.sort; S.dir = S.sort === k ? -S.dir : k === "sure" ? -1 : 1; S.sort = k; renderTable(); return; }
  const o = t.closest("[data-open]") || t.closest("#chamber .seat") || t.closest(".district"); if (o) { openSeat(o.dataset.open || o.dataset.slug); return; }
  if (t.closest("[data-act=close]")) { closeSeat(); return; }
  const c = t.closest("[data-conf]"); if (c) { (S.draft[c.dataset.slug] ||= {}).conf = c.dataset.conf; refreshRow(c.dataset.slug); return; }
  const l = t.closest("[data-lock]"); if (l) lock(l.dataset.lock);
}
function onInput(e) {
  const t = e.target, slug = t.dataset?.slug; if (!t.dataset?.f || !slug) return;
  const d = (S.draft[slug] ||= {});
  if (t.dataset.f === "stake") { t.value = t.value.replace(/\D/g, ""); d.stake = t.value; document.querySelectorAll(`[data-pays="${slug}"]`).forEach((x) => (x.textContent = paysText(seatBy(slug), d))); return; }
  d.pick = t.value; refreshRow(slug);
}
function refreshRow(slug) { renderTable(); if (S.seat === slug) renderDrawer(); }
async function lock(slug) {
  const d = S.draft[slug] || {}, stake = Number(d.stake || 0), s = seatBy(slug);
  const err = (m) => document.querySelectorAll(`[data-err="${slug}"]`).forEach((x) => (x.textContent = m));
  if (!d.pick || !d.conf) return err("Choose a winner and how sure you are.");
  try {
    const r = await api("pick", { seat: slug, pick: d.pick, conf: d.conf, stake });
    S.picks[slug] = r.pick; delete S.draft[slug];
    closeSeat(); renderTop(); renderChamber(slug); renderPicture(); renderTable(); if ($("#maps").open) renderMap();
    toast(`<b>${esc(s.name)} locked.</b> ${esc(outName(s, d.pick))}, ${CONF[d.conf].label.toLowerCase()}${stake ? `, ${stake} points bet` : ", no bet"}. ${88 - Object.keys(S.picks).length} seats to go.`);
  } catch (x) { err(x.message); }
}
function toast(html) { const t = $("#toast"); t.innerHTML = html; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 5000); }

boot();
