/* harita gorunumu - ES
   not: leaflet 1.9.4, harici baska bagimlilik yok */
(function () {
  "use strict";

  var G = window.GYP;
  var map, markers = [], markerLayer, ghostLayer, maskLayer, borderLayer, trailLayer;
  var baseLayers = {};
  var currentBase = G.readTheme() === "dark" ? "night" : "day";
  var data = null;

  var TURKEY_BOUNDS = L.geoJSON(window.TURKEY_BORDER).getBounds();

  /* ---------- tema ---------- */
  function setTheme(theme) {
    G.applyTheme(theme);
    document.getElementById("theme-icon").innerHTML = G.themeIconSvg(theme);
    if (maskLayer) maskLayer.setStyle({ fillColor: cssVar("--mask") });
    if (borderLayer) borderLayer.setStyle({ color: cssVar("--border-stroke") });
    switchBase(theme === "dark" ? "night" : "day");
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ---------- taban katmanlar ---------- */
  var ESRI_URL =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  var ESRI_ATTR = 'Uydu görüntüsü &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics';
  var NIGHT_DETAIL_ZOOM = 9; // NASA gece verisi bu seviyeden sonra çözünürlüğünü yitiriyor
  var MAX_ZOOM = 19;         // haritanın izin verebileceği en yakın seviye
  var MAX_NATIVE = 19;       // sağlayıcıdan gerçek karo çekilen en yakın seviye
  var BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

  // bos karo hatasi birikirse bir seviye geri cek
  function guardTiles(layer) {
    var misses = 0;
    layer.on("tileerror", function () {
      misses++;
      if (misses > 6 && layer.options.maxNativeZoom > 16) {
        layer.options.maxNativeZoom -= 1;
        misses = 0;
        layer.redraw();
      }
    });
    return layer;
  }

  // esri "veri yok" karosunu 200 ile donduruyor -> tileerror ise yaramiyor.
  // tilemap servisini sorgulayip bolgesel tavani buluyoruz.
  var TILEMAP_URL =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tilemap/";
  var MIN_CAP = 14;          // sorgu başarısız olursa inilecek güvenli taban
  var probeCache = {};
  var probeToken = 0;

  function tileXY(lat, lon, z) {
    var n = Math.pow(2, z);
    var x = Math.floor(((lon + 180) / 360) * n);
    var r = (lat * Math.PI) / 180;
    var y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    return { x: x, y: y };
  }

  function tileAvailable(z, lat, lon) {
    var t = tileXY(lat, lon, z);
    return fetch(TILEMAP_URL + z + "/" + t.y + "/" + t.x + "/1/1", { cache: "force-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return !!(j && j.data && j.data[0]); })
      .catch(function () { return null; }); // ağ/CORS sorunu
  }

  function deepestZoom(lat, lon) {
    var key = Math.round(lat * 40) + ":" + Math.round(lon * 40); // ~2-3 km hücre
    if (probeCache[key] != null) return Promise.resolve(probeCache[key]);

    var z = MAX_NATIVE;
    function step() {
      if (z < MIN_CAP) { probeCache[key] = MIN_CAP; return MIN_CAP; }
      return tileAvailable(z, lat, lon).then(function (ok) {
        if (ok === null) {                        // ağ/CORS sorunu — ihtiyatlı davran
          probeCache[key] = MAX_NATIVE - 1;
          return MAX_NATIVE - 1;
        }
        if (ok) { probeCache[key] = z; return z; }
        z--;
        return step();
      });
    }
    return Promise.resolve(step());
  }

  function updateZoomCap() {
    if (!map) return;
    var c = map.getCenter();
    var token = ++probeToken;
    deepestZoom(c.lat, c.lng).then(function (z) {
      if (token !== probeToken) return;           // sonraki sorgu geldi, bunu yoksay
      var cap = Math.min(MAX_ZOOM, z);
      if (map.getMaxZoom() !== cap) map.setMaxZoom(cap);
      if (map.getZoom() > cap) map.setZoom(cap);
      var el = document.getElementById("cap-hint");
      if (el) {
        var atLimit = cap < MAX_ZOOM && map.getZoom() >= cap;
        el.style.display = atLimit ? "block" : "none";
      }
    });
  }

  function buildBaseLayers() {
    baseLayers.day = guardTiles(
      L.tileLayer(ESRI_URL, {
        maxZoom: MAX_ZOOM,
        maxNativeZoom: MAX_NATIVE,
        errorTileUrl: BLANK,
        attribution: ESRI_ATTR,
      })
    );

    baseLayers.night = L.tileLayer(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default//GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg",
      {
        maxZoom: MAX_ZOOM,
        maxNativeZoom: 8,
        errorTileUrl: BLANK,
        attribution:
          'Gece görüntüsü: <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a> / VIIRS Earth at Night',
      }
    );

    // gece modunda yakin plan: esri + css filtre
    baseLayers.nightDetail = guardTiles(
      L.tileLayer(ESRI_URL, {
        maxZoom: MAX_ZOOM,
        maxNativeZoom: MAX_NATIVE,
        errorTileUrl: BLANK,
        className: "night-detail-tiles",
        attribution: ESRI_ATTR + " · gece tonlaması",
      })
    );
  }

  // secilen mod + mevcut zoom -> hangi katman gosterilecek
  function effectiveLayer() {
    if (currentBase === "day") return "day";
    return map.getZoom() >= NIGHT_DETAIL_ZOOM ? "nightDetail" : "night";
  }

  function applyLayer() {
    var want = effectiveLayer();
    Object.keys(baseLayers).forEach(function (k) {
      if (k !== want && map.hasLayer(baseLayers[k])) map.removeLayer(baseLayers[k]);
    });
    if (!map.hasLayer(baseLayers[want])) {
      baseLayers[want].addTo(map);
      baseLayers[want].bringToBack();
    }
    var hint = document.getElementById("zoom-hint");
    if (hint) hint.style.display = want === "nightDetail" ? "block" : "none";
  }

  function switchBase(which) {
    currentBase = which;
    applyLayer();
    document.querySelectorAll("#layerbox button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.base === which);
    });
  }

  /* ---------- maske ---------- */
  function buildMask() {
    var outer = [
      [-85, -179.9],
      [85, -179.9],
      [85, 179.9],
      [-85, 179.9],
    ];
    var holes = [];
    window.TURKEY_BORDER.geometry.coordinates.forEach(function (poly) {
      holes.push(
        poly[0].map(function (c) {
          return [c[1], c[0]];
        })
      );
    });
    maskLayer = L.polygon([outer].concat(holes), {
      color: "transparent",
      weight: 0,
      fillColor: cssVar("--mask"),
      fillOpacity: 1,
      interactive: false,
    }).addTo(map);

    borderLayer = L.geoJSON(window.TURKEY_BORDER, {
      style: { color: cssVar("--border-stroke"), weight: 1.4, fill: false, interactive: false },
    }).addTo(map);
  }

  /* ---------- işaretçiler ---------- */
  // uzakta kucult, yakinda buyut
  /* Boyutlar daima CIFT: tek sayida yerlesim payi (boyut/2) yarim piksele
     dusuyor ve ikon hafifce kayik gorunuyor. */
  function iconSize() {
    var compact = G.isCompact();
    var z = map ? map.getZoom() : 6;
    if (z <= 6) return compact ? 16 : 20;
    if (z <= 8) return compact ? 18 : 24;
    return compact ? 20 : 28;
  }

  function makeIcon(kind, s, seed) {
    s = s || iconSize();
    var html = G.GLYPHS[kind];
    // her isaretci biraz farkli fazda hareket etsin (hepsi ayni anda degil)
    var d = -((seed || 0) % 5) * 0.48;
    if (kind === "rig") {
      html = html.replace('class="tb"', 'class="tb" style="animation-delay:' + d + 's"');
    } else if (kind === "production") {
      html = html.replace('class="pj"', 'class="pj" style="animation-delay:' + d + 's"');
    }
    return L.divIcon({
      className: "gyp-marker cat-" + kind,
      html: '<div class="chip">' + html + "</div>",
      iconSize: [s, s],
      iconAnchor: [s / 2, s / 2],
      popupAnchor: [0, -(s / 2 + 4)],
    });
  }

  var lastIconSize = null;
  function refreshIconSizes() {
    var s = iconSize();
    if (s === lastIconSize) return;
    lastIconSize = s;
    markers.forEach(function (m) {
      var wasActive = m.marker.isPopupOpen && m.marker.isPopupOpen();
      m.marker.setIcon(makeIcon(m.kindIcon, s, m.seed));
      var el = m.marker.getElement();
      if (el) {
        el.title = m.label;
        if (wasActive) el.classList.add("is-active");
      }
    });

    // arac ikonlari da olcege uysun; eskiden ilk boyutta kaliyorlardi
    Object.keys(vehicleMarkers).forEach(function (id) {
      var rec = vehicleMarkers[id];
      var acikti = rec.marker.isPopupOpen && rec.marker.isPopupOpen();
      rec.marker.setIcon(vehicleIcon(rec.data));
      if (acikti) {
        var vel = rec.marker.getElement();
        if (vel) vel.classList.add("is-active");
      }
    });
  }

  // popup acilinca renk degisir, cift tik yakinlastirir
  function wireMarker(mk, latlng, label, rec) {
    mk.on("add", function () {
      var el = mk.getElement();
      if (el) el.title = label;
    });
    mk.on("popupopen", function () {
      var el = mk.getElement();
      if (el) el.classList.add("is-active");
    });
    mk.on("popupclose", function () {
      var el = mk.getElement();
      if (el) el.classList.remove("is-active");
    });
    mk.on("dblclick", function (e) {
      L.DomEvent.stop(e);
      map.flyTo(latlng, Math.min(map.getMaxZoom(), Math.max(map.getZoom(), 15)), { duration: 0.8 });
    });
  }

  function rigPopupHtml(rig) {
    var h = '<div class="pop-head">';
    h += '<p class="pop-title">' + G.escapeHtml(rig.name) + "</p>";
    h += '<div class="pop-city">' + G.escapeHtml(rig.city);
    if (rig.note) h += " · " + G.escapeHtml(rig.note);
    h += "</div></div>";
    h += '<div class="pop-body">';
    if (!icerikGorunur("rig")) {
      h += '<p class="sec-label">Konum</p>';
      h += '<p class="empty-note">Ekip bilgisi için yetkili girişi yapınız.</p>';
      if (rig.address) {
        h += '<p class="sec-label" style="margin-top:10px">Adres</p>' +
             '<p class="pop-address">' + G.escapeHtml(rig.address) + "</p>";
      }
      h += "</div>";
      return h + dirButton(rig.lat, rig.lon, rig.name);
    }
    h += '<p class="sec-label">Güncel Ekip</p>';
    if (!rig.employees || rig.employees.length === 0) {
      h += '<p class="empty-note">Henüz personel atanmadı.</p>';
    } else {
      h += '<ul class="emp-list">';
      rig.employees.forEach(function (e) {
        h +=
          "<li><span class=\"emp-name\">" + G.escapeHtml(e.name) +
          '</span><span class="emp-role">' + G.escapeHtml(e.role || "") + "</span></li>";
      });
      h += "</ul>";
    }
    if (rig.previous) {
      h += '<div class="prev-block"><p class="sec-label">Önceki Kayıt';
      if (rig.previous.until) {
        h += '<span class="prev-tag">' + G.formatDate(rig.previous.until) + " tarihine kadar</span>";
      }
      h += "</p>";
      h += '<div class="pop-city" style="color:var(--ghost);margin-bottom:6px">' +
        G.escapeHtml(rig.previous.city || "") + "</div>";
      if (rig.previous.employees && rig.previous.employees.length) {
        h += '<ul class="emp-list">';
        rig.previous.employees.forEach(function (e) {
          h +=
            '<li><span class="emp-name">' + G.escapeHtml(e.name) +
            '</span><span class="emp-role">' + G.escapeHtml(e.role || "") + "</span></li>";
        });
        h += "</ul>";
      }
      h += "</div>";
    }
    h += "</div>";
    if (rig.since) {
      h += '<div class="pop-since">' + G.formatDate(rig.since) + " tarihinden beri</div>";
    }
    h += dirButton(rig.lat, rig.lon, rig.name);
    return h;
  }

  // koordinat data-* ile tasiniyor, tiklama delegasyonla yakalaniyor
  function dirButtonInner(lat, lon, label) {
    if (typeof lat !== "number" || typeof lon !== "number") return "";
    return (
      '<button type="button" class="dir-btn" ' +
      'data-lat="' + lat + '" data-lon="' + lon + '" data-label="' + G.escapeHtml(label) + '">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path d="M12 2.6l9.4 9.4-9.4 9.4L2.6 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<path d="M9.4 14.2v-2.4a2 2 0 012-2h3.4M13.4 7.8l2.4 2-2.4 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg> Yol Tarifi</button>"
    );
  }

  function dirButton(lat, lon, label) {
    var b = dirButtonInner(lat, lon, label);
    return b ? '<div class="pop-foot">' + b + "</div>" : "";
  }

  function productionPopupHtml(s) {
    var h =
      '<div class="pop-head"><p class="pop-title">' + G.escapeHtml(s.name) +
      '</p><div class="pop-city">' + G.escapeHtml(s.city || "") + "</div></div>" +
      '<div class="pop-body"><p class="sec-label">Tür</p>' +
      '<p class="empty-note" style="font-style:normal;color:var(--steel)">Üretim Kuyusu</p>';
    if (s.address) {
      h += '<p class="sec-label" style="margin-top:10px">Adres</p>' +
        '<p class="pop-address">' + G.escapeHtml(s.address) + "</p>";
    }
    h += "</div>";
    return h + dirButton(s.lat, s.lon, s.name);
  }

  function facilityPopupHtml(f) {
    var h =
      '<div class="pop-head"><p class="pop-title">' + G.escapeHtml(f.name) +
      '</p><div class="pop-city">' + G.escapeHtml(f.city || "") + "</div></div>" +
      '<div class="pop-body"><p class="sec-label">Tesis</p>' +
      '<p class="empty-note" style="font-style:normal;color:var(--steel)">' +
      (f.type === "workshop" ? "Saha kampı / atölye" : "İdari ofis") +
      "</p>";
    if (f.address) {
      h += '<p class="sec-label" style="margin-top:10px">Adres</p>' +
        '<p class="pop-address">' + G.escapeHtml(f.address) + "</p>";
    }
    h += "</div>";
    return h + dirButton(f.lat, f.lon, f.name);
  }

  function render() {
    if (markerLayer) map.removeLayer(markerLayer);
    markers = [];
    if (ghostLayer) map.removeLayer(ghostLayer);
    if (trailLayer) map.removeLayer(trailLayer);
    markerLayer = L.layerGroup().addTo(map);
    ghostLayer = L.layerGroup().addTo(map);
    trailLayer = L.layerGroup().addTo(map);

    data.facilities.forEach(function (f) {
      var ll = L.latLng(f.lat, f.lon);
      var mk = L.marker(ll, { icon: makeIcon(f.type), riseOnHover: true })
        .addTo(markerLayer)
        .bindPopup(facilityPopupHtml(f), { closeButton: true, autoPanPadding: [30, 30] })
        .bindTooltip(f.name, { permanent: true, direction: "right", offset: [17, 0], className: "gyp-label fx" });
      var recF = {
        marker: mk, label: f.name, kind: "fx", kindIcon: f.type,
        cat: f.type, weight: 100, latlng: ll,
        altBilgi: f.city || "",
        adres: f.address || "",
      };
      wireMarker(mk, ll, f.name, recF);
      markers.push(recF);
    });

    (data.productionSites || []).forEach(function (s, i) {
      var ll = L.latLng(s.lat, s.lon);
      var mk = L.marker(ll, { icon: makeIcon("production", null, i), riseOnHover: true })
        .addTo(markerLayer)
        .bindPopup(productionPopupHtml(s), { closeButton: true, autoPanPadding: [30, 30] })
        .bindTooltip(s.name, { permanent: true, direction: "right", offset: [17, 0], className: "gyp-label" });
      var recP = {
        marker: mk, label: s.name, kind: "rig", kindIcon: "production",
        cat: "production", weight: 20, latlng: ll, seed: i,
        altBilgi: s.city || "",
      };
      wireMarker(mk, ll, s.name, recP);
      markers.push(recP);
    });

    data.rigs.forEach(function (r, i) {
      var ll = L.latLng(r.lat, r.lon);
      var mk = L.marker(ll, { icon: makeIcon("rig", null, i), riseOnHover: true })
        .addTo(markerLayer)
        .bindPopup(rigPopupHtml(r), { closeButton: true, autoPanPadding: [30, 30] })
        .bindTooltip(r.name, { permanent: true, direction: "right", offset: [17, 0], className: "gyp-label" });
      var recR = {
        marker: mk, label: r.name, kind: "rig", kindIcon: "rig", cat: "rig", seed: i,
        weight: r.employees && r.employees.length ? 50 : 10,
        latlng: ll,
        altBilgi: [r.city, r.note].filter(Boolean).join(" · "),
        adres: r.address || "",
      };
      wireMarker(mk, ll, r.name, recR);
      markers.push(recR);

      if (r.previous && typeof r.previous.lat === "number" && typeof r.previous.lon === "number") {
        var moved = Math.abs(r.previous.lat - r.lat) > 0.01 || Math.abs(r.previous.lon - r.lon) > 0.01;
        if (moved) {
          L.marker([r.previous.lat, r.previous.lon], {
            icon: L.divIcon({
              className: "ghost-marker",
              html: '<div class="ghost-dot"></div>',
              iconSize: [17, 17],
              iconAnchor: [8.5, 8.5],
            }),
            interactive: false,
          }).addTo(ghostLayer);
          L.polyline(
            [[r.previous.lat, r.previous.lon], [r.lat, r.lon]],
            { color: "rgba(255,255,255,.55)", weight: 1.4, dashArray: "5 5", interactive: false }
          ).addTo(trailLayer);
        }
      }
    });

    document.getElementById("stat-rigs").textContent = data.rigs.length;
    var siteEl = document.getElementById("stat-sites");
    if (siteEl) siteEl.textContent = (data.productionSites || []).length;
    var counts = { rig: 0, office: 0, workshop: 0, production: 0 };
    markers.forEach(function (m) { counts[m.cat] = (counts[m.cat] || 0) + 1; });
    Object.keys(counts).forEach(function (k) {
      var el = document.getElementById("cnt-" + k);
      if (el) el.textContent = counts[k];
    });
    var people = data.rigs.reduce(function (s, r) {
      return s + (r.employees ? r.employees.length : 0);
    }, 0);
    document.getElementById("stat-people").textContent = people > 0 ? people : "—";
    document.getElementById("updated-at").textContent = G.formatDate(data.updatedAt) || "—";

    // Dar ekranda ulke geneli gorunumu buyuk bosluk birakiyor; acilista
    // isaretcilerin bulundugu alana odaklan.
    if (G.isCompact()) {
      var noktalar = [];
      (data.rigs || []).forEach(function (r) { noktalar.push([r.lat, r.lon]); });
      (data.facilities || []).forEach(function (f) { noktalar.push([f.lat, f.lon]); });
      (data.productionSites || []).forEach(function (s) { noktalar.push([s.lat, s.lon]); });
      noktalar = noktalar.filter(function (p) {
        return Number.isFinite(p[0]) && Number.isFinite(p[1]);
      });
      if (noktalar.length > 1) {
        map.fitBounds(L.latLngBounds(noktalar), { padding: [12, 12], animate: false });
      }
    }

    lastIconSize = iconSize();
    syncFilters();
    applyFilters();
  }

  /* ---------- etiket yerlesimi ---------- */
  function candidates(compact) {
    var a = compact ? 13 : 17;
    var b = compact ? 12 : 15;
    var c = compact ? 21 : 27;
    // ikona yakin kalmali, yoksa hangi pine ait belli olmuyor
    return [
      { dir: "right", off: [a, 0] },
      { dir: "left", off: [-a, 0] },
      { dir: "bottom", off: [0, b] },
      { dir: "top", off: [0, -b] },
      { dir: "right", off: [a - 2, b + 1] },
      { dir: "left", off: [-(a - 2), b + 1] },
      { dir: "right", off: [a - 2, -(b + 1)] },
      { dir: "left", off: [-(a - 2), -(b + 1)] },
      { dir: "bottom", off: [0, c] },
      { dir: "top", off: [0, -c] },
    ];
  }

  function overlaps(a, b) {
    return !(a.x2 <= b.x1 || a.x1 >= b.x2 || a.y2 <= b.y1 || a.y1 >= b.y2);
  }

  var RIG_LABEL_ZOOM = 7; // bu seviyenin altında kule adları gizlenir

  function declutter() {
    if (!map || !markers.length) return;
    var compact = G.isCompact();
    var half = iconSize() / 2 + 3;
    var charW = compact ? 5.4 : 6.4;
    var labelH = compact ? 13 : 15;
    var CAND = candidates(compact);
    var size = map.getSize();
    var zoom = map.getZoom();
    var showRigLabels = zoom >= RIG_LABEL_ZOOM;
    var hintEl = document.getElementById("label-hint");
    if (hintEl) hintEl.style.display = showRigLabels ? "none" : "";

    var items = markers.map(function (m) {
      var p = map.latLngToContainerPoint(m.latlng);
      return { m: m, x: p.x, y: p.y };
    });
    if (!items.length) return;
    var taken = items.map(function (it) {
      return { x1: it.x - half, x2: it.x + half, y1: it.y - half, y2: it.y + half };
    });
    items.sort(function (a, b) {
      return b.m.weight - a.m.weight || a.y - b.y;
    });

    items.forEach(function (it) {
      var tip = it.m.marker.getTooltip();
      if (!tip) return;
      var el = tip.getElement && tip.getElement();

      // z7 alti: sadece tesis adlari
      if (it.m.kind === "rig" && !showRigLabels) {
        if (el) el.style.display = "none";
        return;
      }

      var w = it.m.label.length * (it.m.kind === "rig" ? charW : charW + 0.7) + 6;
      var chosen = null;
      for (var i = 0; i < CAND.length; i++) {
        var c = CAND[i];
        var cx = it.x + c.off[0];
        var cy = it.y + c.off[1];
        var x1 = c.dir === "right" ? cx : c.dir === "left" ? cx - w : cx - w / 2;
        var box = { x1: x1, x2: x1 + w, y1: cy - labelH / 2, y2: cy + labelH / 2 };
        if (box.x1 < 2 || box.x2 > size.x - 2 || box.y1 < 2 || box.y2 > size.y - 2) continue;
        if (taken.some(function (t) { return overlaps(box, t); })) continue;
        chosen = c;
        taken.push(box);
        break;
      }

      if (!chosen) {
        // sigmiyorsa gizle
        if (el) el.style.display = "none";
        return;
      }
      if (el) el.style.display = "";
      tip.options.direction = chosen.dir;
      tip.options.offset = chosen.off;
      if (it.m.marker.isTooltipOpen && it.m.marker.isTooltipOpen()) tip.update();
    });
  }

  /* ---------- yol tarifi ---------- */
  var UA = navigator.userAgent || "";
  var IS_IOS = /iPhone|iPad|iPod/i.test(UA) ||
    (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
  var IS_ANDROID = /Android/i.test(UA);
  var IS_MOBILE = IS_IOS || IS_ANDROID;

  function dirTargets(lat, lon, label) {
    var q = lat + "," + lon;
    var name = encodeURIComponent(label || "Hedef");
    var list = [
      {
        key: "google",
        name: "Google Haritalar",
        url: "https://www.google.com/maps/dir/?api=1&destination=" + q + "&travelmode=driving",
      },
      {
        key: "yandex",
        name: "Yandex Haritalar",
        url: "https://yandex.com.tr/harita/?rtext=~" + q + "&rtt=auto",
      },
    ];
    if (IS_IOS) {
      list.push({ key: "apple", name: "Apple Haritalar", url: "http://maps.apple.com/?daddr=" + q + "&dirflg=d" });
    }
    if (IS_ANDROID) {
      list.push({
        key: "other",
        name: "Diğer uygulamalar…",
        url: "geo:" + q + "?q=" + q + "(" + name + ")",
        hint: "Telefonunuzdaki harita uygulamalarını listeler",
      });
    }
    return list;
  }

  function openDirections(lat, lon, label) {
    var targets = dirTargets(lat, lon, label);
    if (!IS_MOBILE) {
      window.open(targets[0].url, "_blank", "noopener");
      return;
    }
    showAppSheet(targets, label);
  }

  var sheetEl = null;
  function showAppSheet(targets, label) {
    closeAppSheet();
    sheetEl = document.createElement("div");
    sheetEl.className = "sheet-bg";
    var html =
      '<div class="sheet" role="dialog" aria-label="Yol tarifi uygulaması seçin">' +
      '<p class="sheet-title">Yol Tarifi</p>' +
      '<p class="sheet-sub">' + G.escapeHtml(label || "") + "</p>";
    targets.forEach(function (t) {
      html +=
        '<a class="sheet-opt" href="' + t.url + '" target="_blank" rel="noopener">' +
        "<span>" + t.name + "</span>" +
        (t.hint ? '<em class="sheet-hint">' + t.hint + "</em>" : "") +
        "</a>";
    });
    html += '<button type="button" class="sheet-cancel">Vazgeç</button></div>';
    sheetEl.innerHTML = html;
    document.body.appendChild(sheetEl);

    sheetEl.addEventListener("click", function (e) {
      if (e.target === sheetEl || e.target.classList.contains("sheet-cancel")) closeAppSheet();
      else if (e.target.closest(".sheet-opt")) setTimeout(closeAppSheet, 250);
    });
    requestAnimationFrame(function () { sheetEl.classList.add("open"); });
  }

  function closeAppSheet() {
    if (sheetEl && sheetEl.parentNode) sheetEl.parentNode.removeChild(sheetEl);
    sheetEl = null;
  }

  function wireDirections() {
    document.getElementById("map").addEventListener("click", function (e) {
      var btn = e.target.closest(".dir-btn");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      openDirections(parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lon), btn.dataset.label);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeAppSheet();
    });
  }

  /* ---------- canli arac katmani ----------
     Veri ara servisten gelir (bkz. config.js). Token istemciye inmez.
     Yalnizca "Araclar" filtresi acikken sorgulanir; kapaliyken kota harcanmaz. */
  var vehicleLayer = null;
  var vehicleMarkers = {};      // plaka -> marker
  var vehicleTimer = null;
  var vehicleLoading = false;
  var REFRESH_MS = 30000;       // yon iki olcum arasindan cikiyor; ilk ok cabuk gorunsun
  var STALE_MS = 30 * 60000;    // 30 dk once veri gonderen arac "eski" sayilir

  function vehicleServiceUrl() {
    var base = (window.GYP_CONFIG && window.GYP_CONFIG.vehicleService) || "";
    return base.replace(/\/+$/, "");
  }

  // arac servisi yetki ister; oturumdan gelen jeton her istege eklenir
  function vehicleFetch(url) {
    var basliklar = {};
    if (window.GYPAuth) {
      var j = window.GYPAuth.jetonAl && window.GYPAuth.jetonAl();
      if (j) basliklar.Authorization = "Bearer " + j;
    }
    return fetch(url, { cache: "no-store", headers: basliklar });
  }

  /* Yon bilgisi: once saglayicidan, yoksa onceki konumdan hesapla,
     o da yoksa bilinen son yonu kullan. Hicbiri yoksa null doner ve
     ok yerine yonsuz simge gosterilir (kuzeye bakan yaniltici ok cizmeyiz). */
  /* Saglayici yon gondermiyor; yonu aracin gittigi yoldan hesapliyoruz.
     Hesaplanan yon tarayiciya yazilir, boylece sayfa yenilense de kaybolmaz. */
  /* Yon deposu. Eski surumler saglayicidan gelen 0'i (tam kuzey sanip)
     kaydediyordu; o kayitlar yuzunden tum oklar kuzeye donuyordu.
     Anahtar degistirildi, eskisi siliniyor ve 0 artik gecersiz sayiliyor. */
  var HEAD_KEY = "gyp-heading-v2";
  try { localStorage.removeItem("gyp-heading"); } catch (e) {}

  var headStore = (function () {
    try {
      var h = JSON.parse(localStorage.getItem(HEAD_KEY) || "{}");
      // guvenlik: sifir degerler bilinmiyor demektir, temizle
      Object.keys(h).forEach(function (k) { if (!h[k]) delete h[k]; });
      return h;
    } catch (e) { return {}; }
  })();

  function saveHeading(id, deg) {
    var d = Math.round(deg);
    if (!Number.isFinite(d)) return;
    // 0 eski surumlerde "bilinmiyor" anlamina geliyordu; gercek kuzeyi
    // ayirt edebilmek icin 360 olarak saklaniyor (donme acisi ayni).
    headStore[id] = d === 0 ? 360 : d;
    try { localStorage.setItem(HEAD_KEY, JSON.stringify(headStore)); } catch (e) {}
  }

  /* Saglayici yon gondermiyor (ya da hep 0 gonderiyor). Bu yuzden yonu
     ONCE aracin gercekten gittigi yoldan hesapliyoruz; saglayici degeri
     yalnizca elimizde hareket verisi yoksa kullaniliyor. */
  /* Yon YALNIZCA aracin gittigi yoldan hesaplanir.
     Saglayicinin speedDirection alani kullanilmiyor: sifir geliyor ya da
     derece yerine kucuk sektor kodu gibi davraniyor; iki denemede de tum
     oklari kuzeye cevirdi. Bilinmiyorsa ok yerine yonsuz simge gosterilir. */
  function heading(v) {
    var id = v.plate || String(v.muId);
    var rec = vehicleMarkers[id];

    // 1) onceki konumdan gidis yonu
    if (rec && rec.prev) {
      var b = bearing(rec.prev.lat, rec.prev.lon, v.latitude, v.longitude);
      if (b !== null) {
        rec.lastHeading = b;
        rec.headingFromMovement = true;
        saveHeading(id, b);
        return b;
      }
    }

    // 2) bu oturumda hareketten hesaplanmis son yon (arac durmus olabilir)
    if (rec && rec.headingFromMovement && Number.isFinite(rec.lastHeading)) {
      return rec.lastHeading;
    }

    // 3) onceki ziyaretten hatirlanan yon (0 = bilinmiyor sayilir)
    if (Number.isFinite(headStore[id]) && headStore[id] !== 0) {
      if (rec) {
        rec.lastHeading = headStore[id];
        rec.headingFromMovement = true;
      }
      return headStore[id];
    }
    return null;
  }

  function bearing(lat1, lon1, lat2, lon2) {
    if (!Number.isFinite(lat1) || !Number.isFinite(lon1)) return null;
    // ~15 m altindaki fark GPS gurultusu sayilir
    if (Math.abs(lat1 - lat2) < 1.4e-4 && Math.abs(lon1 - lon2) < 1.4e-4) return null;
    var r = Math.PI / 180;
    var y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
    var x =
      Math.cos(lat1 * r) * Math.sin(lat2 * r) -
      Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }

  function isMoving(v) {
    return Number(v.speed) > 3;
  }

  function ageMs(v) {
    var t = Date.parse(v.dataTime || v.gpsTime || "");
    return Number.isFinite(t) ? Date.now() - t : NaN;
  }

  function vehicleIcon(v) {
    var moving = isMoving(v);
    var stale = ageMs(v) > STALE_MS;
    var s = iconSize() - 4;   // araclar bir tik kucuk, yine cift sayi
    var yon = moving ? heading(v) : null;

    /* uc durum:
       hareketli + yon biliniyor  -> ok (yon acisiyla dondurulur)
       hareketli + yon bilinmiyor -> yonsuz daire
       duruyor                    -> kare */
    var glyph, rot = "";
    if (!moving) {
      glyph = G.GLYPHS.vehicleIdle;
    } else if (yon === null) {
      glyph = G.GLYPHS.vehicleUnknown;
    } else {
      glyph = G.GLYPHS.vehicle;
      rot = ' style="transform:rotate(' + Math.round(yon) + 'deg)"';
    }

    return L.divIcon({
      className: "gyp-marker cat-vehicle",
      html:
        '<div class="chip vehicle' + (stale ? " stale" : "") + (moving ? " moving" : "") + '">' +
        "<span" + rot + ">" + glyph + "</span></div>",
      iconSize: [s, s],
      iconAnchor: [s / 2, s / 2],
      popupAnchor: [0, -(s / 2 + 4)],
    });
  }

  /* ---------- saha eslestirme ----------
     Aracin en yakin kule/kuyu/tesise uzakligi. Sunucu gerekmez;
     koordinatlar zaten elimizde. */
  var SAHADA_KM = 1.0;    // bu mesafenin altinda "sahada" sayilir
  var YAKIN_KM = 6.0;     // bu mesafenin altinda "yakininda"

  function haversine(aLat, aLon, bLat, bLon) {
    var R = 6371;
    var dLat = ((bLat - aLat) * Math.PI) / 180;
    var dLon = ((bLon - aLon) * Math.PI) / 180;
    var la1 = (aLat * Math.PI) / 180;
    var la2 = (bLat * Math.PI) / 180;
    var h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function allSites() {
    if (!data) return [];
    var out = [];
    (data.rigs || []).forEach(function (r) {
      out.push({ name: r.name, kind: "Kule", lat: r.lat, lon: r.lon });
    });
    (data.facilities || []).forEach(function (f) {
      out.push({ name: f.name, kind: f.type === "workshop" ? "Kamp" : "Ofis", lat: f.lat, lon: f.lon });
    });
    (data.productionSites || []).forEach(function (s) {
      out.push({ name: s.name, kind: "Üretim kuyusu", lat: s.lat, lon: s.lon });
    });
    return out;
  }

  function nearestSite(lat, lon) {
    var best = null;
    allSites().forEach(function (s) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return;
      var km = haversine(lat, lon, s.lat, s.lon);
      if (!best || km < best.km) best = { site: s, km: km };
    });
    return best;
  }

  function siteLabel(lat, lon) {
    var n = nearestSite(lat, lon);
    if (!n) return null;
    var mesafe = n.km < 1 ? Math.round(n.km * 1000) + " m" : n.km.toFixed(1) + " km";
    if (n.km <= SAHADA_KM) return { text: n.site.name + " sahasında", detail: mesafe, near: true };
    if (n.km <= YAKIN_KM) return { text: n.site.name + " yakınında", detail: mesafe, near: false };
    return { text: "En yakın: " + n.site.name, detail: mesafe, near: false };
  }

  function vehiclePopupHtml(v) {
    var age = ageMs(v);
    var stale = age > STALE_MS;
    var sl = siteLabel(v.latitude, v.longitude);
    var h =
      '<div class="pop-head"><p class="pop-title">' + G.escapeHtml(v.plate || "Araç") + "</p>" +
      '<div class="pop-city">' +
      G.escapeHtml([v.city, v.town].filter(Boolean).join(" / ") || "Konum bilgisi yok") +
      "</div></div>";

    if (sl) {
      h +=
        '<div class="pop-site' + (sl.near ? " at" : "") + '">' +
        "<b>" + G.escapeHtml(sl.text) + "</b><span>" + sl.detail + "</span></div>";
    }

    h += '<div class="pop-body pop-body-veh"><div class="veh-chips">';
    h += chip(isMoving(v) ? Math.round(v.speed) + " km/sa" : "Duruyor", isMoving(v) ? "go" : "");
    if (v.ignition) h += chip("Kontak " + (v.ignition === "A" ? "açık" : "kapalı"), "");
    if (v.idleSpeed === "A") h += chip("Rölanti", "idle");
    if (v.vehicleLabel) h += chip(v.vehicleLabel, "");
    h += "</div></div>";
    h +=
      '<div class="pop-since"' + (stale ? ' style="color:#c0392b"' : "") + ">" +
      (Number.isFinite(age) ? "Son veri: " + humanAge(age) : "Son veri zamanı bilinmiyor") +
      "</div>";

    h += '<div class="pop-foot pop-foot-row">';
    if (v.muId) {
      h +=
        '<button type="button" class="trk-btn" data-mu="' + v.muId +
        '" data-plate="' + G.escapeHtml(v.plate || "") + '">Son 6 saat izi</button>';
    }
    h += dirButtonInner(v.latitude, v.longitude, v.plate || "Araç");
    h += "</div>";
    return h;
  }

  function chip(metin, sinif) {
    return '<span class="vchip ' + (sinif || "") + '">' + G.escapeHtml(metin) + "</span>";
  }

  function row(k, val) {
    return '<li><span class="emp-role">' + k + '</span><span class="emp-name">' + G.escapeHtml(val) + "</span></li>";
  }

  function humanAge(ms) {
    if (ms < 60000) return "az önce";
    var dk = Math.round(ms / 60000);
    if (dk < 60) return dk + " dk önce";
    var sa = Math.round(dk / 60);
    if (sa < 24) return sa + " saat önce";
    return Math.round(sa / 24) + " gün önce";
  }

  function setVehicleStatus(text, kind) {
    var el = document.getElementById("veh-status");
    if (!el) return;
    el.textContent = text || "";
    el.className = "veh-status" + (kind ? " " + kind : "");
    el.style.display = text ? "block" : "none";
  }

  function loadVehicles(silent) {
    var base = vehicleServiceUrl();
    if (!base) {
      if (!silent) setVehicleStatus("Araç servisi tanımlı değil", "warn");
      return Promise.resolve();
    }
    if (vehicleLoading) return Promise.resolve();
    vehicleLoading = true;

    return vehicleFetch(base + "/last")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (j) {
        if (!j || j.ok === false) throw new Error(j && j.error ? j.error : "Geçersiz cevap");
        drawVehicles(Array.isArray(j.data) ? j.data : []);
        setVehicleStatus("");
      })
      .catch(function (e) {
        // servis dusse bile harita calismaya devam eder
        var msg = /HTTP 401|HTTP 403/.test(e.message)
          ? "Araç verisi için yetkili girişi gerekiyor"
          : "Araç verisi alınamadı (" + e.message + ")";
        if (!silent) setVehicleStatus(msg, "warn");
        console.warn("arac servisi:", e);
      })
      .then(function () { vehicleLoading = false; });
  }

  function drawVehicles(list) {
    if (!vehicleLayer) vehicleLayer = L.layerGroup();
    if (active.vehicle && !map.hasLayer(vehicleLayer)) vehicleLayer.addTo(map);

    var seen = {};
    list.forEach(function (v) {
      if (!Number.isFinite(v.latitude) || !Number.isFinite(v.longitude)) return;
      var id = v.plate || String(v.muId);
      seen[id] = true;
      var ll = L.latLng(v.latitude, v.longitude);
      var rec = vehicleMarkers[id];
      if (rec) {
        var onceki = rec.data;
        // yalnizca konum gercekten degistiyse 'onceki'yi guncelle;
        // ayni veri tekrar gelirse yon bilgisi kaybolmasin
        if (onceki && bearing(onceki.latitude, onceki.longitude, v.latitude, v.longitude) !== null) {
          rec.prev = { lat: onceki.latitude, lon: onceki.longitude };
        }
        rec.data = v;
        rec.marker.setLatLng(ll);
        var acikti = rec.marker.isPopupOpen && rec.marker.isPopupOpen();
        rec.marker.setIcon(vehicleIcon(v));
        if (acikti) {
          var el = rec.marker.getElement();
          if (el) el.classList.add("is-active");   // yenilemede secili durum kaybolmasin
        }
        rec.marker.setPopupContent(vehiclePopupHtml(v));
      } else {
        var mk = L.marker(ll, { icon: vehicleIcon(v), riseOnHover: true, zIndexOffset: 400 })
          .bindPopup(vehiclePopupHtml(v), { closeButton: true, autoPanPadding: [30, 30] })
          .bindTooltip(id, { permanent: false, direction: "top", className: "gyp-label" });
        // secili durumu (ve dalga efektini) araclara da uygula
        mk.on("popupopen", function () {
          var el = mk.getElement();
          if (el) el.classList.add("is-active");
        });
        mk.on("popupclose", function () {
          var el = mk.getElement();
          if (el) el.classList.remove("is-active");
        });
        vehicleMarkers[id] = { marker: mk, data: v };
      }
    });

    // artik gelmeyen araclari kaldir
    Object.keys(vehicleMarkers).forEach(function (id) {
      if (!seen[id]) {
        vehicleLayer.removeLayer(vehicleMarkers[id].marker);
        delete vehicleMarkers[id];
      }
    });

    var el = document.getElementById("cnt-vehicle");
    if (el) el.textContent = Object.keys(vehicleMarkers).length;

    lastVehicles = list.filter(function (v) {
      return Number.isFinite(v.latitude) && Number.isFinite(v.longitude);
    });
    updateSummary(lastVehicles);
    applyStatusFilter();
    if (document.getElementById("veh-panel").classList.contains("open")) renderVehicleList();
  }

  function startVehiclePolling() {
    stopVehiclePolling();
    loadVehicles();
    // Ilk acilista yon icin ikinci bir olcum gerekiyor; tam periyodu
    // beklemeden erken bir sorgu at (servis onbellegi bitmis olur).
    setTimeout(function () {
      if (active.vehicle && !document.hidden) loadVehicles(true);
    }, 12000);
    vehicleTimer = setInterval(function () {
      if (document.hidden) return;   // sekme arka plandayken sorgu atma
      loadVehicles();
    }, REFRESH_MS);
  }

  function stopVehiclePolling() {
    if (vehicleTimer) clearInterval(vehicleTimer);
    vehicleTimer = null;
  }

  /* ---------- gecmis iz + zaman cizelgesi ---------- */
  var trackLayer = null;
  var trackPoints = [];
  var trackDot = null;

  // saglayici "yyyy-MM-dd'T'HH:mm:ssZ" bekliyor, + escape edilmeli.
  // URLSearchParams zaten %2B'ye cevirir.
  function apiTime(d) {
    var p = function (n, w) { return String(n).padStart(w || 2, "0"); };
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? "+" : "-";
    off = Math.abs(off);
    return (
      d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" +
      p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()) +
      sign + p(Math.floor(off / 60)) + p(off % 60)
    );
  }

  /* Iz gorunumunde harita sadelesir: diger tum isaretler gizlenir,
     yalnizca izi incelenen arac kalir. */
  var trackFocus = null;

  function enterTrackMode(plate) {
    trackFocus = plate;
    if (markerLayer && map.hasLayer(markerLayer)) map.removeLayer(markerLayer);
    if (ghostLayer && map.hasLayer(ghostLayer)) map.removeLayer(ghostLayer);
    if (trailLayer && map.hasLayer(trailLayer)) map.removeLayer(trailLayer);
    Object.keys(vehicleMarkers).forEach(function (id) {
      if (id !== plate && vehicleLayer.hasLayer(vehicleMarkers[id].marker)) {
        vehicleLayer.removeLayer(vehicleMarkers[id].marker);
      }
    });
    var s = document.getElementById("veh-summary");
    if (s) s.style.display = "none";
    toggleVehiclePanel(false);
    declutter();
  }

  function exitTrackMode() {
    if (!trackFocus) return;
    trackFocus = null;
    if (markerLayer && !map.hasLayer(markerLayer)) markerLayer.addTo(map);
    applyFilters();          // katman filtrelerini yeniden uygula
    applyStatusFilter();     // gizlenen arac isaretcilerini geri getir
    updateSummary(lastVehicles);
  }

  function clearTrack() {
    if (trackLayer) map.removeLayer(trackLayer);
    trackLayer = null;
    trackDot = null;
    trackPoints = [];
    var el = document.getElementById("timeline");
    if (el) el.style.display = "none";
    exitTrackMode();
  }

  function loadTrack(muId, plate, hours) {
    var base = vehicleServiceUrl();
    if (!base) return;
    hours = hours || 6;
    var end = new Date();
    var start = new Date(Date.now() - hours * 3600000);
    var qs = new URLSearchParams({
      muId: String(muId),
      startTime: apiTime(start),
      endTime: apiTime(end),
    });

    setVehicleStatus("İz yükleniyor…");
    vehicleFetch(base + "/locations?" + qs.toString())
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (j) {
        var pts = (j && Array.isArray(j.data) ? j.data : [])
          .filter(function (p) { return Number.isFinite(p.latitude) && Number.isFinite(p.longitude); })
          .map(function (p) { return { lat: p.latitude, lon: p.longitude, t: Date.parse(p.time) }; })
          .sort(function (a, b) { return a.t - b.t; });

        if (pts.length < 2) {
          setVehicleStatus("Bu aralıkta iz verisi yok", "warn");
          setTimeout(function () { setVehicleStatus(""); }, 3000);
          return;
        }
        drawTrack(pts, plate, hours);
        enterTrackMode(plate);
        setVehicleStatus("");
      })
      .catch(function (e) {
        setVehicleStatus("İz alınamadı (" + e.message + ")", "warn");
      });
  }

  function drawTrack(pts, plate, hours) {
    clearTrack();
    trackPoints = pts;
    trackLayer = L.layerGroup().addTo(map);

    var latlngs = pts.map(function (p) { return [p.lat, p.lon]; });
    L.polyline(latlngs, { color: "#ffffff", weight: 4, opacity: 0.35 }).addTo(trackLayer);
    L.polyline(latlngs, { color: "#4fa6f0", weight: 2.2, opacity: 0.95 }).addTo(trackLayer);

    L.circleMarker(latlngs[0], {
      radius: 5, color: "#fff", weight: 2, fillColor: "#2ecc71", fillOpacity: 1,
    }).addTo(trackLayer).bindTooltip("Başlangıç", { direction: "top" });

    trackDot = L.circleMarker(latlngs[latlngs.length - 1], {
      radius: 6, color: "#fff", weight: 2, fillColor: "#4fa6f0", fillOpacity: 1,
    }).addTo(trackLayer);

    // iz uzerine aralikli yon oklari: hangi yone gidildigi belli olsun
    var adim = Math.max(1, Math.floor(pts.length / 7));
    for (var i = adim; i < pts.length; i += adim) {
      var a = pts[i - 1], b2 = pts[i];
      var yon = bearing(a.lat, a.lon, b2.lat, b2.lon);
      if (yon === null) continue;
      L.marker([b2.lat, b2.lon], {
        interactive: false,
        icon: L.divIcon({
          className: "trk-arrow",
          html: '<span style="transform:rotate(' + Math.round(yon) + 'deg)">' +
                '<svg viewBox="0 0 24 24" width="11" height="11">' +
                '<path d="M12 4 L18 19 L12 15.5 L6 19 Z" fill="#cfe6ff"/></svg></span>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      }).addTo(trackLayer);
    }

    map.fitBounds(L.latLngBounds(latlngs).pad(0.15));
    showTimeline(plate, hours);
  }

  function showTimeline(plate, hours) {
    var el = document.getElementById("timeline");
    if (!el) return;
    el.style.display = "flex";
    el.querySelector(".tl-title").textContent = (plate || "Araç") + " · son " + hours + " saat";
    var slider = el.querySelector(".tl-range");
    slider.max = String(trackPoints.length - 1);
    slider.value = slider.max;
    updateTimeline(trackPoints.length - 1);
  }

  function updateTimeline(i) {
    var p = trackPoints[i];
    if (!p || !trackDot) return;
    trackDot.setLatLng([p.lat, p.lon]);
    var el = document.getElementById("timeline");
    var t = new Date(p.t);
    el.querySelector(".tl-time").textContent = Number.isFinite(p.t)
      ? t.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) +
        " · " + t.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" })
      : "";
  }

  /* ---------- durum ozeti (tiklanabilir alt filtre) ---------- */
  var statusFilter = null;   // null | "hareket" | "rolanti" | "duran" | "eski"

  function vehicleStatus(v) {
    if (ageMs(v) > STALE_MS) return "eski";
    if (isMoving(v)) return "hareket";
    if (v.idleSpeed === "A") return "rolanti";
    return "duran";
  }

  function statusMatches(v) {
    return !statusFilter || vehicleStatus(v) === statusFilter;
  }

  function updateSummary(list) {
    var el = document.getElementById("veh-summary");
    if (!el) return;
    if (!active.vehicle || !list.length || trackFocus) {
      el.style.display = "none";
      if (!trackFocus) statusFilter = null;
      return;
    }
    var say = { hareket: 0, rolanti: 0, duran: 0, eski: 0 };
    list.forEach(function (v) { say[vehicleStatus(v)]++; });

    // secili durumda hic arac kalmadiysa filtreyi birak
    if (statusFilter && !say[statusFilter]) statusFilter = null;

    el.style.display = "flex";
    el.innerHTML =
      pill("hareket", say.hareket, "Hareket halinde") +
      pill("rolanti", say.rolanti, "Rölantide") +
      pill("duran", say.duran, "Duruyor") +
      (say.eski ? pill("eski", say.eski, "Veri eski") : "");
  }

  function pill(cls, n, label) {
    var on = statusFilter === cls;
    return (
      '<button type="button" class="vs-pill ' + cls + (on ? " on" : "") +
      (n ? "" : " empty") + '" data-st="' + cls + '"' + (n ? "" : " disabled") +
      ' aria-pressed="' + (on ? "true" : "false") + '">' +
      "<b>" + n + "</b>" + label + "</button>"
    );
  }

  function setStatusFilter(st) {
    statusFilter = statusFilter === st ? null : st;
    applyStatusFilter();
    updateSummary(lastVehicles);
    if (document.getElementById("veh-panel").classList.contains("open")) renderVehicleList();
  }

  // haritadaki isaretcileri duruma gore goster/gizle
  function applyStatusFilter() {
    if (!vehicleLayer) return;
    Object.keys(vehicleMarkers).forEach(function (id) {
      var rec = vehicleMarkers[id];
      var goster = trackFocus ? id === trackFocus : statusMatches(rec.data);
      var ekli = vehicleLayer.hasLayer(rec.marker);
      if (goster && !ekli) rec.marker.addTo(vehicleLayer);
      else if (!goster && ekli) vehicleLayer.removeLayer(rec.marker);
    });
    declutter();
  }

  /* ---------- arac listesi paneli ---------- */
  var lastVehicles = [];

  /* Liste yalnizca ACIK katmanlari gosterir. Kule secili ise sadece kuleler,
     kule + ofis secili ise ikisi birden listelenir. */
  var KATEGORI_ADI = {
    rig: "Kuleler", office: "Ofisler", workshop: "Kamplar",
    production: "Üretim Kuyuları", vehicle: "Araçlar",
  };

  function listeKayitlari() {
    var out = [];
    markers.forEach(function (m) {
      if (!active[m.cat]) return;
      out.push({
        id: m.label, cat: m.cat, ad: m.label,
        alt: m.altBilgi || "", sag: "", nokta: "",
      });
    });
    if (active.vehicle) {
      lastVehicles.forEach(function (v) {
        if (!statusMatches(v)) return;
        var sl = siteLabel(v.latitude, v.longitude);
        out.push({
          id: v.plate || String(v.muId), cat: "vehicle",
          ad: v.plate || "—",
          alt: sl ? sl.text : "Konum yok",
          sag: isMoving(v) ? Math.round(v.speed) + " km/sa" : "—",
          nokta: vehicleStatus(v),
        });
      });
    }
    return out;
  }

  function renderVehicleList() {
    var host = document.getElementById("veh-list");
    if (!host) return;
    var q = (document.getElementById("veh-search").value || "").trim().toLocaleLowerCase("tr");

    var rows = listeKayitlari().filter(function (r) {
      if (!q) return true;
      return (
        r.ad.toLocaleLowerCase("tr").indexOf(q) !== -1 ||
        (r.alt || "").toLocaleLowerCase("tr").indexOf(q) !== -1
      );
    });

    if (!rows.length) {
      host.innerHTML =
        '<p class="veh-empty">' +
        (q ? "Eşleşen kayıt yok"
           : statusFilter ? "Bu durumda araç yok"
           : "Görüntülemek için yukarıdan katman seçin") + "</p>";
      return;
    }

    // kategoriye gore grupla, filtre seridindeki sirayi izle
    var sira = CATEGORIES.map(function (c) { return c.key; });
    var gruplar = {};
    rows.forEach(function (r) { (gruplar[r.cat] = gruplar[r.cat] || []).push(r); });

    var html = "";
    sira.forEach(function (k) {
      var g = gruplar[k];
      if (!g || !g.length) return;
      g.sort(function (a, b) {
        if (k === "vehicle") {
          var am = a.nokta === "hareket" ? 0 : 1, bm = b.nokta === "hareket" ? 0 : 1;
          if (am !== bm) return am - bm;
        }
        return a.ad.localeCompare(b.ad, "tr", { numeric: true });
      });
      html +=
        '<p class="liste-baslik cat-' + k + '"><span class="liste-nokta"></span>' +
        G.escapeHtml(KATEGORI_ADI[k] || k) + '<em>' + g.length + "</em></p>";
      html += g.map(function (r) {
        return (
          '<button type="button" class="veh-row" data-id="' + G.escapeHtml(r.id) +
          '" data-cat="' + r.cat + '">' +
          (r.cat === "vehicle"
            ? '<span class="veh-dot ' + r.nokta + '"></span>'
            : '<span class="veh-dot cat-' + r.cat + ' tur"></span>') +
          '<span class="veh-main"><b>' + G.escapeHtml(r.ad) + "</b>" +
          (r.alt ? "<em>" + G.escapeHtml(r.alt) + "</em>" : "") + "</span>" +
          '<span class="veh-speed">' + G.escapeHtml(r.sag) + "</span>" +
          "</button>"
        );
      }).join("");
    });
    host.innerHTML = html;
  }

  function focusKayit(id, cat) {
    if (cat === "vehicle") {
      var rec = vehicleMarkers[id];
      if (!rec) return;
      if (vehicleLayer && !vehicleLayer.hasLayer(rec.marker)) {
        statusFilter = null;
        applyStatusFilter();
        updateSummary(lastVehicles);
        renderVehicleList();
      }
      map.flyTo(rec.marker.getLatLng(), Math.min(map.getMaxZoom(), 14), { duration: 0.8 });
      setTimeout(function () { rec.marker.openPopup(); }, 850);
      return;
    }
    var m = markers.filter(function (x) { return x.label === id && x.cat === cat; })[0];
    if (!m) return;
    map.flyTo(m.latlng, Math.min(map.getMaxZoom(), 14), { duration: 0.8 });
    setTimeout(function () { m.marker.openPopup(); }, 850);
  }

  function toggleVehiclePanel(force) {
    var p = document.getElementById("veh-panel");
    if (!p) return;
    var open = force !== undefined ? force : !p.classList.contains("open");
    p.classList.toggle("open", open);
    var btn = document.getElementById("veh-panel-btn");
    if (btn) btn.classList.toggle("on", open);
    if (open) renderVehicleList();
  }

  function wireVehicleUi() {
    // Panel, zaman cizelgesi ve rozetler harita konteynerinin icinde duruyor.
    // Leaflet dokunma/kaydirma olaylarini yakaladigi icin telefonda liste
    // kaydirilamiyordu; bu ogeler uzerinde olay yayilimini kesiyoruz.
    ["veh-panel", "timeline", "veh-summary", "veh-panel-btn", "veh-status"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
    });

    var s = document.getElementById("veh-search");
    if (s) s.addEventListener("input", renderVehicleList);

    var list = document.getElementById("veh-list");
    if (list) {
      list.addEventListener("click", function (e) {
        var b = e.target.closest(".veh-row");
        if (b) focusKayit(b.dataset.id, b.dataset.cat);
      });
    }

    var btn = document.getElementById("veh-panel-btn");
    if (btn) btn.addEventListener("click", function () { toggleVehiclePanel(); });

    var sum = document.getElementById("veh-summary");
    if (sum) {
      sum.addEventListener("click", function (e) {
        var b = e.target.closest(".vs-pill");
        if (b && !b.disabled) setStatusFilter(b.dataset.st);
      });
    }

    var close = document.getElementById("veh-panel-close");
    if (close) close.addEventListener("click", function () { toggleVehiclePanel(false); });

    // iz butonu popup icinde olusur, delegasyonla yakalanir
    document.getElementById("map").addEventListener("click", function (e) {
      var t = e.target.closest(".trk-btn");
      if (!t) return;
      e.preventDefault();
      loadTrack(t.dataset.mu, t.dataset.plate, 6);
    });

    var tl = document.getElementById("timeline");
    if (tl) {
      tl.querySelector(".tl-range").addEventListener("input", function (e) {
        updateTimeline(Number(e.target.value));
      });
      tl.querySelector(".tl-close").addEventListener("click", clearTrack);
    }
  }

  /* ---------- katman seridi ac/kapa ---------- */
  var BAR_KEY = "gyp-filters-collapsed";

  function setBar(collapsed) {
    var bar = document.getElementById("filter-bar");
    var btn = document.getElementById("filter-toggle");
    if (!bar) return;
    bar.classList.toggle("collapsed", collapsed);
    if (btn) btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    try { localStorage.setItem(BAR_KEY, collapsed ? "1" : "0"); } catch (e) {}
    // serit yuksekligi degisti, harita yeniden olculmeli
    setTimeout(function () {
      if (map) { map.invalidateSize(); declutter(); }
    }, 280);
  }

  function updateBarSummary() {
    var el = document.getElementById("ft-active");
    if (!el) return;
    var acik = CATEGORIES.filter(function (c) { return active[c.key]; });
    if (!acik.length) el.textContent = "— hiçbiri seçili değil";
    else if (acik.length === CATEGORIES.length) el.textContent = "— tümü";
    else el.textContent = "— " + acik.map(function (c) { return c.label; }).join(", ");
  }

  function wireBar() {
    var btn = document.getElementById("filter-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var bar = document.getElementById("filter-bar");
      setBar(!bar.classList.contains("collapsed"));
    });
    var saved = null;
    try { saved = localStorage.getItem(BAR_KEY); } catch (e) {}
    if (saved === "1") setBar(true);
    updateBarSummary();
  }

  /* ---------- tur filtreleri ---------- */
  // acilis: hepsi kapali. her tur bagimsiz. "Tumu" toggle.
  var CATEGORIES = [
    { key: "rig", label: "Kuleler", glyph: "rig" },
    { key: "office", label: "Ofisler", glyph: "office" },
    { key: "workshop", label: "Kamplar", glyph: "workshop" },
    { key: "production", label: "Üretim Kuyuları", glyph: "production" },
    { key: "vehicle", label: "Araçlar", glyph: "vehicle" },
  ];
  var ALL_SVG =
    '<svg viewBox="0 0 24 20" width="19" height="16" aria-hidden="true">' +
    '<rect class="gl" x="2" y="2.4" width="8.6" height="7" rx="1.6"/>' +
    '<rect class="gl" x="13.4" y="2.4" width="8.6" height="7" rx="1.6"/>' +
    '<rect class="gl" x="2" y="11.4" width="8.6" height="7" rx="1.6"/>' +
    '<rect class="gl" x="13.4" y="11.4" width="8.6" height="7" rx="1.6"/></svg>';

  var active = { rig: false, office: false, workshop: false, production: false, vehicle: false };

  function allOn() {
    var izinli = CATEGORIES.filter(function (c) {
      return yetkiliMi(c.key) && (!stokModu || STOK_TURLERI.indexOf(c.key) !== -1);
    });
    return izinli.length > 0 && izinli.every(function (c) { return active[c.key]; });
  }

  function buildFilters() {
    var host = document.getElementById("filters");
    var html =
      '<button type="button" class="filter all" data-key="all" aria-pressed="false">' +
      '<span class="filter-icon">' + ALL_SVG + "</span>" +
      "<span>Tümü</span></button>";

    html += CATEGORIES.map(function (c) {
      return (
        '<button type="button" class="filter" data-key="' + c.key + '" aria-pressed="false">' +
        '<span class="filter-icon">' + G.GLYPHS[c.glyph] + "</span>" +
        "<span>" + c.label + "</span>" +
        '<span class="filter-count" id="cnt-' + c.key + '">0</span>' +
        '<span class="kilit" title="Erişmek için yetkili girişi yapınız." aria-label="Erişmek için yetkili girişi yapınız.">' +
        '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
        '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/>' +
        '<path d="M8.4 10.5V7.6a3.6 3.6 0 017.2 0v2.9" fill="none" stroke="currentColor" stroke-width="2"/></svg></span>' +
        "</button>"
      );
    }).join("");
    host.innerHTML = html;

    host.addEventListener("click", function (e) {
      var b = e.target.closest(".filter");
      if (!b) return;
      var k = b.dataset.key;
      // stok modunda kapsam disi turler (uretim kuyusu, arac) tiklanamaz
      if (stokModu && k !== "all" && STOK_TURLERI.indexOf(k) === -1) return;
      if (k !== "all" && !yetkiliMi(k)) { modalAc(true); return; }
      if (k === "all") {
        var kapsam = CATEGORIES.filter(function (c) {
          return !stokModu || STOK_TURLERI.indexOf(c.key) !== -1;
        });
        var turnOff = allOn();
        kapsam.forEach(function (c) { active[c.key] = yetkiliMi(c.key) ? !turnOff : false; });
      } else {
        active[k] = !active[k];
      }
      syncFilters();
      applyFilters();
    });
  }

  function syncFilters() {
    document.querySelectorAll(".filter").forEach(function (b) {
      var k = b.dataset.key;
      var on = k === "all" ? allOn() : !!active[k];
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      if (k !== "all") {
        var izin = yetkiliMi(k);
        var stokDisi = stokModu && STOK_TURLERI.indexOf(k) === -1;
        b.classList.toggle("kilitli", !izin || stokDisi);
        // sayilar yalnizca icerik yetkisi olana gorunur
        b.classList.toggle("sayisiz", izin && !icerikGorunur(k));
        b.title = !izin
          ? "Erişmek için yetkili girişi yapınız."
          : stokDisi ? "Stok görünümünde kullanılamaz." : "";
      }
    });
    // hicbiri secili degilse "Tumu" dikkat cekmeye devam etsin
    var tumu = document.querySelector('.filter[data-key="all"]');
    if (tumu) {
      tumu.classList.toggle("hint", CATEGORIES.every(function (c) { return !active[c.key]; }));
    }
    updateBarSummary();
  }

  function applyFilters() {
    markers.forEach(function (m) {
      var want = !!active[m.cat];
      var on = markerLayer.hasLayer(m.marker);
      if (want && !on) m.marker.addTo(markerLayer);
      else if (!want && on) markerLayer.removeLayer(m.marker);
    });
    var showGhosts = !!active.rig;
    [ghostLayer, trailLayer].forEach(function (l) {
      if (!l) return;
      if (showGhosts && !map.hasLayer(l)) l.addTo(map);
      else if (!showGhosts && map.hasLayer(l)) map.removeLayer(l);
    });

    // araclar acikken sorgula, kapaninca durdur
    var acikVar = CATEGORIES.some(function (c) { return active[c.key]; });
    var pb = document.getElementById("veh-panel-btn");
    if (pb) pb.style.display = acikVar ? "flex" : "none";

    if (document.getElementById("veh-panel").classList.contains("open")) renderVehicleList();

    if (active.vehicle) {
      if (!vehicleLayer) vehicleLayer = L.layerGroup();
      if (!map.hasLayer(vehicleLayer)) vehicleLayer.addTo(map);
      if (!vehicleTimer) startVehiclePolling();
    } else {
      stopVehiclePolling();
      setVehicleStatus("");
      if (vehicleLayer && map.hasLayer(vehicleLayer)) map.removeLayer(vehicleLayer);
      clearTrack();
      lastVehicles = [];
      statusFilter = null;
      updateSummary([]);
    }

    declutter();
  }

  /* ---------- stok modu ----------
     Harita griye doner, mevcut isaretciler durur ama tiklanamaz.
     Amac: ileride eklenecek stok gosterimi digerleriyle karismasin. */
  var stokModu = false;
  var stokOncesi = null;
  // stok gorunumunde yer alan turler: uretim kuyulari ve araclar disarida
  var STOK_TURLERI = ["rig", "office", "workshop"];

  function stokPopupHtml(m) {
    // kasitli olarak sade: sehir/adres/ekip gibi bilgiler burada YOK.
    // amac stok bakarken ekranda baska bilgiyle karismamasi.
    var h = '<div class="pop-head"><p class="pop-title">' + G.escapeHtml(m.label) + "</p></div>";
    h += '<div class="pop-body stok-bolum"><p class="sec-label">Stoktakiler:</p>' +
         '<p class="empty-note">Henüz kayıt girilmedi.</p></div>';
    return h;
  }

  function tazeleStokBalonlari() {
    markers.forEach(function (m) {
      if (!m.normalPopup) m.normalPopup = m.marker.getPopup().getContent();
      m.marker.setPopupContent(stokModu ? stokPopupHtml(m) : m.normalPopup);
    });
  }

  function stokDegistir() {
    stokModu = !stokModu;
    var kok = document.documentElement;
    kok.classList.toggle("stok-modu", stokModu);

    var btn = document.getElementById("stok-btn");
    var yazi = document.getElementById("stok-btn-yazi");
    if (yazi) yazi.textContent = stokModu ? "Harita" : "Stoklar";
    if (btn) {
      btn.classList.toggle("on", stokModu);
      btn.setAttribute("aria-pressed", stokModu ? "true" : "false");
    }

    if (stokModu) {
      map.closePopup();
      clearTrack();
      toggleVehiclePanel(false);
      setVehicleStatus("");
      // stok gorunumunde acilacak katmanlari hatirla
      stokOncesi = {};
      CATEGORIES.forEach(function (c) { stokOncesi[c.key] = active[c.key]; });
      CATEGORIES.forEach(function (c) {
        active[c.key] = STOK_TURLERI.indexOf(c.key) !== -1 && yetkiliMi(c.key);
      });
    } else if (stokOncesi) {
      CATEGORIES.forEach(function (c) { active[c.key] = !!stokOncesi[c.key]; });
      stokOncesi = null;
    }

    // balon icerigi moda gore degisiyor
    tazeleStokBalonlari();
    syncFilters();
    applyFilters();

    // maske rengi tema degiskeninden geliyor; katmani tazele
    if (maskLayer) maskLayer.setStyle({ fillColor: cssVar("--mask") });
    if (borderLayer) borderLayer.setStyle({ color: cssVar("--border-stroke") });
    declutter();
  }

  function wireStok() {
    var btn = document.getElementById("stok-btn");
    if (btn) btn.addEventListener("click", function () {
      var izinli = A ? A.yetkili("stock") : true;
      if (!izinli) { modalAc(true); return; }
      stokDegistir();
    });
  }

  /* ---------- yetkili girisi ---------- */
  var A = window.GYPAuth;

  /* Lokasyonlar (kule/ofis/kamp/kuyu) herkese acik: konum gorulur, yol tarifi
     alinir. Icerik (ekip listesi, sayilar) ve ARACLAR giris ister. */
  var ACIK_TURLER = ["rig", "office", "workshop", "production"];

  function girisliMi() {
    return A ? A.girisliMi() : true;
  }

  function yetkiliMi(tur) {
    if (!A) return true;
    if (A.girisliMi()) return A.yetkili(tur);
    return ACIK_TURLER.indexOf(tur) !== -1;
  }

  // ekip listesi, personel sayisi gibi ayrintilar
  function icerikGorunur(tur) {
    return A ? A.yetkili(tur) : true;
  }

  function modalAc(goster) {
    var fon = document.getElementById("giris-fon");
    if (!fon) return;
    fon.hidden = !goster;
    if (goster) {
      if (A && A.yoneticiMi()) yonetimTazele();
      var g = document.getElementById("giris-ekrani");
      var y = document.getElementById("yonetim-ekrani");
      var yon = A && A.yoneticiMi();
      g.hidden = !!yon;
      y.hidden = !yon;
      document.getElementById("modal-baslik").textContent =
        yon ? "Yetkili Yönetimi" : "Yetkili Girişi";
      if (!yon) setTimeout(function () {
        var e = document.getElementById("giris-eposta");
        if (e) e.focus();
      }, 60);
    }
  }

  function hata(id, mesaj) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = mesaj || "";
    el.hidden = !mesaj;
  }

  function yetkiKutulariniKur() {
    var host = document.getElementById("yetki-kutulari");
    if (!host) return;
    // CATEGORIES haritadaki varlik turleri (kule/ofis/...); Stoklar ayri bir
    // ozellik yetkisi oldugu icin elle ekleniyor.
    var ozel = [{ key: "stock", label: "Stoklar" }];
    host.innerHTML = CATEGORIES.concat(ozel).map(function (c) {
      return (
        '<label class="tik-satir"><input type="checkbox" data-yetki="' + c.key + '"> ' +
        G.escapeHtml(c.label) + "</label>"
      );
    }).join("");
  }

  async function yonetimTazele() {
    if (!A) return;
    var kim = document.getElementById("yonetim-kim");
    var akt = A.aktif();
    if (kim && akt) kim.textContent = akt.eposta + " olarak giriş yapıldı.";

    var host = document.getElementById("kullanici-liste");
    if (!host) return;
    host.innerHTML = '<p class="modal-not">Yükleniyor…</p>';
    var liste = await A.kullaniciListesi();
    host.innerHTML = liste.map(function (k) {
      var yetkiler = CATEGORIES.concat([{ key: "stock", label: "Stoklar" }])
        .filter(function (c) { return k.yetki[c.key]; })
        .map(function (c) { return c.label; });
      return (
        '<div class="kullanici-satir">' +
        '<div><b>' + G.escapeHtml(k.eposta) + "</b>" +
        (k.yonetici ? '<span class="rozet">yönetici</span>' : "") +
        "<em>" + G.escapeHtml(yetkiler.length ? yetkiler.join(", ") : "yetki yok") + "</em></div>" +
        '<button type="button" class="sil-btn" data-sil="' + G.escapeHtml(k.eposta) + '">Sil</button>' +
        "</div>"
      );
    }).join("");
  }

  function yetkiUygula() {
    var girisli = A ? A.girisliMi() : true;

    // baslik: sayilar yalnizca girisli kullaniciya
    var st = document.getElementById("stats");
    if (st) st.classList.toggle("kilitli", !girisli);

    // yetkisiz katmanlar kapatilir
    CATEGORIES.forEach(function (c) {
      if (!yetkiliMi(c.key) && active[c.key]) active[c.key] = false;
    });

    // stok modu ayri bir yetki ister ("stock"); yalnizca girisli olmak yetmez
    var stokYetkili = A ? A.yetkili("stock") : true;
    var sb = document.getElementById("stok-btn");
    if (sb) {
      sb.classList.toggle("kilitli", !stokYetkili);
      // disabled birakilirsa tiklama hic tetiklenmez ve giris penceresi
      // acilamaz; yalnizca gorsel olarak kilitli gosteriliyor.
      sb.disabled = false;
      sb.title = stokYetkili ? "" : "Erişmek için yetkili girişi yapınız.";
    }
    if (!stokYetkili && stokModu) stokDegistir();

    var btn = document.getElementById("yetki-btn");
    var yazi = document.getElementById("yetki-btn-yazi");
    if (btn && yazi) {
      btn.classList.toggle("on", girisli);
      yazi.textContent = girisli
        ? (A.yoneticiMi() ? "Yönetim" : "Çıkış")
        : "Yetkili Girişi";
    }

    syncFilters();
    applyFilters();
  }

  function wireGiris() {
    if (!A) return;
    yetkiKutulariniKur();

    var btn = document.getElementById("yetki-btn");
    if (btn) btn.addEventListener("click", function () {
      if (A.girisliMi() && !A.yoneticiMi()) { A.cikisYap(); return; }
      modalAc(true);
    });

    var kapat = document.getElementById("giris-kapat");
    if (kapat) kapat.addEventListener("click", function () { modalAc(false); });

    var fon = document.getElementById("giris-fon");
    if (fon) fon.addEventListener("click", function (e) {
      if (e.target === fon) modalAc(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") modalAc(false);
    });

    var gir = document.getElementById("giris-yap");
    function dene() {
      var e = document.getElementById("giris-eposta").value;
      var s = document.getElementById("giris-sifre").value;
      A.girisYap(e, s).then(function (r) {
        if (!r.ok) { hata("giris-hata", r.mesaj); return; }
        hata("giris-hata", "");
        document.getElementById("giris-sifre").value = "";
        if (A.yoneticiMi()) modalAc(true);
        else modalAc(false);
      });
    }
    if (gir) gir.addEventListener("click", dene);
    ["giris-eposta", "giris-sifre"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("keydown", function (e) {
        if (e.key === "Enter") dene();
      });
    });

    var kaydet = document.getElementById("kullanici-kaydet");
    if (kaydet) kaydet.addEventListener("click", function () {
      var e = document.getElementById("yeni-eposta").value;
      var s = document.getElementById("yeni-sifre").value;
      var yetki = {};
      document.querySelectorAll("[data-yetki]").forEach(function (k) {
        yetki[k.dataset.yetki] = k.checked;
      });
      var yon = document.getElementById("yeni-yonetici").checked;
      A.kullaniciEkle(e, s, yetki, yon).then(function (r) {
        if (!r.ok) { hata("yonetim-hata", r.mesaj); return; }
        hata("yonetim-hata", "");
        document.getElementById("yeni-eposta").value = "";
        document.getElementById("yeni-sifre").value = "";
        document.getElementById("yeni-yonetici").checked = false;
        document.querySelectorAll("[data-yetki]").forEach(function (k) { k.checked = false; });
        yonetimTazele();
      }).catch(function () { hata("yonetim-hata", "Sunucuya ulaşılamadı."); });
    });

    var liste = document.getElementById("kullanici-liste");
    if (liste) liste.addEventListener("click", function (e) {
      var b = e.target.closest("[data-sil]");
      if (!b) return;
      if (!confirm(b.dataset.sil + " silinsin mi?")) return;
      A.kullaniciSil(b.dataset.sil).then(function (r) {
        if (!r.ok) hata("yonetim-hata", r.mesaj);
        else { hata("yonetim-hata", ""); yonetimTazele(); }
      });
    });

    // yonetim ekranindan cikis
    var kimEl = document.getElementById("yonetim-kim");
    if (kimEl) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "ikinci-btn cikis";
      c.textContent = "Çıkış Yap";
      c.addEventListener("click", function () { A.cikisYap(); modalAc(false); });
      kimEl.parentNode.insertBefore(c, kimEl.nextSibling);
    }

    document.addEventListener("gyp-auth", yetkiUygula);
  }

  /* ---------- kontroller ---------- */
  function addControls() {
    var Legend = L.Control.extend({
      options: { position: "bottomleft" },
      onAdd: function () {
        var d = L.DomUtil.create("div", "legend");
        d.innerHTML =
          '<span class="legend-item"><span class="swatch"></span> Kule / Tesis</span>' +
          '<span class="legend-item"><span class="swatch ghost"></span> Önceki lokasyon</span>' +
          '<span class="legend-item legend-hint" id="label-hint">Kule adları için yakınlaştırın</span>';
        L.DomEvent.disableClickPropagation(d);
        return d;
      },
    });
    new Legend().addTo(map);

    var LayerBox = L.Control.extend({
      options: { position: "topright" },
      onAdd: function () {
        var wrap = L.DomUtil.create("div", "layerwrap");
        var d = L.DomUtil.create("div", "layerbox", wrap);
        d.id = "layerbox";
        d.innerHTML =
          '<button data-base="night">Gece</button><button data-base="day">Gündüz</button>';
        var hint = L.DomUtil.create("div", "zoom-hint", wrap);
        hint.id = "zoom-hint";
        hint.textContent = "Yakın plan — detaylı uydu görüntüsü";
        hint.style.display = "none";
        var cap = L.DomUtil.create("div", "zoom-hint cap", wrap);
        cap.id = "cap-hint";
        cap.textContent = "Bu bölgedeki en yakın uydu görüntüsü";
        cap.style.display = "none";
        L.DomEvent.disableClickPropagation(wrap);
        d.addEventListener("click", function (e) {
          var b = e.target.closest("button");
          if (b) switchBase(b.dataset.base);
        });
        return wrap;
      },
    });
    new LayerBox().addTo(map);
  }

  /* ---------- başlat ---------- */
  function init() {
    setThemeIconOnly(G.readTheme());
    G.applyTheme(G.readTheme());

    map = L.map("map", {
      zoomControl: true,
      attributionControl: true,
      minZoom: 5,
      maxZoom: MAX_ZOOM,
      worldCopyJump: false,
    });
    map.fitBounds(TURKEY_BOUNDS, { padding: [24, 24] });
    // Balon acilirken Leaflet haritayi kaydiriyor; sinir cok darsa kaydiramiyor
    // ve balon ust kenardan tasiyor. Pay genis tutuldu.
    // Dar/uzun telefon ekranlarinda gorunur alan sinirlardan yuksek kalinca
    // Leaflet dikey kaydirmayi tamamen kilitliyor ve balon ust kenardan
    // tasiyordu. Pay bol tutuldu.
    map.setMaxBounds(TURKEY_BOUNDS.pad(2.4));

    buildBaseLayers();
    switchBase(G.readTheme() === "dark" ? "night" : "day");
    buildMask();
    addControls();
    wireDirections();
    buildFilters();
    wireVehicleUi();
    wireBar();
    wireStok();
    wireGiris();
    // yetkili listesi yuklenince arayuzu ona gore ayarla
    if (A && A.yukle) A.yukle().then(yetkiUygula);
    else yetkiUygula();

    map.on("moveend", updateZoomCap);
    updateZoomCap();
    map.on("zoomend", refreshIconSizes);
    map.on("zoomend moveend resize", declutter);
    map.on("zoomend", applyLayer);

    var wasCompact = G.isCompact();
    window.addEventListener("resize", function () {
      var now = G.isCompact();
      if (now !== wasCompact) {
        wasCompact = now;
        if (data) render();
      }
    });

    document.getElementById("theme-btn").addEventListener("click", function () {
      setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });

    fetch(G.DATA_URL, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("data.json okunamadı (" + r.status + ")");
        return r.json();
      })
      .then(function (json) {
        data = json;
        render();
        bitir();
        // arac sayaci filtre acilmadan da dolsun (servis onbellekli, ucuz)
        loadVehicles(true);
      })
      .catch(function (err) {
        bitir();
        document.getElementById("load-error").style.display = "block";
        document.getElementById("load-error").textContent =
          "Veri yüklenemedi: " + err.message +
          " — Sayfayı bir web sunucusu üzerinden açtığınızdan emin olun.";
        console.error(err);
      });
  }

  function bitir() {
    var el = document.getElementById("load-bar");
    if (el) el.classList.add("done");
  }

  function setThemeIconOnly(theme) {
    var el = document.getElementById("theme-icon");
    if (el) el.innerHTML = G.themeIconSvg(theme);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
