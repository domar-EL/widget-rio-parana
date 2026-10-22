# Widget: nivel del río Paraná en Santa Fe

Widget para embeber por iframe en ellitoral.com. Muestra la altura del Paraná en el
Puerto de Santa Fe, los niveles de alerta y evacuación, y los últimos 30 días.

- `public/` — lo que se publica (Cloudflare Pages, directorio de salida `public`, sin build).
- `scripts/actualizar.mjs` — baja la serie 30 del INA y escribe `public/datos.json`.
- `.github/workflows/actualizar.yml` — corre el script cada 30 minutos y commitea solo si el dato cambió.

Los lectores nunca consultan al INA: leen `datos.json` desde el CDN.

## Embed

```html
<iframe src="https://widget-rios.ellitoral.com/" width="100%" height="340" loading="lazy"
  style="border:0" title="Nivel del río Paraná en Santa Fe — El Litoral"></iframe>
```

Tema oscuro: `?theme=dark`. Ancho mínimo recomendado: 300 px.

### Ríos (Paraná + Salado en Santo Tomé y Recreo)

```html
<iframe src="https://widget-rios.ellitoral.com/rios" width="100%" height="450" loading="lazy"
  style="border:0" title="Altura de los ríos en Santa Fe — El Litoral"></iframe>
```

Lee `public/rios.json`. Si una estación no tiene lecturas nuevas hace 2 días o más, la fila se
muestra en gris, en pasado y con la antigüedad del dato.

## Probar local

```bash
node scripts/actualizar.mjs
python3 -m http.server 8765
```

Abrir `http://localhost:8765/prueba.html`.

Fuente: INA (SIyAH) / Prefectura Naval Argentina.
