/**
 * Vistas HTML del dashboard Valiz Sync.
 * Tailwind utility classes + componentes inline.
 */

import { esc, fmtCLP, ICON } from './layout.js';

/* ============ PÁGINA PRINCIPAL: TABLA DE SKUs ============ */

export function skusTable(rows, filters = {}) {
  const stats = {
    total: rows.length,
    withMlOverride: rows.filter((r) => r.mlOverride).length,
    withFbOverride: rows.filter((r) => r.fbOverride).length,
    drift: rows.filter(
      (r) => (r.targetMl != null && r.mlSynced != null && r.targetMl !== r.mlSynced)
        || (r.targetFb != null && r.fbSynced != null && r.targetFb !== r.fbSynced),
    ).length,
  };

  const familyOptions = [...new Set(rows.map((r) => r.family).filter(Boolean))].sort();

  return `
    <!-- Page header -->
    <div class="flex items-end justify-between mb-6 pb-4 border-b border-line">
      <div>
        <h2 class="text-2xl font-bold text-ink tracking-tight">Catálogo de SKUs</h2>
        <p class="text-sm text-ink-muted mt-1">${stats.total} productos sincronizados entre Shopify, MercadoLibre y Falabella</p>
      </div>
      <span class="text-xs text-ink-muted font-medium">${stats.total} visibles</span>
    </div>

    <!-- Stats grid -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${statCard({
        label: 'Total SKUs',
        value: stats.total,
        icon: ICON.box,
        accent: 'brand',
      })}
      ${statCard({
        label: 'Con ajuste MercadoLibre',
        value: stats.withMlOverride,
        icon: ICON.sliders,
        accent: 'yellow',
        sublabel: 'Reglas activas',
      })}
      ${statCard({
        label: 'Con ajuste Falabella',
        value: stats.withFbOverride,
        icon: ICON.sliders,
        accent: 'emerald',
        sublabel: 'Reglas activas',
      })}
      ${statCard({
        label: 'Drift detectado',
        value: stats.drift,
        icon: ICON.alertTriangle,
        accent: stats.drift > 0 ? 'copper' : 'slate',
        sublabel: stats.drift > 0 ? 'Requiere atención' : 'Todo sincronizado',
      })}
    </div>

    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-2 mb-4">
      <form id="skus-filter-form" class="bg-white rounded-xl border border-line p-3 flex flex-wrap items-center gap-2 shadow-soft flex-1"
            hx-get="/admin/ui/skus" hx-target="#skus-table-wrap" hx-swap="innerHTML"
            hx-trigger="change from:select, keyup changed delay:300ms from:input">
        <div class="relative flex-1 min-w-[220px]">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute">${ICON.search}</span>
          <input type="search" name="search" placeholder="Buscar SKU o nombre de producto..."
                 value="${esc(filters.search || '')}"
                 class="w-full pl-9 pr-3 py-2 bg-slate-50 border border-line rounded-lg text-sm placeholder:text-ink-mute focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 focus:bg-white transition-all">
        </div>
        ${selectFilter('family', filters.family, [['', 'Todas las familias'], ...familyOptions.map((f) => [f, f])])}
        ${selectFilter('hasOverride', filters.hasOverride, [['', 'Ajuste: cualquiera'], ['yes', 'Con ajuste'], ['no', 'Sin ajuste']])}
        ${selectFilter('hasDrift', filters.hasDrift, [['', 'Drift: cualquiera'], ['yes', 'Solo con drift']])}
      </form>
      <button type="button"
              hx-get="/admin/ui/skus" hx-include="#skus-filter-form" hx-vals='{"liveStock":"1"}'
              hx-target="#skus-table-wrap" hx-swap="innerHTML" hx-disabled-elt="this"
              class="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-xl shadow-brand transition-all disabled:opacity-60"
              title="Trae el stock real de MercadoLibre y Falabella ahora (puede tardar unos segundos)">
        <span class="htmx-indicator-hide">${ICON.refresh}</span>
        <span>Stock en vivo</span>
        <span class="htmx-indicator text-xs">·••</span>
      </button>
    </div>

    <!-- Table -->
    <div id="skus-table-wrap">
      ${skusTableInner(rows, filters)}
    </div>

    <dialog id="override-dialog" class="rounded-2xl shadow-lift border border-line p-0 max-w-3xl w-full backdrop:bg-ink/40"></dialog>
  `;
}

function statCard({ label, value, icon, accent = 'slate', sublabel = '' }) {
  const accentBg = {
    brand: 'from-brand-50 to-white', yellow: 'from-amber-50 to-white',
    emerald: 'from-emerald-50 to-white', copper: 'from-copper-50 to-white',
    slate: 'from-slate-50 to-white',
  }[accent];
  const accentText = {
    brand: 'text-brand-600', yellow: 'text-amber-600',
    emerald: 'text-emerald-600', copper: 'text-copper-600',
    slate: 'text-slate-500',
  }[accent];
  const accentBorder = {
    brand: 'border-brand-100', yellow: 'border-amber-100',
    emerald: 'border-emerald-100', copper: 'border-copper-100',
    slate: 'border-line',
  }[accent];

  return `
    <div class="relative bg-gradient-to-br ${accentBg} rounded-xl border ${accentBorder} p-4 shadow-soft hover:shadow-card transition-all">
      <div class="flex items-start justify-between mb-3">
        <span class="text-[11px] uppercase tracking-wider font-semibold text-ink-muted">${label}</span>
        <span class="${accentText} bg-white p-2 rounded-lg shadow-soft">${icon}</span>
      </div>
      <div class="text-3xl font-bold text-ink tracking-tight">${value}</div>
      ${sublabel ? `<p class="text-xs ${accentText} font-medium mt-1">${sublabel}</p>` : ''}
    </div>
  `;
}

function selectFilter(name, current, options) {
  return `
    <select name="${name}"
            class="px-3 py-2 bg-slate-50 border border-line rounded-lg text-sm font-medium text-ink-soft focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-all cursor-pointer">
      ${options.map(([val, label]) => `<option value="${esc(val)}" ${current === val ? 'selected' : ''}>${esc(label)}</option>`).join('')}
    </select>
  `;
}

export function skusTableInner(rows, filters = {}) {
  if (rows.length === 0) {
    return `
      <div class="bg-white rounded-xl border border-line p-16 text-center shadow-soft">
        <span class="inline-block text-ink-mute mb-2">${ICON.box}</span>
        <p class="text-ink-muted italic">No hay SKUs que coincidan con el filtro</p>
      </div>
    `;
  }
  const stockBanner = filters.liveStock
    ? `<div class="px-4 py-2 bg-emerald-50 border-b border-emerald-100 text-[12px] text-emerald-800 flex items-center gap-2">
         <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 connection-dot"></span>
         <strong class="font-semibold">Stock en vivo</strong> — traído directo de MercadoLibre y Falabella recién. El precio muestra el target; el stock muestra el real de cada canal.
       </div>`
    : `<div class="px-4 py-2 bg-slate-50 border-b border-line text-[12px] text-ink-muted flex items-center gap-2">
         <span>Stock de ML/Falabella = último sincronizado (de la base). Usá <strong class="text-ink-soft">"Stock en vivo"</strong> para traer el real ahora.</span>
       </div>`;
  return `
    <div class="bg-white rounded-xl border border-line shadow-soft overflow-hidden">
      ${stockBanner}
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-slate-50/80 border-b border-line">
            <tr>
              <th class="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">SKU</th>
              <th class="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Producto</th>
              <th class="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Familia</th>
              <th class="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Shopify<span class="block text-[9px] font-normal normal-case tracking-normal text-ink-mute">precio · stock</span></th>
              <th class="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Target base</th>
              <th class="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">MercadoLibre<span class="block text-[9px] font-normal normal-case tracking-normal text-ink-mute">precio · stock</span></th>
              <th class="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Falabella<span class="block text-[9px] font-normal normal-case tracking-normal text-ink-mute">precio · stock</span></th>
              <th class="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Ajustes</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line/60">
            ${rows.map((r) => skuRow(r)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function skuRow(r) {
  return `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3"><span class="font-mono text-[13px] font-semibold text-ink">${esc(r.sku)}</span></td>
      <td class="px-4 py-3 max-w-[240px] truncate text-ink-soft" title="${esc(r.productTitle || '')}">${esc(r.productTitle || '—')}</td>
      <td class="px-4 py-3">
        ${r.family ? `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-ink-muted text-xs font-medium">${esc(r.family)}</span>` : ''}
      </td>
      <td class="px-4 py-3 text-right">
        <div class="flex flex-col items-end gap-0.5">
          <span class="font-mono text-[13px] font-semibold text-ink">${fmtCLP(r.shopifyPrice)}</span>
          ${stockChip(r.shopifyStock, { tone: 'shopify' })}
        </div>
      </td>
      <td class="px-4 py-3 text-right font-mono text-xs text-ink-muted">${fmtCLP(r.targetBase)}</td>
      <td class="px-4 py-3 text-right">${platformCell(r, 'ml')}</td>
      <td class="px-4 py-3 text-right">${platformCell(r, 'fb')}</td>
      <td class="px-4 py-3">${overrideBadges(r)}</td>
      <td class="px-4 py-3 text-right">
        <button class="p-1.5 rounded-md text-ink-muted hover:text-brand-700 hover:bg-brand-50 transition-all"
          title="Editar ajustes"
          hx-get="/admin/ui/skus/${encodeURIComponent(r.sku)}/edit"
          hx-target="#override-dialog" hx-swap="innerHTML"
          onclick="document.getElementById('override-dialog').showModal()">
          ${ICON.edit}
        </button>
      </td>
    </tr>
  `;
}

// Icono caja pequeño para stock (inline)
const STOCK_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;

// Chip de stock simple (Shopify): caja + número. Rojo si 0 o menos.
function stockChip(value) {
  if (value == null) return `<span class="inline-flex items-center gap-1 text-[11px] text-ink-mute">${STOCK_ICON}<span>—</span></span>`;
  const color = value <= 0 ? 'text-copper-600' : 'text-ink-muted';
  return `<span class="inline-flex items-center gap-1 text-[11px] ${color} font-medium" title="Stock Shopify">${STOCK_ICON}<span>${value} u</span></span>`;
}

// Chip de stock de canal (ML/FB): muestra stock real vs esperado.
function channelStockChip(expected, actual, isLive) {
  if (actual == null) {
    const exp = expected == null ? '—' : `${expected}`;
    const tag = isLive ? 's/dato' : 'no sync';
    return `<span class="inline-flex items-center gap-1 text-[11px] text-ink-mute" title="Esperado ${exp} · sin dato actual">${STOCK_ICON}<span>esp ${exp}</span><span class="px-1 py-0.5 rounded bg-slate-100 text-ink-mute text-[9px]">${tag}</span></span>`;
  }
  const matches = expected != null && actual === expected;
  const tone = actual <= 0 ? 'text-copper-600' : (matches ? 'text-ink-muted' : 'text-copper-700');
  let badge = '';
  if (expected != null && actual !== expected) {
    badge = `<span class="px-1 py-0.5 rounded bg-copper-50 text-copper-700 text-[9px] font-semibold" title="Esperado ${expected}">≠${expected}</span>`;
  } else if (matches) {
    badge = `<span class="inline-flex items-center px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[9px] font-semibold">${ICON.check}</span>`;
  }
  return `<span class="inline-flex items-center gap-1 text-[11px] ${tone} font-medium" title="Stock canal: ${actual}${expected != null ? ' · esperado: ' + expected : ''}">${STOCK_ICON}<span>${actual} u</span>${badge}</span>`;
}

function platformCell(r, kind) {
  const target = kind === 'ml' ? r.targetMl : r.targetFb;
  const synced = kind === 'ml' ? r.mlSynced : r.fbSynced;
  const label = kind === 'ml' ? 'ML' : 'FB';
  const expectedStock = kind === 'ml' ? r.expectedMlStock : r.expectedFbStock;
  const actualStock = kind === 'ml' ? r.mlStock : r.fbStock;

  if (target == null) {
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-ink-mute text-xs">${ICON.unlink}<span>sin link</span></span>`;
  }

  // Fila de precio (target + badge de estado de sincronización)
  let priceRow;
  if (synced == null) {
    priceRow = `<span class="inline-flex items-center justify-end gap-1.5"><span class="font-mono text-[13px] font-semibold text-ink">${fmtCLP(target)}</span><span class="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-ink-mute text-[10px] font-medium">no sync</span></span>`;
  } else if (synced === target) {
    priceRow = `<span class="inline-flex items-center justify-end gap-1.5"><span class="font-mono text-[13px] font-semibold text-ink">${fmtCLP(target)}</span><span class="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-semibold">${ICON.check}</span></span>`;
  } else {
    priceRow = `<span class="inline-flex items-center justify-end gap-1.5"><span class="font-mono text-[13px] font-semibold text-ink">${fmtCLP(target)}</span><span class="inline-flex items-center px-1.5 py-0.5 rounded bg-copper-50 text-copper-700 text-[10px] font-semibold" title="${label} actual: ${fmtCLP(synced)}">drift</span></span>`;
  }

  // Fila de stock (real del canal vs esperado)
  const stockRow = channelStockChip(expectedStock, actualStock, r.stockIsLive);

  return `<div class="flex flex-col items-end gap-1">${priceRow}${stockRow}</div>`;
}

function overrideBadges(r) {
  const parts = [];
  if (r.mlOverride) parts.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold" title="${esc(overrideTooltip(r.mlOverride))}">${ICON.zap}<span>ML</span></span>`);
  if (r.fbOverride) parts.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold" title="${esc(overrideTooltip(r.fbOverride))}">${ICON.zap}<span>FB</span></span>`);
  return parts.length === 0 ? '<span class="text-ink-mute text-xs">—</span>' : `<div class="flex gap-1">${parts.join('')}</div>`;
}

function overrideTooltip(o) {
  if (!o) return '';
  const typeLabel = {
    absolute: 'Precio absoluto',
    discount_fixed: 'Descuento $',
    discount_percent: 'Descuento %',
    custom_markup: 'Markup custom',
  }[o.overrideType] || o.overrideType;
  return `${typeLabel} = ${o.value} (${o.scope}=${o.key})${o.note ? ' · ' + o.note : ''}`;
}

/* ============ MODAL DE EDICIÓN DE SKU ============ */

export function skuEditModal({ sku, family, shopifyPrice, productTitle, targetBase, mlOverride, fbOverride, targetMl, targetFb, mlSiblingsCount = 0, syncStartedFor }) {
  const banner = syncStartedFor
    ? `<div class="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4 flex items-start gap-2 text-sm text-emerald-800">
         <span class="mt-0.5 text-emerald-600">${ICON.check}</span>
         <div>
           <strong class="font-semibold">Ajuste creado.</strong> Sync iniciado para <span class="font-mono">${esc(syncStartedFor)}</span>.
           En ~30 seg los precios estarán actualizados.
         </div>
       </div>`
    : '';

  const mlSiblingsWarning = mlSiblingsCount > 1
    ? `<div class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 text-sm">
         <div class="flex items-start gap-2 text-amber-800">
           <span class="mt-0.5 text-amber-600">${ICON.alertTriangle}</span>
           <div class="flex-1">
             <strong class="font-semibold">Este SKU comparte item ML con ${mlSiblingsCount - 1} hermana(s).</strong>
             <p class="text-amber-700 mt-1">MercadoLibre obliga a que todas las variantes del item tengan el mismo precio.</p>
             <ul class="list-disc ml-5 mt-2 space-y-1 text-amber-800">
               <li>Ajuste al <strong>SKU</strong>: solo afecta Falabella. ML toma el precio más alto.</li>
               <li>Ajuste a la <strong>familia ${esc(family || '')}</strong>: afecta las ${mlSiblingsCount} variantes en ML y Falabella.</li>
             </ul>
           </div>
         </div>
       </div>`
    : '';

  return `
    <article class="bg-white rounded-2xl">
      <!-- Modal header -->
      <header class="flex items-center justify-between px-6 py-4 border-b border-line">
        <div>
          <div class="flex items-center gap-2">
            <span class="font-mono text-lg font-bold text-ink">${esc(sku)}</span>
            ${family ? `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-ink-muted text-xs font-medium">${esc(family)}</span>` : ''}
          </div>
          <p class="text-sm text-ink-muted mt-0.5">${esc(productTitle || '')}</p>
        </div>
        <button class="text-ink-mute hover:text-ink p-1.5 rounded-md hover:bg-slate-100 transition-colors"
                onclick="document.getElementById('override-dialog').close()" aria-label="Cerrar">
          ${ICON.x}
        </button>
      </header>

      <!-- Modal body -->
      <div class="px-6 py-5">
        ${banner}

        <!-- Stats: precios -->
        <div class="grid grid-cols-4 gap-3 mb-5">
          <div class="bg-slate-50 rounded-lg p-3 border border-line">
            <div class="text-[10px] uppercase tracking-wider text-ink-muted font-semibold mb-1">Shopify</div>
            <div class="font-mono text-base font-bold text-ink">${fmtCLP(shopifyPrice)}</div>
          </div>
          <div class="bg-slate-50 rounded-lg p-3 border border-line">
            <div class="text-[10px] uppercase tracking-wider text-ink-muted font-semibold mb-1">Target base</div>
            <div class="font-mono text-base font-bold text-ink">${fmtCLP(targetBase)}</div>
            <div class="text-[10px] text-ink-muted mt-0.5">× 1.3 → 990</div>
          </div>
          <div class="bg-amber-50 rounded-lg p-3 border border-amber-100">
            <div class="text-[10px] uppercase tracking-wider text-amber-700 font-semibold mb-1">ML efectivo</div>
            <div class="font-mono text-base font-bold text-ink">${fmtCLP(targetMl)}</div>
            ${mlOverride ? `<div class="text-[10px] text-amber-700 mt-0.5">con ajuste</div>` : ''}
          </div>
          <div class="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
            <div class="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-1">Falabella efectivo</div>
            <div class="font-mono text-base font-bold text-ink">${fmtCLP(targetFb)}</div>
            ${fbOverride ? `<div class="text-[10px] text-emerald-700 mt-0.5">con ajuste</div>` : ''}
          </div>
        </div>

        ${mlOverride || fbOverride ? `
          <h4 class="text-sm font-semibold text-ink-soft mb-2 mt-4">Ajustes activos</h4>
          ${mlOverride ? activeOverrideRow(mlOverride, 'mercadolibre') : ''}
          ${fbOverride ? activeOverrideRow(fbOverride, 'falabella') : ''}
        ` : ''}

        <h4 class="text-sm font-semibold text-ink-soft mb-3 mt-5 flex items-center gap-2">
          <span class="text-brand-600">${ICON.plus}</span> Crear nuevo ajuste
        </h4>

        ${mlSiblingsWarning}

        <form hx-post="/admin/ui/overrides/create" hx-target="#override-dialog" hx-swap="innerHTML" class="space-y-4">
          <input type="hidden" name="returnSku" value="${esc(sku)}">

          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class="text-xs font-medium text-ink-soft mb-1 block">Aplicar a</span>
              <select name="scope" required class="w-full px-3 py-2 bg-white border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500">
                <option value="sku">Este SKU (${esc(sku)})</option>
                ${family ? `<option value="family">Toda la familia (${esc(family)})</option>` : ''}
              </select>
            </label>
            <label class="block">
              <span class="text-xs font-medium text-ink-soft mb-1 block">Plataforma</span>
              <select name="platform" required class="w-full px-3 py-2 bg-white border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500">
                <option value="mercadolibre">MercadoLibre</option>
                <option value="falabella">Falabella</option>
                <option value="all">Ambas plataformas</option>
              </select>
            </label>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class="text-xs font-medium text-ink-soft mb-1 block">Tipo de ajuste</span>
              <select name="overrideType" required class="w-full px-3 py-2 bg-white border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500">
                <option value="discount_fixed">Descuento $ (restar N pesos)</option>
                <option value="discount_percent">Descuento % (-N% del target)</option>
                <option value="absolute">Precio absoluto</option>
                <option value="custom_markup">Markup custom (shopify × N)</option>
              </select>
            </label>
            <label class="block">
              <span class="text-xs font-medium text-ink-soft mb-1 block">Valor</span>
              <input type="number" name="value" step="0.01" required placeholder="ej. 3000"
                     class="w-full px-3 py-2 bg-white border border-line rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500">
            </label>
          </div>

          <details class="bg-slate-50 rounded-lg border border-line">
            <summary class="px-3 py-2 cursor-pointer text-xs font-medium text-ink-soft hover:text-ink">Vigencia opcional (promos con fecha)</summary>
            <div class="grid grid-cols-2 gap-3 p-3 pt-2">
              <label class="block">
                <span class="text-xs text-ink-muted mb-1 block">Desde</span>
                <input type="datetime-local" name="validFrom" class="w-full px-2 py-1.5 bg-white border border-line rounded-md text-xs">
              </label>
              <label class="block">
                <span class="text-xs text-ink-muted mb-1 block">Hasta</span>
                <input type="datetime-local" name="validUntil" class="w-full px-2 py-1.5 bg-white border border-line rounded-md text-xs">
              </label>
            </div>
          </details>

          <label class="block">
            <span class="text-xs font-medium text-ink-soft mb-1 block">Nota (opcional)</span>
            <input type="text" name="note" placeholder="ej. CyberDay 2026, descuento promo"
                   class="w-full px-3 py-2 bg-white border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500">
          </label>

          <footer class="flex items-center justify-end gap-2 pt-3 border-t border-line">
            <button type="button" onclick="document.getElementById('override-dialog').close()"
                    class="px-4 py-2 text-sm font-medium text-ink-soft hover:text-ink hover:bg-slate-100 rounded-lg transition-colors">
              Cancelar
            </button>
            <button type="submit"
                    class="px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg shadow-brand transition-all flex items-center gap-1.5">
              ${ICON.plus} Crear ajuste
            </button>
          </footer>
        </form>
      </div>
    </article>
  `;
}

function activeOverrideRow(o, platform) {
  const platformLabel = platform === 'mercadolibre' ? 'MercadoLibre' : 'Falabella';
  const typeLabel = {
    absolute: 'Precio absoluto',
    discount_fixed: 'Descuento $',
    discount_percent: 'Descuento %',
    custom_markup: 'Markup custom',
  }[o.overrideType] || o.overrideType;
  const bg = platform === 'mercadolibre' ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200';
  const text = platform === 'mercadolibre' ? 'text-amber-800' : 'text-emerald-800';

  return `
    <div class="${bg} border rounded-lg p-3 mb-2">
      <div class="flex items-center justify-between gap-2">
        <div class="flex-1">
          <div class="flex items-center gap-2 ${text}">
            <span class="text-xs font-semibold">${platformLabel}</span>
            <span class="text-xs">·</span>
            <span class="text-xs">${esc(typeLabel)} = <strong class="font-mono">${o.value}</strong></span>
          </div>
          <div class="text-[11px] text-ink-muted mt-0.5">
            scope: ${esc(o.scope)} · key: <span class="font-mono">${esc(o.key)}</span>${o.note ? ` · ${esc(o.note)}` : ''}
          </div>
        </div>
        <button class="text-rose-600 hover:text-rose-700 hover:bg-rose-50 p-1.5 rounded-md transition-colors"
                hx-delete="/admin/ui/overrides/${o.id}"
                hx-confirm="¿Eliminar este ajuste?"
                hx-target="#override-dialog" hx-swap="innerHTML" title="Eliminar ajuste">
          ${ICON.trash}
        </button>
      </div>
    </div>
  `;
}

/* ============ PÁGINA: LISTA DE OVERRIDES ============ */

export function overridesList(items) {
  if (items.length === 0) {
    return `
      <div class="flex items-end justify-between mb-6 pb-4 border-b border-line">
        <div>
          <h2 class="text-2xl font-bold text-ink tracking-tight">Ajustes manuales</h2>
          <p class="text-sm text-ink-muted mt-1">Reglas que sobrescriben la fórmula general de precios</p>
        </div>
      </div>
      <div class="bg-white rounded-xl border border-line p-16 text-center shadow-soft">
        <span class="inline-block text-ink-mute mb-2">${ICON.sliders}</span>
        <p class="text-ink-muted italic">No hay ajustes activos. Crea uno desde el dashboard de SKUs.</p>
      </div>
    `;
  }

  return `
    <div class="flex items-end justify-between mb-6 pb-4 border-b border-line">
      <div>
        <h2 class="text-2xl font-bold text-ink tracking-tight">Ajustes manuales</h2>
        <p class="text-sm text-ink-muted mt-1">${items.length} reglas activas que sobrescriben la fórmula general</p>
      </div>
    </div>

    <div class="bg-white rounded-xl border border-line shadow-soft overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-slate-50/80 border-b border-line">
            <tr>
              <th class="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">ID</th>
              <th class="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Aplica a</th>
              <th class="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Plataforma</th>
              <th class="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Tipo</th>
              <th class="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Valor</th>
              <th class="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Vigencia</th>
              <th class="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Nota</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line/60">
            ${items.map((o) => overrideListRow(o)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function overrideListRow(o) {
  const typeLabel = {
    absolute: 'Precio absoluto', discount_fixed: 'Descuento $',
    discount_percent: 'Descuento %', custom_markup: 'Markup custom',
  }[o.overrideType] || o.overrideType;
  const platformLabel = o.platform === 'all' ? 'Ambas' : o.platform === 'mercadolibre' ? 'MercadoLibre' : 'Falabella';
  const platformBg = o.platform === 'mercadolibre' ? 'bg-amber-50 text-amber-800' :
                     o.platform === 'falabella' ? 'bg-emerald-50 text-emerald-800' :
                     'bg-brand-50 text-brand-800';
  return `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3"><span class="font-mono text-xs text-ink-muted">#${o.id}</span></td>
      <td class="px-4 py-3">
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-ink-muted text-xs font-medium">${esc(o.scope)}</span>
          <span class="font-mono text-xs font-semibold text-ink">${esc(o.key)}</span>
        </div>
      </td>
      <td class="px-4 py-3">
        <span class="inline-flex items-center px-2 py-0.5 rounded-md ${platformBg} text-xs font-semibold">${esc(platformLabel)}</span>
      </td>
      <td class="px-4 py-3 text-ink-soft">${esc(typeLabel)}</td>
      <td class="px-4 py-3 text-right font-mono font-semibold text-ink">${o.value}</td>
      <td class="px-4 py-3 text-xs text-ink-muted">
        ${o.validFrom ? new Date(o.validFrom).toLocaleDateString('es-CL') : '—'}
        <span class="text-ink-mute">→</span>
        ${o.validUntil ? new Date(o.validUntil).toLocaleDateString('es-CL') : '<span class="text-emerald-700 font-medium">permanente</span>'}
      </td>
      <td class="px-4 py-3 text-xs text-ink-muted max-w-[200px] truncate">${esc(o.note || '—')}</td>
      <td class="px-4 py-3">
        <button class="text-rose-600 hover:text-rose-700 hover:bg-rose-50 p-1.5 rounded-md transition-colors"
                hx-delete="/admin/ui/overrides/${o.id}"
                hx-confirm="¿Eliminar este ajuste?"
                hx-target="closest tr" hx-swap="outerHTML" title="Eliminar">
          ${ICON.trash}
        </button>
      </td>
    </tr>
  `;
}

/* ============ PÁGINA: OPERACIONES ============ */

export function operationsPage() {
  return `
    <div class="flex items-end justify-between mb-6 pb-4 border-b border-line">
      <div>
        <h2 class="text-2xl font-bold text-ink tracking-tight">Operaciones</h2>
        <p class="text-sm text-ink-muted mt-1">Acciones administrativas globales. Cada operación corre en background.</p>
      </div>
    </div>

    <div class="grid lg:grid-cols-2 gap-4 mb-4">
      ${operationCard({
        title: 'Sincronizar precios',
        description: 'Recorre todos los productos de Shopify y propaga los precios a MercadoLibre y Falabella aplicando la fórmula general (× 1.3 → 990) + ajustes activos.',
        icon: ICON.trendingUp,
        accent: 'brand',
        actionDry: { url: '/admin/ui/ops/sync-all-prices?dry_run=true', label: 'Dry-run' },
        actionReal: { url: '/admin/ui/ops/sync-all-prices', label: 'Ejecutar barrido', confirm: '¿Confirmar barrido REAL? Va a actualizar precios en los marketplaces.' },
      })}
      ${operationCard({
        title: 'Reconciliar stock',
        description: 'Detecta drift entre Shopify (fuente de verdad) y los marketplaces, y auto-corrige escribiendo max(0, stock_shopify - 1).',
        icon: ICON.refresh,
        accent: 'copper',
        actionDry: { url: '/admin/ui/ops/reconcile-stock?dry_run=true', label: 'Dry-run' },
        actionReal: { url: '/admin/ui/ops/reconcile-stock', label: 'Reconciliar', confirm: '¿Confirmar reconciliación REAL?' },
      })}
    </div>

    <div id="op-result"></div>
  `;
}

function operationCard({ title, description, icon, accent, actionDry, actionReal }) {
  const accentClasses = {
    brand: { bg: 'bg-brand-50', text: 'text-brand-600', btn: 'bg-brand-600 hover:bg-brand-700 shadow-brand' },
    copper: { bg: 'bg-copper-50', text: 'text-copper-600', btn: 'bg-copper-600 hover:bg-copper-700' },
  }[accent];

  return `
    <div class="bg-white rounded-xl border border-line p-5 shadow-soft hover:shadow-card transition-all">
      <div class="flex items-start gap-3 mb-3">
        <span class="${accentClasses.bg} ${accentClasses.text} p-2.5 rounded-lg">${icon}</span>
        <div class="flex-1">
          <h3 class="font-semibold text-ink">${esc(title)}</h3>
          <p class="text-sm text-ink-muted mt-1">${esc(description)}</p>
        </div>
      </div>
      <div class="flex gap-2 mt-4">
        <button hx-post="${actionDry.url}" hx-target="#op-result" hx-swap="innerHTML"
                class="px-3 py-1.5 text-sm font-medium text-ink-soft border border-line rounded-lg hover:bg-slate-50 transition-all">
          ${actionDry.label}
        </button>
        <button hx-post="${actionReal.url}" hx-target="#op-result" hx-swap="innerHTML" hx-confirm="${esc(actionReal.confirm)}"
                class="px-3 py-1.5 text-sm font-semibold text-white ${accentClasses.btn} rounded-lg transition-all flex items-center gap-1.5">
          ${ICON.zap} ${actionReal.label}
        </button>
      </div>
    </div>
  `;
}

export function operationResult({ title, summary, isDryRun }) {
  return `
    <div class="bg-white rounded-xl border border-brand-200 shadow-card p-5 mt-4">
      <div class="flex items-center justify-between mb-3 pb-3 border-b border-line">
        <h3 class="font-semibold text-ink flex items-center gap-2">
          <span class="text-brand-600">${ICON.check}</span> ${esc(title)}
        </h3>
        ${isDryRun
          ? '<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 text-xs font-semibold">DRY RUN</span>'
          : '<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-xs font-semibold">EJECUTADO</span>'}
      </div>
      <pre class="font-mono text-xs bg-slate-50 border border-line rounded-lg p-3 overflow-x-auto max-h-96">${esc(JSON.stringify(summary, null, 2))}</pre>
    </div>
  `;
}
