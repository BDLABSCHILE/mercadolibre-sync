/**
 * Layout HTML del dashboard Valiz.
 * Paleta cuero/marrón/crema. Tipografía: Cormorant Garamond (serif) + Inter (sans).
 */

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

// Logos: SVG inline para ML y Falabella (control total, sin dependencias externas).
// El logo Valiz se sirve desde /assets/valiz.{png,svg} si está disponible.
export const ML_LOGO = `<svg viewBox="0 0 28 28" width="22" height="22" xmlns="http://www.w3.org/2000/svg" aria-label="MercadoLibre"><circle cx="14" cy="14" r="14" fill="#FFE600"/><path d="M7 16.5c1.2-2.1 4-3.5 7-3.5s5.8 1.4 7 3.5c-.5-1.7-3.2-3-7-3s-6.5 1.3-7 3z" fill="#2D3277"/><circle cx="9" cy="11" r="1.2" fill="#2D3277"/><circle cx="19" cy="11" r="1.2" fill="#2D3277"/></svg>`;

export const FB_LOGO = `<svg viewBox="0 0 28 28" width="22" height="22" xmlns="http://www.w3.org/2000/svg" aria-label="Falabella"><rect width="28" height="28" rx="4" fill="#00833F"/><text x="14" y="19" font-family="Inter, sans-serif" font-size="11" font-weight="700" fill="white" text-anchor="middle" letter-spacing="-0.5">FL</text></svg>`;

const FONTS = `https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap`;
const HTMX_CDN = 'https://unpkg.com/htmx.org@1.9.12';

export function layout({ title, content, active = '' }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} · Valiz Sync</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${FONTS}">
  <script src="${HTMX_CDN}" defer></script>
  <style>
    /* ============ PALETA CUERO/CRÉMA ============ */
    :root {
      --cream: #FAF5EE;
      --cream-soft: #F5EDE0;
      --beige: #E8DDC9;
      --beige-strong: #D4C4A8;
      --leather: #5C3A1E;
      --leather-deep: #3D2914;
      --leather-soft: #8B6240;
      --gold: #B8860B;
      --gold-soft: #D4A847;
      --ink: #1F1611;
      --ink-soft: #5C3A1E;
      --muted: #8A7460;

      --success: #3E7C47;
      --success-soft: #DEF0DE;
      --warning: #B8860B;
      --warning-soft: #FAEFCC;
      --danger: #A0522D;
      --danger-soft: #F6E0D6;
      --info: #4A6B82;
      --info-soft: #DDE7EE;

      --radius: 8px;
      --radius-sm: 5px;
      --shadow-sm: 0 1px 2px rgba(31, 22, 17, 0.06), 0 1px 3px rgba(31, 22, 17, 0.04);
      --shadow-md: 0 4px 8px rgba(31, 22, 17, 0.08), 0 2px 4px rgba(31, 22, 17, 0.04);
      --shadow-lg: 0 12px 24px rgba(31, 22, 17, 0.12), 0 4px 8px rgba(31, 22, 17, 0.06);
    }

    /* ============ RESET + BASE ============ */
    *, *::before, *::after { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: var(--ink);
      background: var(--cream);
      -webkit-font-smoothing: antialiased;
    }
    h1, h2, h3, h4 { font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; color: var(--leather-deep); margin: 0; line-height: 1.2; }
    h1 { font-size: 2.2rem; letter-spacing: -0.02em; }
    h2 { font-size: 1.8rem; margin-bottom: 0.5rem; letter-spacing: -0.01em; }
    h3 { font-size: 1.4rem; }
    h4 { font-size: 1.1rem; font-family: 'Inter', sans-serif; font-weight: 600; color: var(--leather); margin-top: 1.2rem; margin-bottom: 0.6rem; }
    p { margin: 0 0 0.8rem; }
    a { color: var(--leather); text-decoration: none; transition: color 0.15s; }
    a:hover { color: var(--gold); }

    /* ============ NAVBAR ============ */
    nav.main {
      background: var(--leather-deep);
      color: var(--cream);
      padding: 0;
      box-shadow: var(--shadow-md);
      position: sticky;
      top: 0;
      z-index: 50;
    }
    nav.main .nav-inner {
      max-width: 1600px;
      margin: 0 auto;
      padding: 0.9rem 2rem;
      display: flex;
      align-items: center;
      gap: 2rem;
    }
    nav.main .brand {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      font-family: 'Cormorant Garamond', serif;
      font-weight: 700;
      font-size: 1.5rem;
      color: var(--cream);
      letter-spacing: 0.01em;
    }
    nav.main .brand img {
      height: 36px;
      width: auto;
      filter: brightness(0) invert(1);
      opacity: 0.95;
    }
    nav.main .brand .brand-fallback {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: var(--gold);
      color: var(--leather-deep);
      font-weight: 700;
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.4rem;
    }
    nav.main .links { display: flex; gap: 0.4rem; flex: 1; }
    nav.main .links a {
      color: var(--cream);
      padding: 0.4rem 0.9rem;
      border-radius: var(--radius-sm);
      opacity: 0.7;
      font-weight: 500;
      transition: all 0.15s;
    }
    nav.main .links a:hover { opacity: 1; background: rgba(255,255,255,0.08); }
    nav.main .links a.active { opacity: 1; background: rgba(255,255,255,0.12); color: var(--gold-soft); }
    nav.main .platforms { display: flex; gap: 0.7rem; align-items: center; }
    nav.main .platforms .pill {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(255,255,255,0.06);
      padding: 0.3rem 0.8rem 0.3rem 0.4rem;
      border-radius: 20px;
      font-size: 0.75rem;
      opacity: 0.95;
    }
    .platform-logo {
      height: 22px;
      width: 22px;
      object-fit: contain;
      border-radius: 50%;
      background: white;
      padding: 2px;
    }

    /* ============ MAIN ============ */
    main.container {
      max-width: 1600px;
      margin: 0 auto;
      padding: 2rem;
    }
    .page-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--beige);
    }
    .page-header .small { color: var(--muted); font-size: 0.9rem; font-family: 'Inter', sans-serif; }

    /* ============ STATS ============ */
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat {
      background: white;
      border: 1px solid var(--beige);
      padding: 1rem 1.2rem;
      border-radius: var(--radius);
      box-shadow: var(--shadow-sm);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .stat:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
    .stat .label {
      font-size: 0.7rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 600;
      margin-bottom: 0.3rem;
    }
    .stat .value {
      font-family: 'Cormorant Garamond', serif;
      font-size: 2rem;
      font-weight: 700;
      color: var(--leather-deep);
      line-height: 1;
    }
    .stat.accent { background: linear-gradient(135deg, var(--gold) 0%, var(--gold-soft) 100%); border-color: var(--gold); }
    .stat.accent .label, .stat.accent .value { color: var(--leather-deep); }

    /* ============ TOOLBAR ============ */
    .toolbar {
      display: flex;
      gap: 0.7rem;
      align-items: center;
      margin-bottom: 1.2rem;
      padding: 1rem;
      background: white;
      border: 1px solid var(--beige);
      border-radius: var(--radius);
      flex-wrap: wrap;
      box-shadow: var(--shadow-sm);
    }
    .toolbar input, .toolbar select {
      margin: 0;
      padding: 0.5rem 0.8rem;
      border: 1px solid var(--beige-strong);
      border-radius: var(--radius-sm);
      background: var(--cream-soft);
      font-family: inherit;
      font-size: 0.9rem;
      color: var(--ink);
      transition: border-color 0.15s, background 0.15s;
    }
    .toolbar input:focus, .toolbar select:focus {
      outline: none;
      border-color: var(--leather);
      background: white;
    }
    .toolbar input[type="search"] { flex: 1; min-width: 220px; }

    /* ============ TABLE ============ */
    .table-wrap {
      background: white;
      border: 1px solid var(--beige);
      border-radius: var(--radius);
      overflow: hidden;
      box-shadow: var(--shadow-sm);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    table th {
      background: var(--cream-soft);
      padding: 0.75rem 0.9rem;
      text-align: left;
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      border-bottom: 1px solid var(--beige);
      white-space: nowrap;
    }
    table td {
      padding: 0.7rem 0.9rem;
      border-bottom: 1px solid var(--cream-soft);
      vertical-align: middle;
    }
    table tbody tr { transition: background 0.1s; }
    table tbody tr:hover { background: var(--cream-soft); }
    table tbody tr:last-child td { border-bottom: none; }

    /* ============ BADGES ============ */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.15rem 0.55rem;
      border-radius: 11px;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      line-height: 1.4;
    }
    .badge.ok { background: var(--success-soft); color: var(--success); }
    .badge.warn { background: var(--warning-soft); color: var(--warning); }
    .badge.err { background: var(--danger-soft); color: var(--danger); }
    .badge.info { background: var(--info-soft); color: var(--info); }
    .badge.dim { background: var(--cream-soft); color: var(--muted); border: 1px solid var(--beige); }
    .badge.ml {
      background: #FFE600;
      color: #2D3277;
      padding-left: 0.3rem;
    }
    .badge.ml::before {
      content: '';
      display: inline-block;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #2D3277;
    }
    .badge.fb {
      background: var(--success);
      color: white;
    }

    /* ============ BUTTONS ============ */
    button, .btn {
      padding: 0.5rem 1rem;
      border-radius: var(--radius-sm);
      border: 1px solid transparent;
      background: var(--leather);
      color: white;
      font-family: inherit;
      font-size: 0.88rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }
    button:hover, .btn:hover { background: var(--leather-deep); transform: translateY(-1px); box-shadow: var(--shadow-sm); }
    button:active { transform: translateY(0); }

    button.ghost {
      background: transparent;
      color: var(--leather);
      border: 1px solid var(--beige-strong);
    }
    button.ghost:hover { background: var(--cream-soft); color: var(--leather-deep); border-color: var(--leather-soft); }

    button.danger { background: var(--danger); border-color: var(--danger); }
    button.danger:hover { background: #864121; }

    button.accent { background: var(--gold); color: var(--leather-deep); }
    button.accent:hover { background: var(--gold-soft); }

    button.icon {
      padding: 0.35rem 0.55rem;
      font-size: 0.95rem;
    }

    /* ============ DIALOG / MODAL ============ */
    dialog {
      max-width: 720px;
      width: 90%;
      border: none;
      border-radius: var(--radius);
      padding: 0;
      box-shadow: var(--shadow-lg);
      background: var(--cream);
    }
    dialog::backdrop { background: rgba(31, 22, 17, 0.5); backdrop-filter: blur(2px); }
    dialog article {
      padding: 1.8rem 2rem;
    }
    dialog header {
      padding-bottom: 1rem;
      margin-bottom: 1rem;
      border-bottom: 1px solid var(--beige);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    dialog header strong {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.6rem;
      font-weight: 600;
      color: var(--leather-deep);
    }
    dialog .close {
      background: none;
      border: none;
      color: var(--muted);
      padding: 0.3rem;
      cursor: pointer;
      font-size: 1.4rem;
      line-height: 1;
    }
    dialog .close::before { content: '×'; }
    dialog .close:hover { color: var(--leather-deep); }
    dialog footer {
      padding-top: 1rem;
      margin-top: 1.5rem;
      border-top: 1px solid var(--beige);
      display: flex;
      gap: 0.6rem;
      justify-content: flex-end;
    }

    /* ============ FORMS ============ */
    form label {
      display: block;
      margin-bottom: 0.9rem;
      font-size: 0.85rem;
      color: var(--ink-soft);
      font-weight: 500;
    }
    form input, form select, form textarea {
      width: 100%;
      padding: 0.55rem 0.8rem;
      margin-top: 0.3rem;
      border: 1px solid var(--beige-strong);
      border-radius: var(--radius-sm);
      background: white;
      font-family: inherit;
      font-size: 0.9rem;
      color: var(--ink);
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    form input:focus, form select:focus {
      outline: none;
      border-color: var(--leather);
      box-shadow: 0 0 0 3px rgba(92, 58, 30, 0.1);
    }
    form .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }
    details {
      margin: 1rem 0;
      padding: 0.7rem 1rem;
      background: var(--cream-soft);
      border-radius: var(--radius-sm);
      border: 1px solid var(--beige);
    }
    details summary {
      cursor: pointer;
      font-weight: 500;
      color: var(--leather);
      font-size: 0.85rem;
    }
    details summary:hover { color: var(--leather-deep); }
    details[open] summary { margin-bottom: 0.7rem; }

    /* ============ UTILITY ============ */
    .small { font-size: 0.8rem; color: var(--muted); }
    .right { text-align: right; }
    .mono { font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace; font-size: 0.85em; }
    .truncate { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .empty {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--muted);
      font-style: italic;
    }

    /* ============ BANNERS ============ */
    .banner {
      padding: 0.9rem 1.2rem;
      border-radius: var(--radius-sm);
      margin-bottom: 1.2rem;
      font-size: 0.9rem;
      border-left: 4px solid;
    }
    .banner.success { background: var(--success-soft); border-color: var(--success); color: #205A30; }
    .banner.warn { background: var(--warning-soft); border-color: var(--warning); color: #6B5005; }
    .banner.info { background: var(--info-soft); border-color: var(--info); color: #2A4759; }

    /* ============ ARTICLE / CARD ============ */
    article {
      background: white;
      border: 1px solid var(--beige);
      border-radius: var(--radius);
      padding: 1.2rem 1.4rem;
      margin-bottom: 1rem;
      box-shadow: var(--shadow-sm);
    }
    article header {
      padding-bottom: 0.7rem;
      margin-bottom: 0.7rem;
      border-bottom: 1px solid var(--cream-soft);
      font-weight: 600;
      color: var(--leather-deep);
    }

    /* ============ PRICE DISPLAY ============ */
    .price {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-weight: 600;
      color: var(--leather-deep);
    }
    .price-cell {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }
  </style>
</head>
<body>
  <nav class="main">
    <div class="nav-inner">
      <div class="brand">
        <img src="/assets/valiz.png" alt="Valiz" onerror="this.outerHTML='<span class=brand-fallback>V</span>'">
        <span>Valiz Sync</span>
      </div>
      <div class="links">
        <a href="/admin/ui" class="${active === 'skus' ? 'active' : ''}">SKUs</a>
        <a href="/admin/ui/overrides" class="${active === 'overrides' ? 'active' : ''}">Overrides</a>
        <a href="/admin/ui/operations" class="${active === 'ops' ? 'active' : ''}">Operaciones</a>
      </div>
      <div class="platforms">
        <span class="pill" title="MercadoLibre conectado">
          <img src="/assets/mercadolibre.png" alt="ML" class="platform-logo" onerror="this.outerHTML='${ML_LOGO.replace(/"/g, '\\"').replace(/'/g, "\\'")}'">
          <span>MercadoLibre</span>
        </span>
        <span class="pill" title="Falabella conectado">
          <img src="/assets/falabella.png" alt="Falabella" class="platform-logo" onerror="this.outerHTML='${FB_LOGO.replace(/"/g, '\\"').replace(/'/g, "\\'")}'">
          <span>Falabella</span>
        </span>
      </div>
    </div>
  </nav>
  <main class="container">
    ${content}
  </main>
</body>
</html>`;
}
