-- Waitlist "Avísame cuando llegue" (reemplazo de la app SW Back in Stock).
-- Quién espera qué SKU. El aviso sale vía Pulpo (POST /api/v1/track, evento back_in_stock)
-- cuando el stock de Shopify vuelve a ser > 0 (webhook inventory o reconciliación).
--
-- Semántica de estados (por fila):
--   pendiente : notified_at IS NULL
--   reclamada : notified_at NOT NULL, sent_at NULL   (claim por fila justo antes de enviar;
--               si el proceso muere aquí, recover_stale la devuelve a pendiente → at-least-once)
--   enviada   : sent_at NOT NULL                     ("enviada" = Pulpo aceptó el evento con 202;
--               la entrega real depende de que el flow esté LIVE en Pulpo)
CREATE TABLE back_in_stock_waitlist (
  id             bigserial PRIMARY KEY,
  sku            text NOT NULL,
  email          text NOT NULL,
  phone          text,
  product_title  text,
  product_url    text,
  source         text NOT NULL DEFAULT 'storefront',
  created_at     timestamptz NOT NULL DEFAULT now(),
  notified_at    timestamptz,
  sent_at        timestamptz,
  notify_error   text
);

-- Un mismo correo no puede esperar dos veces el mismo SKU (re-suscribirse actualiza la fila).
CREATE UNIQUE INDEX uq_bis_waitlist_sku_email ON back_in_stock_waitlist (upper(sku), lower(email));
-- Lookup rápido de pendientes por SKU (el caso de uso principal).
CREATE INDEX idx_bis_waitlist_pending ON back_in_stock_waitlist (upper(sku)) WHERE notified_at IS NULL;
