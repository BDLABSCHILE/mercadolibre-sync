/**
 * Layout HTML base para el dashboard admin.
 * Template literals = sin engine externo.
 */

const PICO_CDN = 'https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css';
const HTMX_CDN = 'https://unpkg.com/htmx.org@1.9.12';

export function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtCLP(n) {
  if (n == null) return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return `$${num.toLocaleString('es-CL')}`;
}

export function layout({ title, content, active = '' }) {
  return `<!DOCTYPE html>
<html lang="es" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} · Valiz Sync</title>
  <link rel="stylesheet" href="${PICO_CDN}">
  <script src="${HTMX_CDN}" defer></script>
  <style>
    :root { --pico-spacing: 0.7rem; --pico-font-size: 14px; }
    body { padding: 0; max-width: none; }
    .container-fluid { max-width: 1600px; margin: 0 auto; padding: 0 1.5rem; }
    nav.main { background: #1a1d29; color: #fff; padding: 0.6rem 1.5rem; margin-bottom: 1.2rem; }
    nav.main a { color: #fff; text-decoration: none; margin-right: 1.2rem; opacity: 0.7; }
    nav.main a.active, nav.main a:hover { opacity: 1; }
    nav.main h1 { display: inline-block; margin: 0 2rem 0 0; font-size: 1.1rem; }
    table { font-size: 0.85rem; }
    table th, table td { padding: 0.4rem 0.6rem; }
    .badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 3px; font-size: 0.75rem; font-weight: 600; }
    .badge.ok { background: #d1fadf; color: #027a48; }
    .badge.warn { background: #fef0c7; color: #b54708; }
    .badge.err { background: #fee4e2; color: #b42318; }
    .badge.dim { background: #f0f1f3; color: #344054; }
    .small { font-size: 0.8rem; color: #667085; }
    .right { text-align: right; }
    .mono { font-family: ui-monospace, SFMono-Regular, monospace; }
    .truncate { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toolbar { display: flex; gap: 0.6rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
    .toolbar input, .toolbar select { margin: 0; }
    button.danger { background: #d92d20; border-color: #d92d20; }
    button.ghost { background: transparent; color: #344054; border: 1px solid #d0d5dd; }
    button.ghost:hover { background: #f9fafb; }
    .toast { position: fixed; top: 1rem; right: 1rem; background: #1a1d29; color: #fff; padding: 0.8rem 1.2rem; border-radius: 6px; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    dialog { max-width: 600px; }
    details summary { cursor: pointer; }
    .empty { text-align: center; padding: 3rem; color: #98a2b3; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.8rem; margin-bottom: 1.5rem; }
    .stat { background: #f9fafb; padding: 0.8rem; border-radius: 6px; border: 1px solid #eaecf0; }
    .stat .label { font-size: 0.75rem; color: #667085; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat .value { font-size: 1.4rem; font-weight: 600; color: #101828; }
  </style>
</head>
<body>
  <nav class="main">
    <h1>📦 Valiz Sync</h1>
    <a href="/admin/ui" class="${active === 'skus' ? 'active' : ''}">SKUs</a>
    <a href="/admin/ui/overrides" class="${active === 'overrides' ? 'active' : ''}">Overrides</a>
    <a href="/admin/ui/operations" class="${active === 'ops' ? 'active' : ''}">Operaciones</a>
  </nav>
  <main class="container-fluid">
    ${content}
  </main>
</body>
</html>`;
}
