-- Credenciales OAuth rotativas por proveedor. MercadoLibre rota refresh_token en cada uso.
CREATE TABLE oauth_credentials (
  provider      text PRIMARY KEY,
  refresh_token text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
