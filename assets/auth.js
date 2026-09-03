/* Yetkili girisi ve yetki kontrolu — Worker uzerinden.
 *
 * Sifre dogrulamasi artik sunucuda (Cloudflare Worker + KV) yapiliyor.
 * Tarayici yalnizca e-posta/sifre gonderir, sunucudan imzali bir jeton alir.
 * Jeton olmadan arac verisi hic gelmez — bu, onceki (tamamen istemci tarafi)
 * surumden farkli olarak gercek bir koruma.
 *
 * Lokasyonlar (kule/ofis/kamp/kuyu) data.json ile birlikte statik sitede
 * durdugu icin herkese acik kalir; onlar icin sunucu kontrolu yoktur.
 */
(function () {
  "use strict";

  var OTURUM = "gyp-oturum-v2";
  var TURLER = ["rig", "office", "workshop", "production", "vehicle"];

  var aktif = null;     // { eposta, yetki, yonetici }
  var jeton = null;
  var hazirBekleyen = [];

  function servisUrl() {
    var base = (window.GYP_CONFIG && window.GYP_CONFIG.vehicleService) || "";
    return base.replace(/\/+$/, "");
  }

  function olay() {
    document.dispatchEvent(new CustomEvent("gyp-auth"));
  }

  function oturumuKaydet() {
    try {
      if (aktif && jeton) {
        sessionStorage.setItem(OTURUM, JSON.stringify({ jeton: jeton, kullanici: aktif }));
      } else {
        sessionStorage.removeItem(OTURUM);
      }
    } catch (e) {}
  }

  async function istek(yol, secenek) {
    var base = servisUrl();
    if (!base) return { ok: false, status: 0, mesaj: "Servis tanımlı değil" };
    secenek = secenek || {};
    var basliklar = { "Content-Type": "application/json" };
    if (jeton) basliklar.Authorization = "Bearer " + jeton;
    try {
      var r = await fetch(base + "/" + yol, {
        method: secenek.method || "GET",
        headers: basliklar,
        body: secenek.gov ? JSON.stringify(secenek.gov) : undefined,
        cache: "no-store",
      });
      var j = null;
      try { j = await r.json(); } catch (e) {}
      if (!r.ok) return { ok: false, status: r.status, mesaj: (j && j.error) || "İşlem başarısız" };
      return Object.assign({ ok: true, status: r.status }, j || {});
    } catch (e) {
      return { ok: false, status: 0, mesaj: "Sunucuya ulaşılamadı" };
    }
  }

  async function yukle() {
    var kayit = null;
    try { kayit = JSON.parse(sessionStorage.getItem(OTURUM) || "null"); } catch (e) {}
    if (kayit && kayit.jeton) {
      jeton = kayit.jeton;
      aktif = kayit.kullanici;
      // jeton hala gecerli mi kontrol et (suresi dolmus olabilir)
      var r = await istek("oturum/ben");
      if (!r.ok) { jeton = null; aktif = null; oturumuKaydet(); }
      else aktif = r.kullanici;
    }
    hazirBekleyen.forEach(function (f) { f(); });
    hazirBekleyen = [];
    olay();
  }

  async function girisYap(eposta, sifre) {
    var r = await istek("oturum/giris", { method: "POST", gov: { eposta: eposta, sifre: sifre } });
    if (!r.ok) return { ok: false, mesaj: r.mesaj || "E-posta veya şifre hatalı." };
    jeton = r.jeton;
    aktif = r.kullanici;
    oturumuKaydet();
    olay();
    return { ok: true };
  }

  function cikisYap() {
    aktif = null;
    jeton = null;
    oturumuKaydet();
    olay();
  }

  async function kullaniciListesi() {
    var r = await istek("yonetim/kullanicilar");
    return r.ok ? r.kullanicilar : [];
  }

  async function kullaniciEkle(eposta, sifre, yetki, yonetici) {
    var r = await istek("yonetim/kullanici", {
      method: "POST",
      gov: { eposta: eposta, sifre: sifre, yetki: yetki, yonetici: !!yonetici },
    });
    if (!r.ok) return { ok: false, mesaj: r.mesaj };
    return { ok: true, guncellendi: !!r.guncellendi };
  }

  async function kullaniciSil(eposta) {
    var r = await istek("yonetim/kullanici", { method: "DELETE", gov: { eposta: eposta } });
    return r.ok ? { ok: true } : { ok: false, mesaj: r.mesaj };
  }

  window.GYPAuth = {
    TURLER: TURLER,
    yukle: yukle,
    hazir: function (f) { hazirBekleyen.push(f); },
    girisYap: girisYap,
    cikisYap: cikisYap,
    kullaniciListesi: kullaniciListesi,
    kullaniciEkle: kullaniciEkle,
    kullaniciSil: kullaniciSil,
    jetonAl: function () { return jeton; },
    aktif: function () { return aktif; },
    girisliMi: function () { return !!aktif; },
    yoneticiMi: function () { return !!(aktif && aktif.yonetici); },
    yetkili: function (tur) { return !!(aktif && aktif.yetki && aktif.yetki[tur]); },
  };
})();
