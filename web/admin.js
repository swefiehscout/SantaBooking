// Team dashboard.
(function () {
  const { cfg, sb, toMin: rawMin, fromMin, clock, slotLabel, normPhone, waNumber, km, esc, mapsUrl, navUrl, parseMapsLink, isShortMapsLink, pinPicker } = window.Santa;
  const $ = (id) => document.getElementById(id);

  // Plain-language names for each status.
  const STATUS = { new: "To call", confirmed: "Confirmed", done: "Visited", cancelled: "Cancelled", waitlist: "Waitlist" };
  const ACTIVE = ["new", "confirmed", "done"];
  const PAY = { cash: "Cash", cliq: "CliQ", transfer: "Bank transfer" };

  const S = {
    me: "", tab: "bookings", settings: null, cars: [], areas: [], overrides: [], bookings: [], messages: [],
    search: "", filter: "all",
    log: null, logMore: false, logF: { q: "", kind: "all", who: "" },
    schedView: null, schedCar: null,   // null = pick by screen width
    moving: null,            // booking id being moved by tapping
    routeCar: null, donCar: null, printCar: null,
    map: null, pendingRender: false,
  };

  // ---------- Small helpers ----------
  // Minutes into the evening; times before 06:00 count as after midnight (12:30 AM -> 24:30).
  const toMin = (t) => { const m = rawMin(t); return m < 360 ? m + 1440 : m; };
  const hhmm = (v) => (v ? String(v).slice(0, 5) : "");
  const label = (slot) => slotLabel(slot, S.settings.slot_minutes);
  const shortTime = (slot) => clock(slot);
  const carById = (id) => S.cars.find((c) => c.id === id);
  const carName = (id) => carById(id)?.name || "No car";
  const areaById = (id) => S.areas.find((a) => a.id === id);
  const areaName = (id) => areaById(id)?.name_en || "—";
  const bookingById = (id) => S.bookings.find((b) => b.id === id);
  const activeCars = () => S.cars.filter((c) => c.active).sort((a, b) => a.sort - b.sort || a.id - b.id);
  // All timestamps are shown in Jordan time, whatever the viewer's device is set to.
  const TZ = "Asia/Amman";
  // "3:05 PM" (or "3:05:09 PM") in Jordan time.
  const timeJo = (iso, sec) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", ...(sec ? { second: "2-digit" } : {}), hour12: true });
  const dateTime = (iso) => `${new Date(iso).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short" })}, ${timeJo(iso)}`;
  const todayJo = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });   // 2026-12-24
  const jd = (n) => `${Number(n || 0).toLocaleString("en-GB", { maximumFractionDigits: 2 })} JD`;

  // A car's own hours (or the night's).
  const carStart = (c) => toMin(hhmm(c.start_time || S.settings.start_time));
  const carEnd = (c) => toMin(hhmm(c.end_time || S.settings.end_time));
  const carWorks = (c, slot) => toMin(slot) >= carStart(c) && toMin(slot) + S.settings.slot_minutes <= carEnd(c);
  const hasOwnHours = (c) => !!(c.start_time || c.end_time);
  // Every time slot of the night, widened by any car with longer hours.
  function slots() {
    const s = S.settings, cars = activeCars(), out = [];
    const a = Math.min(toMin(s.start_time), ...cars.map(carStart));
    const z = Math.max(toMin(s.end_time), ...cars.map(carEnd));
    for (let m = a; m + s.slot_minutes <= z; m += s.slot_minutes) out.push(fromMin(m));
    return out;
  }
  const override = (carId, slot) => S.overrides.find((o) => o.car_id === carId && hhmm(o.slot_time) === slot);
  function capacity(carId, slot) {
    const o = override(carId, slot), car = carById(carId);
    if (!car || !car.active || o?.blocked || !carWorks(car, slot)) return 0;
    return o?.capacity ?? S.settings.default_capacity;
  }
  const inCell = (carId, slot) =>
    S.bookings.filter((b) => b.car_id === carId && hhmm(b.slot_time) === slot && ACTIVE.includes(b.status));
  const freeIn = (carId, slot, ignoreId) => capacity(carId, slot) - inCell(carId, slot).filter((b) => b.id !== ignoreId).length;

  function point(b) {
    if (b.lat != null) return [b.lat, b.lng];
    const a = areaById(b.area_id);
    return a && a.lat != null ? [a.lat, a.lng] : [null, null];
  }
  function carCentre(carId) {
    const pts = S.areas.filter((a) => a.car_id === carId && a.lat != null);
    if (!pts.length) return [null, null];
    return [pts.reduce((s, a) => s + a.lat, 0) / pts.length, pts.reduce((s, a) => s + a.lng, 0) / pts.length];
  }
  // Same rule as the database: distance to the car's neighbouring stops, else to its zone.
  function carDistance(carId, slot, lat, lng, ignoreId) {
    const step = S.settings.slot_minutes;
    const near = [fromMin(toMin(slot) - step), fromMin(toMin(slot) + step)];
    const ds = S.bookings
      .filter((b) => b.id !== ignoreId && b.car_id === carId && ACTIVE.includes(b.status) && near.includes(hhmm(b.slot_time)))
      .map((b) => km(lat, lng, ...point(b))).filter((d) => d != null);
    return ds.length ? Math.min(...ds) : km(lat, lng, ...carCentre(carId));
  }
  // The website's rule: the area's own car if it's free. Anything else is for the team to assign.
  function pickCar(slot, areaId, ignoreId) {
    const a = areaById(areaId) || {};
    if (a.car_id && carById(a.car_id)?.active && freeIn(a.car_id, slot, ignoreId) > 0) return { car: carById(a.car_id), home: true };
    return null;
  }
  // For the team: the closest places to a wanted time, any car, home car first.
  function options(b, wanted, limit = 4) {
    const [lat, lng] = point(b);
    const home = areaById(b.area_id)?.car_id;
    const pref = toMin(wanted || hhmm(b.preferred_time) || slots()[0]);
    const out = [];
    for (const slot of slots().slice().sort((x, y) => Math.abs(toMin(x) - pref) - Math.abs(toMin(y) - pref))) {
      const best = activeCars().filter((c) => freeIn(c.id, slot, b.id) > 0)
        .map((c) => ({ car: c, slot, home: c.id === home, d: lat == null ? null : carDistance(c.id, slot, lat, lng, b.id) }))
        .sort((x, y) => (y.home - x.home) || ((x.d ?? 99) - (y.d ?? 99)))[0];
      if (best) out.push(best);
      if (out.length >= limit) break;
    }
    return out;
  }
  const optionText = (o) => `${o.car.name} at ${shortTime(o.slot)}${o.home ? " · their area's car" : o.d != null ? ` · ${o.d.toFixed(1)} km away` : ""}`;

  function route(carId) {
    return S.bookings.filter((b) => b.car_id === carId && ACTIVE.includes(b.status) && b.slot_time)
      .sort((a, b) => toMin(hhmm(a.slot_time)) - toMin(hhmm(b.slot_time)));
  }
  const hopLimit = () => Math.max(4, Number(S.settings.borrow_km) * 1.5);
  function hopBefore(b) {
    const r = route(b.car_id), i = r.findIndex((x) => x.id === b.id);
    return i > 0 ? km(...point(r[i - 1]), ...point(b)) : null;
  }

  function problems() {
    const list = [], set = new Set(slots());
    for (const b of S.bookings) {
      if (!ACTIVE.includes(b.status)) continue;
      if (b.lat == null || b.lng == null) list.push([b, "has no map pin"]);
      if (!b.car_id || !b.slot_time) list.push([b, "has no car or time"]);
      else if (!set.has(hhmm(b.slot_time)) || (carById(b.car_id) && !carWorks(carById(b.car_id), hhmm(b.slot_time)))) list.push([b, "is outside its car's hours"]);
      else if (!carById(b.car_id)?.active) list.push([b, "is on a car that's switched off"]);
      else if (override(b.car_id, hhmm(b.slot_time))?.blocked) list.push([b, "is on a blocked time"]);
    }
    for (const c of activeCars()) for (const s of slots()) {
      const n = inCell(c.id, s).length, cap = capacity(c.id, s);
      if (n > cap) list.push([inCell(c.id, s)[n - 1], `shares ${c.name} at ${shortTime(s)} (room for ${cap})`]);
    }
    return list;
  }

  // ---------- Toast with undo ----------
  let toastTimer, undoFn = null;
  function toast(msg, undo) {
    $("toast-text").textContent = msg;
    undoFn = undo || null;
    $("toast-undo").hidden = !undo;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $("toast").hidden = true; undoFn = null; }, undo ? 9000 : 3000);
  }
  $("toast-undo").onclick = async () => {
    const fn = undoFn; undoFn = null; $("toast").hidden = true;
    if (fn) { await fn(); toast("Undone"); }
  };

  // ---------- Data ----------
  async function loadAll() {
    const r = await Promise.all([
      sb.from("settings").select("*").eq("id", 1).single(),
      sb.from("cars").select("*").order("sort").order("id"),
      sb.from("areas").select("*").order("sort").order("name_en"),
      sb.from("slot_overrides").select("*"),
      sb.from("bookings").select("*").order("created_at"),
      sb.from("messages").select("*").order("created_at", { ascending: false }),
    ]);
    const bad = r.find((x) => x.error);
    if (bad) { console.error(bad.error); toast("Couldn't load data: " + bad.error.message); return false; }
    [S.settings, S.cars, S.areas, S.overrides, S.bookings, S.messages] = r.map((x) => x.data);
    return true;
  }
  async function reloadBookings() {
    const { data, error } = await sb.from("bookings").select("*").order("created_at");
    if (error) return;
    S.bookings = data;
    softRender();
  }
  // Don't redraw under someone who is typing.
  function softRender() {
    const a = document.activeElement;
    if (a && $("main").contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) { S.pendingRender = true; return; }
    render();
  }
  $("main").addEventListener("focusout", () => setTimeout(() => {
    if (S.pendingRender && !(document.activeElement && $("main").contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))) {
      S.pendingRender = false; render();
    }
  }, 50));

  async function update(b, patch, quiet) {
    patch = { ...patch, updated_by: S.me };
    const { error } = await sb.from("bookings").update(patch).eq("id", b.id);
    if (error) { toast("Not saved: " + error.message); return false; }
    Object.assign(b, patch);
    if (!quiet) toast("Saved");
    render();
    return true;
  }

  // Move a family to a car + time, with undo.
  async function moveTo(b, carId, slot) {
    const free = freeIn(carId, slot, b.id);
    if (override(carId, slot)?.blocked && !confirm(`${carName(carId)} is blocked at ${shortTime(slot)}. Put ${b.name} there anyway?`)) return;
    if (free <= 0 && !override(carId, slot)?.blocked && !confirm(`${carName(carId)} already has a visit at ${shortTime(slot)}. Put ${b.name} there too?`)) return;
    const before = { car_id: b.car_id, slot_time: b.slot_time, status: b.status };
    const patch = { car_id: carId, slot_time: slot };
    if (b.status === "waitlist" || b.status === "cancelled") patch.status = "new";
    S.moving = null;
    if (await update(b, patch, true)) toast(`${b.name} moved to ${carName(carId)} at ${shortTime(slot)}`, () => update(b, before, true));
  }
  async function swap(a, b) {
    const pa = { car_id: a.car_id, slot_time: a.slot_time }, pb = { car_id: b.car_id, slot_time: b.slot_time };
    S.moving = null;
    if (!(await update(a, pb, true))) return;
    if (!(await update(b, pa, true))) return;
    toast(`Swapped ${a.name} and ${b.name}`, async () => { await update(a, pa, true); await update(b, pb, true); });
  }
  async function setStatus(b, status) {
    const before = { status: b.status, car_id: b.car_id, slot_time: b.slot_time };
    const patch = { status };
    if (status === "waitlist") { patch.car_id = null; patch.slot_time = null; }
    if (await update(b, patch, true)) toast(`${b.name}: ${STATUS[status]}`, () => update(b, before, true));
  }
  async function setCarHours(car, patch) {
    const before = { start_time: car.start_time ?? null, end_time: car.end_time ?? null };
    const { error } = await sb.from("cars").update(patch).eq("id", car.id);
    if (error) return toast("Not saved: " + error.message);
    Object.assign(car, patch);
    render();
    toast(`${car.name} now works ${shortTime(fromMin(carStart(car)))} – ${shortTime(fromMin(carEnd(car)))}`, async () => {
      await sb.from("cars").update(before).eq("id", car.id); Object.assign(car, before); render();
    });
  }
  async function setOverride(carId, slot, patch) {
    const cur = override(carId, slot) || { car_id: carId, slot_time: slot, capacity: null, blocked: false };
    const row = { car_id: carId, slot_time: slot, capacity: cur.capacity, blocked: cur.blocked, ...patch };
    const { error } = await sb.from("slot_overrides").upsert(row);
    if (error) return toast("Not saved: " + error.message);
    S.overrides = S.overrides.filter((o) => !(o.car_id === carId && hhmm(o.slot_time) === slot)).concat([row]);
    render();
  }

  // ---------- Render ----------
  function render() {
    if (!S.settings) return;
    document.body.classList.toggle("moving", !!S.moving);
    document.querySelectorAll(".tab[data-tab]").forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === S.tab));
    const wait = S.bookings.filter((b) => b.status === "waitlist").length;
    document.querySelectorAll(".c-wait").forEach((el) => { el.textContent = wait; el.hidden = !wait; });
    const unread = S.messages.filter((m) => !m.handled).length;
    document.querySelectorAll(".c-msg").forEach((el) => { el.textContent = unread; el.hidden = !unread; });
    document.querySelectorAll(".bar-date").forEach((el) => (el.textContent = "Christmas Eve · " + new Date(S.settings.event_date + "T12:00:00")
      .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })));
    const more = document.querySelector("[data-more]");
    if (more) more.setAttribute("aria-selected", ["routes", "print", "messages", "setup"].includes(S.tab));
    if (S.tab === "activity" && !S.isOwner) S.tab = "bookings";
    if (S.map && S.tab !== "routes") { S.map.remove(); S.map = null; }
    const focusId = document.activeElement?.id;
    const scroll = document.querySelector(".grid-wrap")?.scrollTop;
    ({ bookings: viewBookings, schedule: viewSchedule, waitlist: viewWaitlist, routes: viewRoutes,
       donations: viewDonations, print: viewPrint, messages: viewMessages, setup: viewSetup, activity: viewActivity })[S.tab]();
    if (scroll != null && document.querySelector(".grid-wrap")) document.querySelector(".grid-wrap").scrollTop = scroll;
    if (focusId?.startsWith("keep-") && $(focusId)) { const el = $(focusId); el.focus(); el.setSelectionRange?.(el.value.length, el.value.length); }
  }
  const intro = (title, text) => `<div class="intro"><h2>${title}</h2><p>${text}</p></div>`;
  const carChips = (sel, attr) => `<div class="chips">${activeCars().map((c) =>
    `<button class="chip" ${attr}="${c.id}" aria-pressed="${c.id === sel}">${esc(c.name)}<span class="n">${route(c.id).length}</span></button>`).join("")}</div>`;
  const ensureCar = (key) => { if (!carById(S[key]) || !carById(S[key]).active) S[key] = activeCars()[0]?.id ?? null; return S[key]; };

  // ===== Bookings (home) =====
  function viewBookings() {
    const active = S.bookings.filter((b) => ACTIVE.includes(b.status));
    let cap = 0;
    for (const c of activeCars()) for (const s of slots()) cap += capacity(c.id, s);
    const pct = cap ? Math.round((active.length / cap) * 100) : 0;
    const count = (st) => S.bookings.filter((b) => b.status === st).length;
    const raised = S.bookings.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const probs = problems();

    const FILTERS = [["all", "All"], ["new", "To call"], ["confirmed", "Confirmed"], ["waitlist", "Waitlist"], ["done", "Visited"], ["cancelled", "Cancelled"]];
    const q = S.search.trim().toLowerCase();
    const list = S.bookings
      .filter((b) => S.filter === "all" ? b.status !== "cancelled" : b.status === S.filter)
      .filter((b) => !q || [b.ref, b.name, b.phone, b.email, areaName(b.area_id), carName(b.car_id)].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (a.slot_time ? toMin(hhmm(a.slot_time)) : 9999) - (b.slot_time ? toMin(hhmm(b.slot_time)) : 9999) || (a.car_id || 99) - (b.car_id || 99));

    $("main").innerHTML = `
      <div class="tiles">
        <button class="tile" data-go="schedule"><b>${active.length} <span class="muted" style="font-size:16px">of ${cap}</span></b><span>Visits booked</span><div class="bar-meter"><i style="width:${Math.min(100, pct)}%"></i></div></button>
        <button class="tile call" data-filter="new"><b>${count("new")}</b><span>Families to call and confirm</span></button>
        <button class="tile wait" data-go="waitlist"><b>${count("waitlist")}</b><span>Waiting for a place</span></button>
        <button class="tile money" data-go="donations"><b>${jd(raised)}</b><span>Donations recorded</span></button>
      </div>
      ${probs.length ? `<div class="panel" style="border-color:var(--call)"><h3>Please check ${probs.length === 1 ? "this booking" : `these ${probs.length} bookings`}</h3>
        ${probs.map(([b, why]) => `<div class="row"><button class="btn small" data-open="${b.id}">${esc(b.name)}</button><span class="muted">${esc(why)}</span></div>`).join("")}</div>` : ""}
      <input class="search" id="keep-search" type="search" placeholder="Find a family: name, phone, booking number or area" value="${esc(S.search)}" autocomplete="off">
      <div class="chips">${FILTERS.map(([k, t]) => `<button class="chip" data-filter="${k}" aria-pressed="${S.filter === k}">${t}<span class="n">${k === "all" ? S.bookings.filter((b) => b.status !== "cancelled").length : count(k)}</span></button>`).join("")}</div>
      <div class="list">${list.map(itemHtml).join("") || `<div class="empty">${q ? "No family matches your search." : "Nothing here yet."}</div>`}</div>`;

    $("keep-search").oninput = (e) => { S.search = e.target.value; render(); };
    wireCommon();
  }
  function itemHtml(b) {
    const when = b.slot_time
      ? `<b>${esc(shortTime(hhmm(b.slot_time)))}</b><span>${esc(carName(b.car_id))}</span>`
      : `<b class="muted">No time</b><span>wants ${esc(shortTime(hhmm(b.preferred_time)))}</span>`;
    const act = b.status === "new"
      ? `<button class="btn small good" data-confirm="${b.id}">Confirmed ✓</button>`
      : b.status === "waitlist" ? `<button class="btn small" data-go="waitlist">Find a place</button>` : "";
    return `<div class="item" data-open="${b.id}" role="button" tabindex="0">
      <div class="when">${when}</div>
      <div class="who"><b>${esc(b.name)}</b><div>${esc(areaName(b.area_id))} · <span class="num">${esc(b.phone)}</span> · ${esc(b.ref)}</div></div>
      <div class="act"><span class="pill ${b.status}">${STATUS[b.status]}</span>${b.amount ? `<span class="pill money">${jd(b.amount)}</span>` : ""}${act}</div>
    </div>`;
  }
  function wireCommon() {
    const m = $("main");
    m.querySelectorAll("[data-open]").forEach((el) => {
      el.onclick = (e) => { if (e.target.closest("[data-confirm],[data-go]")) return; openBooking(el.dataset.open); };
      el.onkeydown = (e) => { if (e.key === "Enter") openBooking(el.dataset.open); };
    });
    m.querySelectorAll("[data-confirm]").forEach((el) => (el.onclick = (e) => { e.stopPropagation(); setStatus(bookingById(el.dataset.confirm), "confirmed"); }));
    m.querySelectorAll("[data-filter]").forEach((el) => (el.onclick = () => { S.filter = el.dataset.filter; S.tab = "bookings"; render(); }));
    m.querySelectorAll("[data-go]").forEach((el) => (el.onclick = (e) => { e.stopPropagation(); S.tab = el.dataset.go; render(); scrollTo(0, 0); }));
  }

  // ===== Schedule =====
  function viewSchedule() {
    if (!S.schedView) S.schedView = innerWidth < 820 ? "car" : "grid";
    const cars = activeCars(), sl = slots();
    const moving = S.moving && bookingById(S.moving);
    let html = intro("Schedule", "Each car's visits through the night. Drag a family to another spot, or drop them on another family to swap. On a phone: tap a family, then tap where they should go.");
    html += `<div class="row">
      <div class="chips"><button class="chip" data-view="grid" aria-pressed="${S.schedView === "grid"}">All cars</button><button class="chip" data-view="car" aria-pressed="${S.schedView === "car"}">One car</button></div>
      <div class="legend"><span><i style="background:var(--call-soft);border-left:3px solid var(--call)"></i>To call</span><span><i style="background:var(--ok-soft);border-left:3px solid var(--ok)"></i>Confirmed</span><span><i style="background:var(--done-soft);border-left:3px solid var(--done)"></i>Visited</span><span><i style="border:1px dashed #bbb"></i>Free</span><span><i style="background:#ebe6e2"></i>Blocked</span></div></div>`;
    if (moving) html += `<div class="moving-bar"><b>Moving ${esc(moving.name)}</b><span>Tap a green spot, or another family to swap.</span><button class="btn small" id="cancel-move">Cancel</button></div>`;

    const fam = (b) => {
      const hop = hopBefore(b);
      return `<button class="fam ${b.status}${S.moving === b.id ? " selected" : ""}" draggable="true" data-fam="${b.id}" title="${esc(b.name)} · ${STATUS[b.status]}">
        <b>${esc(b.name)}</b><span>${esc(areaName(b.area_id))}</span>${hop != null && hop > hopLimit() ? `<span class="far">${hop.toFixed(1)} km from last stop</span>` : ""}</button>`;
    };
    const cell = (c, s) => {
      const o = override(c.id, s), list = inCell(c.id, s), cap = capacity(c.id, s);
      const canDrop = moving && !o?.blocked && freeIn(c.id, s, moving.id) > 0 && !list.some((b) => b.id === moving.id);
      const cls = [o?.blocked ? "blocked" : "", list.length > cap ? "over" : "", canDrop ? "can-drop" : ""].join(" ");
      if (!carWorks(c, s) && !list.length) return { cls: "off", inner: `<div class="cellbox"><button class="slotbtn" data-cell="${c.id}|${s}" title="Outside ${esc(c.name)}'s hours">Not working</button></div>` };
      const spot = o?.blocked ? `<button class="slotbtn" data-cell="${c.id}|${s}">Blocked</button>`
        : list.length < cap ? `<button class="slotbtn" data-cell="${c.id}|${s}" aria-label="Free: ${esc(c.name)} at ${esc(shortTime(s))}">+</button>` : "";
      return { cls, inner: `<div class="cellbox">${list.map(fam).join("")}${spot}</div>` };
    };

    if (S.schedView === "grid") {
      html += `<div class="grid-wrap"><table class="grid"><thead><tr><th class="time">Time</th>${cars.map((c) =>
        `<th>${esc(c.name)}<small>${esc(c.driver || "No driver yet")} · ${route(c.id).length} visit${route(c.id).length === 1 ? "" : "s"}${hasOwnHours(c) ? ` · ${esc(shortTime(fromMin(carStart(c))))}–${esc(shortTime(fromMin(carEnd(c))))}` : ""}</small></th>`).join("")}</tr></thead><tbody>
        ${sl.map((s) => `<tr><th class="time num">${esc(shortTime(s))}</th>${cars.map((c) => {
          const x = cell(c, s); return `<td class="${x.cls}" data-car="${c.id}" data-slot="${s}">${x.inner}</td>`;
        }).join("")}</tr>`).join("")}</tbody></table></div>`;
    } else {
      const carId = ensureCar("schedCar");
      const c = carById(carId);
      html += carChips(carId, "data-schedcar");
      html += c ? `<div class="carlist">${sl.map((s) => {
        const x = cell(c, s);
        return `<div class="carrow"><div class="t">${esc(label(s))}</div><table style="width:100%;border-spacing:0"><tr><td class="${x.cls}" data-car="${c.id}" data-slot="${s}" style="padding:0">${x.inner}</td></tr></table></div>`;
      }).join("")}</div>` : `<div class="empty">No cars are running. Switch one on in Setup.</div>`;
    }
    $("main").innerHTML = html;
    wireSchedule();
  }
  function wireSchedule() {
    const m = $("main");
    m.querySelectorAll("[data-view]").forEach((el) => (el.onclick = () => { S.schedView = el.dataset.view; render(); }));
    m.querySelectorAll("[data-schedcar]").forEach((el) => (el.onclick = () => { S.schedCar = Number(el.dataset.schedcar); render(); }));
    if ($("cancel-move")) $("cancel-move").onclick = () => { S.moving = null; render(); };
    m.querySelectorAll(".fam").forEach((el) => {
      el.onclick = () => {
        const b = bookingById(el.dataset.fam);
        if (S.moving && S.moving !== b.id) return swap(bookingById(S.moving), b);
        if (S.moving === b.id) { S.moving = null; return render(); }
        famMenu(b);
      };
      el.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", el.dataset.fam); e.dataTransfer.effectAllowed = "move"; });
      el.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add("selected"); });
      el.addEventListener("dragleave", () => el.classList.remove("selected"));
      el.addEventListener("drop", (e) => {
        e.preventDefault(); e.stopPropagation(); el.classList.remove("selected");
        const a = bookingById(e.dataTransfer.getData("text/plain")), b = bookingById(el.dataset.fam);
        if (a && b && a.id !== b.id) swap(a, b);
      });
    });
    m.querySelectorAll("td[data-car]").forEach((td) => {
      td.addEventListener("dragover", (e) => { e.preventDefault(); td.classList.add("drag-over"); });
      td.addEventListener("dragleave", () => td.classList.remove("drag-over"));
      td.addEventListener("drop", (e) => {
        e.preventDefault(); td.classList.remove("drag-over");
        const b = bookingById(e.dataTransfer.getData("text/plain"));
        const carId = Number(td.dataset.car), slot = td.dataset.slot;
        if (b && !(b.car_id === carId && hhmm(b.slot_time) === slot)) moveTo(b, carId, slot);
      });
    });
    m.querySelectorAll("[data-cell]").forEach((el) => (el.onclick = () => {
      const [car, slot] = el.dataset.cell.split("|");
      if (S.moving) return moveTo(bookingById(S.moving), Number(car), slot);
      cellMenu(Number(car), slot);
    }));
  }
  function famMenu(b) {
    modal(`${esc(b.name)}`, `<div class="menu">
      <p class="muted" style="margin:0">${esc(carName(b.car_id))} · ${esc(label(hhmm(b.slot_time)))} · ${esc(areaName(b.area_id))} · <span class="pill ${b.status}">${STATUS[b.status]}</span></p>
      <button class="btn" id="m-move">Move or swap this family</button>
      <button class="btn" id="m-open">Open details</button>
      ${b.status === "new" ? `<button class="btn good" id="m-conf">Mark as confirmed</button>` : ""}
    </div>`, "", (close) => {
      $("m-move").onclick = () => { close(); S.moving = b.id; S.tab = "schedule"; render(); };
      $("m-open").onclick = () => { close(); openBooking(b.id); };
      if ($("m-conf")) $("m-conf").onclick = () => { close(); setStatus(b, "confirmed"); };
    });
  }
  function cellMenu(carId, slot) {
    const o = override(carId, slot), car = carById(carId);
    const cap = o?.capacity ?? S.settings.default_capacity;
    if (!carWorks(car, slot)) {
      const later = toMin(slot) >= carEnd(car);
      return modal(`${esc(car.name)} · ${esc(label(slot))}`, `<div class="menu">
        <p class="muted" style="margin:0">${esc(car.name)} works ${esc(shortTime(fromMin(carStart(car))))} – ${esc(shortTime(fromMin(carEnd(car))))}, so it has no visits at this time.</p>
        <button class="btn primary" id="c-ext">${later ? `Keep ${esc(car.name)} working until ${esc(shortTime(fromMin(toMin(slot) + S.settings.slot_minutes)))}` : `Start ${esc(car.name)} at ${esc(shortTime(slot))}`}</button>
      </div>`, "", (close) => {
        $("c-ext").onclick = () => { close(); setCarHours(car, later ? { end_time: fromMin(toMin(slot) + S.settings.slot_minutes) } : { start_time: slot }); };
      });
    }
    modal(`${esc(carName(carId))} · ${esc(label(slot))}`, `<div class="menu">
      ${o?.blocked ? "" : `<button class="btn primary" id="c-add">Add a booking here</button>`}
      <button class="btn" id="c-block">${o?.blocked ? "Unblock this time" : "Block this time (no visits)"}</button>
      <label class="f"><span>How many visits can this car do at this time?</span>
        <div class="row"><input type="number" min="0" id="c-cap" value="${cap}" style="width:100px"><button class="btn" id="c-cap-save">Save</button></div></label>
    </div>`, "", (close) => {
      if ($("c-add")) $("c-add").onclick = () => { close(); quickAdd({ car: carId, slot }); };
      $("c-block").onclick = () => { close(); setOverride(carId, slot, { blocked: !o?.blocked }); };
      $("c-cap-save").onclick = () => {
        const v = Number($("c-cap").value);
        if (isNaN(v) || v < 0) return;
        close(); setOverride(carId, slot, { capacity: v === S.settings.default_capacity ? null : v });
      };
    });
  }

  // ===== Waitlist =====
  // How far a car would be from this family at a time, and from what (its stop before/after, or its area).
  function distanceInfo(carId, slot, b) {
    const [lat, lng] = point(b);
    if (lat == null) return null;
    const step = S.settings.slot_minutes;
    const near = S.bookings
      .filter((x) => x.id !== b.id && x.car_id === carId && ACTIVE.includes(x.status) &&
        [fromMin(toMin(slot) - step), fromMin(toMin(slot) + step)].includes(hhmm(x.slot_time)))
      .map((x) => ({ d: km(lat, lng, ...point(x)), from: `its ${toMin(hhmm(x.slot_time)) < toMin(slot) ? "stop before" : "stop after"} (${areaName(x.area_id)})` }))
      .filter((x) => x.d != null).sort((x, y) => x.d - y.d)[0];
    if (near) return near;
    const d = km(lat, lng, ...carCentre(carId));
    if (d != null && d < 0.1) return { d, from: "its usual areas" };
    return d == null ? null : { d, from: "its usual areas" };
  }
  // Every free place within two hours of the wanted time, scored: closer in time and distance is better.
  function waitOptions(b) {
    const want = toMin(hhmm(b.preferred_time));
    const home = areaById(b.area_id)?.car_id;
    const out = [];
    for (const slot of slots()) {
      const diff = toMin(slot) - want;
      if (Math.abs(diff) > 120) continue;
      for (const c of activeCars()) {
        if (freeIn(c.id, slot, b.id) <= 0) continue;
        const info = distanceInfo(c.id, slot, b);
        const score = Math.abs(diff) / 30 + (info ? info.d / 2 : 1.5) + (c.id === home ? 0 : 0.5);
        out.push({ car: c, slot, diff, home: c.id === home, info, score });
      }
    }
    return out.sort((x, y) => x.score - y.score).slice(0, 5);
  }
  const diffText = (m) => m === 0 ? "Exact time" : `${Math.abs(m) >= 60 ? `${Math.floor(Math.abs(m) / 60)} h ` : ""}${Math.abs(m) % 60 ? `${Math.abs(m) % 60} min ` : ""}${m < 0 ? "earlier" : "later"}`.replace("  ", " ");
  const distClass = (d) => d == null ? "" : d <= 2 ? "near" : d <= 5 ? "mid" : "far";
  function reason(o) {
    const bits = [];
    bits.push(o.diff === 0 ? "at the exact time they asked for" : `${diffText(o.diff).toLowerCase()} than they asked`);
    if (o.home) bits.unshift("their own area's car");
    if (o.info) bits.push(o.info.d < 0.1 ? `same area as ${o.info.from}` : `${o.info.d.toFixed(1)} km from ${o.info.from}`);
    return bits.join(", ");
  }

  function viewWaitlist() {
    const list = S.bookings.filter((b) => b.status === "waitlist");
    const groups = {};
    for (const b of list) (groups[hhmm(b.preferred_time)] ||= []).push(b);
    const times = Object.keys(groups).sort((x, y) => toMin(x) - toMin(y));

    $("main").innerHTML = intro("Waitlist", "Families who asked for a time that was already full, grouped by the time they wanted. For each family, compare the free places and press <b>Place</b> on the one you choose. Then call them to check it suits them.") +
      (list.length ? `<div class="legend"><span><i class="dot near"></i>Under 2 km: easy</span><span><i class="dot mid"></i>2–5 km: fine</span><span><i class="dot far"></i>Over 5 km: long drive</span></div>` +
        times.map((t) => `<section class="wgroup"><h3>Wanted ${esc(label(t))} <span class="muted">· ${groups[t].length} famil${groups[t].length === 1 ? "y" : "ies"}</span></h3>
          ${groups[t].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map(waitCard).join("")}</section>`).join("")
        : `<div class="empty">Nobody is waiting. 🎉</div>`);
    wireCommon();
    $("main").querySelectorAll("[data-place]").forEach((el) => (el.onclick = () => {
      const [id, car, slot] = el.dataset.place.split("|");
      moveTo(bookingById(id), Number(car), slot);
    }));
    $("main").querySelectorAll("[data-remove]").forEach((el) => (el.onclick = () => setStatus(bookingById(el.dataset.remove), "cancelled")));
  }
  function waitCard(b) {
    const opts = waitOptions(b);
    const home = areaById(b.area_id)?.car_id;
    return `<div class="wcard">
      <div class="wtop">
        <div><b>${esc(b.name)}</b><div class="muted">${esc(areaName(b.area_id))}${home ? ` · their area's car is ${esc(carName(home))}` : ""}${b.lat == null ? " · no map pin" : ""}</div></div>
        <div class="row"><a class="btn small" href="tel:${esc(b.phone)}">Call ${esc(b.phone)}</a>
          ${waNumber(b.phone) ? `<a class="btn small" target="_blank" rel="noopener" href="https://wa.me/${waNumber(b.phone)}">WhatsApp</a>` : ""}
          <button class="btn small" data-open="${b.id}">Details</button></div>
      </div>
      <div class="muted" style="font-size:13px">Waiting since ${esc(dateTime(b.created_at))}</div>
      ${opts.length ? `
        <div class="rec"><span class="tag">Recommended</span> <b>${esc(opts[0].car.name)} at ${esc(shortTime(opts[0].slot))}</b><span class="muted">: ${esc(reason(opts[0]))}.</span></div>
        <div class="tbl-wrap"><table class="tbl opts"><thead><tr><th>Time</th><th>Compared to wanted</th><th>Car</th><th>Distance</th><th></th></tr></thead><tbody>
        ${opts.map((o, i) => `<tr class="${i === 0 ? "best" : ""}">
          <td class="num"><b>${esc(shortTime(o.slot))}</b></td>
          <td>${o.diff === 0 ? `<span class="pill confirmed">Exact time</span>` : esc(diffText(o.diff))}</td>
          <td>${esc(o.car.name)}${o.home ? ` <span class="pill confirmed">their car</span>` : ""}</td>
          <td>${o.info ? `<span class="dist ${distClass(o.info.d)}">${o.info.d < 0.1 ? "Same area" : o.info.d.toFixed(1) + " km"}</span> <span class="muted" style="font-size:13px">from ${esc(o.info.from)}</span>` : `<span class="muted">No location</span>`}</td>
          <td style="text-align:end"><button class="btn small ${i === 0 ? "good" : ""}" data-place="${b.id}|${o.car.id}|${o.slot}">Place</button></td></tr>`).join("")}
        </tbody></table></div>`
        : `<div class="note">No free place within two hours of ${esc(shortTime(hhmm(b.preferred_time)))}. Free a spot on the Schedule, or let a nearby car take an extra visit (tap an empty or full spot on the Schedule).</div>`}
      <div><button class="btn small danger" data-remove="${b.id}">Remove from waitlist</button></div>
    </div>`;
  }

  // ===== Route map =====
  function viewRoutes() {
    const carId = ensureCar("routeCar");
    const stops = carId ? route(carId) : [];
    const prevView = S.map && S.map._carId === carId ? { c: S.map.getCenter(), z: S.map.getZoom() } : null;
    if (S.map) { S.map.remove(); S.map = null; }
    $("main").innerHTML = intro("Route map", "One car's visits in order on the map. Orange distances mean a long drive between two stops. Press Move to put that family somewhere better.") +
      carChips(carId, "data-routecar") +
      `<div class="route-grid"><div id="route-map"></div><div class="panel">
        <h3>${esc(carName(carId))} · ${stops.length} visit${stops.length === 1 ? "" : "s"}</h3>
        ${stops.map((b, i) => {
          const d = i ? km(...point(stops[i - 1]), ...point(b)) : null;
          return `<div class="stop"><span class="no">${i + 1}</span>
            <div><b>${esc(shortTime(hhmm(b.slot_time)))} · ${esc(b.name)}</b><div class="hop ${d != null && d > hopLimit() ? "far" : ""}">${esc(areaName(b.area_id))}${d != null ? ` · ${d.toFixed(1)} km from stop ${i}` : ""}${b.lat == null ? " · no pin, using area centre" : ""}</div></div>
            <button class="btn small" data-moveit="${b.id}">Move</button></div>`;
        }).join("") || `<div class="empty">No visits for this car yet.</div>`}
      </div></div>`;
    $("main").querySelectorAll("[data-routecar]").forEach((el) => (el.onclick = () => { S.routeCar = Number(el.dataset.routecar); render(); }));
    $("main").querySelectorAll("[data-moveit]").forEach((el) => (el.onclick = () => { S.moving = el.dataset.moveit; S.tab = "schedule"; render(); scrollTo(0, 0); }));

    const map = L.map("route-map", { scrollWheelZoom: true });
    map._carId = carId;
    S.map = map;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    const pts = [];
    stops.forEach((b, i) => {
      const p = point(b);
      if (p[0] == null) return;
      pts.push(p);
      L.marker(p, { icon: L.divIcon({ className: "", html: `<div class="pin-num">${i + 1}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }) })
        .addTo(map).bindPopup(`<b>${esc(shortTime(hhmm(b.slot_time)))} · ${esc(b.name)}</b><br>${esc(areaName(b.area_id))}${b.address_details ? "<br>" + esc(b.address_details) : ""}`);
    });
    if (pts.length > 1) L.polyline(pts, { color: "#8c1d23", weight: 3, opacity: 0.7, dashArray: "6 6" }).addTo(map);
    if (prevView) map.setView(prevView.c, prevView.z);
    else if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
    else map.setView([31.965, 35.88], 12);
  }

  // ===== Donations =====
  function viewDonations() {
    const carId = ensureCar("donCar");
    const got = S.bookings.filter((b) => Number(b.amount) > 0);
    const total = got.reduce((s, b) => s + Number(b.amount), 0);
    const by = (fn) => got.reduce((m, b) => { const k = fn(b); m[k] = (m[k] || 0) + Number(b.amount); return m; }, {});
    const byMethod = by((b) => b.donation_method || b.payment_method);
    const byCar = by((b) => b.collected_by ?? b.car_id);
    const visits = S.bookings.filter((b) => ACTIVE.includes(b.status));
    const stops = carId ? route(carId) : [];
    const carOpts = (sel) => activeCars().map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    const payOpts = (sel) => Object.entries(PAY).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v}</option>`).join("");

    $("main").innerHTML = intro("Donations", "Record what each family gave, car by car, in the same order as the printed sheet. Everything saves as you type.") + `
      <div class="tiles">
        <div class="tile money"><b>${jd(total)}</b><span>Total recorded</span></div>
        ${Object.entries(PAY).map(([k, v]) => `<div class="tile"><b>${jd(byMethod[k])}</b><span>${v}</span></div>`).join("")}
        <div class="tile"><b>${got.length} <span class="muted" style="font-size:16px">of ${visits.length}</span></b><span>Visits with a donation recorded</span></div>
      </div>
      ${carChips(carId, "data-doncar")}
      <div class="panel"><h3>${esc(carName(carId))}</h3>
        ${stops.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Time</th><th>Family</th><th style="width:120px">Amount (JD)</th><th style="width:160px">How they gave</th><th style="width:150px">Collected by</th><th></th></tr></thead><tbody>
        ${stops.map((b) => `<tr data-don="${b.id}">
          <td class="num">${esc(shortTime(hhmm(b.slot_time)))}</td>
          <td><b>${esc(b.name)}</b><div class="muted">${esc(areaName(b.area_id))} · said ${esc(PAY[b.payment_method])}</div></td>
          <td><input type="number" min="0" step="0.5" inputmode="decimal" data-k="amount" value="${b.amount ?? ""}" placeholder="0"></td>
          <td><select data-k="donation_method">${payOpts(b.donation_method || b.payment_method)}</select></td>
          <td><select data-k="collected_by">${carOpts(b.collected_by ?? b.car_id)}</select></td>
          <td class="saved" data-saved></td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">No visits for this car.</div>`}
      </div>
      <div class="panel"><div class="row"><h3 style="flex:1">By car</h3><button class="btn small" id="don-xls">Export to Excel</button></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Car</th><th>Visits</th><th>Recorded</th><th>Total</th></tr></thead><tbody>
        ${activeCars().map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${route(c.id).length}</td><td class="num">${route(c.id).filter((b) => Number(b.amount) > 0).length}</td><td class="num"><b>${jd(byCar[c.id])}</b></td></tr>`).join("")}
        </tbody></table></div></div>`;
    $("main").querySelectorAll("[data-doncar]").forEach((el) => (el.onclick = () => { S.donCar = Number(el.dataset.doncar); render(); }));
    $("don-xls").onclick = exportDonations;
    $("main").querySelectorAll("tr[data-don]").forEach((tr) => {
      const b = bookingById(tr.dataset.don);
      const save = async () => {
        const amt = tr.querySelector("[data-k=amount]").value;
        const patch = {
          amount: amt === "" ? null : Number(amt),
          donation_method: tr.querySelector("[data-k=donation_method]").value,
          collected_by: Number(tr.querySelector("[data-k=collected_by]").value),
        };
        patch.paid = Number(patch.amount) > 0;
        const { error } = await sb.from("bookings").update({ ...patch, updated_by: S.me }).eq("id", b.id);
        if (error) return toast("Not saved: " + error.message);
        Object.assign(b, patch);
        tr.querySelector("[data-saved]").textContent = "Saved ✓";
        S.pendingRender = true;
      };
      tr.querySelectorAll("input, select").forEach((el) => el.addEventListener("change", save));
    });
  }
  function exportDonations() {
    logEvent("exported", "Exported donations to Excel");
    const rows = S.bookings.filter((b) => ACTIVE.includes(b.status)).sort((a, b) => (a.car_id || 99) - (b.car_id || 99) || toMin(hhmm(a.slot_time) || "23:59") - toMin(hhmm(b.slot_time) || "23:59"))
      .map((b) => ({ Car: carName(b.car_id), Time: b.slot_time ? label(hhmm(b.slot_time)) : "", Family: b.name, Phone: b.phone, Area: areaName(b.area_id), Ref: b.ref,
        "Said they'd give by": PAY[b.payment_method], "Amount (JD)": b.amount ?? "", "Gave by": b.amount ? PAY[b.donation_method || b.payment_method] : "", "Collected by": b.amount ? carName(b.collected_by ?? b.car_id) : "" }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Donations");
    const got = S.bookings.filter((b) => Number(b.amount) > 0);
    const sum = (f) => got.filter(f).reduce((s, b) => s + Number(b.amount), 0);
    const totals = [{ What: "Total", "Amount (JD)": sum(() => true) },
      ...Object.entries(PAY).map(([k, v]) => ({ What: v, "Amount (JD)": sum((b) => (b.donation_method || b.payment_method) === k) })),
      ...activeCars().map((c) => ({ What: c.name, "Amount (JD)": sum((b) => (b.collected_by ?? b.car_id) === c.id) }))];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(totals), "Totals");
    XLSX.writeFile(wb, `santa-donations-${todayJo()}.xlsx`);
  }

  // ===== Print (driver sheets) =====
  function waText(car) {
    const lines = [`🎅 ${car.name} – Christmas Eve route`, car.driver ? `Driver: ${car.driver}` : "", ""];
    route(car.id).forEach((b, i) => {
      lines.push(`${i + 1}. ${label(hhmm(b.slot_time))} – ${b.name}`, `📞 ${b.phone}`,
        `🏠 ${areaName(b.area_id)}${b.address_details ? " – " + b.address_details : ""}`);
      if (b.lat != null) lines.push(`🧭 Directions: ${navUrl(b)}`);
      if (b.maps_link) lines.push(`📍 Family's link: ${b.maps_link}`);
      if (b.lat == null && !b.maps_link) lines.push("⚠️ No location yet – call the family");
      if (b.gift_message) lines.push(`🎁 ${b.gift_message}`);
      if (b.notes) lines.push(`📝 ${b.notes}`);
      lines.push(`💝 Donation: ${PAY[b.payment_method]}`, "");
    });
    if (!route(car.id).length) lines.push("No stops yet.");
    return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
  }
  function viewPrint() {
    const carId = ensureCar("printCar");
    const car = carById(carId);
    $("main").innerHTML = intro("Print", "Driver sheets for the night: print one car or all of them, or send the list on WhatsApp.") +
      carChips(carId, "data-printcar") + `<div class="panel">
      <div class="row"><button class="btn primary" id="print-one">Print ${esc(car?.name || "")}</button><button class="btn" id="print-all">Print all cars</button>
        <button class="btn" id="copy-wa">Copy as WhatsApp message</button>
        ${car && waNumber(car.phone) ? `<a class="btn" target="_blank" rel="noopener" href="https://wa.me/${waNumber(car.phone)}?text=${encodeURIComponent(waText(car))}">Send to ${esc(car.driver || "driver")}</a>` : ""}
        <button class="btn" id="xls">Export all bookings to Excel</button></div>
      ${car ? `<pre class="wa" id="wa-text">${esc(waText(car))}</pre>` : ""}</div>`;
    $("main").querySelectorAll("[data-printcar]").forEach((el) => (el.onclick = () => { S.printCar = Number(el.dataset.printcar); render(); }));
    $("print-one").onclick = () => printCars([car]);
    $("print-all").onclick = () => printCars(activeCars());
    $("xls").onclick = exportAll;
    $("copy-wa").onclick = async () => {
      try { await navigator.clipboard.writeText(waText(car)); toast("Copied. Paste it in WhatsApp."); logEvent("copied", `Copied the WhatsApp route for ${car.name}`); }
      catch (e) { const r = document.createRange(); r.selectNodeContents($("wa-text")); getSelection().removeAllRanges(); getSelection().addRange(r); toast("Selected. Press Cmd/Ctrl+C to copy."); }
    };
  }
  function printCars(cars) {
    logEvent("printed", `Printed driver sheets: ${cars.map((c) => c.name).join(", ")}`);
    $("print-area").innerHTML = cars.map((c) => `<div class="print-car">
      <h2>${esc(c.name)}</h2><p>${esc(c.driver || "")} ${esc(c.phone || "")} · Christmas Eve ${esc(S.settings.event_date)}</p>
      <table><thead><tr><th>Time</th><th>Family</th><th>Phone</th><th>Area / address</th><th>Gift &amp; notes</th><th>Donation</th><th>Received (JD)</th></tr></thead><tbody>
      ${route(c.id).map((b) => `<tr><td>${esc(label(hhmm(b.slot_time)))}</td><td>${esc(b.name)}<br>${esc(b.ref)}</td><td>${esc(b.phone)}</td>
        <td>${esc(areaName(b.area_id))}${b.address_details ? "<br>" + esc(b.address_details) : ""}${b.lat != null ? `<br>Directions: ${esc(navUrl(b))}` : ""}${b.maps_link ? `<br>Family's link: ${esc(b.maps_link)}` : ""}</td>
        <td>${esc(b.gift_message)}${b.notes ? "<br>" + esc(b.notes) : ""}</td><td>${esc(PAY[b.payment_method])}</td><td></td></tr>`).join("") || `<tr><td colspan="7">No stops.</td></tr>`}
      </tbody></table></div>`).join("");
    window.print();
  }
  function exportAll() {
    logEvent("exported", "Exported all bookings to Excel");
    const row = (b) => ({
      Ref: b.ref, Time: b.slot_time ? label(hhmm(b.slot_time)) : "", Car: b.car_id ? carName(b.car_id) : "", Status: STATUS[b.status],
      Name: b.name, Phone: b.phone, Email: b.email, Area: areaName(b.area_id), Address: b.address_details, Directions: b.lat != null ? navUrl(b) : "", "Family's map link": b.maps_link,
      Gift: b.gift_message, Notes: b.notes, "Donation method": PAY[b.payment_method], "Donation (JD)": b.amount ?? "",
      "Wanted time": label(hhmm(b.preferred_time)), "Team notes": b.admin_notes, Booked: dateTime(b.created_at),
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(S.bookings.map(row)), "All bookings");
    for (const c of activeCars()) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(route(c.id).map(row)), c.name.slice(0, 31));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(S.bookings.filter((b) => b.status === "waitlist").map(row)), "Waitlist");
    XLSX.writeFile(wb, `santa-bookings-${todayJo()}.xlsx`);
  }

  // ===== Activity log (read-only) =====
  const LOG_FIELDS = {
    car_id: "car", slot_time: "time", area_id: "area", preferred_time: "wanted time", payment_method: "donation method",
    amount: "donation (JD)", donation_method: "gave by", collected_by: "collected by", admin_notes: "team notes",
    gift_message: "message for Santa", address_details: "address", maps_link: "Google Maps link", lat: "pin latitude", lng: "pin longitude",
    name_en: "name", name_ar: "Arabic name", start_time: "starts", end_time: "ends", sort: "column position", active: "running",
    event_date: "date", slot_minutes: "minutes per visit", default_capacity: "visits per car", cutoff_hours: "booking cutoff (hours)",
    borrow_km: "help distance (km)", booking_open: "booking form open", contact_phone: "contact phone", cliq_alias: "CliQ alias",
    price_note: "donation note", blocked: "blocked", capacity: "visits allowed", handled: "replied", paid: "donation received",
  };
  const HIDE_FIELDS = new Set(["id", "created_at", "updated_at", "updated_by", "lang", "ref", "name_ar"]);
  const who = (a) => (a === "Website" ? "Website visitor" : a);
  function fieldValue(k, v) {
    if (v == null || v === "") return "—";
    if (k === "car_id" || k === "collected_by") return carName(v);
    if (k === "area_id") return areaName(v);
    if (k === "status") return STATUS[v] || v;
    if (/_time$/.test(k)) return shortTime(hhmm(v));
    if (k === "payment_method" || k === "donation_method") return PAY[v] || v;
    if (typeof v === "boolean") return v ? "yes" : "no";
    return String(v);
  }
  const fieldLabel = (k) => LOG_FIELDS[k] || k.replace(/_/g, " ");
  function logSentence(r) {
    const c = r.changes || {}, lbl = esc(r.label || "");
    const bk = r.entity === "booking" && r.entity_id && bookingById(r.entity_id) ? `<button class="btn link" data-open="${r.entity_id}">${lbl}</button>` : `<b>${lbl}</b>`;
    switch (r.entity) {
      case "booking":
        if (r.action === "created") return r.actor === "Website" ? `booked a visit: ${bk}` : `added a booking: ${bk}`;
        if (r.action === "deleted") return `deleted the booking ${bk}`;
        if (c.status && Object.keys(c).length === 1) return `marked ${bk} as <b>${esc(STATUS[c.status[1]] || c.status[1])}</b>`;
        if ((c.car_id || c.slot_time) && Object.keys(c).every((k) => ["car_id", "slot_time", "status"].includes(k))) return `moved ${bk}`;
        if (c.amount || c.donation_method || c.collected_by) return `recorded a donation for ${bk}`;
        return `changed ${bk}`;
      case "time slot":
        if (r.action !== "changed") return c.blocked ? `${r.action === "deleted" ? "reset" : "blocked"} <b>${lbl}</b>` : `changed how many visits <b>${lbl}</b> allows`;
        if (Array.isArray(c.blocked)) return `${c.blocked[1] ? "blocked" : "unblocked"} <b>${lbl}</b>`;
        return `changed how many visits <b>${lbl}</b> allows`;
      case "car": return r.action === "created" ? `added <b>${lbl}</b>` : r.action === "deleted" ? `removed <b>${lbl}</b>` : `changed <b>${lbl}</b>`;
      case "area": return r.action === "created" ? `added the area <b>${lbl}</b>` : r.action === "deleted" ? `removed the area <b>${lbl}</b>` : `changed the area <b>${lbl}</b>`;
      case "settings": return `changed the night settings`;
      case "message":
        if (r.action === "created") return `sent a message on the Contact page (<b>${esc(c.name || "")}</b>)`;
        if (c.handled) return `marked the ${lbl.toLowerCase()} as ${c.handled[1] ? "replied" : "not replied"}`;
        return `${r.action} the ${lbl.toLowerCase()}`;
      case "team": { const t = r.label || r.action; return esc(t.charAt(0).toLowerCase() + t.slice(1)); }
      case "team member": return r.action === "created" ? `added <b>${lbl}</b> to the team` : r.action === "deleted" ? `removed <b>${lbl}</b> from the team` : `changed the team member <b>${lbl}</b>`;
      default: return `${esc(r.action)} ${esc(r.entity)} ${lbl}`;
    }
  }
  function logDetails(r) {
    const c = r.changes;
    if (!c || r.entity === "team") return "";
    if (r.action === "changed") {
      return Object.entries(c).filter(([k, [a, z]]) => !HIDE_FIELDS.has(k) && fieldValue(k, a) !== fieldValue(k, z)).map(([k, [a, z]]) =>
        `<div>${esc(fieldLabel(k))}: <span class="muted">${esc(fieldValue(k, a))}</span> → <b>${esc(fieldValue(k, z))}</b></div>`).join("");
    }
    // created / deleted: show the useful fields of the record
    const keys = r.entity === "booking" ? ["phone", "area_id", "slot_time", "car_id", "status", "payment_method", "preferred_time"]
      : r.entity === "message" ? ["phone", "email", "message"] : Object.keys(c).filter((k) => !HIDE_FIELDS.has(k));
    return `<div>${keys.filter((k) => c[k] != null && c[k] !== "").map((k) => `${esc(fieldLabel(k))}: <b>${esc(fieldValue(k, c[k]))}</b>`).join(" · ")}</div>`;
  }
  const LOG_KINDS = { all: "Everything", booking: "Bookings", "time slot": "Blocked times & visits allowed", car: "Cars", area: "Areas", settings: "Night settings", message: "Messages", team: "Sign-ins, prints & exports", "team member": "Team changes" };
  async function loadLog(older) {
    let q = sb.from("activity_log").select("*").order("id", { ascending: false }).limit(500);
    if (older && S.log.length) q = q.lt("id", S.log[S.log.length - 1].id);
    const { data, error } = await q;
    if (error) { toast("Couldn't load the activity log: " + error.message); return; }
    S.log = older ? S.log.concat(data) : data;
    S.logMore = data.length === 500;
    render();
  }
  async function logEvent(action, label) {
    await sb.from("activity_log").insert({ actor: S.me, action, entity: "team", label });
  }
  function viewActivity() {
    if (!S.log) { $("main").innerHTML = intro("Activity log", "Loading…"); loadLog(); return; }
    const f = S.logF;
    const actors = [...new Set(S.log.map((r) => who(r.actor)))].sort();
    const qtext = f.q.trim().toLowerCase();
    const rows = S.log.filter((r) => (f.kind === "all" || r.entity === f.kind) && (!f.who || who(r.actor) === f.who) &&
      (!qtext || [r.label, who(r.actor), r.action, JSON.stringify(r.changes || {})].join(" ").toLowerCase().includes(qtext)));
    const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
    let last = "", html = "";
    for (const r of rows) {
      const d = day(r.at);
      if (d !== last) { html += `<h3 class="logday">${esc(d)}</h3>`; last = d; }
      const det = logDetails(r);
      html += `<div class="logrow ${r.action}"><span class="logtime num">${esc(timeJo(r.at, true))}</span>
        <div><div><b class="${r.actor === "Website" ? "web" : ""}">${esc(who(r.actor))}</b> ${logSentence(r)}</div>${det ? `<div class="logdet">${det}</div>` : ""}</div></div>`;
    }
    $("main").innerHTML = intro("Activity log", "Everything that has happened, newest first: who did it, what changed, and when (Jordan time). Nobody can edit or delete this log.") + `
      <div class="row">
        <input class="grow" id="keep-logq" type="search" placeholder="Search names, booking numbers, changes…" value="${esc(f.q)}">
        <select id="log-kind" style="width:auto">${Object.entries(LOG_KINDS).map(([k, v]) => `<option value="${esc(k)}" ${f.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <select id="log-who" style="width:auto"><option value="">Everyone</option>${actors.map((a) => `<option ${f.who === a ? "selected" : ""}>${esc(a)}</option>`).join("")}</select>
        <button class="btn" id="log-refresh">Refresh</button><button class="btn" id="log-xls">Export to Excel</button>
      </div>
      <div class="panel" style="gap:0">${html || `<div class="empty" style="border:0">Nothing matches.</div>`}</div>
      ${S.logMore ? `<div><button class="btn" id="log-older">Load older activity</button></div>` : ""}
      <p class="muted" style="margin:0;font-size:13px">Showing ${rows.length} of ${S.log.length} entries loaded.</p>`;
    $("keep-logq").oninput = (e) => { f.q = e.target.value; render(); };
    $("log-kind").onchange = (e) => { f.kind = e.target.value; render(); };
    $("log-who").onchange = (e) => { f.who = e.target.value; render(); };
    $("log-refresh").onclick = () => loadLog();
    if ($("log-older")) $("log-older").onclick = () => loadLog(true);
    $("log-xls").onclick = () => {
      const strip = (h) => h.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      const out = rows.map((r) => ({ Date: new Date(r.at).toLocaleDateString("en-GB", { timeZone: TZ }), "Time (Jordan)": timeJo(r.at, true), Who: who(r.actor),
        What: strip(logSentence(r)), Details: strip(logDetails(r).replace(/<\/div><div>/g, "; ")) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out), "Activity log");
      XLSX.writeFile(wb, `santa-activity-log-${todayJo()}.xlsx`);
      logEvent("exported", "Exported the activity log to Excel");
    };
    wireCommon();
  }

  // ===== Messages =====
  function viewMessages() {
    $("main").innerHTML = intro("Messages", "Notes sent from the Contact page. Tick them once someone has replied.") +
      (S.messages.length ? `<div class="list">${S.messages.map((m) => `<div class="panel" style="gap:6px;${m.handled ? "opacity:.6" : ""}">
        <div class="row"><b>${esc(m.name)}</b><span class="muted num">${esc(m.phone)}</span><span class="muted">${esc(m.email)}</span>
          <span class="muted" style="margin-inline-start:auto">${esc(dateTime(m.created_at))}</span></div>
        <div style="white-space:pre-wrap">${esc(m.message)}</div>
        <div class="row">${waNumber(m.phone) ? `<a class="btn small" target="_blank" rel="noopener" href="https://wa.me/${waNumber(m.phone)}">WhatsApp</a>` : ""}
          <label class="row" style="gap:6px"><input type="checkbox" data-msg="${m.id}" ${m.handled ? "checked" : ""}> Replied</label></div></div>`).join("")}</div>`
        : `<div class="empty">No messages yet.</div>`);
    $("main").querySelectorAll("[data-msg]").forEach((cb) => (cb.onchange = async () => {
      const { error } = await sb.from("messages").update({ handled: cb.checked }).eq("id", cb.dataset.msg);
      if (error) return toast("Not saved: " + error.message);
      S.messages.find((m) => m.id === cb.dataset.msg).handled = cb.checked;
      render();
    }));
  }

  // ===== Setup =====
  function viewSetup() {
    const s = S.settings;
    const carOpts = (sel) => `<option value="">— none —</option>` + S.cars.map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}${c.active ? "" : " (off)"}</option>`).join("");
    $("main").innerHTML = intro("Setup", "The night's hours, cars and areas. Changes here never delete bookings.") + `
    <div class="panel"><h3>The night</h3>
      <div class="g2">
        <label class="f"><span>Date</span><input type="date" id="s-event_date" value="${s.event_date}"></label>
        <label class="f"><span>Minutes per visit (including driving)</span><input type="number" min="5" id="s-slot_minutes" value="${s.slot_minutes}"></label>
        <label class="f"><span>First visit starts</span><input type="time" id="s-start_time" value="${hhmm(s.start_time)}"></label>
        <label class="f"><span>Last visit ends</span><input type="time" id="s-end_time" value="${hhmm(s.end_time)}"></label>
        <label class="f"><span>Visits each car can do at the same time</span><input type="number" min="0" id="s-default_capacity" value="${s.default_capacity}"></label>
        <label class="f"><span>Stop taking bookings this many hours before</span><input type="number" min="0" id="s-cutoff_hours" value="${s.cutoff_hours}"></label>
        <label class="f"><span>Phone number shown to families</span><input id="s-contact_phone" value="${esc(s.contact_phone)}"></label>
        <label class="f"><span>CliQ alias (leave empty until ready)</span><input id="s-cliq_alias" value="${esc(s.cliq_alias)}"></label>
        <label class="f"><span>Donation note on the booking form</span><input id="s-price_note" value="${esc(s.price_note)}" placeholder="e.g. Suggested donation: 20 JD"></label>
      </div>
      <label class="row"><input type="checkbox" id="s-booking_open" ${s.booking_open ? "checked" : ""}> The booking form is open to families</label>
      <div><button class="btn primary" id="save-settings">Save</button></div>
    </div>
    <div class="panel"><h3>Cars</h3>
      <p class="muted" style="margin:0">Leave Starts / Ends empty to use the night's hours. Fill them in to give one car different hours, for example to keep Car 3 out until 12:00 AM. Column position sets the order cars appear in, left to right (1 comes first). Switch a car off instead of deleting it; its bookings stay and show up as "please check" on the Bookings page.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Driver</th><th>Driver phone</th><th>Starts</th><th>Ends</th><th title="Lower numbers appear first in the schedule, lists and exports">Column position</th><th>Running</th><th>Areas it covers</th></tr></thead><tbody>
      ${S.cars.map((c) => `<tr>
        <td><input data-car="${c.id}" data-k="name" value="${esc(c.name)}"></td>
        <td><input data-car="${c.id}" data-k="driver" value="${esc(c.driver)}"></td>
        <td><input data-car="${c.id}" data-k="phone" value="${esc(c.phone)}" placeholder="07…"></td>
        <td style="width:120px"><input type="time" data-car="${c.id}" data-k="start_time" value="${hhmm(c.start_time)}" title="Leave empty to use the night's hours"></td>
        <td style="width:120px"><input type="time" data-car="${c.id}" data-k="end_time" value="${hhmm(c.end_time)}" title="Leave empty to use the night's hours"></td>
        <td style="width:80px"><input type="number" data-car="${c.id}" data-k="sort" value="${c.sort}"></td>
        <td><input type="checkbox" data-car="${c.id}" data-k="active" ${c.active ? "checked" : ""}></td>
        <td class="muted">${esc(S.areas.filter((a) => a.car_id === c.id).map((a) => a.name_en).join(", ") || "—")}</td></tr>`).join("")}
      </tbody></table></div>
      <div><button class="btn" id="add-car">+ Add a car</button></div>
    </div>
    <div class="panel"><h3>Areas</h3>
      <p class="muted" style="margin:0">Each area's bookings go to its car first. If that car is full, the nearest car with room takes it. The coordinates are used when a family doesn't drop a pin.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Area</th><th>Its car</th><th>Lat</th><th>Lng</th><th>Shown</th></tr></thead><tbody>
      ${S.areas.map((a) => `<tr>
        <td><input data-area="${a.id}" data-k="name_en" value="${esc(a.name_en)}"></td>
        <td><select data-area="${a.id}" data-k="car_id">${carOpts(a.car_id)}</select></td>
        <td style="width:110px"><input type="number" step="0.0001" data-area="${a.id}" data-k="lat" value="${a.lat ?? ""}"></td>
        <td style="width:110px"><input type="number" step="0.0001" data-area="${a.id}" data-k="lng" value="${a.lng ?? ""}"></td>
        <td><input type="checkbox" data-area="${a.id}" data-k="active" ${a.active ? "checked" : ""}></td></tr>`).join("")}
      </tbody></table></div>
      <div><button class="btn" id="add-area">+ Add an area</button></div>
    </div>
`;

    $("save-settings").onclick = async () => {
      const patch = {};
      for (const k of ["event_date", "start_time", "end_time", "contact_phone", "cliq_alias", "price_note"]) patch[k] = $("s-" + k).value;
      for (const k of ["slot_minutes", "default_capacity", "cutoff_hours"]) patch[k] = Number($("s-" + k).value);
      patch.booking_open = $("s-booking_open").checked;
      if (toMin(patch.end_time) <= toMin(patch.start_time)) return toast("The last visit must end after the first one starts.");
      const { error } = await sb.from("settings").update(patch).eq("id", 1);
      if (error) return toast("Not saved: " + error.message);
      Object.assign(S.settings, patch);
      toast("Settings saved");
      render();
    };
    const cast = (el) => el.type === "checkbox" ? el.checked : el.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.type === "time" ? (el.value || null)
      : el.dataset.k === "car_id" ? (el.value ? Number(el.value) : null) : el.value;
    $("main").querySelectorAll("[data-car]").forEach((el) => (el.onchange = async () => {
      const id = Number(el.dataset.car), v = cast(el);
      const { error } = await sb.from("cars").update({ [el.dataset.k]: v }).eq("id", id);
      if (error) return toast("Not saved: " + error.message);
      carById(id)[el.dataset.k] = v;
      toast("Saved");
      if (el.type === "time") render();
    }));
    $("main").querySelectorAll("[data-area]").forEach((el) => (el.onchange = async () => {
      const id = Number(el.dataset.area), v = cast(el);
      const { error } = await sb.from("areas").update({ [el.dataset.k]: v }).eq("id", id);
      if (error) return toast("Not saved: " + error.message);
      areaById(id)[el.dataset.k] = v;
      toast("Saved");
      if (el.dataset.k === "car_id") render();
    }));
    $("add-car").onclick = async () => {
      const n = S.cars.length + 1;
      const { data, error } = await sb.from("cars").insert({ name: `Car ${n}`, sort: n }).select().single();
      if (error) return toast("Not saved: " + error.message);
      S.cars.push(data); render();
    };
    $("add-area").onclick = async () => {
      const { data, error } = await sb.from("areas").insert({ name_en: "New area", name_ar: "", sort: 50 }).select().single();
      if (error) return toast("Not saved: " + error.message);
      S.areas.push(data); render();
    };
  }

  // ---------- Overlays ----------
  function overlay(kind, title, body, footer, wire) {
    $("overlay").innerHTML = `<div class="scrim" id="scrim"></div>
      <section class="${kind}" role="dialog" aria-modal="true" aria-label="${title.replace(/<[^>]*>/g, "").replace(/"/g, "")}">
        <header><h2>${title}</h2><button class="btn small" id="ov-x" aria-label="Close">✕</button></header>
        <div class="body">${body}</div>${footer ? `<footer>${footer}</footer>` : ""}</section>`;
    const close = () => { $("overlay").innerHTML = ""; document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    $("scrim").onclick = close; $("ov-x").onclick = close;
    wire && wire(close);
    return close;
  }
  const modal = (t, b, f, w) => overlay("modal", t, b, f, w);
  const areaOptions = (sel) => `<option value="">Choose area</option>` + S.areas.filter((a) => a.active || a.id === sel)
    .sort((a, b) => a.name_en === "Other" ? 1 : b.name_en === "Other" ? -1 : a.name_en.localeCompare(b.name_en, "en", { numeric: true }))
    .map((a) => `<option value="${a.id}" ${a.id === sel ? "selected" : ""}>${esc(a.name_en)}</option>`).join("");

  // Map pin + Google Maps link fields, shared by "Add booking" and the booking drawer.
  const locationFields = (p, b = {}) => `
    <div class="f"><span>Map pin * <span class="muted">(tap the map, drag to adjust)</span></span>
      <div class="mini-map" id="${p}-map"></div>
      <span class="muted" id="${p}-pinstate" style="font-size:13px">${b.lat != null ? "Pin placed." : "No pin yet."}</span></div>
    <label class="f"><span>Google Maps link *</span><input id="${p}-maps" value="${esc(b.maps_link || "")}" placeholder="Paste the link the family sent">
      <span class="muted" id="${p}-mapshint" style="font-size:13px">A link with coordinates places the pin for you.</span></label>`;
  function wireLocation(p, b, areaId, onPin) {
    const a = areaById(areaId);
    const picker = pinPicker($(`${p}-map`), {
      lat: b.lat, lng: b.lng, center: a && a.lat != null ? [a.lat, a.lng] : undefined, zoom: a && a.lat != null ? 14 : 12,
      onChange: (pos) => { $(`${p}-pinstate`).textContent = `Pin placed (${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}).`; onPin && onPin(pos); },
    });
    $(`${p}-maps`).addEventListener("input", () => {
      const v = $(`${p}-maps`).value, c = parseMapsLink(v);
      $(`${p}-maps`).classList.remove("invalid");
      if (c) { picker.set(c.lat, c.lng, true); $(`${p}-mapshint`).textContent = "Pin placed from the link. Check it's on the right house."; }
      else if (isShortMapsLink(v)) $(`${p}-mapshint`).textContent = "Short links can't be read here. Open it on your phone and tap the same spot on the map.";
    });
    return picker;
  }
  const looksLikeMaps = (v) => /google\.[a-z.]+\/maps|maps\.google|goo\.gl|maps\.app/i.test(v) || !!parseMapsLink(v);

  // Quick add (phone bookings): the system picks the car.
  function quickAdd(preset = {}) {
    let picker = null;
    const slotOpts = () => {
      const area = Number($("q-area").value) || null, pos = picker?.get();
      return slots().map((s) => {
        const fits = preset.car ? freeIn(preset.car, s) > 0 : area ? !!pickCar(s, area) : null;
        return `<option value="${s}" ${s === ($("q-slot")?.value || preset.slot) ? "selected" : ""}>${esc(label(s))}${fits == null ? "" : fits ? " · free" : " · full"}</option>`;
      }).join("");
    };
    modal("Add a booking", `
      <p class="muted" style="margin:0">For families who call. Fields with * are required. Their area's car is used if it's free; otherwise you choose another car or the waitlist.</p>
      <div class="g2">
        <label class="f"><span>Family name *</span><input id="q-name" autocomplete="off"></label>
        <label class="f"><span>Mobile *</span><input id="q-phone" inputmode="tel" placeholder="07X XXX XXXX"></label>
        <label class="f"><span>Area *</span><select id="q-area">${areaOptions(null)}</select></label>
        <label class="f"><span>Time *</span><select id="q-slot"></select></label>
      </div>
      ${preset.car ? `<div class="note">This will go on ${esc(carName(preset.car))}.</div>` : ""}
      ${locationFields("q")}
      <label class="f"><span>Building, floor &amp; directions</span><input id="q-address"></label>
      <label class="f"><span>Message for Santa</span><input id="q-gift"></label>
      <label class="f"><span>How will they donate? *</span><select id="q-pay"><option value="">Choose…</option>${Object.entries(PAY).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <div id="q-out"></div>`,
      `<button class="btn primary" id="q-save">Add booking</button><button class="btn" id="q-cancel">Cancel</button>`,
      (close) => {
        picker = wireLocation("q", {}, null, () => { $("q-slot").innerHTML = slotOpts(); });
        $("q-slot").innerHTML = slotOpts();
        $("q-area").onchange = () => {
          const a = areaById(Number($("q-area").value));
          if (a && a.lat != null && !picker.get()) picker.view(a.lat, a.lng, 14);
          $("q-slot").innerHTML = slotOpts();
        };
        $("q-cancel").onclick = close;
        $("q-name").focus();
        const insert = async (car, slot, status) => {
          const pos = picker.get();
          const row = {
            name: $("q-name").value.trim(), phone: normPhone($("q-phone").value),
            area_id: Number($("q-area").value), lat: pos.lat, lng: pos.lng, maps_link: $("q-maps").value.trim(),
            address_details: $("q-address").value.trim(), gift_message: $("q-gift").value.trim(),
            payment_method: $("q-pay").value, preferred_time: $("q-slot").value, slot_time: car ? slot : null, car_id: car, status, updated_by: S.me,
          };
          const { data, error } = await sb.from("bookings").insert(row).select().single();
          if (error) return toast("Not saved: " + error.message);
          S.bookings.push(data);
          close();
          render();
          toast(car ? `Added ${data.name}: ${carName(car)} at ${shortTime(slot)}` : `Added ${data.name} to the waitlist`, async () => {
            await sb.from("bookings").delete().eq("id", data.id);
            S.bookings = S.bookings.filter((x) => x.id !== data.id); render();
          });
        };
        $("q-save").onclick = () => {
          const bad = [];
          const flag = (id, isBad, msg) => { $(id).classList.toggle("invalid", isBad); if (isBad) bad.push(msg); };
          flag("q-name", $("q-name").value.trim().length < 2, "name");
          flag("q-phone", !normPhone($("q-phone").value), "a valid Jordanian mobile");
          flag("q-area", !$("q-area").value, "area");
          flag("q-slot", !$("q-slot").value, "time");
          flag("q-map", !picker.get(), "map pin");
          flag("q-maps", !looksLikeMaps($("q-maps").value.trim()), "Google Maps link");
          flag("q-pay", !$("q-pay").value, "how they'll donate");
          if (bad.length) return toast("Still needed: " + bad.join(", ") + ".");
          const slot = $("q-slot").value, pos = picker.get();
          if (preset.car) return insert(preset.car, slot, "new");
          const pick = pickCar(slot, Number($("q-area").value));
          if (pick) return insert(pick.car.id, slot, "new");
          const opts = options({ area_id: Number($("q-area").value), preferred_time: slot, lat: pos.lat, lng: pos.lng }, slot, 3);
          $("q-out").innerHTML = `<div class="note">${esc(shortTime(slot))} is full for that area.</div>
            <div class="menu">${opts.map((o) => `<button class="btn" data-q="${o.car.id}|${o.slot}">Book ${esc(optionText(o))} instead</button>`).join("")}
            <button class="btn" id="q-wait">Put them on the waitlist for ${esc(shortTime(slot))}</button></div>`;
          $("q-out").querySelectorAll("[data-q]").forEach((el) => (el.onclick = () => { const [c, s2] = el.dataset.q.split("|"); insert(Number(c), s2, "new"); }));
          $("q-wait").onclick = () => insert(null, slot, "waitlist");
          $("q-out").scrollIntoView({ behavior: "smooth", block: "nearest" });
        };
      });
  }
  document.querySelectorAll(".js-add").forEach((b) => (b.onclick = () => quickAdd()));

  // Booking details drawer.
  async function openBooking(id) {
    const b = bookingById(id);
    if (!b) return;
    const sl = slots();
    const slotOpts = (sel) => `<option value="">No time</option>` + sl.concat(sel && !sl.includes(hhmm(sel)) ? [hhmm(sel)] : [])
      .map((s) => `<option value="${s}" ${hhmm(sel) === s ? "selected" : ""}>${esc(label(s))}</option>`).join("");
    const carOpts = `<option value="">No car</option>` + S.cars.map((c) => `<option value="${c.id}" ${c.id === b.car_id ? "selected" : ""}>${esc(c.name)}${c.active ? "" : " (off)"}</option>`).join("");
    const confirmMsg = `Hi ${b.name}, this is ${cfg.ORG_NAME_EN} confirming Santa's visit on Christmas Eve at ${b.slot_time ? label(hhmm(b.slot_time)) : ""}. Booking ${b.ref}. 🎅`;
    let status = b.status;

    overlay("drawer", `${esc(b.name)} <span class="muted" style="font-weight:400">· ${esc(b.ref)}</span>`, `
      <div class="row">
        <a class="btn small" href="tel:${esc(b.phone)}">Call ${esc(b.phone)}</a>
        ${waNumber(b.phone) ? `<a class="btn small" target="_blank" rel="noopener" href="https://wa.me/${waNumber(b.phone)}?text=${encodeURIComponent(confirmMsg)}">WhatsApp confirmation</a>` : ""}
        ${mapsUrl(b) ? `<a class="btn small" target="_blank" rel="noopener" href="${esc(mapsUrl(b))}">Open map</a>` : ""}
      </div>
      <div class="sec"><h3>Status</h3>
        <div class="seg" id="d-status">${Object.entries(STATUS).map(([k, v]) => `<button type="button" class="${k}" data-st="${k}" aria-pressed="${k === status}">${v}</button>`).join("")}</div>
      </div>
      <div class="sec"><h3>Visit</h3>
        <div class="visit-box">
          <div class="g2">
            <label class="f"><span>Car</span><select id="d-car">${carOpts}</select></label>
            <label class="f"><span>Time</span><select id="d-slot">${slotOpts(b.slot_time)}</select></label>
          </div>
          <div class="row"><button class="btn small" id="d-best">Pick the best free place</button><button class="btn small" id="d-move">Move on the schedule</button></div>
          <div id="d-warn"></div>
        </div>
      </div>
      <div class="sec"><h3>Family</h3>
        <div class="g2">
          <label class="f"><span>Name</span><input id="d-name" value="${esc(b.name)}"></label>
          <label class="f"><span>Mobile</span><input id="d-phone" value="${esc(b.phone)}" inputmode="tel"></label>
          <label class="f"><span>Area</span><select id="d-area">${areaOptions(b.area_id)}</select></label>
          <label class="f"><span>Email</span><input id="d-email" value="${esc(b.email)}"></label>
        </div>
        <label class="f"><span>Building, floor &amp; directions</span><input id="d-address" value="${esc(b.address_details)}"></label>
        <label class="f"><span>Message for Santa</span><textarea id="d-gift" rows="2">${esc(b.gift_message)}</textarea></label>
        <label class="f"><span>Family's notes</span><textarea id="d-notes" rows="2">${esc(b.notes)}</textarea></label>
      </div>
      <div class="sec"><h3>Location</h3>${locationFields("d", b)}
        ${b.lat != null ? `<div class="row"><a class="btn small" target="_blank" rel="noopener" href="${esc(navUrl(b))}">Directions in Google Maps</a></div>` : ""}</div>
      <div class="sec"><h3>Donation</h3>
        <div class="g2">
          <label class="f"><span>They said they'd give by</span><select id="d-pay">${Object.entries(PAY).map(([k, v]) => `<option value="${k}" ${b.payment_method === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
          <label class="f"><span>Amount received (JD)</span><input id="d-amount" type="number" min="0" step="0.5" value="${b.amount ?? ""}"></label>
        </div>
      </div>
      <details class="more"><summary>More: team notes, wanted time, history</summary><div>
        <label class="f"><span>Team notes (families never see this)</span><textarea id="d-admin" rows="2">${esc(b.admin_notes)}</textarea></label>
        <div class="g2">
          <label class="f"><span>Time they asked for</span><select id="d-pref">${slotOpts(b.preferred_time).replace('<option value="">No time</option>', "")}</select></label>
        </div>
        <div class="history" id="d-history"><span class="muted">Loading history…</span></div>
        <div><button class="btn small danger" id="d-delete">Delete this booking for good</button></div>
      </div></details>`,
      `<button class="btn primary" id="d-save">Save changes</button><button class="btn" id="d-cancel">Close</button>`,
      async (close) => {
        $("d-cancel").onclick = close;
        const picker = wireLocation("d", b, b.area_id);
        const warn = () => {
          const car = Number($("d-car").value) || null, slot = $("d-slot").value, w = [];
          if (ACTIVE.includes(status) && car && slot) {
            if (override(car, slot)?.blocked) w.push(`${carName(car)} is blocked at ${shortTime(slot)}.`);
            else if (freeIn(car, slot, b.id) <= 0) w.push(`${carName(car)} already has a visit at ${shortTime(slot)}.`);
          }
          if (ACTIVE.includes(status) && (!car || !slot)) w.push("Choose a car and a time, or set the status to Waitlist.");
          if ($("d-phone").value && !normPhone($("d-phone").value)) w.push("The mobile number doesn't look like a Jordanian number.");
          $("d-warn").innerHTML = w.map((x) => `<div class="note">${esc(x)}</div>`).join("");
        };
        $("d-status").querySelectorAll("[data-st]").forEach((el) => (el.onclick = () => {
          status = el.dataset.st;
          $("d-status").querySelectorAll("[data-st]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.st === status));
          warn();
        }));
        ["d-car", "d-slot", "d-phone"].forEach((i) => $(i).addEventListener("change", warn));
        warn();
        $("d-best").onclick = () => {
          const probe = { ...b, area_id: Number($("d-area").value) || b.area_id };
          const o = options(probe, $("d-slot").value || hhmm(b.preferred_time), 1)[0];
          if (!o) return toast("No free place anywhere right now.");
          $("d-car").value = o.car.id; $("d-slot").value = o.slot;
          if (!ACTIVE.includes(status)) $("d-status").querySelector('[data-st="new"]').click();
          warn();
          toast(`${optionText(o)}. Press Save to keep it.`);
        };
        $("d-move").onclick = () => { close(); S.moving = b.id; S.tab = "schedule"; render(); scrollTo(0, 0); };
        $("d-save").onclick = async () => {
          const amt = $("d-amount").value;
          const patch = {
            status, car_id: Number($("d-car").value) || null, slot_time: $("d-slot").value || null,
            name: $("d-name").value.trim(), phone: normPhone($("d-phone").value) || $("d-phone").value.trim(),
            area_id: Number($("d-area").value) || null, email: $("d-email").value.trim(),
            address_details: $("d-address").value.trim(), gift_message: $("d-gift").value.trim(), notes: $("d-notes").value.trim(),
            payment_method: $("d-pay").value, amount: amt === "" ? null : Number(amt), paid: Number(amt) > 0,
            admin_notes: $("d-admin").value.trim(), preferred_time: $("d-pref").value || b.preferred_time, maps_link: $("d-maps").value.trim(),
            lat: picker.get()?.lat ?? null, lng: picker.get()?.lng ?? null,
          };
          if (patch.status === "waitlist") { patch.car_id = null; patch.slot_time = null; }
          if (patch.name.length < 2) return toast("Add the family's name.");
          if (patch.status !== "cancelled") {
            const miss = [];
            if (!normPhone(patch.phone)) miss.push("a valid Jordanian mobile");
            if (!patch.area_id) miss.push("area");
            if (patch.lat == null) { miss.push("map pin"); $("d-map").classList.add("invalid"); }
            if (!looksLikeMaps(patch.maps_link)) { miss.push("Google Maps link"); $("d-maps").classList.add("invalid"); }
            if (miss.length) return toast("Still needed: " + miss.join(", ") + ".");
          }
          if (await update(b, patch)) close();
        };
        $("d-delete").onclick = async () => {
          if (!confirm(`Delete ${b.name}'s booking for good? To keep a record, set the status to Cancelled instead.`)) return;
          const { error } = await sb.from("bookings").delete().eq("id", b.id);
          if (error) return toast("Not deleted: " + error.message);
          S.bookings = S.bookings.filter((x) => x.id !== b.id);
          close(); render(); toast("Deleted");
        };
        const { data } = await sb.from("booking_history").select("*").eq("booking_id", b.id).order("at", { ascending: false });
        if (!$("d-history")) return;
        const NAMES = { car_id: "car", slot_time: "time", area_id: "area", preferred_time: "wanted time", payment_method: "donation method", amount: "donation", donation_method: "gave by", collected_by: "collected by", admin_notes: "team notes", gift_message: "message for Santa", address_details: "address" };
        const fmt = (k, v) => {
          if (v == null || v === "") return "—";
          if (k === "car_id" || k === "collected_by") return carName(v);
          if (k === "area_id") return areaName(v);
          if (k === "status") return STATUS[v] || v;
          if (k.endsWith("_time")) return shortTime(hhmm(v));
          if (k === "payment_method" || k === "donation_method") return PAY[v] || v;
          return String(v);
        };
        $("d-history").innerHTML = (data || []).filter((r) => !(Object.keys(r.changes).length === 1 && r.changes.paid)).map((r) =>
          `<div><span class="muted">${esc(dateTime(r.at))} · ${esc(r.by_name)}</span><br>${Object.entries(r.changes).filter(([k]) => k !== "paid")
            .map(([k, [a, z]]) => `${esc(NAMES[k] || k.replace(/_/g, " "))}: ${esc(fmt(k, a))} → <b>${esc(fmt(k, z))}</b>`).join("<br>")}</div>`).join("")
          + `<div><span class="muted">${esc(dateTime(b.created_at))} · booked</span></div>`;
      });
  }

  // ---------- Sign in & start ----------
  async function enter() {
    const { data: ok, error } = await sb.rpc("is_admin");
    if (error || !ok) { await sb.auth.signOut(); return showLogin("This login isn't on the team list yet. Ask the owner to add it."); }
    // Who is signed in comes from their own login and the team list; the database stamps changes with it.
    const { data: sess } = await sb.auth.getSession();
    const email = (sess?.session?.user?.email || "").toLowerCase();
    const { data: team } = await sb.from("admins").select("*");
    S.team = team || [];
    const mine = S.team.find((t) => String(t.email).toLowerCase() === email);
    S.me = mine?.name || (email ? email.split("@")[0] : "Team");
    // Only owners see the Activity log (the database also refuses it to everyone else).
    S.isOwner = !!mine?.is_owner;
    document.querySelectorAll('[data-tab="activity"]').forEach((el) => (el.hidden = !S.isOwner));
    document.querySelectorAll(".js-demo").forEach((el) => {
      el.hidden = !S.isOwner;
      el.textContent = Santa.demo ? "■ Exit demo" : "▶ Demo mode";
      el.onclick = toggleDemo;
    });
    window.__santaActor = S.me;
    document.querySelectorAll(".who").forEach((el) => (el.textContent = "Signed in as " + S.me));
    $("login-view").hidden = true;
    $("app").hidden = false;
    if (!(await loadAll())) return;
    render();
    let t;
    sb.channel("bookings-live").on("postgres_changes", { event: "*", schema: "public", table: "bookings" },
      () => { clearTimeout(t); t = setTimeout(reloadBookings, 500); }).subscribe();
    setInterval(async () => {
      const { data } = await sb.from("messages").select("*").order("created_at", { ascending: false });
      if (data && data.length !== S.messages.length) { S.messages = data; softRender(); }
    }, 60000);
  }
  function showLogin(msg) {
    $("app").hidden = true;
    $("login-view").hidden = false;
    $("login-err").textContent = msg || "";
    $("login-err").hidden = !msg;
    try { $("login-user").value = localStorage.getItem("santa-admin-user") || ""; } catch (e) {}
  }
  const loginEmail = (u) => (u.includes("@") ? u : `${u}@${cfg.TEAM_DOMAIN || "santa.team"}`).toLowerCase();
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = $("login-user").value.trim();
    if (!user) return;
    $("login-btn").disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: loginEmail(user), password: $("login-pass").value });
    $("login-btn").disabled = false;
    if (error) return showLogin("That username or password isn't right.");
    try { localStorage.setItem("santa-admin-user", user); } catch (e) {}
    $("login-pass").value = "";
    await enter();
    logEvent("signed in", "Signed in");
  });
  // Owners only: switch this tab to the sample night for presentations, and back. Real data is never touched.
  function toggleDemo() {
    try {
      if (Santa.demo) { sessionStorage.removeItem("santa-demo"); sessionStorage.removeItem("santa-demo-session"); }
      else sessionStorage.setItem("santa-demo", "1");
    } catch (e) {}
    location.reload();
  }
  const signOut = async () => {
    if (Santa.demo) return toggleDemo(); await logEvent("signed out", "Signed out"); await sb.auth.signOut(); location.reload(); };
  document.querySelectorAll(".js-logout").forEach((b) => (b.onclick = signOut));
  // Phone: the "More" tab opens the remaining sections.
  document.querySelector("[data-more]").onclick = () => modal("More", `<div class="menu">
      <button class="btn" data-m="routes">Route map</button><button class="btn" data-m="print">Print sheets</button>
      <button class="btn" data-m="messages">Messages${S.messages.filter((m) => !m.handled).length ? ` (${S.messages.filter((m) => !m.handled).length} new)` : ""}</button>
      <button class="btn" data-m="setup">Setup</button>${S.isOwner ? `<button class="btn" data-m="activity">Activity log</button><button class="btn js-demo2">${Santa.demo ? "■ Exit demo" : "▶ Demo mode"}</button>` : ""}<button class="btn danger js-out2">Sign out</button></div>`, "", (close) => {
    document.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { close(); S.tab = b.dataset.m; render(); scrollTo(0, 0); }));
    document.querySelector(".js-out2").onclick = signOut;
    if (document.querySelector(".js-demo2")) document.querySelector(".js-demo2").onclick = toggleDemo;
  });
  document.querySelectorAll(".tab[data-tab]").forEach((t) => (t.onclick = () => { S.tab = t.dataset.tab; render(); scrollTo(0, 0); }));

  sb.auth.getSession().then(({ data }) => (data.session ? enter() : showLogin()));
})();
