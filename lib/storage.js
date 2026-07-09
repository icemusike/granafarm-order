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
  return createJsonStorage(path.join(__dirname, '..', 'data'));
}

module.exports = { createStorage };
