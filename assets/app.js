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
  function iconSize() {
    var compact = G.isCompact();
    var z = map ? map.getZoom() : 6;
    if (z <= 6) return compact ? 15 : 19;
    if (z <= 8) return compact ? 18 : 24;
    return compact ? 21 : 28;
  }

  function makeIcon(kind, s, seed) {
    s = s || iconSize();
    var html = G.GLYPHS[kind];
    if (kind === "rig") {
      // her kule biraz farkli fazda hareket etsin
      var d = -((seed || 0) % 5) * 0.48;
      html = html.replace('class="pj"', 'class="pj" style="animation-delay:' + d + 's"');
    }
    return L.divIcon({
      className: "gyp-marker",
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
  }

  // popup acilinca renk degisir, cift tik yakinlastirir
  function wireMarker(mk, latlng, label) {
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
  function dirButton(lat, lon, label) {
    if (typeof lat !== "number" || typeof lon !== "number") return "";
    return (
      '<div class="pop-foot"><button type="button" class="dir-btn" ' +
      'data-lat="' + lat + '" data-lon="' + lon + '" data-label="' + G.escapeHtml(label) + '">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path d="M12 2.6l9.4 9.4-9.4 9.4L2.6 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<path d="M9.4 14.2v-2.4a2 2 0 012-2h3.4M13.4 7.8l2.4 2-2.4 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg> Yol Tarifi</button></div>"
    );
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
      wireMarker(mk, ll, f.name);
      markers.push({
        marker: mk, label: f.name, kind: "fx", kindIcon: f.type,
        cat: f.type, weight: 100, latlng: ll,
      });
    });

    (data.productionSites || []).forEach(function (s) {
      var ll = L.latLng(s.lat, s.lon);
      var mk = L.marker(ll, { icon: makeIcon("production"), riseOnHover: true })
        .addTo(markerLayer)
        .bindPopup(productionPopupHtml(s), { closeButton: true, autoPanPadding: [30, 30] })
        .bindTooltip(s.name, { permanent: true, direction: "right", offset: [17, 0], className: "gyp-label" });
      wireMarker(mk, ll, s.name);
      markers.push({
        marker: mk, label: s.name, kind: "rig", kindIcon: "production",
        cat: "production", weight: 20, latlng: ll,
      });
    });

    data.rigs.forEach(function (r, i) {
      var ll = L.latLng(r.lat, r.lon);
      var mk = L.marker(ll, { icon: makeIcon("rig", null, i), riseOnHover: true })
        .addTo(markerLayer)
        .bindPopup(rigPopupHtml(r), { closeButton: true, autoPanPadding: [30, 30] })
        .bindTooltip(r.name, { permanent: true, direction: "right", offset: [17, 0], className: "gyp-label" });
      wireMarker(mk, ll, r.name);
      markers.push({
        marker: mk, label: r.name, kind: "rig", kindIcon: "rig", cat: "rig", seed: i,
        weight: r.employees && r.employees.length ? 50 : 10,
        latlng: ll,
      });

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
    counts.all = markers.length;
    Object.keys(counts).forEach(function (k) {
      var el = document.getElementById("cnt-" + k);
      if (el) el.textContent = counts[k];
    });
    var people = data.rigs.reduce(function (s, r) {
      return s + (r.employees ? r.employees.length : 0);
    }, 0);
    document.getElementById("stat-people").textContent = people > 0 ? people : "—";
    document.getElementById("updated-at").textContent = G.formatDate(data.updatedAt) || "—";

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
  var REFRESH_MS = 120000;      // servis onbellegi 2 dk; daha sik sormanin anlami yok
  var STALE_MS = 30 * 60000;    // 30 dk once veri gonderen arac "eski" sayilir

  function vehicleServiceUrl() {
    var base = (window.GYP_CONFIG && window.GYP_CONFIG.vehicleService) || "";
    return base.replace(/\/+$/, "");
  }

  function heading(v) {
    var d = Number(v.speedDirection);
    return Number.isFinite(d) ? d : 0;
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
    var s = Math.round(iconSize() * 0.86);
    var glyph = moving ? G.GLYPHS.vehicle : G.GLYPHS.vehicleIdle;
    var rot = moving ? ' style="transform:rotate(' + heading(v) + 'deg)"' : "";
    return L.divIcon({
      className: "gyp-marker",
      html:
        '<div class="chip vehicle' + (stale ? " stale" : "") + (moving ? " moving" : "") + '">' +
        "<span" + rot + ">" + glyph + "</span></div>",
      iconSize: [s, s],
      iconAnchor: [s / 2, s / 2],
      popupAnchor: [0, -(s / 2 + 4)],
    });
  }

  function vehiclePopupHtml(v) {
    var age = ageMs(v);
    var stale = age > STALE_MS;
    var h =
      '<div class="pop-head"><p class="pop-title">' + G.escapeHtml(v.plate || "Araç") + "</p>" +
      '<div class="pop-city">' +
      G.escapeHtml([v.city, v.town].filter(Boolean).join(" / ") || "Konum bilgisi yok") +
      "</div></div>";
    h += '<div class="pop-body"><p class="sec-label">Durum</p><ul class="emp-list">';
    h += row("Hareket", isMoving(v) ? Math.round(v.speed) + " km/sa" : "Duruyor");
    if (v.ignition) h += row("Kontak", v.ignition === "A" ? "Açık" : "Kapalı");
    if (v.idleSpeed === "A") h += row("Rölanti", "Evet");
    if (v.vehicleLabel) h += row("Etiket", v.vehicleLabel);
    h += "</ul></div>";
    h +=
      '<div class="pop-since"' + (stale ? ' style="color:#c0392b"' : "") + ">" +
      (Number.isFinite(age) ? "Son veri: " + humanAge(age) : "Son veri zamanı bilinmiyor") +
      "</div>";
    return h + dirButton(v.latitude, v.longitude, v.plate || "Araç");
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

  function loadVehicles() {
    var base = vehicleServiceUrl();
    if (!base) {
      setVehicleStatus("Araç servisi tanımlı değil", "warn");
      return Promise.resolve();
    }
    if (vehicleLoading) return Promise.resolve();
    vehicleLoading = true;

    return fetch(base + "/last", { cache: "no-store" })
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
        setVehicleStatus("Araç verisi alınamadı (" + e.message + ")", "warn");
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
      var mk = vehicleMarkers[id];
      if (mk) {
        mk.setLatLng(ll);
        mk.setIcon(vehicleIcon(v));
        mk.setPopupContent(vehiclePopupHtml(v));
      } else {
        mk = L.marker(ll, { icon: vehicleIcon(v), riseOnHover: true, zIndexOffset: 400 })
          .bindPopup(vehiclePopupHtml(v), { closeButton: true, autoPanPadding: [30, 30] })
          .bindTooltip(id, { permanent: false, direction: "top", className: "gyp-label" });
        mk.addTo(vehicleLayer);
        vehicleMarkers[id] = mk;
      }
    });

    // artik gelmeyen araclari kaldir
    Object.keys(vehicleMarkers).forEach(function (id) {
      if (!seen[id]) {
        vehicleLayer.removeLayer(vehicleMarkers[id]);
        delete vehicleMarkers[id];
      }
    });

    var el = document.getElementById("cnt-vehicle");
    if (el) el.textContent = Object.keys(vehicleMarkers).length;
  }

  function startVehiclePolling() {
    stopVehiclePolling();
    loadVehicles();
    vehicleTimer = setInterval(function () {
      if (document.hidden) return;   // sekme arka plandayken sorgu atma
      loadVehicles();
    }, REFRESH_MS);
  }

  function stopVehiclePolling() {
    if (vehicleTimer) clearInterval(vehicleTimer);
    vehicleTimer = null;
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
    return CATEGORIES.every(function (c) { return active[c.key]; });
  }

  function buildFilters() {
    var host = document.getElementById("filters");
    var html =
      '<button type="button" class="filter all" data-key="all" aria-pressed="false">' +
      '<span class="filter-icon">' + ALL_SVG + "</span>" +
      '<span>Tümü</span><span class="filter-count" id="cnt-all">0</span></button>';

    html += CATEGORIES.map(function (c) {
      return (
        '<button type="button" class="filter" data-key="' + c.key + '" aria-pressed="false">' +
        '<span class="filter-icon">' + G.GLYPHS[c.glyph] + "</span>" +
        "<span>" + c.label + "</span>" +
        '<span class="filter-count" id="cnt-' + c.key + '">0</span>' +
        "</button>"
      );
    }).join("");
    host.innerHTML = html;

    host.addEventListener("click", function (e) {
      var b = e.target.closest(".filter");
      if (!b) return;
      var k = b.dataset.key;
      if (k === "all") {
        var turnOff = allOn();
        CATEGORIES.forEach(function (c) { active[c.key] = !turnOff; });
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
    });
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
    if (active.vehicle) {
      if (!vehicleLayer) vehicleLayer = L.layerGroup();
      if (!map.hasLayer(vehicleLayer)) vehicleLayer.addTo(map);
      if (!vehicleTimer) startVehiclePolling();
    } else {
      stopVehiclePolling();
      setVehicleStatus("");
      if (vehicleLayer && map.hasLayer(vehicleLayer)) map.removeLayer(vehicleLayer);
    }

    declutter();
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
    map.setMaxBounds(TURKEY_BOUNDS.pad(0.6));

    buildBaseLayers();
    switchBase(G.readTheme() === "dark" ? "night" : "day");
    buildMask();
    addControls();
    wireDirections();
    buildFilters();

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
      })
      .catch(function (err) {
        document.getElementById("load-error").style.display = "block";
        document.getElementById("load-error").textContent =
          "Veri yüklenemedi: " + err.message +
          " — Sayfayı bir web sunucusu üzerinden açtığınızdan emin olun.";
        console.error(err);
      });
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
