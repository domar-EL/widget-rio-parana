// Dispara el Action "Actualizar dato del INA" cada 30 minutos: el cron de GitHub
// corre con horas de atraso. GITHUB_TOKEN es un secreto del Worker (permiso Actions: write).
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
};
