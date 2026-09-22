import { query } from '../index.js';

const COLS = 'provider, refresh_token, updated_at';

function rowToCredential(r) {
  if (!r) return null;
  return {
    provider: r.provider,
    refreshToken: r.refresh_token,
    updatedAt: r.updated_at,
  };
}

export async function get(provider) {
  const res = await query(
    `SELECT ${COLS} FROM oauth_credentials WHERE provider = $1`,
    [provider],
  );
  return rowToCredential(res.rows[0]);
}

export async function upsertRefreshToken(provider, refreshToken) {
  const res = await query(
    `INSERT INTO oauth_credentials (provider, refresh_token, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (provider) DO UPDATE
       SET refresh_token = EXCLUDED.refresh_token,
           updated_at = EXCLUDED.updated_at
     RETURNING ${COLS}`,
    [provider, refreshToken],
  );
  return rowToCredential(res.rows[0]);
}
