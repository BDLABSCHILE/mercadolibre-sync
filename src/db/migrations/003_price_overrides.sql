-- Overrides de la regla general de precios (shopify * markup → redondeo a 990).
-- Aplica por SKU o por familia (un prefijo lógico, ej. "B-M"). Si hay overrides de
-- ambos scopes, el de SKU gana (más específico).
--
-- Tipos:
--   'absolute'         → value es el precio final exacto (ej. 58990)
--   'discount_fixed'   → target_general - value (en pesos, ej. value=3000 baja $3.000)
--   'discount_percent' → target_general * (1 - value/100) (ej. value=5 baja 5%)
--   'custom_markup'    → shopify * value, redondeado a config.PRICE_ROUND_ENDING (ej. value=1.4 usa markup 1.4)
--
-- platform: 'mercadolibre' | 'falabella' | 'all' (aplica a ambos marketplaces).
-- vigencia: valid_from / valid_until son timestamptz opcionales; null = sin restricción.
--
-- active: soft-delete. Borrar = setear active=false (conserva historial).

CREATE TABLE price_overrides (
  id            bigserial PRIMARY KEY,
  scope         text NOT NULL CHECK (scope IN ('sku', 'family')),
  key           text NOT NULL,
  platform      text NOT NULL CHECK (platform IN ('mercadolibre', 'falabella', 'all')),
  override_type text NOT NULL CHECK (override_type IN ('absolute', 'discount_fixed', 'discount_percent', 'custom_markup')),
  value         numeric(12, 4) NOT NULL,
  valid_from    timestamptz,
  valid_until   timestamptz,
  note          text,
  active        boolean NOT NULL DEFAULT true,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from)
);

-- Lookup eficiente: dado (sku, platform, ahora), traer overrides activos.
CREATE INDEX idx_price_overrides_active_lookup
  ON price_overrides(scope, key, platform, active);

CREATE INDEX idx_price_overrides_valid_range
  ON price_overrides(valid_from, valid_until)
  WHERE active = true;

-- Trigger updated_at
CREATE TRIGGER price_overrides_updated_at
  BEFORE UPDATE ON price_overrides
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
