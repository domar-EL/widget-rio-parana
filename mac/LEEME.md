# Santa Fe durante el día, desde una Mac

Prefectura publica la altura de Santa Fe varias veces por día, pero su página no responde a GitHub
ni a Cloudflare. `prefectura.sh` corre cada 30 minutos en una Mac en Argentina, baja la fila de
Santa Fe y, si cambió, se la pasa al Action (parámetro `prefectura`), que la guarda en
`fuentes/prefectura.json` y la suma a `datos.json` si es más nueva que la última lectura del INA o el CIM.

Necesita `gh` (Homebrew) con sesión en una cuenta con permiso de escritura en el repo.
Si la Mac está apagada o dormida, los widgets siguen con las lecturas de las 0:00.

## Instalar

```bash
mkdir -p ~/Library/"Application Support"/widget-rios
cp mac/prefectura.sh ~/Library/"Application Support"/widget-rios/
cp mac/ar.com.ellitoral.widget-rios.prefectura.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ar.com.ellitoral.widget-rios.prefectura.plist
```

Registro: `~/Library/Logs/widget-rios-prefectura.log`.

## Desinstalar

```bash
launchctl bootout gui/$(id -u)/ar.com.ellitoral.widget-rios.prefectura
rm ~/Library/LaunchAgents/ar.com.ellitoral.widget-rios.prefectura.plist
rm -r ~/Library/"Application Support"/widget-rios
```
