// ── Firebase v8 compat (globals: firebase.initializeApp, firebase.database) ──
const firebaseConfig = {
  apiKey:            "AIzaSyBKneQQ1LQoEBRf7XQSFRJ6gRHiXTUJVQQ",
  authDomain:        "eedp-31e22.firebaseapp.com",
  databaseURL:       "https://eedp-31e22-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "eedp-31e22",
  storageBucket:     "eedp-31e22.firebasestorage.app",
  messagingSenderId: "654564437788",
  appId:             "1:654564437788:web:d6716aff32bbb7bf1d14d9",
  measurementId:     "G-SLBBNQQVHZ"
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// ── Python server ─────────────────────────────────────────────────────────────
const PY = "https://bustracing-server.onrender.com";

// ── Route stops: RIT Islampur → Aashta → Sangli Bus Stand (via NH-48) ────────
const ROUTE_STOPS = [
  { id: 1, name: "RIT Islampur",         lat: 17.0572, lng: 74.5432, terminal: true,  icon: "🎓", color: "#00e57a",
    terminalMsg: "🎓 Arriving at Rajarambapu Institute of Technology! Welcome, students. End of route." },
  { id: 2, name: "Islampur Town",        lat: 17.0421, lng: 74.5461, terminal: false, icon: "📍", color: "#00c8ff" },
  { id: 3, name: "Aashta",               lat: 16.9836, lng: 74.5410, terminal: false, icon: "🛣️", color: "#00c8ff" },
  { id: 4, name: "Kupwad Phata (NH-48)", lat: 16.9390, lng: 74.5520, terminal: false, icon: "🛤️", color: "#00c8ff" },
  { id: 5, name: "Sangli Railway Station",lat: 16.8672, lng: 74.5752, terminal: false, icon: "🚉", color: "#00c8ff" },
  { id: 6, name: "Sangli Bus Stand",     lat: 16.8530, lng: 74.5631, terminal: true,  icon: "🏁", color: "#ff3c5a",
    terminalMsg: "🏁 Arriving at Sangli Bus Stand! End of route. Thank you for travelling with SmartBus." },
];

const TERMINAL_ALERT_RADIUS_KM = 0.4;
const alertedStops = new Set();

// ── State ─────────────────────────────────────────────────────────────────────
let currentLat = 16.9560, currentLng = 74.5540;
let currentSpeed = 0;
let animationInterval = null;
let trailEnabled = true;
let pyServerOnline = false;
let toastQueue = [];
let toastShowing = false;

// ── Haversine ─────────────────────────────────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// ── Section navigation ────────────────────────────────────────────────────────
document.querySelectorAll(".nav-item[data-section]").forEach(function(link) {
  link.addEventListener("click", function(e) {
    e.preventDefault();
    var sec = link.dataset.section;
    document.querySelectorAll(".nav-item").forEach(function(l) { l.classList.remove("active"); });
    document.querySelectorAll(".page").forEach(function(p) { p.classList.remove("active"); });
    link.classList.add("active");
    document.getElementById("section-" + sec).classList.add("active");
    if (sec === "tracking") setTimeout(function() { map2.invalidateSize(); }, 50);
    closeMobileSidebar();
  });
});

// ── Mobile sidebar drawer (hamburger menu) ────────────────────────────────────
var sidebarEl     = document.querySelector(".sidebar");
var sidebarOverlay = document.getElementById("sidebar-overlay");
var mobileMenuBtn  = document.getElementById("mobile-menu-btn");
var sidebarCloseBtn = document.getElementById("sidebar-close-btn");

function openMobileSidebar() {
  sidebarEl.classList.add("open");
  sidebarOverlay.classList.add("show");
}
function closeMobileSidebar() {
  sidebarEl.classList.remove("open");
  sidebarOverlay.classList.remove("show");
}
if (mobileMenuBtn)  mobileMenuBtn.addEventListener("click", openMobileSidebar);
if (sidebarCloseBtn) sidebarCloseBtn.addEventListener("click", closeMobileSidebar);
if (sidebarOverlay)  sidebarOverlay.addEventListener("click", closeMobileSidebar);

// Re-fit Leaflet maps whenever the viewport changes size/orientation
// (covers rotating a phone, resizing a laptop window, or opening/closing the drawer)
var _resizeTimer = null;
window.addEventListener("resize", function() {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(function() {
    if (typeof map  !== "undefined") map.invalidateSize();
    if (typeof map2 !== "undefined") map2.invalidateSize();
  }, 150);
});
window.addEventListener("orientationchange", function() {
  setTimeout(function() {
    if (typeof map  !== "undefined") map.invalidateSize();
    if (typeof map2 !== "undefined") map2.invalidateSize();
  }, 300);
});

// ── Maps ──────────────────────────────────────────────────────────────────────
var map  = L.map("map",  { zoomControl: true }).setView([16.9560, 74.5540], 12);
var map2 = L.map("map2", { zoomControl: true }).setView([16.9560, 74.5540], 12);

[map, map2].forEach(function(m) {
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { attribution: "© OpenStreetMap contributors" }).addTo(m);
});

// ── Bus icon ──────────────────────────────────────────────────────────────────
function makeBusIcon() {
  return L.divIcon({
    html: '<div class="bus-icon-wrap">🚌</div>',
    className: "",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -24]
  });
}

var busMarker  = L.marker([17.0572, 74.5432], { icon: makeBusIcon(), zIndexOffset: 1000 }).addTo(map);
var busMarker2 = L.marker([17.0572, 74.5432], { icon: makeBusIcon(), zIndexOffset: 1000 }).addTo(map2);

// ── Route stop markers ────────────────────────────────────────────────────────
function makeStopIcon(stop) {
  var isTerminal = stop.terminal;
  return L.divIcon({
    html: '<div class="stop-marker ' + (isTerminal ? "stop-terminal" : "stop-regular") + '">'
        + '<span class="stop-emoji">' + stop.icon + '</span></div>',
    className: "",
    iconSize:    isTerminal ? [38, 38] : [28, 28],
    iconAnchor:  isTerminal ? [19, 19] : [14, 14],
    popupAnchor: [0, isTerminal ? -22 : -16],
  });
}

var routeLatLngs = ROUTE_STOPS.map(function(s) { return [s.lat, s.lng]; });

[map, map2].forEach(function(m) {
  L.polyline(routeLatLngs, {
    color: "rgba(0,200,255,0.35)", weight: 3, dashArray: "8 5"
  }).addTo(m);

  ROUTE_STOPS.forEach(function(stop) {
    var marker = L.marker([stop.lat, stop.lng], {
      icon: makeStopIcon(stop),
      zIndexOffset: stop.terminal ? 500 : 100,
    }).addTo(m);

    marker.bindPopup(
      '<div class="stop-popup">'
      + '<div class="stop-popup-name">' + stop.icon + ' ' + stop.name + '</div>'
      + (stop.terminal
          ? '<div class="stop-popup-tag terminal-tag">Terminal Stop</div>'
          : '<div class="stop-popup-tag">Intermediate Stop</div>')
      + '<div class="stop-popup-coords">' + stop.lat.toFixed(4) + ', ' + stop.lng.toFixed(4) + '</div>'
      + '</div>',
      { className: "custom-popup" }
    );
  });
});

// ── GPS Trail ─────────────────────────────────────────────────────────────────
var trailCoords = [];
var trail  = L.polyline([], { color: "#00c8ff", weight: 2.5, opacity: 0.75 }).addTo(map);
var trail2 = L.polyline([], { color: "#00c8ff", weight: 2.5, opacity: 0.75 }).addTo(map2);

function toggleTrail() {
  trailEnabled = !trailEnabled;
  var label = trailEnabled ? "Trail ON" : "Trail OFF";
  document.getElementById("trail-btn").lastChild.textContent  = " " + label;
  document.getElementById("trail-btn-2").lastChild.textContent = " " + label;
  ["trail-btn", "trail-btn-2"].forEach(function(id) {
    document.getElementById(id).classList.toggle("trail-active", trailEnabled);
  });
  if (!trailEnabled) {
    map.removeLayer(trail); map2.removeLayer(trail2);
  } else {
    trail.addTo(map); trail2.addTo(map2);
  }
}

document.getElementById("trail-btn").addEventListener("click",    toggleTrail);
document.getElementById("trail-btn-2").addEventListener("click",  toggleTrail);
document.getElementById("recenter-btn").addEventListener("click",  function() { map.panTo([currentLat, currentLng]); });
document.getElementById("recenter-btn-2").addEventListener("click",function() { map2.panTo([currentLat, currentLng]); });

// ── Animate bus marker ────────────────────────────────────────────────────────
function animateMarker(newLat, newLng) {
  if (animationInterval) clearInterval(animationInterval);
  var sLat = currentLat, sLng = currentLng;
  var steps = 60, count = 0;
  animationInterval = setInterval(function() {
    count++;
    var lat = sLat + (newLat - sLat) * (count / steps);
    var lng = sLng + (newLng - sLng) * (count / steps);
    busMarker.setLatLng([lat, lng]);
    busMarker2.setLatLng([lat, lng]);
    if (count >= steps) {
      clearInterval(animationInterval);
      currentLat = newLat; currentLng = newLng;
      busMarker.setLatLng([newLat, newLng]);
      busMarker2.setLatLng([newLat, newLng]);
    }
  }, 30);
}

// ── Toast notification system ─────────────────────────────────────────────────
function showToast(msg, type, duration) {
  type = type || "info";
  duration = duration || 6000;
  toastQueue.push({ msg: msg, type: type, duration: duration });
  if (!toastShowing) processToastQueue();
}

function processToastQueue() {
  if (!toastQueue.length) { toastShowing = false; return; }
  toastShowing = true;
  var item = toastQueue.shift();
  var container = document.getElementById("toast-container");
  var toast = document.createElement("div");
  toast.className = "toast toast-" + item.type;
  var iconMap = { arrival: "🎓", departure: "🏁", overspeed: "⚠️", info: "ℹ️" };
  var titleMap = { arrival: "Arriving Soon", departure: "Departing Stop", overspeed: "Overspeed Alert", info: "Notice" };
  toast.innerHTML =
    '<span class="toast-icon">' + (iconMap[item.type] || "ℹ️") + '</span>'
    + '<div class="toast-body">'
    + '<span class="toast-title">' + (titleMap[item.type] || "Notice") + '</span>'
    + '<span class="toast-msg">' + item.msg + '</span>'
    + '</div>'
    + '<button class="toast-close" onclick="this.parentElement.remove()">✕</button>';
  container.appendChild(toast);
  setTimeout(function() { toast.classList.add("toast-show"); }, 30);
  setTimeout(function() {
    toast.classList.remove("toast-show");
    setTimeout(function() { toast.remove(); processToastQueue(); }, 400);
  }, item.duration);
}

// ── Overspeed banner ──────────────────────────────────────────────────────────
function flashOverspeed(speed) {
  var banner = document.getElementById("overspeed-banner");
  document.getElementById("overspeed-msg").textContent =
    "⚠ Overspeed: " + speed + " km/h detected — limit is 60 km/h";
  banner.classList.remove("hidden");
  showToast("Bus is travelling at " + speed + " km/h — over the 60 km/h limit!", "overspeed", 7000);
  setTimeout(function() { banner.classList.add("hidden"); }, 7000);
}

// ── Terminal arrival banner ───────────────────────────────────────────────────
function showTerminalBanner(stop, distM, etaText) {
  var existing = document.getElementById("terminal-banner");
  if (existing) existing.remove();

  var isRIT = stop.name.indexOf("RIT") !== -1;
  var bannerColor = isRIT ? "#00e57a" : "#ff3c5a";
  var bgGradient  = isRIT
    ? "linear-gradient(90deg, #003d22, rgba(0,229,122,0.13), #003d22)"
    : "linear-gradient(90deg, #3d0010, rgba(255,60,90,0.13), #3d0010)";

  var banner = document.createElement("div");
  banner.id = "terminal-banner";
  banner.innerHTML =
    '<div class="terminal-banner-inner">'
    + '<span class="terminal-banner-icon">' + stop.icon + '</span>'
    + '<div class="terminal-banner-body">'
    + '<span class="terminal-banner-title">' + stop.terminalMsg + '</span>'
    + '<span class="terminal-banner-sub">Bus is ' + distM + ' m away · ' + etaText + '</span>'
    + '</div>'
    + '<button class="terminal-banner-close" onclick="document.getElementById(\'terminal-banner\').remove()">✕</button>'
    + '</div>';

  banner.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:10000;"
    + "background:" + bgGradient + ";background-size:200% 100%;"
    + "border-bottom:2px solid " + bannerColor + ";"
    + "padding:14px 20px;"
    + "animation:alertSlide 0.4s ease,terminalPulse 2.5s ease-in-out infinite;";

  document.body.prepend(banner);
  setTimeout(function() { if (banner.parentElement) banner.remove(); }, 15000);
}

// ── Proximity check for ALL stops ────────────────────────────────────────────
function checkProximity(lat, lng, speed) {
  ROUTE_STOPS.forEach(function(stop) {
    var dist  = haversineKm(lat, lng, stop.lat, stop.lng);
    var key   = String(stop.id);
    var distM = (dist * 1000).toFixed(0);
    var etaText = speed > 2
      ? "ETA: ~" + Math.ceil((dist / speed) * 60) + " min"
      : "Bus is stopped";

    if (dist <= TERMINAL_ALERT_RADIUS_KM) {
      if (!alertedStops.has(key)) {
        alertedStops.add(key);

        var popupContent =
          '<div class="stop-popup">'
          + '<div class="stop-popup-name">' + stop.icon + ' ' + stop.name + '</div>'
          + '<div class="stop-popup-tag ' + (stop.terminal ? "terminal-tag" : "") + '">Bus is ' + distM + ' m away</div>'
          + '<div class="stop-popup-eta">' + etaText + '</div>'
          + '</div>';

        [map, map2].forEach(function(m) {
          L.popup({ className: "custom-popup arrival-popup" })
            .setLatLng([stop.lat, stop.lng])
            .setContent(popupContent)
            .openOn(m);
        });

        if (stop.terminal) {
          showTerminalBanner(stop, distM, etaText);
          showToast(stop.terminalMsg, stop.name.indexOf("RIT") !== -1 ? "arrival" : "departure", 10000);
        } else {
          showToast(
            "Bus is approaching <strong>" + stop.name + "</strong> — " + distM + " m away. " + etaText,
            "info", 6000
          );
        }

        postToPython({ latitude: lat, longitude: lng, speed: speed,
          alert: "approaching_" + stop.name.replace(/ /g, "_"),
          distanceM: Math.round(dist * 1000) });
      }
    } else {
      if (dist > 0.8 && alertedStops.has(key)) {
        alertedStops.delete(key);
      }
    }
  });
}

// ── Nearest stop ──────────────────────────────────────────────────────────────
function getNearestStop(lat, lng) {
  var nearest = null, minDist = Infinity;
  ROUTE_STOPS.forEach(function(stop) {
    var d = haversineKm(lat, lng, stop.lat, stop.lng);
    if (d < minDist) { minDist = d; nearest = stop; }
  });
  return { stop: nearest, distKm: minDist };
}

// ── Info row builder ──────────────────────────────────────────────────────────
var svgIcons = {
  driver:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
  location: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  speed:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 12l4-4"/></svg>',
  status:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  route:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18M3 6h18M3 18h12"/></svg>',
  time:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>',
  stop:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
};

function infoRow(icon, label, value, highlight) {
  return '<div class="info-row ' + (highlight ? "info-row-highlight" : "") + '">'
    + '<div class="info-icon">' + (svgIcons[icon] || "") + '</div>'
    + '<div class="info-content">'
    + '<span class="info-key">' + label + '</span>'
    + '<span class="info-val">' + value + '</span>'
    + '</div></div>';
}

function buildInfoHTML(data, lat, lng, speed) {
  var ns = getNearestStop(lat, lng);
  var stop = ns.stop, distKm = ns.distKm;
  var distText = distKm < 1
    ? (distKm * 1000).toFixed(0) + " m"
    : distKm.toFixed(2) + " km";

  return '<div class="section-header"><h2 class="section-title">Bus Info</h2></div>'
    + infoRow("driver",   "Driver",       data.driver || "—")
    + infoRow("location", "Latitude",     lat.toFixed(5))
    + infoRow("location", "Longitude",    lng.toFixed(5))
    + infoRow("speed",    "Speed",        speed + " km/h")
    + infoRow("status",   "Status",       data.status || "—")
    + infoRow("route",    "Route",        data.route || "—")
    + infoRow("stop",     "Nearest Stop", stop.icon + " " + stop.name + " (" + distText + ")", distKm < 0.4)
    + infoRow("time",     "Last Updated", data.lastUpdated || "—");
}

// ── Chart.js speed graph ──────────────────────────────────────────────────────
var ctx = document.getElementById("speedChart").getContext("2d");
var speedChart = new Chart(ctx, {
  type: "line",
  data: {
    labels: [],
    datasets: [{
      label: "Speed (km/h)",
      data: [],
      borderColor: "#00c8ff",
      backgroundColor: "rgba(0,200,255,0.08)",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.4,
      fill: true,
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 300 },
    scales: {
      x: { ticks: { color: "#4e5e7a", font: { size: 9 }, maxTicksLimit: 6 }, grid: { color: "rgba(255,255,255,0.04)" } },
      y: { ticks: { color: "#4e5e7a", font: { size: 9 } }, grid: { color: "rgba(255,255,255,0.06)" }, min: 0 }
    },
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: "rgba(11,20,40,0.9)", borderColor: "#00c8ff", borderWidth: 1, titleColor: "#8895b0", bodyColor: "#f0f4ff" }
    }
  }
});

function updateChart(history) {
  if (!history || !history.length) return;
  speedChart.data.labels = history.map(function(h) { return h.time; });
  speedChart.data.datasets[0].data = history.map(function(h) { return h.speed; });
  speedChart.data.datasets[0].borderColor = history.some(function(h) { return h.speed > 60; }) ? "#ff3c5a" : "#00c8ff";
  speedChart.update("none");
}

// ── Alerts panel ──────────────────────────────────────────────────────────────
function updateAlerts(alerts) {
  var el = document.getElementById("alerts-list");
  if (!alerts || !alerts.length) { el.innerHTML = '<p class="no-alerts">No alerts yet.</p>'; return; }
  el.innerHTML = alerts.slice().reverse().map(function(a) {
    return '<div class="alert-row ' + a.type + '">'
      + '<span class="alert-type-icon">⚠</span>'
      + '<div class="alert-body">'
      + '<span class="alert-msg">' + a.message + '</span>'
      + '<span class="alert-time">' + a.time + '</span>'
      + '</div></div>';
  }).join("");
}

// ── ETA calculator ────────────────────────────────────────────────────────────
document.getElementById("eta-calc-btn").addEventListener("click", function() {
  var dLat = parseFloat(document.getElementById("eta-lat").value);
  var dLng = parseFloat(document.getElementById("eta-lng").value);
  if (isNaN(dLat) || isNaN(dLng)) return;
  var dist   = haversineKm(currentLat, currentLng, dLat, dLng);
  var result = document.getElementById("eta-result");
  result.classList.remove("hidden");
  document.getElementById("eta-distance").textContent  = dist.toFixed(2) + " km";
  document.getElementById("eta-speed-val").textContent = currentSpeed + " km/h";
  if (currentSpeed < 2) {
    document.getElementById("eta-time").textContent = "Bus is stopped";
  } else {
    var mins = (dist / currentSpeed) * 60;
    var h = Math.floor(mins / 60), m = Math.round(mins % 60);
    document.getElementById("eta-time").textContent = h > 0 ? h + "h " + m + "m" : m + " min";
  }
});

document.querySelectorAll(".stop-eta-btn").forEach(function(btn) {
  btn.addEventListener("click", function() {
    document.getElementById("eta-lat").value = btn.dataset.lat;
    document.getElementById("eta-lng").value = btn.dataset.lng;
    document.getElementById("eta-calc-btn").click();
  });
});

// ── Python API ────────────────────────────────────────────────────────────────
function checkPyServer() {
  fetch(PY + "/api/stats", { signal: AbortSignal.timeout(1500) })
    .then(function(r) { pyServerOnline = r.ok; })
    .catch(function() { pyServerOnline = false; })
    .finally(function() {
      var badge = document.getElementById("server-badge");
      badge.classList.toggle("online",  pyServerOnline);
      badge.classList.toggle("offline", !pyServerOnline);
    });
}

function fetchPythonData() {
  if (!pyServerOnline) return;
  Promise.all([
    fetch(PY + "/api/stats").then(function(r) { return r.json(); }),
    fetch(PY + "/api/speed-history").then(function(r) { return r.json(); }),
    fetch(PY + "/api/alerts").then(function(r) { return r.json(); }),
  ]).then(function(results) {
    var stats = results[0], hist = results[1], alerts = results[2];
    document.getElementById("avg-speed").textContent    = stats.avgSpeed   + " km/h";
    document.getElementById("max-speed").textContent    = stats.maxSpeed   + " km/h";
    document.getElementById("distance").textContent     = stats.totalDistance + " km";
    document.getElementById("alert-count").textContent  = stats.alertCount;
    document.getElementById("sb-avg").textContent       = stats.avgSpeed   + " km/h";
    document.getElementById("sb-max").textContent       = stats.maxSpeed   + " km/h";
    document.getElementById("sb-dist").textContent      = stats.totalDistance + " km";
    document.getElementById("sb-alerts").textContent    = stats.alertCount;
    updateChart(hist);
    updateAlerts(alerts);
  }).catch(function(e) { console.warn("Python API:", e); });
}

function postToPython(data) {
  if (!pyServerOnline) return;
  fetch(PY + "/api/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(2000),
  }).catch(function() {});
}

// ── Firebase v8 listener ──────────────────────────────────────────────────────
var busRef = database.ref("buses/bus1");

busRef.on("value", function(snapshot) {
  var data = snapshot.val();
  if (!data) return;

  var lat   = Number(data.latitude);
  var lng   = Number(data.longitude);
  var speed = Number(data.speed);
  currentSpeed = speed;

  animateMarker(lat, lng);
  map.panTo([lat, lng]);

  if (trailEnabled) {
    trailCoords.push([lat, lng]);
    if (trailCoords.length > 300) trailCoords.shift();
    trail.setLatLngs(trailCoords);
    trail2.setLatLngs(trailCoords);
  }

  document.getElementById("bus-name").innerText = data.name || "—";
  document.getElementById("speed").innerText    = speed + " km/h";
  document.getElementById("updated").innerText  = data.lastUpdated || "—";

  var connDot = document.getElementById("conn-dot");
  if (connDot) { connDot.style.background = "#00e57a"; }

  var statusEl = document.getElementById("bus-status");
  statusEl.innerText = "● " + (data.status || "Unknown");
  statusEl.classList.toggle("moving",  speed > 5);
  statusEl.classList.toggle("stopped", speed <= 5);

  if (speed > 60) flashOverspeed(speed);

  checkProximity(lat, lng, speed);

  var infoHTML = buildInfoHTML(data, lat, lng, speed);
  document.getElementById("info-box").innerHTML   = infoHTML;
  document.getElementById("info-box-2").innerHTML = infoHTML;
  document.getElementById("eta-speed-val").textContent = speed + " km/h";

  postToPython({ latitude: lat, longitude: lng, speed: speed });
});

// ── Polling ───────────────────────────────────────────────────────────────────
checkPyServer();
setInterval(checkPyServer,  15000);
setInterval(fetchPythonData, 5000);
fetchPythonData();
