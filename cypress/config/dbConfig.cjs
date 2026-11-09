const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const pinned = require('./staging-db-host.json');

module.exports = function dbConfig() {
  const localPath = path.join(__dirname, 'dbConfig.local.json');
  const local = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, 'utf8')).staging?.db : {};
  const settings = {
    host: local?.host || process.env.DB_HOST,
    user: local?.user || process.env.DB_USER,
    password: local?.password || process.env.DB_PASSWORD,
    port: local?.port || process.env.DB_PORT || 3306,
    database: local?.database || process.env.DB_DATABASE || 'core',
  };
  for (const key of ['host', 'user', 'password']) {
    if (!settings[key]) throw new Error(`Missing DB ${key}; configure cypress/config/dbConfig.local.json or private environment.`);
  }
  const host = settings.host.trim().toLowerCase();
  if (crypto.createHash('sha256').update(host).digest('hex') !== pinned.sha256) {
    throw new Error('DB host does not match the verified Genergy staging server.');
  }
  if (settings.database !== 'core') throw new Error('Use staging core schema.');
  return {
    host,
    port: Number(settings.port),
    user: settings.user,
    password: settings.password,
    database: 'core',
    dateStrings: true,
    decimalNumbers: true,
    multipleStatements: false,
    connectionLimit: 3,
    connectTimeout: 20000,
    ...(process.env.DB_SSL !== 'false' ? {
      ssl: {
        rejectUnauthorized: process.env.DB_TLS_REJECT_UNAUTHORIZED !== 'false',
        ca: fs.readFileSync(process.env.DB_CA_FILE || path.join(__dirname, 'certs/aws-rds-global.pem')),
      },
    } : {}),
  };
};
