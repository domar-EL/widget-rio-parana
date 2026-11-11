#!/bin/zsh
# Prefectura no responde a GitHub ni a Cloudflare, pero sí desde Argentina. Esta tarea corre en una
# Mac (launchd, cada 30 minutos): baja la fila de Santa Fe y, si cambió, la sube a
# fuentes/prefectura.json y dispara el Action. Si la Mac está apagada, los widgets siguen con las
# lecturas de las 0:00 del INA y el CIM. Instalación: ver mac/LEEME.md.
set -eu
REPO=domar-EL/widget-rio-parana
ARCHIVO=fuentes/prefectura.json
GH=/opt/homebrew/bin/gh

nuevo=$(/usr/bin/curl -sS --max-time 30 https://contenidosweb.prefecturanaval.gob.ar/alturas/ | /usr/bin/python3 -c '
import html, json, re, sys
for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", sys.stdin.read(), re.S):
    c = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", td))).strip() for td in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, re.S)]
    if c[:2] == ["SANTA FE", "PARANA"]:
        print(json.dumps({"santa_fe": c[:12]}, ensure_ascii=False))
        sys.exit()
sys.exit("Prefectura: no está la fila de Santa Fe")
')

actual=$($GH api -H "Accept: application/vnd.github.raw" "repos/$REPO/contents/$ARCHIVO" 2>/dev/null || true)
[[ "$nuevo" == "$actual" ]] && exit 0

sha=$($GH api "repos/$REPO/contents/$ARCHIVO" --jq .sha 2>/dev/null || true)
$GH api -X PUT "repos/$REPO/contents/$ARCHIVO" -f message="Santa Fe según Prefectura" \
  -f content="$(print -r -- "$nuevo" | /usr/bin/base64)" ${sha:+-f sha=$sha} > /dev/null
$GH workflow run actualizar.yml -R $REPO
echo "$(date '+%F %R') subido: $nuevo"
