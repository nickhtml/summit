mapboxgl.accessToken = "pk.eyJ1Ijoib2tkZW1zIiwiYSI6ImNtbTl1b3FhdzA3M2UycHBvZmZxYzRmYXgifQ.MGb9x34kBeR0lDV8FMc95A";

// ✅ Paste your Google Apps Script Web App URL here:
const SHEET_API_URL = "https://script.google.com/macros/s/AKfycbzxwBGQkJZIFDv2Q_NTTwkNtoO-hKaOOPaACoYihZhFnDhflCbNreqC-7dmlqFLLPwztg/exec";

// Refresh cadence (ms)
const REFRESH_MS = 60000;

let map;
let allData = { type: "FeatureCollection", features: [] };

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg || "";
}

function setCount(n) {
  const el = document.getElementById("store-count");
  if (el) el.textContent = `Chapters: ${n}`;
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
    throw new Error("API returned JSON but not GeoJSON FeatureCollection");
  }

  // Normalize IDs (in case backend changes)
  json.features = json.features.map((f, i) => {
    if (!f.properties) f.properties = {};
    f.properties.id = Number.isFinite(f.properties.id) ? f.properties.id : i;
    return f;
  });

  return json;
}

function smoothFlyTo(coords) {
  map.flyTo({
    center: coords,
    zoom: 12,
    speed: 0.8,
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

  const actions = `
    <div class="popup-actions">
      ${p.email ? `<a class="pill email" href="mailto:${p.email}">Email</a>` : ""}
      ${join ? `<a class="pill join" href="${join}" target="_blank" rel="noopener">Join →</a>` : ""}
    </div>
  `;

  new mapboxgl.Popup({ offset: 16, closeButton: true, closeOnClick: true })
    .setLngLat(feature.geometry.coordinates)
    .setHTML(`
      <div>
        <div class="popup-title">${p.name || "Chapter"}</div>
        <div class="popup-address">${p.address || ""}</div>
        ${actions}
      </div>
    `)
    .addTo(map);
}

function setActiveListing(id) {
  document.querySelectorAll(".item").forEach(el => el.classList.remove("active"));
  const el = document.getElementById(`listing-${id}`);
  if (el) el.classList.add("active");
}

function buildSidebar(data) {
  const listings = document.getElementById("listings");
  listings.innerHTML = "";

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
    listings.appendChild(item);
  }
}

function filterData(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return allData;

  const filtered = {
    type: "FeatureCollection",
    features: allData.features.filter(f => {
      const p = f.properties || {};
      const name = String(p.name || "").toLowerCase();
      const address = String(p.address || "").toLowerCase();
      return name.includes(q) || address.includes(q);
    })
  };

  return filtered;
}

function fitToData(data) {
  if (!data.features.length) return;
  const bounds = new mapboxgl.LngLatBounds();
  for (const f of data.features) bounds.extend(f.geometry.coordinates);
  map.fitBounds(bounds, { padding: 70, maxZoom: 12 });
}

async function init() {
  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/standard",
    center: [-97.5, 35.5],
    zoom: 6
  });

  map.addControl(new mapboxgl.NavigationControl(), "top-right");

  // Optional: Geocoder search (top-left)
  const geocoder = new MapboxGeocoder({
    accessToken: mapboxgl.accessToken,
    mapboxgl,
    marker: false,
    placeholder: "Search a place…"
  });
  map.addControl(geocoder, "top-left");

  // Sidebar filter
  const filterInput = document.getElementById("filter");
  filterInput.addEventListener("input", () => {
    const filtered = filterData(filterInput.value);
    buildSidebar(filtered);

    // Update map source to match filter (so clicks match)
    const src = map.getSource("places");
    if (src) src.setData(filtered);
  });

  map.on("load", async () => {
    try {
      setStatus("Loading…");
      allData = await loadGeoJSON();

      map.addSource("places", { type: "geojson", data: allData });

      // Branded markers (your palette)
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
      fitToData(allData);
      setStatus(`Loaded`);

      map.on("click", "locations", (e) => {
        const feature = e.features && e.features[0];
        if (!feature) return;
        smoothFlyTo(feature.geometry.coordinates);
        openPopup(feature);
        setActiveListing(feature.properties.id);
      });

      map.on("mouseenter", "locations", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "locations", () => (map.getCanvas().style.cursor = ""));

      // Auto refresh
      setInterval(async () => {
        try {
          const latest = await loadGeoJSON();
          allData = latest;

          const query = filterInput.value;
          const showing = filterData(query);

          const src = map.getSource("places");
          if (src) src.setData(showing);

          buildSidebar(showing);
          setStatus(`Updated`);
        } catch (err) {
          console.error(err);
          setStatus(`Update failed`);
        }
      }, REFRESH_MS);

    } catch (err) {
      console.error(err);
      setStatus(err.name === "AbortError" ? "API timed out" : `Failed: ${err.message}`);
    }
  });
}

init();
