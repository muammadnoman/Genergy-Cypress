const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const pinned = require('./staging-db-host.json');

module.exports = function dbConfig() {
  for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD']) {
    if (!process.env[key]) throw new Error(`Missing ${key}; configure .env.local or CI secrets.`);
  }
  const host = process.env.DB_HOST.trim().toLowerCase();
  if (crypto.createHash('sha256').update(host).digest('hex') !== pinned.sha256) {
    throw new Error('DB host does not match the verified Genergy staging server.');
  }
  if ((process.env.DB_DATABASE || 'core') !== 'core') throw new Error('Use staging core schema.');
  return {
    host,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'core',
    dateStrings: true,
    decimalNumbers: true,
    multipleStatements: false,
    connectionLimit: 3,
    connectTimeout: 20000,
    ...(process.env.DB_SSL === 'true' ? {
      ssl: {
        rejectUnauthorized: process.env.DB_TLS_REJECT_UNAUTHORIZED !== 'false',
        ca: fs.readFileSync(process.env.DB_CA_FILE || path.join(__dirname, 'certs/aws-rds-global.pem')),
      },
    } : {}),
  };
};
