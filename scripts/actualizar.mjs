// Baja la serie del INA (Paraná en el Puerto de Santa Fe) y escribe public/datos.json.
// El archivo solo cambia cuando el INA publica o corrige una lectura, así el
// workflow commitea (y Cloudflare publica) una o dos veces por día.
import { writeFile } from 'node:fs/promises';

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

// public/rios.json para rios.html: Paraná (lo de arriba) + Salado. Las series del
// Salado a veces dejan de actualizarse por semanas; se publican igual con su fecha
// y el widget avisa que el dato es viejo. Si el INA falla acá, se conserva el
// rios.json anterior sin frenar la actualización de datos.json.
const SALADO = [
  { serie: 3044, nombre: 'Santo Tomé' },
  { serie: 103, nombre: 'Recreo (RP 70)' },
];
const ultimas = obs => obs.slice(-2).reverse();   // [última, anterior]

try {
  const desdeSalado = new Date(hoy - 180 * 864e5);
  const salado = await Promise.all(SALADO.map(async ({ serie: id, nombre }) => {
    const r = await fetch(`https://alerta.ina.gob.ar/a5/obs/puntual/series/${id}?timestart=${iso(desdeSalado)}&timeend=${iso(hasta)}`,
      { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`INA respondió ${r.status} para la serie ${id}`);
    const s = await r.json();
    const obs = s.observaciones
      .map(o => ({ t: o.timestart, v: +o.valor }))
      .filter(o => Number.isFinite(o.v))
      .sort((a, b) => a.t.localeCompare(b.t));
    return { rio: 'Salado', estacion: nombre, alerta: s.estacion.nivel_alerta, evac: s.estacion.nivel_evacuacion, lecturas: ultimas(obs) };
  }));
  const rios = [
    { rio: 'Paraná', estacion: 'Puerto de Santa Fe', alerta: niveles.alerta, evac: niveles.evac, lecturas: ultimas(observaciones) },
    ...salado,
  ];
  await writeFile(new URL('../public/rios.json', import.meta.url), JSON.stringify(rios, null, 1) + '\n');
  for (const r of rios) console.log(`rios.json: ${r.rio} ${r.estacion} = ${r.lecturas[0]?.v ?? 'sin datos'} (${r.lecturas[0]?.t ?? '-'})`);
} catch (e) {
  console.warn(`rios.json sin actualizar: ${e.message}`);
}
