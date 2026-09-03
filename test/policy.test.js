/* Sizinti testi: saglayicidan gelen kaydin icinde kisisel veri olsa bile
   disari cikmamali. Calistirmak icin: node test/policy.test.js */

import { ROUTES, filterResult, pick } from "../src/policy.js";

let fail = 0;
const check = (name, cond) => {
  console.log((cond ? "  gecti " : "  KALDI ") + name);
  if (!cond) fail++;
};

// Dokumandaki activity/last cevabina benzer, kisisel veri iceren ornek kayit
const ornek = {
  muId: 4412,
  plate: "21 ABC 123",
  vehicleLabel: "Saha Pickup",
  latitude: 37.9144,
  longitude: 40.2306,
  speed: 62,
  ignition: "A",
  dataTime: "2026-08-17T09:12:00+0300",
  city: "Diyarbakir",
  // asagidakilerin hicbiri disari cikmamali
  driverId: 91,
  driverFirstName: "Mehmet",
  driverLastName: "Yildiz",
  nationalIdentityNo: "12345678901",
  gsmNumbers: "05551112233",
  dallasCode: "A1B2C3D4",
  lastDriverEventId: 55,
  bluetoothSensorLastData: [{ sensorId: 1, sensorValue: "x" }],
};

const YASAK = [
  "driverId", "driverFirstName", "driverLastName", "nationalIdentityNo",
  "gsmNumbers", "dallasCode", "lastDriverEventId", "bluetoothSensorLastData",
];

console.log("\n1) Alan suzgeci");
const temiz = pick(ornek, ROUTES.last.fields);
for (const k of YASAK) check(`${k} disari cikmiyor`, !(k in temiz));
check("plaka geciyor", temiz.plate === "21 ABC 123");
check("konum geciyor", temiz.latitude === 37.9144 && temiz.longitude === 40.2306);
check("ic ice nesne dusuruluyor", !("bluetoothSensorLastData" in temiz));

console.log("\n2) Dizi halinde cevap");
const liste = filterResult([ornek, ornek], ROUTES.last.fields);
check("iki kayit dondu", liste.length === 2);
check(
  "hicbir kayitta yasak alan yok",
  liste.every((r) => YASAK.every((k) => !(k in r)))
);

console.log("\n3) Saglayici yeni alan eklerse");
const gelecek = { ...ornek, tcKimlikNo: "99999999999", surucuAdi: "Ali" };
const t2 = pick(gelecek, ROUTES.last.fields);
check("bilinmeyen alan otomatik dusuyor", !("tcKimlikNo" in t2) && !("surucuAdi" in t2));

console.log("\n4) Uc listesi");
check("drivers ucu tanimli degil", !("drivers" in ROUTES));
check("users ucu tanimli degil", !("users" in ROUTES));
check("car-controls ucu tanimli degil", !("car-controls" in ROUTES));
for (const [ad, r] of Object.entries(ROUTES)) {
  check(`${ad}: alan listesi bos degil`, Array.isArray(r.fields) && r.fields.length > 0);
  const kisisel = r.fields.filter((f) =>
    /driver|national|gsm|phone|dallas|firstName|lastName|email|password/i.test(f)
  );
  check(`${ad}: alan listesinde kisisel veri yok`, kisisel.length === 0);
}

console.log("\n5) Parametre suzgeci");
const izinli = ROUTES.last.params;
check("keyfi parametre listede yok", !izinli.includes("locale") && !izinli.includes("driverId"));

console.log(fail === 0 ? "\nTumu gecti.\n" : `\n${fail} test kaldi.\n`);
process.exit(fail === 0 ? 0 : 1);
