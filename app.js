mapboxgl.accessToken = "pk.eyJ1Ijoib2tkZW1zIiwiYSI6ImNtbTl1b3FhdzA3M2UycHBvZmZxYzRmYXgifQ.MGb9x34kBeR0lDV8FMc95A";

// ✅ Paste your Apps Script Web App URL here (must start with https://script.google.com/macros/s/...)
const SHEET_API_URL = "https://script.google.com/macros/s/AKfycbzxwBGQkJZIFDv2Q_NTTwkNtoO-hKaOOPaACoYihZhFnDhflCbNreqC-7dmlqFLLPwztg/exec";

let map;

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg || "";
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchChapters() {
  const res = await fetchWithTimeout(SHEET_API_URL, 10000);

  if (!res.ok) {
    throw new Error(`API HTTP ${res.status} ${res.statusText}`);
  }

  // If the endpoint is returning HTML (like a login page), this will fail clearly
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("API did not return JSON. (Often wrong URL or not publicly accessible)");
  }

  if (!json || json.type !== "FeatureCollection" || !Array.isArray(json.features)) {
    throw new Error("API returned JSON, but not a GeoJSON FeatureCollection");
  }

  return json;
}

function flyToStore(feature) {
  map.flyTo({ center: feature.geometry.coordinates, zoom: 12 });
}

function clearPopups() {
  const popUps = document.getElementsByClassName("mapboxgl-popup");
  if (popUps[0]) popUps[0].remove();
}

function ensureHttp(url) {
  if (!url) return "";
  const u = String(url).trim();
  if (!u) return "";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return "https://" + u;
}

function createPopup(feature) {
  clearPopups();
  const p = feature.properties || {};
  const join = ensureHttp(p.joinUrl);

  new mapboxgl.Popup()
    .setLngLat(feature.geometry.coordinates)
    .setHTML(`
      <h3 style="margin:0 0 6px 0;">${p.name || ""}</h3>
      <div style="margin-bottom:8px;">${p.address || ""}</div>
      ${p.email ? `<div><a href="mailto:${p.email}">${p.email}</a></div>` : ""}
      ${join ? `<div style="margin-top:6px;"><a href="${join}" target="_blank" rel="noopener">Join this chapter →</a></div>` : ""}
    `)
    .addTo(map);
}

function buildSidebar(data) {
  const listings = document.getElementById("listings");
  listings.innerHTML = "";

  document.getElementById("store-count").textContent = `Chapters: ${data.features.length}`;

  data.features.forEach(feature => {
    const item = document.createElement("div");
    item.className = "item";

    const link = document.createElement("a");
    link.href = "#";
    link.className = "title";
    link.textContent = feature.properties.name || "Chapter";

    link.addEventListener("click", e => {
      e.preventDefault();
      flyToStore(feature);
      createPopup(feature);
      document.querySelectorAll(".item").forEach(el => el.classList.remove("active"));
      item.classList.add("active");
    });

    const details = document.createElement("div");
    details.className = "details";
    const join = ensureHttp(feature.properties.joinUrl);

    details.innerHTML = `
      ${feature.properties.address || ""}<br>
      ${feature.properties.email ? `<a href="mailto:${feature.properties.email}">${feature.properties.email}</a><br>` : ""}
      ${join ? `<a href="${join}" target="_blank" rel="noopener">Join →</a>` : ""}
    `;

    item.appendChild(link);
    item.appendChild(details);
    listings.appendChild(item);
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

  map.on("load", async () => {
    try {
      setStatus("Loading chapters…");

      const data = await fetchChapters();

      map.addSource("places", { type: "geojson", data });

      map.addLayer({
        id: "locations",
        type: "circle",
        source: "places",
        paint: {
          "circle-radius": 8,
          "circle-stroke-width": 2,
          "circle-opacity": 0.9
        }
      });

      buildSidebar(data);

      if (data.features.length) {
        const bounds = new mapboxgl.LngLatBounds();
        data.features.forEach(f => bounds.extend(f.geometry.coordinates));
        map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
      }

      map.on("click", "locations", e => {
        const feature = e.features && e.features[0];
        if (!feature) return;
        flyToStore(feature);
        createPopup(feature);
      });

      map.on("mouseenter", "locations", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "locations", () => (map.getCanvas().style.cursor = ""));

      setStatus(`Loaded ${data.features.length} chapters`);

      setInterval(async () => {
        try {
          const updated = await fetchChapters();
          map.getSource("places").setData(updated);
          buildSidebar(updated);
          setStatus(`Updated ${updated.features.length} chapters`);
        } catch (err) {
          console.error(err);
          setStatus(`Refresh failed: ${err.message}`);
        }
      }, 60000);

    } catch (err) {
      console.error(err);
      setStatus(`Failed: ${err.name === "AbortError" ? "API timed out" : err.message}`);
    }
  });
}

init();