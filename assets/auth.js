/* Yetkili girisi ve yetki kontrolu.
 *
 * ONEMLI: Site statik, arkasinda sunucu yok. Kontrol tarayicida yapiliyor,
 * yani bu sistem arayuz duzeyinde bir kisittir - gercek guvenlik degildir.
 * data.json zaten herkese acik. Gercek koruma gerekirse Worker'a tasinmali.
 *
 * Kullanicilar "kullanicilar.json" dosyasindan okunur. Yonetici panelden
 * ekleme/silme yapar, sonucu indirip siteye yukler.
 */
(function () {
  "use strict";

  var DOSYA = "kullanicilar.json";
  var YEREL = "gyp-kullanicilar";     // panelde yapilan, henuz yuklenmemis degisiklikler
  var OTURUM = "gyp-oturum";
  var TUZ = "gyp-2026-";              // hash'i sozluk saldirisina karsi biraz zorlastirir

  var TURLER = ["rig", "office", "workshop", "production", "vehicle"];

  var kullanicilar = [];
  var aktif = null;
  var hazirBekleyen = [];

  function olay() {
    document.dispatchEvent(new CustomEvent("gyp-auth"));
  }

  async function ozet(metin) {
    var veri = new TextEncoder().encode(TUZ + metin);
    var buf = await crypto.subtle.digest("SHA-256", veri);
    return Array.from(new Uint8Array(buf))
      .map(function (b) { return b.toString(16).padStart(2, "0"); })
      .join("");
  }

  function yereliOku() {
    try { return JSON.parse(localStorage.getItem(YEREL) || "null"); } catch (e) { return null; }
  }
  function yereliYaz(liste) {
    try { localStorage.setItem(YEREL, JSON.stringify(liste)); } catch (e) {}
  }

  function normalize(k) {
    var y = {};
    TURLER.forEach(function (t) { y[t] = !!(k.yetki && k.yetki[t]); });
    return {
      eposta: String(k.eposta || "").trim().toLowerCase(),
      hash: k.hash || "",
      yonetici: !!k.yonetici,
      yetki: y,
    };
  }

  async function yukle() {
    var yerel = yereliOku();
    if (yerel && Array.isArray(yerel)) {
      kullanicilar = yerel.map(normalize);
    } else {
      try {
        var r = await fetch(DOSYA, { cache: "no-store" });
        var j = r.ok ? await r.json() : null;
        kullanicilar = (j && Array.isArray(j.kullanicilar) ? j.kullanicilar : []).map(normalize);
      } catch (e) {
        kullanicilar = [];
      }
    }

    // Hic yonetici yoksa varsayilan bir hesap olustur ki sistem kilitlenmesin.
    if (!kullanicilar.some(function (k) { return k.yonetici; })) {
      kullanicilar.push(normalize({
        eposta: "admin@gypenergy.com",
        hash: await ozet("gyp2026"),
        yonetici: true,
        yetki: { rig: true, office: true, workshop: true, production: true, vehicle: true },
      }));
    }

    // onceki oturumu geri yukle
    try {
      var o = JSON.parse(sessionStorage.getItem(OTURUM) || "null");
      if (o && o.eposta) {
        var b = bul(o.eposta);
        if (b) aktif = b;
      }
    } catch (e) {}

    hazirBekleyen.forEach(function (f) { f(); });
    hazirBekleyen = [];
    olay();
  }

  function bul(eposta) {
    var e = String(eposta || "").trim().toLowerCase();
    return kullanicilar.filter(function (k) { return k.eposta === e; })[0] || null;
  }

  async function girisYap(eposta, sifre) {
    var k = bul(eposta);
    if (!k) return { ok: false, mesaj: "E-posta veya şifre hatalı." };
    var h = await ozet(sifre || "");
    if (h !== k.hash) return { ok: false, mesaj: "E-posta veya şifre hatalı." };
    aktif = k;
    try { sessionStorage.setItem(OTURUM, JSON.stringify({ eposta: k.eposta })); } catch (e) {}
    olay();
    return { ok: true };
  }

  function cikisYap() {
    aktif = null;
    try { sessionStorage.removeItem(OTURUM); } catch (e) {}
    olay();
  }

  async function kullaniciEkle(eposta, sifre, yetki, yonetici) {
    var e = String(eposta || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
      return { ok: false, mesaj: "Geçerli bir e-posta adresi girin." };
    }
    if (!sifre || sifre.length < 4) {
      return { ok: false, mesaj: "Şifre en az 4 karakter olmalı." };
    }
    var h = await ozet(sifre);
    var mevcut = bul(e);
    if (mevcut) {
      mevcut.hash = h;
      mevcut.yetki = normalize({ yetki: yetki }).yetki;
      mevcut.yonetici = !!yonetici;
    } else {
      kullanicilar.push(normalize({ eposta: e, hash: h, yetki: yetki, yonetici: yonetici }));
    }
    yereliYaz(kullanicilar);
    olay();
    return { ok: true, guncellendi: !!mevcut };
  }

  function kullaniciSil(eposta) {
    var e = String(eposta || "").trim().toLowerCase();
    if (aktif && aktif.eposta === e) {
      return { ok: false, mesaj: "Kendi hesabınızı silemezsiniz." };
    }
    var kalan = kullanicilar.filter(function (k) { return k.eposta !== e; });
    if (!kalan.some(function (k) { return k.yonetici; })) {
      return { ok: false, mesaj: "En az bir yönetici kalmalı." };
    }
    kullanicilar = kalan;
    yereliYaz(kullanicilar);
    olay();
    return { ok: true };
  }

  function disaAktar() {
    return JSON.stringify({
      not: "Yetkili listesi. Siteye yuklenince herkes icin gecerli olur.",
      guncelleme: new Date().toISOString().slice(0, 10),
      kullanicilar: kullanicilar,
    }, null, 2);
  }

  window.GYPAuth = {
    TURLER: TURLER,
    yukle: yukle,
    hazir: function (f) { hazirBekleyen.push(f); },
    girisYap: girisYap,
    cikisYap: cikisYap,
    kullaniciEkle: kullaniciEkle,
    kullaniciSil: kullaniciSil,
    disaAktar: disaAktar,
    liste: function () { return kullanicilar.slice(); },
    aktif: function () { return aktif; },
    girisliMi: function () { return !!aktif; },
    yoneticiMi: function () { return !!(aktif && aktif.yonetici); },
    yetkili: function (tur) { return !!(aktif && aktif.yetki && aktif.yetki[tur]); },
  };
})();
