/* Sunucu tarafi yetki testi. Gercek KV yerine bellek taklidi kullanilir.
   Calistirmak: node test/auth.test.js */

import http from "node:http";
import worker from "../src/index.js";

let fail = 0;
const chk = (n, c) => { console.log((c ? "  gecti " : "  KALDI ") + n); if (!c) fail++; };

/* --- sahte saglayici --- */
const sunucu = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    success: true,
    result: [{ muId: 1, plate: "21 ABC 123", latitude: 37.9, longitude: 40.2, speed: 50 }],
  }));
});
await new Promise((r) => sunucu.listen(0, r));
const port = sunucu.address().port;

/* --- sahte KV --- */
const kv = new Map();
const env = {
  MOBILIZ_TOKEN: "SAHTE",
  MOBILIZ_BASE_URL: `http://127.0.0.1:${port}`,
  TOKEN_HEADER: "Mobiliz-Token",
  ALLOWED_ORIGINS: "https://site.example",
  OTURUM_ANAHTARI: "test-imza-anahtari-cok-uzun-olmali-123456",
  KULLANICILAR: {
    async get(k, tur) {
      const v = kv.get(k);
      if (!v) return null;
      return tur === "json" ? JSON.parse(v) : v;
    },
    async put(k, v) { kv.set(k, v); },
  },
};

const store = new Map();
globalThis.caches = {
  default: {
    async match(req) { return store.get(req.url); },
    async put(req, res) { store.set(req.url, res); },
  },
};
const ctx = { waitUntil: (p) => p };

const istek = (yol, opt = {}) =>
  worker.fetch(new Request("https://w.example/" + yol, {
    method: opt.method || "GET",
    headers: { Origin: "https://site.example", ...(opt.headers || {}) },
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  }), env, ctx);

console.log("\n1) Jetonsuz arac verisi");
let r = await istek("last");
chk("401 dondu", r.status === 401);
let j = await r.json();
chk("veri sizmadi", !JSON.stringify(j).includes("21 ABC"));

console.log("\n2) Varsayilan yonetici girisi");
r = await istek("oturum/giris", { method: "POST", body: { eposta: "admin@gypenergy.com", sifre: "gyp2026" } });
chk("giris basarili", r.status === 200);
const giris = await r.json();
chk("jeton dondu", !!giris.jeton);
chk("yetkiler geldi", giris.kullanici && giris.kullanici.yetki.vehicle === true);
chk("sifre/ozet sizmadi", !JSON.stringify(giris).match(/ozet|tuz/i));
const yonetici = giris.jeton;

console.log("\n3) Hatali sifre");
r = await istek("oturum/giris", { method: "POST", body: { eposta: "admin@gypenergy.com", sifre: "yanlis" } });
chk("401 dondu", r.status === 401);
r = await istek("oturum/giris", { method: "POST", body: { eposta: "yok@x.com", sifre: "x" } });
chk("olmayan kullanici da 401", r.status === 401);

console.log("\n4) Jetonla arac verisi");
r = await istek("last", { headers: { Authorization: "Bearer " + yonetici } });
chk("200 dondu", r.status === 200);
j = await r.json();
chk("veri geldi", Array.isArray(j.data) && j.data.length === 1);

console.log("\n5) Kurcalanmis jeton");
const bozuk = yonetici.slice(0, -3) + "aaa";
r = await istek("last", { headers: { Authorization: "Bearer " + bozuk } });
chk("imza dogrulamasi tutuyor", r.status === 401);
const govde = yonetici.split(".")[0];
r = await istek("last", { headers: { Authorization: "Bearer " + govde + ".x" } });
chk("imzasiz jeton reddedildi", r.status === 401);

console.log("\n6) Yetkisiz kullanici olusturma");
r = await istek("yonetim/kullanici", {
  method: "POST", headers: { Authorization: "Bearer " + yonetici },
  body: { eposta: "saha@gypenergy.com", sifre: "1234", yetki: { workshop: true } },
});
chk("yonetici ekleyebildi", r.status === 200);

r = await istek("oturum/giris", { method: "POST", body: { eposta: "saha@gypenergy.com", sifre: "1234" } });
const saha = (await r.json()).jeton;
chk("yeni kullanici giris yapabildi", !!saha);

r = await istek("last", { headers: { Authorization: "Bearer " + saha } });
chk("arac yetkisi olmayan 403 aliyor", r.status === 403);
j = await r.json();
chk("veri sizmadi", !JSON.stringify(j).includes("21 ABC"));

console.log("\n7) Yonetim ucu yetki istiyor");
r = await istek("yonetim/kullanicilar", { headers: { Authorization: "Bearer " + saha } });
chk("yonetici olmayan 403", r.status === 403);
r = await istek("yonetim/kullanicilar", { headers: { Authorization: "Bearer " + yonetici } });
chk("yonetici listeyi gorebiliyor", r.status === 200);
j = await r.json();
chk("iki kullanici var", j.kullanicilar.length === 2);
chk("liste sifre icermiyor", !JSON.stringify(j).match(/ozet|tuz/i));

console.log("\n8) Silme kurallari");
r = await istek("yonetim/kullanici", {
  method: "DELETE", headers: { Authorization: "Bearer " + yonetici },
  body: { eposta: "admin@gypenergy.com" },
});
chk("kendi hesabini silemiyor", r.status === 400);
r = await istek("yonetim/kullanici", {
  method: "DELETE", headers: { Authorization: "Bearer " + yonetici },
  body: { eposta: "saha@gypenergy.com" },
});
chk("digerini silebiliyor", r.status === 200);

console.log("\n9) Silinen kullanici giris yapamaz");
r = await istek("oturum/giris", { method: "POST", body: { eposta: "saha@gypenergy.com", sifre: "1234" } });
chk("401 dondu", r.status === 401);

console.log("\n10) Sifreler KV'de duz metin degil");
const kayit = JSON.parse(kv.get("kullanicilar"));
chk("sifre saklanmiyor", !JSON.stringify(kayit).includes("gyp2026"));
chk("tuz + ozet var", kayit[0].tuz && kayit[0].ozet);

console.log("\n11) health jetonsuz calisiyor");
r = await istek("health");
chk("200 dondu", r.status === 200);

sunucu.close();
console.log(fail === 0 ? "\nTumu gecti.\n" : `\n${fail} test kaldi.\n`);
process.exit(fail === 0 ? 0 : 1);
