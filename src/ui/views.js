/**
 * Vistas HTML del dashboard.
 */

import { esc, fmtCLP, ML_LOGO, FB_LOGO } from './layout.js';

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
    <div class="page-header">
      <h2>Catálogo de SKUs</h2>
      <span class="small">${stats.total} SKUs visibles</span>
    </div>

    <div class="stat-grid">
      <div class="stat">
        <div class="label">Total SKUs</div>
        <div class="value">${stats.total}</div>
      </div>
      <div class="stat">
        <div class="label">${ML_LOGO} Con ajuste ML</div>
        <div class="value">${stats.withMlOverride}</div>
      </div>
      <div class="stat">
        <div class="label">${FB_LOGO} Con ajuste Falabella</div>
        <div class="value">${stats.withFbOverride}</div>
      </div>
      <div class="stat ${stats.drift > 0 ? 'accent' : ''}">
        <div class="label">Drift detectado</div>
        <div class="value">${stats.drift}</div>
      </div>
    </div>

    <form class="toolbar" hx-get="/admin/ui/skus" hx-target="#skus-table-wrap" hx-swap="innerHTML" hx-trigger="change from:select, keyup changed delay:300ms from:input">
      <input type="search" name="search" placeholder="🔍 Buscar SKU o producto..." value="${esc(filters.search || '')}">
      <select name="family">
        <option value="">Todas las familias</option>
        ${familyOptions.map((f) => `<option value="${esc(f)}" ${filters.family === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}
      </select>
      <select name="hasOverride">
        <option value="">Ajuste: cualquiera</option>
        <option value="yes" ${filters.hasOverride === 'yes' ? 'selected' : ''}>Con ajuste</option>
        <option value="no" ${filters.hasOverride === 'no' ? 'selected' : ''}>Sin ajuste</option>
      </select>
      <select name="hasDrift">
        <option value="">Drift: cualquiera</option>
        <option value="yes" ${filters.hasDrift === 'yes' ? 'selected' : ''}>Solo con drift</option>
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
    return `<div class="table-wrap"><div class="empty">No hay SKUs que coincidan con el filtro</div></div>`;
  }
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Producto</th>
            <th>Familia</th>
            <th class="right">Shopify</th>
            <th class="right">Target base</th>
            <th class="right">${ML_LOGO} MercadoLibre</th>
            <th class="right">${FB_LOGO} Falabella</th>
            <th>Ajustes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => skuRow(r)).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function skuRow(r) {
  return `
    <tr>
      <td class="mono"><strong>${esc(r.sku)}</strong></td>
      <td class="truncate" title="${esc(r.productTitle || '')}">${esc(r.productTitle || '—')}</td>
      <td>${r.family ? `<span class="badge dim">${esc(r.family)}</span>` : ''}</td>
      <td class="right price">${fmtCLP(r.shopifyPrice)}</td>
      <td class="right small">${fmtCLP(r.targetBase)}</td>
      <td class="right">${platformCell(r, 'ml')}</td>
      <td class="right">${platformCell(r, 'fb')}</td>
      <td>${overrideBadges(r)}</td>
      <td>
        <button class="ghost icon" title="Editar ajustes manuales"
          hx-get="/admin/ui/skus/${encodeURIComponent(r.sku)}/edit"
          hx-target="#override-dialog" hx-swap="innerHTML"
          onclick="document.getElementById('override-dialog').showModal()">
          ✏️
        </button>
      </td>
    </tr>
  `;
}

function platformCell(r, kind) {
  const target = kind === 'ml' ? r.targetMl : r.targetFb;
  const synced = kind === 'ml' ? r.mlSynced : r.fbSynced;
  const label = kind === 'ml' ? 'ML' : 'FB';

  if (target == null) {
    return `<span class="badge dim">sin link</span>`;
  }
  if (synced == null) {
    return `<span class="price-cell"><span class="price">${fmtCLP(target)}</span> <span class="badge dim">no sync</span></span>`;
  }
  if (synced === target) {
    return `<span class="price-cell"><span class="price">${fmtCLP(target)}</span> <span class="badge ok">✓</span></span>`;
  }
  return `<span class="price-cell"><span class="price">${fmtCLP(target)}</span> <span class="badge warn" title="${label} actual: ${fmtCLP(synced)}">drift</span></span>`;
}

function overrideBadges(r) {
  const parts = [];
  if (r.mlOverride) parts.push(`<span class="badge ml" title="${esc(overrideTooltip(r.mlOverride))}">${ML_LOGO}<span>ML</span></span>`);
  if (r.fbOverride) parts.push(`<span class="badge fb" title="${esc(overrideTooltip(r.fbOverride))}">${FB_LOGO}<span>FB</span></span>`);
  return parts.length === 0 ? '<span class="small">—</span>' : parts.join(' ');
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

export function skuEditModal({ sku, family, shopifyPrice, productTitle, targetBase, mlOverride, fbOverride, targetMl, targetFb, mlSiblingsCount = 0, syncStartedFor }) {
  const banner = syncStartedFor
    ? `<div class="banner success">
         ✅ <strong>Ajuste creado.</strong> Sync iniciado para ${esc(syncStartedFor)}.
         En ~30 seg los precios en ML/Falabella estarán actualizados.
       </div>`
    : '';

  const mlSiblingsWarning = mlSiblingsCount > 1
    ? `<div class="banner warn">
         ⚠️ <strong>Este SKU comparte item ML con ${mlSiblingsCount - 1} hermana(s).</strong>
         MercadoLibre obliga a que todas las variantes del item tengan el mismo precio.
         <ul style="margin: 0.5rem 0 0 1.2rem;">
           <li>Ajuste a este <strong><em>SKU</em></strong>: solo afecta Falabella. ML toma el precio más alto entre las variantes.</li>
           <li>Ajuste a la <strong><em>familia ${esc(family || '')}</em></strong>: afecta las ${mlSiblingsCount} variantes en ML y Falabella.</li>
         </ul>
       </div>`
    : '';

  return `
    <article>
      <header>
        <strong>${esc(sku)}</strong>
        <button class="close" aria-label="Cerrar" onclick="document.getElementById('override-dialog').close()"></button>
      </header>

      <p class="small" style="margin-top:-0.5rem">${esc(productTitle || '')}</p>

      ${banner}

      <div class="stat-grid" style="grid-template-columns: repeat(4, 1fr);">
        <div class="stat">
          <div class="label">Familia</div>
          <div class="value" style="font-size: 1.3rem;">${esc(family || '—')}</div>
        </div>
        <div class="stat">
          <div class="label">Shopify</div>
          <div class="value" style="font-size: 1.3rem;">${fmtCLP(shopifyPrice)}</div>
        </div>
        <div class="stat">
          <div class="label">Target base</div>
          <div class="value" style="font-size: 1.3rem;">${fmtCLP(targetBase)}</div>
        </div>
        <div class="stat accent">
          <div class="label">Efectivo</div>
          <div class="value" style="font-size: 1rem; line-height: 1.3;">
            ML ${fmtCLP(targetMl)}<br>FB ${fmtCLP(targetFb)}
          </div>
        </div>
      </div>

      ${mlOverride || fbOverride ? `
        <h4>Ajustes activos</h4>
        ${mlOverride ? activeOverrideRow(mlOverride, 'mercadolibre') : ''}
        ${fbOverride ? activeOverrideRow(fbOverride, 'falabella') : ''}
      ` : ''}

      <h4>Crear nuevo ajuste</h4>
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
              <option value="discount_fixed">Descuento $ (resto N pesos al target)</option>
              <option value="discount_percent">Descuento % (-N% del target)</option>
              <option value="absolute">Precio absoluto</option>
              <option value="custom_markup">Markup custom (shopify × N)</option>
            </select>
          </label>
          <label>
            Valor
            <input type="number" name="value" step="0.01" required placeholder="ej. 3000">
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
          <button type="button" class="ghost" onclick="document.getElementById('override-dialog').close()">Cancelar</button>
          <button type="submit" class="accent">Crear ajuste</button>
        </footer>
      </form>
    </article>
  `;
}

function activeOverrideRow(o, platform) {
  const platformLabel = platform === 'mercadolibre' ? 'MercadoLibre' : 'Falabella';
  const platformLogo = platform === 'mercadolibre' ? ML_LOGO : FB_LOGO;
  const typeLabel = {
    absolute: 'Precio absoluto',
    discount_fixed: 'Descuento $',
    discount_percent: 'Descuento %',
    custom_markup: 'Markup custom',
  }[o.overrideType] || o.overrideType;

  return `
    <div style="background: var(--warning-soft); padding: 0.9rem 1.1rem; border-radius: var(--radius-sm); margin-bottom: 0.7rem; border-left: 3px solid var(--warning);">
      <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.3rem;">
        ${platformLogo} <strong>${platformLabel}</strong>: ${esc(typeLabel)} = <strong>${o.value}</strong>
      </div>
      <div class="small" style="color:var(--ink-soft)">scope: ${esc(o.scope)} · key: <span class="mono">${esc(o.key)}</span>${o.note ? ` · ${esc(o.note)}` : ''}</div>
      <button class="danger" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; margin-top: 0.5rem;"
        hx-delete="/admin/ui/overrides/${o.id}"
        hx-confirm="¿Eliminar este ajuste?"
        hx-target="#override-dialog" hx-swap="innerHTML">
        Eliminar
      </button>
    </div>
  `;
}

export function overridesList(items) {
  const tbody = items.length === 0
    ? `<tr><td colspan="8" class="empty">No hay overrides activos</td></tr>`
    : items.map((o) => {
        const platformLogo = o.platform === 'mercadolibre' ? ML_LOGO : o.platform === 'falabella' ? FB_LOGO : '';
        const typeLabel = {
          absolute: 'Precio absoluto',
          discount_fixed: 'Descuento $',
          discount_percent: 'Descuento %',
          custom_markup: 'Markup custom',
        }[o.overrideType] || o.overrideType;
        return `
          <tr>
            <td class="mono"><strong>#${o.id}</strong></td>
            <td><span class="badge dim">${esc(o.scope)}</span> <span class="mono">${esc(o.key)}</span></td>
            <td><span style="display:inline-flex;align-items:center;gap:0.3rem">${platformLogo}${esc(o.platform === 'all' ? 'Ambas' : o.platform === 'mercadolibre' ? 'ML' : 'Falabella')}</span></td>
            <td>${esc(typeLabel)}</td>
            <td class="right mono"><strong>${o.value}</strong></td>
            <td class="small">${o.validFrom ? new Date(o.validFrom).toLocaleDateString('es-CL') : '—'} → ${o.validUntil ? new Date(o.validUntil).toLocaleDateString('es-CL') : 'permanente'}</td>
            <td class="truncate small">${esc(o.note || '—')}</td>
            <td>
              <button class="danger" style="font-size: 0.78rem; padding: 0.3rem 0.6rem;"
                hx-delete="/admin/ui/overrides/${o.id}"
                hx-confirm="¿Eliminar este ajuste?"
                hx-target="closest tr" hx-swap="outerHTML">
                Eliminar
              </button>
            </td>
          </tr>
        `;
      }).join('');
  return `
    <div class="page-header">
      <h2>Ajustes manuales activos</h2>
      <span class="small">${items.length} reglas activas</span>
    </div>
    <p class="small" style="margin-bottom:1.2rem">Reglas que vos creaste y que sobrescriben la fórmula general (precio Shopify × 1.3 → terminación 990). Los inactivos y vencidos están ocultos.</p>
    <div class="table-wrap">
      <table>
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
    </div>
  `;
}

export function operationsPage() {
  return `
    <div class="page-header">
      <h2>Operaciones</h2>
      <span class="small">Acciones administrativas globales</span>
    </div>

    <p class="small">Cada operación corre en background; los resultados aparecen abajo y los detalles van a los logs de Render.</p>

    <article>
      <header>🔄 Sincronizar precios (barrido masivo)</header>
      <p>Recorre todos los productos de Shopify y propaga los precios a ${ML_LOGO} MercadoLibre y ${FB_LOGO} Falabella aplicando la regla general (× 1.3 → 990) + overrides activos.</p>
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.8rem;">
        <button class="ghost" hx-post="/admin/ui/ops/sync-all-prices?dry_run=true" hx-target="#op-result" hx-swap="innerHTML">
          Dry-run (no escribe)
        </button>
        <button class="accent" hx-post="/admin/ui/ops/sync-all-prices" hx-target="#op-result" hx-swap="innerHTML" hx-confirm="¿Confirmar barrido REAL? Va a actualizar precios en los marketplaces.">
          Ejecutar barrido REAL
        </button>
      </div>
    </article>

    <article>
      <header>🧹 Reconciliar stock</header>
      <p>Detecta drift entre Shopify (fuente de verdad) y los marketplaces, y auto-corrige escribiendo <code>max(0, stock_shopify - 1)</code>.</p>
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.8rem;">
        <button class="ghost" hx-post="/admin/ui/ops/reconcile-stock?dry_run=true" hx-target="#op-result" hx-swap="innerHTML">
          Dry-run
        </button>
        <button class="accent" hx-post="/admin/ui/ops/reconcile-stock" hx-target="#op-result" hx-swap="innerHTML" hx-confirm="¿Confirmar reconciliación REAL?">
          Reconciliar REAL
        </button>
      </div>
    </article>

    <div id="op-result"></div>
  `;
}

export function operationResult({ title, summary, isDryRun }) {
  return `
    <article style="background: var(--info-soft); border-color: var(--info);">
      <header>
        <span>${esc(title)}</span>
        ${isDryRun ? '<span class="badge info">DRY RUN</span>' : '<span class="badge ok">REAL</span>'}
      </header>
      <pre style="font-size: 0.78rem; max-height: 400px; overflow: auto; background: white; padding: 0.8rem; border-radius: var(--radius-sm); border: 1px solid var(--beige);">${esc(JSON.stringify(summary, null, 2))}</pre>
    </article>
  `;
}
