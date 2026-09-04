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

### Araç simgeleri

Üç durum, üç ayrı biçim:

| Durum | Simge |
|---|---|
| Hareketli, yön biliniyor | ok (yön açısıyla döner) |
| Hareketli, yön bilinmiyor | yönsüz daire |
| Duruyor | kare |

Ok/kare ikilisi "git / dur" okumasını veriyor; küçük boyutta siluetleri
birbirine karışmıyor.

### Balon yüksekliği

Balon uzun olunca Leaflet haritayı kaydırıp işaretçiyi ekran dışına itiyordu.
Araç balonundaki durum listesi tek satır etiketlere indirildi, "Son 6 saat izi"
ve "Yol Tarifi" yan yana alındı; gövde yüksekliği `vh` ile sınırlandı.
Araç balonu 405 px → 233 px.

### Simge hizasi

Ikon boyutlari daima **cift sayi**: tek sayida yerlesim payi (boyut/2) yarim
piksele dusuyor ve ikon kayik goruniyordu. Arac ikonlari ayrica zoom degisince
tazelenmiyordu, ilk boyutta kaliyorlardi (`refreshIconSizes` icine eklendi).

Simgelerin viewBox icindeki merkezleri olculup duzeltildi (atbasi, atolye ve
uretim kuyusu kayikti). Yedisi de artik cizim sinirlarina gore tam ortali.

### Yon nasil bulunuyor

Saglayicinin `speedDirection` alani KULLANILMIYOR. Sifir geliyor ya da derece
yerine kucuk sektor kodu gibi davraniyor (1, 4, 8, 12 gibi); bu degerler
dogrudan aciya cevrilince tum oklar kuzeye yakin cikiyordu.

Yon **yalnizca aracin iki olcum arasinda gittigi yoldan** hesaplaniyor. Bunun
icin iki farkli konum gerekiyor, bu yuzden zamanlamalar kisa tutuldu:

- istemci 30 sn'de bir sorguluyor (`REFRESH_MS`)
- acilistan 12 sn sonra ek bir sorgu daha atiliyor
- servis onbellegi `/last` icin 10 sn (`policy.js`, `ttl`)

Sonuc: ok yaklasik 15 sn icinde cikiyor. Hesaplanan yon tarayiciya yazildigi
icin sonraki ziyaretlerde aninda geliyor.

Yon bilinmiyorsa ok yerine yonsuz daire gosterilir; kuzeye bakan yaniltici ok
cizilmiyor.

### Gecici hatalarda otomatik tekrar deneme

`loadVehicles` bir istekte HTTP 502/503/504 veya ag hatasi alirsa, kullaniciya
hemen hata gostermeden artan gecikmelerle (1.2sn, 2.4sn) iki kez daha sessizce
dener. 401/403 (yetki) hatalarinda tekrar denenmez. Sunucu tarafinda da ayni
mantik var (`arac-servisi/src/index.js`, `callUpstream`) - ikisi birlikte
calisir. Tum denemeler basarisiz olursa (~5 saniye sonra) "Araç verisi
alınamadı" mesaji gorunur hale gelir.


### Yon deposu

Eski surumler saglayicidan gelen `speedDirection: 0` degerini "tam kuzey" sanip
kaydediyordu; bu kayitlar yuzunden yenilemeden sonra tum oklar kuzeye donuyordu.
Anahtar `gyp-heading-v2` olarak degistirildi, eskisi siliniyor, 0 artik
"bilinmiyor" sayiliyor ve gercek kuzey **360** olarak saklaniyor.

### Liste paneli

Liste yalnizca ACIK katmanlari gosterir: kule secili ise sadece kuleler,
kule + ofis secili ise ikisi birden. Kategori basliklariyla gruplanir, her
grup filtre seridindeki sirayi ve rengi izler. Arama ad ve alt bilgide gecer.
Satira tiklayinca harita o kayda ucar ve balonu acar.

### Stok modu

Katman seridinin sagindaki "Stoklar" dugmesi haritayi yumusak altin tona
cevirir, zemini koyu laciverte alir ve mevcut isaretcileri soluklastirip
tiklanamaz yapar. Ton: `grayscale(1) sepia(.58) saturate(1.18)
hue-rotate(8deg) brightness(.97)` - once griye indirilip sicak tona
cevriliyor, doygunluk bilerek dusuk (uzun bakista goz yormasin). Dugme adi "Harita" olur; tekrar basinca
her sey eski haline doner. Amac: ileride eklenecek stok gosteriminin
kule/kuyu/arac bilgileriyle karismamasi.

Harita islevi degismiyor - yalnizca renk ve etkilesim. Gece/gunduz secimi
korunuyor.

Gecis 0.55 sn yumusak: filtre HER ZAMAN ayni fonksiyon listesiyle tanimli
(normalde tarafsiz degerlerde), yoksa `none` -> `filter(...)` arasinda ara
deger uretilemiyor ve renk aniden sicriyordu. Maske/sinir rengi SVG `fill`
gecisiyle, isaretciler ve ust katman ogeleri opaklik gecisiyle yumusatildi.

### Yetkili girisi (Worker uzerinden)

Sifre dogrulamasi artik sunucuda yapiliyor (`arac-servisi` Worker + KV), bu
onceki tamamen istemci-tarafi surumden farkli olarak gercek bir korumadir.
Jeton olmadan arac verisi hic sunucudan cikmaz.

- Sifreler PBKDF2 (120.000 tur) + tuz ile saklanir, duz metin hicbir yerde yok
- Giris HMAC ile imzali bir jeton doner (12 saat gecerli); jeton kurcalanirsa
  imza tutmaz, sunucu 401 doner
- Kullanicilar Cloudflare KV'de tutulur; panelden yapilan degisiklikler aninda
  herkes icin gecerli olur, dosya indirip yuklemeye gerek yok
- Varsayilan yonetici: `admin@gypenergy.com` / `gyp2026` - **ilk iste degistirin**

**Onemli:** `stock` yetkisi sonradan eklendi. KV'de zaten kayitli bir
`admin@gypenergy.com` hesabiniz varsa (daha once deploy ettiyseniz), o kayitta
`stock` alani yoktur ve varsayilan olarak `false` sayilir. Panelden kendi
hesabinizi acip "Stoklar" kutusuna tik atip tekrar kaydetmeniz gerekir - yeni
kurulumlarda varsayilan yonetici otomatik `stock: true` ile olusur.

**Erisim kurallari:**

| | Giris yapmadan | Yetkili (ilgili tur acik) |
|---|---|---|
| Kule/ofis/kamp/kuyu **konumu** | goruluyor | goruluyor |
| Yol tarifi | aliniyor | aliniyor |
| Ekip listesi, sayilar | gizli | goruluyor |
| Araclar | tamamen kapali | `vehicle` tikli ise goruluyor |
| Stok modu | kapali | `stock` tikli ise aciliyor |

`stock`, harita varliklarindan (kule/ofis/...) **ayri bir yetki**. Bir kullaniciya
yalniz kamp yetkisi verilirse stok moduna giremez; yalniz stok yetkisi verilirse
kamp/kule gibi turleri goremez ama stok moduna girebilir. Panelde "Erisim
Yetkileri" listesinin sonunda ayri bir "Stoklar" kutusu olarak gorunur.

Lokasyonlar `data.json` ile birlikte statik sitede durdugu icin zaten herkese
acik; bu yuzden onlar icin sunucu kontrolu yok, yalnizca arayuzde icerik
gizleniyor. Araclar ise Worker'dan geldigi icin gercekten korunuyor.

### Worker kurulumu (KV + oturum anahtari)

`arac-servisi` klasorunde, `wrangler deploy` etmeden once:

```
npx wrangler kv namespace create KULLANICILAR
```

Ciktidaki `id` degerini `wrangler.toml` icindeki `BURAYA_KV_ID_YAZIN` yerine
yazin. Sonra:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put OTURUM_ANAHTARI
```

(uretilen degeri yapistirin). Son olarak:

```
npx wrangler deploy
```

`kullanicilar.json` dosyasina artik gerek yok, kaldirildi.


### Stok modu

Kule/ofis/kamp isaretcileri stok modunda **NET ve tiklanabilir** kalir —
soluklastirma ve pointer-events:none kaldirildi, cunku amac stok bilgisine
odaklanmak, lokasyonlari gizlemek degil. Balon acilir ama icerigi kasitli
sade: yalniz isim + "Stoktakiler:" basligi (sehir, adres, ekip yok — bu
bilgiler "diger seylerle karismasin" prensibine gore stok gorunumunde
gosterilmiyor).

Uretim kuyulari ve araclar stok gorunumunun disinda; filtre seridinde kilit
simgesiyle isaretlenirler ve tiklanmalari hicbir sey yapmaz (yetkili girisi
istemez — bu ayri bir "yetkisizlik" degil, sadece stok kapsami disinda
olduklari icin boyle). "Tumu" dugmesi de stok modundayken yalnizca kule/ofis/
kamp arasinda gecis yapar.

Sag ustteki "Liste" paneli stok modunda da calisir; yalniz gorunen turleri
(kule/ofis/kamp) listeler ve arama yapılabilir — mevcut liste altyapisi zaten
`active[]` durumuna gore filtreledigi icin ek kod gerekmedi.


### GYP Ticket

Basligin saginda `https://gypticket.onrender.com` adresine giden lacivert
yildizli bilet baglantisi. Sayilar sola alindi.

### Renk kodu

Her tür kendi rengini taşır (`--c-rig`, `--c-production`, `--c-workshop`,
`--c-office`, `--c-vehicle`). İşaretçi `cat-*` sınıfıyla işaretlenir, renk
`--cat` değişkeni üzerinden ikona, seçili dolgusuna ve dalgaya aktarılır.
Filtre rozetleri de aynı renkleri kullanır, bağ kurulsun diye.


### Harita kaydırma sınırı

`maxBounds` dar tutulunca, dar ve uzun telefon ekranlarında görünür alan
sınırlardan yüksek kalıyor ve Leaflet dikey kaydırmayı tamamen kilitliyordu.
Sonuç: balon üst kenardan taşıyor, işaretçi görünmüyordu. Pay `pad(2.4)`.

### Seçili işaretçi

Balonu açık olan işaretçinin etrafında sürekli genişleyen iki halka
(`gyp-ripple`). Halkalar `.gyp-marker` üzerine konuldu; `.chip` içinde
`overflow: hidden` olduğu için orada kırpılıyordu.

### Araç yönü

Ok yalnızca yön biliniyorsa çizilir:
1. Sağlayıcının `speedDirection` alanı (varsa 0 da geçerlidir, tam kuzey demektir)
2. Yoksa önceki konumdan hesaplanan kerteriz (~15 m altı GPS gürültüsü sayılır)
3. O da yoksa aracın bilinen son yönü

Hiçbiri yoksa ok yerine yönsüz simge gösterilir — kuzeye bakan yanıltıcı ok
çizmemek için. Araç hareketli olduğu mavi halkadan anlaşılır.

Sağlayıcı `speedDirection` alanını gönderiyor ama değeri hep 0 geliyor.
Bu yüzden **hareketten hesaplanan yön önceliklidir**; sağlayıcı değeri yalnızca
elimizde hiç hareket verisi yoksa ve sıfırdan farklıysa kullanılır. Aksi halde
her yenilemede tüm oklar kuzeye dönüyordu. Bu yüzden "Araçlar" ilk açıldığında,
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

Arayüz ekranın %68'ini kaplıyordu, haritaya çok az yer kalıyordu. Telefonda
sadeleştirildi (harita artık ~%81):

- Başlık tek satır; logo ve yazılar küçültüldü
- Üstteki sayaçlar gizlendi — aynı sayılar filtre rozetlerinde zaten var
- Filtre rozetleri ve katman şeridi inceltildi
- Lejant gizlendi (açıklama amaçlı, dar ekranda yer kaplıyor)
- Altbilgi tek satır: yalnızca güncelleme tarihi + imza
- Açılışta harita işaretçilerin bulunduğu alana oturuyor
- Dokunma hedefleri en az 30 px
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

### Simge degisimi: kule <-> uretim kuyusu

Kule simgesi artik katmanli, X kafesli bir sondaj kulesi (derrick) —
tepede tac blok, ortada dikey mil, kafes icinde asagi-yukari hareket eden bir
blok (`.tb` sinifi). Uretim kuyusu simgesi ise onceki kule ikonu olan atbasi
(pumpjack, `.pj` sinifi, sallanan kiris).

`makeIcon()` her ikisi icin de indekse gore animasyon gecikmesi uyguluyor,
boylece ayni turdeki tum isaretciler ayni anda hareket etmiyor (5 farkli faz).
Eski depolama-tanki uretim kuyusu simgesi tamamen kaldirildi.

## Baslik metni

Sekme basligi: "GYP Map". Site basliginda "GÜNEY YILDIZI PETROL" yaninda
`.company-map` sinifiyla "MAP" ibaresi altin renkte (#dfae4f) ayri
gosteriliyor; altindaki h1 "Her Şey, Tek Çatı Altında" sloganini tasiyor.
Mobilde uzun metin `white-space: normal` ile sarilir, tasma olmaz.

