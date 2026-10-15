/* Mayo @ IDWeek 2026 — web version of the iPhone app. No build step; data is sessions.json. */
"use strict";

const SITE_LABEL = { RST: "Rochester", AZ: "Arizona", FL: "Florida", MCHS: "Health System" };
const TZ = "America/New_York";
const CAL_ALL = "ics/all.ics";

// ---------- small helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fold = (s) => String(s).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const boardNum = (it) => parseInt((it.board || "").replace(/\D/g, ""), 10) || 0;

const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};
const starred = new Set(store.get("starred", []));
const visited = new Set(store.get("visited", []));
const saveSets = () => { store.set("starred", [...starred]); store.set("visited", [...visited]); updateBadge(); };

// Pretend it's mid-conference for testing: ?now=2026-10-22T10:20:00-04:00
const clockOffset = (() => {
  const q = new URLSearchParams(location.search).get("now");
  const d = q ? new Date(q) : null;
  return d && !isNaN(d) ? d - Date.now() : 0;
})();
const now = () => new Date(Date.now() + clockOffset);

// ---------- Eastern-time formatting ----------
const fmtParts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
const fmtKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hm = (d) => { const p = fmtParts.formatToParts(d); return `${p.find((x) => x.type === "hour").value}:${p.find((x) => x.type === "minute").value}`; };
const ampm = (d) => fmtParts.formatToParts(d).find((x) => x.type === "dayPeriod").value.toUpperCase();
const time = (d) => `${hm(d)} ${ampm(d)}`;
const range = (a, b) => (ampm(a) === ampm(b) ? `${hm(a)}–${hm(b)} ${ampm(b)}` : `${time(a)}–${time(b)}`);
const dayKey = (d) => fmtKey.format(d);
const dayDate = (k) => new Date(`${k}T12:00:00-04:00`);
const dayTitle = (k) => dayDate(k).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "short", day: "numeric" });
const shortDay = (k) => dayDate(k).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" });
const dayNum = (k) => dayDate(k).toLocaleDateString("en-US", { timeZone: TZ, day: "numeric" });

// ---------- data ----------
let DATA;            // { items, allItems, people, days, ... }

function prepare(raw) {
  const all = raw.items.map((it) => ({ ...it, start: new Date(it.start), end: new Date(it.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end || boardNum(a) - boardNum(b));
  const byId = new Map(all.map((i) => [i.id, i]));
  const children = new Map(), parentOf = new Map();
  for (const c of all.filter((i) => i.parentTitle)) {
    const p = all.find((i) => !i.parentTitle && i.kind === "talk" && i.day === c.day && i.room === c.room && i.title === c.parentTitle);
    if (p) { (children.get(p.id) || children.set(p.id, []).get(p.id)).push(c); parentOf.set(c.id, p.id); }
  }
  const items = all.filter((i) => !parentOf.has(i.id));
  for (const it of all) {
    it.mayo = mayoPeople(it);
    it.search = fold([it.title, it.room, it.board, it.category, it.session, typeLabel(it),
      ...it.roles.flatMap((r) => r.people.map((p) => `${p.name} ${p.affiliation || ""}`))].join(" "));
  }
  for (const [pid, cs] of children) byId.get(pid).search += " " + cs.map((c) => c.search).join(" ");
  const people = raw.people.map((p) => ({ ...p, sortName: sortName(p) }));
  return {
    all, items, byId, children, parentOf, people,
    peopleById: new Map(people.map((p) => [p.id, p])),
    days: [...new Set(all.map((i) => i.day))].sort(),
    posterDays: [...new Set(all.filter((i) => i.kind !== "talk").map((i) => i.day))].sort(),
  };
}

function mayoPeople(it) {
  const seen = new Set(), out = [];
  const roles = [...it.roles].sort((a, b) => (a.role === "Co-authors") - (b.role === "Co-authors"));
  for (const r of roles) for (const p of r.people) {
    if (p.site && !seen.has(p.personId)) { seen.add(p.personId); out.push({ ...p, lead: r.role !== "Co-authors" }); }
  }
  return out;
}

function sortName(p) {
  const first = p.name.endsWith(p.lastName) ? p.name.slice(0, -p.lastName.length).trim() : "";
  return first ? `${p.lastName}, ${first}` : p.name;
}

function typeLabel(it) {
  if (it.kind === "poster") return "Poster";
  if (it.kind === "virtualPoster") return "Virtual Poster";
  return it.type || "Talk";
}
function kickerClass(it) {
  if (it.kind !== "talk") return "k-poster";
  if (["Oral Abstract", "Late-Breaker", "Rapid-Fire Poster Talk"].includes(it.type)) return "k-abstract";
  if (it.type === "Workshop Talk") return "k-workshop";
  return "k-talk";
}

function posterBlock(day) {
  const posters = DATA.items.filter((i) => i.day === day && i.kind !== "talk")
    .sort((a, b) => (a.kind === "virtualPoster") - (b.kind === "virtualPoster") || boardNum(a) - boardNum(b));
  const hall = posters.filter((p) => p.kind === "poster");
  if (!posters.length) return null;
  const f = hall[0] || posters[0];
  return { id: `posters-${day}`, day, start: f.start, end: f.end, room: f.room, posters, hall, virtual: posters.filter((p) => p.kind === "virtualPoster") };
}

function schedule(day) {
  const entries = DATA.items.filter((i) => i.day === day && i.kind === "talk").map((item) => ({ item, start: item.start, end: item.end }));
  const block = posterBlock(day);
  if (block) entries.push({ block, start: block.start, end: block.end });
  return entries.sort((a, b) => a.start - b.start || a.end - b.end);
}

function search(q) {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return DATA.items.filter((it) => terms.every((t) => it.search.includes(t)
    || (it.board && it.board.replace("-", "").toLowerCase().endsWith(t.replace("-", "")))));
}

function itemsForPerson(person) {
  const map = new Map();
  for (const a of person.appearances) {
    const id = DATA.parentOf.get(a.itemId) || a.itemId;
    let role = a.role;
    if (id !== a.itemId) role = `${a.role}, ${time(DATA.byId.get(a.itemId).start)} talk`;
    const e = map.get(id) || { roles: [], lead: false };
    if (!e.roles.includes(role)) e.roles.push(role);
    e.lead ||= a.lead;
    map.set(id, e);
  }
  return [...map].map(([id, e]) => ({ item: DATA.byId.get(id), ...e }))
    .sort((a, b) => a.item.start - b.item.start || boardNum(a.item) - boardNum(b.item));
}

// ---------- icons ----------
const ICON = {
  pin: '<svg viewBox="0 0 16 16"><path d="M8 15s5-4.6 5-8.5A5 5 0 0 0 3 6.5C3 10.4 8 15 8 15z"/><circle cx="8" cy="6.5" r="1.8"/></svg>',
  screen: '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="9" rx="1.5"/><path d="M5.5 14h5"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 26 26"><circle cx="13" cy="13" r="11"/><path d="M8.5 13.5l3 3 6-6.5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mic: '<svg viewBox="0 0 12 12"><rect x="3.8" y="0.5" width="4.4" height="7" rx="2.2"/><path d="M2 5.5a4 4 0 0 0 8 0" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6 9.5v2" stroke="currentColor" stroke-width="1.2"/></svg>',
  search: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" stroke-linejoin="round"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 15V3M8 7l4-4 4 4M5 12v8h14v-8"/></svg>',
};

// ---------- row templates ----------
function siteBadge(site) { return site ? `<span class="site site-${site}" title="Mayo ${SITE_LABEL[site]}">${site}</span>` : ""; }

function liveTag(start, end, t = now()) {
  if (start <= t && t < end) return '<span class="tag-now">NOW</span>';
  if (end <= t) return '<span class="tag-ended">ENDED</span>';
  return "";
}

function starBtn(id) {
  const on = starred.has(id);
  return `<button class="star" data-star="${id}" aria-pressed="${on}" aria-label="${on ? "Remove from" : "Add to"} My Schedule">${ICON.star}</button>`;
}
function checkBtn(id) {
  const on = visited.has(id);
  return `<button class="check" data-visit="${id}" aria-pressed="${on}" aria-label="${on ? "Visited" : "Mark visited"}">${ICON.check}</button>`;
}

function timeCol(it) {
  return `<div class="time"><div class="t">${hm(it.start)}</div><div class="ap">${ampm(it.start)}</div><div class="e">–${hm(it.end)}</div></div>`;
}
function boardBadge(it) {
  return `<div class="board ${it.kind === "virtualPoster" ? "virtual" : ""}"><small>P-</small><b>${esc((it.board || "").replace("P-", ""))}</b></div>`;
}

function namesLine(it, limit = 4) {
  const shown = it.mayo.slice(0, limit).map((p) => (p.lead ? `<b>${esc(p.name)}</b>` : esc(p.name))).join(", ");
  return `<div class="names">${shown}${it.mayo.length > limit ? ` +${it.mayo.length - limit}` : ""}</div>`;
}

function callouts(it) {
  return (DATA.children.get(it.id) || []).map((c) =>
    `<div class="callout">${ICON.mic}<div><b>Mayo talk ${range(c.start, c.end)}</b>${esc(c.mayo.map((p) => p.name).join(", "))}</div></div>`).join("");
}

function itemRow(it, { showDay = false, caption = null, t = now() } = {}) {
  const left = it.kind === "talk" ? timeCol(it) : boardBadge(it);
  const kids = DATA.children.get(it.id) || [];
  const covered = kids.length && it.mayo.every((p) => kids.some((c) => c.mayo.some((m) => m.personId === p.personId)));
  const where = showDay ? `${shortDay(it.day)} ${range(it.start, it.end)} · ${it.room}` : it.room;
  return `<div class="row ${it.end <= t && !showDay ? "ended" : ""}">
    <a class="row-main" href="#/item/${it.id}">
      ${left}
      <div class="row-body">
        <div class="kicker ${kickerClass(it)}">${esc(typeLabel(it))} ${liveTag(it.start, it.end, t)}</div>
        <div class="title">${esc(it.title)}</div>
        <div class="where">${it.kind === "virtualPoster" ? ICON.screen : ICON.pin}${esc(where)}</div>
        ${callouts(it)}
        ${caption ? `<div class="caption">${esc(caption)}</div>` : covered ? "" : namesLine(it)}
      </div>
    </a>
    ${starBtn(it.id)}
  </div>`;
}

function posterRow(it) {
  const p = it.roles.find((r) => r.role !== "Co-authors")?.people[0];
  return `<div class="row">
    ${checkBtn(it.id)}
    <a class="row-main" href="#/item/${it.id}">
      ${boardBadge(it)}
      <div class="row-body">
        <div class="title">${esc(it.title)}</div>
        ${p ? `<div class="names"><b>${esc(p.name)}</b>${p.site ? siteBadge(p.site) : p.affiliation ? ` · ${esc(p.affiliation)}` : ""}</div>` : ""}
        ${it.category ? `<div class="names">${esc(titleCase(it.category))}</div>` : ""}
      </div>
    </a>
    ${starBtn(it.id)}
  </div>`;
}

function blockRow(b, t = now()) {
  const done = b.hall.filter((p) => visited.has(p.id)).length;
  const stars = b.posters.filter((p) => starred.has(p.id)).map((p) => p.board);
  return `<div class="row ${b.end <= t ? "ended" : ""}">
    <a class="row-main" href="#/posters/${b.day}/from-schedule">
      <div class="time"><div class="t">${hm(b.start)}</div><div class="ap">${ampm(b.start)}</div><div class="e">–${hm(b.end)}</div></div>
      <div class="row-body">
        <div class="kicker k-poster">Poster session ${liveTag(b.start, b.end, t)}</div>
        <div class="title">${b.hall.length} Mayo posters${b.virtual.length ? ` <span style="font-weight:400;color:var(--text2)">(+${b.virtual.length} virtual)</span>` : ""}</div>
        <div class="where">${ICON.pin}${esc(b.room)}</div>
        <div class="prog-row"><div class="progress"><i style="width:${(100 * done) / Math.max(b.hall.length, 1)}%"></i></div>${done}/${b.hall.length} visited</div>
        ${stars.length ? `<div class="names">★ ${stars.join(", ")}</div>` : ""}
      </div>
    </a>
    <span class="chev">›</span>
  </div>`;
}

function personRow(p) {
  const its = itemsForPerson(p).map((e) => e.item);
  const talks = its.filter((i) => i.kind === "talk").length, posters = its.length - talks;
  const sub = [talks && `${talks} talk${talks > 1 ? "s" : ""}`, posters && `${posters} poster${posters > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
  const presenting = p.appearances.some((a) => a.lead);
  return `<a class="prow" href="#/person/${p.id}">
    <div class="n"><div style="font-weight:${presenting ? 600 : 400}">${esc(p.sortName)}${siteBadge(p.site)}</div><div class="sub">${sub}</div></div>
    ${presenting ? `<svg class="mic" viewBox="0 0 12 12" aria-label="Presenting">${ICON.mic.replace(/^<svg[^>]*>|<\/svg>$/g, "")}</svg>` : ""}
    <span class="chev" style="color:var(--text3);font-size:20px">›</span>
  </a>`;
}

const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bId\b/g, "ID").replace(/\bOpat\b/g, "OPAT").replace(/\bHiv\b/g, "HIV").replace(/\bCns\b/g, "CNS").replace(/\bMdr-Gnr\b/g, "MDR-GNR");

// ---------- views ----------
const ui = { day: null, posterDay: null, query: "", peopleQuery: "", site: null, hideVisited: store.get("hideVisited", false) };

function setChrome({ title, back = false, right = "", tab }) {
  $("#title").textContent = title;
  $("#back").hidden = !back;
  $("#topbar-right").innerHTML = right;
  document.title = title === "Mayo @ IDWeek" ? "Mayo IDWeek" : `${title} · Mayo IDWeek`;
  for (const a of document.querySelectorAll(".tabbar a")) {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
}

function defaultDay() {
  const t = dayKey(now());
  return DATA.days.includes(t) ? t : DATA.days[0];
}

function viewSchedule(day) {
  ui.day = day || ui.day || defaultDay();
  const today = dayKey(now());
  const isMeeting = DATA.days.includes(today);
  setChrome({ title: "Mayo @ IDWeek", tab: "schedule",
    right: isMeeting ? `<button class="pill-btn" data-action="today">Today</button>` : "" });
  const dayBtns = DATA.days.map((d) => `<a class="day" href="#/schedule/${d}" aria-current="${d === ui.day}">
      ${d === today ? '<span class="today-dot" aria-label="Today"></span>' : ""}
      <span class="dw">${shortDay(d).toUpperCase()}</span><span class="dn">${dayNum(d)}</span><span class="dc">${DATA.items.filter((i) => i.day === d).length}</span></a>`).join("");
  return `<div class="subbar">
      <label class="search">${ICON.search}<input id="q" type="search" placeholder="Title, name, board # or room" value="${esc(ui.query)}" autocomplete="off" enterkeyhint="search"><button class="clear" data-action="clear" ${ui.query ? "" : "hidden"} aria-label="Clear">✕</button></label>
      <div class="days" ${ui.query ? "hidden" : ""}>${dayBtns}</div>
    </div>
    <div class="page" id="sched">${ui.query ? searchResults(ui.query) : dayList(ui.day)}</div>`;
}

function dayList(day) {
  const t = now();
  const entries = schedule(day);
  const isToday = day === dayKey(t);
  const markerAt = isToday ? (entries.findIndex((e) => e.start > t) + 1 || entries.length + 1) - 1 : -1;
  const nowLine = (next) => {
    let nx = "nothing else today";
    if (next) { const m = Math.ceil((next - t) / 60000); nx = m < 60 ? `next in ${Math.max(m, 1)} min` : `next at ${time(next)}`; }
    return `</div><div class="now-line" id="now-line"><span class="dot"></span><span class="lbl">Now ${time(t)}</span><span class="bar"></span><span class="nx">${nx}</span></div><div class="card">`;
  };
  let html = `<div class="section-head"><span>${dayTitle(day)}</span><span class="r">All times ET</span></div><div class="card">`;
  entries.forEach((e, i) => {
    if (i === markerAt) html += nowLine(e.start);
    html += e.item ? itemRow(e.item, { t }) : blockRow(e.block, t);
  });
  if (markerAt === entries.length && entries.length) html += nowLine(null);
  html += "</div>";
  html = html.replace(/<div class="card"><\/div>/g, "");
  if (day === DATA.days[0] || day === DATA.days[1]) html += `<p class="section-foot">Tuesday–Wednesday items are pre-meeting workshops (separate registration).</p>`;
  return html;
}

function searchResults(q) {
  const res = search(q);
  const fq = fold(q);
  const ppl = DATA.people.filter((p) => fold(p.name).includes(fq) || fold(p.sortName).includes(fq)).slice(0, 8);
  if (!res.length && !ppl.length) return `<div class="empty"><h3>No results for “${esc(q)}”</h3>Try a last name, a board number like 614, or a topic.</div>`;
  let html = "";
  if (ppl.length) html += `<div class="section-head">Mayo people</div><div class="card">${ppl.map(personRow).join("")}</div>`;
  for (const d of DATA.days) {
    const r = res.filter((i) => i.day === d);
    if (r.length) html += `<div class="section-head">${dayTitle(d)}</div><div class="card">${r.map((i) => itemRow(i, { showDay: i.kind !== "talk" })).join("")}</div>`;
  }
  return html;
}

function viewPosters(day, fromSchedule) {
  const today = dayKey(now());
  ui.posterDay = day || ui.posterDay || (DATA.posterDays.includes(today) ? today : DATA.posterDays[0]);
  day = ui.posterDay;
  const b = posterBlock(day);
  setChrome({ title: fromSchedule ? `Posters · ${shortDay(day)}` : "Mayo Posters", back: !!fromSchedule, tab: "posters",
    right: `<button class="pill-btn" data-action="hide-visited">${ui.hideVisited ? "Show all" : "Hide visited"}</button>` });
  const done = b.hall.filter((p) => visited.has(p.id)).length;
  const filt = (list) => (ui.hideVisited ? list.filter((p) => !visited.has(p.id)) : list);
  const q = ui.posterQuery || "";
  const matches = q ? new Set(search(q).map((i) => i.id)) : null;
  const pick = (list) => filt(list).filter((p) => !matches || matches.has(p.id));
  const hall = pick(b.hall), virt = pick(b.virtual);
  return `<div class="subbar">
      <label class="search">${ICON.search}<input id="pq" type="search" placeholder="Board #, title, name, topic" value="${esc(q)}" autocomplete="off"></label>
      <div class="seg">${DATA.posterDays.map((d) => `<a href="#/posters/${d}${fromSchedule ? "/from-schedule" : ""}" aria-current="${d === day}">${shortDay(d)} ${dayNum(d)}</a>`).join("")}</div>
    </div>
    <div class="page" id="plist">
      <div class="section-head"></div>
      <div class="card pad">
        <div style="font-weight:600">${dayTitle(day)} · ${range(b.start, b.end)}</div>
        <div class="where" style="margin-top:4px">${ICON.pin}${esc(b.room)}</div>
        <div class="prog-row" style="margin-top:8px">${done} of ${b.hall.length} visited</div>
        <div class="progress wide"><i style="width:${(100 * done) / Math.max(b.hall.length, 1)}%"></i></div>
      </div>
      ${hall.length ? `<div class="section-head">In the hall · board order</div><div class="card">${hall.map(posterRow).join("")}</div>
        <p class="section-foot">Tap the circle to check off a poster as you visit it.</p>` : ""}
      ${virt.length ? `<div class="section-head">Virtual · online only</div><div class="card">${virt.map(posterRow).join("")}</div>
        <p class="section-foot">View virtual posters in the IDWeek app or website.</p>` : ""}
      ${!hall.length && !virt.length ? `<div class="empty">${q ? `No posters match “${esc(q)}”.` : "All visited. Nice work."}</div>` : ""}
    </div>`;
}

function viewPeople() {
  setChrome({ title: "Mayo People", tab: "people" });
  return `<div class="subbar">
      <label class="search">${ICON.search}<input id="peopleq" type="search" placeholder="Find a colleague" value="${esc(ui.peopleQuery)}" autocomplete="off"></label>
      <div class="chips">${[null, "RST", "AZ", "FL", "MCHS"].map((s) => `<button class="chip" data-site="${s || ""}" aria-pressed="${ui.site === s}">${s ? SITE_LABEL[s] : "All sites"}</button>`).join("")}</div>
    </div>
    <div class="page" id="plist2">${peopleList()}</div>`;
}

function peopleList() {
  const q = fold(ui.peopleQuery);
  const ppl = DATA.people.filter((p) => (!ui.site || p.site === ui.site) && (!q || fold(p.name).includes(q) || fold(p.sortName).includes(q)));
  if (!ppl.length) return `<div class="empty">No one matches “${esc(ui.peopleQuery)}”.</div>`;
  const groups = new Map();
  for (const p of ppl) { const l = p.lastName[0].toUpperCase(); (groups.get(l) || groups.set(l, []).get(l)).push(p); }
  return [...groups].map(([l, ps]) => `<div class="section-head">${l}</div><div class="card">${ps.map(personRow).join("")}</div>`).join("")
    + `<p class="footer-note">${ppl.length} of ${DATA.people.length} Mayo presenters & co-authors. Bold = presenting, speaking or moderating.</p>`;
}

function viewMine() {
  setChrome({ title: "My Schedule", tab: "mine" });
  const mine = DATA.items.filter((i) => starred.has(i.id));
  const subscribe = `webcal://${location.host}${location.pathname.replace(/[^/]*$/, "")}${CAL_ALL}`;
  let html = `<div class="page">
    <div class="section-head">Reminders</div>
    <div class="card pad">
      <div class="info">${ICON.bell}<div><h3>Get alerts on your phone</h3>
        <p>Subscribe to the Mayo calendar: every Mayo session and daily poster session, with an alert 10 minutes before. It updates if rooms change.</p></div></div>
      <a class="btn" href="${esc(subscribe)}">Subscribe to all Mayo sessions</a>
      <a class="btn secondary" href="${CAL_ALL}" download>Download calendar file instead</a>
      <p class="section-foot" style="margin:10px 0 0">Prefer just your picks? Open any session and tap <b>Add to Calendar</b>.</p>
    </div>`;
  if (!mine.length) {
    html += `<div class="empty"><h3>Nothing starred yet</h3>Tap ☆ on any talk or poster to add it here.</div>`;
  } else {
    for (const d of DATA.days) {
      const di = mine.filter((i) => i.day === d);
      if (!di.length) continue;
      html += `<div class="section-head">${dayTitle(d)}</div><div class="card">${di.map((it) => itemRow(it, { showDay: it.kind !== "talk", caption: conflict(it, di) })).join("")}</div>`;
    }
  }
  return html + `</div>`;
}

function conflict(it, list) {
  const c = list.filter((o) => o.id !== it.id && o.start < it.end && it.start < o.end && !(o.kind !== "talk" && it.kind !== "talk"));
  if (!c.length) return null;
  return `⚠︎ Overlaps ${c[0].board || `${time(c[0].start)} in ${c[0].room}`}${c.length > 1 ? ` +${c.length - 1}` : ""}`;
}

function viewItem(id) {
  let it = DATA.byId.get(id);
  if (!it) return notFound();
  if (DATA.parentOf.has(id)) it = DATA.byId.get(DATA.parentOf.get(id));
  setChrome({ title: it.board || time(it.start), back: true, tab: it.kind === "talk" ? "schedule" : "posters", right: starBtn(it.id) });
  const kids = DATA.children.get(it.id) || [];
  const person = (p, lead) => {
    const inner = `<span>${esc(p.name)}</span>${siteBadge(p.site)}${p.affiliation ? `<span class="aff">${esc(p.affiliation)}</span>` : ""}`;
    const cls = p.site ? (lead ? "person mayo lead" : "person mayo") : "person other";
    return p.site && DATA.peopleById.has(p.personId) ? `<a class="${cls}" href="#/person/${p.personId}">${inner}<span class="chev">›</span></a>` : `<div class="${cls}">${inner}</div>`;
  };
  return `<div class="page">
    <div class="section-head"></div>
    <div class="card">
      <div class="detail-head">
        <div class="kicker ${kickerClass(it)}">${esc(typeLabel(it))} ${it.board ? `<span style="color:var(--purple)">${it.board}</span>` : ""} ${liveTag(it.start, it.end)}</div>
        <h2>${esc(it.title)}</h2>
        ${it.category ? `<div class="cat">${esc(titleCase(it.category))}</div>` : ""}
      </div>
      <div class="kv"><span class="k">When</span><span class="v">${dayTitle(it.day)}<br>${range(it.start, it.end)} ET</span></div>
      <div class="kv"><span class="k">Where</span><span class="v">${esc(it.room)}${it.board && it.kind === "poster" ? `, board ${it.board}` : ""}</span></div>
      ${it.session && !kids.length ? `<div class="kv"><span class="k">Session</span><span class="v">${esc(it.session)}</span></div>` : ""}
      ${it.kind === "poster" ? `<div class="note">All poster sessions run 12:15–1:30 PM. Find the poster by its board number.</div>` : ""}
      ${it.note ? `<div class="note">ⓘ ${esc(it.note)}</div>` : ""}
    </div>
    ${kids.length ? `<div class="section-head">Mayo talk in this session</div><div class="card">${kids.map((c) => `<div class="mayo-talk">
        <div class="when">${range(c.start, c.end)} ET</div><div class="t">${esc(c.title)}</div>
        ${c.mayo.map((p) => person(p, true)).join("")}</div>`).join("")}</div>` : ""}
    ${it.roles.map((r) => `<div class="section-head">${esc(r.role)}</div><div class="card">
        ${r.people.map((p) => person(p, r.role !== "Co-authors")).join("")}
        ${r.additional ? `<div class="more">+ ${r.additional} more (non-Mayo)</div>` : ""}</div>`).join("")}
    <div class="section-head"></div>
    <div class="card">
      <button class="action" data-star="${it.id}">${ICON.star}${starred.has(it.id) ? "Remove from My Schedule" : "Add to My Schedule"}</button>
      ${it.kind === "poster" ? `<button class="action" data-visit="${it.id}">${ICON.check}${visited.has(it.id) ? "Visited ✓ (tap to undo)" : "Mark as visited"}</button>` : ""}
      <a class="action" href="ics/${it.id}.ics">${ICON.cal}Add to Calendar (10-min alert)</a>
      ${it.url ? `<a class="action" href="${esc(it.url)}" target="_blank" rel="noopener">${ICON.link}Open in IDWeek planner</a>` : ""}
      <button class="action" data-share="${it.id}">${ICON.share}Share</button>
    </div>
    <p class="section-foot">Rooms and times can change. Check the IDWeek app before you go.</p>
  </div>`;
}

function viewPerson(id) {
  const p = DATA.peopleById.get(id);
  if (!p) return notFound();
  setChrome({ title: p.lastName, back: true, tab: "people" });
  const entries = itemsForPerson(p);
  const allOn = entries.every((e) => starred.has(e.item.id));
  let html = `<div class="page"><div class="section-head"></div><div class="card">
      <div class="person-head"><h2>${esc(p.name)}</h2><span class="site site-${p.site}" style="margin:0">${SITE_LABEL[p.site]}</span></div>
      ${entries.length > 1 ? `<button class="action" data-star-all="${id}">${ICON.star}${allOn ? "Unstar" : "Star"} all of ${esc(p.name.split(" ")[0])}'s items</button>` : ""}
    </div>`;
  for (const d of DATA.days) {
    const de = entries.filter((e) => e.item.day === d);
    if (de.length) html += `<div class="section-head">${dayTitle(d)}</div><div class="card">${de.map((e) => itemRow(e.item, { showDay: e.item.kind !== "talk", caption: e.roles.join(", ") })).join("")}</div>`;
  }
  return html + "</div>";
}

function notFound() {
  setChrome({ title: "Not found", back: true });
  return `<div class="empty"><h3>Not found</h3><a href="#/schedule" style="color:var(--accent)">Back to the schedule</a></div>`;
}

// ---------- router ----------
let lastRoute = "";
function render({ keepScroll = false } = {}) {
  const [, section = "schedule", arg, extra] = location.hash.replace(/^#/, "").split("/");
  const route = `${section}/${arg || ""}`;
  const routeChanged = route !== lastRoute;
  const scrollY = window.scrollY;
  let html;
  switch (section) {
    case "posters": html = viewPosters(arg, extra === "from-schedule"); break;
    case "people": html = viewPeople(); break;
    case "mine": html = viewMine(); break;
    case "item": html = viewItem(arg); break;
    case "person": html = viewPerson(arg); break;
    default: html = viewSchedule(arg);
  }
  $("#view").innerHTML = html;
  lastRoute = route;
  if (keepScroll) window.scrollTo(0, scrollY);
  else if (routeChanged) {
    window.scrollTo(0, 0);
    if (section === "schedule" && !ui.query) requestAnimationFrame(() => $("#now-line")?.scrollIntoView({ block: "center" }));
  }
}

function updateBadge() {
  const b = $("#mine-badge");
  const n = DATA ? DATA.items.filter((i) => starred.has(i.id)).length : 0;
  b.hidden = !n; b.textContent = n;
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg; document.body.append(t);
  setTimeout(() => t.remove(), 1800);
}

// Re-render just the list parts on input so the keyboard keeps focus.
document.addEventListener("input", (e) => {
  if (e.target.id === "q") {
    ui.query = e.target.value;
    $("#sched").innerHTML = ui.query ? searchResults(ui.query) : dayList(ui.day);
    $(".days").hidden = !!ui.query;
    $(".search .clear").hidden = !ui.query;
  } else if (e.target.id === "pq") {
    ui.posterQuery = e.target.value;
    const pos = e.target.selectionStart;
    render({ keepScroll: true });
    const input = $("#pq"); input.focus(); input.setSelectionRange(pos, pos);
  } else if (e.target.id === "peopleq") {
    ui.peopleQuery = e.target.value;
    $("#plist2").innerHTML = peopleList();
  }
});

document.addEventListener("click", (e) => {
  const star = e.target.closest("[data-star]");
  if (star) {
    e.preventDefault();
    const id = star.dataset.star;
    starred.has(id) ? starred.delete(id) : starred.add(id);
    saveSets(); render({ keepScroll: true });
    if (starred.has(id)) toast("Added to My Schedule");
    return;
  }
  const visit = e.target.closest("[data-visit]");
  if (visit) {
    e.preventDefault();
    const id = visit.dataset.visit;
    visited.has(id) ? visited.delete(id) : visited.add(id);
    saveSets(); render({ keepScroll: true });
    return;
  }
  const all = e.target.closest("[data-star-all]");
  if (all) {
    const ids = itemsForPerson(DATA.peopleById.get(all.dataset.starAll)).map((x) => x.item.id);
    const on = ids.every((id) => starred.has(id));
    ids.forEach((id) => (on ? starred.delete(id) : starred.add(id)));
    saveSets(); render({ keepScroll: true });
    return;
  }
  const site = e.target.closest("[data-site]");
  if (site) { ui.site = site.dataset.site || null; render({ keepScroll: true }); return; }
  const share = e.target.closest("[data-share]");
  if (share) {
    const it = DATA.byId.get(share.dataset.share);
    const url = `${location.origin}${location.pathname}#/item/${it.id}`;
    const text = `${it.title}\n${dayTitle(it.day)} ${range(it.start, it.end)} ET · ${it.board ? `${it.board}, ` : ""}${it.room}\nMayo: ${it.mayo.slice(0, 3).map((p) => p.name).join(", ")}`;
    if (navigator.share) navigator.share({ title: it.title, text, url }).catch(() => {});
    else navigator.clipboard?.writeText(`${text}\n${url}`).then(() => toast("Copied to clipboard"));
    return;
  }
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action === "today") {
    ui.query = "";
    const t = dayKey(now());
    if (location.hash === `#/schedule/${t}` || (ui.day === t && !location.hash.startsWith("#/schedule/"))) {
      render({ keepScroll: true }); $("#now-line")?.scrollIntoView({ block: "center", behavior: "smooth" });
    } else location.hash = `#/schedule/${t}`;
  } else if (action === "clear") {
    ui.query = ""; render();
  } else if (action === "hide-visited") {
    ui.hideVisited = !ui.hideVisited; store.set("hideVisited", ui.hideVisited); render({ keepScroll: true });
  }
});

$("#back").addEventListener("click", () => (history.length > 1 ? history.back() : (location.hash = "#/schedule")));
window.addEventListener("hashchange", () => render());

// Keep the now line and NOW/ENDED tags current.
setInterval(() => {
  const active = document.activeElement;
  if (active && active.tagName === "INPUT") return;
  if (location.hash.startsWith("#/item") || location.hash.startsWith("#/person")) return;
  render({ keepScroll: true });
}, 30000);

fetch("sessions.json")
  .then((r) => r.json())
  .then((raw) => { DATA = prepare(raw); updateBadge(); render(); })
  .catch(() => { $("#view").innerHTML = `<div class="empty"><h3>Couldn't load the schedule</h3>Check your connection and reload.</div>`; });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
