// Ballot Miner admin: passphrase sign-in, links to Count Room and the game, teams and players.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const when = (t) => (t ? new Date(t).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");
const next = new URLSearchParams(location.search).get("next");

async function api(a, body) {
  const r = await fetch(`/api/admin?a=${a}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status });
  return j;
}

function gate() {
  $("#who").innerHTML = `<a class="btn btn-quiet" href="/play/">Back to the game</a>`;
  $("#app").innerHTML = `<section class="card gate"><h2>Sign in as admin</h2>
    <p class="hint">Your passphrase. This browser stays signed in for 30 days.</p>
    <form id="gate-f"><input name="p" type="password" autocomplete="current-password" required aria-label="Passphrase" placeholder="Passphrase"><button class="btn" type="submit">Sign in</button></form>
    <p class="err" id="gate-err" role="alert"></p></section>`;
  $("#gate-f").onsubmit = async (e) => {
    e.preventDefault();
    try { await api("login", { passphrase: e.target.p.value }); if (next && next.startsWith("/")) location.href = next; else home(); }
    catch (x) { $("#gate-err").textContent = x.message; }
  };
  $("#gate-f").p.focus();
}

async function home() {
  $("#who").innerHTML = `<span class="tag">Signed in as admin</span><button class="btn btn-quiet" id="out" type="button">Sign out</button>`;
  $("#out").onclick = async () => { await api("logout", {}); gate(); };
  $("#app").innerHTML = `
    <div class="go">
      <a class="main" href="/count-room"><b>Count Room</b><span class="muted">The model, your seat calls and your ledger</span></a>
      <a href="/play/"><b>Play Ballot Miner</b><span class="muted">The players' game, as they see it (sign in with your player PIN)</span></a>
    </div>
    <section class="card"><h2>Teams</h2><p class="hint">Send each team its code. Players join at <code>${esc(location.origin)}/play</code>.</p>
      <div class="table-wrap" id="teams"></div>
      <form class="row-form" id="team-f"><input name="n" placeholder="New team name" maxlength="40" required><button class="btn btn-quiet" type="submit">Add team</button></form><p class="err" id="team-err"></p></section>
    <section class="card"><h2>Players</h2><p class="hint">Nobody but you sees this until the count. Reset a PIN when someone forgets theirs: they get a new 4-digit PIN and are signed out elsewhere.</p>
      <div class="table-wrap" id="players"><p class="hint">Loading…</p></div></section>`;
  $("#team-f").onsubmit = async (e) => {
    e.preventDefault();
    try { await api("team", { name: e.target.n.value.trim() }); e.target.reset(); loadTeams(); } catch (x) { $("#team-err").textContent = x.message; }
  };
  loadTeams(); loadPlayers();
}

async function loadTeams() {
  const { teams } = await api("teams");
  $("#teams").innerHTML = `<table><thead><tr><th>Team</th><th>Code</th><th>Invite</th></tr></thead><tbody>${teams.map((t) => {
    const msg = `Join Ballot Miner for the Victorian election: ${location.origin}/play, team code ${t.code}. Choose a name and a 4-6 digit PIN.`;
    return `<tr><td>${esc(t.name)}</td><td><code>${esc(t.code)}</code></td><td><button class="btn btn-quiet" type="button" data-copy="${esc(msg)}">Copy invite</button></td></tr>`;
  }).join("")}</tbody></table>`;
  document.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => { await navigator.clipboard.writeText(b.dataset.copy).catch(() => {}); b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy invite"), 1500); }));
}

async function loadPlayers() {
  const { players } = await api("players");
  if (!players.length) { $("#players").innerHTML = `<p class="hint">No players yet.</p>`; return; }
  $("#players").innerHTML = `<table><thead><tr><th>Player</th><th>Team</th><th class="num">Seats picked</th><th class="num">Bets</th><th class="num">Points left</th><th>Vote set</th><th>Last active</th><th>Organiser</th><th></th></tr></thead><tbody>
    ${players.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.team)}</td><td class="num">${p.seats} / 88</td><td class="num">${p.bets}</td><td class="num">${p.left}</td><td>${p.voted ? "Yes" : "No"}</td><td>${when(p.last_seen)}</td>
      <td><label><input type="checkbox" data-org="${p.id}" ${p.organiser ? "checked" : ""}> organiser</label></td>
      <td><button class="btn btn-quiet" type="button" data-reset="${p.id}" data-name="${esc(p.name)}">Reset PIN</button> <span id="pin-${p.id}"></span></td></tr>`).join("")}
    </tbody></table><p class="hint">Organisers are flagged when picks are revealed after the count.</p>`;
  document.querySelectorAll("[data-org]").forEach((c) => (c.onchange = () => api("organiser", { id: Number(c.dataset.org), on: c.checked })));
  document.querySelectorAll("[data-reset]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`Give ${b.dataset.name} a new PIN? Their old one stops working.`)) return;
    const r = await api("reset", { id: Number(b.dataset.reset) });
    $(`#pin-${b.dataset.reset}`).innerHTML = `New PIN <span class="pin">${esc(r.pin)}</span>, tell ${esc(r.name)}`;
  }));
}

api("status").then((r) => (r.admin ? home() : gate())).catch(gate);
