import { query, withTx } from '../index.js';

const COLS = [
  'sku',
  'shopify_variant_id',
  'shopify_inventory_item_id',
  'ml_item_id',
  'ml_variation_id',
  'falabella_seller_sku',
  'active',
  'notes',
  'created_at',
  'updated_at',
];

function rowToMapping(row) {
  if (!row) return null;
  return {
    sku: row.sku,
    shopifyVariantId: row.shopify_variant_id != null ? String(row.shopify_variant_id) : null,
    shopifyInventoryItemId: row.shopify_inventory_item_id != null ? String(row.shopify_inventory_item_id) : null,
    mlItemId: row.ml_item_id,
    mlVariationId: row.ml_variation_id != null ? String(row.ml_variation_id) : null,
    falabellaSellerSku: row.falabella_seller_sku,
    active: row.active,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findBySku(sku) {
  if (!sku) return null;
  const res = await query(
    `SELECT ${COLS.join(', ')} FROM sku_mapping WHERE sku = $1`,
    [String(sku).trim()],
  );
  return rowToMapping(res.rows[0]);
}

export async function findByMlVariation(variationId) {
  if (variationId == null) return null;
  const res = await query(
    `SELECT ${COLS.join(', ')} FROM sku_mapping WHERE ml_variation_id = $1 AND active`,
    [String(variationId)],
  );
  return rowToMapping(res.rows[0]);
}

/**
 * Para órdenes ML sin variation_id: busca todos los SKUs de un item_id.
 * Devuelve array. Si tiene > 1, el caller debe decidir (ambiguo).
 */
export async function findByMlItemId(itemId) {
  if (!itemId) return [];
  const res = await query(
    `SELECT ${COLS.join(', ')} FROM sku_mapping WHERE ml_item_id = $1 AND active`,
    [String(itemId)],
  );
  return res.rows.map(rowToMapping);
}

export async function findByFalabellaSellerSku(sellerSku) {
  if (!sellerSku) return null;
  const res = await query(
    `SELECT ${COLS.join(', ')} FROM sku_mapping WHERE falabella_seller_sku = $1 AND active`,
    [String(sellerSku).trim()],
  );
  return rowToMapping(res.rows[0]);
}

export async function listAll({ activeOnly = true } = {}) {
  const where = activeOnly ? 'WHERE active' : '';
  const res = await query(`SELECT ${COLS.join(', ')} FROM sku_mapping ${where} ORDER BY sku`);
  return res.rows.map(rowToMapping);
}

/**
 * Upsert por sku (PK). Solo escribe campos provistos en el input (no pisa con null
 * los campos omitidos).
 */
export async function upsert(mapping) {
  if (!mapping || !mapping.sku) throw new Error('upsert: sku requerido');
  const sku = String(mapping.sku).trim();
  if (!sku) throw new Error('upsert: sku vacío');

  const fields = {
    shopify_variant_id: mapping.shopifyVariantId ?? null,
    shopify_inventory_item_id: mapping.shopifyInventoryItemId ?? null,
    ml_item_id: mapping.mlItemId ?? null,
    ml_variation_id: mapping.mlVariationId ?? null,
    falabella_seller_sku: mapping.falabellaSellerSku ?? sku,
    active: mapping.active ?? true,
    notes: mapping.notes ?? null,
  };

  const insertCols = ['sku', ...Object.keys(fields)];
  const insertVals = [sku, ...Object.values(fields)];
  const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');

  const updateSet = Object.keys(fields)
    .filter((k) => fields[k] !== null || k === 'active')
    .map((k) => `${k} = EXCLUDED.${k}`)
    .join(', ');

  const sql = `
    INSERT INTO sku_mapping (${insertCols.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (sku) DO UPDATE SET ${updateSet}
    RETURNING ${COLS.join(', ')}
  `;

  const res = await query(sql, insertVals);
  return rowToMapping(res.rows[0]);
}

/**
 * Bulk upsert dentro de una transacción. Útil para el seed.
 */
export async function bulkUpsert(mappings) {
  if (!Array.isArray(mappings) || mappings.length === 0) return [];
  return withTx(async (client) => {
    const out = [];
    for (const m of mappings) {
      const sku = String(m.sku).trim();
      const fields = {
        shopify_variant_id: m.shopifyVariantId ?? null,
        shopify_inventory_item_id: m.shopifyInventoryItemId ?? null,
        ml_item_id: m.mlItemId ?? null,
        ml_variation_id: m.mlVariationId ?? null,
        falabella_seller_sku: m.falabellaSellerSku ?? sku,
        active: m.active ?? true,
        notes: m.notes ?? null,
      };
      const insertCols = ['sku', ...Object.keys(fields)];
      const insertVals = [sku, ...Object.values(fields)];
      const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');
      const updateSet = Object.keys(fields)
        .filter((k) => fields[k] !== null || k === 'active')
        .map((k) => `${k} = EXCLUDED.${k}`)
        .join(', ');
      const sql = `
        INSERT INTO sku_mapping (${insertCols.join(', ')})
        VALUES (${placeholders})
        ON CONFLICT (sku) DO UPDATE SET ${updateSet}
        RETURNING ${COLS.join(', ')}
      `;
      const res = await client.query(sql, insertVals);
      out.push(rowToMapping(res.rows[0]));
    }
    return out;
  });
}

export async function setActive(sku, active) {
  if (!sku) throw new Error('setActive: sku requerido');
  const res = await query(
    `UPDATE sku_mapping SET active = $2 WHERE sku = $1 RETURNING ${COLS.join(', ')}`,
    [String(sku).trim(), Boolean(active)],
  );
  return rowToMapping(res.rows[0]);
}

export async function count() {
  const res = await query('SELECT COUNT(*)::int AS n FROM sku_mapping');
  return res.rows[0]?.n ?? 0;
}
