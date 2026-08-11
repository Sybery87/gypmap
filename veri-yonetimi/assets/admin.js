/* veri duzenleme paneli - lokal calisir, canliya dokunmaz */
(function () {
  "use strict";

  var G = window.GYP;
  var data = null;
  var pickTarget = null;
  var pickMap = null;
  var pickMarker = null;
  var pickLatLng = null;

  /* ---------- yardimcilar ---------- */
  function empToText(list) {
    return (list || [])
      .map(function (e) { return e.role ? e.name + " - " + e.role : e.name; })
      .join("\n");
  }

  function textToEmp(text) {
    return String(text || "")
      .split("\n")
      .map(function (l) { return l.trim(); })
      .filter(Boolean)
      .map(function (line) {
        var i = line.indexOf(" - ");
        if (i === -1) return { name: line, role: "" };
        return { name: line.slice(0, i).trim(), role: line.slice(i + 3).trim() };
      });
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "kayit";
  }

  function saveDraft() {
    data.updatedAt = todayISO();
    try {
      localStorage.setItem(G.DRAFT_KEY, JSON.stringify(data));
      setState("Taslak kaydedildi · " + new Date().toLocaleTimeString("tr-TR"));
    } catch (e) {
      setState("Taslak kaydedilemedi (depolama dolu olabilir)");
    }
  }

  function setState(msg) {
    document.getElementById("save-state").textContent = msg;
  }

  /* ---------- render ---------- */
  function renderProduction() {
    var host = document.getElementById("prod-list");
    if (!host) return;
    if (!Array.isArray(data.productionSites)) data.productionSites = [];
    host.innerHTML = "";
    data.productionSites.forEach(function (s, idx) {
      var card = document.createElement("div");
      card.className = "card";
      card.innerHTML =
        '<div class="card-head">' +
          '<p class="card-title">' + G.escapeHtml(s.name || "(isimsiz)") + " · " + G.escapeHtml(s.city || "") + "</p>" +
          '<div style="display:flex;gap:8px">' +
            '<button class="rowbtn" data-act="pick">Haritadan seç</button>' +
            '<button class="rowbtn danger" data-act="del">Sil</button>' +
          "</div>" +
        "</div>" +
        '<div class="grid">' +
          field("Tesis adı", "name", s.name) +
          field("Şehir", "city", s.city) +
          field("Enlem (lat)", "lat", s.lat, "number") +
          field("Boylam (lon)", "lon", s.lon, "number") +
        "</div>" +
        '<div class="field" style="margin-top:12px">' +
          "<label>Adres (opsiyonel)</label>" +
          '<input data-k="address" value="' + G.escapeHtml(s.address || "") + '">' +
        "</div>";

      card.querySelectorAll("[data-k]").forEach(function (inp) {
        inp.addEventListener("change", function () {
          var k = inp.dataset.k;
          s[k] = (k === "lat" || k === "lon") ? parseFloat(inp.value) : inp.value;
          saveDraft();
          if (k === "name" || k === "city") renderProduction();
        });
      });
      card.querySelector('[data-act="pick"]').addEventListener("click", function () {
        openPicker(s, function () { renderProduction(); });
      });
      card.querySelector('[data-act="del"]').addEventListener("click", function () {
        if (!confirm(s.name + " silinsin mi?")) return;
        data.productionSites.splice(idx, 1);
        saveDraft();
        renderProduction();
      });
      host.appendChild(card);
    });
  }

  function render() {
    renderRigs();
    renderFacilities();
    renderProduction();
  }

  function renderRigs() {
    var host = document.getElementById("rig-list");
    host.innerHTML = "";
    data.rigs.forEach(function (rig, idx) {
      var card = document.createElement("div");
      card.className = "card";
      card.innerHTML =
        '<div class="card-head">' +
          '<p class="card-title">' + G.escapeHtml(rig.name || "(isimsiz)") + " · " + G.escapeHtml(rig.city || "") + "</p>" +
          '<div style="display:flex;gap:8px">' +
            '<button class="rowbtn" data-act="pick">Haritadan seç</button>' +
            '<button class="rowbtn" data-act="move">Taşındı olarak kaydet</button>' +
            '<button class="rowbtn danger" data-act="del">Sil</button>' +
          "</div>" +
        "</div>" +
        '<div class="grid">' +
          field("Kule adı", "name", rig.name) +
          field("Şehir / saha", "city", rig.city) +
          field("Kuyu / saha adı", "note", rig.note) +
          field("Enlem (lat)", "lat", rig.lat, "number") +
          field("Boylam (lon)", "lon", rig.lon, "number") +
          field("Bu tarihten beri", "since", rig.since, "date") +
        "</div>" +
        '<div class="field" style="margin-top:12px">' +
          "<label>Çalışanlar</label>" +
          '<textarea data-k="employees" placeholder="Mehmet Yıldız - Saha Şefi">' +
            G.escapeHtml(empToText(rig.employees)) +
          "</textarea>" +
          '<div class="hint">Her satıra bir kişi: <b>İsim - Görev</b></div>' +
        "</div>" +
        previousBlock(rig);

      card.querySelectorAll("[data-k]").forEach(function (inp) {
        inp.addEventListener("change", function () {
          var k = inp.dataset.k;
          if (k === "employees") rig.employees = textToEmp(inp.value);
          else if (k === "lat" || k === "lon") rig[k] = parseFloat(inp.value);
          else rig[k] = inp.value;
          saveDraft();
          if (k === "name" || k === "city") renderRigs();
        });
      });

      card.querySelector('[data-act="pick"]').addEventListener("click", function () {
        openPicker(rig, function () { renderRigs(); });
      });

      card.querySelector('[data-act="move"]').addEventListener("click", function () {
        rig.previous = {
          city: rig.city,
          lat: rig.lat,
          lon: rig.lon,
          until: rig.since || todayISO(),
          employees: JSON.parse(JSON.stringify(rig.employees || [])),
        };
        rig.since = todayISO();
        saveDraft();
        renderRigs();
        setState("Mevcut kayıt 'önceki' olarak arşivlendi — yeni şehir ve ekibi girin.");
      });

      card.querySelector('[data-act="del"]').addEventListener("click", function () {
        if (!confirm(rig.name + " silinsin mi?")) return;
        data.rigs.splice(idx, 1);
        saveDraft();
        renderRigs();
      });

      var clr = card.querySelector('[data-act="clear-prev"]');
      if (clr) {
        clr.addEventListener("click", function () {
          rig.previous = null;
          saveDraft();
          renderRigs();
        });
      }

      host.appendChild(card);
    });
  }

  function previousBlock(rig) {
    if (!rig.previous) {
      return '<div class="hint" style="margin-top:10px">Önceki kayıt yok. Kule taşındığında ' +
        "“Taşındı olarak kaydet”e basın — mevcut şehir ve ekip otomatik arşivlenir.</div>";
    }
    return (
      '<div style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--line);opacity:.85">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<p class="sec-label" style="margin:0">Önceki kayıt (haritada soluk gösterilir)</p>' +
      '<button class="rowbtn danger" data-act="clear-prev">Önceki kaydı temizle</button></div>' +
      '<div class="grid">' +
      '<div class="field"><label>Önceki şehir</label><input value="' + G.escapeHtml(rig.previous.city || "") + '" disabled></div>' +
      '<div class="field"><label>Şu tarihe kadar</label><input value="' + G.escapeHtml(rig.previous.until || "") + '" disabled></div>' +
      "</div>" +
      '<div class="field" style="margin-top:10px"><label>Önceki ekip</label>' +
      "<textarea disabled>" + G.escapeHtml(empToText(rig.previous.employees)) + "</textarea></div></div>"
    );
  }

  function renderFacilities() {
    var host = document.getElementById("fac-list");
    host.innerHTML = "";
    data.facilities.forEach(function (f, idx) {
      var card = document.createElement("div");
      card.className = "card";
      card.innerHTML =
        '<div class="card-head">' +
          '<p class="card-title">' + G.escapeHtml(f.name || "(isimsiz)") + "</p>" +
          '<div style="display:flex;gap:8px">' +
            '<button class="rowbtn" data-act="pick">Haritadan seç</button>' +
            '<button class="rowbtn danger" data-act="del">Sil</button>' +
          "</div>" +
        "</div>" +
        '<div class="grid">' +
          field("Tesis adı", "name", f.name) +
          '<div class="field"><label>Tür</label><select data-k="type">' +
            '<option value="office"' + (f.type === "office" ? " selected" : "") + ">Ofis / Merkez</option>" +
            '<option value="workshop"' + (f.type === "workshop" ? " selected" : "") + ">Atölye / Kamp</option>" +
          "</select></div>" +
          field("Şehir", "city", f.city) +
          field("Enlem (lat)", "lat", f.lat, "number") +
          field("Boylam (lon)", "lon", f.lon, "number") +
        "</div>" +
        '<div class="field" style="margin-top:12px">' +
          "<label>Adres (opsiyonel)</label>" +
          '<input data-k="address" value="' + G.escapeHtml(f.address || "") + '" ' +
          'placeholder="Söğütözü, Söğütözü Cd. No:23, 06510 Çankaya/Ankara">' +
          '<div class="hint">Girilirse tesis balonunda gösterilir.</div>' +
        "</div>";

      card.querySelectorAll("[data-k]").forEach(function (inp) {
        inp.addEventListener("change", function () {
          var k = inp.dataset.k;
          f[k] = k === "lat" || k === "lon" ? parseFloat(inp.value) : inp.value;
          saveDraft();
          if (k === "name") renderFacilities();
        });
      });

      card.querySelector('[data-act="pick"]').addEventListener("click", function () {
        openPicker(f, function () { renderFacilities(); });
      });
      card.querySelector('[data-act="del"]').addEventListener("click", function () {
        if (!confirm(f.name + " silinsin mi?")) return;
        data.facilities.splice(idx, 1);
        saveDraft();
        renderFacilities();
      });

      host.appendChild(card);
    });
  }

  function field(label, key, value, type) {
    return (
      '<div class="field"><label>' + label + "</label>" +
      '<input data-k="' + key + '" type="' + (type || "text") + '"' +
      (type === "number" ? ' step="0.0001"' : "") +
      ' value="' + G.escapeHtml(value == null ? "" : value) + '"></div>'
    );
  }

  /* ---------- konum secici ---------- */
  function openPicker(target, done) {
    pickTarget = target;
    pickTarget.__done = done;
    var modal = document.getElementById("pick-modal");
    modal.classList.add("open");

    if (!pickMap) {
      pickMap = L.map("pickmap", { minZoom: 5, maxZoom: 20 });
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 20, maxNativeZoom: 19, attribution: "Esri, Maxar, Earthstar Geographics" }
      ).addTo(pickMap);
      L.geoJSON(window.TURKEY_BORDER, {
        style: { color: "#4fa6f0", weight: 1.4, fill: false, interactive: false },
      }).addTo(pickMap);
      pickMap.on("click", function (e) {
        pickLatLng = e.latlng;
        if (pickMarker) pickMarker.setLatLng(e.latlng);
        else pickMarker = L.marker(e.latlng).addTo(pickMap);
        document.getElementById("pick-coords").textContent =
          "Seçilen: " + e.latlng.lat.toFixed(5) + ", " + e.latlng.lng.toFixed(5);
      });
    }

    setTimeout(function () {
      pickMap.invalidateSize();
      if (typeof target.lat === "number" && typeof target.lon === "number") {
        pickLatLng = L.latLng(target.lat, target.lon);
        if (pickMarker) pickMarker.setLatLng(pickLatLng);
        else pickMarker = L.marker(pickLatLng).addTo(pickMap);
        pickMap.setView(pickLatLng, 9);
        document.getElementById("pick-coords").textContent =
          "Mevcut: " + target.lat.toFixed(5) + ", " + target.lon.toFixed(5);
      } else {
        pickMap.fitBounds(L.geoJSON(window.TURKEY_BORDER).getBounds());
        document.getElementById("pick-coords").textContent = "Haritaya tıklayarak konum seçin";
      }
    }, 60);
  }

  function closePicker() {
    document.getElementById("pick-modal").classList.remove("open");
    pickTarget = null;
  }

  /* ---------- io ---------- */
  function download() {
    data.updatedAt = todayISO();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "data.json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    setState("data.json indirildi — sitedeki dosyayla değiştirin.");
  }

  function emptyData() {
    return { updatedAt: todayISO(), facilities: [], rigs: [], productionSites: [] };
  }

  function siteUrl() {
    try { return (localStorage.getItem("gyp-site-url") || "").trim(); } catch (e) { return ""; }
  }

  function loadLive(silent) {
    var base = siteUrl();
    var url = base ? base.replace(/\/+$/, "") + "/data.json" : G.DATA_URL;
    return fetch(url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (json) {
        if (!json || !Array.isArray(json.rigs)) throw new Error("Beklenen biçimde değil");
        data = json;
        saveDraft();
        render();
        setState(base ? "Canlı siteden veri çekildi." : "Yerel data.json yüklendi.");
      })
      .catch(function (e) {
        if (silent) {
          data = data || emptyData();
          render();
          setState('Veri okunamadı — "data.json yükle" ile dosyayı seçin.');
        } else {
          alert(
            "Veri çekilemedi: " + e.message +
            "\n\nSite adresini doğru yazdığınızdan emin olun. " +
            'Alternatif olarak "data.json yükle" ile dosyayı elle seçebilirsiniz.'
          );
        }
      });
  }

  /* ---------- başlat ---------- */
  function init() {
    G.applyTheme(G.readTheme());
    setThemeIcon(G.readTheme());

    document.getElementById("theme-btn").addEventListener("click", function () {
      var t = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      G.applyTheme(t);
      setThemeIcon(t);
    });

    document.getElementById("btn-download").addEventListener("click", download);

    var urlInput = document.getElementById("site-url");
    urlInput.value = siteUrl();
    urlInput.addEventListener("change", function () {
      try { localStorage.setItem("gyp-site-url", urlInput.value.trim()); } catch (e) {}
      setState("Site adresi kaydedildi.");
    });
    document.getElementById("btn-fetch-live").addEventListener("click", function () {
      try { localStorage.setItem("gyp-site-url", urlInput.value.trim()); } catch (e) {}
      if (!confirm("Canlı sitedeki veri çekilecek ve buradaki taslağın üzerine yazılacak. Devam edilsin mi?")) return;
      loadLive(false);
    });
    document.getElementById("btn-add-rig").addEventListener("click", function () {
      data.rigs.push({
        id: "rig-" + Date.now(), name: "#Rig-", city: "", lat: 39.0, lon: 35.0,
        since: todayISO(), employees: [], previous: null,
      });
      saveDraft();
      renderRigs();
      window.scrollTo(0, document.body.scrollHeight);
    });
    document.getElementById("btn-add-fac").addEventListener("click", function () {
      data.facilities.push({
        id: "fac-" + Date.now(), name: "Yeni Tesis", type: "office", city: "", lat: 39.0, lon: 35.0,
      });
      saveDraft();
      renderFacilities();
    });
    document.getElementById("btn-add-prod").addEventListener("click", function () {
      if (!Array.isArray(data.productionSites)) data.productionSites = [];
      data.productionSites.push({
        id: "prod-" + Date.now(), name: "Yeni Üretim Tesisi", city: "", lat: 39.0, lon: 35.0,
      });
      saveDraft();
      renderProduction();
    });
    document.getElementById("file-input").addEventListener("change", function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          data = JSON.parse(rd.result);
          saveDraft();
          render();
          setState("Dosya yüklendi.");
        } catch (err) {
          alert("Geçersiz JSON dosyası: " + err.message);
        }
      };
      rd.readAsText(f);
      e.target.value = "";
    });

    document.getElementById("pick-close").addEventListener("click", closePicker);
    document.getElementById("pick-apply").addEventListener("click", function () {
      if (pickTarget && pickLatLng) {
        pickTarget.lat = parseFloat(pickLatLng.lat.toFixed(5));
        pickTarget.lon = parseFloat(pickLatLng.lng.toFixed(5));
        var done = pickTarget.__done;
        delete pickTarget.__done;
        saveDraft();
        if (done) done();
      }
      closePicker();
    });

    var draft = null;
    try { draft = localStorage.getItem(G.DRAFT_KEY); } catch (e) {}
    if (draft) {
      try {
        data = JSON.parse(draft);
        render();
        setState("Taslak yüklendi.");
        return;
      } catch (e) { /* bozuksa devam */ }
    }
    loadLive(true);
  }

  function setThemeIcon(theme) {
    document.getElementById("theme-icon").innerHTML = G.themeIconSvg(theme);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
