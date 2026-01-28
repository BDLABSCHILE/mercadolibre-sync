
cat > falabella-api.js << 'EOF'
// Stub seguro para Falabella Seller Center API.
// Evita fallos de import y garantiza que NUNCA se hagan llamadas reales
// mientras ENABLE_FALABELLA !== 'true'.

export default class FalabellaAPI {
  constructor() {
    // No inicializar nada real aquí.
  }

  _notEnabled() {
    throw new Error(
      'Falabella API not enabled. Set ENABLE_FALABELLA=true and provide a real implementation.'
    );
  }

  async getOrderItems(_orderId) {
    this._notEnabled();
  }

  async updateStockBySKU(_sku, _quantity) {
    this._notEnabled();
  }

  async call(_action, _extraParams = {}, _options = {}) {
    this._notEnabled();
  }
}
