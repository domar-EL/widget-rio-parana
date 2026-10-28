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
  console.warn(`Salado sin actualizar (Recursos Hídricos de Santa Fe): ${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ''}`);
  salado = SALADO.map(s => ({ rio: 'Salado', estacion: s.estacion, alerta: ALERTA_SALADO, evac: null, lecturas: lecturasPrevias(s.estacion) }));
}
const rios = [
  { rio: 'Paraná', estacion: 'Puerto de Santa Fe', alerta: niveles.alerta, evac: niveles.evac, lecturas: observaciones.slice(-2).reverse() },
  ...salado,
];
await writeFile(RIOS, JSON.stringify(rios, null, 1) + '\n');
for (const r of rios) console.log(`rios.json: ${r.rio} ${r.estacion} = ${r.lecturas[0]?.v ?? 'sin datos'} (${r.lecturas[0]?.t ?? '-'})`);

// public/tablas.json para tabla.html, que reemplaza las tablas de Datawrapper de
// ellitoral.com/servicios/clima/altura_rios (mismas estaciones y orden). Paraná,
// Paraguay, Iguazú y Uruguay: tabla de Prefectura; Salado: tabla del CIM (FICH-UNL),
// que toma la red de alerta de la provincia. Son páginas HTML, no APIs: si cambian
// o no responden, se conserva la sección anterior de tablas.json.
const TABLAS = new URL('../public/tablas.json', import.meta.url);
const PUERTOS = {
  parana: [
    ['Andresito', 'Iguazú'], ['Iguazú', 'Iguazú'], ['Libertad', 'Paraná'], ['Eldorado', 'Paraná'],
    ['Libertador', 'Paraná'], ['Puerto Mani', 'Paraná'], ['Santa Ana', 'Paraná'], ['Posadas', 'Paraná'],
    ['Ituzaingó', 'Paraná'], ['Ita Ibate', 'Paraná'], ['Itatí', 'Paraná'], ['Paso de la Patria', 'Paraná'],
    ['Corrientes', 'Paraná'], ['Barranqueras', 'Paraná'], ['Empedrado', 'Paraná'], ['Bella Vista', 'Paraná'],
    ['Goya', 'Paraná'], ['Reconquista', 'Paraná'], ['Esquina', 'Paraná'], ['San Javier (Santa Fe)', 'San Javier'],
    ['La Paz', 'Paraná'], ['Santa Elena', 'Paraná'], ['Hernandarias', 'Paraná'], ['Paraná', 'Paraná'],
    ['Santa Fe', 'Paraná'], ['Diamante', 'Paraná'], ['Victoria', 'Paraná'], ['San Lorenzo', 'Paraná'],
    ['Rosario', 'Paraná'], ['Villa Constitución', 'Paraná'], ['San Nicolás', 'Paraná'], ['Ramallo', 'Paraná'],
    ['San Pedro', 'Delta Paraná'], ['Baradero', 'Delta Paraná'], ['Pilcomayo', 'Paraguay'], ['Bouvier', 'Paraguay'],
    ['Formosa', 'Paraguay'], ['Bermejo', 'Paraguay'], ['Las Palmas', 'Paraguay'], ['Isla del Cerrito', 'Paraguay'],
  ],
  uruguay: [
    ['Monte Caseros', 'Uruguay'], ['Mocoretá', 'Uruguay'], ['Federación', 'Uruguay'], ['Federación Embalse', 'Uruguay'],
    ['Salto Grande Arriba', 'Uruguay'], ['Salto Grande Abajo', 'Uruguay'], ['Concordia', 'Uruguay'], ['Colón', 'Uruguay'],
    ['Concepción del Uruguay', 'Uruguay'], ['Campichuelo', 'Uruguay'], ['Boca Gualeguaychú', 'Gualeguaychú'],
  ],
};
const MESES = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12 };
const clave = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const num = s => { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const texto = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const celdas = html => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
  .map(([, tr]) => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(([, td]) => texto(td)));
// "28/OCT/26 - 0800" (hora argentina) -> ISO
const fechaPNA = s => {
  const m = s.match(/(\d{2})\/([A-Z]{3})\/(\d{2}) - (\d{2})(\d{2})/);
  return m && `20${m[3]}-${String(MESES[m[2]]).padStart(2, '0')}-${m[1]}T${m[4]}:${m[5]}:00-03:00`;
};
const pagina = async url => {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${url} respondió ${r.status}`);
  return r.text();
};

async function prefectura() {
  const filas = new Map(celdas(await pagina('https://contenidosweb.prefecturanaval.gob.ar/alturas/'))
    .filter(c => c.length >= 12).map(c => [clave(c[0]), c]));
  const tabla = lista => lista.map(([puerto, rio]) => {
    const c = filas.get(clave(puerto));
    return c ? { puerto, rio, altura: num(c[2]), fecha: fechaPNA(c[5]), estado: c[6], anterior: num(c[8]), fechaAnt: fechaPNA(c[9]), alerta: num(c[10]), evac: num(c[11]) }
             : { puerto, rio, altura: null };
  });
  const parana = tabla(PUERTOS.parana), uruguay = tabla(PUERTOS.uruguay);
  if (![...parana, ...uruguay].some(f => f.altura != null)) throw new Error('la tabla de Prefectura no trajo alturas');
  return { parana, uruguay };
}

async function fichSalado() {
  const html = await pagina('https://fich.unl.edu.ar/cim/rios/salado/alturas');
  const m = texto(html).match(/correspondientes a la fecha \w+ (\d{1,2}) de (\w+) de (\d{4})/);
  const mes = m && MESES[clave(m[2]).slice(0, 3)];
  const fecha = mes && `${m[3]}-${String(mes).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const filas = celdas(html).filter(c => c.length >= 7 && num(c[6]) != null)
    .map(c => ({ estacion: c[0], rio: c[1], altura: num(c[2]), anterior: num(c[5]), alerta: num(c[6]) }));
  if (!fecha || !filas.length) throw new Error('la tabla de la FICH no trajo fecha o alturas');
  return { fecha, filas };
}

const tablasPrevias = JSON.parse(await readFile(TABLAS, 'utf8').catch(() => '{}'));
const tablas = { ...tablasPrevias };
try {
  Object.assign(tablas, await prefectura());
} catch (e) {
  console.warn(`Prefectura sin actualizar: ${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ''}`);
}
try {
  tablas.salado = await fichSalado();
} catch (e) {
  console.warn(`FICH (Salado) sin actualizar: ${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ''}`);
}
await writeFile(TABLAS, JSON.stringify(tablas, null, 1) + '\n');
const sf = tablas.parana?.find(f => f.puerto === 'Santa Fe');
console.log(`tablas.json: Santa Fe ${sf?.altura} (${sf?.fecha}) · Salado ${tablas.salado?.fecha} · ${tablas.salado?.filas.length ?? 0} estaciones`);
