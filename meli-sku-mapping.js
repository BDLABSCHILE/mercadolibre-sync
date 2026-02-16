/**
 * Mapeo Meli item_id / variation_id → SKU. Una sola fuente de verdad para webhook y check-pending-orders.
 * Mismo contenido que update-all-skus.js (SKU_MAPPING) y update-skus.js (VARIATION_SKU_MAP).
 */
const MELI_SKU_MAPPING = {
  'CT-G-NE': { item_id: 'MLC3535073664', variation_id: 189654907244 },
  'CT-G-CAFGA': { item_id: 'MLC3535073664', variation_id: 189654907246 },
  'CT-G-CAM': { item_id: 'MLC3535073664', variation_id: 189654907248 },
  'CT-G-CAR': { item_id: 'MLC3535073664', variation_id: 189654907250 },
  'CT-G-DEN': { item_id: 'MLC3535073664', variation_id: 189654907252 },
  'CT-G-MOKA': { item_id: 'MLC3535073664', variation_id: 189654907254 },
  'CT-G-MUSE': { item_id: 'MLC3535073664', variation_id: 189654907256 },
  'CT-G-NEGA': { item_id: 'MLC3535073664', variation_id: 189654907258 },
  'PP-M-CAR': { item_id: 'MLC3539375298', variation_id: 196203833777 },
  'PP-M-CRU': { item_id: 'MLC3539375298', variation_id: 196203833779 },
  'PP-M-DENIM': { item_id: 'MLC3539375298', variation_id: 196203833781 },
  'PP-M-MOKA': { item_id: 'MLC3539375298', variation_id: 196203833783 },
  'PP-M-NEGRO': { item_id: 'MLC3539375298', variation_id: 196203833785 },
  'B-M-CAFGA': { item_id: 'MLC3539387920', variation_id: 189749736598 },
  'B-M-CAM': { item_id: 'MLC3539387920', variation_id: 189749736600 },
  'B-M-CAR': { item_id: 'MLC3539387920', variation_id: 189749736602 },
  'B-M-CHA': { item_id: 'MLC3539387920', variation_id: 189749736604 },
  'B-M-CRU': { item_id: 'MLC3539387920', variation_id: 189749736606 },
  'B-M-DEN': { item_id: 'MLC3539387920', variation_id: 189749736608 },
  'B-M-MIEL': { item_id: 'MLC3539387920', variation_id: 189749736610 },
  'B-M-MOKA': { item_id: 'MLC3539387920', variation_id: 189749736612 },
  'B-M-MUS': { item_id: 'MLC3539387920', variation_id: 189749736614 },
  'B-M-MUSE': { item_id: 'MLC3539387920', variation_id: 189749736616 },
  'B-M-NE': { item_id: 'MLC3539387920', variation_id: 189749736618 },
  'B-M-NEGA': { item_id: 'MLC3539387920', variation_id: 189749736620 },
  'B-M-SENE': { item_id: 'MLC3539387920', variation_id: 189749736622 },
  'MA-C-CAFGA': { item_id: 'MLC3539608750', variation_id: 196203871333 },
  'MA-C-CAM': { item_id: 'MLC3539608750', variation_id: 196203871335 },
  'MA-C-CAR': { item_id: 'MLC3539608750', variation_id: 196203871337 },
  'MA-C-CHA': { item_id: 'MLC3539608750', variation_id: 196203871339 },
  'MA-C-CRU': { item_id: 'MLC3539608750', variation_id: 196203871341 },
  'MA-C-DEN': { item_id: 'MLC3539608750', variation_id: 196203871343 },
  'MA-C-MIEL': { item_id: 'MLC3539608750', variation_id: 196203871345 },
  'MA-C-MOKA': { item_id: 'MLC3539608750', variation_id: 196203871347 },
  'MA-C-MUS': { item_id: 'MLC3539608750', variation_id: 196203871349 },
  'MA-C-MUSE': { item_id: 'MLC3539608750', variation_id: 196203871351 },
  'MA-C-NE': { item_id: 'MLC3539608750', variation_id: 196203871353 },
  'MA-C-NEGA': { item_id: 'MLC3539608750', variation_id: 196203871355 },
  'MA-C-SENE': { item_id: 'MLC3539608750', variation_id: 196203871357 },
  'TJ-C-NE': { item_id: 'MLC3539440116', variation_id: 189749808526 },
  'B-C-CAFGA': { item_id: 'MLC3539440132', variation_id: 189749808580 },
  'B-C-CAM': { item_id: 'MLC3539440132', variation_id: 189749808582 },
  'B-C-CAR': { item_id: 'MLC3539440132', variation_id: 189749808584 },
  'B-C-CHA': { item_id: 'MLC3539440132', variation_id: 189749808586 },
  'B-C-CRU': { item_id: 'MLC3539440132', variation_id: 189749808588 },
  'B-C-DEN': { item_id: 'MLC3539440132', variation_id: 189749808590 },
  'B-C-MIEL': { item_id: 'MLC3539440132', variation_id: 189749808592 },
  'B-C-MOKA': { item_id: 'MLC3539440132', variation_id: 189749808594 },
  'B-C-MUS': { item_id: 'MLC3539440132', variation_id: 189749808596 },
  'B-C-MUSE': { item_id: 'MLC3539440132', variation_id: 189749808598 },
  'B-C-NE': { item_id: 'MLC3539440132', variation_id: 189749808600 },
  'B-C-NEGA': { item_id: 'MLC3539440132', variation_id: 189749808602 },
  'B-C-SENE': { item_id: 'MLC3539440132', variation_id: 189749808604 },
  'B-G-CAFGA': { item_id: 'MLC3539440134', variation_id: 189749808606 },
  'B-G-CAM': { item_id: 'MLC3539440134', variation_id: 189749808608 },
  'B-G-CAR': { item_id: 'MLC3539440134', variation_id: 189749808610 },
  'B-G-CHA': { item_id: 'MLC3539440134', variation_id: 189749808612 },
  'B-G-CRU': { item_id: 'MLC3539440134', variation_id: 189749808614 },
  'B-G-DEN': { item_id: 'MLC3539440134', variation_id: 189749808616 },
  'B-G-MIEL': { item_id: 'MLC3539440134', variation_id: 189749808618 },
  'B-G-MOKA': { item_id: 'MLC3539440134', variation_id: 189749808620 },
  'B-G-MUS': { item_id: 'MLC3539440134', variation_id: 189749808622 },
  'B-G-MUSE': { item_id: 'MLC3539440134', variation_id: 189749808624 },
  'B-G-NE': { item_id: 'MLC3539440134', variation_id: 189749808626 },
  'B-G-NEGA': { item_id: 'MLC3539440134', variation_id: 189749808628 },
  'B-G-SENE': { item_id: 'MLC3539440134', variation_id: 189749808630 },
  'T-M-CAFGA': { item_id: 'MLC3539466112', variation_id: 196203745941 },
  'T-M-CAM': { item_id: 'MLC3539466112', variation_id: 196203745943 },
  'T-M-CAR': { item_id: 'MLC3539466112', variation_id: 196203745945 },
  'T-M-CHA': { item_id: 'MLC3539466112', variation_id: 196203745947 },
  'T-M-CRU': { item_id: 'MLC3539466112', variation_id: 196203745949 },
  'T-M-DEN': { item_id: 'MLC3539466112', variation_id: 196203745951 },
  'T-M-MIEL': { item_id: 'MLC3539466112', variation_id: 196203745953 },
  'T-M-MOKA': { item_id: 'MLC3539466112', variation_id: 196203745955 },
  'T-M-MUS': { item_id: 'MLC3539466112', variation_id: 196203745957 },
  'T-M-NE': { item_id: 'MLC3539466112', variation_id: 196203745959 },
  'T-M-NEGA': { item_id: 'MLC3539466112', variation_id: 196203745961 },
  'T-M-SENE': { item_id: 'MLC3539466112', variation_id: 196203745963 },
  'M-C-CAFGA': { item_id: 'MLC3539608746', variation_id: 196203871279 },
  'M-C-CAM': { item_id: 'MLC3539608746', variation_id: 196203871281 },
  'M-C-CAR': { item_id: 'MLC3539608746', variation_id: 196203871283 },
  'M-C-CHA': { item_id: 'MLC3539608746', variation_id: 196203871285 },
  'M-C-CRU': { item_id: 'MLC3539608746', variation_id: 196203871287 },
  'M-C-DEN': { item_id: 'MLC3539608746', variation_id: 196203871289 },
  'M-C-MIEL': { item_id: 'MLC3539608746', variation_id: 196203871291 },
  'M-C-MOKA': { item_id: 'MLC3539608746', variation_id: 196203871293 },
  'M-C-MUS': { item_id: 'MLC3539608746', variation_id: 196203871295 },
  'M-C-NE': { item_id: 'MLC3539608746', variation_id: 196203871297 },
  'M-C-NEGA': { item_id: 'MLC3539608746', variation_id: 196203871299 },
  'M-C-SENE': { item_id: 'MLC3539608746', variation_id: 196203871301 },
};

const MELI_VARIATION_SKU_MAP = {
  '189749746668': 'MA-G-CHA',
  '189749746686': 'MA-G-SENE',
  '189749746684': 'MA-G-NEGA',
  '189749746670': 'MA-G-CRU',
  '189749746672': 'MA-G-DEN',
  '189749746666': 'MA-G-CAR',
  '189749746676': 'MA-G-MOKA',
  '189749746664': 'MA-G-CAM',
  '189749746678': 'MA-G-MUS',
  '189749746662': 'MA-G-CAFGA',
  '189749746674': 'MA-G-MIEL',
  '189749746682': 'MA-G-NE',
  '189749746680': 'MA-G-MUSE',
};
const MELI_EXTRA_ITEM_ID = 'MLC3539517694';

const meliVariationIdToSku = new Map();
const meliItemIdToSkus = new Map();
for (const [sku, data] of Object.entries(MELI_SKU_MAPPING)) {
  meliVariationIdToSku.set(String(data.variation_id), sku);
  const list = meliItemIdToSkus.get(data.item_id) || [];
  if (!list.includes(sku)) list.push(sku);
  meliItemIdToSkus.set(data.item_id, list);
}
for (const [variationId, sku] of Object.entries(MELI_VARIATION_SKU_MAP)) {
  meliVariationIdToSku.set(String(variationId), sku);
  const list = meliItemIdToSkus.get(MELI_EXTRA_ITEM_ID) || [];
  if (!list.includes(sku)) list.push(sku);
  meliItemIdToSkus.set(MELI_EXTRA_ITEM_ID, list);
}

/**
 * Resuelve SKU a partir de item_id y variation_id (misma lógica que webhook).
 * @returns {{ sku: string | null, ambiguous?: boolean }}
 */
function resolveSkuFromOrderItem(itemId, variation_id) {
  let sku = null;
  if (variation_id != null && variation_id !== '') {
    sku = meliVariationIdToSku.get(String(variation_id)) ?? null;
  } else {
    const skusForItem = meliItemIdToSkus.get(itemId) || [];
    if (skusForItem.length === 1) {
      sku = skusForItem[0];
    } else if (skusForItem.length > 1) {
      return { sku: null, ambiguous: true };
    }
  }
  return { sku };
}

export {
  meliVariationIdToSku,
  meliItemIdToSkus,
  resolveSkuFromOrderItem,
};
