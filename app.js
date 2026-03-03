mapboxgl.accessToken = "pk.eyJ1Ijoib2tkZW1zIiwiYSI6ImNtbTl1b3FhdzA3M2UycHBvZmZxYzRmYXgifQ.MGb9x34kBeR0lDV8FMc95A";

// ✅ Paste your Apps Script Web App URL here:
const SHEET_API_URL = "https://script.google.com/macros/s/AKfycbzxwBGQkJZIFDv2Q_NTTwkNtoO-hKaOOPaACoYihZhFnDhflCbNreqC-7dmlqFLLPwztg/exec";

const REFRESH_MS = 60000;

// Mobile sheet snap points (px and vh) computed at runtime
let SHEET_COLLAPSED_PX = 160;
let SHEET_MID_PX = 360;
let SHEET_EXPANDED_PX = 0; // set on init

let map;
let allData = { type: "FeatureCollection", features: [] };

const el = {
  panel: document.getElementById("panel"),
  sheetHandle: document.getElementById("sheetHandle"),
  collapseBtn: document.getElementById("collapseBtn"),
  status: document.getElementById("status"),
  count: document.getElementById("store-count"),
  listings: document.getElementById("listings"),
  filter: document.getElementById("filter"),
};

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function setStatus(msg) {
  el.status.textContent = msg || "";
}

function setCount(n) {
  el.count.textContent = `Chapters: ${n}`;
}

function ensureHttp(url) {
  if (!url) return "";
  const u = String(url).trim();
  if (!u) return "";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return "https://" + u;
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function loadGeoJSON() {
  const res = await fetchWithTimeout(SHEET_API_URL, 10000);
  if (!res.ok) throw new Error(`API HTTP ${res.status}`);

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("API did not return JSON (wrong URL or not public)");
  }

  if (!json || json.type !== "FeatureCollection" || !Array.isArray(json.features)) {
    throw new Error("API JSON is not a GeoJSON FeatureCollection");
  }

  // Ensure stable numeric ids
  json.features = json.features.map((f, i) => {
    if (!f.properties) f.properties = {};
    if (!Number.isFinite(f.properties.id)) f.properties.id = i;
    return f;
  });

  return json;
}

function smoothFlyTo(coords) {
  map.flyTo({
    center: coords,
    zoom: 12,
    speed: 0.85,
    curve: 1.25,
    essential: true
  });
}

function clearPopups() {
  const popUps = document.getElementsByClassName("mapboxgl-popup");
  if (popUps[0]) popUps[0].remove();
}

function openPopup(feature) {
  clearPopups();

  const p = feature.properties || {};
  const join = ensureHttp(p.joinUrl);

  new mapboxgl.Popup({ offset: 16, closeButton: true, closeOnClick: true })
    .setLngLat(feature.geometry.coordinates)
    .setHTML(`
      <div>
        <div class="popup-title">${p.name || "Chapter"}</div>
        <div class="popup-address">${p.address || ""}</div>
        <div class="popup-actions">
          ${p.email ? `<a class="pill email" href="mailto:${p.email}">Email</a>` : ""}
          ${join ? `<a class="pill join" href="${join}" target="_blank" rel="noopener">Join →</a>` : ""}
        </div>
      </div>
    `)
    .addTo(map);
}

function setActiveListing(id) {
  document.querySelectorAll(".item").forEach(n => n.classList.remove("active"));
  const node = document.getElementById(`listing-${id}`);
  if (node) node.classList.add("active");
}

function buildSidebar(data) {
  el.listings.innerHTML = "";
  setCount(data.features.length);

  for (const feature of data.features) {
    const p = feature.properties || {};
    const join = ensureHttp(p.joinUrl);

    const item = document.createElement("div");
    item.className = "item";
    item.id = `listing-${p.id}`;

    const title = document.createElement("a");
    title.href = "#";
    title.className = "titlelink";
    title.textContent = p.name || "Chapter";
    title.addEventListener("click", (e) => {
      e.preventDefault();
      smoothFlyTo(feature.geometry.coordinates);
      openPopup(feature);
      setActiveListing(p.id);
      if (isMobile()) setSheetHeight(SHEET_MID_PX, true);
    });

    const details = document.createElement("div");
    details.className = "details";
    details.textContent = p.address || "";

    const meta = document.createElement("div");
    meta.className = "meta";

    if (p.email) {
      const email = document.createElement("a");
      email.className = "pill email";
      email.href = `mailto:${p.email}`;
      email.textContent = "Email";
      meta.appendChild(email);
    }

    if (join) {
      const joinBtn = document.createElement("a");
      joinBtn.className = "pill join";
      joinBtn.href = join;
      joinBtn.target = "_blank";
      joinBtn.rel = "noopener";
      joinBtn.textContent = "Join →";
      meta.appendChild(joinBtn);
    }

    item.appendChild(title);
    item.appendChild(details);
    if (meta.children.length) item.appendChild(meta);
    el.listings.appendChild(item);
  }
}

function filterData(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return allData;

  return {
    type: "FeatureCollection",
    features: allData.features.filter(f => {
      const p = f.properties || {};
      const name = String(p.name || "").toLowerCase();
      const address = String(p.address || "").toLowerCase();
      return name.includes(q) || address.includes(q);
    })
  };
}

/* ===== Sheet mechanics (mobile only) ===== */

function recomputeSheetHeights() {
  // collapsed: enough to show header + search + a couple cards
  SHEET_COLLAPSED_PX = 160;
  SHEET_MID_PX = Math.round(window.innerHeight * 0.52);
  SHEET_EXPANDED_PX = Math.round(window.innerHeight * 0.80);
}

function setSheetHeight(px, animate = false) {
  if (!isMobile()) return;

  const clamped = Math.max(SHEET_COLLAPSED_PX, Math.min(SHEET_EXPANDED_PX, px));
  el.panel.style.setProperty("--sheet-h", `${clamped}px`);

  // optional animation: let CSS transitions happen by temporarily adding inline transition
  if (animate) {
    el.panel.style.transition = "height 220ms ease";
    setTimeout(() => { el.panel.style.transition = ""; }, 240);
  }

  updateMapPadding();
}

function snapSheet(px) {
  // snap to nearest of collapsed/mid/expanded
  const points = [SHEET_COLLAPSED_PX, SHEET_MID_PX, SHEET_EXPANDED_PX];
  let nearest = points[0];
  let best = Math.abs(px - points[0]);
  for (const p of points) {
    const d = Math.abs(px - p);
    if (d < best) { best = d; nearest = p; }
  }
  setSheetHeight(nearest, true);
}

function currentSheetHeight() {
  const v = getComputedStyle(el.panel).getPropertyValue("--sheet-h").trim();
  const n = Number(String(v).replace("px", ""));
  return Number.isFinite(n) ? n : SHEET_COLLAPSED_PX;
}

/* ===== Map padding (desktop and mobile) ===== */

function updateMapPadding() {
  if (!map) return;

  if (!isMobile()) {
    // keep controls & viewport away from sidebar
    map.setPadding({ top: 10, bottom: 10, left: 440, right: 10 });
    return;
  }

  const h = currentSheetHeight();
  // bottom padding = sheet height + margin, so markers aren’t hidden
  map.setPadding({ top: 10, bottom: h + 20, left: 10, right: 10 });
}

/* ===== Mobile drag handling (pointer events) ===== */

function attachSheetDrag() {
  if (!el.sheetHandle) return;

  let dragging = false;
  let startY = 0;
  let startH = 0;

  const onDown = (e) => {
    if (!isMobile()) return;
    dragging = true;
    startY = e.clientY;
    startH = currentSheetHeight();
    el.sheetHandle.setPointerCapture(e.pointerId);
  };

  const onMove = (e) => {
    if (!dragging || !isMobile()) return;
    const dy = startY - e.clientY;     // moving finger up increases height
    const next = startH + dy;
    setSheetHeight(next, false);
  };

  const onUp = (e) => {
    if (!dragging || !isMobile()) return;
    dragging = false;
    try { el.sheetHandle.releasePointerCapture(e.pointerId); } catch {}
    snapSheet(currentSheetHeight());
  };

  el.sheetHandle.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);

  // Tap handle to toggle between collapsed and mid
  el.sheetHandle.addEventListener("click", () => {
    if (!isMobile()) return;
    const h = currentSheetHeight();
    const target = (h <= SHEET_COLLAPSED_PX + 30) ? SHEET_MID_PX : SHEET_COLLAPSED_PX;
    setSheetHeight(target, true);
  });
}

async function init() {
  recomputeSheetHeights();

  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/standard",
    center: [-97.5, 35.5],
    zoom: 6
  });

  map.addControl(new mapboxgl.NavigationControl(), "top-right");

  // Geocoder (top-left)
  const geocoder = new MapboxGeocoder({
    accessToken: mapboxgl.accessToken,
    mapboxgl,
    marker: false,
    placeholder: "Search a place…"
  });
  map.addControl(geocoder, "top-left");

  // Filter updates list AND map
  el.filter.addEventListener("input", () => {
    const showing = filterData(el.filter.value);
    buildSidebar(showing);
    const src = map.getSource("places");
    if (src) src.setData(showing);
  });

  // Collapse button (mobile only)
  el.collapseBtn.addEventListener("click", () => {
    if (!isMobile()) return;
    setSheetHeight(SHEET_COLLAPSED_PX, true);
  });

  // Drag behavior
  attachSheetDrag();

  // On resize/orientation changes, recompute snap points + update padding
  window.addEventListener("resize", () => {
    recomputeSheetHeights();
    if (isMobile()) {
      // keep current height within new bounds
      setSheetHeight(currentSheetHeight(), false);
    }
    map.resize();
    updateMapPadding();
  });

  map.on("load", async () => {
    try {
      setStatus("Loading…");
      allData = await loadGeoJSON();

      map.addSource("places", { type: "geojson", data: allData });

      map.addLayer({
        id: "locations",
        type: "circle",
        source: "places",
        paint: {
          "circle-radius": 9,
          "circle-color": "#E63946",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#F1FAEE",
          "circle-opacity": 0.95
        }
      });

      // Initial UI
      buildSidebar(allData);
      setStatus(`Loaded ${allData.features.length} chapters`);

      // Mobile starts collapsed, desktop full height sidebar
      if (isMobile()) {
        setSheetHeight(SHEET_COLLAPSED_PX, false);
      }
      updateMapPadding();

      // Marker click
      map.on("click", "locations", (e) => {
        const feature = e.features && e.features[0];
        if (!feature) return;

        smoothFlyTo(feature.geometry.coordinates);
        openPopup(feature);
        setActiveListing(feature.properties.id);

        // On mobile, snap open to mid so user can act
        if (isMobile()) setSheetHeight(SHEET_MID_PX, true);
      });

      map.on("mouseenter", "locations", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "locations", () => (map.getCanvas().style.cursor = ""));

      // Refresh loop
      setInterval(async () => {
        try {
          const latest = await loadGeoJSON();
          allData = latest;

          const showing = filterData(el.filter.value);
          const src = map.getSource("places");
          if (src) src.setData(showing);

          buildSidebar(showing);
          setStatus(`Updated (${allData.features.length})`);
        } catch (err) {
          console.error(err);
          setStatus("Update failed");
        }
      }, REFRESH_MS);

    } catch (err) {
      console.error(err);
      setStatus(err.name === "AbortError" ? "API timed out" : `Failed: ${err.message}`);
    }
  });
}

init();
