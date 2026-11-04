const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Database, assertRunId, assertOwnership } = require('../cypress/tasks/database.cjs');

test('tenant reservation requires an owned building and a run-prefixed initial lease', async () => {
  const prefix = 'Auto_a123456789bc_';
  const parent = { kind: 'building', number: `${prefix}B001` };
  const db = new Database({}, process.cwd(), { async execute(sql) {
    if (sql.startsWith('SELECT * FROM core.building')) return [[{ id: 200, building_number: parent.number, name: 'Auto_Building_a123456789bc_Test' }]];
    if (sql.startsWith('SELECT id FROM core.tenant')) return [[]];
    throw new Error('Unexpected query');
  } });
  db.run = { id: 'a123456789bc', prefix, fixtures: [parent] };
  db.save = async () => {};
  const tenant = { kind: 'tenant', number: `${prefix}T001`, name: 'Auto_Tenant_a123456789bc_Test', buildingNumber: parent.number, leaseMarker: 'Auto_Lease_a123456789bc_Test' };
  await assert.rejects(db.reserve({ ...tenant, buildingNumber: 'shared' }), /owned building/);
  await assert.rejects(db.reserve({ ...tenant, leaseMarker: 'Auto_Lease_ffffffffffff_Test' }), /initial lease marker/);
  await db.reserve(tenant);
  assert.equal(db.run.fixtures[1].buildingNumber, parent.number);
  assert.equal(db.run.fixtures[1].leaseMarker, tenant.leaseMarker);
});

test('additional lease registration rejects shared parents, existing rows and repeated markers', async () => {
  const parent = { kind: 'tenant', number: 'Auto_a123456789bc_T001', buildingNumber: 'Auto_a123456789bc_B001', leaseMarker: 'Auto_Lease_a123456789bc_First' };
  let exists = false;
  let saved = 0;
  const db = new Database({}, process.cwd(), { async execute(sql, params) {
    if (sql.startsWith('SELECT * FROM core.tenant')) return [[{ id: 300, tenant_number: parent.number, tenant_name: 'Auto_Tenant_a123456789bc_Test', building_number: parent.buildingNumber }]];
    if (sql.startsWith('SELECT id FROM core.lease')) {
      assert.equal(params[0], 300);
      return [exists ? [{ id: 401 }] : []];
    }
    throw new Error('Unexpected query');
  } });
  db.run = { id: 'a123456789bc', prefix: 'Auto_a123456789bc_', fixtures: [parent] };
  db.save = async () => { saved++; };
  const fixture = { tenantNumber: parent.number, marker: 'Auto_Lease_a123456789bc_Second' };
  await assert.rejects(db.reserveLease({ ...fixture, tenantNumber: 'shared' }), /owned tenant/);
  await assert.rejects(db.reserveLease({ ...fixture, marker: 'Auto_Lease_ffffffffffff_Second' }), /owned tenant/);
  exists = true;
  await assert.rejects(db.reserveLease(fixture), /already exists/);
  exists = false;
  await db.reserveLease(fixture);
  assert.equal(saved, 1);
  assert.deepEqual(parent.leaseMarkers, [fixture.marker]);
  await assert.rejects(db.reserveLease(fixture), /already exists/);
});

test('Lease children and notes require an exact owned Lease and cannot adopt existing records', async () => {
  const parent = { kind: 'tenant', number: 'Auto_a123456789bc_T001', buildingNumber: 'Auto_a123456789bc_B001', leaseMarker: 'Auto_Lease_a123456789bc_Test' };
  let existing = false;
  let saved = 0;
  const db = new Database({}, process.cwd(), { async execute(sql, params) {
    if (sql.startsWith('SELECT * FROM core.tenant')) return [[{ id: 300, tenant_number: parent.number, tenant_name: 'Auto_Tenant_a123456789bc_Test', building_number: parent.buildingNumber }]];
    if (sql.startsWith('SELECT * FROM core.lease WHERE')) return [params[0] === 400 ? [{ id: 400, tenant_id: 300, location: parent.leaseMarker, building_number: parent.buildingNumber }] : []];
    if (sql.startsWith('SELECT * FROM core.lease_utility WHERE')) return [params[0] === 500 ? [{ id: 500, lease_id: 400, utility_id: 1 }] : []];
    if (sql.startsWith('SELECT id FROM core.lease_') || sql.startsWith('SELECT id FROM core.note')) return [existing ? [{ id: 500 }] : []];
    throw new Error('Unexpected query');
  } });
  db.run = { id: 'a123456789bc', prefix: 'Auto_a123456789bc_', fixtures: [parent] };
  db.save = async () => { saved++; };
  const child = { tenantNumber: parent.number, leaseId: 400, type: 'utility', utilityId: 1 };
  await assert.rejects(db.reserveLeaseChild({ ...child, tenantNumber: 'shared' }), /registered Tenant/);
  await assert.rejects(db.reserveLeaseChild({ ...child, leaseId: 999 }), /unowned Lease/);
  await assert.rejects(db.reserveLeaseChild({ ...child, utilityId: 0 }), /exact Utility/);
  await assert.rejects(db.reserveLeaseChild({ ...child, type: 'attribute', marker: 'shared' }), /run-prefixed marker/);
  existing = true;
  await assert.rejects(db.reserveLeaseChild(child), /already exists/);
  existing = false;
  await db.reserveLeaseChild(child);
  await assert.rejects(db.reserveLeaseChild(child), /already exists/);
  await db.reserveLeaseChild({ ...child, type: 'attribute', marker: 'Auto_Attribute_a123456789bc_Test' });
  await db.reserveNote({ entityKind: 'lease', entityNumber: parent.number, entityId: 400, marker: 'Auto_Note_a123456789bc_Lease', kind: 'note' });
  await assert.rejects(db.reserveLeaseChild({ ...child, type: 'utility_attribute', leaseUtilityId: 999, marker: 'Auto_Attribute_a123456789bc_Utility' }), /must already exist/);
  await db.reserveLeaseChild({ ...child, type: 'utility_attribute', leaseUtilityId: 500, marker: 'Auto_Attribute_a123456789bc_Utility' });
  await db.reserveNote({ entityKind: 'lease_utility', entityNumber: parent.number, entityId: 500, marker: 'Auto_Note_a123456789bc_Utility', kind: 'note' });
  await assert.rejects(db.reserveLeaseChild({ ...child, type: 'utility_attribute', leaseUtilityId: 500, marker: 'Auto_Attribute_a123456789bc_Utility' }), /already exists/);
  const registered = parent.leaseChildren;
  parent.leaseChildren = [];
  await assert.rejects(db.reserveNote({ entityKind: 'lease_utility', entityNumber: parent.number, entityId: 500, marker: 'Auto_Note_a123456789bc_Unregistered', kind: 'note' }), /not registered/);
  parent.leaseChildren = registered;
  assert.equal(saved, 5);
  assert.equal(parent.leaseChildren.length, 3);
  assert.equal(parent.notes[0].entityType, 'Lease');
  assert.equal(parent.notes[0].entityId, 400);
});

for (const fault of [null, 'tenant', 'lease', 'oldLease', 'utility', 'attribute', 'unregisteredLeaseNote', 'oldUtility', 'childMeter', 'childBill', 'registeredChildren', 'unregisteredLease', 'duplicateLease', 'registeredSecondLease', 'utilityAttribute', 'oldUtilityAttribute', 'unregisteredUtilityNote', 'registeredUtilitySegments']) {
  test(`Tenant cleanup ${fault && !['registeredSecondLease', 'registeredChildren', 'registeredUtilitySegments'].includes(fault) ? `refuses ${fault} before any DELETE` : 'deletes registered children before lease and parent records'}`, async () => {
    const prefix = 'Auto_a123456789bc_';
    const stamp = { created_at: '2026-10-24 06:00:01', qa_created_at_utc: '2026-10-24 10:00:01' };
    const portfolio = { ...stamp, id: 100, portfolio_number: `${prefix}P001`, name: 'Auto_Portfolio_a123456789bc_Test' };
    const building = { ...stamp, id: 200, portfolio_id: 100, building_number: `${prefix}B001`, name: 'Auto_Building_a123456789bc_Test' };
    const tenant = { ...stamp, id: 300, tenant_number: `${prefix}T001`, tenant_name: 'Auto_Tenant_a123456789bc_Test', building_number: building.building_number };
    const lease = { ...stamp, id: 400, tenant_id: 300, building_number: building.building_number, location: 'Auto_Lease_a123456789bc_Test' };
    const leases = [lease];
    if (['unregisteredLease', 'duplicateLease', 'registeredSecondLease'].includes(fault)) leases.push({ ...lease, id: 401,
      location: fault === 'duplicateLease' ? `${lease.location} Updated` : 'Auto_Lease_a123456789bc_Second' });
    if (fault === 'lease') lease.location = 'shared lease';
    if (fault === 'oldLease') lease.qa_created_at_utc = '2020-01-01 00:00:00';
    const withChildren = ['registeredChildren', 'childMeter', 'childBill', 'oldUtility', 'utilityAttribute', 'oldUtilityAttribute', 'unregisteredUtilityNote', 'registeredUtilitySegments'].includes(fault);
    const utility = { ...stamp, id: 500, lease_id: lease.id, utility_id: 1 };
    if (fault === 'oldUtility') utility.qa_created_at_utc = '2020-01-01 00:00:00';
    const attribute = { ...stamp, id: 501, lease_id: lease.id, attribute_key: 'Auto_Attribute_a123456789bc_Test' };
    const note = { ...stamp, id: 502, entity_type: 'Lease', entity_id: lease.id, kind: 'note', body: 'Auto_Note_a123456789bc_Lease' };
    const utilityAttribute = { ...stamp, id: 503, lease_utility_id: utility.id, attribute_key: 'Auto_Attribute_a123456789bc_Utility' };
    if (fault === 'oldUtilityAttribute') utilityAttribute.qa_created_at_utc = '2020-01-01 00:00:00';
    const utilityNote = { ...stamp, id: 504, entity_type: 'Lease Utility', entity_id: utility.id, kind: 'note', body: 'Auto_Note_a123456789bc_Utility' };
    const deletes = [];
    let rollback = false;
    const connection = {
      async beginTransaction() {},
      async execute(sql, params = []) {
        if (sql.startsWith('SELECT *,') && sql.includes('FROM core.portfolio')) return [[portfolio]];
        if (sql.startsWith('SELECT *,') && sql.includes('FROM core.building')) return [[building]];
        if (sql.startsWith('SELECT *,') && sql.includes('FROM core.tenant')) return [[tenant]];
        if (sql.startsWith('SELECT *,') && sql.includes('FROM core.lease_utility_attribute WHERE')) return [['utilityAttribute', 'oldUtilityAttribute', 'registeredUtilitySegments'].includes(fault) ? [utilityAttribute] : []];
        if (sql.startsWith('SELECT *,') && sql.includes('FROM core.lease_utility WHERE')) return [withChildren || fault === 'utility' ? [utility] : []];
        if (sql.startsWith('SELECT *,') && sql.includes('FROM core.lease_attribute')) return [withChildren || fault === 'attribute' ? [attribute] : []];
        if (sql.startsWith('SELECT *,') && sql.includes('FROM core.lease WHERE')) return [leases];
        if (sql.startsWith('SELECT *,') && sql.includes('FROM core.note')) return [params[0] === 'Lease Utility' && ['unregisteredUtilityNote', 'registeredUtilitySegments'].includes(fault) ? [utilityNote] : params[0] === 'Lease' && (withChildren || fault === 'unregisteredLeaseNote') ? [note] : []];
        if (sql.startsWith('SELECT id FROM core.building')) return [[{ id: building.id }]];
        if (sql.startsWith('SELECT id FROM core.tenant')) return [[{ id: fault === 'tenant' ? 999 : tenant.id }]];
        if (sql.startsWith('SELECT tenant_id FROM core.lease')) return [[{ tenant_id: tenant.id }]];
        if (sql.includes('COUNT(*)')) return [[{ n: (fault === 'childMeter' && sql.includes('FROM core.meter WHERE lease_utility_id')) || (fault === 'childBill' && sql.includes('FROM billing.bills_electric WHERE lease_utility_id')) ? 1 : 0 }]];
        if (sql.startsWith('DELETE')) { deletes.push(sql); return [{ affectedRows: 1 }]; }
        throw new Error(`Unexpected query: ${sql}`);
      },
      async commit() {}, async rollback() { rollback = true; }, release() {},
    };
    const db = new Database({}, process.cwd(), { async getConnection() { return connection; } });
    db.save = async () => {};
    db.run = { id: 'a123456789bc', prefix, startedAt: '2026-10-24 10:00:00', fixtures: [
      { kind: 'portfolio', number: portfolio.portfolio_number },
      { kind: 'building', number: building.building_number },
      { kind: 'tenant', number: tenant.tenant_number, buildingNumber: building.building_number, leaseMarker: 'Auto_Lease_a123456789bc_Test',
        ...(withChildren ? { leaseChildren: [{ type: 'utility', leaseId: lease.id, utilityId: 1 }, { type: 'attribute', leaseId: lease.id, marker: attribute.attribute_key }],
          notes: [{ marker: note.body, kind: 'note', entityType: 'Lease', entityId: lease.id }] } : {}),
        ...(fault === 'registeredSecondLease' ? { leaseMarkers: ['Auto_Lease_a123456789bc_Second'] } : {}) },
    ] };
    if (['oldUtilityAttribute', 'registeredUtilitySegments'].includes(fault)) db.run.fixtures[2].leaseChildren.push({ type: 'utility_attribute', leaseId: lease.id, leaseUtilityId: utility.id, marker: utilityAttribute.attribute_key });
    if (fault === 'registeredUtilitySegments') db.run.fixtures[2].notes.push({ marker: utilityNote.body, kind: 'note', entityType: 'Lease Utility', entityId: utility.id });
    if (fault && !['registeredSecondLease', 'registeredChildren', 'registeredUtilitySegments'].includes(fault)) {
      await assert.rejects(db.cleanup(), /Cleanup refused/);
      assert.equal(rollback, true);
      assert.equal(deletes.length, 0);
    } else {
      await db.cleanup();
      const order = ['lease', 'tenant', 'building', 'portfolio'].map(table => deletes.findIndex(sql => sql.startsWith(`DELETE FROM core.${table} WHERE`)));
      assert.ok(order.every(index => index >= 0));
      assert.deepEqual(order, [...order].sort((a, b) => a - b));
      assert.equal(rollback, false);
      assert.equal(deletes.filter(sql => sql.startsWith('DELETE FROM core.lease WHERE')).length, leases.length);
      if (withChildren) {
        for (const table of ['note', 'lease_attribute', 'lease_utility']) {
          const child = deletes.findIndex(sql => sql.startsWith(`DELETE FROM core.${table} WHERE`));
          assert.ok(child >= 0 && child < order[0]);
        }
      }
      if (fault === 'registeredUtilitySegments') {
        const attributeDelete = deletes.findIndex(sql => sql.startsWith('DELETE FROM core.lease_utility_attribute WHERE'));
        const utilityDelete = deletes.findIndex(sql => sql.startsWith('DELETE FROM core.lease_utility WHERE'));
        assert.ok(attributeDelete >= 0 && attributeDelete < utilityDelete);
      }
    }
  });
}

test('cleanup rejects arbitrary run IDs and filesystem paths', () => {
  for (const value of ['', '../other', 'production', 'a'.repeat(13)]) {
    assert.throws(() => assertRunId(value));
  }
  assert.doesNotThrow(() => assertRunId('a123456789bc'));
});

test('a similarly named existing record cannot be adopted for cleanup', () => {
  assert.throws(() => assertOwnership(
    { portfolio_number: 'shared-100', name: 'UMQA_a123456789bc_Test' },
    { kind: 'portfolio', number: 'UMQA_a123456789bc_100' },
    'UMQA_a123456789bc_',
  ));
});

test('Auto names must match both record type and exact run; legacy ownership still works', () => {
  const fixture = { kind: 'building', number: 'Auto_a123456789bc_B001' };
  const row = { building_number: fixture.number, name: 'Auto_Building_a123456789bc_AnyName' };
  assert.doesNotThrow(() => assertOwnership(row, fixture, 'Auto_a123456789bc_'));
  for (const name of ['Auto_Tenant_a123456789bc_AnyName', 'Auto_Building_ffffffffffff_AnyName', 'Auto_Building_001']) {
    assert.throws(() => assertOwnership({ ...row, name }, fixture, 'Auto_a123456789bc_'), /ownership/);
  }
  assert.doesNotThrow(() => assertOwnership(
    { portfolio_number: 'UMQA_a123456789bc_001', name: 'UMQA_a123456789bc_Legacy' },
    { kind: 'portfolio', number: 'UMQA_a123456789bc_001' }, 'UMQA_a123456789bc_',
  ));
});

test('record factory generates Auto names for every type and numbers within DB limits', async () => {
  global.Cypress = { expose: () => ({ id: 'a123456789bc', prefix: 'Auto_a123456789bc_' }) };
  try {
    const { recordData, portfolioData, buildingData } = await import('../cypress/data/qaData.js');
    for (const type of ['Portfolio', 'Building', 'Tenant', 'Meter', 'Route']) {
      const record = recordData(type);
      assert.ok(record.name.startsWith(`Auto_${type}_a123456789bc_`));
      assert.match(record.number, /^Auto_a123456789bc_[a-zA-Z0-9]{6}$/);
      assert.ok(record.number.length <= 25);
    }
    assert.ok(portfolioData().name.startsWith('Auto_Portfolio_'));
    assert.ok(buildingData().name.startsWith('Auto_Building_'));
  } finally { delete global.Cypress; }
});

test('unexpected child prevents every delete and rolls back', async () => {
  const commands = [];
  let rolledBack = false;
  const connection = {
    async beginTransaction() {},
    async execute(sql) {
      commands.push(sql);
      if (sql.includes('FROM core.portfolio') && sql.endsWith('FOR UPDATE')) return [[{
        id: 100,
        portfolio_number: 'UMQA_a123456789bc_Test',
        name: 'UMQA_a123456789bc_Test',
        created_at: '2026-10-17 06:00:01',
        qa_created_at_utc: '2026-10-17 10:00:01',
      }]];
      if (sql.startsWith('SELECT id FROM core.building')) return [[{ id: 999 }]];
      throw new Error('Unexpected query');
    },
    async rollback() { rolledBack = true; },
    release() {},
  };
  const db = new Database({}, process.cwd(), { async getConnection() { return connection; } });
  db.run = {
    id: 'a123456789bc', prefix: 'UMQA_a123456789bc_', startedAt: '2026-10-17 10:00:00',
    fixtures: [{ kind: 'portfolio', number: 'UMQA_a123456789bc_Test' }],
  };
  await assert.rejects(db.cleanup(), /unregistered child/);
  assert.equal(rolledBack, true);
  assert.equal(commands.some(sql => /^DELETE/i.test(sql)), false);
});

test('query task blocks writes, multiple statements and SELECT file export', async () => {
  const db = new Database({}, process.cwd(), { execute() { throw new Error('Must not reach database'); } });
  for (const sql of ['DELETE FROM core.portfolio', 'SELECT 1; DELETE FROM core.portfolio', "SELECT 1 INTO OUTFILE '/tmp/x'", 'SELECT SLEEP(10)']) {
    await assert.rejects(db.read({ sql }), /read-only SELECT/);
  }
});

for (const kind of ['portfolio', 'building', 'tenant']) {
  test(`note reservations stay bound to their owned ${kind} parent and run marker`, async () => {
    const entity = { portfolio: 'Portfolio', building: 'Building', tenant: 'Tenant' }[kind];
    const number = 'Auto_a123456789bc_Test';
    let saved = false;
    let noteExists = false;
    const pool = { async execute(sql, params) {
      if (sql.startsWith(`SELECT * FROM core.${kind}`)) return [[{ id: 100, [`${kind}_number`]: number, [kind === 'tenant' ? 'tenant_name' : 'name']: `Auto_${entity}_a123456789bc_Test` }]];
      if (sql.startsWith('SELECT id FROM core.note')) {
        assert.equal(params[0], entity);
        assert.equal(params[1], 100);
        return [noteExists ? [{ id: 200 }] : []];
      }
      throw new Error('Unexpected reservation query');
    } };
    const db = new Database({}, process.cwd(), pool);
    db.run = { id: 'a123456789bc', prefix: 'Auto_a123456789bc_', fixtures: [{ kind, number }] };
    db.save = async () => { saved = true; };
    const fixture = { entityKind: kind, entityNumber: number, kind: 'note', marker: 'Auto_Note_a123456789bc_Test' };
    await assert.rejects(db.reserveNote({ ...fixture, entityNumber: 'shared' }), /registered parent/);
    await assert.rejects(db.reserveNote({ ...fixture, marker: 'Auto_Note_ffffffffffff_Test' }), /registered parent/);
    await assert.rejects(db.reserveNote({ ...fixture, retry: true }), /same registered note identity/);
    await db.reserveNote(fixture);
    assert.equal(saved, true);
    assert.deepEqual(db.run.fixtures[0].notes, [{ marker: fixture.marker, kind: 'note' }]);
    await assert.rejects(db.reserveNote(fixture), /already exists or is reserved/);
    saved = false;
    await db.reserveNote({ ...fixture, retry: true });
    assert.equal(saved, false);
    assert.equal(db.run.fixtures[0].notes.length, 1);
    await assert.rejects(db.reserveNote({ ...fixture, marker: 'Auto_Ticket_a123456789bc_Test', kind: 'ticket', retry: true }), /same registered note identity/);
    noteExists = true;
    await assert.rejects(db.reserveNote({ ...fixture, retry: true }), /already exists or is reserved/);
  });
}

for (const registered of [false, true]) {
  test(registered ? 'owned notes are deleted before their portfolio without deleting shared tags' : 'an unregistered note rolls back before any record is deleted', async () => {
    const commands = [];
    let rolledBack = false;
    const marker = 'Auto_Note_a123456789bc_Test';
    const connection = {
      async beginTransaction() {},
      async execute(sql) {
        commands.push(sql);
        if (sql.includes('FROM core.portfolio') && sql.endsWith('FOR UPDATE')) return [[{
          id: 100, portfolio_number: 'Auto_a123456789bc_Test', name: 'Auto_Portfolio_a123456789bc_Test',
          created_at: '2026-10-19 06:00:01', qa_created_at_utc: '2026-10-19 10:00:01',
        }]];
        if (sql.startsWith('SELECT id FROM core.building')) return [[]];
        if (sql.includes('COUNT(*)')) return [[{ n: 0 }]];
        if (sql.includes('FROM core.note') && sql.startsWith('SELECT')) return [[{
          id: 200, entity_type: 'Portfolio', entity_id: 100, kind: 'note', body: `${marker} Updated`,
          qa_created_at_utc: '2026-10-19 10:00:02',
        }]];
        if (sql.startsWith('DELETE')) return [{ affectedRows: 1 }];
        throw new Error('Unexpected query');
      },
      async commit() {},
      async rollback() { rolledBack = true; },
      release() {},
    };
    const db = new Database({}, process.cwd(), { async getConnection() { return connection; } });
    db.save = async () => {};
    db.run = { id: 'a123456789bc', prefix: 'Auto_a123456789bc_', startedAt: '2026-10-19 10:00:00', fixtures: [{
      kind: 'portfolio', number: 'Auto_a123456789bc_Test',
      notes: registered ? [{ kind: 'note', marker }] : [],
    }] };
    if (registered) {
      await db.cleanup();
      assert.equal(rolledBack, false);
      const noteDelete = commands.findIndex(sql => sql.startsWith('DELETE FROM core.note WHERE'));
      const parentDelete = commands.findIndex(sql => sql.startsWith('DELETE FROM core.portfolio WHERE'));
      assert.ok(noteDelete >= 0 && parentDelete > noteDelete);
      assert.equal(commands.some(sql => sql.startsWith('DELETE FROM core.tag ')), false);
    } else {
      await assert.rejects(db.cleanup(), /unregistered notes/);
      assert.equal(rolledBack, true);
      assert.equal(commands.some(sql => sql.startsWith('DELETE')), false);
    }
  });
}
