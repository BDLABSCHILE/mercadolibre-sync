-- Mapeo SKU ↔ identificadores en cada plataforma. Reemplaza meli-sku-mapping.js.
CREATE TABLE sku_mapping (
  sku                          text PRIMARY KEY,
  shopify_variant_id           bigint,
  shopify_inventory_item_id    bigint,
  ml_item_id                   text,
  ml_variation_id              bigint,
  falabella_seller_sku         text,
  active                       boolean NOT NULL DEFAULT true,
  notes                        text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sku_mapping_ml_variation ON sku_mapping(ml_variation_id) WHERE ml_variation_id IS NOT NULL;
CREATE INDEX idx_sku_mapping_ml_item ON sku_mapping(ml_item_id) WHERE ml_item_id IS NOT NULL;
CREATE INDEX idx_sku_mapping_shopify_inv ON sku_mapping(shopify_inventory_item_id) WHERE shopify_inventory_item_id IS NOT NULL;

-- Estado conocido por SKU + plataforma. Se usa para "debounce por valor" en el worker.
CREATE TABLE platform_state (
  sku             text NOT NULL REFERENCES sku_mapping(sku) ON DELETE CASCADE,
  platform        text NOT NULL CHECK (platform IN ('shopify', 'mercadolibre', 'falabella')),
  stock           integer,
  price           numeric(12, 2),
  last_synced_at  timestamptz,
  last_source     text,
  PRIMARY KEY (sku, platform)
);

-- Log de eventos entrantes (idempotencia primaria). delivery_id viene del header del webhook.
CREATE TABLE webhook_events (
  delivery_id   text PRIMARY KEY,
  source        text NOT NULL CHECK (source IN ('shopify', 'mercadolibre', 'falabella')),
  topic         text,
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'enqueued', 'processed', 'failed', 'ignored')),
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  error         text
);

CREATE INDEX idx_webhook_events_status ON webhook_events(status, received_at);
CREATE INDEX idx_webhook_events_source_topic ON webhook_events(source, topic);

-- Órdenes externas procesadas (idempotencia granularidad orden).
CREATE TABLE marketplace_orders (
  platform         text NOT NULL CHECK (platform IN ('mercadolibre', 'falabella')),
  order_id         text NOT NULL,
  status           text NOT NULL CHECK (status IN ('new', 'processing', 'processed', 'partial', 'failed')),
  raw              jsonb,
  items            jsonb,
  processed_items  integer NOT NULL DEFAULT 0,
  failed_items     integer NOT NULL DEFAULT 0,
  first_seen       timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  PRIMARY KEY (platform, order_id)
);

-- Log append-only de cambios de stock para auditoría.
CREATE TABLE stock_events (
  id          bigserial PRIMARY KEY,
  sku         text NOT NULL,
  platform    text NOT NULL,
  source      text NOT NULL,
  source_ref  text,
  delta       integer,
  new_value   integer NOT NULL,
  ok          boolean NOT NULL,
  error       text,
  ts          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_events_sku_ts ON stock_events(sku, ts DESC);
CREATE INDEX idx_stock_events_source_ts ON stock_events(source, ts DESC);

-- Lock por SKU para serializar workers (alternativa a Redis).
CREATE TABLE sku_locks (
  sku          text PRIMARY KEY,
  owner        text NOT NULL,
  acquired_at  timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

CREATE INDEX idx_sku_locks_expires ON sku_locks(expires_at);

-- Trigger para mantener updated_at en sku_mapping.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sku_mapping_updated_at
  BEFORE UPDATE ON sku_mapping
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
