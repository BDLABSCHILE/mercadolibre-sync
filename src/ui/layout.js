/**
 * Layout HTML del dashboard Valiz Sync.
 * Stack: Tailwind CSS via CDN + HTMX + iconos Lucide inline.
 * Diseño: SaaS premium estilo Linear/Vercel. Paleta BDLABS azul + cobre.
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

// ============ ICONOS LUCIDE INLINE ============
export const ICON = {
  box: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
  sliders: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/></svg>`,
  settings: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  search: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  alertTriangle: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
  check: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  link: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  unlink: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"/><line x1="8" x2="8" y1="2" y2="5"/><line x1="2" x2="5" y1="8" y2="8"/><line x1="16" x2="16" y1="19" y2="22"/><line x1="19" x2="22" y1="16" y2="16"/></svg>`,
  edit: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  x: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  plus: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
  zap: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  trendingUp: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`,
  refresh: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`,
};

// ============ BD LABS LOGO (SVG inline) ============
// Diseño basado en el logo original de Benja: { B [columna tipográfica] D }
//   - Curly braces representan código/programación
//   - B y D iniciales con stroke fino (sans-serif outlined)
//   - Columna central: dot + serif top + </> + serif bottom + dot
//     (anatomía de letras "i" y "j" partidas por el code tag → "craft + code")
//   - Acentos cobre en los dots, todo lo demás en azul profundo
//   - Monoline, escalable, sin dependencia de PNG.
export const BDLABS_LOGO_SVG = `<svg viewBox="0 0 220 150" xmlns="http://www.w3.org/2000/svg"
  fill="none" stroke="#1E3A8A" stroke-width="2.2"
  stroke-linecap="round" stroke-linejoin="round"
  aria-label="BD LABS" class="h-10 w-auto">

  <!-- Left curly brace { -->
  <path d="M 50 28 Q 30 28 30 48 L 30 70 Q 30 76 18 76 Q 30 76 30 82 L 30 104 Q 30 124 50 124"/>

  <!-- B letter (outlined, thin sans-serif) -->
  <g>
    <line x1="64" y1="60" x2="64" y2="100"/>
    <path d="M 64 60 L 80 60 Q 88 60 88 68 Q 88 76 80 76 L 64 76"/>
    <path d="M 64 78 L 82 78 Q 92 78 92 89 Q 92 100 82 100 L 64 100"/>
  </g>

  <!-- Center column: typographic flourish -->
  <!-- Top dot (i tittle) - copper accent -->
  <circle cx="110" cy="14" r="2.6" fill="#EA580C" stroke="none"/>

  <!-- Top serif (anatomy of letter "i" - cap with feet) -->
  <line x1="100" y1="30" x2="120" y2="30"/>
  <line x1="110" y1="30" x2="110" y2="44"/>
  <line x1="101" y1="27" x2="101" y2="33"/>
  <line x1="119" y1="27" x2="119" y2="33"/>

  <!-- </> code tag in middle -->
  <g stroke-width="2">
    <polyline points="100 58 88 76 100 94"/>
    <line x1="106" y1="96" x2="116" y2="56"/>
    <polyline points="122 58 134 76 122 94"/>
  </g>

  <!-- Bottom serif (anatomy of letter "j" - hook with dot below) -->
  <path d="M 102 108 L 102 122 Q 102 132 110 132 Q 118 132 118 122 L 118 108"/>

  <!-- Bottom dot (j tittle) - copper accent -->
  <circle cx="110" cy="142" r="2.6" fill="#EA580C" stroke="none"/>

  <!-- D letter (outlined) -->
  <g>
    <line x1="146" y1="60" x2="146" y2="100"/>
    <path d="M 146 60 L 162 60 Q 178 60 178 80 Q 178 100 162 100 L 146 100"/>
  </g>

  <!-- Right curly brace } -->
  <path d="M 170 28 Q 190 28 190 48 L 190 70 Q 190 76 202 76 Q 190 76 190 82 L 190 104 Q 190 124 170 124"/>
</svg>`;

// Versión compacta (sólo braces + B y D, sin columna central) — para footer/favicon/mobile.
export const BDLABS_MARK_SVG = `<svg viewBox="0 0 120 100" xmlns="http://www.w3.org/2000/svg"
  fill="none" stroke="#1E3A8A" stroke-width="2.4"
  stroke-linecap="round" stroke-linejoin="round"
  aria-label="BD LABS" class="h-6 w-auto">
  <!-- Left brace -->
  <path d="M 30 12 Q 14 12 14 28 L 14 44 Q 14 49 6 49 Q 14 49 14 54 L 14 70 Q 14 86 30 86"/>
  <!-- B -->
  <g>
    <line x1="40" y1="36" x2="40" y2="64"/>
    <path d="M 40 36 L 52 36 Q 58 36 58 42 Q 58 48 52 48 L 40 48"/>
    <path d="M 40 50 L 54 50 Q 60 50 60 57 Q 60 64 54 64 L 40 64"/>
  </g>
  <!-- D -->
  <g>
    <line x1="68" y1="36" x2="68" y2="64"/>
    <path d="M 68 36 L 80 36 Q 92 36 92 50 Q 92 64 80 64 L 68 64"/>
  </g>
  <!-- Right brace -->
  <path d="M 90 12 Q 106 12 106 28 L 106 44 Q 106 49 114 49 Q 106 49 106 54 L 106 70 Q 106 86 90 86"/>
  <!-- Copper accent dots (top + bottom small) -->
  <circle cx="60" cy="6" r="2" fill="#EA580C" stroke="none"/>
  <circle cx="60" cy="94" r="2" fill="#EA580C" stroke="none"/>
</svg>`;

const TAILWIND_CDN = 'https://cdn.tailwindcss.com';
const HTMX_CDN = 'https://unpkg.com/htmx.org@1.9.12';
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap';

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
  <script src="${TAILWIND_CDN}"></script>
  <script src="${HTMX_CDN}" defer></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            // BDLABS brand
            brand: {
              50: '#EFF6FF', 100: '#DBEAFE', 200: '#BFDBFE', 300: '#93C5FD',
              400: '#60A5FA', 500: '#3B82F6', 600: '#2563EB', 700: '#1D4ED8',
              800: '#1E40AF', 900: '#1E3A8A', 950: '#0F1E4F',
            },
            copper: {
              50: '#FFF7ED', 100: '#FFEDD5', 200: '#FED7AA', 300: '#FDBA74',
              400: '#FB923C', 500: '#F97316', 600: '#EA580C', 700: '#C2410C',
              800: '#9A3412', 900: '#7C2D12',
            },
            ink: { DEFAULT: '#0F172A', soft: '#334155', muted: '#64748B', mute: '#94A3B8' },
            line: { DEFAULT: '#E2E8F0', soft: '#F1F5F9' },
          },
          fontFamily: {
            sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
            mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
          },
          boxShadow: {
            'soft': '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)',
            'card': '0 1px 3px rgba(15, 23, 42, 0.06), 0 4px 12px rgba(15, 23, 42, 0.04)',
            'lift': '0 10px 20px rgba(15, 23, 42, 0.08), 0 4px 8px rgba(15, 23, 42, 0.04)',
            'brand': '0 4px 14px rgba(37, 99, 235, 0.25)',
          },
        },
      },
    };
  </script>
  <style>
    body { font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
    .font-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

    /* Animation for connection dots in header */
    @keyframes pulse-dot {
      0%, 100% { opacity: 0.4; transform: scale(1); }
      50% { opacity: 1; transform: scale(1.15); }
    }
    .connection-dot { animation: pulse-dot 2s ease-in-out infinite; }
    .connection-dot:nth-child(2) { animation-delay: 0.5s; }
    .connection-dot:nth-child(3) { animation-delay: 1s; }

    /* Connection line gradient */
    .connection-line {
      background: linear-gradient(90deg, transparent 0%, #CBD5E1 20%, #CBD5E1 80%, transparent 100%);
    }

    /* HTMX loading indicator */
    .htmx-indicator { opacity: 0; transition: opacity 0.2s; }
    .htmx-request .htmx-indicator { opacity: 1; }

    /* Scrollbar polish */
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 5px; border: 2px solid transparent; background-clip: padding-box; }
    ::-webkit-scrollbar-thumb:hover { background: #94A3B8; background-clip: padding-box; }

    /* Dialog backdrop */
    dialog::backdrop { background: rgba(15, 23, 42, 0.5); backdrop-filter: blur(4px); }
    dialog[open] { animation: dialog-fade 0.18s ease-out; }
    @keyframes dialog-fade {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Subtle row hover */
    tbody tr { transition: background-color 0.12s; }
  </style>
</head>
<body class="bg-slate-50 text-ink min-h-screen flex flex-col">

  <!-- ============ HEADER ============ -->
  <header class="bg-white border-b border-line">
    <div class="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
      <!-- Brand: Valiz logo (sin fondo, flota) + title -->
      <div class="flex items-center gap-3">
        <img src="/assets/valiz.png" alt="Valiz" class="h-10 w-auto"
          onerror="this.outerHTML='<span class=\\'text-ink font-bold text-2xl\\'>V</span>'">
        <div>
          <h1 class="text-xl font-bold text-ink tracking-tight">Valiz <span class="text-brand-600">Sync</span></h1>
          <p class="text-xs text-ink-muted -mt-0.5">Stock & price sync · 3 canales</p>
        </div>
      </div>

      <!-- Connected channels (creative integration) -->
      <div class="hidden md:flex items-center gap-1 px-4 py-2 bg-slate-50 rounded-xl border border-line">
        <span class="text-[10px] uppercase tracking-wider text-ink-muted font-semibold mr-3">Connected</span>
        <div class="flex items-center gap-2">
          <div class="relative group">
            <div class="w-8 h-8 rounded-lg bg-white border border-line flex items-center justify-center shadow-soft hover:shadow-card transition-all overflow-hidden">
              <img src="/assets/shopify.png" alt="Shopify" class="w-6 h-6 object-contain"
                onerror="this.outerHTML='<span class=\\'text-[10px] font-bold text-emerald-600\\'>SH</span>'">
            </div>
            <span class="connection-dot absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500"></span>
          </div>
          <div class="w-6 h-px connection-line"></div>
          <div class="relative group">
            <div class="w-8 h-8 rounded-lg bg-white border border-line flex items-center justify-center shadow-soft hover:shadow-card transition-all overflow-hidden">
              <img src="/assets/mercadolibre.png" alt="ML" class="w-6 h-6 object-contain"
                onerror="this.outerHTML='<span class=\\'text-[10px] font-bold\\'>ML</span>'">
            </div>
            <span class="connection-dot absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500"></span>
          </div>
          <div class="w-6 h-px connection-line"></div>
          <div class="relative group">
            <div class="w-8 h-8 rounded-lg bg-white border border-line flex items-center justify-center shadow-soft hover:shadow-card transition-all overflow-hidden">
              <img src="/assets/falabella.png" alt="Falabella" class="w-6 h-6 object-contain"
                onerror="this.outerHTML='<span class=\\'text-[10px] font-bold\\'>FB</span>'">
            </div>
            <span class="connection-dot absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500"></span>
          </div>
        </div>
      </div>

      <!-- BDLABS badge (PNG negro sobre header blanco para máximo contraste) -->
      <div class="flex items-center gap-2 text-xs text-ink-muted">
        <span class="hidden sm:inline">Powered by</span>
        <a href="#" class="hover:opacity-80 transition-opacity flex items-center" title="BD LABS">
          <img src="/assets/bdlabs-negro.png" alt="BD LABS" class="h-14 w-auto"
            onerror="this.outerHTML='<span class=\\'font-bold text-ink-soft tracking-tight\\'>BD<span class=\\'text-copper-600 font-semibold tracking-widest ml-0.5\\'>LABS</span></span>'">
        </a>
      </div>
    </div>

    <!-- ============ NAV TABS ============ -->
    <nav class="max-w-screen-2xl mx-auto px-6 flex items-center gap-1 border-t border-line bg-white">
      ${navTab('/admin/ui', 'SKUs', ICON.box, active === 'skus')}
      ${navTab('/admin/ui/overrides', 'Ajustes manuales', ICON.sliders, active === 'overrides')}
      ${navTab('/admin/ui/operations', 'Operaciones', ICON.settings, active === 'ops')}
    </nav>
  </header>

  <!-- ============ MAIN ============ -->
  <main class="flex-1 max-w-screen-2xl mx-auto w-full px-6 py-6">
    ${content}
  </main>

  <!-- ============ FOOTER ============ -->
  <footer class="border-t border-line bg-white">
    <div class="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between text-xs text-ink-muted">
      <div class="flex items-center gap-4">
        <span class="flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 connection-dot"></span>
          Sistema operativo
        </span>
        <span class="text-line">·</span>
        <span>Sync automático activo</span>
      </div>
      <div class="flex items-center gap-3">
        <span>Valiz Sync · Designed & built by</span>
        <a href="#" class="hover:opacity-80 transition-opacity flex items-center" title="BD LABS">
          <img src="/assets/bdlabs-negro.png" alt="BD LABS" class="h-16 w-auto"
            onerror="this.outerHTML='<span class=\\'font-bold text-ink-soft tracking-tight\\'>BD<span class=\\'text-copper-600 font-semibold tracking-widest ml-0.5\\'>LABS</span></span>'">
        </a>
      </div>
    </div>
  </footer>

</body>
</html>`;
}

function navTab(href, label, icon, isActive) {
  return `
    <a href="${href}" class="${isActive
      ? 'border-brand-600 text-brand-700 font-semibold'
      : 'border-transparent text-ink-muted hover:text-ink hover:border-line'} flex items-center gap-2 px-4 py-3 border-b-2 -mb-px text-sm transition-colors">
      ${icon}
      <span>${label}</span>
    </a>
  `;
}
