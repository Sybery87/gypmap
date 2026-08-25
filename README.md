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
assets/config.js         arac servisi adresi (gizli bilgi icermez)
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

## Araç takibi

"Araçlar" filtresi açıldığında konumlar ayrı bir servisten çekilir
(`arac-servisi` klasörü). Adres `assets/config.js` içinde; token orada değil,
servisin arkasında.

- Yalnızca filtre açıkken sorgulanır, kapalıyken kota harcanmaz
- 2 dakikada bir yenilenir, sekme arka plandayken durur
- 30 dakikadan eski veri gönderen araç soluk gösterilir
- Servis çalışmazsa harita normal çalışmaya devam eder, üstte uyarı çıkar
- Sürücü adı/kimlik bilgisi servisten geçmez, popup'ta yalnızca plaka + durum var

### Saha eşleştirme

Aracın en yakın kule/kuyu/tesise uzaklığı tarayıcıda hesaplanır (haversine).
1 km altı "sahasında", 6 km altı "yakınında", üstü "en yakın: X".

### Araç yönü

Ok yalnızca yön biliniyorsa çizilir:
1. Sağlayıcının `speedDirection` alanı (varsa 0 da geçerlidir, tam kuzey demektir)
2. Yoksa önceki konumdan hesaplanan kerteriz (~15 m altı GPS gürültüsü sayılır)
3. O da yoksa aracın bilinen son yönü

Hiçbiri yoksa ok yerine yönsüz simge gösterilir — kuzeye bakan yanıltıcı ok
çizmemek için. Araç hareketli olduğu mavi halkadan anlaşılır.

Sağlayıcı `speedDirection` göndermiyor. Bu yüzden "Araçlar" ilk açıldığında,
yönü bilinmeyen hareketli araçlar için son 30 dakikanın konumları çekilip yön
hesaplanıyor (`bootstrapHeadings`, en fazla 6 araç, sırayla). Hesaplanan yön
`localStorage`'a yazılıyor, böylece sonraki açılışlarda ok hemen doğru geliyor.

### İz görünümü

"Son 6 saat izi" açıldığında harita sadeleşir: diğer tüm işaretler ve durum
özeti gizlenir, yalnızca izi incelenen araç kalır. Kapatınca hepsi geri gelir
(`enterTrackMode` / `exitTrackMode`).

### Telefon

- Panel alttan yarım ekran açılır, harita üstte görünür kalır
- Panel/çizelge/rozetler harita konteynerinin içinde olduğu için Leaflet
  dokunma olaylarını yutuyordu; `L.DomEvent.disableScrollPropagation` ile
  kesildi — aksi halde liste kaydırılamıyor
- Arama kutusu 16px; daha küçük yazıda iOS otomatik yakınlaştırıyor
- Üst köşede katman seçici / liste butonu / rozetler çakışmasın diye
  liste butonu dar ekranda yalnızca simge gösterir
Eşikler `SAHADA_KM` / `YAKIN_KM` sabitlerinde. Sunucu gerekmez.

### Araç listesi

Sağdaki panel: plakaya göre arama, duruma göre sıralama (hareketliler üstte),
tıklayınca haritada o araca odaklanır. Yalnızca "Araçlar" filtresi açıkken görünür.

### Geçmiş iz

Araç balonundaki "Son 6 saat izi" `/locations` ucunu çağırır, rotayı çizer ve
altta bir zaman kaydırıcısı açar. Kaydırıcı aracın o andaki konumunu gösterir.

Sağlayıcı tarih formatı katı: `yyyy-MM-dd'T'HH:mm:ssZ`, `+` escape edilmeli.
`apiTime()` bunu üretir, `URLSearchParams` escape'i halleder.

### Katmanlama notu

Panel ve zaman çizelgesi `z-index: 1100` kullanıyor. Leaflet kontrolleri
800-1000 arasında; daha düşük değerde kalınca butonlar tıklanamıyordu.

`config.js` boş bırakılırsa filtre çalışır ama veri çekmez.

## Yapılacaklar

- [ ] Kule personel listeleri girilecek (şu an hepsi boş)
- [ ] Diyarbakır kamp koordinatı sahadan teyit edilecek
- [ ] N47-b4-1 aslında ruhsat sahası (14x7 km), nokta yerine poligon çizilebilir
- [ ] **Erişim kısıtlaması** — araç konumu çalışan konumu demek, site hâlâ herkese açık
- [ ] Kule/kuyu koordinatlarını sağlayıcıya alan olarak yükleme (yazma yetkisi gerekir,
      servis şu an salt okunur)
- [ ] Saha ziyaret raporu — yukarıdaki adım tamamlanınca
