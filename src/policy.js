/* Hangi ucun cagirilabilecegi ve hangi alanlarin disari cikabilecegi.
   Beyaz liste mantigi: listede olmayan hicbir sey gecmez.
   "sunu sil" demiyoruz cunku saglayici yeni alan eklerse sizar. */

// Disari cikmasina izin verilen alanlar. Kisisel veri (ad, soyad, TC, telefon,
// dallasCode, driverId...) bilerek yok. Eklemeden once dusunun.
export const FIELDS = {
  vehicles: ["muId", "plate", "vehicleLabel", "fleetId", "fleetName", "groupId", "groupName"],

  last: [
    "muId",
    "plate",
    "vehicleLabel",
    "latitude",
    "longitude",
    "speed",
    "speedDirection",
    "ignition",
    "engine",
    "idleSpeed",
    "dataTime",
    "gpsTime",
    "city",
    "town",
  ],

  locations: ["muId", "plate", "latitude", "longitude", "time", "eventLogId"],

  vectors: ["vectorId", "name", "description", "latitude", "longitude", "vectorType"],

  vectorActivity: [
    "muId",
    "plate",
    "vectorId",
    "vectorName",
    "inTime",
    "outTime",
    "inDistance",
    "outDistance",
  ],
};

/* Cagirilabilecek uclar. Sadece okuma.
   car-controls, users, drivers gibi uclar bilerek listede yok:
   arac kumandasi, kullanici silme ve kimlik bilgisi bu servisten gecmez. */
export const ROUTES = {
  "vehicles": {
    path: "/vehicles",
    fields: FIELDS.vehicles,
    params: ["fleetId", "groupId", "plate"],
    ttl: 3600,
  },
  "last": {
    path: "/activity/last",
    fields: FIELDS.last,
    params: ["fleetId", "groupId", "muId", "startTime"],
    // yon istemcide iki olcum arasindaki hareketten hesaplaniyor;
    // onbellek uzun olursa konum degismiyor ve yon bulunamiyor
    ttl: 10,
  },
  "locations": {
    path: "/locations",
    fields: FIELDS.locations,
    params: ["fleetId", "groupId", "muId", "plate", "startTime", "endTime", "eventLogId"],
    ttl: 300,
  },
  "vectors": {
    path: "/vectors",
    fields: FIELDS.vectors,
    params: [],
    ttl: 3600,
  },
  "vector-activity": {
    path: "/vector/activity",
    fields: FIELDS.vectorActivity,
    params: ["fleetId", "groupId", "muId", "type", "startTime", "endTime", "filterStop"],
    ttl: 300,
  },
};

/* Kaydi beyaz listeye gore suzer. Ic ice nesne/dizi tasimayiz;
   sadece duz deger gecer, boylece beklenmedik yapi sizamaz. */
export function pick(row, fields) {
  const out = {};
  for (const f of fields) {
    const v = row?.[f];
    if (v === undefined || v === null) continue;
    if (typeof v === "object") continue;
    out[f] = v;
  }
  return out;
}

export function filterResult(result, fields) {
  if (Array.isArray(result)) return result.map((r) => pick(r, fields));
  if (result && typeof result === "object") return pick(result, fields);
  return null;
}
