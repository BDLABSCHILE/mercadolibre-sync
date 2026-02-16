// Idempotency Store: memoria o archivo (persiste entre reinicios/deploys).
// Con IDEMPOTENCY_STORE=file, el job y el webhook comparten el mismo estado y no se reprocesan órdenes.

import fs from 'fs';
import path from 'path';

const USE_FILE = (process.env.IDEMPOTENCY_STORE || 'memory').toLowerCase() === 'file';
const IDEMPOTENCY_DIR = process.env.IDEMPOTENCY_FILE_DIR || process.cwd();

class MemoryIdempotencyStore {
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

class FileIdempotencyStore {
  constructor(name) {
    this._name = name;
    this._filePath = path.join(IDEMPOTENCY_DIR, `idempotency-${name}.json`);
    this._store = new Set(this._load());
  }

  _load() {
    try {
      const raw = fs.readFileSync(this._filePath, 'utf8');
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  _save() {
    try {
      const arr = [...this._store];
      fs.writeFileSync(this._filePath, JSON.stringify(arr, null, 0), 'utf8');
    } catch (err) {
      console.error(`[idempotency] Error guardando ${this._filePath}:`, err.message);
    }
  }

  has(key) {
    return this._store.has(String(key));
  }

  mark(key) {
    const k = String(key);
    this._store.add(k);
    this._save();
  }
}

export function createIdempotencyStore(name) {
  if (USE_FILE) {
    return new FileIdempotencyStore(name);
  }
  return new MemoryIdempotencyStore(name);
}

export default createIdempotencyStore;
