-- Estado por item dentro de una orden de marketplace.
-- Granularidad necesaria para retry seguro: si una orden tiene 3 items y 2 ya
-- se descontaron en Shopify pero 1 falló, al reintentar la orden NO debemos
-- volver a descontar los 2 exitosos.
CREATE TABLE marketplace_order_items (
  platform           text NOT NULL,
  order_id           text NOT NULL,
  item_key           text NOT NULL,
  sku                text,
  quantity           integer,
  status             text NOT NULL CHECK (status IN (
    'processed', 'failed', 'sku_not_found', 'ambiguous_no_variation', 'skipped'
  )),
  shopify_stock_after integer,
  error              text,
  processed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, order_id, item_key),
  FOREIGN KEY (platform, order_id) REFERENCES marketplace_orders(platform, order_id) ON DELETE CASCADE
);

CREATE INDEX idx_order_items_sku ON marketplace_order_items(sku) WHERE sku IS NOT NULL;
CREATE INDEX idx_order_items_status ON marketplace_order_items(status, processed_at);
