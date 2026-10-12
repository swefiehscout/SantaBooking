// DEMO MODE — used only while config.js still has the placeholder Supabase URL.
// Imitates the Supabase calls the site makes, storing everything in this browser
// (localStorage). Any password works on the admin page. Delete nothing; it switches
// itself off as soon as real keys are in config.js.
(function () {
  const KEY = "santa-demo-db-v9";
  const AREAS = [
    ["1st Circle", "", 6, 31.9515, 35.9239],
    ["2nd Circle", "", 6, 31.954, 35.918],
    ["3rd Circle", "", 6, 31.9563, 35.9106],
    ["4th Circle", "", 2, 31.958, 35.902],
    ["5th Circle", "", 2, 31.961, 35.8935],
    ["6th Circle", "", 2, 31.966, 35.884],
    ["7th Circle", "", 5, 31.969, 35.874],
    ["8th Circle", "", 5, 31.972, 35.858],
    ["Abdali", "", 6, 31.964, 35.91],
    ["Abdoun", "", 1, 31.943, 35.889],
    ["Airport Road", "", 3, 31.9, 35.9],
    ["Al Bnayat", "", 3, 31.899, 35.864],
    ["Al Madina St", "", 7, 31.99, 35.865],
    ["Bayader Wadi Al Seer", "", 8, 31.953, 35.835],
    ["Dabouq", "", 4, 31.99, 35.81],
    ["Dahiyat Al Ameer Rashed", "", 5, 31.996, 35.862],
    ["Dahiyat Al Rasheed", "", 7, 32.012, 35.862],
    ["Dahiyet Al Hussein", "", 1, 31.972, 35.886],
    ["Deir Ghbar", "", 1, 31.953, 35.858],
    ["Downtown / Al Balad", "", 6, 31.952, 35.934],
    ["Dwar Al Nahda", "", 8, 31.952, 35.825],
    ["Gardens", "", 7, 31.989, 35.877],
    ["Jabal Al Hussein", "", 6, 31.974, 35.92],
    ["Jabal Al Webdeh", "", 6, 31.958, 35.922],
    ["Jabal Amman", "", 6, 31.952, 35.918],
    ["Jandaweel", "", 8, 31.96, 35.85],
    ["Jubeiha", "", 7, 32.026, 35.867],
    ["Khalda", "", 4, 31.998, 35.846],
    ["Kilo", "", 5, 32.01, 35.85],
    ["Korsi", "", 4, 31.983, 35.836],
    ["Marj Al Hamam", "", 3, 31.887, 35.836],
    ["Mecca St", "", 7, 31.98, 35.865],
    ["Dahiyet Al Nakheel", "", 3, 31.9, 35.85],
    ["Naour", "", 3, 31.875, 35.83],
    ["Rabieh", "", 5, 31.98, 35.88],
    ["Shmeisani", "", 6, 31.972, 35.9],
    ["Swefieh", "", 1, 31.955, 35.865],
    ["Thuhair", "", 8, 31.97, 35.825],
    ["Tla' Al Ali", "", 7, 32.003, 35.865],
    ["Um Al Kondom", "", 3, 31.885, 35.82],
    ["Um Al Sumaq", "", 4, 31.981, 35.85],
    ["Um Uthaina", "", 2, 31.967, 35.88],
    ["University St", "", 7, 32.015, 35.872],
    ["Wadi Al Seer", "", 8, 31.955, 35.815],
    ["Yasmeen", "", 3, 31.918, 35.905],
    ["Other", "", null, null, null],
  ];
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
  const now = () => new Date().toISOString();

  function fresh() {
    const db = {
      settings: [{ id: 1, event_date: "2026-12-24", start_time: "15:00:00", end_time: "22:30:00", slot_minutes: 30,
        default_capacity: 1, cutoff_hours: 48, borrow_km: 5, booking_open: true, contact_phone: "0796441145",
        cliq_alias: "", price_note: "" }],
      cars: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Car ${i + 1}`, driver: "", phone: "", active: true, sort: i + 1, start_time: null, end_time: null })),
      areas: AREAS.map((a, i) => ({ id: i + 1, name_en: a[0], name_ar: a[1], car_id: a[2], lat: a[3], lng: a[4], active: true, sort: a[0] === "Other" ? 99 : /Circle/.test(a[0]) ? parseInt(a[0]) : 10 })),
      slot_overrides: [], bookings: [], booking_history: [], messages: [], seq: 1001,
    };
    // A few clearly-marked example bookings so the board isn't empty.
    const aid = (n) => db.areas.find((a) => a.name_en === n).id;
    const ex = [["Demo family A", "Abdoun", "16:00", 1, "new"], ["Demo family B", "Swefieh", "16:30", 1, "confirmed"], ["Demo family C", "Shmeisani", "15:00", 6, "confirmed"],
      ["Demo family D", "Khalda", "17:00", 4, "new"], ["Demo family E", "Jubeiha", "18:30", 7, "done"], ["Demo family F", "Rabieh", "19:00", 5, "new"],
      ["Demo family G", "Abdoun", "16:00", null, "waitlist"]].map(([n, a, ...r]) => [n, aid(a), ...r]);
    ex.forEach(([name, area, slot, car, status], i) => db.bookings.push({
      id: uuid(), ref: "S" + db.seq++, created_at: now(), updated_at: now(), updated_by: "public form", name, phone: "079000000" + i,
      email: "", area_id: area, lat: +(db.areas.find((x) => x.id === area).lat + (i % 3 - 1) * 0.003).toFixed(5),
      lng: +(db.areas.find((x) => x.id === area).lng + ((i + 1) % 3 - 1) * 0.003).toFixed(5), maps_link: "https://maps.google.com/?q=demo", address_details: "Example address", gift_message: i % 2 ? "Example gift note" : "",
      notes: "", payment_method: ["cash", "cliq", "transfer"][i % 3], paid: i % 3 === 1, amount: null, preferred_time: slot + ":00",
      slot_time: car ? slot + ":00" : null, car_id: car, status, admin_notes: "", lang: "en",
    }));
    db.messages.push({ id: uuid(), created_at: now(), name: "Demo visitor", phone: "0790000009", email: "", message: "Example message from the contact page.", handled: false });
    return db;
  }
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch (e) { db = fresh(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} };
  save();

  // ---- Logic mirrored from schema.sql ----
  const t5 = (v) => (v ? String(v).slice(0, 5) : null);
  // Minutes into the evening; times before 06:00 count as after midnight.
  const toMin = (s) => { const [h, m] = s.split(":").map(Number); const v = h * 60 + m; return v < 360 ? v + 1440 : v; };
  const fromMin = (m) => String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  const S = () => db.settings[0];
  const ACTIVE = ["new", "confirmed", "done"];
  function hours() {
    const s = S(), cars = db.cars.filter((c) => c.active);
    const a = Math.min(toMin(t5(s.start_time)), ...cars.filter((c) => c.start_time).map((c) => toMin(t5(c.start_time))));
    const z = Math.max(toMin(t5(s.end_time)), ...cars.filter((c) => c.end_time).map((c) => toMin(t5(c.end_time))));
    return [a, z];
  }
  function slotList() {
    const [a, z] = hours(), out = [];
    for (let m = a; m + S().slot_minutes <= z; m += S().slot_minutes) out.push(fromMin(m));
    return out;
  }
  function km(a, b, c, d) {
    if ([a, b, c, d].some((v) => v == null)) return null;
    const r = (x) => (x * Math.PI) / 180;
    const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  }
  function carFree(car, slot) {
    const c = db.cars.find((x) => x.id === car);
    const o = db.slot_overrides.find((x) => x.car_id === car && t5(x.slot_time) === slot);
    if (!c || !c.active || o?.blocked) return 0;
    if (toMin(slot) < toMin(t5(c.start_time || S().start_time)) || toMin(slot) + S().slot_minutes > toMin(t5(c.end_time || S().end_time))) return 0;
    const used = db.bookings.filter((b) => b.car_id === car && t5(b.slot_time) === slot && ACTIVE.includes(b.status)).length;
    return Math.max(0, (o?.capacity ?? S().default_capacity) - used);
  }
  function carDistance(car, slot, lat, lng) {
    const near = [fromMin(toMin(slot) - S().slot_minutes), fromMin(toMin(slot) + S().slot_minutes)];
    const ds = db.bookings.filter((b) => b.car_id === car && ACTIVE.includes(b.status) && near.includes(t5(b.slot_time)))
      .map((b) => { const a = db.areas.find((x) => x.id === b.area_id) || {}; return km(lat, lng, b.lat ?? a.lat, b.lng ?? a.lng); })
      .filter((d) => d != null);
    if (ds.length) return Math.min(...ds);
    const z = db.areas.filter((a) => a.car_id === car && a.lat != null);
    if (!z.length) return null;
    return km(lat, lng, z.reduce((s, a) => s + a.lat, 0) / z.length, z.reduce((s, a) => s + a.lng, 0) / z.length);
  }
  function pickCar(slot, areaId, lat, lng) {
    const a = db.areas.find((x) => x.id === areaId) || {};
    lat = lat ?? a.lat; lng = lng ?? a.lng;
    if (a.car_id && carFree(a.car_id, slot) > 0) return a.car_id;
    const cars = db.cars.filter((c) => c.active && c.id !== a.car_id && carFree(c.id, slot) > 0);
    if (lat == null) return cars[0]?.id ?? null;
    const ok = cars.map((c) => ({ c, d: carDistance(c.id, slot, lat, lng) }))
      .filter((x) => (x.d ?? 0) <= S().borrow_km).sort((x, y) => (x.d ?? 999) - (y.d ?? 999));
    return ok[0]?.c.id ?? null;
  }
  const isOpen = () => S().booking_open &&
    Date.now() < new Date(`${S().event_date}T${t5(S().start_time)}:00+02:00`).getTime() - S().cutoff_hours * 3600e3;

  const RPC = {
    public_config: () => ({
      event_date: S().event_date, slot_minutes: S().slot_minutes, start_time: fromMin(hours()[0]), end_time: fromMin(hours()[1]),
      open: isOpen(), contact_phone: S().contact_phone, cliq_alias: S().cliq_alias, price_note: S().price_note,
      areas: db.areas.filter((a) => a.active).sort((x, y) => x.sort - y.sort || x.name_en.localeCompare(y.name_en))
        .map((a) => ({ id: a.id, en: a.name_en, ar: a.name_ar, lat: a.lat, lng: a.lng })),
    }),
    public_availability: (p) => slotList().map((s) => ({ slot: s, available: pickCar(s, p.p_area, p.p_lat, p.p_lng) != null })),
    public_book: (p) => {
      if (!isOpen()) return { ok: false, reason: "closed" };
      if ((p.p_name || "").trim().length < 2) return { ok: false, reason: "name" };
      const phone = String(p.p_phone || "").replace(/[^0-9+]/g, "");
      if (!/^(\+?962|0)?7[789]\d{7}$/.test(phone)) return { ok: false, reason: "phone" };
      if (!db.areas.some((a) => a.id === p.p_area && a.active)) return { ok: false, reason: "area" };
      if (!["cash", "cliq", "transfer"].includes(p.p_payment)) return { ok: false, reason: "payment" };
      if (p.p_lat == null || p.p_lng == null || String(p.p_maps_link || "").trim().length < 8) return { ok: false, reason: "pin" };
      if (!slotList().includes(p.p_slot)) return { ok: false, reason: "slot" };
      const last9 = phone.replace(/\D/g, "").slice(-9);
      if (db.bookings.some((b) => b.phone.replace(/\D/g, "").endsWith(last9) && ["new", "confirmed", "waitlist"].includes(b.status)))
        return { ok: false, reason: "duplicate" };
      let car = null;
      if (!p.p_waitlist) {
        car = pickCar(p.p_slot, p.p_area, p.p_lat, p.p_lng);
        if (car == null) {
          const sug = slotList().filter((s) => pickCar(s, p.p_area, p.p_lat, p.p_lng) != null)
            .sort((a, b) => Math.abs(toMin(a) - toMin(p.p_slot)) - Math.abs(toMin(b) - toMin(p.p_slot))).slice(0, 3);
          return { ok: false, reason: "full", suggestions: sug };
        }
      }
      const ref = "S" + db.seq++;
      db.bookings.push({
        id: uuid(), ref, created_at: now(), updated_at: now(), updated_by: "public form", name: p.p_name.trim(), phone, email: p.p_email || "",
        area_id: p.p_area, lat: p.p_lat, lng: p.p_lng, maps_link: p.p_maps_link || "", address_details: p.p_address || "",
        gift_message: p.p_gift || "", notes: p.p_notes || "", payment_method: p.p_payment, paid: false, amount: null,
        preferred_time: p.p_slot + ":00", slot_time: car ? p.p_slot + ":00" : null, car_id: car, status: car ? "new" : "waitlist",
        admin_notes: "", lang: p.p_lang,
      });
      save();
      return { ok: true, ref, waitlist: car == null, slot: p.p_slot };
    },
    public_message: (p) => {
      if ((p.p_name || "").trim().length < 2 || (p.p_message || "").trim().length < 2) return { ok: false, reason: "missing" };
      db.messages.unshift({ id: uuid(), created_at: now(), name: p.p_name, phone: p.p_phone || "", email: p.p_email || "", message: p.p_message, handled: false });
      save();
      return { ok: true };
    },
    is_admin: () => true,
  };

  // ---- Minimal query builder ----
  const PK = { slot_overrides: (r) => r.car_id + "|" + t5(r.slot_time) };
  function from(table) {
    const q = { filters: [], order: [], op: "select", payload: null, single: false, returning: false };
    const run = () => {
      let rows = db[table];
      const match = (r) => q.filters.every(([c, v]) => r[c] === v || String(r[c]) === String(v));
      let out;
      if (q.op === "select") out = rows.filter(match);
      else if (q.op === "update") {
        out = rows.filter(match);
        out.forEach((r) => {
          const before = { ...r };
          Object.assign(r, q.payload, { updated_at: now() });
          if (table === "bookings") history(before, r);
        });
      } else if (q.op === "insert") {
        const r = { ...q.payload };
        if (table === "bookings") Object.assign(r, { id: uuid(), ref: "S" + db.seq++, created_at: now(), updated_at: now(), lang: "en", email: "", maps_link: "", ...q.payload });
        else if (!r.id) r.id = Math.max(0, ...rows.map((x) => x.id || 0)) + 1;
        if (table === "cars") Object.assign(r, { driver: "", phone: "", active: true, ...q.payload });
        if (table === "areas") Object.assign(r, { car_id: null, lat: null, lng: null, active: true, ...q.payload });
        rows.push(r); out = [r];
      } else if (q.op === "upsert") {
        const k = PK[table](q.payload);
        db[table] = rows = rows.filter((x) => PK[table](x) !== k);
        rows.push({ ...q.payload }); out = [q.payload];
      } else if (q.op === "delete") {
        out = rows.filter(match); db[table] = rows.filter((r) => !match(r));
      }
      if (q.op !== "select") save();
      for (const [c, asc] of q.order.slice().reverse()) out = out.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      out = JSON.parse(JSON.stringify(out));
      return { data: q.single ? out[0] ?? null : out, error: null };
    };
    const b = {
      select() { if (q.op !== "select") q.returning = true; return b; },
      order(c, o) { q.order.push([c, o?.ascending !== false]); return b; },
      eq(c, v) { q.filters.push([c, v]); return b; },
      single() { q.single = true; return b; },
      update(p) { q.op = "update"; q.payload = p; return b; },
      insert(p) { q.op = "insert"; q.payload = p; return b; },
      upsert(p) { q.op = "upsert"; q.payload = p; return b; },
      delete() { q.op = "delete"; return b; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
    };
    return b;
  }
  function history(before, after) {
    const changes = {};
    for (const k of Object.keys(after)) if (!["updated_at", "updated_by"].includes(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k])) changes[k] = [before[k], after[k]];
    if (Object.keys(changes).length) db.booking_history.push({ id: Date.now(), booking_id: after.id, at: now(), by_name: after.updated_by || "admin", changes });
  }

  let session = null;
  try { session = sessionStorage.getItem("santa-demo-session") ? { user: {} } : null; } catch (e) {}
  window.SantaDemo = {
    createClient() {
      return {
        rpc: async (name, params) => {
          await new Promise((r) => setTimeout(r, 120));
          try { db = JSON.parse(localStorage.getItem(KEY)) || db; } catch (e) {}
          return RPC[name] ? { data: RPC[name](params || {}), error: null } : { data: null, error: { message: "unknown function " + name } };
        },
        from: (t) => { try { db = JSON.parse(localStorage.getItem(KEY)) || db; } catch (e) {} return from(t); },
        auth: {
          getSession: async () => ({ data: { session } }),
          signInWithPassword: async () => { session = { user: {} }; try { sessionStorage.setItem("santa-demo-session", "1"); } catch (e) {} return { error: null }; },
          signOut: async () => { session = null; try { sessionStorage.removeItem("santa-demo-session"); } catch (e) {} return { error: null }; },
        },
        channel: () => { const c = { on: () => c, subscribe: () => c }; addEventListener("storage", (e) => e.key === KEY && window.dispatchEvent(new Event("santa-demo-change"))); return c; },
      };
    },
    reset() { localStorage.removeItem(KEY); location.reload(); },
  };
})();
