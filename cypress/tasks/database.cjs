const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

const kinds = {
  portfolio: { table: 'core.portfolio', column: 'portfolio_number', entity: 'Portfolio' },
  building: { table: 'core.building', column: 'building_number', entity: 'Building' },
  tenant: { table: 'core.tenant', column: 'tenant_number', entity: 'Tenant', nameColumn: 'tenant_name' },
};

function assertRunId(id) {
  if (!/^[a-f0-9]{12}$/.test(id)) throw new Error('Invalid QA run ID.');
}

function assertOwnership(row, fixture, prefix) {
  const column = kinds[fixture.kind].column;
  const namePrefix = prefix.startsWith('Auto_') ? `Auto_${kinds[fixture.kind].entity}_${prefix.slice(5)}` : prefix;
  if (row[column] !== fixture.number || !row[column].startsWith(prefix) || !row[kinds[fixture.kind].nameColumn || 'name']?.startsWith(namePrefix)) {
    throw new Error('Cleanup refused: fixture ownership does not match this run.');
  }
}

class Database {
  constructor(config, root, pool) {
    this.pool = pool || mysql.createPool(config);
    this.root = root;
    this.run = null;
  }

  async health() {
    const [[result]] = await this.pool.query('SELECT DATABASE() AS db, UTC_TIMESTAMP() AS checkedAt');
    if (result.db !== 'core') throw new Error('Connected to an unexpected schema.');
    return { database: result.db, connected: true };
  }

  async start(runId = crypto.randomBytes(6).toString('hex')) {
    assertRunId(runId);
    const [[clock]] = await this.pool.query('SELECT UTC_TIMESTAMP() AS startedAt');
    this.run = { id: runId, prefix: `Auto_${runId}_`, startedAt: clock.startedAt, fixtures: [] };
    await this.save();
    return { id: runId, prefix: this.run.prefix };
  }

  async save() {
    await fs.mkdir(path.join(this.root, '.qa-runs'), { recursive: true });
    const file = path.join(this.root, '.qa-runs', `${this.run.id}.json`);
    await fs.writeFile(file, JSON.stringify(this.run, null, 2));
  }

  async resume(id) {
    assertRunId(id);
    this.run = JSON.parse(await fs.readFile(path.join(this.root, '.qa-runs', `${id}.json`), 'utf8'));
    if (this.run.id !== id || ![`Auto_${id}_`, `UMQA_${id}_`].includes(this.run.prefix)) throw new Error('Invalid run ledger.');
  }

  async reserve(fixture) {
    if (!this.run || !kinds[fixture.kind]) throw new Error('Register a supported fixture in an active run.');
    if (!new RegExp(`^${this.run.prefix}[a-zA-Z0-9]+$`).test(fixture.number) || fixture.number.length > 25) {
      throw new Error(`Fixture number must use the active prefix ${this.run.prefix}, an alphanumeric suffix and at most 25 characters (received length ${fixture.number?.length ?? 0}).`);
    }
    assertOwnership({ [kinds[fixture.kind].column]: fixture.number, [kinds[fixture.kind].nameColumn || 'name']: fixture.name }, fixture, this.run.prefix);
    if (fixture.kind === 'tenant') {
      const parent = this.run.fixtures.find(item => item.kind === 'building' && item.number === fixture.buildingNumber);
      if (!parent || !new RegExp(`^Auto_Lease_${this.run.id}_[A-Za-z0-9_]+$`).test(fixture.leaseMarker) || fixture.leaseMarker.length > 95) throw new Error('Tenant requires an owned building and an exact run-prefixed initial lease marker.');
      const rows = await this.lookup('building', parent.number);
      if (rows.length !== 1) throw new Error('Tenant building must already exist.');
      assertOwnership(rows[0], parent, this.run.prefix);
    }
    const { table, column } = kinds[fixture.kind];
    const [existing] = await this.pool.execute(`SELECT id FROM ${table} WHERE ${column} = ?`, [fixture.number]);
    if (existing.length) throw new Error('Fixture already exists; it cannot be adopted for cleanup.');
    if (this.run.fixtures.some(x => x.number === fixture.number)) throw new Error('Fixture already registered.');
    this.run.fixtures.push({ kind: fixture.kind, number: fixture.number, name: fixture.name,
      ...(fixture.kind === 'tenant' ? { buildingNumber: fixture.buildingNumber, leaseMarker: fixture.leaseMarker } : {}) });
    await this.save(); // Durable before the UI/API write, so interrupted runs are recoverable.
    return null;
  }

  async lookup(kind, number) {
    if (!kinds[kind]) throw new Error('Unsupported lookup.');
    const { table, column } = kinds[kind];
    const [rows] = await this.pool.execute(`SELECT * FROM ${table} WHERE ${column} = ?`, [number]);
    return rows;
  }

  async reserveLease({ tenantNumber, marker }) {
    const parent = this.run?.fixtures.find(item => item.kind === 'tenant' && item.number === tenantNumber);
    if (!parent || !new RegExp(`^Auto_Lease_${this.run.id}_[A-Za-z0-9_]+$`).test(marker) || marker.length > 95) throw new Error('Lease requires an owned tenant and a run-prefixed location marker.');
    const rows = await this.lookup('tenant', tenantNumber);
    if (rows.length !== 1) throw new Error('Lease tenant must already exist.');
    assertOwnership(rows[0], parent, this.run.prefix);
    if (rows[0].building_number !== parent.buildingNumber) throw new Error('Lease tenant has an unexpected building.');
    const [existing] = await this.pool.execute('SELECT id FROM core.lease WHERE tenant_id = ? AND (location = ? OR LEFT(location, ?) = ?)', [rows[0].id, marker, marker.length + 1, `${marker} `]);
    if (existing.length || [parent.leaseMarker, ...(parent.leaseMarkers || [])].includes(marker)) throw new Error('Lease identity already exists or is reserved.');
    parent.leaseMarkers = [...(parent.leaseMarkers || []), marker];
    await this.save();
    return null;
  }

  async reserveMeter({ buildingNumber, number, marker, utilityId, tenantNumber, leaseUtilityId }) {
    const parent = this.run?.fixtures.find(item => item.kind === 'building' && item.number === buildingNumber);
    if (!parent || !new RegExp(`^${this.run.prefix}[A-Za-z0-9]+$`).test(number) || number.length > 25 || !new RegExp(`^Auto_Meter_${this.run.id}_[A-Za-z0-9_]+$`).test(marker) || marker.length > 95 || !Number.isInteger(utilityId) || utilityId < 1) throw new Error('Meter requires a registered Building, exact run identities and Utility ID.');
    const buildings = await this.lookup('building', buildingNumber);
    if (buildings.length !== 1) throw new Error('Meter Building must already exist.');
    assertOwnership(buildings[0], parent, this.run.prefix);
    if (leaseUtilityId !== undefined) {
      const { utility } = await this.ownedLeaseUtility(tenantNumber, leaseUtilityId);
      const { lease } = await this.ownedLease(tenantNumber, utility.lease_id);
      if (lease.building_number !== buildingNumber || Number(utility.utility_id) !== utilityId) throw new Error('Meter assignment must use the same owned Building and Utility.');
    }
    const [existing] = await this.pool.execute('SELECT meter_id FROM core.meter WHERE meter_number=?', [number]);
    if (existing.length || this.run.fixtures.some(item => item.meters?.some(meter => meter.number === number))) throw new Error('Meter already exists or is registered; adoption is refused.');
    parent.meters = [...(parent.meters || []), { number, marker, utilityId, ...(leaseUtilityId === undefined ? {} : { leaseUtilityId }) }];
    await this.save();
    return null;
  }

  async ownedLease(tenantNumber, leaseId) {
    const parent = this.run?.fixtures.find(item => item.kind === 'tenant' && item.number === tenantNumber);
    if (!parent || !Number.isInteger(leaseId) || leaseId < 1) throw new Error('Lease child requires a registered Tenant and exact Lease ID.');
    const rows = await this.lookup('tenant', tenantNumber);
    if (rows.length !== 1) throw new Error('Lease Tenant must already exist.');
    assertOwnership(rows[0], parent, this.run.prefix);
    if (rows[0].building_number !== parent.buildingNumber) throw new Error('Lease Tenant has an unexpected Building.');
    const [leases] = await this.pool.execute('SELECT * FROM core.lease WHERE id=? AND tenant_id=?', [leaseId, rows[0].id]);
    const lease = leases[0];
    const markers = [parent.leaseMarker, ...(parent.leaseMarkers || [])];
    if (leases.length !== 1 || lease.building_number !== parent.buildingNumber || !markers.some(marker => marker?.startsWith(`Auto_Lease_${this.run.id}_`) && (lease.location === marker || lease.location?.startsWith(`${marker} `)))) throw new Error('Lease child has an unowned Lease.');
    return { parent, lease };
  }

  async ownedLeaseUtility(tenantNumber, entityId) {
    if (!Number.isInteger(entityId) || entityId < 1) throw new Error('Lease Utility requires an exact owned ID.');
    const [rows] = await this.pool.execute('SELECT * FROM core.lease_utility WHERE id=?', [entityId]);
    if (rows.length !== 1) throw new Error('Lease Utility must already exist.');
    const utility = rows[0];
    const { parent } = await this.ownedLease(tenantNumber, utility.lease_id);
    if (!parent.leaseChildren?.some(child => child.type === 'utility' && child.leaseId === utility.lease_id && child.utilityId === Number(utility.utility_id))) throw new Error('Lease Utility is not registered under its owned Lease.');
    return { parent, utility };
  }

  async reserveLeaseChild({ tenantNumber, leaseId, type, marker, utilityId, leaseUtilityId }) {
    const { parent } = await this.ownedLease(tenantNumber, leaseId);
    if (!['attribute', 'utility', 'utility_attribute'].includes(type)) throw new Error('Unsupported Lease child type.');
    if (type !== 'utility' && (!new RegExp(`^Auto_Attribute_${this.run.id}_[A-Za-z0-9_]+$`).test(marker) || marker.length > 95)) throw new Error('Lease attribute needs a run-prefixed marker.');
    if (type === 'utility_attribute' && (await this.ownedLeaseUtility(tenantNumber, leaseUtilityId)).utility.lease_id !== leaseId) throw new Error('Lease Utility attribute has an unexpected Lease.');
    if (type === 'utility' && (!Number.isInteger(utilityId) || utilityId < 1)) throw new Error('Lease utility needs an exact Utility ID.');
    const column = type === 'utility' ? 'utility_id' : 'attribute_key';
    const value = type === 'utility' ? utilityId : marker;
    const [existing] = await this.pool.execute(`SELECT id FROM core.lease_${type} WHERE ${type === 'utility_attribute' ? 'lease_utility_id' : 'lease_id'}=? AND ${column}=?`, [type === 'utility_attribute' ? leaseUtilityId : leaseId, value]);
    if (existing.length || parent.leaseChildren?.some(child => child.leaseId === leaseId && child.type === type && (type === 'utility' ? child.utilityId === utilityId : child.marker === marker))) throw new Error('Lease child already exists or is registered.');
    parent.leaseChildren = [...(parent.leaseChildren || []), { leaseId, type, ...(type === 'utility' ? { utilityId } : { marker }), ...(type === 'utility_attribute' ? { leaseUtilityId } : {}) }];
    await this.save();
    return null;
  }

  async reserveNote({ entityKind, entityNumber, entityId, marker, kind, retry = false }) {
    if (!['portfolio', 'building', 'tenant', 'lease', 'lease_utility'].includes(entityKind)) throw new Error('Unsupported note parent type.');
    const childContext = ['lease', 'lease_utility'].includes(entityKind);
    const ownerKind = childContext ? 'tenant' : entityKind;
    const parent = this.run?.fixtures.find(fixture => fixture.kind === ownerKind && fixture.number === entityNumber);
    const type = kind === 'note' ? 'Note' : kind === 'ticket' ? 'Ticket' : null;
    if (!parent || !type || !new RegExp(`^Auto_${type}_${this.run.id}_[A-Za-z0-9_]+$`).test(marker) || marker.length > 95) {
      throw new Error('Reserve a run-prefixed note/ticket on a registered parent.');
    }
    const rows = await this.lookup(ownerKind, entityNumber);
    if (rows.length !== 1) throw new Error('Note parent must already exist.');
    assertOwnership(rows[0], parent, this.run.prefix);
    const contextId = entityKind === 'lease_utility' ? (await this.ownedLeaseUtility(entityNumber, entityId)).utility.id : entityKind === 'lease' ? (await this.ownedLease(entityNumber, entityId)).lease.id : rows[0].id;
    const contextType = entityKind === 'lease_utility' ? 'Lease Utility' : entityKind === 'lease' ? 'Lease' : kinds[entityKind].entity;
    const [existing] = await this.pool.execute('SELECT id FROM core.note WHERE entity_type = ? AND entity_id = ? AND (body = ? OR LEFT(body, ?) = ?)', [contextType, contextId, marker, marker.length + 1, `${marker} `]);
    if (existing.length) throw new Error('Note identity already exists or is reserved.');
    const reserved = parent.notes?.find(note => note.marker === marker);
    if (retry) {
      if (!reserved || reserved.kind !== kind || (childContext && (reserved.entityType !== contextType || reserved.entityId !== contextId))) throw new Error('Retry requires the same registered note identity and kind.');
      return null;
    }
    if (reserved) throw new Error('Note identity already exists or is reserved.');
    parent.notes = [...(parent.notes || []), { marker, kind, ...(childContext ? { entityType: contextType, entityId: contextId } : {}) }];
    await this.save();
    return null;
  }

  async read({ sql, params = [] }) {
    if (!/^\s*SELECT\b/i.test(sql) || /;|\b(INTO|OUTFILE|DUMPFILE|SLEEP|BENCHMARK|LOAD_FILE|FOR\s+UPDATE)\b/i.test(sql)) {
      throw new Error('db:query accepts parameterized read-only SELECT statements only.');
    }
    const [rows] = await this.pool.execute(sql, params);
    return rows;
  }

  async cleanup() {
    if (!this.run) throw new Error('No run ledger loaded.');
    assertRunId(this.run.id);
    const connection = await this.pool.getConnection();
    let deleted = 0;
    try {
      await connection.beginTransaction();
      const owned = [];
      const ownedNotes = [];
      const ownedMeters = [];
      const ownedLeases = [];
      const ownedUtilities = [];
      const ownedAttributes = [];
      const ownedUtilityAttributes = [];
      const noteParents = [];
      for (const fixture of this.run.fixtures) {
        if (!kinds[fixture.kind]) throw new Error('Unsupported cleanup kind.');
        const { table, column } = kinds[fixture.kind];
        const [rows] = await connection.execute(`SELECT *, CONVERT_TZ(created_at, @@session.time_zone, '+00:00') AS qa_created_at_utc FROM ${table} WHERE ${column} = ? FOR UPDATE`, [fixture.number]);
        for (const row of rows) {
          assertOwnership(row, fixture, this.run.prefix);
          if (row.created_at && !row.qa_created_at_utc) throw new Error('Cleanup refused: cannot establish record creation timezone.');
          if (row.qa_created_at_utc && new Date(`${row.qa_created_at_utc.replace(' ', 'T')}Z`) < new Date(`${this.run.startedAt.replace(' ', 'T')}Z`) - 60000) {
            throw new Error('Cleanup refused: record predates this run.');
          }
          owned.push({ fixture, row });
        }
      }
      const portfolioIds = new Set(owned.filter(x => x.fixture.kind === 'portfolio').map(x => x.row.id));
      const buildingIds = new Set(owned.filter(x => x.fixture.kind === 'building').map(x => x.row.id));
      const buildingNumbers = new Set(owned.filter(x => x.fixture.kind === 'building').map(x => x.row.building_number));
      const tenantIds = new Set(owned.filter(x => x.fixture.kind === 'tenant').map(x => x.row.id));
      for (const { fixture, row: building } of owned.filter(item => item.fixture.kind === 'building')) {
        if (!fixture.meters?.length) continue;
        const [meters] = await connection.execute("SELECT *, CONVERT_TZ(created_at, @@session.time_zone, '+00:00') AS qa_created_at_utc FROM core.meter WHERE building_number=? FOR UPDATE", [building.building_number]);
        const matched = new Set();
        for (const meter of meters) {
          const registered = fixture.meters?.find(item => item.number === meter.meter_number);
          if (!registered || matched.has(meter.meter_number) || !meter.meter_number.startsWith(this.run.prefix) || !registered.marker.startsWith(`Auto_Meter_${this.run.id}_`) || meter.location !== registered.marker || Number(meter.utility_id) !== registered.utilityId || Number(meter.is_virtual) !== 0 || meter.source_meter_id !== null) throw new Error('Cleanup refused: unregistered, changed or virtual Meter.');
          if (!meter.qa_created_at_utc || new Date(`${meter.qa_created_at_utc.replace(' ', 'T')}Z`) < new Date(`${this.run.startedAt.replace(' ', 'T')}Z`) - 60000) throw new Error('Cleanup refused: Meter predates run or has unknown timezone.');
          if (meter.lease_utility_id !== null && Number(meter.lease_utility_id) !== registered.leaseUtilityId) throw new Error('Cleanup refused: Meter has an unregistered assignment.');
          matched.add(meter.meter_number);
          ownedMeters.push({ row: meter, registered });
        }
      }
      const meterIds = new Set(ownedMeters.map(item => item.row.meter_id));
      // Validate the entire dependency graph before executing any DELETE.
      for (const { fixture, row } of owned) {
        if (fixture.kind === 'portfolio') {
          const [children] = await connection.execute('SELECT id FROM core.building WHERE portfolio_id = ?', [row.id]);
          if (children.some(x => !buildingIds.has(x.id))) throw new Error('Cleanup refused: unregistered child building.');
          const [[accounts]] = await connection.execute('SELECT COUNT(*) AS n FROM billing.utility_account WHERE portfolio_id = ?', [row.id]);
          if (accounts.n) throw new Error('Cleanup refused: unexpected portfolio account dependency.');
        } else if (fixture.kind === 'building') {
          if (!portfolioIds.has(row.portfolio_id)) throw new Error('Cleanup refused: building has an unowned parent.');
          const [tenants] = await connection.execute('SELECT id FROM core.tenant WHERE building_number = ?', [row.building_number]);
          if (tenants.some(tenant => !tenantIds.has(tenant.id))) throw new Error('Cleanup refused: unregistered child tenant.');
          const [leases] = await connection.execute('SELECT tenant_id FROM core.lease WHERE building_number = ?', [row.building_number]);
          if (leases.some(lease => !tenantIds.has(lease.tenant_id))) throw new Error('Cleanup refused: lease has an unowned tenant.');
          for (const table of [...(fixture.meters?.length ? [] : ['core.meter']), 'billing.billyrperiod', 'billing.building_trip_code_map']) {
            const [[child]] = await connection.execute(`SELECT COUNT(*) AS n FROM ${table} WHERE building_number = ?`, [row.building_number]);
            if (child.n) throw new Error(`Cleanup refused: unexpected dependency in ${table}.`);
          }
          for (const table of ['billing.utility_account', 'core.route_buildings']) {
            const [[child]] = await connection.execute(`SELECT COUNT(*) AS n FROM ${table} WHERE building_id = ?`, [row.id]);
            if (child.n) throw new Error(`Cleanup refused: unexpected dependency in ${table}.`);
          }
        } else {
          if (!buildingNumbers.has(row.building_number) || row.building_number !== fixture.buildingNumber) throw new Error('Cleanup refused: tenant has an unowned building.');
          if (!row.qa_created_at_utc) throw new Error('Cleanup refused: tenant has an unknown creation timezone.');
          const [[pdfs]] = await connection.execute('SELECT COUNT(*) AS n FROM billing.pdf_generation_requests WHERE tenant_id = ?', [row.id]);
          if (pdfs.n) throw new Error('Cleanup refused: unexpected tenant PDF dependency.');
          const [leases] = await connection.execute("SELECT *, CONVERT_TZ(created_at, @@session.time_zone, '+00:00') AS qa_created_at_utc FROM core.lease WHERE tenant_id = ? FOR UPDATE", [row.id]);
          const markers = [fixture.leaseMarker, ...(fixture.leaseMarkers || [])];
          const matched = new Set();
          for (const lease of leases) {
            const marker = markers.find(value => value?.startsWith(`Auto_Lease_${this.run.id}_`) && (lease.location === value || lease.location?.startsWith(`${value} `)));
            if (!marker || matched.has(marker) || lease.building_number !== row.building_number) throw new Error('Cleanup refused: unregistered or duplicate lease.');
            matched.add(marker);
            if (!lease.qa_created_at_utc || new Date(`${lease.qa_created_at_utc.replace(' ', 'T')}Z`) < new Date(`${this.run.startedAt.replace(' ', 'T')}Z`) - 60000) throw new Error('Cleanup refused: lease predates this run or has an unknown creation timezone.');
            for (const type of ['utility', 'attribute']) {
              const [children] = await connection.execute(`SELECT *, CONVERT_TZ(created_at, @@session.time_zone, '+00:00') AS qa_created_at_utc FROM core.lease_${type} WHERE lease_id=? FOR UPDATE`, [lease.id]);
              const childIdentities = new Set();
              for (const child of children) {
                const identity = type === 'utility' ? Number(child.utility_id) : child.attribute_key;
                const registered = fixture.leaseChildren?.find(item => item.type === type && item.leaseId === lease.id && (type === 'utility' ? item.utilityId === identity : item.marker === identity));
                if (!registered || childIdentities.has(identity) || (type === 'attribute' && !identity.startsWith(`Auto_Attribute_${this.run.id}_`))) throw new Error('Cleanup refused: unregistered or duplicate Lease child.');
                childIdentities.add(identity);
                if (!child.qa_created_at_utc || new Date(`${child.qa_created_at_utc.replace(' ', 'T')}Z`) < new Date(`${this.run.startedAt.replace(' ', 'T')}Z`) - 60000) throw new Error('Cleanup refused: Lease child predates this run or has unknown timezone.');
                if (type === 'attribute') ownedAttributes.push(child);
                else {
                  const [attributes] = await connection.execute("SELECT *, CONVERT_TZ(created_at, @@session.time_zone, '+00:00') AS qa_created_at_utc FROM core.lease_utility_attribute WHERE lease_utility_id=? FOR UPDATE", [child.id]);
                  const attributeKeys = new Set();
                  for (const attribute of attributes) {
                    const reservation = fixture.leaseChildren?.find(item => item.type === 'utility_attribute' && item.leaseId === lease.id && item.leaseUtilityId === child.id && item.marker === attribute.attribute_key);
                    // Assignment creates this counter automatically on the registered utility.
                    const assigned = ownedMeters.filter(({ row: meter, registered }) => Number(meter.lease_utility_id) === child.id && registered.leaseUtilityId === child.id);
                    const meterCount = attribute.attribute_key === 'lease_utility_meter_count' && assigned.length > 0 && attribute.attribute_value === String(assigned.length);
                    if (attributeKeys.has(attribute.attribute_key) || (!meterCount && (!reservation || !attribute.attribute_key.startsWith(`Auto_Attribute_${this.run.id}_`)))) throw new Error('Cleanup refused: unregistered or duplicate Lease Utility attribute.');
                    if (!attribute.qa_created_at_utc || new Date(`${attribute.qa_created_at_utc.replace(' ', 'T')}Z`) < new Date(`${this.run.startedAt.replace(' ', 'T')}Z`) - 60000) throw new Error('Cleanup refused: Lease Utility attribute predates run or has unknown timezone.');
                    attributeKeys.add(attribute.attribute_key);
                    ownedUtilityAttributes.push(attribute);
                  }
                  if (ownedMeters.length) {
                    const [assignedMeters] = await connection.execute('SELECT meter_id FROM core.meter WHERE lease_utility_id=?', [child.id]);
                    if (assignedMeters.some(meter => !meterIds.has(meter.meter_id))) throw new Error('Cleanup refused: unregistered Meter on owned Lease Utility.');
                  }
                  for (const table of [...(ownedMeters.length ? [] : ['core.meter']), 'core.lease_utility_tou_category', 'core.x_del_lease_utility_attribute', 'billing.billyrperiod_partial', 'billing.bills_electric', 'billing.bills_meter_electric', 'billing.bills_cold_water', 'billing.bills_meter_cold_water', 'billing.pdf_generation_requests']) {
                    const [[dependency]] = await connection.execute(`SELECT COUNT(*) AS n FROM ${table} WHERE lease_utility_id=?`, [child.id]);
                    if (dependency.n) throw new Error(`Cleanup refused: unexpected Lease Utility dependency in ${table}.`);
                  }
                  noteParents.push({ entity: 'Lease Utility', id: child.id, notes: fixture.notes?.filter(note => note.entityType === 'Lease Utility' && note.entityId === child.id) });
                  const [[aliasNotes]] = await connection.execute("SELECT COUNT(*) AS n FROM core.note WHERE LOWER(entity_type) IN ('lease_utility','leaseutility') AND entity_id=?", [child.id]);
                  if (aliasNotes.n) throw new Error('Cleanup refused: unexpected Lease Utility note context alias.');
                  for (const [table, typeColumn, idColumn] of [['core.images', 'entity_type', 'entity_id'], ['core.contact_assignment', 'context_type', 'context_id'], ['core.billing_assignment', 'context_type', 'context_id'], ['core.letter_template_assignment', 'entity_type', 'entity_id']]) {
                    const [[dependency]] = await connection.execute(`SELECT COUNT(*) AS n FROM ${table} WHERE LOWER(${typeColumn}) IN ('lease utility','lease_utility','leaseutility') AND ${idColumn}=?`, [child.id]);
                    if (dependency.n) throw new Error(`Cleanup refused: unexpected Lease Utility context dependency in ${table}.`);
                  }
                  ownedUtilities.push(child);
                }
              }
            }
            noteParents.push({ entity: 'Lease', id: lease.id, notes: fixture.notes?.filter(note => note.entityType === 'Lease' && note.entityId === lease.id) });
            for (const [table, typeColumn, idColumn] of [
              ['core.images', 'entity_type', 'entity_id'],
              ['core.contact_assignment', 'context_type', 'context_id'],
              ['core.billing_assignment', 'context_type', 'context_id'],
              ['core.letter_template_assignment', 'entity_type', 'entity_id'],
            ]) {
              const [[child]] = await connection.execute(`SELECT COUNT(*) AS n FROM ${table} WHERE LOWER(${typeColumn}) = 'lease' AND ${idColumn} = ?`, [lease.id]);
              if (child.n) throw new Error(`Cleanup refused: unexpected lease dependency in ${table}.`);
            }
            ownedLeases.push(lease);
          }
        }
        noteParents.push({ entity: kinds[fixture.kind].entity, id: row.id, notes: fixture.notes?.filter(note => !note.entityType) });
      }
      for (const parent of noteParents) {
        const [notes] = await connection.execute("SELECT *, CONVERT_TZ(created_at, @@session.time_zone, '+00:00') AS qa_created_at_utc FROM core.note WHERE entity_type = ? AND entity_id = ? FOR UPDATE", [parent.entity, parent.id]);
        for (const note of notes) {
          const registered = parent.notes?.find(item => item.kind === note.kind && (note.body === item.marker || note.body.startsWith(`${item.marker} `)));
          const type = note.kind === 'ticket' ? 'Ticket' : 'Note';
          if (!registered || !registered.marker.startsWith(`Auto_${type}_${this.run.id}_`)) throw new Error('Cleanup refused: unregistered notes/tickets on fixture.');
          if (!note.qa_created_at_utc || new Date(`${note.qa_created_at_utc.replace(' ', 'T')}Z`) < new Date(`${this.run.startedAt.replace(' ', 'T')}Z`) - 60000) throw new Error('Cleanup refused: note predates this run or has an unknown creation timezone.');
          ownedNotes.push(note);
        }
      }
      if (ownedMeters.length) {
        const [references] = await connection.execute("SELECT c.TABLE_SCHEMA,c.TABLE_NAME,c.COLUMN_NAME FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME WHERE t.TABLE_TYPE='BASE TABLE' AND c.COLUMN_NAME IN ('meter_id','source_meter_id','virtual_meter_id','meter_number') AND c.TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')");
        for (const { row: meter, registered } of ownedMeters) {
          if (meter.lease_utility_id !== null && !ownedUtilities.some(utility => utility.id === registered.leaseUtilityId)) throw new Error('Cleanup refused: assigned Meter utility is outside the owned graph.');
          for (const ref of references) {
            if (ref.TABLE_SCHEMA === 'core' && ref.TABLE_NAME === 'meter' && ['meter_id', 'meter_number'].includes(ref.COLUMN_NAME)) continue;
            const quote = value => '`' + value.replaceAll('`', '``') + '`';
            const [[dependency]] = await connection.execute(`SELECT COUNT(*) AS n FROM ${quote(ref.TABLE_SCHEMA)}.${quote(ref.TABLE_NAME)} WHERE ${quote(ref.COLUMN_NAME)}=?`, [ref.COLUMN_NAME === 'meter_number' ? meter.meter_number : meter.meter_id]);
            if (dependency.n) throw new Error(`Cleanup refused: unexpected Meter dependency in ${ref.TABLE_SCHEMA}.${ref.TABLE_NAME}.`);
          }
          for (const [table, typeColumn, idColumn] of [['core.note', 'entity_type', 'entity_id'], ['core.images', 'entity_type', 'entity_id'], ['core.contact_assignment', 'context_type', 'context_id'], ['core.billing_assignment', 'context_type', 'context_id'], ['core.letter_template_assignment', 'entity_type', 'entity_id']]) {
            const [[dependency]] = await connection.execute(`SELECT COUNT(*) AS n FROM ${table} WHERE LOWER(${typeColumn})='meter' AND ${idColumn}=?`, [meter.meter_id]);
            if (dependency.n) throw new Error(`Cleanup refused: unexpected Meter context in ${table}.`);
          }
        }
      }
      for (const { row: meter } of ownedMeters) {
        await connection.execute("DELETE FROM core.Employee_Feed WHERE entity_type='Meter' AND entity_id=?", [meter.meter_id]);
        const [result] = await connection.execute('DELETE FROM core.meter WHERE meter_id=? AND building_number=? AND meter_number=? AND location=?', [meter.meter_id, meter.building_number, meter.meter_number, meter.location]);
        deleted += result.affectedRows;
      }
      for (const note of ownedNotes) {
        await connection.execute('DELETE FROM core.Employee_Feed WHERE entity_type = ? AND entity_id = ?', [note.kind === 'ticket' ? 'Ticket' : 'Note', note.id]);
        await connection.execute('DELETE FROM core.note_tag WHERE note_id = ?', [note.id]);
        await connection.execute('DELETE FROM core.note WHERE id = ? AND entity_type = ? AND entity_id = ? AND body = ?', [note.id, note.entity_type, note.entity_id, note.body]);
      }
      for (const lease of ownedLeases) {
        for (const attribute of ownedAttributes.filter(item => item.lease_id === lease.id)) await connection.execute('DELETE FROM core.lease_attribute WHERE id=? AND lease_id=? AND attribute_key=?', [attribute.id, lease.id, attribute.attribute_key]);
        for (const utility of ownedUtilities.filter(item => item.lease_id === lease.id)) {
          for (const attribute of ownedUtilityAttributes.filter(item => item.lease_utility_id === utility.id)) await connection.execute('DELETE FROM core.lease_utility_attribute WHERE id=? AND lease_utility_id=? AND attribute_key=?', [attribute.id, utility.id, attribute.attribute_key]);
          await connection.execute("DELETE FROM core.Employee_Feed WHERE entity_type IN ('Lease Utility','LeaseUtility','lease_utility') AND entity_id=?", [utility.id]);
          await connection.execute('DELETE FROM core.lease_utility WHERE id=? AND lease_id=? AND utility_id=?', [utility.id, lease.id, utility.utility_id]);
        }
        await connection.execute("DELETE FROM core.Employee_Feed WHERE entity_type = 'Lease' AND entity_id = ?", [lease.id]);
        await connection.execute('DELETE FROM core.lease WHERE id = ? AND tenant_id = ? AND location = ?', [lease.id, lease.tenant_id, lease.location]);
      }
      const order = { tenant: 0, building: 1, portfolio: 2 };
      const ordered = owned.sort((a, b) => order[a.fixture.kind] - order[b.fixture.kind]);
      for (const { fixture, row } of ordered) {
        const { table, column, entity } = kinds[fixture.kind];
        await connection.execute('DELETE FROM core.Employee_Feed WHERE entity_type = ? AND entity_id = ?', [entity, row.id]);
        await connection.execute('DELETE FROM core.images WHERE entity_type = ? AND entity_id = ?', [entity, row.id]);
        await connection.execute('DELETE FROM core.contact_assignment WHERE context_type = ? AND context_id = ?', [fixture.kind, row.id]);
        await connection.execute('DELETE FROM core.letter_template_assignment WHERE entity_type = ? AND entity_id = ?', [fixture.kind, row.id]);
        if (['building', 'tenant'].includes(fixture.kind)) {
          await connection.execute('DELETE FROM core.billing_assignment WHERE context_type = ? AND context_id = ?', [fixture.kind, row.id]);
        }
        if (fixture.kind === 'building') {
          await connection.execute('DELETE FROM core.building_attribute WHERE building_id = ?', [row.id]);
        } else if (fixture.kind === 'portfolio') {
          await connection.execute('DELETE FROM core.portfolio_attribute WHERE portfolio_id = ?', [row.id]);
        }
        const [result] = await connection.execute(`DELETE FROM ${table} WHERE id = ? AND ${column} = ?`, [row.id, fixture.number]);
        deleted += result.affectedRows;
      }
      await connection.commit();
      this.run.lastCleanup = { at: new Date().toISOString(), deleted };
      await this.save();
      return { deleted, runId: this.run.id };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async close() { await this.pool.end(); }
}

module.exports = { Database, assertRunId, assertOwnership };
