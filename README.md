# GYP Lokasyon Haritası

Sondaj kulesi, üretim kuyusu ve ofis/kamp lokasyonlarının uydu haritası üzerinde
gösterildiği statik site. Sunucu, veritabanı yok — tüm veri `data.json` içinde.

## Yapı

```
index.html               giris sayfasi
data.json                tum veri (kuleler, tesisler, uretim kuyulari)
_headers                 cache + CORS (duzenleme paneli data.json'i cekebilsin diye)
assets/app.js            harita
assets/shared.js         ikonlar, tarih/kacis yardimcilari
assets/style.css         stil
assets/turkey-border.js  ulke sinir poligonu (Natural Earth 10m, sadelestirilmis)
```

Düzenleme paneli (`admin.html`) bu repoda yok — bilerek. Yayına çıkarsa herkes
görür. Panel ayrı klasörde, lokalde çalışıyor.

## Yayına alma

Statik dosyalar, herhangi bir host çalışır. Şu an Cloudflare Pages / GitHub Pages.

`file://` ile açmayın — `data.json` fetch'i CORS'a takılır, harita boş gelir.
Lokal test:

```
python3 -m http.server 8000
```

## Veri

`data.json` üç liste tutuyor: `rigs`, `facilities`, `productionSites`.

```json
{
  "id": "rig-7",
  "name": "Rig#7",
  "city": "Adıyaman",
  "note": "Yapraklı-7",
  "lat": 37.82231,
  "lon": 38.81297,
  "since": "2026-08-01",
  "employees": [],
  "previous": null
}
```

- `facilities.type`: `office` | `workshop`
- `previous` doluysa harita üzerinde soluk/kesik çizgiyle eski konum gösterilir
- tarihler `YYYY-AA-GG`, koordinatlar ondalık derece

Kule taşındığında panelde "Taşındı olarak kaydet" — mevcut kayıt `previous`'a
düşer, yeni konum girilir.

## Notlar

- Gece katmanı NASA GIBS VIIRS (2012), z8'de bitiyor. z9'dan sonra Esri'ye geçip
  CSS filtreyle gece tonuna boyuyoruz.
- Esri bazı kırsal alanlarda "veri yok" karosunu HTTP 200 ile döndürüyor, bu yüzden
  `tileerror` işe yaramıyor. `tilemap` servisini sorgulayıp bölgesel zoom tavanını
  buluyoruz (bkz. `deepestZoom`).
- Sınır poligonu Boğaz'ı kara dışında bıraktığı için Sarıyer'deki ofis maskeleniyordu;
  poligonu ~2 km dışa buffer'ladım.
- Uydu görüntüsü kaynak yazısı (attribution) sağ altta kalmalı, servislerin şartı.

## Yapılacaklar

- [ ] Kule personel listeleri girilecek (şu an hepsi boş)
- [ ] Diyarbakır kamp koordinatı sahadan teyit edilecek
- [ ] N47-b4-1 aslında ruhsat sahası (14x7 km), nokta yerine poligon çizilebilir
