// Helpers used by the public pages and the admin dashboard.
(function () {
  const cfg = window.SANTA_CONFIG;
  // Run on sample data in this browser (demo.js) until real Supabase keys are in config.js,
  // or when an owner presses "Demo mode" on the admin page (for presentations; real data is never touched).
  let asked = false;
  try { asked = /\/admin(\.html)?$/.test(location.pathname) && sessionStorage.getItem("santa-demo") === "1"; } catch (e) {}
  const demo = (/YOUR-PROJECT/.test(cfg.SUPABASE_URL) || asked) && window.SantaDemo;
  const sb = demo ? window.SantaDemo.createClient() : window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  if (demo) addEventListener("DOMContentLoaded", () => {
    const tag = document.createElement("div");
    tag.textContent = "Demo preview · sample data";
    tag.style.cssText = "position:fixed;top:10px;right:10px;z-index:99;opacity:.85;background:#c9a24e;color:#1f0508;font:600 12px system-ui;padding:4px 10px;border-radius:999px;pointer-events:none";
    document.body.appendChild(tag);
  });

  // "15:30" -> minutes since midnight
  function toMin(hhmm) {
    const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
    return h * 60 + m;
  }
  // minutes -> "15:30"
  function fromMin(min) {
    const h = Math.floor(min / 60) % 24, m = min % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }
  // "15:30" -> "3:30 PM"
  function clock(hhmm) {
    const min = toMin(hhmm);
    const h = Math.floor(min / 60) % 24;
    return `${h % 12 || 12}:${String(min % 60).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  }
  // "15:30", 30 -> "3:30 – 4:00 PM"
  function slotLabel(hhmm, slotMinutes) {
    const a = clock(hhmm), b = clock(fromMin(toMin(hhmm) + slotMinutes));
    const [aT, aS] = a.split(" "), [bT, bS] = b.split(" ");
    return aS === bS ? `${aT} – ${bT} ${bS}` : `${a} – ${b}`;
  }
  // Jordanian mobile -> "0791234567"; null if invalid
  function normPhone(raw) {
    let d = String(raw || "").replace(/[^\d+]/g, "");
    d = d.replace(/^00962/, "0").replace(/^\+?962/, "0");
    if (/^7[789]\d{7}$/.test(d)) d = "0" + d;
    return /^07[789]\d{7}$/.test(d) ? d : null;
  }
  // "0791234567" -> "962791234567" for wa.me links
  function waNumber(phone) {
    const p = normPhone(phone);
    return p ? "962" + p.slice(1) : "";
  }
  function km(lat1, lng1, lat2, lng2) {
    if ([lat1, lng1, lat2, lng2].some((v) => v == null)) return null;
    const r = (x) => (x * Math.PI) / 180;
    const a = Math.sin(r(lat2 - lat1) / 2) ** 2 +
      Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(a));
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  // Opens the pin in Google Maps (falls back to the family's own link).
  function mapsUrl(b) {
    if (b.lat != null && b.lng != null) return `https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}`;
    return b.maps_link || "";
  }
  // Starts Google Maps driving directions to the pin.
  function navUrl(b) {
    if (b.lat != null && b.lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}&travelmode=driving`;
    return b.maps_link || "";
  }

  // ================= Map pin =================

  // Pull coordinates out of a Google Maps link (or plain "31.95, 35.86"). Short links can't be read.
  function parseMapsLink(text) {
    const t = String(text || "").trim();
    if (!t) return null;
    const pats = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /[?&](?:q|query|ll|destination|daddr)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/,
      /@(-?\d+\.\d+),(-?\d+\.\d+)/, /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/];
    for (const re of pats) {
      const m = t.match(re);
      if (m) {
        const lat = Number(m[1]), lng = Number(m[2]);
        if (lat > 29 && lat < 33.5 && lng > 34.8 && lng < 39.5) return { lat, lng };
      }
    }
    return null;
  }
  const isShortMapsLink = (t) => /goo\.gl|maps\.app/i.test(String(t || ""));

  // A Leaflet map where you tap to drop (and drag to adjust) one pin.
  function pinPicker(el, opts = {}) {
    const map = L.map(el, { scrollWheelZoom: false }).setView(opts.center || [31.965, 35.88], opts.zoom || 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    let marker = null, pos = null;
    function set(lat, lng, pan) {
      pos = { lat: +Number(lat).toFixed(6), lng: +Number(lng).toFixed(6) };
      if (!marker) {
        marker = L.marker([pos.lat, pos.lng], { draggable: true }).addTo(map);
        marker.on("dragend", () => { const p = marker.getLatLng(); set(p.lat, p.lng); });
      } else marker.setLatLng([pos.lat, pos.lng]);
      if (pan) map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 16));
      el.classList.remove("invalid");
      opts.onChange && opts.onChange(pos);
    }
    map.on("click", (e) => set(e.latlng.lat, e.latlng.lng));
    if (opts.lat != null && opts.lng != null) set(opts.lat, opts.lng, true);
    setTimeout(() => map.invalidateSize(), 80);
    return { map, set, get: () => pos, view: (lat, lng, z) => map.setView([lat, lng], z || 15) };
  }

  // ================= Public page frame & ornaments =================

  const FLOURISH = `<svg viewBox="0 0 220 18" aria-hidden="true"><defs>
    <linearGradient id="fl-l" x1="0" x2="1"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset="1" stop-color="currentColor"/></linearGradient>
    <linearGradient id="fl-r" x1="1" x2="0"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset="1" stop-color="currentColor"/></linearGradient></defs>
    <rect x="0" y="8.5" width="86" height="1" fill="url(#fl-l)"/><rect x="134" y="8.5" width="86" height="1" fill="url(#fl-r)"/>
    <circle cx="93" cy="9" r="1.6" fill="currentColor"/><circle cx="127" cy="9" r="1.6" fill="currentColor"/>
    <path d="M101 9 L105 5 L109 9 L105 13Z M111 9 L115 5 L119 9 L115 13Z" fill="none" stroke="currentColor" stroke-width="1"/>
    <path d="M110 1.5 L112 7 L117.5 9 L112 11 L110 16.5 L108 11 L102.5 9 L108 7Z" fill="currentColor"/></svg>`;

  // Holly wreath with berries and a bow, drawn around the badge. Mirror-symmetric.
  function wreathSvg() {
    const leaf = "M0,0 C5,-6 3,-12 8,-17 C5,-21 7,-27 4,-33 C2,-37 0,-42 0,-42 C0,-42 -2,-37 -4,-33 C-7,-27 -5,-21 -8,-17 C-3,-12 -5,-6 0,0Z";
    const layers = [
      { r: 160, n: 44, s: 1.18, tilt: 38, fill: ["#173d29", "#1f4d33"] },
      { r: 143, n: 40, s: 1.08, tilt: -34, fill: ["#2a6342", "#1f4d33"] },
      { r: 126, n: 36, s: 0.92, tilt: 46, fill: ["#327650", "#24573a"] },
    ];
    let g = "";
    for (const L of layers) {
      for (let i = 0; i < L.n; i++) {
        const deg = -90 + ((i + 0.5) * 360) / L.n;
        const rad = (deg * Math.PI) / 180;
        const x = 200 + L.r * Math.cos(rad), y = 200 + L.r * Math.sin(rad);
        const side = x >= 200 ? 1 : -1;
        const rot = deg + 90 + L.tilt * side;
        g += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)}) scale(${L.s})">
          <path d="${leaf}" fill="${L.fill[i % 2]}"/><path d="M0,-2 L0,-38" stroke="#5c9a72" stroke-width=".9" opacity=".6"/></g>`;
      }
    }
    let berries = "";
    for (const deg of [-90, -45, 0, 45, 135, 180, 225]) {
      const rad = (deg * Math.PI) / 180;
      const cx = 200 + 146 * Math.cos(rad), cy = 200 + 146 * Math.sin(rad);
      for (const [dx, dy] of [[-6, 3], [6, 3], [0, -6]]) {
        berries += `<circle cx="${(cx + dx).toFixed(1)}" cy="${(cy + dy).toFixed(1)}" r="6.5" fill="url(#berry)"/>`;
      }
    }
    // Gold beads tucked between the leaves.
    let beads = "";
    for (let i = 0; i < 24; i++) {
      const deg = -90 + ((i + 0.5) * 360) / 24;
      if (Math.abs(deg - 90) < 20) continue;
      const rad = (deg * Math.PI) / 180;
      beads += `<circle cx="${(200 + 134 * Math.cos(rad)).toFixed(1)}" cy="${(200 + 134 * Math.sin(rad)).toFixed(1)}" r="2.6" fill="url(#bead)"/>`;
    }
    const bow = `<g stroke="#e8c879" stroke-width="1.6" stroke-linejoin="round">
      <path d="M200 352 C176 316 132 322 140 352 C146 376 178 368 200 352Z" fill="url(#ribbon)"/>
      <path d="M200 352 C224 316 268 322 260 352 C254 376 222 368 200 352Z" fill="url(#ribbon)"/>
      <path d="M194 358 L170 404 L183 399 L188 412 L203 362Z" fill="url(#ribbon)"/>
      <path d="M206 358 L230 404 L217 399 L212 412 L197 362Z" fill="url(#ribbon)"/>
      <rect x="189" y="341" width="22" height="22" rx="7" fill="#7a151c"/></g>`;
    return `<svg viewBox="0 0 400 400" aria-hidden="true"><defs>
      <radialGradient id="berry" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#ff6b6b"/><stop offset=".45" stop-color="#c3142a"/><stop offset="1" stop-color="#6d0712"/></radialGradient>
      <radialGradient id="bead" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#d9b25a"/><stop offset="1" stop-color="#8a6420"/></radialGradient>
      <linearGradient id="ribbon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b3262f"/><stop offset="1" stop-color="#6e1018"/></linearGradient>
      <filter id="wshadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#000" flood-opacity=".45"/></filter></defs>
      <g filter="url(#wshadow)">${g}${beads}${berries}</g>${bow}</svg>`;
  }

  // A swagged string of lights across the top of the page, centred and mirror-symmetric.
  function drawGarland(el) {
    const W = el.clientWidth || innerWidth;
    let n = Math.max(3, Math.round(W / 190));
    if (n % 2 === 0) n += 1;
    const sw = W / n, depth = 30, top = 4;
    const colors = ["#f6d36b", "#e5484d", "#4fb37a", "#fff2d6", "#e5484d", "#4fb37a"];
    let wire = "", bulbs = "", ornaments = "";
    const all = [];
    for (let i = 0; i < n; i++) {
      const x0 = i * sw, x1 = x0 + sw, cx = x0 + sw / 2;
      wire += `M${x0.toFixed(1)},${top} Q${cx.toFixed(1)},${top + depth * 2} ${x1.toFixed(1)},${top} `;
      for (const t of [0.2, 0.4, 0.6, 0.8]) {
        const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1;
        const y = (1 - t) * (1 - t) * top + 2 * (1 - t) * t * (top + depth * 2) + t * t * top;
        all.push([x, y]);
      }
    }
    const mid = (all.length - 1) / 2;
    all.forEach(([x, y], k) => {
      const d = Math.round(Math.abs(k - mid));
      const c = colors[d % colors.length];
      bulbs += `<g class="bulb" style="animation-delay:${((d % 5) * 0.55).toFixed(2)}s" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
        <rect x="-2.5" y="0" width="5" height="4" rx="1" fill="#b38b3a"/>
        <ellipse cx="0" cy="11" rx="5" ry="7.5" fill="${c}" filter="url(#glow)"/>
        <ellipse cx="-1.6" cy="8.5" rx="1.4" ry="2.4" fill="#fff" opacity=".55"/></g>`;
    });
    for (let i = 0; i <= n; i++) {
      const x = i * sw;
      ornaments += `<line x1="${x.toFixed(1)}" y1="${top}" x2="${x.toFixed(1)}" y2="${top + 16}" stroke="#b38b3a" stroke-width="1"/>
        <circle cx="${x.toFixed(1)}" cy="${top + 24}" r="7.5" fill="url(#ball)"/>
        <rect x="${(x - 2.5).toFixed(1)}" y="${top + 14}" width="5" height="3" fill="#b38b3a"/>`;
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} 70" preserveAspectRatio="none" aria-hidden="true"><defs>
      <filter id="glow" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <radialGradient id="ball" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#fff1bf"/><stop offset=".5" stop-color="#cfa44c"/><stop offset="1" stop-color="#7c5717"/></radialGradient></defs>
      <path class="fir" d="${wire}"/><path class="wire" d="${wire}"/>${ornaments}${bulbs}</svg>`;
  }

  const NAV = [
    ["index", "Home"],
    ["book", "Book a Visit"],
    ["contact", "Contact"],
    ["admin", "Team Sign In"],
  ];
  function masthead(current) {
    const link = ([key, text]) =>
      `<a class="navlink" href="${key}.html"${key === current ? ' aria-current="page"' : ""}>${text}</a>`;
    return `<nav class="side start">${NAV.slice(0, 2).map(link).join("")}</nav>
      <a class="wordmark" href="index.html"><b>Santa Booking</b><span>by the Swefieh Orthodox Scouts</span></a>
      <nav class="side end">${NAV.slice(2).map(link).join("")}</nav>`;
  }
  function footer() {
    return `<span class="flourish">${FLOURISH}</span>
      <span class="org">${esc(cfg.ORG_NAME_EN)}</span>
      <small>Spreading Christmas joy across Amman since 2008</small>
      <a class="team" href="admin.html">Team sign in</a>`;
  }

  // Draws the shared frame on a public page.
  function page(current) {
    const g = document.querySelector(".garland");
    if (g) { drawGarland(g); let t; addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => drawGarland(g), 150); }); }
    const m = document.querySelector(".masthead");
    if (m) m.innerHTML = masthead(current);
    const f = document.querySelector(".foot");
    if (f) f.innerHTML = footer();
    document.querySelectorAll(".flourish:empty").forEach((el) => (el.innerHTML = FLOURISH));
    document.querySelectorAll(".wreath").forEach((el) => el.insertAdjacentHTML("afterbegin", wreathSvg()));
    snow();
  }

  // Gentle snowfall with the odd golden sparkle on <canvas id="snow">.
  function snow() {
    const c = document.getElementById("snow");
    if (!c || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = c.getContext("2d");
    let flakes = [];
    function size() {
      c.width = innerWidth * devicePixelRatio;
      c.height = innerHeight * devicePixelRatio;
      flakes = Array.from({ length: Math.min(70, Math.floor(innerWidth / 16)) }, (_, i) => ({
        x: Math.random() * c.width, y: Math.random() * c.height, gold: i % 7 === 0,
        r: (Math.random() * 1.6 + 0.6) * devicePixelRatio, s: Math.random() * 0.4 + 0.2, d: Math.random() * 6.28,
      }));
    }
    size();
    addEventListener("resize", size);
    (function tick() {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const f of flakes) {
        f.y += f.s * devicePixelRatio;
        f.d += 0.01;
        f.x += Math.sin(f.d) * 0.3 * devicePixelRatio;
        if (f.y > c.height) { f.y = -5; f.x = Math.random() * c.width; }
        ctx.fillStyle = f.gold ? "rgba(241,217,142,.8)" : "rgba(255,248,236,.6)";
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, 6.28);
        ctx.fill();
      }
      requestAnimationFrame(tick);
    })();
  }

  window.Santa = { cfg, sb, demo: !!demo, toMin, fromMin, clock, slotLabel, normPhone, waNumber, km, esc, mapsUrl, navUrl, page, parseMapsLink, isShortMapsLink, pinPicker };
})();
