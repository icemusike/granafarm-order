/**
 * Selectează backend-ul de stocare:
 *   - PostgreSQL dacă DATABASE_URL este setat (producție)
 *   - fișier JSON altfel (dezvoltare locală)
 */

const path = require('path');
const { createPostgresStorage } = require('./storage-postgres');
const { createJsonStorage } = require('./storage-json');

function createStorage() {
  if (process.env.DATABASE_URL) {
    return createPostgresStorage(process.env.DATABASE_URL);
  }
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', 'data');
  return createJsonStorage(dataDir);
}

module.exports = { createStorage };
