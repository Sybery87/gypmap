/* Mobiliz araç takip verisi icin ara katman.
 *
 * Token ve servis adresi Cloudflare "secret" olarak tutulur; koda yazilmaz,
 * tarayiciya inmez. Istemci yalnizca sadelestirilmis, kisisel veri icermeyen
 * bir cevap gorur.
 *
 * Gerekli degiskenler (wrangler secret put ... ile girilir):
 *   MOBILIZ_TOKEN     saglayicidan alinan token
 *   MOBILIZ_BASE_URL  ornek: https://ng.mobiliz.com.tr/su5/api/integrations
 *   TOKEN_HEADER      "Mobiliz-Token" veya "MobilizToken" (dokumanda ikisi de geciyor)
 *   ALLOWED_ORIGINS   virgulle ayrilmis site adresleri

 *   OTURUM_ANAHTARI   jeton imzalama gizli anahtari (uzun, rastgele)
 *
 * Ayrica KULLANICILAR adinda bir KV baglantisi gerekir (bkz. README).
 */

import { ROUTES, filterResult } from "./policy.js";
import {
  sifreOzet, sifreDogru, jetonUret, jetonCoz,
  kullanicilariOku, kullanicilariYaz, guvenliListe, normalize,
} from "./auth.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const key = url.pathname.replace(/^\/+|\/+$/g, "");

    // ---- oturum ve yonetim uclari ----
    if (key.startsWith("oturum") || key.startsWith("yonetim")) {
      return oturumUclari(key, request, env, cors);
    }

    if (request.method !== "GET") return fail(405, "Yalnizca GET destekleniyor", cors);

    if (key === "" || key === "health") {
      return ok({ ok: true, routes: Object.keys(ROUTES) }, cors, 60);
    }

    const route = ROUTES[key];
    if (!route) return fail(404, "Bilinmeyen uc", cors);

    // ---- arac verisi yetki ister (sunucu tarafinda dogrulanir) ----
    const kimlik = await kimlikAl(request, env);
    if (!kimlik) return fail(401, "Yetkili girisi gerekli", cors);
    if (!kimlik.yetki || !kimlik.yetki.vehicle) {
      return fail(403, "Bu veriye erisim yetkiniz yok", cors);
    }

    for (const need of ["MOBILIZ_TOKEN", "MOBILIZ_BASE_URL", "TOKEN_HEADER"]) {
      if (!env[need]) return fail(500, `Sunucu ayari eksik: ${need}`, cors);
    }

    // istemciden gelen parametrelerden yalnizca izin verilenleri aktar
    const qs = new URLSearchParams();
    for (const p of route.params) {
      const v = url.searchParams.get(p);
      if (v !== null && v !== "") qs.set(p, v);
    }

    const cacheKey = new Request(`https://cache.local/${key}?${qs.toString()}`, { method: "GET" });
    const cache = caches.default;

    const hit = await cache.match(cacheKey);
    if (hit) {
      const r = new Response(hit.body, hit);
      r.headers.set("X-Cache", "HIT");
      applyCors(r.headers, cors);
      return r;
    }

    let upstream;
    try {
      upstream = await callUpstream(route, qs, env);
    } catch (e) {
      return fail(502, "Saglayiciya ulasilamadi: " + e.message, cors);
    }

    if (!upstream.ok) {
      // saglayici govdesini oldugu gibi yansitmayiz; icinde veri olabilir
      return fail(upstream.status === 429 ? 429 : 502, upstream.reason || "Saglayici hatasi", cors);
    }

    const clean = filterResult(upstream.result, route.fields);
    const body = {
      ok: true,
      count: Array.isArray(clean) ? clean.length : clean ? 1 : 0,
      fetchedAt: new Date().toISOString(),
      data: clean,
    };

    const res = ok(body, cors, route.ttl);
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    res.headers.set("X-Cache", "MISS");
    return res;
  },
};


/* ---------- oturum / yonetim ---------- */

async function kimlikAl(request, env) {
  const bas = request.headers.get("Authorization") || "";
  const m = bas.match(/^Bearer\s+(.+)$/i);
  if (!m || !env.OTURUM_ANAHTARI) return null;
  return jetonCoz(m[1], env.OTURUM_ANAHTARI);
}

async function govdeOku(request) {
  try { return await request.json(); } catch (e) { return {}; }
}

async function oturumUclari(key, request, env, cors) {
  if (!env.OTURUM_ANAHTARI) {
    return fail(500, "Sunucu ayari eksik: OTURUM_ANAHTARI", cors);
  }
  const liste = await kullanicilariOku(env);
  if (liste === null) {
    return fail(500, "KULLANICILAR deposu bagli degil", cors);
  }

  // giris
  if (key === "oturum/giris" && request.method === "POST") {
    const g = await govdeOku(request);
    const eposta = String(g.eposta || "").trim().toLowerCase();
    const k = liste.find((x) => x.eposta === eposta);
    // kullanici yoksa da ayni sureyi harcayalim ki fark anlasilmasin
    const dogru = k ? await sifreDogru(g.sifre || "", k) : await sifreDogru("x", { tuz: "AAAA", ozet: "AAAA" });
    if (!k || !dogru) return fail(401, "E-posta veya sifre hatali", cors);
    const jeton = await jetonUret(k, env.OTURUM_ANAHTARI);
    return ok({
      ok: true, jeton,
      kullanici: { eposta: k.eposta, yetki: k.yetki, yonetici: k.yonetici },
    }, cors, 0);
  }

  // jeton dogrulama (sayfa yenilenince)
  if (key === "oturum/ben" && request.method === "GET") {
    const kim = await kimlikAl(request, env);
    if (!kim) return fail(401, "Oturum gecersiz", cors);
    return ok({ ok: true, kullanici: kim }, cors, 0);
  }

  // ---- yonetim: yalnizca yonetici ----
  const kim = await kimlikAl(request, env);
  if (!kim || !kim.yonetici) return fail(403, "Yonetici yetkisi gerekli", cors);

  if (key === "yonetim/kullanicilar" && request.method === "GET") {
    return ok({ ok: true, kullanicilar: guvenliListe(liste) }, cors, 0);
  }

  if (key === "yonetim/kullanici" && request.method === "POST") {
    const g = await govdeOku(request);
    const eposta = String(g.eposta || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(eposta)) {
      return fail(400, "Gecerli bir e-posta girin", cors);
    }
    if (!g.sifre || String(g.sifre).length < 4) {
      return fail(400, "Sifre en az 4 karakter olmali", cors);
    }
    const { tuz, ozet } = await sifreOzet(String(g.sifre));
    const yeni = normalize({
      eposta, tuz, ozet, yonetici: !!g.yonetici, yetki: g.yetki || {},
    });
    const idx = liste.findIndex((x) => x.eposta === eposta);
    if (idx >= 0) liste[idx] = yeni; else liste.push(yeni);
    await kullanicilariYaz(env, liste);
    return ok({ ok: true, guncellendi: idx >= 0 }, cors, 0);
  }

  if (key === "yonetim/kullanici" && request.method === "DELETE") {
    const g = await govdeOku(request);
    const eposta = String(g.eposta || "").trim().toLowerCase();
    if (eposta === kim.eposta) return fail(400, "Kendi hesabinizi silemezsiniz", cors);
    const kalan = liste.filter((x) => x.eposta !== eposta);
    if (!kalan.some((x) => x.yonetici)) return fail(400, "En az bir yonetici kalmali", cors);
    await kullanicilariYaz(env, kalan);
    return ok({ ok: true }, cors, 0);
  }

  return fail(404, "Bilinmeyen uc", cors);
}

/* Saglayici ayni anda tek istek kabul ediyor. Isolate icinde sirali kuyruk
   tutuyoruz; onbellek sayesinde ust uste cagri zaten seyrek.
   Kuyruk uzarsa yeni istek beklemek yerine hemen reddedilir: aksi halde
   yavas bir cagri, haritanin ihtiyac duydugu /last istegini aclikta birakiyor. */
var chain = Promise.resolve();
var queued = 0;
var MAX_QUEUE = 2;

function serialize(fn) {
  if (queued >= MAX_QUEUE) {
    return Promise.resolve({ ok: false, status: 503, reason: "Servis mesgul, tekrar deneyin" });
  }
  queued++;
  const run = chain.then(fn, fn).finally(() => { queued--; });
  chain = run.then(() => {}, () => {});
  return run;
}

async function callUpstream(route, qs, env) {
  return serialize(async () => {
    const base = env.MOBILIZ_BASE_URL.replace(/\/+$/, "");
    const target = base + route.path + (qs.toString() ? "?" + qs.toString() : "");

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);

    let r;
    try {
      r = await fetch(target, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          [env.TOKEN_HEADER]: env.MOBILIZ_TOKEN,
        },
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!r.ok) return { ok: false, status: r.status, reason: `HTTP ${r.status}` };

    let j;
    try {
      j = await r.json();
    } catch {
      return { ok: false, status: 502, reason: "Cevap JSON degil" };
    }

    if (j && j.success === false) {
      return { ok: false, status: 400, reason: "Saglayici istegi reddetti" };
    }
    return { ok: true, result: j?.result ?? j };
  });
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const h = {
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowed.length === 0 || allowed.includes(origin)) {
    h["Access-Control-Allow-Origin"] = allowed.length === 0 ? "*" : origin;
  }
  return h;
}

function applyCors(headers, cors) {
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
}

function ok(body, cors, ttl) {
  const h = { ...JSON_HEADERS, ...cors, "Cache-Control": `public, max-age=${ttl || 60}` };
  return new Response(JSON.stringify(body), { status: 200, headers: h });
}

function fail(status, message, cors) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...JSON_HEADERS, ...cors, "Cache-Control": "no-store" },
  });
}
