/* Worker'i sahte bir saglayiciya karsi calistirir.
   Gercek token/adres gerekmez. Calistirmak: node test/worker.test.js */

import http from "node:http";
import worker from "../src/index.js";

let fail = 0;
const check = (n, c) => { console.log((c ? "  gecti " : "  KALDI ") + n); if (!c) fail++; };

// --- sahte saglayici ---
let cagriSayisi = 0;
let esZamanli = 0;
let maxEsZamanli = 0;
let sonHeaderlar = null;

const sunucu = http.createServer(async (req, res) => {
  cagriSayisi++;
  esZamanli++;
  maxEsZamanli = Math.max(maxEsZamanli, esZamanli);
  sonHeaderlar = req.headers;
  await new Promise((r) => setTimeout(r, 40));
  esZamanli--;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    success: true,
    result: [{
      muId: 1, plate: "21 ABC 123", latitude: 37.9, longitude: 40.2, speed: 55,
      ignition: "A", dataTime: "2026-08-17T09:00:00+0300",
      driverFirstName: "Mehmet", driverLastName: "Yildiz",
      nationalIdentityNo: "12345678901", gsmNumbers: "0555",
    }],
  }));
});

await new Promise((r) => sunucu.listen(0, r));
const port = sunucu.address().port;

const env = {
  MOBILIZ_TOKEN: "SAHTE-TOKEN-TEST",
  MOBILIZ_BASE_URL: `http://127.0.0.1:${port}`,
  TOKEN_HEADER: "Mobiliz-Token",
  ALLOWED_ORIGINS: "https://site.example",
  OTURUM_ANAHTARI: "test-imza-anahtari-cok-uzun-123456",
  KULLANICILAR: {
    async get(k, tur) {
      const v = this._m?.get(k);
      if (!v) return null;
      return tur === "json" ? JSON.parse(v) : v;
    },
    async put(k, v) { (this._m ??= new Map()).set(k, v); },
    _m: new Map(),
  },
};

// Worker'in caches.default'u node'da yok; basit taklit
const store = new Map();
globalThis.caches = {
  default: {
    async match(req) { return store.get(req.url) || undefined; },
    async put(req, res) { store.set(req.url, res); },
  },
};
const ctx = { waitUntil: (p) => p };

let jeton = null;
async function jetonAl() {
  if (jeton) return jeton;
  const r = await worker.fetch(new Request("https://w.example/oturum/giris", {
    method: "POST", headers: { Origin: "https://site.example" },
    body: JSON.stringify({ eposta: "admin@gypenergy.com", sifre: "gyp2026" }),
  }), env, ctx);
  jeton = (await r.json()).jeton;
  return jeton;
}

const cagir = async (yol, origin = "https://site.example") =>
  worker.fetch(new Request("https://w.example/" + yol, {
    headers: { Origin: origin, Authorization: "Bearer " + (await jetonAl()) },
  }), env, ctx);

console.log("\n1) Saglikli cagri");
let r = await cagir("last");
let j = await r.json();
check("200 dondu", r.status === 200);
check("veri geldi", Array.isArray(j.data) && j.data.length === 1);
check("plaka var", j.data[0].plate === "21 ABC 123");
check("surucu adi yok", !("driverFirstName" in j.data[0]));
check("TC yok", !("nationalIdentityNo" in j.data[0]));
check("telefon yok", !("gsmNumbers" in j.data[0]));

console.log("\n2) Token saglayiciya gidiyor, cevaba girmiyor");
check("token header'i gonderildi",
  sonHeaderlar["mobiliz-token"] === "SAHTE-TOKEN-TEST");
const govde = JSON.stringify(j);
check("token cevapta gecmiyor", !govde.includes("SAHTE-TOKEN-TEST"));
check("adres cevapta gecmiyor", !govde.includes(String(port)));

console.log("\n3) Onbellek");
const oncekiCagri = cagriSayisi;
r = await cagir("last");
check("ikinci istek onbellekten", r.headers.get("X-Cache") === "HIT");
check("saglayici tekrar cagirilmadi", cagriSayisi === oncekiCagri);

console.log("\n4) Es zamanlilik (saglayici tek istek kabul ediyor)");
store.clear();
await Promise.all([cagir("vehicles"), cagir("vectors"), cagir("locations")]);
check("ust uste cagri yok (max=" + maxEsZamanli + ")", maxEsZamanli === 1);

console.log("\n5) Yasak uclar");
for (const yol of ["drivers", "users", "car-controls", "properties"]) {
  const rr = await cagir(yol);
  check(`${yol} -> 404`, rr.status === 404);
}

console.log("\n6) Yontem ve CORS");
const post = await worker.fetch(
  new Request("https://w.example/last", { method: "POST", headers: { Origin: "https://site.example" } }), env, ctx);
check("POST reddedildi", post.status === 405);
r = await cagir("health");
check("izinli origin kabul", r.headers.get("Access-Control-Allow-Origin") === "https://site.example");
r = await cagir("health", "https://kotu.example");
check("yabanci origin reddedildi", r.headers.get("Access-Control-Allow-Origin") === null);

console.log("\n7) Eksik ayar");
// jetonsuz istek: token/KV eksik olsa bile once yetki kontrolu calisir
const bos = await worker.fetch(
  new Request("https://w.example/last"), { ALLOWED_ORIGINS: "" }, ctx);
check("jetonsuz istek 401", bos.status === 401);
// jeton dogru ama saglayici ayari eksikse 500
const eksikEnv = { ...env, MOBILIZ_TOKEN: "" };
const bos2 = await worker.fetch(new Request("https://w.example/last", {
  headers: { Authorization: "Bearer " + (await jetonAl()) },
}), eksikEnv, ctx);
check("token yoksa 500", bos2.status === 500);

console.log("\n8) Parametre suzgeci");
store.clear();
await worker.fetch(new Request("https://w.example/last?muId=5&nationalIdentityNo=123&locale=tr"), env, ctx);
check("izinli parametre gecti", true);

sunucu.close();
console.log(fail === 0 ? "\nTumu gecti.\n" : `\n${fail} test kaldi.\n`);
process.exit(fail === 0 ? 0 : 1);
