import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { buildingData } from '../../data/qaData';

const api = new UtilityManagerApiClient();

function emptyBuilding() {
  return cy.task('db:query', {
    sql: `SELECT b.id, b.name, b.building_number, b.portfolio_id, b.region_id, b.street, b.city, b.state, b.zip,
                 p.portfolio_number, p.name AS portfolio_name
          FROM core.building b JOIN core.portfolio p ON p.id=b.portfolio_id
          WHERE b.is_offline=0 AND p.is_offline=0
            AND NOT EXISTS (SELECT 1 FROM core.tenant t WHERE t.building_number=b.building_number)
            AND NOT EXISTS (SELECT 1 FROM core.meter m WHERE m.building_number=b.building_number)
          ORDER BY b.id LIMIT 1`,
  }, { log: false }).then(rows => {
    expect(rows, 'active Building without tenants or meters').to.have.length(1);
    return rows[0];
  });
}

describe('Building and Tenant Read APIs', { tags: '@api' }, () => {
  beforeEach(() => api.authenticate());

  it('UM-API-011-POS - List the active Building with its address and zero meter counts', { tags: '@building' }, () => {
    return emptyBuilding().then(building => api.request('GET', '/buildings').then(({ status, body }) => {
      expect(status).to.eq(200);
      expect(body).to.be.an('array');
      const matches = body.map(item => item.building_json).filter(item => Number(item.building_id) === Number(building.id));
      expect(matches).to.have.length(1);
      const [record] = matches;
      expect(record).to.include({ building_number: building.building_number, building_name: building.name });
      for (const key of ['street', 'city', 'state', 'zip']) expect(record[key], key).to.eq(building[key]);
      for (const key of ['electric_meter_count', 'cold_water_meter_count', 'tenant_count']) {
        expect(record[key], key).to.be.oneOf([0, '0']);
      }
    }));
  });

  it('UM-API-012-POS - Return the exact Building, its parent portfolio and empty tenants', { tags: '@building' }, () => {
    return emptyBuilding().then(building => api.request('GET', `/buildings/detail/${building.id}`).then(({ status, body }) => {
      expect(status).to.eq(200);
      expect(body).to.be.an('array').and.have.length(1);
      const [record] = body;
      expect(Number(record.building_id)).to.eq(Number(building.id));
      expect(Number(record.portfolio_id)).to.eq(Number(building.portfolio_id));
      expect(Number(record.region_id)).to.eq(Number(building.region_id));
      expect(record).to.include({
        building_number: building.building_number,
        building_name: building.name,
        portfolio_number: building.portfolio_number,
        portfolio_name: building.portfolio_name,
      });
      expect(record.tenant_list).to.deep.eq([]);
    }));
  });

  it('UM-API-012-NEG - Reject a detail lookup for an unknown Building', { tags: '@building' }, () => {
    api.assertUnknownRecord('building', '/buildings/detail');
  });

  it('UM-API-021-POS - List only active tenants belonging to the requested Building', { tags: '@tenant' }, () => {
    return cy.task('db:query', {
      sql: `SELECT b.building_number FROM core.building b
            WHERE b.is_offline=0 AND EXISTS (
              SELECT 1 FROM core.tenant t WHERE t.building_number=b.building_number AND t.is_offline=0
            ) ORDER BY b.id LIMIT 1`,
    }, { log: false }).then(rows => {
      expect(rows, 'active Building with tenants').to.have.length(1);
      const { building_number: buildingNumber } = rows[0];
      return api.request('GET', `/tenants/list/${encodeURIComponent(buildingNumber)}`).then(({ status, body }) => {
        expect(status).to.eq(200);
        expect(body).to.be.an('array').and.have.length(1);
        const [record] = body;
        expect(record.building_number).to.eq(buildingNumber);
        expect(record.tenant_list).to.be.an('array').and.not.be.empty;
        return cy.task('db:query', {
          sql: 'SELECT id, tenant_name FROM core.tenant WHERE building_number=? AND is_offline=0',
          params: [buildingNumber],
        }, { log: false }).then(tenants => {
          const actual = record.tenant_list.map(tenant => ({ id: Number(tenant.tenant_id), tenant_name: tenant.tenant_name }));
          const expected = tenants.map(tenant => ({ id: Number(tenant.id), tenant_name: tenant.tenant_name }));
          expect(actual, 'exact active tenants for the Building').to.have.deep.members(expected);
        });
      });
    });
  });

  it('UM-API-021-NEG - Reject a tenant list lookup for an unknown Building number', { tags: '@tenant' }, () => {
    const { number } = buildingData();
    cy.task('db:query', { sql: 'SELECT id FROM core.building WHERE building_number=?', params: [number] }, { log: false })
      .should('have.length', 0);
    return api.assertRejectedRead(`/tenants/list/${encodeURIComponent(number)}`);
  });

  it('UM-API-022-POS - Return the exact Tenant, exemptions and saved leases', { tags: '@tenant' }, () => {
    return cy.task('db:query', {
      sql: `SELECT t.id, t.tenant_number, t.tenant_name, t.email, t.tax_exempt, t.lmep_exempt
            FROM core.tenant t JOIN core.building b ON b.building_number=t.building_number
            JOIN core.portfolio p ON p.id=b.portfolio_id
            WHERE t.is_offline=0 AND b.is_offline=0 AND p.is_offline=0
              AND EXISTS (SELECT 1 FROM core.lease l WHERE l.tenant_id=t.id AND l.is_offline=0)
            ORDER BY t.id LIMIT 1`,
    }, { log: false }).then(rows => {
      expect(rows, 'active Tenant with a saved lease').to.have.length(1);
      const [tenant] = rows;
      return api.request('GET', `/tenants/details/${tenant.id}`).then(({ status, body }) => {
        expect(status).to.eq(200);
        expect(body).to.be.an('array').and.have.length(1);
        const [record] = body;
        expect(Number(record.tenant_id)).to.eq(Number(tenant.id));
        expect(record.tenant_number).to.eq(tenant.tenant_number);
        const detail = record.tenant_json;
        expect(detail.tenant_name).to.eq(tenant.tenant_name);
        expect(detail.email ?? '').to.eq(tenant.email ?? '');
        for (const key of ['tax_exempt', 'lmep_exempt']) expect(String(detail[key])).to.eq(String(tenant[key]));
        expect(detail.leases).to.be.an('array').and.not.be.empty;
        return cy.task('db:query', {
          sql: 'SELECT id, location, lease_type, lease_start_date, lease_end_date FROM core.lease WHERE tenant_id=? AND is_offline=0',
          params: [tenant.id],
        }, { log: false }).then(leases => {
          expect(detail.leases.map(lease => Number(lease.id))).to.have.members(leases.map(lease => Number(lease.id)));
          for (const lease of detail.leases) {
            const saved = leases.find(row => Number(row.id) === Number(lease.id));
            expect(lease.location).to.eq(saved.location);
            expect(String(lease.lease_type)).to.eq(String(saved.lease_type));
            expect(lease.lease_start_date?.slice(0, 10) ?? null).to.eq(saved.lease_start_date);
            expect(lease.lease_end_date?.slice(0, 10) ?? null).to.eq(saved.lease_end_date);
          }
        });
      });
    });
  });

  it('UM-API-022-NEG - Reject a detail lookup for an unknown Tenant', { tags: '@tenant' }, () => {
    api.assertUnknownRecord('tenant', '/tenants/details');
  });
});
