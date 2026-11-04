import { AppPage } from './AppPage';
import { tenantData, leaseUtilityData, supportedUtilities } from '../cypress/data/qaData';

const utilityFields = {
  'Admin Fee': ['lease_utility_admin_fee', 'Admin fee %'], 'Addon Fee': ['lease_utility_addon_fee'],
  'LMEP Credit': ['lmep_credit'], 'Coincident Demand': ['coincident_demand'],
  'External Fee': ['external_fee_percentage', 'External fee %'], 'Trans Fee': ['trans_fee_percentage', 'Transaction fee %'],
  'LMEP Rate': ['lmep_rate_percentage', 'LMEP rate %'], 'Billing Fee Adj': ['billing_fee_adj_percentage', 'Billing fee adj %'],
  'Overhead Profit': ['overhead_profit_percentage', 'Overhead profit %'],
};

export class TenantPage extends AppPage {
  visitNumber = 0;

  create(data, building) {
    this.openCreate(data, building);
    this.fill(data, { initialLease: true });
    return this.save(data, building);
  }

  openCreate(data, building) {
    cy.task('fixtures:reserve', { kind: 'tenant', ...data, buildingNumber: building.building_number, leaseMarker: data.location }, { log: false });
    cy.intercept('GET', '**/associated/leaseTypes/list').as('tenantLeaseTypes');
    cy.intercept('GET', `**/buildings/detail/${building.id}`).as('tenantParent');
    super.open(`/building/${building.id}`);
    cy.wait('@tenantParent').then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      expect(response.body[0].building_number).to.eq(building.building_number);
    });
    cy.contains('button', /^\s*Tenant\s*$/).click();
    cy.get('[role="dialog"]').should('contain.text', 'Add New Tenant');
  }

  fill(data, { initialLease = false, leaseOnly = false, leaseUtility = false } = {}) {
    if (leaseUtility) {
      for (const [label, [key]] of Object.entries(utilityFields)) {
        if (data[key] !== undefined) this.field(label).clear().type(String(data[key]));
      }
      return;
    }
    const fields = leaseOnly ? {} : {
      'Tenant Name': data.name, 'Tenant Number': data.number, Email: data.email,
      Street: data.street, City: data.city, State: data.state, 'ZIP Code': data.zip,
    };
    if (initialLease || leaseOnly) Object.assign(fields, {
      Location: data.location, [leaseOnly ? 'Square Footage' : 'Sqft']: data.sqft, Occupancy: data.occupancy,
      'Admin Fee': data.adminFee, 'Setup Charge': data.setupCharge, 'Review Charge': data.reviewCharge,
    });
    for (const [label, value] of Object.entries(fields)) {
      this.field(label).clear();
      if (value !== '') this.field(label).type(String(value));
    }
    if (!leaseOnly) {
      for (const [label, value] of [['Tax Exempt', data.taxExempt], ['LMEP Exempt', data.lmepExempt]]) {
        this.field(label).find(`[role="radio"][value="${value}"]`).click().should('have.attr', 'aria-checked', 'true');
      }
    }
    if (initialLease || leaseOnly) {
      cy.get('@tenantLeaseTypes.all', { timeout: Cypress.config('responseTimeout') }).should(calls => {
        expect(calls.findLast(call => call.response)?.response.statusCode).to.eq(200);
      }).then(calls => {
        const types = calls.findLast(call => call.response).response.body;
        expect(types).to.be.an('array').and.not.be.empty;
        const type = data.leaseType ? types.find(item => String(item.lease_type_id) === String(data.leaseType)) : types[0];
        expect(type, 'requested lease type is available').to.exist;
        this.select('Lease Type', type.lease_type);
      });
      this.setDate(leaseOnly ? 'Lease Start Date' : 'Start Date', data.startDate);
      this.setDate(leaseOnly ? 'Lease End Date' : 'End Date', data.endDate);
    }
  }

  save(data, building) {
    const detailAlias = `createdTenantDetail${++this.visitNumber}`;
    cy.intercept('POST', '**/tenants/create').as('createTenant');
    cy.intercept('POST', '**/employee-feed/create').as('tenantFeed');
    cy.intercept('GET', '**/tenants/details/*').as(detailAlias);
    cy.contains('[role="dialog"] button', /^Save$/).click();
    return cy.wait('@createTenant').then(({ request, response }) => {
      expect(response.statusCode).to.be.oneOf([200, 201]);
      expect(request.body).to.include({ tenant_number: data.number, tenant_name: data.name, building_number: building.building_number, email: data.email, location: data.location });
      expect(request.body.lease_start_date.slice(0, 10)).to.eq(data.startDate);
      expect(request.body.lease_end_date?.slice(0, 10) ?? null, 'submitted optional lease end date').to.eq(data.endDate);
      cy.verifyToast(response.body.message);
      cy.wait('@tenantFeed').its('response.statusCode').should('be.oneOf', [200, 201]);
      cy.location('pathname').should('eq', `/building/${building.id}/tenant/${response.body.tenantId}`);
      cy.get(`@${detailAlias}.all`, { timeout: Cypress.config('responseTimeout') }).should(calls => {
        const detail = calls.findLast(call => call.response)?.response;
        expect(detail, 'completed Tenant details response after creation').to.exist;
        expect(detail.statusCode).to.eq(200);
        expect(Number(detail.body[0].tenant_id)).to.eq(Number(response.body.tenantId));
      });
      cy.get('[aria-current="page"]', { timeout: Cypress.config('responseTimeout') }).should('be.visible').and('have.text', data.name);
      cy.contains('button', /^\s*Edit Tenant\s*$/).should('be.visible').and('not.be.disabled');
      cy.contains('[role="region"][data-state="open"] div', /^Tenant Num:$/).next().should('have.text', data.number);
      return cy.task('db:query', { sql: 'SELECT * FROM core.tenant WHERE tenant_number=?', params: [data.number] }, { log: false }).then(rows => {
        expect(rows).to.have.length(1);
        expect(Number(response.body.tenantId)).to.eq(rows[0].id);
        const tenant = { ...rows[0], data: { ...data } };
        return cy.task('db:query', { sql: 'SELECT * FROM core.lease WHERE tenant_id=?', params: [tenant.id] }, { log: false }).then(leases => {
          expect(leases).to.have.length(1);
          const lease = leases[0];
          expect(Number(response.body.leaseId)).to.eq(lease.id);
          expect(lease).to.include({ tenant_id: tenant.id, building_number: building.building_number, location: data.location });
          expect(lease.lease_start_date).to.eq(data.startDate);
          // Submitted end-date persistence is verified once, in UM-TEN-001.
          // Other cases use the actual saved lease without repeating that known failure.
          expect(String(lease.lease_type)).to.eq(String(request.body.lease_type));
          for (const [key, value] of Object.entries({ sqft: data.sqft, occupancy: data.occupancy, lease_admin_fee: data.adminFee, lease_setup_charge: data.setupCharge, lease_review_charge: data.reviewCharge })) expect(Number(lease[key]), key).to.eq(Number(value));
          return { ...tenant, lease };
        });
      });
    });
  }

  assertInvalidCreate(data, message, { cancel = false, endDate } = {}) {
    if (endDate !== undefined) this.setDate('End Date', endDate);
    const alias = `invalidTenant${++this.visitNumber}`;
    cy.intercept('POST', '**/tenants/create').as(alias);
    cy.contains('[role="dialog"] button', /^Save$/).click();
    cy.get('[role="dialog"]').should('contain.text', message);
    cy.get(`@${alias}.all`).should('have.length', 0);
    cy.task('db:query', { sql: 'SELECT id FROM core.tenant WHERE tenant_number=?', params: [data.number] }, { log: false }).should('have.length', 0);
    if (cancel) this.closeDialog();
  }

  open(tenant, building, expected = tenant.data, { endDate } = {}) {
    const alias = `tenantDetail${++this.visitNumber}`;
    cy.intercept('GET', `**/tenants/details/${tenant.id}`).as(alias);
    super.open(`/building/${building.id}/tenant/${tenant.id}`);
    return cy.get(`@${alias}.all`, { timeout: Cypress.config('responseTimeout') }).should(calls => {
      expect(calls.findLast(call => call.response)?.response.statusCode, 'completed Tenant details response').to.eq(200);
    }).then(calls => {
      const { response } = calls.findLast(call => call.response);
      expect(response.statusCode).to.eq(200);
      const detail = response.body[0];
      expect(Number(detail.tenant_id)).to.eq(tenant.id);
      expect(detail.tenant_number).to.eq(expected.number);
      cy.get('[aria-current="page"]', { timeout: Cypress.config('responseTimeout') }).should('be.visible').and('have.text', detail.tenant_json.tenant_name);
      cy.contains('button', /^\s*Edit Tenant\s*$/).should('be.visible').and('not.be.disabled');
      cy.contains('[role="region"][data-state="open"] div', /^Tenant Num:$/).next().should('have.text', detail.tenant_number);
      cy.task('db:query', { sql: 'SELECT * FROM core.tenant WHERE id=?', params: [tenant.id] }, { log: false }).then(rows => {
        expect(rows).to.have.length(1);
        expect(rows[0].building_number).to.eq(building.building_number);
        for (const [key, value] of Object.entries({ tenant_name: expected.name, street: expected.street, city: expected.city, state: expected.state, zip: expected.zip })) {
          expect(rows[0][key], key).to.eq(value);
          expect(detail.tenant_json[key], `API ${key}`).to.eq(value);
        }
        expect(rows[0].email || '').to.eq(expected.email);
        expect(detail.tenant_json.email || '').to.eq(expected.email);
        for (const [column, value] of [['tax_exempt', expected.taxExempt], ['lmep_exempt', expected.lmepExempt]]) {
          expect(Number(rows[0][column]), column).to.eq(Number(value));
          expect(Number(detail.tenant_json[column]), `API ${column}`).to.eq(Number(value));
        }
      });
      for (const [label, value] of [['Tenant Num', detail.tenant_number], ['Tenant Name', detail.tenant_json.tenant_name],
        ['Email', detail.tenant_json.email || '—'], ['Tax Exempt', Number(detail.tenant_json.tax_exempt) ? 'Yes' : 'No'], ['LMEP Exempt', Number(detail.tenant_json.lmep_exempt) ? 'Yes' : 'No']]) {
        cy.contains('[role="region"][data-state="open"] div', new RegExp(`^${label}:$`)).next().should('have.text', value);
      }
      cy.task('db:query', { sql: 'SELECT * FROM core.lease WHERE tenant_id=? AND is_offline=0', params: [tenant.id] }, { log: false }).then(leases => {
        const expectedLeases = tenant.leases || [tenant.lease];
        expect(leases.map(lease => lease.id)).to.have.members(expectedLeases.map(lease => lease.id));
        expect(detail.tenant_json.leases.map(lease => Number(lease.id))).to.have.members(leases.map(lease => lease.id));
        for (const saved of expectedLeases) {
          const dbLease = leases.find(lease => lease.id === saved.id);
          const apiLease = detail.tenant_json.leases.find(lease => Number(lease.id) === saved.id);
          for (const key of ['location', 'lease_type', 'lease_start_date', 'lease_end_date', 'sqft', 'occupancy', 'lease_admin_fee', 'lease_setup_charge', 'lease_review_charge']) {
            expect(dbLease[key], `saved lease ${saved.id}: ${key}`).to.eq(saved[key]);
            if (['sqft', 'occupancy', 'lease_admin_fee', 'lease_setup_charge', 'lease_review_charge'].includes(key)) {
              expect(Number(apiLease[key]), `API lease ${saved.id}: ${key}`).to.eq(Number(dbLease[key]));
            } else expect(String(apiLease[key] ?? ''), `API lease ${saved.id}: ${key}`).to.eq(String(dbLease[key] ?? ''));
          }
          this.leaseSection(saved).children('h3').find('button[aria-expanded]').then(trigger => {
            if (trigger.attr('aria-expanded') === 'false') cy.wrap(trigger).click();
          });
          for (const [label, value] of [['Location', apiLease.location], ['Lease Start Date', apiLease.lease_start_date],
            ['Sqft', apiLease.sqft], ['Occupancy', apiLease.occupancy], ['Lease Admin Fee', apiLease.lease_admin_fee], ['Lease Setup Charge', apiLease.lease_setup_charge]]) {
            this.leaseSection(saved).contains('[role="region"] div', new RegExp(`^${label}:$`)).next().should('have.text', String(value));
          }
          this.leaseSection(saved).contains('[role="region"] div', /^Lease End Date:$/).next()
            .should('be.visible').and('have.text', apiLease.lease_end_date ?? '—').invoke('text').then(uiDate => {
              if (endDate !== undefined && saved.id === tenant.lease.id) {
                expect({ api: apiLease.lease_end_date?.slice(0, 10) ?? null, db: dbLease.lease_end_date, ui: uiDate.trim() },
                  'UM-TEN-001: submitted initial end date must persist in API, DB and rendered UI')
                  .to.deep.eq({ api: endDate, db: endDate, ui: endDate ?? '—' });
              }
            });
        }
      });
      return cy.wrap(detail, { log: false });
    });
  }

  edit(tenant, building, data, { cancel = false, invalidEmail = false } = {}) {
    this.open(tenant, building);
    cy.contains('button', /^\s*Edit Tenant\s*$/).click();
    this.field('Tenant Number').should('have.value', tenant.data.number);
    this.field('Tenant Name').should('have.value', tenant.data.name);
    this.fill(data);
    if (invalidEmail) {
      cy.contains('[role="dialog"] button', /^Update$/).click();
      cy.get('[role="dialog"]').should('contain.text', 'Please enter a valid email address');
      this.closeDialog();
    } else if (cancel) this.closeDialog();
    else {
      cy.intercept('PUT', `**/tenants/update/${tenant.id}`).as('updateTenant');
      cy.contains('[role="dialog"] button', /^Update$/).click();
      cy.wait('@updateTenant').then(({ request, response }) => {
        expect(response.statusCode).to.eq(200);
        expect(request.body).to.include({ tenant_number: tenant.data.number, tenant_name: data.name, email: data.email });
        cy.verifyToast(response.body.message);
      });
      cy.get('[role="dialog"]').should('not.exist');
    }
    this.open(tenant, building, cancel || invalidEmail ? tenant.data : data);
  }

  leaseSection(lease) {
    // Read current location when commands execute, after any earlier edit has completed.
    return cy.then(() => cy.contains('[role="tab"]', new RegExp(`^${Cypress._.escapeRegExp(lease.location)}$`)).closest('h3').parent());
  }

  utilitySection(lease, utility) {
    return this.leaseSection(lease).contains('[role="tab"]', new RegExp(`^${Cypress._.escapeRegExp(utility.utilityName)}$`)).closest('h3').parent();
  }

  createUtility(tenant, building, utilityName) {
    const data = leaseUtilityData();
    this.openUtility(tenant, building, undefined, { reload: false });
    return this.selectUtility(building, utilityName).then(choice => {
      this.fill(data, { leaseUtility: true });
      return this.saveUtility(tenant, building, choice, data);
    });
  }

  addLease(tenant, building, data) {
    cy.task('fixtures:reserveLease', { tenantNumber: tenant.data.number, marker: data.location }, { log: false });
    this.open(tenant, building);
    cy.intercept('POST', '**/leases/create').as('createAdditionalLease');
    cy.contains('button', /^Add Lease$/).click();
    cy.contains('[role="dialog"] button', /^Add New Lease$/).click();
    cy.get('[role="dialog"]').should('contain.text', 'Location is required').and('contain.text', 'Please select lease type');
    cy.get('@createAdditionalLease.all').should('have.length', 0);
    this.fill({ ...data, leaseType: tenant.lease.lease_type }, { leaseOnly: true });
    cy.contains('[role="dialog"] button', /^Add New Lease$/).click();
    return cy.wait('@createAdditionalLease').then(({ request, response }) => {
      expect(response.statusCode).to.be.oneOf([200, 201]);
      expect(Number(request.body.tenant_id)).to.eq(tenant.id);
      expect(request.body).to.include({ building_number: building.building_number, location: data.location });
      expect(request.body.lease_start_date.slice(0, 10)).to.eq(data.startDate);
      expect(request.body.lease_end_date?.slice(0, 10) ?? null).to.eq(data.endDate);
      cy.verifyToast(response.body.message);
      cy.get('[role="dialog"]').should('not.exist');
      return cy.task('db:query', { sql: 'SELECT * FROM core.lease WHERE tenant_id=? AND location=?', params: [tenant.id, data.location] }, { log: false }).then(rows => {
        expect(rows).to.have.length(1);
        const lease = rows[0];
        expect(Number(response.body.leaseId), 'created lease ID matches DB').to.eq(lease.id);
        expect(lease).to.include({ building_number: building.building_number, lease_start_date: data.startDate, lease_end_date: data.endDate });
        expect(String(lease.lease_type)).to.eq(String(request.body.lease_type));
        for (const [key, value] of Object.entries({ sqft: data.sqft, occupancy: data.occupancy, lease_admin_fee: data.adminFee, lease_setup_charge: data.setupCharge, lease_review_charge: data.reviewCharge })) expect(Number(lease[key]), key).to.eq(Number(value));
        tenant.leases = [...(tenant.leases || [tenant.lease]), lease];
        this.open(tenant, building);
        this.leaseSection(lease).should('contain.text', 'No utilities assigned to this lease');
        this.leaseSection(lease).contains('button', /^Add Lease Utility$/).should('be.visible');
        return cy.wrap(lease, { log: false });
      });
    });
  }

  editLease(tenant, building, { endDate, lease = tenant.lease, location = lease.location, adminFee = '0', cancel = false }) {
    this.open(tenant, building);
    this.leaseSection(lease).contains('button', /^\s*Edit Lease\s*$/).click();
    this.field('Location').should(field => expect(field).to.have.value(lease.location)).clear().type(location);
    this.field('Admin Fee').clear().type(adminFee);
    this.setDate('Lease Start Date', lease.lease_start_date);
    this.setDate('Lease End Date', endDate);
    cy.intercept('PUT', `**/leases/update/${lease.id}`).as('updateInitialLease');
    if (cancel) {
      this.closeDialog();
      cy.get('@updateInitialLease.all').should('have.length', 0);
      this.open(tenant, building);
      return;
    }
    cy.contains('[role="dialog"] button', /^Update$/).click();
    cy.wait('@updateInitialLease').then(({ request, response }) => {
      expect(response.statusCode).to.eq(200);
      expect(Number(request.body.tenant_id)).to.eq(tenant.id);
      expect(request.body.building_number).to.eq(building.building_number);
      expect(request.body.lease_end_date?.slice(0, 10) || null).to.eq(endDate);
      if (endDate === null) expect(request.body.lease_end_date, 'explicitly clear end date').to.eq(null);
      expect(Number(response.body.has_moved_out), 'update response moved-out state').to.eq(endDate ? 1 : 0);
      cy.verifyToast(response.body.message);
    });
    cy.get('[role="dialog"]').should('not.exist');
    cy.task('db:query', { sql: 'SELECT * FROM core.lease WHERE id=? AND tenant_id=?', params: [lease.id, tenant.id] }, { log: false }).then(rows => {
      expect(rows).to.have.length(1);
      expect(rows[0].location).to.eq(location);
      expect(Number(rows[0].lease_admin_fee)).to.eq(Number(adminFee));
      expect(rows[0].lease_end_date).to.eq(endDate);
      expect(Number(rows[0].has_moved_out)).to.eq(endDate ? 1 : 0);
      Object.assign(lease, rows[0]);
    });
    this.open(tenant, building);
  }

  deleteLease(tenant, building, lease) {
    this.open(tenant, building);
    cy.intercept('PUT', `**/leases/delete/${lease.id}`).as('deleteOwnedLease');
    this.leaseSection(lease).contains('button', /^Edit Lease$/).click();
    cy.contains('[role="dialog"] button', /^Delete$/).click();
    cy.contains('[role="dialog"]', 'Are you sure you want to delete this lease?').as('leaseDeleteConfirmation');
    cy.get('@leaseDeleteConfirmation').contains('button', 'Close').click();
    cy.get('@deleteOwnedLease.all').should('have.length', 0);
    this.field('Location').should('have.value', lease.location);
    this.closeDialog();
    this.open(tenant, building);
    this.leaseSection(lease).contains('button', /^Edit Lease$/).click();
    cy.contains('[role="dialog"] button', /^Delete$/).click();
    cy.contains('[role="dialog"]', 'Are you sure you want to delete this lease?').contains('button', /^Confirm$/).click();
    cy.wait('@deleteOwnedLease').then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      cy.verifyToast(response.body.message);
    });
    cy.get('[role="dialog"]').should('not.exist');
    cy.task('db:query', { sql: 'SELECT is_offline FROM core.lease WHERE id=? AND tenant_id=?', params: [lease.id, tenant.id] }, { log: false }).then(rows => {
      expect(rows).to.have.length(1);
      expect(Number(rows[0].is_offline), 'only selected lease soft-deleted').to.eq(1);
      tenant.leases = tenant.leases.filter(item => item.id !== lease.id);
    });
    cy.contains('[role="tab"]', new RegExp(`^${Cypress._.escapeRegExp(lease.location)}$`)).should('not.exist');
    this.open(tenant, building);
  }

  checkEmptyMeterSelection(tenant, building, utility, { search = false } = {}) {
    const alias = `emptyMeterSelection${++this.visitNumber}`;
    cy.intercept('GET', `**/meters/list/${building.building_number}`).as(`${alias}List`);
    cy.intercept('POST', '**/leaseUtility/meters/create/**').as(`${alias}Assign`);
    cy.task('db:query', { sql: 'SELECT * FROM core.lease_utility WHERE lease_id=? ORDER BY id', params: [tenant.lease.id] }, { log: false }).then(before => {
      this.open(tenant, building);
      this.utilitySection(tenant.lease, utility).contains('button', /^Assign Meter$/).click();
      cy.get(`@${alias}List.all`, { timeout: Cypress.config('responseTimeout') }).should(calls => {
        const response = calls.findLast(call => call.response)?.response;
        expect(response, 'completed owned Building meter lookup').to.exist;
        expect(response.statusCode).to.eq(404);
        expect(response.body.message, 'empty meter lookup explanation').to.match(/meter.*not found|no.*meter/i);
      });
      cy.task('db:query', { sql: 'SELECT meter_id FROM core.meter WHERE building_number=?', params: [building.building_number] }, { log: false }).should('have.length', 0);
      cy.contains('[role="dialog"] button', /^Assign Meter$/).should('be.enabled').click();
      cy.get('[role="dialog"]').should('contain.text', 'Please select a meter');
      if (search) {
        this.field('Select Meter').click();
        cy.get('input[placeholder="Type or select..."]').should('be.visible').type(`${building.building_number}_NO_MATCH`);
        cy.contains('[data-radix-popper-content-wrapper]', 'No results found.').should('be.visible');
        cy.get('[data-radix-popper-content-wrapper] [role="option"]').should('not.exist');
        cy.contains('[data-radix-popper-content-wrapper] button', /Create/).should('not.exist');
        cy.get('input[placeholder="Type or select..."]').clear().type('{esc}');
        this.field('Select Meter').should('contain.text', 'Select a meter');
        this.field('Select Meter').click();
        cy.get('input[placeholder="Type or select..."]').should('have.value', '').type('{esc}');
      }
      cy.get(`@${alias}Assign.all`).should('have.length', 0);
      this.closeDialog();
      this.open(tenant, building).then(detail => {
        const saved = detail.tenant_json.leases.find(item => Number(item.id) === tenant.lease.id)
          .lease_utilities.find(item => Number(item.lease_utility_id) === utility.id);
        expect(saved, 'utility remains after assignment cancellation').to.exist;
        expect(saved.meters || []).to.deep.eq([]);
      });
      cy.task('db:query', { sql: 'SELECT * FROM core.lease_utility WHERE lease_id=? ORDER BY id', params: [tenant.lease.id] }, { log: false }).should('deep.eq', before);
      cy.task('db:query', { sql: 'SELECT meter_id FROM core.meter WHERE building_number=?', params: [building.building_number] }, { log: false }).should('have.length', 0);
    });
  }

  assignMeter(tenant, building, utility, meter) {
    const alias = `assignOwnedMeter${++this.visitNumber}`;
    cy.intercept('GET', `**/meters/list/${building.building_number}`).as(`${alias}List`);
    this.open(tenant, building);
    this.utilitySection(tenant.lease, utility).contains('button', /^Assign Meter$/).click();
    cy.get(`@${alias}List.all`, { timeout: Cypress.config('responseTimeout') }).should(calls => {
      const response = calls.findLast(call => call.response)?.response;
      expect(response?.statusCode).to.eq(200);
      const group = response.body[0].utility_meter_json.find(item => Number(item.utility_id) === Number(utility.utilityId));
      expect(group, 'matching utility candidates').to.exist;
      expect(group.meter_list.find(item => Number(item.meter_id) === meter.meter_id)).to.include({ meter_number: meter.meter_number });
      for (const item of group.meter_list) expect(Number(item.utility_id || group.utility_id)).to.eq(Number(utility.utilityId));
    });
    cy.contains('[role="dialog"] label', /^Select Meter$/).parent().find('button[role="combobox"]').click();
    cy.get('input[placeholder="Type or select..."]').type(meter.meter_number);
    cy.contains('[role="option"]', new RegExp(`^${Cypress._.escapeRegExp(meter.meter_number)}$`)).click();
    cy.intercept('POST', `**/leaseUtility/meters/create/${utility.id}/${meter.meter_id}?action=assign`).as(alias);
    cy.intercept('GET', `**/tenants/details/${tenant.id}`).as(`${alias}Detail`);
    cy.contains('[role="dialog"] button', /^Assign Meter$/).click();
    cy.wait(`@${alias}`).then(({ request, response }) => {
      expect(response.statusCode).to.be.oneOf([200, 201]);
      expect(new URL(request.url).pathname).to.eq(`/leaseUtility/meters/create/${utility.id}/${meter.meter_id}`);
      expect(new URL(request.url).searchParams.get('action')).to.eq('assign');
      cy.wait(`@${alias}Detail`).its('response.statusCode').should('eq', 200);
      cy.verifyToast(response.body.message);
    });
    cy.get('[role="dialog"]').should('not.exist');
    cy.task('db:query', { sql: 'SELECT meter_number,building_number,utility_id,lease_utility_id FROM core.meter WHERE meter_id=?', params: [meter.meter_id] }, { log: false }).then(rows => {
      expect(rows).to.have.length(1);
      expect(rows[0]).to.include({ meter_number: meter.meter_number, building_number: building.building_number, utility_id: Number(utility.utilityId), lease_utility_id: utility.id });
    });
    this.open(tenant, building).then(detail => {
      const apiLease = detail.tenant_json.leases.find(item => Number(item.id) === tenant.lease.id);
      const target = apiLease.lease_utilities.find(item => Number(item.lease_utility_id) === utility.id);
      expect(target.meters.find(item => Number(item.meter_id) === meter.meter_id)).to.include({ meter_number: meter.meter_number });
      for (const sibling of apiLease.lease_utilities.filter(item => Number(item.lease_utility_id) !== utility.id)) expect((sibling.meters || []).some(item => Number(item.meter_id) === meter.meter_id), 'other utility excludes assigned meter').to.eq(false);
      this.utilitySection(tenant.lease, utility).children('h3').find('button[aria-expanded]').then(trigger => { if (trigger.attr('aria-expanded') === 'false') cy.wrap(trigger).click(); });
      this.utilitySection(tenant.lease, utility).contains('tbody td', new RegExp(`^${Cypress._.escapeRegExp(meter.meter_number)}$`)).should('be.visible');
    });
  }

  deleteUtility(tenant, building, utility) {
    const alias = `deleteLeaseUtility${++this.visitNumber}`;
    cy.task('db:query', { sql: 'SELECT * FROM core.lease_utility WHERE lease_id=? ORDER BY id', params: [tenant.lease.id] }, { log: false }).then(before => {
      expect(before.find(item => item.id === utility.id), 'owned active utility before deletion').to.include({ is_offline: 0 });
      this.openUtility(tenant, building, utility);
      cy.intercept('PUT', `**/leaseUtility/delete/${utility.id}`).as(alias);
      cy.contains('[role="dialog"] button', /^Delete$/).click();
      cy.contains('[role="dialog"]', 'Are you sure you want to delete this lease utility?').contains('button', /^Close$/).click();
      cy.get(`@${alias}.all`).should('have.length', 0);
      this.field('Utility Type').should('contain.text', utility.utilityName);
      this.closeDialog();
      cy.task('db:query', { sql: 'SELECT * FROM core.lease_utility WHERE lease_id=? ORDER BY id', params: [tenant.lease.id] }, { log: false }).should('deep.eq', before);
      this.openUtility(tenant, building, utility);
      cy.contains('[role="dialog"] button', /^Delete$/).click();
      cy.intercept('GET', `**/tenants/details/${tenant.id}`).as(`${alias}Detail`);
      cy.contains('[role="dialog"]', 'Are you sure you want to delete this lease utility?').contains('button', /^Confirm$/).click();
      cy.wait(`@${alias}`).its('response').then(response => {
        expect(response.statusCode).to.eq(200);
        cy.wait(`@${alias}Detail`).its('response.statusCode').should('eq', 200);
        cy.verifyToast(response.body.message);
      });
      cy.get('[role="dialog"]').should('not.exist');
      cy.task('db:query', { sql: 'SELECT * FROM core.lease_utility WHERE lease_id=? ORDER BY id', params: [tenant.lease.id] }, { log: false }).then(after => {
        expect(after).to.have.length(before.length);
        expect(Number(after.find(item => item.id === utility.id).is_offline), 'selected utility soft-deleted').to.eq(1);
        expect(after.filter(item => item.id !== utility.id), 'other utilities unchanged').to.deep.eq(before.filter(item => item.id !== utility.id));
      });
      this.open(tenant, building).then(detail => {
        const utilities = detail.tenant_json.leases.find(item => Number(item.id) === tenant.lease.id).lease_utilities || [];
        expect(utilities.map(item => Number(item.lease_utility_id)), 'reloaded API excludes only deleted utilities')
          .to.have.members(before.filter(item => item.id !== utility.id && Number(item.is_offline) === 0).map(item => item.id));
        this.leaseSection(tenant.lease).contains('[role="tab"]', new RegExp(`^${Cypress._.escapeRegExp(utility.utilityName)}$`)).should('not.exist');
      });
    });
  }

  openUtility(tenant, building, saved, { reload = true } = {}) {
    const createAlias = `createLeaseUtility${++this.visitNumber}`;
    this.utilityCreateAlias = createAlias;
    if (reload) this.open(tenant, building);
    else cy.location('pathname').should('eq', `/building/${building.id}/tenant/${tenant.id}`);
    cy.intercept('GET', '**/associated/utility_id_names').as('leaseUtilityTypes');
    cy.intercept('POST', '**/leaseUtility/create').as(createAlias);
    if (saved) {
      this.utilitySection(tenant.lease, saved)
        .contains('button', /^Edit Lease Utility$/).click();
      for (const [label, [key, percentage]] of Object.entries(utilityFields)) this.field(label).should(input => {
        expect(Number(input.val()), `prefilled ${key}`).to.be.closeTo(Number(saved[key]) * (percentage ? 100 : 1), 0.000001);
      });
      this.field('Utility Type').should('contain.text', saved.utilityName);
      this.field('Rate').should('contain.text', saved.rateName);
    } else {
      this.leaseSection(tenant.lease).contains('button', /^Add Lease Utility$/).click();
      cy.contains('[role="dialog"] button', /^Add New Lease Utility$/).should('be.enabled').click();
      cy.get('[role="dialog"]').should('contain.text', 'Utility type is required').and('contain.text', 'Rate is required');
      cy.get(`@${createAlias}.all`).should('have.length', 0);
    }
  }

  selectUtility(building, utilityName, { allowNoRates = false } = {}) {
    return cy.get('@leaseUtilityTypes.all', { timeout: Cypress.config('responseTimeout') }).should(calls => {
      expect(calls.findLast(call => call.response)?.response.statusCode).to.eq(200);
    }).then(calls => {
      const utility = calls.findLast(call => call.response).response.body.find(item => item.utility === utilityName);
      expect(utility, `${utilityName} reference`).to.exist;
      const utilityId = Number(utility.utility_id);
      const alias = `utilityRates${++this.visitNumber}`;
      cy.intercept('GET', `**/associated/rates/list/${building.region_id}/${utilityId}`).as(alias);
      cy.intercept('GET', `**/accounts/${building.id}/${utilityId}`).as(`${alias}Accounts`);
      this.select('Utility Type', utilityName);
      this.field('Rate').should('contain.text', 'Select rate');
      this.field('Utility Bill Account').should('contain.text', 'Select utility account');
      cy.wait(`@${alias}Accounts`).then(({ response }) => {
        expect(response.statusCode).to.be.oneOf([200, 404]);
        if (response.statusCode === 200) expect(response.body, 'owned Building has no utility accounts').to.deep.eq([]);
        else expect(response.body.message).to.be.a('string').and.not.be.empty;
      });
      return cy.wait(`@${alias}`).then(({ response }) => {
        if (allowNoRates && response.statusCode === 404) {
          expect(response.body.message, 'empty rate lookup explanation').to.match(/rate.*not found|no.*rate/i);
          this.field('Rate').should('contain.text', 'Select rate');
          return cy.task('db:query', {
            sql: 'SELECT id FROM rates.vrb_rate WHERE region_id=? AND utility_id=? AND COALESCE(is_offline,0)=0',
            params: [building.region_id, utilityId],
          }, { log: false }).then(rows => {
            expect(rows, '404 must represent an empty compatible rate set').to.have.length(0);
            return cy.wrap({ utilityId, utilityName, rateId: null, rateName: null }, { log: false });
          });
        }
        expect(response.statusCode).to.eq(200);
        expect(response.body.rates, `compatible ${utilityName} rates for Building region`).to.be.an('array').and.not.be.empty;
        for (const rate of response.body.rates) {
          expect(Number(rate.utility_id)).to.eq(utilityId);
          expect(Number(rate.region_id)).to.eq(Number(building.region_id));
        }
        const rate = response.body.rates[0];
        this.select('Rate', rate.name);
        return cy.wrap({ utilityId, utilityName, rateId: Number(rate.id), rateName: rate.name }, { log: false });
      });
    });
  }

  assertUtilityPrecision(tenant, choice, data) {
    const createAlias = this.utilityCreateAlias;
    cy.task('fixtures:reserveLeaseChild', { tenantNumber: tenant.tenant_number, leaseId: tenant.lease.id, type: 'utility', utilityId: choice.utilityId }, { log: false });
    choice.reserved = true;
    for (const [label, [key, error]] of Object.entries(utilityFields)) {
      if (!error) continue;
      for (const [value, message] of [['-1', `${error} is required`], ['1.234', `${error} must have at most 2 decimal places`]]) {
        this.field(label).clear().type(value);
        cy.contains('[role="dialog"] button', /^Add New Lease Utility$/).click();
        cy.get('[role="dialog"]').should('contain.text', message);
        cy.get(`@${createAlias}.all`).should('have.length', 0);
      }
      this.field(label).clear().type(String(data[key]));
    }
  }

  saveUtility(tenant, building, choice, data, { cancel = false } = {}) {
    const alias = `savedLeaseUtility${++this.visitNumber}`;
    if (!choice.id && !cancel && !choice.reserved) cy.task('fixtures:reserveLeaseChild', { tenantNumber: tenant.tenant_number, leaseId: tenant.lease.id, type: 'utility', utilityId: choice.utilityId }, { log: false });
    cy.intercept(choice.id ? 'PUT' : 'POST', choice.id ? `**/leaseUtility/update/${choice.id}` : '**/leaseUtility/create').as(alias);
    if (cancel) {
      this.closeDialog();
      cy.get(`@${alias}.all`).should('have.length', 0);
      return cy.task('db:query', { sql: 'SELECT * FROM core.lease_utility WHERE lease_id=?', params: [tenant.lease.id] }, { log: false }).then(rows => {
        if (choice.id) expect(rows.find(row => row.id === choice.id)).to.include({ utility_id: choice.utility_id, rate_id: choice.rate_id,
          ...Object.fromEntries(Object.values(utilityFields).map(([key]) => [key, choice[key]])) });
        else expect(rows).to.have.length(0);
      });
    }
    cy.intercept('GET', `**/tenants/details/${tenant.id}`).as(`${alias}Detail`);
    cy.contains('[role="dialog"] button', choice.id ? /^Update$/ : /^Add New Lease Utility$/).click();
    return cy.wait(`@${alias}`).then(({ request, response }) => {
      expect(response.statusCode).to.be.oneOf([200, 201]);
      // The application awaits the Tenant refetch before showing its success toast.
      cy.wait(`@${alias}Detail`).its('response.statusCode').should('eq', 200);
      cy.verifyToast(response.body.message);
      cy.then(() => {
        expect(Number(request.body.lease_id)).to.eq(tenant.lease.id);
        expect(Number(request.body.utility_id)).to.eq(choice.utilityId);
        expect(Number(request.body.rate_id)).to.eq(choice.rateId);
        expect(Number(request.body.region_id)).to.eq(Number(building.region_id));
        for (const [key, percentage] of Object.values(utilityFields)) expect(Number(request.body[key]), `payload ${key}`).to.be.closeTo(Number(data[key]) / (percentage ? 100 : 1), 0.000001);
      });
      cy.get('[role="dialog"]').should('not.exist');
      return cy.task('db:query', { sql: 'SELECT * FROM core.lease_utility WHERE lease_id=? AND utility_id=?', params: [tenant.lease.id, choice.utilityId] }, { log: false }).then(rows => {
        expect(rows).to.have.length(1);
        const saved = { ...rows[0], utilityName: choice.utilityName, rateName: choice.rateName, utilityId: choice.utilityId, rateId: choice.rateId };
        if (choice.id) expect(saved.id).to.eq(choice.id);
        expect(Number(saved.rate_id)).to.eq(choice.rateId);
        expect(Number(saved.utility_bill_account || 0), 'optional account stays empty').to.eq(0);
        for (const [key, percentage] of Object.values(utilityFields)) expect(Number(saved[key]), `DB ${key}`).to.be.closeTo(Number(data[key]) / (percentage ? 100 : 1), 0.000001);
        return this.open(tenant, building).then(detail => {
          const apiLease = detail.tenant_json.leases.find(lease => Number(lease.id) === tenant.lease.id);
          const item = apiLease.lease_utilities.find(utility => Number(utility.lease_utility_id) === saved.id);
          expect(item, 'saved utility in reloaded Tenant API').to.exist;
          expect(Number(item.utility_id)).to.eq(choice.utilityId);
          expect(Number(item.rate_id)).to.eq(choice.rateId);
          for (const sibling of detail.tenant_json.leases.filter(lease => Number(lease.id) !== tenant.lease.id)) expect(sibling.lease_utilities, 'sibling Lease utilities unchanged').to.deep.eq([]);
          cy.task('db:query', { sql: 'SELECT u.id FROM core.lease_utility u JOIN core.lease l ON l.id=u.lease_id WHERE l.tenant_id=? AND l.id<>?', params: [tenant.id, tenant.lease.id] }, { log: false }).should('have.length', 0);
          for (const [key] of Object.values(utilityFields)) expect(Number(item[key]), `API ${key}`).to.be.closeTo(Number(saved[key]), 0.000001);
          this.utilitySection(tenant.lease, choice).as('savedUtilitySection')
            .find('h3 button[aria-expanded]').then(trigger => { if (trigger.attr('aria-expanded') === 'false') cy.wrap(trigger).click(); });
          for (const [label, value] of [['Lease Utility Admin Fee', data.lease_utility_admin_fee], ['LMEP Credit', data.lmep_credit], ['Lease Utility Addon Fee', data.lease_utility_addon_fee], ['Coincidental Demand', data.coincident_demand]]) {
            cy.get('@savedUtilitySection').contains('[role="region"] div', new RegExp(`^${label}:$`)).next().invoke('text').then(text => expect(Number(text), label).to.be.closeTo(Number(value), 0.000001));
          }
          cy.get('@savedUtilitySection').should('contain.text', 'No meters assigned to this utility');
          return cy.wrap(saved, { log: false });
        });
      });
    });
  }
  checkUtilitySettings(tenant, building, utilityName) {
    const data = leaseUtilityData();
    this.addLease(tenant, building, { ...tenantData(), endDate: null }).then(() => {
      this.openUtility(tenant, building, undefined, { reload: false });
      this.selectUtility(building, utilityName).then(choice => {
        this.fill(data, { leaseUtility: true });
        this.saveUtility(tenant, building, choice, data).then(saved => {
          const updated = { ...data, lease_utility_admin_fee: '20.25', lease_utility_addon_fee: '0' };
          this.openUtility(tenant, building, saved, { reload: false });
          this.fill({ lease_utility_admin_fee: '20.25', lease_utility_addon_fee: '0' }, { leaseUtility: true });
          this.saveUtility(tenant, building, saved, updated).then(reloaded => this.openUtility(tenant, building, reloaded, { reload: false }));
        });
      });
    });
  }

  checkUtilityPercentages(tenant, building, utilityName) {
    const zero = leaseUtilityData('0');
    this.openUtility(tenant, building, undefined, { reload: false });
    this.selectUtility(building, utilityName).then(choice => {
      this.fill(zero, { leaseUtility: true });
      this.assertUtilityPrecision(tenant, choice, zero);
      this.saveUtility(tenant, building, choice, zero).then(saved => {
        const decimals = leaseUtilityData('12.34');
        this.openUtility(tenant, building, saved, { reload: false });
        this.fill(decimals, { leaseUtility: true });
        this.saveUtility(tenant, building, saved, decimals);
      });
    });
  }

  checkUtilitySwitch(tenant, building, utilityName) {
    const otherUtility = supportedUtilities.find(name => name !== utilityName);
    const data = leaseUtilityData();
    this.openUtility(tenant, building, undefined, { reload: false });
    this.selectUtility(building, utilityName).then(() => {
      this.selectUtility(building, otherUtility).then(choice => {
        this.saveUtility(tenant, building, choice, data, { cancel: true });
        this.openUtility(tenant, building, undefined, { reload: false });
        this.selectUtility(building, utilityName).then(selected => {
          this.fill(data, { leaseUtility: true });
          this.saveUtility(tenant, building, selected, data).then(saved => {
            this.openUtility(tenant, building, saved, { reload: false });
            this.selectUtility(building, otherUtility).then(() => {
              this.saveUtility(tenant, building, saved, data, { cancel: true });
              this.openUtility(tenant, building, saved, { reload: false });
            });
          });
        });
      });
    });
  }

}
