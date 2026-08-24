/* ortak: ikon svgleri + kucuk yardimcilar */
(function (global) {
  "use strict";

  var GLYPHS = {
    rig:
      '<svg viewBox="0 0 24 20" width="20" height="17" aria-hidden="true">' +
      '<rect class="gl" x="2.4" y="16.6" width="19.2" height="1.9" rx="0.75"/>' +
      '<path class="gl" d="M8.4,16.6 L12.2,7.4 L16,16.6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>' +
      '<g class="pj">' +
      '<rect class="gl" x="2.6" y="6.5" width="19" height="1.9" rx="0.95"/>' +
      '<path class="gl" d="M3,7.45 L3,4.9 A2.5,2.5 0 0,0 0.9,8.4 L3,8.4 Z"/>' +
      '<circle class="gl" cx="19.6" cy="7.45" r="2.8"/>' +
      "</g></svg>",
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
      '<path class="gl" d="M1.6,18.4 L1.6,9.4 L7,6.2 L7,9.4 L12.4,6.2 L12.4,9.4 L17.8,6.2 L17.8,18.4 Z"/>' +
      '<rect class="gl" x="19.4" y="2.6" width="3" height="15.8" rx="1"/>' +
      '<rect class="void" x="4" y="11.6" width="2.6" height="2.4" rx="0.6"/>' +
      '<rect class="void" x="8.6" y="11.6" width="2.6" height="2.4" rx="0.6"/>' +
      '<rect class="void" x="13.2" y="11.6" width="2.6" height="2.4" rx="0.6"/>' +
      '<rect class="void" x="8.6" y="15.4" width="2.6" height="3" rx="0.5"/>' +
      "</svg>",
    production:
      '<svg viewBox="0 0 24 20" width="19" height="16" aria-hidden="true">' +
      '<rect class="gl" x="1.4" y="6.2" width="8.8" height="12.2" rx="1.5"/>' +
      '<rect class="gl" x="13" y="9" width="7.4" height="9.4" rx="1.4"/>' +
      '<rect class="void" x="3.4" y="8.6" width="4.8" height="1.5" rx="0.75"/>' +
      '<rect class="void" x="3.4" y="12" width="4.8" height="1.5" rx="0.75"/>' +
      '<rect class="void" x="14.8" y="11.4" width="3.8" height="1.4" rx="0.7"/>' +
      '<path class="gl" d="M10.2,15.4 L13,15.4" stroke="currentColor" stroke-width="1.5" fill="none"/>' +
      '<path class="gl" d="M5.8,6.2 L5.8,3.2 L16.7,3.2 L16.7,9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
      "</svg>",
    // ok yukari bakar; hareket halindeki arac icin yon acisiyla dondurulur
    vehicle:
      '<svg viewBox="0 0 24 20" width="18" height="15" aria-hidden="true">' +
      '<path class="gl" d="M12,2.2 L18.4,17.2 L12,13.6 L5.6,17.2 Z"/>' +
      "</svg>",
    // duran arac icin yonu belirsiz, dolu daire
    vehicleIdle:
      '<svg viewBox="0 0 24 20" width="18" height="15" aria-hidden="true">' +
      '<circle class="gl" cx="12" cy="10" r="5.4"/>' +
      '<circle class="void" cx="12" cy="10" r="2.1"/>' +
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
