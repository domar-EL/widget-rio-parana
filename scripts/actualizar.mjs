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
const DATOS = new URL('../public/datos.json', import.meta.url);

// Problemas para el aviso por mail (ver el workflow): una fuente que cambió de formato o de
// dirección (404) se avisa enseguida; un corte de conexión no, porque suele resolverse en la
// corrida siguiente y, si dura, termina en un dato viejo, que también se avisa (al final del script).
const problemas = [];
const formato = msg => Object.assign(new Error(msg), { formato: true });
const motivo = e => `${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ''}`;
const fallo = (fuente, e) => {
  console.warn(`${fuente} sin actualizar: ${motivo(e)}`);
  if (e.formato) problemas.push(`${fuente}: ${e.message}. Probablemente cambió la página o la API; hay que ajustar scripts/actualizar.mjs.`);
};

let observaciones, niveles;
try {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw (r.status === 404 ? formato : Error)(`INA respondió ${r.status}`);
  const serie = await r.json();
  const est = serie.estacion;
  observaciones = serie.observaciones
    .map(o => ({ t: o.timestart, v: +o.valor }))
    .filter(o => Number.isFinite(o.v))
    .sort((a, b) => a.t.localeCompare(b.t))
    .slice(-DIAS);
  niveles = { bajas: est.nivel_aguas_bajas, alerta: est.nivel_alerta, evac: est.nivel_evacuacion };
  if (!observaciones.length || !Object.values(niveles).every(Number.isFinite)) {
    throw formato('el INA devolvió la serie sin datos o sin niveles de referencia');
  }
  await writeFile(DATOS, JSON.stringify({ estacion: est.nombre, niveles, observaciones }, null, 1) + '\n');
  console.log(`OK: ${observaciones.length} lecturas, última ${observaciones.at(-1).t} = ${observaciones.at(-1).v} m`);
} catch (e) {
  fallo('Santa Fe (INA)', e);
  ({ observaciones, niveles } = JSON.parse(await readFile(DATOS, 'utf8')));   // sigue con el último datos.json
}

// Fuentes para rios.json y tablas.json. Desde GitHub no se llega ni a Prefectura ni al
// mapa de Recursos Hídricos de la provincia (timeout de conexión), pero sí a la FICH-UNL
// y al INA. Paraná, Paraguay e Iguazú: tabla diaria del CIM (FICH-UNL), que copia los
// registros de Prefectura; Salado: tabla diaria del CIM, que toma la red de alerta de la
// provincia (el INA no actualiza el Salado desde el 8/10/2026); Uruguay: series de
// Prefectura en el INA. Las del CIM son páginas HTML, no APIs: si cambian o no
// responden, se conserva el último dato y los widgets avisan cuando es viejo.
const RIOS = new URL('../public/rios.json', import.meta.url);
const TABLAS = new URL('../public/tablas.json', import.meta.url);
const URUGUAY = [   // [puerto, río, serie del INA]
  ['Monte Caseros', 'Uruguay', 74], ['Mocoretá', 'Uruguay', 75], ['Federación', 'Uruguay', 76],
  ['Federación Embalse', 'Uruguay', 18621], ['Salto Grande Arriba', 'Uruguay', 77], ['Salto Grande Abajo', 'Uruguay', 78],
  ['Concordia', 'Uruguay', 79], ['Colón', 'Uruguay', 80], ['Concepción del Uruguay', 'Uruguay', 81],
  ['Campichuelo', 'Uruguay', 82], ['Boca Gualeguaychú', 'Gualeguaychú', 84],
];
const SALADO_RIOS = [['Santo Tomé', 'Santo Tomé'], ['Recreo (R.P. 70)', 'Recreo (RP 70)']];   // [estación en el CIM, nombre en rios.json]
const ALERTA_SALADO = 4.7;   // nivel de alerta en Santo Tomé y Recreo (CIM, INA y Rec. Hídricos)

const MESES = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12 };
const clave = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const num = s => { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const texto = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const celdas = html => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
  .map(([, tr]) => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(([, td]) => texto(td)));

// Tabla del CIM: fecha ("correspondientes a la fecha martes 27 de octubre de 2026") y filas
// con la altura en la columna 2, la anterior en la 5 y el umbral de alerta en la 6.
async function cim(rio) {
  const r = await fetch(`https://cim.fich.unl.edu.ar/rios/${rio}/alturas`, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw (r.status === 404 ? formato : Error)(`el CIM respondió ${r.status}`);
  const html = await r.text();
  const m = texto(html).match(/correspondientes a la fecha \S+ (\d{1,2}) de (\S+) de (\d{4})/);
  const mes = m && MESES[clave(m[2]).slice(0, 3)];
  const filas = celdas(html).filter(c => c.length >= 7 && num(c[6]) != null);
  if (!mes || !filas.length) throw formato(`la tabla del CIM (${rio}) no trajo fecha o alturas`);
  return { fecha: `${m[3]}-${String(mes).padStart(2, '0')}-${m[1].padStart(2, '0')}`, filas };
}

async function uruguay() {
  const desdeUy = new Date(hoy - 10 * 864e5);
  return Promise.all(URUGUAY.map(async ([puerto, rio, id]) => {
    const r = await fetch(`https://alerta.ina.gob.ar/a5/obs/puntual/series/${id}?timestart=${iso(desdeUy)}&timeend=${iso(hasta)}`,
      { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw (r.status === 404 ? formato : Error)(`INA respondió ${r.status} para la serie ${id}`);
    const s = await r.json();
    const [u, a] = s.observaciones.filter(o => Number.isFinite(+o.valor)).sort((x, y) => y.timestart.localeCompare(x.timestart));
    return { puerto, rio, altura: u ? +u.valor : null, anterior: a ? +a.valor : null, fecha: u?.timestart ?? null,
      alerta: s.estacion.nivel_alerta, evac: s.estacion.nivel_evacuacion };
  }));
}

const previoRios = JSON.parse(await readFile(RIOS, 'utf8').catch(() => '[]'));
const tablas = JSON.parse(await readFile(TABLAS, 'utf8').catch(() => '{}'));

try {
  const t = await cim('parana');
  tablas.parana = { fecha: t.fecha, filas: t.filas.map(c => ({ puerto: c[0], rio: c[1], altura: num(c[2]), anterior: num(c[5]), alerta: num(c[6]), evac: num(c[7]) })) };
} catch (e) { fallo('Tabla del Paraná (CIM FICH-UNL)', e); }
try {
  const t = await cim('salado');
  tablas.salado = { fecha: t.fecha, filas: t.filas.map(c => ({ estacion: c[0], rio: c[1], altura: num(c[2]), anterior: num(c[5]), alerta: num(c[6]) })) };
} catch (e) { fallo('Tabla del Salado (CIM FICH-UNL)', e); }
try {
  tablas.uruguay = { filas: await uruguay() };
} catch (e) { fallo('Tabla del Uruguay (INA)', e); }
await writeFile(TABLAS, JSON.stringify(tablas, null, 1) + '\n');
console.log(`tablas.json: Paraná ${tablas.parana?.fecha} · Salado ${tablas.salado?.fecha} · Uruguay ${tablas.uruguay?.filas.find(f => f.fecha)?.fecha}`);

// rios.json: Paraná del INA (datos.json) + Salado del CIM, con la lectura del día y la anterior.
const salado = SALADO_RIOS.map(([cimNombre, estacion]) => {
  const f = tablas.salado?.filas.find(f => f.estacion === cimNombre);
  const t = tablas.salado && new Date(`${tablas.salado.fecha}T00:00:00-03:00`);   // el CIM toma el dato de las 0:00
  const lecturas = f?.altura != null
    ? [{ t: t.toISOString(), v: f.altura }, ...(f.anterior != null ? [{ t: new Date(t - 864e5).toISOString(), v: f.anterior }] : [])]
    : previoRios.find(r => r.estacion === estacion)?.lecturas ?? [];
  return { rio: 'Salado', estacion, alerta: ALERTA_SALADO, evac: null, lecturas };
});
const rios = [
  { rio: 'Paraná', estacion: 'Puerto de Santa Fe', alerta: niveles.alerta, evac: niveles.evac, lecturas: observaciones.slice(-2).reverse() },
  ...salado,
];
await writeFile(RIOS, JSON.stringify(rios, null, 1) + '\n');
for (const r of rios) console.log(`rios.json: ${r.rio} ${r.estacion} = ${r.lecturas[0]?.v ?? 'sin datos'} (${r.lecturas[0]?.t ?? '-'})`);

// Datos viejos: 2 días o más sin lecturas nuevas (el mismo umbral que usan los widgets).
const viejo = t => t && Date.now() - new Date(t) >= 2 * 864e5;
const dia = t => new Date(t).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
const revisar = (que, t) => { if (viejo(t)) problemas.push(`${que}: la última lectura es del ${dia(t)}.`); };
revisar('Santa Fe (INA), widgets y franja', observaciones.at(-1)?.t);
revisar('Tabla del Paraná (CIM FICH-UNL)', tablas.parana && `${tablas.parana.fecha}T00:00:00-03:00`);
revisar('Tabla del Salado y widget de ríos (CIM FICH-UNL)', tablas.salado && `${tablas.salado.fecha}T00:00:00-03:00`);
revisar('Tabla del Uruguay (INA)', tablas.uruguay?.filas.map(f => f.fecha).filter(Boolean).sort().at(-1));

if (problemas.length) console.warn(`Problemas:\n- ${problemas.join('\n- ')}`);
if (process.env.ALERTAS) await writeFile(process.env.ALERTAS, problemas.map(p => `- ${p}`).join('\n'));
