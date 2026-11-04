// Office Cup: Victorian election 2026. Players see seat data and Sportsbet odds, never the model.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const PARTY = { ALP: "Labor", LIB: "Liberal", NAT: "Nationals", GRN: "Greens", ON: "One Nation", IND: "Independent",
  RMIN: "Other right", PROG: "Other progressive", OTH: "Any other" };
const col = (p) => `var(--${p in PARTY ? p : "NONE"})`;
const ORDER = ["GRN", "ALP", "IND", "PROG", "OTH", "unset", "RMIN", "ON", "LIB", "NAT"];
const DARK_TEXT = new Set(["NAT", "ON", "unset", "OTH", "RMIN", "PROG", "NONE"]);
const BANKROLL = 1000;
const CLOSE = new Date("2026-11-27T07:00:00Z"); // 6pm Melbourne, Fri 27 Nov
const CONF = { lean: { label: "Lean", p: 0.6 }, likely: { label: "Likely", p: 0.75 }, safe: { label: "Safe", p: 0.9 } };
const score = (p, right) => Math.round(100 * (1 - 2 * (right ? (1 - p) ** 2 : p ** 2)));
const pct = (v) => `${Math.round(v * 100)}%`;
const money = (v) => `$${Number(v).toFixed(2)}`;

const S = { D: null, me: null, picks: {}, view: "sb", filter: "all", q: "", seat: null, draft: {} };
const seatBy = (slug) => S.D.seats.find((s) => s.slug === slug);
const ABBR = {"albert-park":"AP","bendigo-east":"BE","bendigo-west":"BW","box-hill":"BH","gippsland-east":"GE","gippsland-south":"GS","glen-waverley":"GW","mill-park":"MP","murray-plains":"MuP","narre-warren-north":"NN","narre-warren-south":"NS","ovens-valley":"OV","pascoe-vale":"PV","point-cook":"PC","south-barwon":"SB","south-west-coast":"SW","st-albans":"SA","yan-yean":"YY","ashwood":"As","bass":"Ba","bayswater":"By","bellarine":"Bl","benambra":"Bn","bentleigh":"Bt","berwick":"Bk","brighton":"Bg","broadmeadows":"Bd","brunswick":"Br","bulleen":"Bu","bundoora":"Bo","carrum":"Ca","caulfield":"Cf","clarinda":"Cl","cranbourne":"Cr","croydon":"Cy","dandenong":"Da","eildon":"Ei","eltham":"El","essendon":"Es","eureka":"Eu","euroa":"Er","evelyn":"Ev","footscray":"Fo","frankston":"Fr","geelong":"Gl","greenvale":"Gv","hastings":"Ha","hawthorn":"Hw","ivanhoe":"Iv","kalkallo":"Ka","kew":"Ke","kororoit":"Ko","lara":"La","laverton":"Lv","lowan":"Lo","macedon":"Ma","malvern":"Mv","melbourne":"Me","melton":"Mt","mildura":"Mi","monbulk":"Mo","mordialloc":"Md","mornington":"Mn","morwell":"Mw","mulgrave":"Mu","narracan":"Na","nepean":"Ne","niddrie":"Ni","northcote":"No","oakleigh":"Oa","pakenham":"Pa","polwarth":"Po","prahran":"Pr","preston":"Ps","richmond":"Ri","ringwood":"Rw","ripon":"Rp","rowville":"Ro","sandringham":"Sd","shepparton":"Sh","sunbury":"Su","sydenham":"Sy","tarneit":"Ta","thomastown":"Th","warrandyte":"Wa","wendouree":"We","werribee":"Wr","williamstown":"Wi"};
const abbr = (s) => ABBR[s.slug] || s.name.slice(0, 2);

// ---------------------------------------------------------------- API (demo mode keeps everything in this page)
const DEMO = !!window.OFFICE_DEMO;
const mem = { players: {}, picks: {} };
async function api(path, body) {
  if (DEMO) return demoApi(path, body);
  const r = await fetch(`/api/${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", authorization: `Bearer ${localStorage.getItem("office.token") || ""}` }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
function demoApi(path, b) {
  if (path === "join" || path === "login") {
    const grp = path === "join" ? ({ alliance: "Alliance", aimates: "AI Mates" }[String(b.code).toLowerCase().replace(/\s/g, "")] || "AI Mates") : "AI Mates";
    return { token: "demo", player: { name: b.name || "You", group: grp } };
  }
  if (path === "me") return { player: S.me, picks: Object.values(mem.picks) };
  if (path === "pick") {
    if (mem.picks[b.seat]) throw new Error("You've already locked this seat.");
    const sb = seatBy(b.seat).sportsbet;
    const staked = Object.values(mem.picks).reduce((a, p) => a + p.stake, 0);
    if (staked + b.stake > BANKROLL) throw new Error(`Only ${BANKROLL - staked} points left.`);
    const p = { seat: b.seat, pick: b.pick, conf: b.conf, stake: b.stake, odds: sb?.odds?.[b.pick] ?? null, odds_as_of: sb?.as_of, created_at: new Date().toISOString() };
    mem.picks[b.seat] = p; return { pick: p };
  }
}

// ---------------------------------------------------------------- boot
async function boot() {
  S.D = window.OFFICE_DATA || await (await fetch("data/office.json")).json();
  if (DEMO || localStorage.getItem("office.token")) {
    try { const r = await api("me"); if (r.player) { S.me = r.player; setPicks(r.picks); return renderApp(); } } catch {}
  }
  renderLogin();
}
const setPicks = (list) => { S.picks = Object.fromEntries((list || []).map((p) => [p.seat, p])); };

// ---------------------------------------------------------------- login
function renderLogin(mode = "join") {
  $("#app").innerHTML = `<div class="login card">
    ${DEMO ? `<div class="demo-note"><b>Preview.</b> Nothing is saved. Type any name and PIN; use code <b>alliance</b> or <b>aimates</b> to pick a team.</div>` : ""}
    <h1>Office Cup</h1>
    <p class="hint">Victorian election, Saturday 28 November. Call the seats, back your judgement, beat the bookies.</p>
    <div class="seg" style="margin-top:14px"><button type="button" data-login="join" aria-pressed="${mode === "join"}">I have an invite code</button><button type="button" data-login="login" aria-pressed="${mode === "login"}">I've joined before</button></div>
    <form id="login-f">
      ${mode === "join" ? `<label>Invite code<input name="code" autocomplete="off" required></label>` : ""}
      <label>Your name (shown on the leaderboard)<input name="name" maxlength="40" required></label>
      <label>${mode === "join" ? "Choose a 4–6 digit PIN" : "PIN"}<input name="pin" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required></label>
      <button class="btn" type="submit">${mode === "join" ? "Join" : "Sign in"}</button>
      <p class="err" id="login-err"></p>
    </form></div>`;
  $("#app").querySelectorAll("[data-login]").forEach((b) => b.addEventListener("click", () => renderLogin(b.dataset.login)));
  $("#login-f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, body = { name: f.name.value.trim(), pin: f.pin.value, code: f.code?.value };
    try { const r = await api(mode, body); localStorage.setItem("office.token", r.token); S.me = r.player; const m = await api("me"); setPicks(m.picks); renderApp(); }
    catch (x) { $("#login-err").textContent = x.message; }
  });
}

// ---------------------------------------------------------------- app shell
function renderApp() {
  $("#app").innerHTML = `<div class="wrap">
    <div class="top">
      <div class="brand"><h1>Office Cup</h1><span>Victorian election · Sat 28 Nov 2026</span></div>
      <div class="me">${DEMO ? '<span class="badge alt">Preview: nothing is saved</span>' : ""}<span><b>${esc(S.me.name)}</b></span><span class="badge">${esc(S.me.group)}</span><button class="btn btn-quiet" type="button" id="signout">Sign out</button></div>
    </div>
    <div class="stats" id="stats"></div>
    <div class="card" style="margin-top:18px"><details class="rules-d" ${Object.keys(S.picks).length ? "" : "open"}><summary>How it works: three contests, one set of picks</summary>${rulesHTML()}</details></div>
    <div class="card"><div class="ch-head"><h2>Your chamber</h2>${viewSeg("chamber")}</div><svg id="chamber" role="img" aria-label="88 seats"></svg><ul class="legend" id="legend"></ul><p class="hint" id="ch-desc"></p></div>
    <div class="card"><div class="list-head"><h2>The 88 seats</h2><input type="search" id="q" placeholder="Find a seat or MP"><div class="seg small" id="filters">
      ${[["all", "All"], ["todo", "To call"], ["called", "Called"], ["close", "Close contests"]].map(([k, l]) => `<button type="button" data-filter="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join("")}</div></div>
      <p class="hint" style="margin:0 0 10px">The guide column follows the view: ${viewSeg("list")}</p>
      <div style="overflow-x:auto"><table class="seats"><thead><tr><th>Seat</th><th>Guide</th><th>Your pick</th><th>Confidence</th><th class="num">Stake</th><th></th></tr></thead><tbody id="rows"></tbody></table></div></div>
    <p class="muted">Seat data: VEC 2022 results, AEC 2025 federal results on state boundaries, ABS census. Odds: Sportsbet, last snapshot ${new Date(latestOdds()).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}. Your stake is priced at the odds showing when you lock.</p>
  </div>
  <aside class="drawer" id="drawer" aria-hidden="true" tabindex="-1"></aside><div class="scrim" id="scrim" hidden></div><div class="toast" id="toast" role="status"></div>`;
  $("#signout").onclick = () => { localStorage.removeItem("office.token"); S.me = null; renderLogin("login"); };
  $("#q").addEventListener("input", (e) => { S.q = e.target.value.trim().toLowerCase(); renderRows(); });
  $("#filters").addEventListener("click", (e) => { const b = e.target.closest("[data-filter]"); if (!b) return; S.filter = b.dataset.filter; $("#filters").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); renderRows(); });
  document.addEventListener("click", onClick);
  document.addEventListener("input", onInput);
  $("#scrim").onclick = closeSeat;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSeat(); });
  renderAll();
}
const latestOdds = () => S.D.seats.map((s) => s.sportsbet?.as_of).filter(Boolean).sort().at(-1);
const VIEWS = [["sb", "Sportsbet"], ["2022", "2022 result"], ["2025", "2025 federal"], ["mine", "My picks"]];
const viewSeg = (where) => `<span class="seg${where === "list" ? " small" : ""}" data-views="${where}">${VIEWS.filter(([k]) => where === "chamber" || k !== "mine").map(([k, l]) => `<button type="button" data-view="${k}" aria-pressed="${S.view === k}">${l}</button>`).join("")}</span>`;
function renderAll() { renderStats(); renderChamber(); renderRows(); }

function rulesHTML() {
  return `<div class="rules">
    <div><h3>1 · Most correct calls</h3><p>Pick a winner in as many seats as you can. Every right call is one point. Seats you don't call score nothing.</p></div>
    <div><h3>2 · Best judgement</h3><p>Say how sure you are. Being sure and right pays; being sure and wrong costs.</p>
      <table class="sc"><tr><th></th><th>Right</th><th>Wrong</th></tr>${Object.values(CONF).map((c) => `<tr><td>${c.label} (${pct(c.p)})</td><td class="pos">+${score(c.p, true)}</td><td class="${score(c.p, false) < 0 ? "neg" : "pos"}">${score(c.p, false) > 0 ? "+" : ""}${score(c.p, false)}</td></tr>`).join("")}</table></div>
    <div><h3>3 · Biggest winnings</h3><p>You have ${BANKROLL.toLocaleString("en-AU")} play points to bet at Sportsbet's odds, locked when you lock. A win returns stake × odds. Bet where you think the bookies are wrong; skip the rest.</p></div>
  </div><p class="hint" style="margin-top:12px">Locked calls are final. Nobody sees anyone else's picks until the count. Picks close <b>6pm Friday 27 November</b> (Melbourne time). Leaderboards: Alliance, AI Mates and everyone.</p>`;
}

function renderStats() {
  const P = Object.values(S.picks), staked = P.reduce((a, p) => a + p.stake, 0);
  const days = Math.max(0, Math.ceil((CLOSE - Date.now()) / 864e5));
  $("#stats").innerHTML = `
    <div class="stat"><div class="v">${P.length}<span style="font-size:15px;color:var(--ink-3)"> / 88</span></div><div class="l">Seats called · ${88 - P.length} to go</div><div class="bar"><i style="width:${(P.length / 88) * 100}%"></i></div></div>
    <div class="stat"><div class="v">${(BANKROLL - staked).toLocaleString("en-AU")}</div><div class="l">Points left to bet, of ${BANKROLL.toLocaleString("en-AU")}</div><div class="bar"><i style="width:${(staked / BANKROLL) * 100}%"></i></div></div>
    <div class="stat"><div class="v">${P.filter((p) => p.stake).length}</div><div class="l">Bets placed · ${Math.round(P.reduce((a, p) => a + p.stake * (p.odds || 0), 0)).toLocaleString("en-AU")} pts if all win</div></div>
    <div class="stat"><div class="v">${days} days</div><div class="l">Until picks close, 6pm Fri 27 Nov</div></div>`;
}

// ---------------------------------------------------------------- what each view says about a seat
function sbFav(s) { const f = s.sportsbet?.fair; if (!f) return null; const [k, v] = Object.entries(f).sort((a, b) => b[1] - a[1])[0]; return { k, v, odds: s.sportsbet.odds[k] }; }
function fed2025(s) {
  const f = s.fed2025; if (!f?.prims) return null;
  const top = Object.entries(f.prims).sort((a, b) => b[1] - a[1]), two = top.slice(0, 2).map(([k]) => k), coal = two.find((k) => k === "LIB" || k === "NAT");
  if (two.includes("ALP") && coal && f.alp_tpp != null) return { k: f.alp_tpp >= 50 ? "ALP" : coal, m: Math.abs(f.alp_tpp - 50), how: `two-party ${f.alp_tpp >= 50 ? f.alp_tpp.toFixed(1) : (100 - f.alp_tpp).toFixed(1)}%` };
  return { k: top[0][0], m: (top[0][1] - top[1][1]) / 2, how: `led primaries ${top[0][1].toFixed(1)}% v ${top[1][1].toFixed(1)}%` };
}
function seatColour(s) {
  if (S.view === "mine") { const p = S.picks[s.slug]; return p ? { p: p.pick, op: 0.45 + 0.55 * (CONF[p.conf].p - 0.5) / 0.4 } : { p: "unset", op: 1 }; }
  if (S.view === "2022") return { p: s.mp.party, op: 0.35 + 0.65 * Math.min(1, (s.margin?.value ?? 10) / 12) };
  if (S.view === "2025") { const f = fed2025(s); return f ? { p: f.k, op: 0.35 + 0.65 * Math.min(1, f.m / 12) } : { p: "unset", op: 1 }; }
  const f = sbFav(s); return f ? { p: f.k, op: 0.3 + 0.7 * Math.min(1, Math.max(0, (f.v - 0.34) / 0.6)) } : { p: "unset", op: 1 };
}
function guideHTML(s) {
  if (S.view === "2022") return `<span class="pill" style="background:${col(s.mp.party)}"></span><b>${PARTY[s.mp.party] || s.mp.party}</b> <span class="sub">${s.margin ? `by ${s.margin.value.toFixed(1)}% v ${PARTY[s.margin.vs] || s.margin.vs}` : ""}</span>`;
  if (S.view === "2025") { const f = fed2025(s); return f ? `<span class="pill" style="background:${col(f.k)}"></span><b>${PARTY[f.k]}</b> <span class="sub">${f.how}</span>` : "—"; }
  const f = sbFav(s); return f ? `<span class="pill" style="background:${col(f.k)}"></span><b>${outName(s, f.k)}</b> ${pct(f.v)} <span class="sub">(${money(f.odds)})</span>` : "—";
}
const outName = (s, k) => s.sportsbet?.names?.[k] || PARTY[k] || k;

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
    const pt = layout[i], X = (cx + pt.x * R).toFixed(1), Y = (cy - pt.y * R).toFixed(1), ab = abbr(x.s), called = !!S.picks[x.s.slug];
    const light = x.op > 0.6 && !DARK_TEXT.has(x.p);
    return `<g class="seat-g${pulse === x.s.slug ? " pulse" : ""}"><title>${esc(x.s.name)}</title><circle class="seat${x.p === "unset" ? " unset" : ""}" data-slug="${x.s.slug}" cx="${X}" cy="${Y}" r="${dot}" style="${x.p === "unset" ? "" : `fill:${col(x.p)};opacity:${x.op.toFixed(2)}`}"></circle>${called ? `<circle class="ring" cx="${X}" cy="${Y}" r="${dot + 3.5}"/>` : ""}<text class="ab${light ? " light" : ""}" x="${X}" y="${Y}" dy="0.35em" text-anchor="middle" font-size="11">${ab}</text></g>`;
  }).join("");
  const n = Object.keys(S.picks).length, lnp = (tally.LIB || 0) + (tally.NAT || 0);
  const big = S.view === "mine"
    ? `<text class="tally" x="${cx}" y="${cy - 52}" text-anchor="middle" font-size="44">${n}</text><text class="tally-sub" x="${cx}" y="${cy - 28}" text-anchor="middle">seats called, ${88 - n ? `${88 - n} to go` : "all 88 done"}</text>`
    : `<text class="tally" x="${cx - 74}" y="${cy - 50}" text-anchor="middle" font-size="46" style="fill:${col("ALP")}">${tally.ALP || 0}</text><text class="tally-sub" x="${cx - 74}" y="${cy - 26}" text-anchor="middle">Labor</text><text class="tally" x="${cx + 74}" y="${cy - 50}" text-anchor="middle" font-size="46" style="fill:${col("LIB")}">${lnp}</text><text class="tally-sub" x="${cx + 74}" y="${cy - 26}" text-anchor="middle">Coalition</text>`;
  const svg = $("#chamber"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `<line class="maj" x1="${cx}" y1="${cy - R - 24}" x2="${cx}" y2="${cy - R * 0.36}"/><text class="maj-label" x="${cx}" y="${cy - R - 30}" text-anchor="middle">45 seats to govern</text>${circles}${big}`;
  $("#legend").innerHTML = ORDER.filter((p) => tally[p]).map((p) => `<li><span class="sw" style="background:${p === "unset" ? "transparent;border:1px solid var(--rule)" : col(p)}"></span>${p === "unset" ? "Not called" : PARTY[p]} ${tally[p]}</li>`).join("");
  $("#ch-desc").textContent = { sb: "Sportsbet's favourite in each seat, bookmaker margin removed. Fainter = less certain.", "2022": "Who won in 2022 (by-elections included). Fainter = closer margin.", "2025": "Who won the 2025 federal vote on this seat's booths. Fainter = closer.", mine: "Your locked calls. Fainter = less confident. White = not called yet." }[S.view] + " A dark ring means you've locked that seat. Click any seat to open it.";
}

// ---------------------------------------------------------------- seat list
function matches(s) {
  if (S.q && !(s.name.toLowerCase().includes(S.q) || s.mp.name.toLowerCase().includes(S.q))) return false;
  if (S.filter === "todo") return !S.picks[s.slug];
  if (S.filter === "called") return !!S.picks[s.slug];
  if (S.filter === "close") { const f = sbFav(s); return f && f.v < 0.6; }
  return true;
}
function pickControls(s, where) {
  const d = S.draft[s.slug] || {}, outs = Object.keys(s.sportsbet?.odds || {}).sort((a, b) => s.sportsbet.odds[a] - s.sportsbet.odds[b]);
  const odds = d.pick ? s.sportsbet?.odds?.[d.pick] : null, stake = Number(d.stake || 0);
  const sel = `<select class="pick" data-slug="${s.slug}" data-f="pick"><option value="">Choose…</option>${outs.map((k) => `<option value="${k}"${d.pick === k ? " selected" : ""}>${esc(outName(s, k))} · ${money(s.sportsbet.odds[k])}</option>`).join("")}</select>`;
  const conf = `<span class="seg small">${Object.entries(CONF).map(([k, c]) => `<button type="button" data-slug="${s.slug}" data-conf="${k}" aria-pressed="${d.conf === k}">${c.label}</button>`).join("")}</span>`;
  const st = `<input class="stake" data-slug="${s.slug}" data-f="stake" inputmode="numeric" placeholder="0" value="${d.stake ?? ""}">`;
  const ret = odds && stake ? `<span class="ret">returns ${Math.round(stake * odds)}</span>` : "";
  const ready = d.pick && d.conf;
  const lock = `<button class="btn" type="button" data-lock="${s.slug}" ${ready ? "" : "disabled"} title="${ready ? "Lock this call. It can't be changed." : "Choose a pick and a confidence first"}">Lock</button>`;
  return where === "row" ? { sel, conf, st: `${st} ${ret}`, lock } : { sel, conf, st, ret, lock };
}
function lockedHTML(p, s) {
  return `<span class="locked">✓ <b>${esc(outName(s, p.pick))}</b> · ${CONF[p.conf].label}${p.stake ? ` · ${p.stake} pts at ${money(p.odds)}` : " · no bet"}</span>`;
}
function renderRows() {
  const rows = S.D.seats.filter(matches);
  $("#rows").innerHTML = rows.map((s) => {
    const p = S.picks[s.slug], called = !!p;
    const head = `<td><span class="dot${called ? " called" : ""}" style="${called ? `background:${col(p.pick)}` : ""}"></span><button class="sname" type="button" data-open="${s.slug}">${esc(s.name)}</button><span class="tag hide-sm">${esc(s.mp.name)}</span></td><td class="guide">${guideHTML(s)}</td>`;
    if (p) return `<tr>${head}<td colspan="4">${lockedHTML(p, s)}</td></tr>`;
    const c = pickControls(s, "row");
    return `<tr>${head}<td>${c.sel}</td><td>${c.conf}</td><td class="num">${c.st}</td><td>${c.lock}<div class="err" data-err="${s.slug}"></div></td></tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">No seats match.</td></tr>`;
}

// ---------------------------------------------------------------- seat popup
function openSeat(slug) { S.seat = slug; renderDrawer(); const d = $("#drawer"); d.setAttribute("aria-hidden", "false"); $("#scrim").hidden = false; d.scrollTop = 0; d.focus(); }
function closeSeat() { if (!S.seat) return; S.seat = null; $("#drawer").setAttribute("aria-hidden", "true"); $("#scrim").hidden = true; }
const bars = (entries, max) => `<div class="bars">${entries.map(([k, v, label]) => `<span>${esc(label || PARTY[k] || k)}</span><span class="b" style="width:${(100 * v) / max}%;background:${col(k)}"></span><span class="num">${v.toFixed(1)}%</span>`).join("")}</div>`;
function renderDrawer() {
  const s = seatBy(S.seat), p = S.picks[s.slug], sb = s.sportsbet, dm = s.demo || {}, vic = s.demo_vic || {};
  const prim22 = (s.primaries_2022 || []).slice().sort((a, b) => b.pct - a.pct).slice(0, 6).map((c) => [c.party, c.pct, `${c.name.split(" ").at(-1)} (${c.party})`]);
  const fed = Object.entries(s.fed2025?.prims || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const c = p ? null : pickControls(s, "drawer");
  $("#drawer").innerHTML = `
    <div class="d-head"><div><h2 style="font-size:22px">${esc(s.name)}</h2><p class="hint">${esc(s.profile?.kind || "")} Held by ${esc(s.mp.name)} (${PARTY[s.mp.party] || s.mp.party})${s.mp.retiring ? ", retiring" : ""}${s.margin ? `, margin ${s.margin.value.toFixed(1)}% v ${PARTY[s.margin.vs] || s.margin.vs}` : ""}.</p></div><button class="close" type="button" data-act="close">← Back to chamber</button></div>
    <div class="d-sec"><h3>Your call</h3>${p ? `<p>${lockedHTML(p, s)}</p><p class="hint">Locked ${new Date(p.created_at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}. Locked calls are final.</p>`
      : `<div class="pickbox"><div class="row"><label>Winner</label>${c.sel}</div><div class="row"><label>How sure</label>${c.conf}</div><div class="row"><label>Bet (optional)</label>${c.st} <span class="muted">points</span> ${c.ret}</div><div class="row">${c.lock}<span class="err" data-err="${s.slug}"></span></div></div>`}</div>
    <div class="d-sec"><h3>Sportsbet now</h3>${sb ? `<table class="odds-t">${Object.entries(sb.odds).sort((a, b) => a[1] - b[1]).map(([k, o]) => `<tr><td><span class="pill" style="background:${col(k)}"></span>${esc(outName(s, k))}</td><td class="num">${pct(sb.fair[k])}</td><td class="num"><b>${money(o)}</b></td></tr>`).join("")}</table><p class="hint">Chance with the bookmaker's margin removed, then the odds you'd lock at. Snapshot ${new Date(sb.as_of).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.</p>` : `<p class="muted">Sportsbet doesn't list this seat.</p>`}</div>
    <div class="d-sec"><h3>2022 state result (primary vote)</h3>${bars(prim22, Math.max(...prim22.map((x) => x[1])))}${s.final_two_2022 ? `<p class="hint">Final two: ${s.final_two_2022.map(esc).join(" v ")}.</p>` : ""}</div>
    ${fed.length ? `<div class="d-sec"><h3>2025 federal vote on these booths</h3>${bars(fed, fed[0][1])}${s.fed2025.alp_tpp != null ? `<p class="hint">Two-party preferred: Labor ${s.fed2025.alp_tpp.toFixed(1)}%, Coalition ${(100 - s.fed2025.alp_tpp).toFixed(1)}%.</p>` : ""}</div>` : ""}
    ${s.candidates_2026?.length ? `<div class="d-sec"><h3>Candidates so far</h3><p style="margin:0;font-size:14px">${s.candidates_2026.map((x) => `${esc(x.name)} <span class="muted">(${esc(x.party)})</span>`).join(" · ")}</p><p class="hint">Nominations close 13 November.</p></div>` : ""}
    <div class="d-sec"><h3>Who lives here</h3>${s.profile?.people ? `<p class="hint" style="margin-bottom:8px">${esc(s.profile.people)}</p>` : ""}<div class="facts">
      ${[["Median age", dm.age, vic.age, (v) => v.toFixed(0)], ["Born overseas", dm.born_os, vic.born_os, (v) => v.toFixed(0) + "%"], ["Uni degree", dm.uni, vic.uni, (v) => v.toFixed(0) + "%"], ["Trade cert", dm.cert, vic.cert, (v) => v.toFixed(0) + "%"], ["Renting", dm.rent, vic.rent, (v) => v.toFixed(0) + "%"], ["Weekly household income", dm.inc, vic.inc, (v) => "$" + Math.round(v).toLocaleString("en-AU")]]
        .filter((r) => r[1] != null).map(([l, v, vv, f]) => `<div><b>${f(v)}</b>${l}${vv != null ? `<span class="muted"> · Vic ${f(vv)}</span>` : ""}</div>`).join("")}</div></div>
    ${s.news?.length ? `<div class="d-sec"><h3>In the news</h3><ul class="news">${s.news.map((n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted">${esc(n.source || "")}</span></li>`).join("")}</ul></div>` : ""}
    ${s.links?.length ? `<div class="d-sec"><h3>Read more</h3><p style="margin:0;font-size:13px">${s.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(" · ")}</p></div>` : ""}`;
}

// ---------------------------------------------------------------- events
function onClick(e) {
  const t = e.target;
  const v = t.closest("[data-view]"); if (v) { S.view = v.dataset.view; document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === S.view))); renderChamber(); renderRows(); return; }
  const o = t.closest("[data-open]") || t.closest("#chamber .seat"); if (o) { openSeat(o.dataset.open || o.dataset.slug); return; }
  if (t.closest("[data-act=close]")) { closeSeat(); return; }
  const c = t.closest("[data-conf]"); if (c) { const d = (S.draft[c.dataset.slug] ||= {}); d.conf = c.dataset.conf; refresh(c.dataset.slug); return; }
  const l = t.closest("[data-lock]"); if (l) lock(l.dataset.lock);
}
function onInput(e) {
  const t = e.target; if (!t.dataset?.f || !t.dataset.slug) return;
  const d = (S.draft[t.dataset.slug] ||= {});
  d[t.dataset.f] = t.dataset.f === "stake" ? t.value.replace(/\D/g, "") : t.value;
  if (t.dataset.f === "pick") refresh(t.dataset.slug);
  else { const odds = d.pick ? seatBy(t.dataset.slug).sportsbet?.odds?.[d.pick] : null; const r = t.parentElement.querySelector(".ret") || t.closest(".row")?.querySelector(".ret");
    if (r) r.textContent = odds && d.stake ? `returns ${Math.round(d.stake * odds)}` : ""; else if (odds && d.stake) refresh(t.dataset.slug, t); }
}
function refresh(slug, keepFocus) {
  if (S.seat === slug) renderDrawer();
  renderRows();
  if (keepFocus) { const el = document.querySelector(`${S.seat === slug ? "#drawer " : ""}[data-slug="${slug}"][data-f="stake"]`); el?.focus(); el?.setSelectionRange(99, 99); }
}
async function lock(slug) {
  const d = S.draft[slug] || {}, stake = Number(d.stake || 0), s = seatBy(slug);
  const err = (m) => document.querySelectorAll(`[data-err="${slug}"]`).forEach((x) => (x.textContent = m));
  if (!d.pick || !d.conf) return err("Choose a winner and how sure you are.");
  try {
    const r = await api("pick", { seat: slug, pick: d.pick, conf: d.conf, stake });
    S.picks[slug] = r.pick; delete S.draft[slug];
    closeSeat(); renderStats(); renderChamber(slug); renderRows();
    toast(`<b>${esc(s.name)} locked.</b> ${esc(outName(s, d.pick))}, ${CONF[d.conf].label.toLowerCase()}${stake ? `, ${stake} points at ${money(r.pick.odds)}` : ", no bet"}. ${88 - Object.keys(S.picks).length} seats to go.`);
  } catch (x) { err(x.message); }
}
function toast(html) { const t = $("#toast"); t.innerHTML = html; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 5000); }

boot();
