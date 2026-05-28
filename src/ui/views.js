/**
 * Vistas HTML del dashboard. Cada función retorna el HTML del body.
 * El layout exterior lo agrega routes/admin-ui.js.
 */

import { esc, fmtCLP } from './layout.js';

/**
 * Página principal: tabla de SKUs con su estado en cada plataforma + overrides.
 *
 * @param {Array} rows - array de {sku, family, productTitle, shopifyPrice,
 *   targetBase, targetMl, mlOverride, mlSynced, targetFb, fbOverride, fbSynced}
 * @param {{ search?: string, family?: string }} filters
 */
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

  const tbody = rows.length === 0
    ? `<tr><td colspan="9" class="empty">No hay SKUs que coincidan con el filtro</td></tr>`
    : rows.map((r) => skuRow(r)).join('');

  return `
    <h2>SKUs <small class="small">(${stats.total} filtrados)</small></h2>

    <div class="stat-grid">
      <div class="stat"><div class="label">SKUs visibles</div><div class="value">${stats.total}</div></div>
      <div class="stat"><div class="label">Con override ML</div><div class="value">${stats.withMlOverride}</div></div>
      <div class="stat"><div class="label">Con override Falabella</div><div class="value">${stats.withFbOverride}</div></div>
      <div class="stat"><div class="label">Con drift detectado</div><div class="value">${stats.drift}</div></div>
    </div>

    <form class="toolbar" hx-get="/admin/ui/skus" hx-target="#skus-table-wrap" hx-swap="innerHTML" hx-trigger="change from:select, keyup changed delay:300ms from:input">
      <input type="search" name="search" placeholder="Buscar SKU o producto..." value="${esc(filters.search || '')}" style="flex: 1; min-width: 200px;">
      <select name="family">
        <option value="">— Todas las familias —</option>
        ${familyOptions.map((f) => `<option value="${esc(f)}" ${filters.family === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}
      </select>
      <select name="hasOverride">
        <option value="">— Override: cualquiera —</option>
        <option value="yes" ${filters.hasOverride === 'yes' ? 'selected' : ''}>Con override</option>
        <option value="no" ${filters.hasOverride === 'no' ? 'selected' : ''}>Sin override</option>
      </select>
      <select name="hasDrift">
        <option value="">— Drift: cualquiera —</option>
        <option value="yes" ${filters.hasDrift === 'yes' ? 'selected' : ''}>Con drift</option>
      </select>
    </form>

    <div id="skus-table-wrap">
      ${skusTableInner(rows)}
    </div>

    <dialog id="override-dialog"></dialog>
  `;
}

export function skusTableInner(rows) {
  if (rows.length === 0) {
    return `<div class="empty">No hay SKUs que coincidan con el filtro</div>`;
  }
  return `
    <figure>
      <table role="grid">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Producto</th>
            <th>Familia</th>
            <th class="right">Shopify</th>
            <th class="right">Target base</th>
            <th class="right">ML target</th>
            <th class="right">Falabella target</th>
            <th>Overrides</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => skuRow(r)).join('')}
        </tbody>
      </table>
    </figure>
  `;
}

function skuRow(r) {
  const mlBadge = mlBadgeFor(r);
  const fbBadge = fbBadgeFor(r);
  return `
    <tr>
      <td class="mono">${esc(r.sku)}</td>
      <td class="truncate" title="${esc(r.productTitle || '')}">${esc(r.productTitle || '—')}</td>
      <td>${r.family ? `<span class="badge dim">${esc(r.family)}</span>` : ''}</td>
      <td class="right mono">${fmtCLP(r.shopifyPrice)}</td>
      <td class="right small">${fmtCLP(r.targetBase)}</td>
      <td class="right">${mlBadge}</td>
      <td class="right">${fbBadge}</td>
      <td>${overrideBadges(r)}</td>
      <td>
        <button class="ghost" hx-get="/admin/ui/skus/${encodeURIComponent(r.sku)}/edit" hx-target="#override-dialog" hx-swap="innerHTML" onclick="document.getElementById('override-dialog').showModal()">
          ✏️
        </button>
      </td>
    </tr>
  `;
}

function mlBadgeFor(r) {
  if (r.targetMl == null) return `<span class="badge dim">sin link ML</span>`;
  if (r.mlSynced == null) return `<span class="mono">${fmtCLP(r.targetMl)}</span> <span class="badge dim">no sync</span>`;
  if (r.mlSynced === r.targetMl) return `<span class="mono">${fmtCLP(r.targetMl)}</span> <span class="badge ok">✓</span>`;
  return `<span class="mono">${fmtCLP(r.targetMl)}</span> <span class="badge warn" title="ML actual: ${fmtCLP(r.mlSynced)}">drift</span>`;
}

function fbBadgeFor(r) {
  if (r.targetFb == null) return `<span class="badge dim">sin link FB</span>`;
  if (r.fbSynced == null) return `<span class="mono">${fmtCLP(r.targetFb)}</span> <span class="badge dim">no sync</span>`;
  if (r.fbSynced === r.targetFb) return `<span class="mono">${fmtCLP(r.targetFb)}</span> <span class="badge ok">✓</span>`;
  return `<span class="mono">${fmtCLP(r.targetFb)}</span> <span class="badge warn" title="FB actual: ${fmtCLP(r.fbSynced)}">drift</span>`;
}

function overrideBadges(r) {
  const parts = [];
  if (r.mlOverride) parts.push(`<span class="badge warn" title="${esc(overrideTooltip(r.mlOverride))}">ML</span>`);
  if (r.fbOverride) parts.push(`<span class="badge warn" title="${esc(overrideTooltip(r.fbOverride))}">FB</span>`);
  return parts.length === 0 ? '<span class="small">—</span>' : parts.join(' ');
}

function overrideTooltip(o) {
  if (!o) return '';
  return `${o.scope}=${o.key} ${o.overrideType}=${o.value}${o.note ? ' · ' + o.note : ''}`;
}

/**
 * Modal de edición de overrides para un SKU específico.
 */
export function skuEditModal({ sku, family, shopifyPrice, productTitle, targetBase, mlOverride, fbOverride, targetMl, targetFb, mlSiblingsCount = 0, syncStartedFor }) {
  const banner = syncStartedFor
    ? `<div style="background:#d1fadf;color:#027a48;padding:0.7rem 1rem;border-radius:6px;margin-bottom:1rem;">
         ✅ Override creado. Sync de precio iniciado para <strong>${esc(syncStartedFor)}</strong>.
         En ~30 seg los precios en ML/Falabella están actualizados (revisá logs de Render para detalle).
       </div>`
    : '';

  // Warning: si el SKU tiene hermanas en ML, override scope=sku solo afecta
  // Falabella; ML obliga a precio común y va a tomar el max entre variantes.
  const mlSiblingsWarning = mlSiblingsCount > 1
    ? `<div style="background:#fef0c7;color:#b54708;padding:0.7rem 1rem;border-radius:6px;margin:1rem 0;font-size:0.85rem;">
         ⚠️ <strong>Este SKU comparte item ML con ${mlSiblingsCount - 1} hermana(s).</strong>
         ML obliga a que todas las variantes del mismo item tengan el mismo precio.
         <ul style="margin:0.4rem 0 0 1rem;">
           <li><strong>Override <em>SKU</em></strong>: solo afecta Falabella. En ML las ${mlSiblingsCount} variantes se publican al precio más alto entre ellas.</li>
           <li><strong>Override <em>familia ${esc(family || '')}</em></strong>: afecta a las ${mlSiblingsCount} variantes en ML y Falabella. Lo más natural.</li>
         </ul>
       </div>`
    : '';
  return `
    <article>
      <header>
        <a href="#" aria-label="Close" class="close" onclick="document.getElementById('override-dialog').close(); return false;"></a>
        <strong>${esc(sku)}</strong> — ${esc(productTitle || '')}
      </header>

      ${banner}

      <div class="stat-grid" style="grid-template-columns: repeat(4, 1fr);">
        <div class="stat"><div class="label">Familia</div><div class="value" style="font-size: 1rem;">${esc(family || '—')}</div></div>
        <div class="stat"><div class="label">Shopify</div><div class="value" style="font-size: 1rem;">${fmtCLP(shopifyPrice)}</div></div>
        <div class="stat"><div class="label">Target base (×1.3 → 990)</div><div class="value" style="font-size: 1rem;">${fmtCLP(targetBase)}</div></div>
        <div class="stat"><div class="label">Target efectivo</div><div class="value" style="font-size: 1rem;">ML ${fmtCLP(targetMl)} / FB ${fmtCLP(targetFb)}</div></div>
      </div>

      ${mlOverride || fbOverride ? `
        <h4>Overrides activos</h4>
        ${mlOverride ? activeOverrideRow(mlOverride, 'mercadolibre') : ''}
        ${fbOverride ? activeOverrideRow(fbOverride, 'falabella') : ''}
      ` : ''}

      <h4>Crear nuevo override</h4>
      ${mlSiblingsWarning}
      <form hx-post="/admin/ui/overrides/create" hx-target="#override-dialog" hx-swap="innerHTML">
        <input type="hidden" name="returnSku" value="${esc(sku)}">

        <div class="grid">
          <label>
            Aplicar a
            <select name="scope" required>
              <option value="sku">Este SKU (${esc(sku)})</option>
              ${family ? `<option value="family">Toda la familia (${esc(family)})</option>` : ''}
            </select>
          </label>
          <label>
            Plataforma
            <select name="platform" required>
              <option value="mercadolibre">MercadoLibre</option>
              <option value="falabella">Falabella</option>
              <option value="all">Ambas</option>
            </select>
          </label>
        </div>

        <div class="grid">
          <label>
            Tipo
            <select name="overrideType" required>
              <option value="discount_fixed">Descuento $ (resto N al target)</option>
              <option value="discount_percent">Descuento % (-N% del target)</option>
              <option value="absolute">Precio absoluto</option>
              <option value="custom_markup">Markup custom (shopify × N)</option>
            </select>
          </label>
          <label>
            Valor
            <input type="number" name="value" step="0.01" required placeholder="ej. 3000 (descuento $3.000)">
          </label>
        </div>

        <details>
          <summary>Vigencia opcional (para promos con fecha)</summary>
          <div class="grid">
            <label>Desde<input type="datetime-local" name="validFrom"></label>
            <label>Hasta<input type="datetime-local" name="validUntil"></label>
          </div>
        </details>

        <label>
          Nota (opcional)
          <input type="text" name="note" placeholder="ej. CyberDay 2026, descuento promo octubre">
        </label>

        <footer>
          <button type="submit">Crear override</button>
          <button type="button" class="ghost" onclick="document.getElementById('override-dialog').close()">Cancelar</button>
        </footer>
      </form>
    </article>
  `;
}

function activeOverrideRow(o, platform) {
  const platformLabel = platform === 'mercadolibre' ? 'ML' : 'FB';
  const typeLabel = {
    absolute: 'Precio absoluto',
    discount_fixed: 'Descuento $',
    discount_percent: 'Descuento %',
    custom_markup: 'Markup custom',
  }[o.overrideType] || o.overrideType;

  return `
    <div style="background: #fef0c7; padding: 0.8rem; border-radius: 6px; margin-bottom: 0.6rem;">
      <strong>${platformLabel}</strong>: ${esc(typeLabel)} = <strong>${o.value}</strong>
      <span class="small">(scope: ${esc(o.scope)}, key: <span class="mono">${esc(o.key)}</span>)</span>
      ${o.note ? `<div class="small">${esc(o.note)}</div>` : ''}
      <button class="danger" style="font-size: 0.75rem; padding: 0.2rem 0.5rem; margin-top: 0.4rem;"
        hx-delete="/admin/ui/overrides/${o.id}"
        hx-confirm="¿Eliminar este override?"
        hx-target="#override-dialog" hx-swap="innerHTML">
        Eliminar
      </button>
    </div>
  `;
}

/**
 * Página /admin/ui/overrides — lista de overrides activos.
 */
export function overridesList(items) {
  const tbody = items.length === 0
    ? `<tr><td colspan="8" class="empty">No hay overrides activos</td></tr>`
    : items.map((o) => `
        <tr>
          <td class="mono">#${o.id}</td>
          <td><span class="badge dim">${esc(o.scope)}</span> <span class="mono">${esc(o.key)}</span></td>
          <td>${esc(o.platform)}</td>
          <td>${esc(o.overrideType)}</td>
          <td class="right mono">${o.value}</td>
          <td class="small">${o.validFrom ? new Date(o.validFrom).toLocaleString('es-CL') : '—'} → ${o.validUntil ? new Date(o.validUntil).toLocaleString('es-CL') : 'permanente'}</td>
          <td class="truncate small">${esc(o.note || '—')}</td>
          <td>
            <button class="danger" style="font-size: 0.75rem; padding: 0.2rem 0.5rem;"
              hx-delete="/admin/ui/overrides/${o.id}"
              hx-confirm="¿Eliminar este override?"
              hx-target="closest tr" hx-swap="outerHTML">
              Eliminar
            </button>
          </td>
        </tr>
      `).join('');
  return `
    <h2>Overrides activos <small class="small">(${items.length})</small></h2>
    <p class="small">Lista de todos los overrides activos. Los inactivos / vencidos están ocultos.</p>
    <figure>
      <table role="grid">
        <thead>
          <tr>
            <th>ID</th>
            <th>Aplica a</th>
            <th>Plataforma</th>
            <th>Tipo</th>
            <th class="right">Valor</th>
            <th>Vigencia</th>
            <th>Nota</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table>
    </figure>
  `;
}

/**
 * Página /admin/ui/operations — botones para disparar barridos/reconciliación.
 */
export function operationsPage() {
  return `
    <h2>Operaciones</h2>
    <p class="small">Acciones administrativas globales. Cada operación corre en background; revisa los logs de Render para ver el progreso.</p>

    <article>
      <header><strong>Sincronizar precios (barrido masivo)</strong></header>
      <p>Recorre todos los productos Shopify y propaga a ML y Falabella aplicando la regla general + overrides.</p>
      <button hx-post="/admin/ui/ops/sync-all-prices?dry_run=true" hx-target="#op-result" hx-swap="innerHTML">
        Dry-run (no escribe)
      </button>
      <button hx-post="/admin/ui/ops/sync-all-prices" hx-target="#op-result" hx-swap="innerHTML" hx-confirm="¿Confirmar barrido real (escribe en marketplaces)?">
        Barrido REAL
      </button>
    </article>

    <article>
      <header><strong>Reconciliar stock</strong></header>
      <p>Detecta drift entre Shopify (fuente de verdad) y los marketplaces, y auto-corrige.</p>
      <button hx-post="/admin/ui/ops/reconcile-stock?dry_run=true" hx-target="#op-result" hx-swap="innerHTML">
        Dry-run (no escribe)
      </button>
      <button hx-post="/admin/ui/ops/reconcile-stock" hx-target="#op-result" hx-swap="innerHTML" hx-confirm="¿Confirmar reconciliación REAL?">
        Reconciliar REAL
      </button>
    </article>

    <div id="op-result"></div>
  `;
}

export function operationResult({ title, summary, isDryRun }) {
  return `
    <article style="background: #f0f9ff; border: 1px solid #b9e6fe;">
      <header><strong>${esc(title)}</strong> ${isDryRun ? '<span class="badge dim">DRY RUN</span>' : '<span class="badge ok">REAL</span>'}</header>
      <pre style="font-size: 0.8rem; max-height: 400px; overflow: auto;">${esc(JSON.stringify(summary, null, 2))}</pre>
    </article>
  `;
}
