import { AppPage } from './AppPage';
import { recordData } from '../cypress/data/qaData';

export class MeterPage extends AppPage {
  visitNumber = 0;

  // Meter form labels sit beside their SelectField rather than using htmlFor.
  field(label, scope = 'form') {
    return cy.contains(`${scope} label`, new RegExp(`^${Cypress._.escapeRegExp(label)}$`))
      .parent().find('button[role="combobox"]');
  }

  openCreate(building, { data, duplicateOf } = {}) {
    const alias = `meterForm${++this.visitNumber}`;
    this.writeAlias = `${alias}Write`;
    cy.intercept('GET', '**/associated/utility_id_names').as(`${alias}Utilities`);
    cy.intercept('POST', '**/meters/create', request => {
      if (!data || request.body.meter_number !== data.number || request.body.location !== data.name || request.body.building_number !== building.building_number || Number(request.body.is_virtual) !== 0) {
        request.reply({ statusCode: 400, body: { message: 'QA blocked unexpected or incorrectly owned Meter creation' } });
      } else request.continue();
    }).as(this.writeAlias);
    if (duplicateOf) {
      this.openMeter(duplicateOf, building);
      cy.get('button[aria-label="Duplicate Meter"]').click();
      cy.location('pathname').should('eq', `/building/${building.id}/meter/${duplicateOf.meter_id}/duplicate`);
      cy.contains('h1', /^Duplicate Meter Details$/).should('be.visible');
      cy.get('form input[name="meter_number"]').should('have.value', '');
      cy.get('form input[name="location"]').should('have.value', duplicateOf.location);
      this.field('Utility Type').should('contain.text', duplicateOf.utilityName);
      for (const key of ['reading_interval', 'consumption_multiplier', 'demand_multiplier', 'meter_setup_fee', 'meter_addon_fee']) cy.get(`form input[name="${key}"]`).should(input => expect(Number(input.val()), `copied ${key}`).to.eq(Number(duplicateOf[key])));
      for (const [label, key] of [['Start Date', 'meter_start_date'], ['End Date', 'meter_end_date']]) cy.contains('form label', label).parent().find('button[aria-haspopup="dialog"]').should('contain.text', duplicateOf[key]);
    } else {
      this.open(`/building/${building.id}`);
      cy.get('[aria-current="page"]').should('have.text', building.name);
      cy.contains('button', /^\s*Meter\s*$/).click();
      cy.location('pathname').should('eq', `/building/${building.id}/meter/add`);
      cy.contains('h1', /^Create New Meter$/).should('be.visible');
    }
    return cy.wait(`@${alias}Utilities`).then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      expect(response.body).to.be.an('array').and.not.be.empty;
      this.utilities = response.body;
    });
  }

  fill(data, utilityName, { omitType = false } = {}) {
    cy.get('form input[name="meter_number"]').clear().type(data.number);
    cy.get('form input[name="location"]').clear().type(data.name);
    return cy.then(() => {
      const utility = this.utilities.find(item => item.utility === utilityName);
      expect(utility, `supported ${utilityName} reference`).to.exist;
      const alias = `meterTypes${++this.visitNumber}`;
      cy.intercept('GET', `**/associated/meter_types_id/${utility.utility_id}`).as(alias);
      this.select('Utility Type', utilityName, 'form');
      return cy.wait(`@${alias}`).then(({ response }) => {
        expect(response.statusCode).to.eq(200);
        expect(response.body, `compatible ${utilityName} meter types`).to.be.an('array').and.not.be.empty;
        const type = response.body[0];
        expect(type.type_id).not.to.be.oneOf([null, undefined]);
        expect(type.meter_type).to.be.a('string').and.not.be.empty;
        if (!omitType) this.select('Meter Type', type.meter_type, 'form');
        return cy.wrap(type.meter_type, { log: false });
      });
    });
  }

  checkRequiredFields(building, utilityName) {
    const data = recordData('Meter');
    this.openCreate(building);
    this.field('Meter Type').should('be.disabled');
    cy.contains('form button', /^Create Meter$/).click();
    for (const error of ['Meter number is required', 'Please select a meter type', 'Please select a utility type', 'Location is required']) cy.get('form').should('contain.text', error);
    this.fill(data, utilityName, { omitType: true }).then(type => {
      cy.contains('form button', /^Create Meter$/).click();
      cy.get('form').should('contain.text', 'Please select a meter type').and('not.contain.text', 'Please select a utility type');
      this.select('Meter Type', type, 'form');
      for (const [name, value, error] of [['meter_number', data.number, 'Meter number is required'], ['location', data.name, 'Location is required']]) {
        cy.get(`form input[name="${name}"]`).clear();
        cy.contains('form button', /^Create Meter$/).click();
        cy.get('form').should('contain.text', error);
        cy.get('[role="dialog"]').should('not.exist');
        cy.get(`form input[name="${name}"]`).type(value);
      }
    });
    this.cancelAndVerifyEmpty(building);
  }

  checkDateRange(building, utilityName) {
    this.openCreate(building);
    this.fill(recordData('Meter'), utilityName);
    cy.contains('form label', /^Start Date$/).parent().find('button[aria-haspopup="dialog"]').invoke('text').then(text => {
      const start = text.trim();
      expect(start).to.match(/^\d{4}-\d{2}-\d{2}$/);
      const previous = new Date(`${start}T12:00:00`);
      previous.setDate(previous.getDate() - 1);
      const earlier = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}-${String(previous.getDate()).padStart(2, '0')}`;
      for (const end of [start, earlier]) {
        this.setDate('End Date', end, 'form');
        cy.contains('form label', /^End Date$/).parent().should('contain.text', end);
        cy.contains('form button', /^Create Meter$/).click();
        cy.get('form').should('contain.text', 'Meter end date must be after start date');
        cy.get('[role="dialog"]').should('not.exist');
      }
    });
    this.cancelAndVerifyEmpty(building);
  }

  checkCreateCancellation(building, utilityName) {
    const data = recordData('Meter');
    this.openCreate(building);
    this.fill(data, utilityName);
    cy.get('form input[name="consumption_multiplier"]').clear().type('1.25');
    cy.get('form input[name="demand_multiplier"]').clear().type('2.50');
    cy.contains('form button', /^Create Meter$/).click();
    cy.get('[role="dialog"]').should('contain.text', 'Are you sure you want to create this meter?');
    cy.contains('[role="dialog"] button', /^Close$/).click();
    cy.get('[role="dialog"]').should('not.exist');
    cy.get('form input[name="meter_number"]').should('have.value', data.number);
    cy.get('form input[name="location"]').should('have.value', data.name);
    this.field('Utility Type').should('contain.text', utilityName);
    cy.get('form input[name="consumption_multiplier"]').should('have.value', '1.25');
    cy.get('form input[name="demand_multiplier"]').should(input => expect(Number(input.val())).to.eq(2.5));
    this.cancelAndVerifyEmpty(building);
  }

  cancelAndVerifyEmpty(building) {
    cy.get(`@${this.writeAlias}.all`).should('have.length', 0);
    cy.contains('form button', /^Cancel$/).click();
    cy.location('pathname').should('eq', `/building/${building.id}`);
    cy.get('[aria-current="page"]').should('have.text', building.name);
    cy.task('db:query', { sql: 'SELECT meter_id FROM core.meter WHERE building_number=?', params: [building.building_number] }, { log: false }).should('have.length', 0);
    cy.contains('[role="tab"]', /^All Meters\s*0$/).click();
    cy.get('[role="tabpanel"][data-state="active"]').should('contain.text', 'No meters found.');
  }

  create(building, utilityName, { duplicateOf, cancel = false, ...assignment } = {}) {
    const data = recordData('Meter');
    this.openCreate(building, { data, duplicateOf });
    if (duplicateOf) {
      cy.get('form input[name="meter_number"]').type(data.number);
      cy.get('form input[name="location"]').clear().type(data.name);
    } else {
      this.fill(data, utilityName);
      for (const [name, value] of Object.entries({ reading_interval: '15', consumption_multiplier: '1.25', demand_multiplier: '2.5', meter_setup_fee: '3.25', meter_addon_fee: '1.50' })) cy.get(`form input[name="${name}"]`).clear().type(value);
    }
    const alias = `createdPhysicalMeter${++this.visitNumber}`;
    cy.intercept('POST', '**/employee-feed/create').as(`${alias}Feed`);
    cy.then(() => {
      const utilityId = Number(this.utilities.find(item => item.utility === utilityName).utility_id);
      cy.task('fixtures:reserveMeter', { buildingNumber: building.building_number, number: data.number, marker: data.name, utilityId, ...assignment }, { log: false });
    });
    cy.contains('form button', duplicateOf ? /^Duplicate Meter$/ : /^Create Meter$/).click();
    cy.contains('[role="dialog"]', `Are you sure you want to ${duplicateOf ? 'duplicate' : 'create'} this meter?`).contains('button', cancel ? /^Close$/ : /^Confirm$/).click();
    if (cancel) {
      cy.get('[role="dialog"]').should('not.exist');
      cy.get(`@${this.writeAlias}.all`).should('have.length', 0);
      cy.get('form input[name="meter_number"]').should('have.value', data.number);
      cy.contains('form button', /^Cancel$/).click();
      cy.task('db:query', { sql: 'SELECT meter_id FROM core.meter WHERE meter_number=?', params: [data.number] }, { log: false }).should('have.length', 0);
      return this.openMeter(duplicateOf, building);
    }
    return cy.wait(`@${this.writeAlias}`).then(({ request, response }) => {
      expect(response.statusCode).to.be.oneOf([200, 201]);
      expect(request.body).to.include({ meter_number: data.number, location: data.name, building_number: building.building_number });
      expect(request.body.reading_type || '', 'optional reading type submitted empty').to.eq('');
      expect(request.body.lease_utility_id).to.eq(null);
      expect(Number(request.body.is_virtual)).to.eq(0);
      const id = Number(response.body.meterId);
      expect(id).to.be.a('number').and.be.greaterThan(0);
      if (duplicateOf) {
        expect(id, 'duplicate has its own ID').not.to.eq(duplicateOf.meter_id);
        for (const key of ['utility_id', 'meter_type_id', 'reading_interval', 'consumption_multiplier', 'demand_multiplier', 'meter_setup_fee', 'meter_addon_fee']) expect(Number(request.body[key]), `duplicate payload ${key}`).to.eq(Number(duplicateOf[key]));
        for (const key of ['meter_start_date', 'meter_end_date']) expect(request.body[key].slice(0, 10), `duplicate ${key}`).to.eq(duplicateOf[key]);
      }
      cy.verifyToast(response.body.message);
      cy.location('pathname').should('eq', `/building/${building.id}/meter/${id}`);
      cy.wait(`@${alias}Feed`).then(({ request: feed, response: result }) => {
        expect(result.statusCode).to.be.oneOf([200, 201]);
        expect(feed.body.entity_type).to.eq('Meter');
        expect(Number(feed.body.entity_id)).to.eq(id);
      });
      return cy.task('db:query', { sql: 'SELECT * FROM core.meter WHERE meter_number=?', params: [data.number] }, { log: false }).then(rows => {
        expect(rows).to.have.length(1);
        const saved = rows[0];
        expect(saved.meter_id).to.eq(id);
        for (const key of ['meter_number', 'building_number', 'location']) expect(saved[key]).to.eq(request.body[key]);
        for (const key of ['utility_id', 'meter_type_id', 'reading_interval', 'consumption_multiplier', 'demand_multiplier', 'meter_setup_fee', 'meter_addon_fee', 'not_billable_flag', 'is_virtual']) expect(Number(saved[key]), `created DB ${key}`).to.eq(Number(request.body[key]));
        for (const key of ['meter_start_date', 'meter_end_date']) expect(saved[key]).to.eq(request.body[key].slice(0, 10));
        expect(saved.source_meter_id).to.eq(null);
        expect(saved.reading_type || '').to.eq('');
        return this.openMeter({ ...saved, utilityName }, building).then(created => {
          if (!duplicateOf) return created;
          return this.openMeter(duplicateOf, building).then(() => cy.wrap(created, { log: false }));
        });
      });
    });
  }

  openMeter(meter, building) {
    const alias = `physicalMeterDetail${++this.visitNumber}`;
    cy.intercept('GET', `**/meters/details/${meter.meter_id}`).as(alias);
    this.open(`/building/${building.id}/meter/${meter.meter_id}`);
    return cy.wait(`@${alias}`).then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      expect(response.body).to.have.length(1);
      expect(Number(response.body[0].meter_id)).to.eq(meter.meter_id);
      const detail = response.body[0].meter_json;
      return cy.task('db:query', { sql: 'SELECT * FROM core.meter WHERE meter_id=?', params: [meter.meter_id] }, { log: false }).then(rows => {
        expect(rows).to.have.length(1);
        const db = rows[0];
        for (const key of ['meter_number', 'building_number', 'location', 'meter_start_date', 'meter_end_date']) {
          expect(db[key], `DB ${key}`).to.eq(meter[key]);
          expect(detail[key], `API ${key}`).to.eq(db[key]);
        }
        for (const key of ['utility_id', 'meter_type_id', 'reading_interval', 'consumption_multiplier', 'demand_multiplier', 'meter_setup_fee', 'meter_addon_fee', 'not_billable_flag', 'is_virtual', 'is_offline']) {
          expect(Number(db[key]), `DB ${key}`).to.eq(Number(meter[key]));
          expect(Number(detail[key]), `API ${key}`).to.eq(Number(db[key]));
        }
        expect(db.reading_type || '').to.eq(meter.reading_type || '');
        expect(detail.reading_type || '').to.eq(db.reading_type || '');
        expect(db.lease_utility_id).to.eq(meter.lease_utility_id);
        cy.get('[aria-current="page"]').should('have.text', meter.meter_number);
        cy.contains('[role="tab"]', /^Meter Details$/).click();
        cy.get('[role="tabpanel"][data-state="active"]').should('contain.text', meter.meter_number).and('contain.text', meter.location).and('contain.text', meter.utilityName);
        cy.get('#online').should('have.attr', 'aria-checked', 'true');
        cy.get('#no-billing').should('have.attr', 'aria-checked', Number(meter.not_billable_flag) ? 'true' : 'false');
        return cy.wrap(meter, { log: false });
      });
    });
  }

  edit(meter, building, changes, { cancel = false } = {}) {
    this.openMeter(meter, building);
    cy.contains('button', /^Update Meters$/).click();
    cy.contains('h1', /^Edit Meter Details$/).should('be.visible');
    for (const key of ['meter_number', 'location', 'reading_interval', 'consumption_multiplier', 'demand_multiplier']) cy.get(`form input[name="${key}"]`).should(input => {
      if (['meter_number', 'location'].includes(key)) expect(String(input.val())).to.eq(String(meter[key]));
      else expect(Number(input.val())).to.eq(Number(meter[key]));
    });
    this.field('Reading Type').should('contain.text', meter.reading_type || 'Select an option');
    if ('not_billable_flag' in changes) {
      cy.contains('form label', /^No Billing$/).invoke('attr', 'for').then(id => {
        cy.get(`[id=${JSON.stringify(id)}]`).should('have.attr', 'aria-checked', Number(meter.not_billable_flag) ? 'true' : 'false').then(checkbox => {
          if ((checkbox.attr('aria-checked') === 'true') !== Boolean(changes.not_billable_flag)) cy.wrap(checkbox).click();
        });
      });
    }
    for (const [key, value] of Object.entries(changes).filter(([key]) => key !== 'not_billable_flag')) cy.get(`form input[name="${key}"]`).clear().type(String(value));
    const alias = `updatedPhysicalMeter${++this.visitNumber}`;
    cy.intercept('PUT', `**/meters/update/${meter.meter_id}`).as(alias);
    cy.contains('form button', /^Update Meter$/).click();
    const confirmation = 'Are you sure you want to update this meter?';
    cy.contains('[role="dialog"]', confirmation).contains('button', cancel ? /^Close$/ : /^Confirm$/).click();
    if (cancel) {
      cy.get('[role="dialog"]').should('not.exist');
      cy.get(`@${alias}.all`).should('have.length', 0);
      cy.contains('form button', /^Cancel$/).click();
    } else {
      cy.wait(`@${alias}`).then(({ request, response }) => {
        expect(response.statusCode).to.eq(200);
        expect(request.body.meter_number).to.eq(meter.meter_number);
        expect(request.body.building_number).to.eq(building.building_number);
        expect(request.body.reading_type || '').to.eq('');
        for (const [key, value] of Object.entries(changes)) expect(Number(request.body[key]), `updated payload ${key}`).to.eq(Number(value));
        cy.verifyToast('Meter updated successfully');
      });
    }
    cy.location('pathname').should('eq', `/building/${building.id}/meter/${meter.meter_id}`);
    return this.openMeter(cancel ? meter : { ...meter, ...changes }, building).then(saved => {
      cy.contains('button', /^Update Meters$/).click();
      cy.contains('h1', /^Edit Meter Details$/).should('be.visible');
      for (const [key, value] of Object.entries(changes)) {
        if (key === 'not_billable_flag') {
          cy.contains('form label', /^No Billing$/).invoke('attr', 'for').then(id => cy.get(`[id=${JSON.stringify(id)}]`).should('have.attr', 'aria-checked', Number(cancel ? meter[key] : value) ? 'true' : 'false'));
        } else cy.get(`form input[name="${key}"]`).should(input => expect(Number(input.val())).to.eq(Number(cancel ? meter[key] : value)));
      }
      this.field('Reading Type').should('contain.text', 'Select an option');
      cy.contains('form button', /^Cancel$/).click();
      return cy.wrap(saved, { log: false });
    });
  }
}
