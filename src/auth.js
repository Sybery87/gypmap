/* Sunucu tarafi yetkilendirme.
 *
 * Kullanicilar KV'de tutulur, sifreler PBKDF2 ile saklanir. Giris basarili
 * olursa HMAC ile imzalanmis bir jeton doner; arac uclari bu jetonu ve
 * "vehicle" yetkisini arar. Tarayicidaki kod degistirilse bile sunucu
 * dogrulamasi asilamaz - onceki surumdeki arayuz kisitindan farki bu.
 */

const KOD = new TextEncoder();
const TUR_LISTESI = ["rig", "office", "workshop", "production", "vehicle"];
const JETON_OMRU = 12 * 60 * 60;      // saniye
const PBKDF2_TUR = 120000;

/* ---------- yardimcilar ---------- */

function b64url(buf) {
  const bin = String.fromCharCode(...new Uint8Array(buf));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlCoz(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function rastgele(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}
/* zamanlama saldirisina karsi sabit sureli karsilastirma */
function esit(a, b) {
  if (a.length !== b.length) return false;
  let fark = 0;
  for (let i = 0; i < a.length; i++) fark |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return fark === 0;
}

/* ---------- sifre ---------- */

export async function sifreOzet(sifre, tuzB64) {
  const tuz = tuzB64 ? b64urlCoz(tuzB64) : rastgele(16);
  const anahtar = await crypto.subtle.importKey("raw", KOD.encode(sifre), "PBKDF2", false, ["deriveBits"]);
  const bit = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: tuz, iterations: PBKDF2_TUR, hash: "SHA-256" },
    anahtar, 256
  );
  return { tuz: b64url(tuz), ozet: b64url(bit) };
}

export async function sifreDogru(sifre, kayit) {
  if (!kayit || !kayit.tuz || !kayit.ozet) return false;
  const { ozet } = await sifreOzet(sifre, kayit.tuz);
  return esit(ozet, kayit.ozet);
}

/* ---------- jeton ---------- */

async function imzaAnahtari(gizli) {
  return crypto.subtle.importKey(
    "raw", KOD.encode(gizli), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

export async function jetonUret(kullanici, gizli) {
  const govde = {
    e: kullanici.eposta,
    y: kullanici.yetki,
    a: !!kullanici.yonetici,
    bit: Math.floor(Date.now() / 1000) + JETON_OMRU,
  };
  const veri = b64url(KOD.encode(JSON.stringify(govde)));
  const k = await imzaAnahtari(gizli);
  const imza = b64url(await crypto.subtle.sign("HMAC", k, KOD.encode(veri)));
  return veri + "." + imza;
}

export async function jetonCoz(jeton, gizli) {
  if (!jeton || jeton.indexOf(".") < 0) return null;
  const [veri, imza] = jeton.split(".");
  const k = await imzaAnahtari(gizli);
  const beklenen = b64url(await crypto.subtle.sign("HMAC", k, KOD.encode(veri)));
  if (!esit(imza, beklenen)) return null;
  let govde;
  try {
    govde = JSON.parse(new TextDecoder().decode(b64urlCoz(veri)));
  } catch (e) { return null; }
  if (!govde.bit || govde.bit < Math.floor(Date.now() / 1000)) return null;
  return { eposta: govde.e, yetki: govde.y || {}, yonetici: !!govde.a };
}

/* ---------- kullanici deposu (KV) ---------- */

const ANAHTAR = "kullanicilar";

function normalize(k) {
  const y = {};
  TUR_LISTESI.forEach((t) => { y[t] = !!(k.yetki && k.yetki[t]); });
  return {
    eposta: String(k.eposta || "").trim().toLowerCase(),
    tuz: k.tuz || "",
    ozet: k.ozet || "",
    yonetici: !!k.yonetici,
    yetki: y,
  };
}

export async function kullanicilariOku(env) {
  if (!env.KULLANICILAR) return null;              // KV bagli degil
  const ham = await env.KULLANICILAR.get(ANAHTAR, "json");
  if (ham && Array.isArray(ham) && ham.length) return ham.map(normalize);

  // Ilk calistirma: varsayilan yonetici olustur
  const { tuz, ozet } = await sifreOzet("gyp2026");
  const ilk = [normalize({
    eposta: "admin@gypenergy.com",
    tuz, ozet, yonetici: true,
    yetki: { rig: true, office: true, workshop: true, production: true, vehicle: true },
  })];
  await env.KULLANICILAR.put(ANAHTAR, JSON.stringify(ilk));
  return ilk;
}

export async function kullanicilariYaz(env, liste) {
  await env.KULLANICILAR.put(ANAHTAR, JSON.stringify(liste.map(normalize)));
}

/* Disariya sifre bilgisi sizmasin */
export function guvenliListe(liste) {
  return liste.map((k) => ({
    eposta: k.eposta, yonetici: k.yonetici, yetki: k.yetki,
  }));
}

export { TUR_LISTESI, normalize };
