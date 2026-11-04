const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local'), quiet: true });
const { Database } = require('../cypress/tasks/database.cjs');
const config = require('../cypress/config/dbConfig.cjs');

(async () => {
  const db = new Database(config(), path.join(__dirname, '..'));
  try { console.log(JSON.stringify(await db.health())); }
  finally { await db.close(); }
})().catch(error => {
  console.error(`Staging DB connection check failed (${error.code || error.name}).`);
  if (error.code === 'HANDSHAKE_SSL_ERROR') console.error(error.message);
  process.exitCode = 1;
});
