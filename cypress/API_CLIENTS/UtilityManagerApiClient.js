import { supportedUtilities } from '../data/qaData';

export class UtilityManagerApiClient {
  constructor(user) {
    this.user = user;
  }

  authenticate() {
    return cy.task('auth:apiLogin', { user: this.user }, { log: false }).its('authenticated').should('eq', true);
  }

  request(method, path, body, options = {}) {
    const timeout = options.timeout ?? Cypress.config('responseTimeout');
    return cy.task('api:request', { method, path, timeout, user: this.user, ...(body === undefined ? {} : { body }), ...(options.encoding ? { encoding: options.encoding } : {}) }, { log: false }).then(response => {
      const allowed = options.allowedStatuses;
      if (allowed ? !allowed.includes(response.status) : response.status < 200 || response.status >= 300) {
        const displayPath = options.redactPath ? '[private path]' : path;
        throw new Error(`${method} ${displayPath} returned HTTP ${response.status}. Request credentials are private.`);
      }
      return response;
    });
  }

  billingTemplates() {
    return this.request('GET', '/associated/billing_template_details').then(({ body }) => {
      expect(body).to.be.an('array').and.not.be.empty;
      expect(body[0]).to.have.property('billing_template_id');
      return body;
    });
  }

  createPortfolio(data) {
    return cy.task('fixtures:reserve', { kind: 'portfolio', ...data }, { log: false }).then(() => {
      return this.billingTemplates().then(templates => this.request('POST', '/portfolios/create', {
        name: data.name,
        portfolio_number: data.number,
        billing_template_id: templates[0].billing_template_id,
        created_by: 'UMQA',
        attributes: [{ key: 'region', value: 'GCC' }, { key: 'priority', value: 'high' }, { key: 'status', value: 'active' }],
      }));
    }).then(response => {
      expect(response.status).to.be.oneOf([200, 201]);
      return cy.task('db:portfolio', data.number, { log: false });
    }).then(rows => {
      expect(rows).to.have.length(1);
      expect(rows[0].name).to.eq(data.name);
      return rows[0];
    });
  }

  assertReferenceData(path, idKey, nameKey) {
    return this.request('GET', path).then(response => {
      expect(response.status).to.eq(200);
      expect(response.headers['content-type']).to.include('application/json');
      expect(response.body).to.be.an('array').and.not.be.empty;
      const ids = response.body.map(item => {
        expect(Number.isInteger(item[idKey]), idKey).to.eq(true);
        expect(item[idKey], idKey).to.be.greaterThan(0);
        expect(item[nameKey], nameKey).to.be.a('string').and.match(/\S/);
        return item[idKey];
      });
      expect(new Set(ids).size).to.eq(ids.length);
      if (path === '/associated/utility_id_names') {
        const keys = response.body.map(item => {
          expect(item.utility_key, 'utility key').to.be.a('string').and.match(/\S/);
          return item.utility_key;
        });
        expect(new Set(keys).size, 'unique utility keys').to.eq(keys.length);
        for (const utility of supportedUtilities) expect(response.body.filter(item => item[nameKey] === utility), `supported utility ${utility}`).to.have.length(1);
      }
    });
  }

  portfolioSection(portfolio, section) {
    return this.request('GET', `/portfolios/${section}/${portfolio.id}`).then(({ status, body }) => {
      expect(status).to.eq(200);
      expect(body).to.be.an('array').and.have.length(1);
      const [record] = body;
      expect(Number(record.portfolio_id)).to.eq(Number(portfolio.id));
      expect(record).to.include({ portfolio_name: portfolio.name, portfolio_number: portfolio.portfolio_number });
      return record;
    });
  }

  assertUnknownRecord(kind, path) {
    const table = { portfolio: 'core.portfolio', building: 'core.building', tenant: 'core.tenant' }[kind];
    return cy.task('db:query', {
      sql: `SELECT COALESCE(MAX(id),0)+1000000 AS missing_id FROM ${table}`,
    }, { log: false }).then(([row]) => {
      const id = Number(row.missing_id);
      expect(id, `nonexistent ${kind} ID`).to.be.a('number').and.be.greaterThan(0);
      return this.assertRejectedRead(`${path}/${id}`);
    });
  }

  assertRejectedRead(path, allowedStatuses = [400, 404, 422]) {
    return this.request('GET', path, undefined, { allowedStatuses }).then(({ body }) => {
      const message = typeof body === 'string' ? body : body?.message ?? body?.error?.message ?? body?.error;
      expect(message, `${path} lookup error`).to.be.a('string').and.match(/\S/);
    });
  }

  assertPortfolioMeters(utilityName) {
    return cy.task('db:query', {
      sql: `SELECT p.id, p.name, p.portfolio_number
            FROM core.portfolio p JOIN core.building b ON b.portfolio_id=p.id
            JOIN core.meter m ON m.building_number=b.building_number JOIN core.utility u ON u.id=m.utility_id
            WHERE p.is_offline=0 AND b.is_offline=0 AND m.is_offline=0 AND u.utility=?
            ORDER BY p.id LIMIT 1`,
      params: [utilityName],
    }, { log: false }).then(rows => {
      expect(rows, `active portfolio with ${utilityName} meters`).to.have.length(1);
      const [portfolio] = rows;
      return this.portfolioSection(portfolio, 'meter').then(({ utility_meter_list: groups }) => {
        expect(groups).to.be.an('array');
        return cy.task('db:query', {
          sql: `SELECT m.meter_id, m.meter_number, m.building_number, m.utility_id
                FROM core.meter m JOIN core.building b ON b.building_number=m.building_number
                JOIN core.utility u ON u.id=m.utility_id
                WHERE b.portfolio_id=? AND b.is_offline=0 AND m.is_offline=0 AND u.utility=?`,
          params: [portfolio.id, utilityName],
        }, { log: false }).then(expected => {
          expect(expected, `active ${utilityName} meter fixtures`).not.to.be.empty;
          const matching = groups.filter(group => Number(group.utility_id) === Number(expected[0].utility_id));
          expect(matching, `${utilityName} group`).to.have.length(1);
          const actual = matching[0].meter_list.map(meter => {
            expect(meter.utility).to.eq(utilityName);
            return { meter_id: Number(meter.meter_id), meter_number: meter.meter_number, building_number: meter.building_number };
          });
          expect(actual, `${utilityName} meter IDs, numbers and owning buildings`).to.have.deep.members(
            expected.map(({ meter_id, meter_number, building_number }) => ({ meter_id: Number(meter_id), meter_number, building_number })),
          );
        });
      });
    });
  }

  assertMeterTypes(utilityName, expectedBaseType, typeNamePattern) {
    return this.request('GET', '/associated/utility_id_names').then(({ body: utilities }) => {
      const utility = utilities.find(item => item.utility === utilityName);
      expect(utility, `${utilityName} reference`).to.exist;
      return this.request('GET', `/associated/meter_types_id/${utility.utility_id}`).then(({ status, body }) => {
        expect(status).to.eq(200);
        expect(body).to.be.an('array').and.not.be.empty;
        const ids = body.map(type => {
          expect(Number.isInteger(type.type_id), 'integer meter type ID').to.eq(true);
          expect(type.type_id, 'meter type ID').to.be.greaterThan(0);
          expect(type.meter_type).to.be.a('string');
          expect(type.meter_type).to.match(typeNamePattern);
          expect(type.description, 'meter type description').to.be.a('string');
          return type.type_id;
        });
        expect(new Set(ids).size, 'unique meter types').to.eq(ids.length);
        expect(body.map(type => type.meter_type)).to.include(expectedBaseType);
      });
    });
  }

  assertCompatibleRates(utilityName, regionName) {
    return this.request('GET', '/associated/region_details').then(({ body: regions }) => {
      const region = regions.find(item => item.region === regionName);
      expect(region, `${regionName} region`).to.exist;
      return cy.task('db:query', {
        sql: `SELECT r.id, r.name, r.utility_id FROM rates.vrb_rate r
              JOIN core.utility u ON u.id=r.utility_id
              WHERE u.utility=? AND r.region_id=? AND COALESCE(r.is_offline,0)=0`,
        params: [utilityName, region.region_id],
      }, { log: false }).then(expected => {
        expect(expected, `active ${utilityName} rates for ${regionName}`).not.to.be.empty;
        const utilityId = Number(expected[0].utility_id);
        return this.request('GET', `/associated/rates/list/${region.region_id}/${utilityId}`).then(({ status, body }) => {
          expect(status).to.eq(200);
          expect(body).to.include({ region_id: region.region_id, utility_id: utilityId });
          expect(body.rates).to.be.an('array').and.not.be.empty;
          const ids = body.rates.map(rate => {
            const { id } = rate;
            expect(Number.isInteger(id), 'integer rate ID').to.eq(true);
            expect(rate).to.include({
              utility_id: utilityId, region_id: region.region_id,
              utility: utilityName, region_name: regionName,
            });
            expect(rate.code, 'rate code').to.be.a('string').and.match(/\S/);
            expect(rate.name, 'rate name').to.be.a('string').and.match(/\S/);
            expect(expected.find(row => Number(row.id) === id), `active rate ${id}`).to.include({ name: rate.name });
            return id;
          });
          expect(new Set(ids).size, 'unique rate IDs').to.eq(ids.length);
        });
      });
    });
  }

  assertMeterList(building, meter, excluded) {
    return this.request('GET', `/meters/list/${encodeURIComponent(building.building_number)}`).then(response => {
      expect(response.status).to.eq(200);
      expect(response.body).to.be.an('array').and.have.length(1);
      expect(response.body[0].building_number).to.eq(building.building_number);
      const groups = response.body[0].utility_meter_json;
      expect(groups).to.be.an('array');
      const group = groups.find(item => Number(item.utility_id) === Number(meter.utility_id));
      expect(group, `requested ${meter.utilityName} group`).to.exist;
      expect(group.meter_list).to.be.an('array');
      expect(group.meter_list.find(item => Number(item.meter_id) === meter.meter_id)).to.include({ meter_number: meter.meter_number });
      const listed = groups.flatMap(item => item.meter_list || []);
      const ids = listed.map(item => Number(item.meter_id));
      expect(new Set(ids).size, 'no duplicate Meter IDs').to.eq(ids.length);
      for (const other of excluded) expect(ids, 'other Building meters excluded').not.to.include(other.meter_id);
      return cy.task('db:query', { sql: 'SELECT meter_id,meter_number,utility_id FROM core.meter WHERE building_number=? AND is_offline=0 ORDER BY meter_id', params: [building.building_number] }, { log: false }).then(rows => {
        expect([...ids].sort((a, b) => a - b), 'complete owned Building Meter list').to.deep.eq(rows.map(row => row.meter_id));
        for (const row of rows) {
          const utility = groups.find(item => Number(item.utility_id) === Number(row.utility_id));
          expect(utility, `DB utility ${row.utility_id}`).to.exist;
          expect(utility.meter_list.find(item => Number(item.meter_id) === row.meter_id)).to.include({ meter_number: row.meter_number });
        }
      });
    });
  }

  assertMeterDetails(meter, excluded) {
    return this.request('GET', `/meters/details/${meter.meter_id}`).then(response => {
      expect(response.status).to.eq(200);
      expect(response.body).to.be.an('array').and.have.length(1);
      expect(Number(response.body[0].meter_id)).to.eq(meter.meter_id);
      for (const other of excluded) expect(Number(response.body[0].meter_id)).not.to.eq(other.meter_id);
      const detail = response.body[0].meter_json;
      expect(detail).to.be.an('object');
      return cy.task('db:query', { sql: 'SELECT * FROM core.meter WHERE meter_id=?', params: [meter.meter_id] }, { log: false }).then(rows => {
        expect(rows).to.have.length(1);
        const saved = rows[0];
        for (const key of ['meter_number', 'building_number', 'location', 'meter_start_date', 'meter_end_date']) {
          expect(detail[key], `API ${key}`).to.eq(saved[key]);
          expect(saved[key], `owned ${key}`).to.eq(meter[key]);
        }
        for (const key of ['utility_id', 'meter_type_id', 'reading_interval', 'consumption_multiplier', 'demand_multiplier', 'meter_setup_fee', 'meter_addon_fee', 'not_billable_flag', 'is_virtual', 'is_offline']) expect(Number(detail[key]), `API ${key}`).to.eq(Number(saved[key]));
        expect(detail.reading_type || '', 'optional reading type').to.eq(saved.reading_type || '');
        expect(saved.source_meter_id, 'owned physical source').to.eq(null);
        expect(saved.lease_utility_id, 'unassigned fixture').to.eq(null);
        expect(detail.virtual_meters, 'empty source has no virtual children').to.be.an('array').and.have.length(0);
      });
    });
  }

  assertMissingMeterContext(kind, number) {
    if (!['building', 'meter'].includes(kind)) throw new Error('Unsupported missing Meter context.');
    const query = kind === 'building'
      ? { sql: 'SELECT id FROM core.building WHERE building_number=?', params: [number] }
      : { sql: 'SELECT COALESCE(MAX(meter_id),0)+1000000 AS missing_id FROM core.meter', params: [] };
    return cy.task('db:query', query, { log: false }).then(rows => {
      if (kind === 'building') expect(rows, 'unknown Building identity').to.have.length(0);
      const identity = kind === 'building' ? number : rows[0].missing_id;
      const lookup = kind === 'building'
        ? { sql: 'SELECT meter_id FROM core.meter WHERE building_number=?', params: [identity] }
        : { sql: 'SELECT meter_id FROM core.meter WHERE meter_id=?', params: [identity] };
      cy.task('db:query', lookup, { log: false }).should('have.length', 0);
      return this.request('GET', `/meters/${kind === 'building' ? 'list' : 'details'}/${encodeURIComponent(identity)}`, undefined, { allowedStatuses: [404] }).then(response => {
        expect(response.status).to.eq(404);
        if (kind === 'meter') {
          expect(response.body).to.eq(`meter with meter_id ${identity} not found`);
        } else {
          expect(response.body).to.be.an('object');
          expect(response.body.message, 'useful not-found message').to.be.a('string').and.not.be.empty;
        }
        cy.task('db:query', lookup, { log: false }).should('have.length', 0);
      });
    });
  }
}
