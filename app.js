mapboxgl.accessToken = "pk.eyJ1Ijoib2tkZW1zIiwiYSI6ImNtbTl1b3FhdzA3M2UycHBvZmZxYzRmYXgifQ.MGb9x34kBeR0lDV8FMc95A";

// web url
const SHEET_API_URL = "https://script.google.com/macros/s/AKfycbzxwBGQkJZIFDv2Q_NTTwkNtoO-hKaOOPaACoYihZhFnDhflCbNreqC-7dmlqFLLPwztg/exec";

const REFRESH_MS = 60000;

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

function setStatus(msg) { el.status.textContent = msg || ""; }
function setCount(n) { el.count.textContent = `Chapters: ${n}`; }

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
      if (isMobile()) setSheetHeight(sheetExpandedPx(), true);
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

/* Search ONLY your dataset */
function filterData(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return allData;

  return {
    type: "FeatureCollection",
    features: allData.features.filter(f => {
      const p = f.properties || {};
      const name = String(p.name || "").toLowerCase();
      const address = String(p.address || "").toLowerCase();
      // includes school name + whatever’s in address field (city, etc.)
      return name.includes(q) || address.includes(q);
    })
  };
}

/* ===== Mobile drawer mechanics ===== */
function sheetCollapsedPx() {
  return 140; // peek height
}
function sheetExpandedPx() {
  // cap at 50vh as requested
  return Math.round(window.innerHeight * 0.50);
}

function currentSheetHeight() {
  const v = getComputedStyle(el.panel).getPropertyValue("--sheet-h").trim();
  const n = Number(String(v).replace("px", ""));
  return Number.isFinite(n) ? n : sheetCollapsedPx();
}

function setSheetHeight(px, animate = false) {
  if (!isMobile()) return;

  const minH = sheetCollapsedPx();
  const maxH = sheetExpandedPx();

  const clamped = Math.max(minH, Math.min(maxH, px));
  el.panel.style.setProperty("--sheet-h", `${clamped}px`);

  if (animate) {
    el.panel.style.transition = "height 220ms ease";
    setTimeout(() => { el.panel.style.transition = ""; }, 240);
  }

  updateMapPadding();
}

function snapSheet(px) {
  const minH = sheetCollapsedPx();
  const maxH = sheetExpandedPx();
  const midH = Math.round((minH + maxH) / 2);

  const points = [minH, midH, maxH];
  let nearest = points[0];
  let best = Math.abs(px - points[0]);
  for (const p of points) {
    const d = Math.abs(px - p);
    if (d < best) { best = d; nearest = p; }
  }
  setSheetHeight(nearest, true);
}

/* ===== Map padding ===== */
function updateMapPadding() {
  if (!map) return;

  if (!isMobile()) {
    // left sidebar width + a little breathing room
    map.setPadding({ top: 10, bottom: 10, left: 440, right: 10 });
    return;
  }

  const h = currentSheetHeight();
  map.setPadding({ top: 10, bottom: h + 20, left: 10, right: 10 });
}

/* ===== Drag handling ===== */
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
    const dy = startY - e.clientY; // drag up => bigger
    setSheetHeight(startH + dy, false);
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

  // Tap handle toggles collapsed/expanded
  el.sheetHandle.addEventListener("click", () => {
    if (!isMobile()) return;
    const h = currentSheetHeight();
    const target = (h <= sheetCollapsedPx() + 25) ? sheetExpandedPx() : sheetCollapsedPx();
    setSheetHeight(target, true);
  });
}

async function init() {
  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/standard",
    center: [-97.5, 35.5],
    zoom: 6
  });

  map.addControl(new mapboxgl.NavigationControl(), "top-right");

  // Search input filters your chapters (desktop + mobile)
  el.filter.addEventListener("input", () => {
    const showing = filterData(el.filter.value);
    buildSidebar(showing);
    const src = map.getSource("places");
    if (src) src.setData(showing);
  });

  // Mobile collapse button
  el.collapseBtn.addEventListener("click", () => {
    if (!isMobile()) return;
    setSheetHeight(sheetCollapsedPx(), true);
  });

  attachSheetDrag();

  window.addEventListener("resize", () => {
    map.resize();
    if (isMobile()) {
      // keep within [collapsed, expanded]
      setSheetHeight(currentSheetHeight(), false);
    }
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

      buildSidebar(allData);
      setStatus(`Loaded ${allData.features.length} chapters`);

      // Start mobile collapsed peek
      if (isMobile()) setSheetHeight(sheetCollapsedPx(), false);
      updateMapPadding();

      map.on("click", "locations", (e) => {
        const feature = e.features && e.features[0];
        if (!feature) return;

        smoothFlyTo(feature.geometry.coordinates);
        openPopup(feature);
        setActiveListing(feature.properties.id);

        if (isMobile()) setSheetHeight(sheetExpandedPx(), true);
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
