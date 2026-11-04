const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local'), quiet: true });
const { Database } = require('../cypress/tasks/database.cjs');
const config = require('../cypress/config/dbConfig.cjs');

(async () => {
  const { faker } = await import('@faker-js/faker');
  const db = new Database(config(), path.join(__dirname, '..'));
  let inserted = 0;
  try {
    await db.health();
    const run = await db.start();
    const portfolio = { kind: 'portfolio', number: `${run.prefix}P00001`, name: `Auto_Portfolio_${run.id}_${faker.company.name()}`.slice(0, 95) };
    const building = { kind: 'building', number: `${run.prefix}B00001`, name: `Auto_Building_${run.id}_${faker.company.name()}`.slice(0, 95) };
    await db.reserve(portfolio);
    await db.reserve(building);
    const [[region]] = await db.pool.query('SELECT id FROM core.region WHERE is_offline = 0 LIMIT 1');
    const [[type]] = await db.pool.query('SELECT id FROM core.property_type WHERE is_offline = 0 LIMIT 1');
    assert.ok(region && type, 'Reference data required for an isolated cleanup probe');
    const [parent] = await db.pool.execute('INSERT INTO core.portfolio (name,portfolio_number,created_by,created_at,is_offline) VALUES (?,?,?,NOW(),0)', [portfolio.name, portfolio.number, 'UMQA']);
    inserted++;
    await db.pool.execute('INSERT INTO core.building (portfolio_id,name,building_number,region_id,property_type_id,created_by,created_at,is_offline) VALUES (?,?,?,?,?,?,NOW(),0)', [parent.insertId, building.name, building.number, region.id, String(type.id), 'UMQA']);
    inserted++;
    const first = await db.cleanup();
    assert.equal(first.deleted, inserted);
    assert.equal((await db.lookup('portfolio', portfolio.number)).length, 0);
    assert.equal((await db.lookup('building', building.number)).length, 0);
    assert.equal((await db.cleanup()).deleted, 0);
    console.log(JSON.stringify({ stagingConnection: true, inserted, deleted: first.deleted, remaining: 0, repeatedCleanupSafe: true, runId: run.id }));
  } finally {
    try { if (db.run) await db.cleanup(); }
    finally { await db.close(); }
  }
})().catch(error => { console.error(`Cleanup integration check failed: ${error.code || error.message}`); process.exitCode = 1; });
