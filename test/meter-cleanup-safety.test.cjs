const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Database } = require('../cypress/tasks/database.cjs');

test('Meter reservation refuses shared parents, existing identities and duplicates before saving', async () => {
  const prefix = 'Auto_a123456789bc_';
  const parent = { kind: 'building', number: `${prefix}B001`, name: 'Auto_Building_a123456789bc_Test' };
  let existing = false, saves = 0;
  const db = new Database({}, process.cwd(), { async execute(sql) {
    if (sql.startsWith('SELECT * FROM core.building')) return [[{ id: 200, name: parent.name, building_number: parent.number }]];
    if (sql.startsWith('SELECT meter_id FROM core.meter')) return [existing ? [{ meter_id: 300 }] : []];
    throw new Error(`Unexpected query: ${sql}`);
  } });
  db.run = { id: 'a123456789bc', prefix, fixtures: [parent] };
  db.save = async () => { saves++; };
  const meter = { buildingNumber: parent.number, number: `${prefix}M001`, marker: 'Auto_Meter_a123456789bc_Test', utilityId: 2 };
  await assert.rejects(db.reserveMeter({ ...meter, buildingNumber: 'shared' }), /registered Building/);
  await assert.rejects(db.reserveMeter({ ...meter, marker: 'unowned' }), /exact run identities/);
  existing = true;
  await assert.rejects(db.reserveMeter(meter), /adoption is refused/);
  existing = false;
  await db.reserveMeter(meter);
  await assert.rejects(db.reserveMeter(meter), /already exists or is registered/);
  assert.equal(saves, 1);
  assert.deepEqual(parent.meters, [{ number: meter.number, marker: meter.marker, utilityId: 2 }]);
});

for (const fault of [null, 'unregistered', 'old', 'reading', 'assignment']) {
  test(`physical Meter cleanup ${fault ? `refuses ${fault} before DELETE` : 'deletes Meter before Building and Portfolio'}`, async () => {
    const prefix = 'Auto_a123456789bc_';
    const portfolio = { kind: 'portfolio', number: `${prefix}P001`, name: 'Auto_Portfolio_a123456789bc_Test' };
    const building = { kind: 'building', number: `${prefix}B001`, name: 'Auto_Building_a123456789bc_Test', meters: [{ number: `${prefix}M001`, marker: 'Auto_Meter_a123456789bc_Test', utilityId: 2 }] };
    const time = '2026-10-31 10:00:01';
    const meter = { meter_id: 300, meter_number: fault === 'unregistered' ? 'shared' : `${prefix}M001`, building_number: building.number,
      location: building.meters[0].marker, utility_id: 2, is_virtual: 0, source_meter_id: null,
      lease_utility_id: fault === 'assignment' ? 999 : null, qa_created_at_utc: fault === 'old' ? '2020-01-01 00:00:00' : time };
    const commands = [];
    let rolledBack = false;
    const connection = {
      async beginTransaction() {}, async commit() {}, async rollback() { rolledBack = true; }, release() {},
      async execute(sql) {
        commands.push(sql);
        if (sql.startsWith('SELECT *,') && sql.includes('FROM core.portfolio ')) return [[{ id: 100, name: portfolio.name, portfolio_number: portfolio.number, qa_created_at_utc: time }]];
        if (sql.startsWith('SELECT *,') && sql.includes('FROM core.building ')) return [[{ id: 200, portfolio_id: 100, name: building.name, building_number: building.number, qa_created_at_utc: time }]];
        if (sql.startsWith('SELECT *,') && sql.includes('FROM core.meter ')) return [[meter]];
        if (sql.startsWith('SELECT id FROM core.building')) return [[{ id: 200 }]];
        if (sql.includes('FROM information_schema.COLUMNS')) return [[{ TABLE_SCHEMA: 'readings', TABLE_NAME: 'consumption', COLUMN_NAME: 'meter_id' }]];
        if (sql.startsWith('SELECT COUNT(*)')) return [[{ n: fault === 'reading' && sql.includes('`readings`.`consumption`') ? 1 : 0 }]];
        if (sql.startsWith('SELECT')) return [[]];
        if (sql.startsWith('DELETE')) return [{ affectedRows: 1 }];
        throw new Error(`Unexpected query: ${sql}`);
      },
    };
    const db = new Database({}, process.cwd(), { async getConnection() { return connection; } });
    db.run = { id: 'a123456789bc', prefix, startedAt: '2026-10-31 10:00:00', fixtures: [portfolio, building] };
    db.save = async () => {};
    if (fault) {
      await assert.rejects(db.cleanup(), /Cleanup refused:/);
      assert.equal(rolledBack, true);
      assert.equal(commands.some(sql => sql.startsWith('DELETE')), false);
    } else {
      const result = await db.cleanup();
      assert.equal(result.deleted, 3);
      assert.equal(rolledBack, false);
      const meterDelete = commands.findIndex(sql => sql.startsWith('DELETE FROM core.meter WHERE'));
      const buildingDelete = commands.findIndex(sql => sql.startsWith('DELETE FROM core.building WHERE'));
      const portfolioDelete = commands.findIndex(sql => sql.startsWith('DELETE FROM core.portfolio WHERE'));
      assert.ok(meterDelete >= 0 && buildingDelete > meterDelete && portfolioDelete > buildingDelete);
      assert.equal(commands.some(sql => /DELETE FROM .*readings/.test(sql)), false);
    }
  });
}
