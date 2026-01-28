// Stub simple de IdempotencyStore
// Permite que el server arranque sin romper lógica existente.
// Implementación real puede reemplazarse luego (Redis / DB / File).

export class IdempotencyStore {
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

export default IdempotencyStore;
