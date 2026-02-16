/**
 * Script temporal de diagnóstico: obtiene una orden de MercadoLibre e imprime el JSON completo.
 * Uso: node debug-order.js
 * No modifica el sistema. Solo lectura.
 */
import MercadoLibreAPI from './mercadolibre-api.js';
import dotenv from 'dotenv';

dotenv.config();

const ORDER_ID = '2000015148691602';

async function main() {
  const meli = new MercadoLibreAPI();
  const response = await meli.client.get(`/orders/${ORDER_ID}`);
  const order = response.data;
  console.log(JSON.stringify(order, null, 2));
}

main().catch((err) => {
  console.error(err.response?.data || err.message);
  process.exit(1);
});
