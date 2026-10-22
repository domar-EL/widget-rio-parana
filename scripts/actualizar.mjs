// Baja la serie del INA (Paraná en el Puerto de Santa Fe) y escribe public/datos.json.
// El archivo solo cambia cuando el INA publica o corrige una lectura, así el
// workflow commitea (y Cloudflare publica) una o dos veces por día.
import { readFile, writeFile } from 'node:fs/promises';

const SERIE = 30;   // INA: Santa Fe, escala de Prefectura
const DIAS = 30;

const iso = d => d.toISOString().slice(0, 10);
const hoy = new Date();
const desde = new Date(hoy - (DIAS + 15) * 864e5);
const hasta = new Date(+hoy + 864e5);
const url = `https://alerta.ina.gob.ar/a5/obs/puntual/series/${SERIE}?timestart=${iso(desde)}&timeend=${iso(hasta)}`;

const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
if (!r.ok) throw new Error(`INA respondió ${r.status}`);
const serie = await r.json();
const est = serie.estacion;

const observaciones = serie.observaciones
  .map(o => ({ t: o.timestart, v: +o.valor }))
  .filter(o => Number.isFinite(o.v))
  .sort((a, b) => a.t.localeCompare(b.t))
  .slice(-DIAS);

const niveles = { bajas: est.nivel_aguas_bajas, alerta: est.nivel_alerta, evac: est.nivel_evacuacion };
if (!observaciones.length || !Object.values(niveles).every(Number.isFinite)) {
  throw new Error('El INA devolvió la serie sin datos o sin niveles de referencia');
}

const datos = { estacion: est.nombre, niveles, observaciones };
await writeFile(new URL('../public/datos.json', import.meta.url), JSON.stringify(datos, null, 1) + '\n');
console.log(`OK: ${observaciones.length} lecturas, última ${observaciones.at(-1).t} = ${observaciones.at(-1).v} m`);

// public/rios.json para rios.html: Paraná (lo de arriba, del INA) + Salado.
// El Salado sale del mapa de alturas de Recursos Hídricos de Santa Fe, porque la red
// del INA para esa cuenca dejó de actualizarse el 8/10/2026 (es la misma escala: los
// dos daban 3,64 en Santo Tomé ese día). No es una API publicada: el proxy del mapa
// solo responde con la cookie de sesión que da la página del mapa. Si falla, o si
// una estación no tiene dato, se conserva su última lectura y el widget avisa que
// es vieja; datos.json se actualiza igual.
const RIOS = new URL('../public/rios.json', import.meta.url);
const MAPA = 'https://www.santafe.gob.ar/idesf/vis-pre/';
const SALADO = [
  { nombre: 'Est. Santo Tome', estacion: 'Santo Tomé' },
  { nombre: 'Est. Recreo', estacion: 'Recreo (RP 70)' },
];
const ALERTA_SALADO = 4.7;   // nivel de alerta en Santo Tomé y Recreo (INA y Rec. Hídricos)

const previo = JSON.parse(await readFile(RIOS, 'utf8').catch(() => '[]'));
const lecturasPrevias = estacion => previo.find(r => r.estacion === estacion)?.lecturas ?? [];

async function saladoProvincia() {
  const pagina = await fetch(`${MAPA}?user=rec_hidricos_alturas`, { signal: AbortSignal.timeout(30_000) });
  const cookie = pagina.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const lecturas = SALADO.map(() => null);
  // Dato del día (hora argentina); si todavía no está, días anteriores.
  for (let i = 0; i < 7 && lecturas.includes(null); i++) {
    const fecha = new Date(Date.now() - 3 * 3600e3 - i * 864e5).toISOString().slice(0, 10);
    const wfs = 'https://aswe.santafe.gov.ar/idesf/geoserver/RecursosHidricos/wfs/wfs?service=WFS&version=1.0.0'
      + `&request=GetFeature&typeName=diferencia_alturas&maxFeatures=500&outputFormat=application/json&viewparams=fecha:${fecha}`;
    const r = await fetch(`${MAPA}proxyPTRxml.php?url=${encodeURIComponent(wfs)}`, { headers: { cookie }, signal: AbortSignal.timeout(30_000) });
    const alturas = new Map(JSON.parse(await r.text()).features.map(f => [f.properties.nombre, f.properties]));
    SALADO.forEach((s, k) => {
      const p = alturas.get(s.nombre);
      if (lecturas[k] || !p || p.sd || !Number.isFinite(p.altura)) return;
      const t = new Date(`${fecha}T09:00:00Z`);   // la provincia publica el dato de las 6:00
      lecturas[k] = [{ t: t.toISOString(), v: p.altura }];
      if (Number.isFinite(p.anterior)) lecturas[k].push({ t: new Date(t - 864e5).toISOString(), v: p.anterior });
    });
  }
  return SALADO.map((s, k) => ({ rio: 'Salado', estacion: s.estacion, alerta: ALERTA_SALADO, evac: null,
    lecturas: lecturas[k] ?? lecturasPrevias(s.estacion) }));
}

let salado;
try {
  salado = await saladoProvincia();
} catch (e) {
  console.warn(`Salado sin actualizar (Recursos Hídricos de Santa Fe): ${e.message}`);
  salado = SALADO.map(s => ({ rio: 'Salado', estacion: s.estacion, alerta: ALERTA_SALADO, evac: null, lecturas: lecturasPrevias(s.estacion) }));
}
const rios = [
  { rio: 'Paraná', estacion: 'Puerto de Santa Fe', alerta: niveles.alerta, evac: niveles.evac, lecturas: observaciones.slice(-2).reverse() },
  ...salado,
];
await writeFile(RIOS, JSON.stringify(rios, null, 1) + '\n');
for (const r of rios) console.log(`rios.json: ${r.rio} ${r.estacion} = ${r.lecturas[0]?.v ?? 'sin datos'} (${r.lecturas[0]?.t ?? '-'})`);
