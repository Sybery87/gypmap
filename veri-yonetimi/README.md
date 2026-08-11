# GYP · Veri Yönetimi (yalnızca yerel kullanım)

> ⚠️ **Bu klasörü Netlify'a veya herhangi bir web sunucusuna YÜKLEMEYİN.**
> Yüklerseniz herkes düzenleme panelini görebilir. Bu klasör yalnızca veriyi
> güncelleyen kişinin bilgisayarında durmalıdır.

---

## Nasıl açılır

**`admin.html`** dosyasına çift tıklayın. Tarayıcıda açılır, kurulum gerekmez.

> Gizli / InPrivate pencere **kullanmayın.** Panel taslakları tarayıcıya kaydeder;
> gizli pencerede bunlar pencere kapanınca silinir ve emeğiniz kaybolur.

---

## Çalışma akışı

### 1. Güncel veriyi getirin

İki yoldan biri:

- **Canlı siteden:** Üstteki kutuya site adresinizi yazın
  (`https://gyp-saha-haritasi.netlify.app`) → **“Canlı veriyi çek”**.
  Adres bir kez kaydedilir, sonraki açılışlarda hatırlanır.
- **Dosyadan:** **“data.json yükle”** deyip yayın klasöründeki `data.json`
  dosyasını seçin.

Daha önce yarım bıraktığınız bir taslak varsa panel onu otomatik açar.

### 2. Düzenleyin

- **Kule bilgileri:** ad, şehir, koordinat, tarih
- **Koordinat:** elle yazın ya da **“Haritadan seç”** ile uydu görüntüsü üzerinde
  tıklayarak belirleyin
- **Çalışanlar:** her satıra bir kişi → `İsim - Görev`
- **Kule taşındığında:** **“Taşındı olarak kaydet”**e basın. Mevcut şehir ve ekip
  otomatik olarak *önceki kayıt* haline gelir; haritada soluk ve kesik çizgiyle
  gösterilir. Ardından yeni şehri ve yeni ekibi girin.
- **Yeni kule / tesis** eklemek için üstteki butonları kullanın.

Her değişiklik anında tarayıcıya kaydedilir; sekmeyi kapatsanız da durur.

### 3. Yayınlayın

1. **“data.json indir”** butonuna basın.
2. İnen `data.json` dosyasını **`gyp-saha-haritasi`** klasöründeki `data.json`
   ile değiştirin.
3. `gyp-saha-haritasi` klasörünü Netlify'a yeniden yükleyin
   (Netlify'da site → **Deploys** → alttaki bırakma alanına sürükleyin).
4. 1–2 dakika içinde canlı sitede görünür.

> Bu adımı yapmadığınız sürece değişiklikler **yalnızca sizin bilgisayarınızdadır**,
> kimse göremez.

---

## data.json biçimi

Elle düzenlemek isterseniz yapı şudur:

```json
{
  "updatedAt": "2026-08-03",
  "facilities": [
    { "id": "fac-merkez", "name": "GYP Merkez", "type": "office",
      "city": "Ankara", "lat": 39.9334, "lon": 32.8597 }
  ],
  "rigs": [
    {
      "id": "rig-7",
      "name": "#Rig-7",
      "city": "Diyarbakır",
      "lat": 37.9144,
      "lon": 40.2306,
      "since": "2026-07-28",
      "employees": [
        { "name": "Mehmet Yıldız", "role": "Saha Şefi" }
      ],
      "previous": {
        "city": "Batman", "lat": 37.8812, "lon": 41.1351,
        "until": "2026-07-27",
        "employees": [{ "name": "Osman Yalçın", "role": "Operatör" }]
      }
    }
  ]
}
```

- `type` yalnızca `"office"` (ofis/merkez) veya `"workshop"` (atölye/kamp) olabilir.
- `previous` alanı `null` bırakılırsa haritada soluk önceki kayıt gösterilmez.
- Tarihler `YYYY-AA-GG` biçiminde yazılmalıdır.
- Koordinatlar ondalık derece: enlem `lat` ~35.5–42.5, boylam `lon` ~25–45 arası.

---

## Sık sorulanlar

**Panelde sildiğim kule canlı siteden de silindi mi?**
Hayır. Panel canlı veriye dokunmaz. Ancak “data.json indir → dosyayı değiştir →
siteyi yeniden yükle” adımlarını tamamlarsanız silinir.

**Başka bir bilgisayardan düzenleyebilir miyim?**
Bu klasörü o bilgisayara kopyalayın, `admin.html`'i açın, “Canlı veriyi çek” deyin.
Böylece her zaman en güncel veriyle başlarsınız.

**İki kişi aynı anda düzenlerse ne olur?**
Sonradan yükleyen kişi diğerinin değişikliklerini ezer. Aynı anda çok kullanıcılı
düzenleme gerekiyorsa ücretsiz bir veritabanı (örn. Supabase) eklenmelidir.
