#!/usr/bin/env bash
# Repoyu tek seferde degil, mantikli adimlar halinde commit'ler.
# Kullanim:  bash ilk-kurulum.sh
set -e

cd "$(dirname "$0")"

if [ -d .git ]; then
  echo "Bu klasorde zaten bir git deposu var. Devam edilmedi."
  exit 1
fi

git init -q
git add .gitignore .editorconfig
git commit -qm "proje iskeleti"

git add assets/turkey-border.js
git commit -qm "turkiye sinir poligonu (natural earth 10m, sadelestirilmis)"

git add assets/style.css assets/logo.png assets/favicon.png assets/favicon.ico assets/apple-touch-icon.png
git commit -qm "temel stil + logo/favicon"

git add assets/shared.js
git commit -qm "ikon setleri ve yardimci fonksiyonlar"

git add index.html assets/app.js
git commit -qm "harita gorunumu: uydu katmanlari, maske, pinler"

git add data.json
git commit -qm "saha verisi: kuleler, tesisler, uretim sahalari"

git add _headers
git commit -qm "cache ve cors basliklari"

git add README.md
git commit -qm "readme"

git add -A
git commit -qm "kalan dosyalar" 2>/dev/null || true

git branch -M main
echo
echo "Bitti. Commit gecmisi:"
git --no-pager log --oneline
echo
echo "Sonraki adim:"
echo "  git remote add origin https://github.com/KULLANICI/DEPO.git"
echo "  git push -u origin main"
