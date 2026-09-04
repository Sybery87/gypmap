/* ortak: ikon svgleri + kucuk yardimcilar */
(function (global) {
  "use strict";

  var GLYPHS = {
    // sondaj kulesi (derrick): katmanli kafes, tepede tac blok, ortada
    // dikey mil, kafes icinde yukari-asagi hareket eden bir blok ("tb")
    rig:
      '<svg viewBox="0 0 24 20" width="20" height="17" aria-hidden="true">' +
      '<rect class="gl" x="2" y="17.3" width="20" height="1.7" rx="0.7"/>' +
      '<path class="gl" d="M10.4,2.4 L4.1,17.3 M13.6,2.4 L19.9,17.3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>' +
      '<rect class="gl" x="9.7" y="1.3" width="4.6" height="1.7" rx="0.7"/>' +
      '<path class="gl" d="M10.5,3 L15.6,7.7 M13.5,3 L8.4,7.7 M8.4,7.7 L17.7,12.3 M15.6,7.7 L6.3,12.3 M6.3,12.3 L20,17.3 M17.7,12.3 L4,17.3" stroke="currentColor" stroke-width="0.9" fill="none" stroke-linecap="round"/>' +
      '<path class="gl" d="M8.4,7.7 L15.6,7.7 M6.3,12.3 L17.7,12.3" stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round"/>' +
      '<path class="gl" d="M12,2.6 L12,17.3" stroke="currentColor" stroke-width="0.8" fill="none" opacity="0.6"/>' +
      '<g class="tb"><rect class="gl" x="10.6" y="5.5" width="2.8" height="2.2" rx="0.6"/></g>' +
      "</svg>",
    office:
      '<svg viewBox="0 0 24 20" width="19" height="16" aria-hidden="true">' +
      '<rect class="gl" x="2.4" y="7" width="7.4" height="11.4" rx="1.3"/>' +
      '<rect class="gl" x="11.2" y="1.6" width="10.4" height="16.8" rx="1.5"/>' +
      '<rect class="void" x="4.3" y="9.2" width="3.6" height="1.5" rx="0.75"/>' +
      '<rect class="void" x="4.3" y="12.4" width="3.6" height="1.5" rx="0.75"/>' +
      '<rect class="void" x="13.3" y="4.3" width="6.2" height="1.5" rx="0.75"/>' +
      '<rect class="void" x="13.3" y="7.5" width="6.2" height="1.5" rx="0.75"/>' +
      '<rect class="void" x="13.3" y="10.7" width="6.2" height="1.5" rx="0.75"/>' +
      '<rect class="void" x="15.2" y="14.2" width="2.4" height="4.2" rx="1.2"/>' +
      "</svg>",
    workshop:
      '<svg viewBox="0 0 24 20" width="19" height="16" aria-hidden="true">' +
      '<path class="gl" d="M1.6,17.4 L1.6,8.4 L7,5.2 L7,8.4 L12.4,5.2 L12.4,8.4 L17.8,5.2 L17.8,17.4 Z"/>' +
      '<rect class="gl" x="19.4" y="2.6" width="3" height="14.8" rx="1"/>' +
      '<rect class="void" x="4" y="10.6" width="2.6" height="2.4" rx="0.6"/>' +
      '<rect class="void" x="8.6" y="10.6" width="2.6" height="2.4" rx="0.6"/>' +
      '<rect class="void" x="13.2" y="10.6" width="2.6" height="2.4" rx="0.6"/>' +
      '<rect class="void" x="8.6" y="14.4" width="2.6" height="3" rx="0.5"/>' +
      "</svg>",
    // uretim kuyusu: atbasi (pumpjack) — kirisi "pj" sinifinda sallanir
    production:
      '<svg viewBox="0 0 24 20" width="19" height="16" aria-hidden="true">' +
      '<rect class="gl" x="2.9" y="15.05" width="19.2" height="1.9" rx="0.75"/>' +
      '<path class="gl" d="M8.9,15.05 L12.7,5.85 L16.5,15.05" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>' +
      '<g class="pj">' +
      '<rect class="gl" x="3.1" y="4.95" width="19" height="1.9" rx="0.95"/>' +
      '<path class="gl" d="M3.5,5.9 L3.5,3.35 A2.5,2.5 0 0,0 1.4,6.85 L3.5,6.85 Z"/>' +
      '<circle class="gl" cx="20.1" cy="5.9" r="2.8"/>' +
      "</g></svg>",
    // hareket halinde + yon biliniyor: ok (yon acisiyla dondurulur)
    vehicle:
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
      '<path class="gl" d="M12,3.4 L19,20.6 L12,16.6 L5,20.6 Z"/>' +
      "</svg>",
    // duruyor: kare — ok ile "git / dur" ikilisi olusturur
    vehicleIdle:
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
      '<rect class="gl" x="6.6" y="6.6" width="10.8" height="10.8" rx="2.4"/>' +
      "</svg>",
    // hareket halinde ama yon bilinmiyor: yonsuz daire
    vehicleUnknown:
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
      '<circle class="gl" cx="12" cy="12" r="6.2"/>' +
      '<circle class="void" cx="12" cy="12" r="2.4"/>' +
      "</svg>",
  };

  // tr ay kisaltmalari
  var MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

  function formatDate(iso) {
    if (!iso) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    return parseInt(m[3], 10) + " " + MONTHS[parseInt(m[2], 10) - 1] + " " + m[1];
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("gyp-theme", theme); } catch (e) {}
  }

  function readTheme() {
    try { return localStorage.getItem("gyp-theme") || "dark"; } catch (e) { return "dark"; }
  }

  var THEME_ICONS = {
    sun:
      '<circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M12 2.4v2.3M12 19.3v2.3M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.4 12h2.3M19.3 12h2.3M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" ' +
      'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    moon:
      '<path d="M20.8 13.4A8.6 8.6 0 1110.6 3.2a6.8 6.8 0 0010.2 10.2z" ' +
      'fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  };

  function themeIconSvg(theme) {
    return theme === "dark" ? THEME_ICONS.sun : THEME_ICONS.moon;
  }

  function isCompact() {
    return window.matchMedia("(max-width: 760px)").matches;
  }

  global.GYP = {
    GLYPHS: GLYPHS,
    formatDate: formatDate,
    escapeHtml: escapeHtml,
    applyTheme: applyTheme,
    readTheme: readTheme,
    themeIconSvg: themeIconSvg,
    isCompact: isCompact,
    DATA_URL: "data.json",
    DRAFT_KEY: "gyp-saha-draft",
  };
})(window);
