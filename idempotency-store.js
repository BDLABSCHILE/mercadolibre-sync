// Stub simple de Idempotency Store
// Mantiene compatibilidad con webhook-server.js
// NO usa FS, NO usa Redis, NO tiene efectos colaterales.

class IdempotencyStore {
  constructor(_name) {
    this._store = new Set();
  }

  has(key) {
    return this._store.has(String(key));
  }

  mark(key) {
    this._store.add(String(key));
  }
}

// Factory esperada por webhook-server.js
export function createIdempotencyStore(name) {
  return new IdempotencyStore(name);
}

export default IdempotencyStore;
