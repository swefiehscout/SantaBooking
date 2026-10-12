// Public booking form.
(function () {
  const { sb, slotLabel, normPhone, esc, page, parseMapsLink, isShortMapsLink, pinPicker } = window.Santa;
  const $ = (id) => document.getElementById(id);

  let config = null;
  let slots = [];          // [{slot, available}]
  let chosen = null;       // "15:30"
  let pin = null;          // {lat, lng}
  let picker;
  let availTimer = 0, availSeq = 0;

  const label = (s) => slotLabel(s, config.slot_minutes);

  // ---------- Areas & map ----------
  function fillAreas() {
    const sorted = [...config.areas].sort((a, b) =>
      a.en === "Other" ? 1 : b.en === "Other" ? -1 : a.en.localeCompare(b.en, "en", { numeric: true }));
    $("area").innerHTML = `<option value="" disabled selected>Choose your area</option>` +
      sorted.map((a) => `<option value="${a.id}">${esc(a.en)}</option>`).join("");
  }
  const currentArea = () => config.areas.find((a) => String(a.id) === $("area").value) || null;

  $("area").addEventListener("change", () => {
    $("area").classList.remove("invalid");
    const a = currentArea();
    if (a && a.lat != null && !pin) picker.view(a.lat, a.lng, 15);
    loadAvailability();
  });

  function initMap() {
    picker = pinPicker($("map"), {
      onChange: (p) => {
        pin = p;
        $("pin-state").textContent = "Your home is marked. Drag the pin to adjust it.";
        $("pin-state").classList.add("ok");
        $("pin-err").hidden = true;
        loadAvailability();
      },
    });
  }
  $("locate").onclick = () => {
    const say = (t) => ($("pin-state").textContent = t);
    if (!navigator.geolocation) return say("Your browser can't share its location. Tap the map instead.");
    say("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (p) => picker.set(p.coords.latitude, p.coords.longitude, true),
      () => say("We couldn't get your location. Tap the map instead."),
      { enableHighAccuracy: true, timeout: 10000 });
  };
  // A pasted link with coordinates places the pin for them.
  $("maps").addEventListener("input", () => {
    const v = $("maps").value;
    $("maps").classList.remove("invalid");
    $("maps-err").hidden = true;
    const c = parseMapsLink(v);
    if (c) {
      picker.set(c.lat, c.lng, true);
      $("maps-hint").textContent = "We placed the pin from your link. Check it's on your home.";
    } else if (isShortMapsLink(v)) {
      $("maps-hint").textContent = "Thanks. Please also tap your home on the map above.";
    } else {
      $("maps-hint").textContent = "In Google Maps, tap your home, then Share, then Copy link.";
    }
  });
  const looksLikeMaps = (v) => /google\.[a-z.]+\/maps|maps\.google|goo\.gl|maps\.app/i.test(v) || !!parseMapsLink(v);

  // ---------- Times ----------
  function loadAvailability() {
    clearTimeout(availTimer);
    availTimer = setTimeout(async () => {
      const a = currentArea();
      if (!a) { slots = []; renderSlots(); return; }
      const seq = ++availSeq;
      const { data, error } = await sb.rpc("public_availability", {
        p_area: a.id, p_lat: pin ? pin.lat : null, p_lng: pin ? pin.lng : null,
      });
      if (seq !== availSeq) return;
      if (error) { console.error(error); return; }
      slots = data || [];
      if (chosen && !slots.some((s) => s.slot === chosen && s.available) && slots.some((s) => s.available)) chosen = null;
      renderSlots();
    }, 250);
  }
  function renderSlots() {
    const box = $("slots");
    if (!currentArea()) {
      box.innerHTML = `<div class="slots-empty" style="grid-column:1/-1">Choose your area first to see the free times.</div>`;
      return;
    }
    const anyFree = slots.some((s) => s.available);
    // When every time is full, keep them clickable so the family can join the waitlist.
    box.innerHTML = (anyFree ? "" : `<div class="slots-empty" style="grid-column:1/-1">Every time is taken in your area. Choose one to join the waitlist.</div>`) +
      slots.map((s) => `<button type="button" class="slot" data-slot="${s.slot}" aria-pressed="${chosen === s.slot}" ${anyFree && !s.available ? "disabled" : ""}>
          <span class="t">${esc(label(s.slot))}</span><small>${s.available ? "Available" : "Taken"}</small></button>`).join("");
    box.querySelectorAll(".slot").forEach((b) => (b.onclick = () => {
      chosen = b.dataset.slot;
      $("slot-err").hidden = true;
      renderSlots();
    }));
  }

  // ---------- Donation note ----------
  function renderPrice() {
    const parts = [];
    if (config.price_note) parts.push(config.price_note);
    const pay = document.querySelector("input[name=pay]:checked")?.value;
    if (pay === "cliq" && config.cliq_alias) parts.push(`CliQ alias: ${config.cliq_alias}`);
    $("price").textContent = parts.join(" · ");
    $("price").hidden = parts.length === 0;
  }
  document.querySelectorAll("input[name=pay]").forEach((r) => r.addEventListener("change", () => { $("pay-err").hidden = true; renderPrice(); }));

  // ---------- Submit ----------
  function showError(msg) {
    $("form-error").textContent = msg || "";
    $("form-error").hidden = !msg;
  }
  function validate() {
    let ok = true, first = null;
    const mark = (el, bad) => { el.classList.toggle("invalid", bad); if (bad) { ok = false; first = first || el; } };
    mark($("area"), !$("area").value);
    $("pin-err").hidden = !!pin;
    if (!pin) { $("map").classList.add("invalid"); ok = false; first = first || $("map"); }
    const linkBad = !looksLikeMaps($("maps").value.trim());
    mark($("maps"), linkBad);
    $("maps-err").hidden = !linkBad;
    mark($("name"), $("name").value.trim().length < 2);
    const phoneBad = !normPhone($("phone").value);
    mark($("phone"), phoneBad);
    $("phone-err").hidden = !phoneBad;
    if (!chosen) { ok = false; $("slot-err").hidden = false; first = first || $("slots"); }
    const payBad = !document.querySelector("input[name=pay]:checked");
    $("pay-err").hidden = !payBad;
    if (payBad) { ok = false; first = first || document.querySelector(".pay"); }
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
    return ok;
  }

  const REASONS = {
    closed: "Bookings have just closed.",
    name: "Please enter your name.",
    phone: "Please check the mobile number.",
    area: "Please choose your area.",
    slot: "Please choose a time.",
    pin: "Please place a pin on your home and paste its Google Maps link.",
    payment: "Please choose how you will donate.",
    duplicate: "This mobile number already has a booking. Contact us if you need to change it.",
  };

  async function book(slot, waitlist) {
    const btn = $("submit");
    btn.disabled = true;
    btn.textContent = "Reserving…";
    showError("");
    const { data, error } = await sb.rpc("public_book", {
      p_name: $("name").value, p_phone: normPhone($("phone").value), p_email: $("email").value,
      p_area: Number($("area").value), p_lat: pin ? pin.lat : null, p_lng: pin ? pin.lng : null,
      p_maps_link: $("maps").value, p_address: $("address").value, p_gift: $("gift").value,
      p_notes: $("notes").value, p_payment: document.querySelector("input[name=pay]:checked").value,
      p_slot: slot, p_waitlist: !!waitlist, p_lang: "en",
    });
    btn.disabled = false;
    btn.textContent = "Reserve the Visit";
    if (error || !data) { console.error(error); return showError("Your booking didn't go through. Check your connection and try again."); }
    if (data.ok) return showDone(data);
    if (data.reason === "full") return showFull(slot, data.suggestions || []);
    if (data.reason === "closed") return showClosed();
    showError(REASONS[data.reason] || "Something went wrong. Please try again.");
  }

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validate()) return;
    book(chosen, !slots.some((s) => s.available));
  });

  function showDone(res) {
    $("form").hidden = true;
    const r = $("result");
    r.hidden = false;
    r.innerHTML = `
      <p class="eyebrow">${res.waitlist ? "On the waitlist" : "Reservation received"}</p>
      <h2>${res.waitlist ? "We'll Call If a Place Opens" : "You're on Santa's List!"}</h2>
      <div class="ticket">
        <span class="label">Booking number</span>
        <span class="ref">${esc(res.ref)}</span>
        <span class="t">${esc(label(res.slot))} · Christmas Eve</span>
      </div>
      <p>${res.waitlist
        ? "That time is full for now. You're on the waitlist, and we'll call you if a place opens up."
        : "Our team will call you before Christmas Eve to confirm. Please keep your booking number."}</p>
      ${config.contact_phone ? `<p>Questions? Call us on <strong>${esc(config.contact_phone)}</strong></p>` : ""}
      <button type="button" class="ghost" id="again">Reserve another visit</button>`;
    $("again").onclick = () => location.reload();
    r.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showFull(slot, suggestions) {
    $("form").hidden = true;
    const r = $("result");
    r.hidden = false;
    r.innerHTML = `
      <p class="eyebrow">Just taken</p>
      <h2>That Time Has Filled Up</h2>
      ${suggestions.length ? `<p>These times are still free near you:</p>
        <div class="sugg">${suggestions.map((s) => `<button type="button" class="slot" data-s="${s}"><span class="t">${esc(label(s))}</span></button>`).join("")}</div>` : ""}
      <button type="button" class="ghost" id="wl">Join the waitlist for ${esc(label(slot))}</button>`;
    const retry = async (s, wl) => {
      r.hidden = true;
      $("form").hidden = false;
      chosen = s;
      await book(s, wl);
      loadAvailability();
    };
    r.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => retry(b.dataset.s, false)));
    $("wl").onclick = () => retry(slot, true);
  }

  function showClosed() {
    $("loading").hidden = true;
    $("form").hidden = true;
    $("closed").hidden = false;
    $("closed-contact").textContent = config?.contact_phone ? `Questions? Call us on ${config.contact_phone}` : "";
  }

  // ---------- Start ----------
  async function start() {
    page("book");
    const { data, error } = await sb.rpc("public_config");
    if (error || !data) {
      console.error(error);
      $("loading").querySelector("p").textContent = "We couldn't open the booking form. Check your connection and refresh the page.";
      return;
    }
    config = data;
    $("loading").hidden = true;
    const d = new Date(config.event_date + "T12:00:00");
    $("date-tag").textContent = "Christmas Eve · " + d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    if (!config.open) return showClosed();
    $("form").hidden = false;
    fillAreas();
    renderPrice();
    initMap();
    renderSlots();
  }
  start();
})();
