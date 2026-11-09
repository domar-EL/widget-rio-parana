// Dispara el Action "Actualizar dato del INA" cada 30 minutos: el cron de GitHub
// corre con horas de atraso. GITHUB_TOKEN es un secreto del Worker (permiso Actions: write).
// También devuelve la página de alturas de Prefectura, que no responde a los servidores de
// GitHub: el script la lee en https://widget-rios-disparador.ellitoral.workers.dev/
const PREFECTURA = 'https://contenidosweb.prefecturanaval.gob.ar/alturas/';

export default {
  async scheduled(event, env) {
    const r = await fetch('https://api.github.com/repos/domar-EL/widget-rio-parana/actions/workflows/actualizar.yml/dispatches', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'widget-rios-disparador',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (r.status !== 204) throw new Error(`GitHub respondió ${r.status}: ${await r.text()}`);
  },

  async fetch() {
    const r = await fetch(PREFECTURA, { cf: { cacheTtl: 300, cacheEverything: true } });
    return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};
