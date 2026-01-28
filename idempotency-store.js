// Stub simple de Idempotency Store
// Mantiene compatibilidad con webhook-server.js
// NO usa FS, NO usa Redis, NO tiene efectos colaterales.

class IdempotencyStore {
  constructor() {
    this._store = new Set();
  }

  async has(key) {
    return this._store.has(key);
  }

  async add(key) {
    this._store.add(key);
    return true;
  }

  async delete(key) {
    this._store.delete(key);
  }
}

// Factory esperada por webhook-server.js
export function createIdempotencyStore() {
  return new IdempotencyStore();
}

export default IdempotencyStore;
