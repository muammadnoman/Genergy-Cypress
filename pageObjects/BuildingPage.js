import { AppPage } from './AppPage';

export class BuildingPage extends AppPage {
  checkRouteContext(building, portfolio) {
    for (const [index, path] of [`/building/${building.id}`, `/portfolio/${portfolio.id}/building/${building.id}`].entries()) {
      const alias = `buildingRoute${building.id}_${index}`;
      cy.intercept('GET', `**/buildings/detail/${building.id}`).as(alias);
      this.open(path);
      cy.wait(`@${alias}`).then(({ response }) => {
        expect(response.statusCode).to.eq(200);
        expect(response.body[0]).to.include({ building_name: building.name, building_number: building.building_number });
        expect(Number(response.body[0].building_id)).to.eq(building.id);
      });
      cy.location('pathname').should('eq', path);
      cy.get('[aria-current="page"]').should('have.text', building.name);
      cy.contains('button', /^\s*Tenant\s*$/).click();
      cy.get('[role="dialog"]').should('contain.text', 'Add New Tenant');
      this.closeDialog();
      cy.contains('button', /^\s*Meter\s*$/).click();
      cy.location('pathname').should('eq', `${path}/meter/add`);
      cy.get('[aria-current="page"]').should('have.text', 'Add Meter');
      cy.get(`a[href="${path}"]`).contains(new RegExp(`^${Cypress._.escapeRegExp(building.name)}$`)).click();
      cy.location('pathname').should('eq', path);
      cy.get('[aria-current="page"]').should('have.text', building.name);
    }
    this.open(`/portfolio/${portfolio.id}/building/${building.id}`);
    cy.get(`a[href="/portfolio/${portfolio.id}"]`).should('contain.text', portfolio.name).click();
    cy.location('pathname').should('eq', `/portfolio/${portfolio.id}`);
    cy.get('[aria-current="page"]').should('have.text', portfolio.name);
    cy.task('db:building', building.building_number, { log: false }).then(rows => {
      expect(rows).to.have.length(1);
      expect(rows[0].portfolio_id).to.eq(portfolio.id);
      expect(rows[0].name).to.eq(building.name);
    });
    cy.task('db:query', { sql: 'SELECT meter_id FROM core.meter WHERE building_number=?', params: [building.building_number] }, { log: false }).should('have.length', 0);
  }

  assertEmptyTabs(building, portfolioId) {
    const alias = `emptyBuilding_${building.id}`;
    cy.intercept('GET', `**/buildings/detail/${building.id}`).as(alias);
    cy.intercept('GET', `**/meters/list/${building.building_number}`).as(`${alias}_meters`);
    this.open(`/portfolio/${portfolioId}/building/${building.id}`);
    cy.wait(`@${alias}`).then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      const detail = response.body[0];
      expect(Number(detail.building_id)).to.eq(building.id);
      expect(detail.building_number).to.eq(building.building_number);
      expect(detail.tenant_list).to.deep.eq([]);
      cy.get('[aria-current="page"]').should('have.text', detail.building_name);
      cy.contains('[role="tab"]', /^Tenants\s*0$/).click();
      cy.get('[role="tabpanel"][data-state="active"]').should('contain.text', 'No results found.');
    });
    cy.task('db:query', { sql: 'SELECT meter_id FROM core.meter WHERE building_number=?', params: [building.building_number] }, { log: false }).should('have.length', 0);
    cy.wait(`@${alias}_meters`).then(({ response }) => {
      expect(response.statusCode, 'empty building meters').to.be.oneOf([200, 404]);
      if (response.statusCode === 200) {
        expect(response.body).to.be.an('array');
        const meters = response.body.flatMap(group => group.utility_meter_json).flatMap(group => group.meter_list);
        expect(meters).to.have.length(0);
      } else expect(response.body.message, 'empty meter response message').to.be.a('string').and.not.be.empty;
    });
    cy.contains('[role="tab"]', /^All Meters\s*0$/).click();
    cy.get('[role="tabpanel"][data-state="active"]').should('contain.text', 'No meters found.');
    cy.contains('[role="tab"]', /^Bill Period$/).click();
    const panel = '[role="tabpanel"][data-state="active"]';
    for (const column of ['Bill Year', 'Bill Period', 'Start Date', 'End Date']) cy.contains(`${panel} th`, column).should('be.visible');
    cy.get(panel).should('contain.text', 'No results found.');
    cy.contains(`${panel} button`, /Edit Trip Code/).should('be.disabled');
    // Validate shortcut context without creating unsupported Tenant/Meter dependencies.
    cy.contains('button', /^\s*Tenant\s*$/).click();
    cy.get('[role="dialog"]').should('contain.text', 'Add New Tenant');
    this.closeDialog();
    cy.contains('button', /^\s*Note\s*$/).click();
    cy.get('[role="dialog"]').should('contain.text', 'Add New Note');
    this.closeDialog();
    cy.contains('button', /^\s*Meter\s*$/).click();
    cy.location('pathname').should('eq', `/portfolio/${portfolioId}/building/${building.id}/meter/add`);
    cy.get('[aria-current="page"]').should('have.text', 'Add Meter');
    cy.task('db:query', { sql: 'SELECT id FROM core.tenant WHERE building_number=?', params: [building.building_number] }, { log: false }).should('have.length', 0);
    cy.task('db:query', { sql: 'SELECT meter_id FROM core.meter WHERE building_number=?', params: [building.building_number] }, { log: false }).should('have.length', 0);
  }

  create(data, portfolioId) {
    cy.task('fixtures:reserve', { kind: 'building', ...data }, { log: false });
    this.openCreate(portfolioId);
    this.fill(data);
    return this.save(data, portfolioId);
  }

  openCreate(portfolioId) {
    cy.intercept('GET', '**/associated/region_details').as('regions');
    cy.intercept('GET', '**/associated/property_type_details').as('propertyTypes');
    this.open(`/portfolio/${portfolioId}`);
    cy.contains('button', /Add Building/).click();
    cy.get('[role="dialog"]').should('contain.text', 'Add New Building');
  }

  fill(data, { omit = [] } = {}) {
    for (const [label, value] of Object.entries({
      'Building Number': data.number,
      'Building Name': data.name,
      Street: data.street,
      City: data.city,
      State: data.state,
      'ZIP Code': data.zip,
      'Management Company': data.company,
      'Admin Fee': data.adminFee,
      'Add-on Fee': data.addOnFee,
    })) if (!omit.includes(label)) this.field(label).clear().type(value);
    for (const [label, alias, key] of [['Region', 'regions', 'region'], ['Property Type', 'propertyTypes', 'property_type']]) {
      if (omit.includes(label)) continue;
      cy.get(`@${alias}.all`, { timeout: Cypress.config('responseTimeout') }).should(calls => {
        const completed = calls.filter(call => call.response);
        expect(completed, `completed ${label} lookup`).not.to.be.empty;
        completed.forEach(call => expect(call.response.statusCode, `${label} lookup status`).to.eq(200));
      }).then(calls => {
        const { response } = calls.findLast(call => call.response);
        expect(response.body, `${label} options`).to.be.an('array').and.not.be.empty;
        const option = data[key] ? response.body.find(item => item[key] === data[key]) : response.body[0];
        expect(option, `requested ${label} is available`).to.exist;
        this.select(label, option[key]);
      });
    }
  }

  save(data, portfolioId) {
    cy.intercept('POST', '**/buildings/create').as('createBuilding');
    cy.intercept('POST', '**/employee-feed/create').as('buildingFeed');
    cy.contains('[role="dialog"] button', /^Save$/).click();
    return cy.wait('@createBuilding').then(({ request, response }) => {
      expect(response.statusCode).to.be.oneOf([200, 201]);
      expect(Number(request.body.portfolio_id)).to.eq(portfolioId);
      expect(request.body.building_number).to.eq(data.number);
      cy.verifyToast('Building created successfully');
      cy.location('pathname').should('match', /^\/building\/\d+$/);
      cy.wait('@buildingFeed').its('response.statusCode').should('be.oneOf', [200, 201]);
      return cy.task('db:building', data.number, { log: false }).then(rows => {
        expect(rows).to.have.length(1);
        expect(rows[0].portfolio_id).to.eq(portfolioId);
        for (const [column, expected] of Object.entries({ name: data.name, building_number: data.number, street: data.street, city: data.city, state: data.state, zip: data.zip, management_company: data.company })) expect(rows[0][column], column).to.eq(expected);
        expect(Number(rows[0].region_id)).to.eq(Number(request.body.region_id));
        expect(String(rows[0].property_type_id)).to.eq(String(request.body.property_type_id));
        expect(Number(rows[0].building_admin_fee)).to.eq(Number(data.adminFee));
        expect(Number(rows[0].building_add_on_fee)).to.eq(Number(data.addOnFee));
        return rows[0];
      });
    });
  }

  assertRequired(data, portfolioId) {
    cy.task('fixtures:reserve', { kind: 'building', ...data }, { log: false });
    this.openCreate(portfolioId);
    cy.contains('[role="dialog"] button', /^Save$/).click();
    for (const message of ['Building number is required', 'Building name is required', 'Street address is required', 'City name is required', 'Management company is required', 'Please select a region', 'Please select a property type']) {
      cy.get('[role="dialog"]').should('contain.text', message);
    }
    this.closeDialog();
    for (const [label, message] of [
      ['Building Number', 'Building number is required'], ['Building Name', 'Building name is required'], ['Street', 'Street address is required'], ['City', 'City name is required'],
      ['State', 'Please select a state'], ['ZIP Code', 'Please enter a valid ZIP code'], ['Management Company', 'Management company is required'], ['Region', 'Please select a region'], ['Property Type', 'Please select a property type'],
    ]) {
      this.openCreate(portfolioId);
      this.fill(data, { omit: [label] });
      cy.contains('[role="dialog"] button', /^Save$/).click();
      cy.get('[role="dialog"]').should('contain.text', message);
      this.closeDialog();
    }
    cy.task('db:building', data.number, { log: false }).should('have.length', 0);
  }

  assertInvalidValues(data, portfolioId, fields) {
    cy.task('fixtures:reserve', { kind: 'building', ...data }, { log: false });
    this.openCreate(portfolioId);
    this.fill(data);
    for (const [label, values] of Object.entries(fields)) {
      for (const [value, message] of values) {
        this.field(label).clear().type(value);
        cy.contains('[role="dialog"] button', /^Save$/).click();
        cy.get('[role="dialog"]').should('contain.text', message);
      }
      const original = label === 'ZIP Code' ? data.zip : label === 'Admin Fee' ? data.adminFee : data.addOnFee;
      this.field(label).clear().type(original);
    }
    this.closeDialog();
    cy.task('db:building', data.number, { log: false }).should('have.length', 0);
  }

  edit(data, portfolioId, buildingId) {
    this.open(`/portfolio/${portfolioId}`);
    cy.get('input[placeholder="Search..."]').filter(':visible').clear().type(data.number);
    cy.contains('tbody tr', data.number).find('[role="checkbox"]').click();
    cy.contains('button', 'Edit Selected').click();
    this.field('Building Number').should('be.disabled').and('have.value', data.number);
    cy.contains('[role="dialog"] label', /^Portfolio$/).parent()
      .find('button[role="combobox"]').should('be.disabled');
    for (const [label, value] of Object.entries({ Street: data.street, City: data.city, State: data.state, 'ZIP Code': data.zip, 'Admin Fee': data.adminFee, 'Add-on Fee': data.addOnFee })) this.field(label).clear().type(value);
    cy.intercept('PUT', `**/buildings/update/${buildingId}`).as('updateBuilding');
    cy.intercept('POST', '**/employee-feed/create').as('updatedBuildingFeed');
    cy.contains('[role="dialog"] button', /^Update$/).click();
    cy.wait('@updateBuilding').its('response.statusCode').should('eq', 200);
    cy.verifyToast('Building updated successfully');
    cy.wait('@updatedBuildingFeed').its('response.statusCode').should('be.oneOf', [200, 201]);
    cy.get('[role="dialog"]').should('not.exist');
    cy.task('db:building', data.number, { log: false }).then(rows => {
      expect(rows).to.have.length(1);
      expect(rows[0].id).to.eq(buildingId);
      expect(rows[0].portfolio_id).to.eq(portfolioId);
      for (const key of ['street', 'city', 'state', 'zip']) expect(rows[0][key], key).to.eq(data[key]);
      expect(Number(rows[0].building_admin_fee)).to.eq(Number(data.adminFee));
      expect(Number(rows[0].building_add_on_fee)).to.eq(Number(data.addOnFee));
    });
    for (const [index, route] of [`/building/${buildingId}`, `/portfolio/${portfolioId}/building/${buildingId}`].entries()) {
      const alias = `editedBuildingDetail_${buildingId}_${index}`;
      cy.intercept('GET', `**/buildings/detail/${buildingId}`).as(alias);
      this.open(route);
      cy.get(`@${alias}.all`, { timeout: Cypress.config('responseTimeout') }).should(calls => {
        const completed = calls.filter(call => call.response);
        expect(completed, 'completed edited building response').not.to.be.empty;
        completed.forEach(call => expect(call.response.statusCode).to.eq(200));
        const row = completed.at(-1).response.body[0];
        expect(Number(row.building_id)).to.eq(buildingId);
        expect(row.building_name).to.eq(data.name);
      });
      cy.get('[aria-current="page"]').should('have.text', data.name);
    }
  }

  deleteBuilding(number, portfolioId) {
    const beforeAlias = `deleteBuildingPortfolio_${number}`;
    const afterAlias = `deletedBuildingPortfolio_${number}`;
    cy.intercept('GET', `**/portfolios/detail/${portfolioId}`).as(beforeAlias);
    this.open(`/portfolio/${portfolioId}`);
    cy.get(`@${beforeAlias}.all`, { timeout: Cypress.config('responseTimeout') }).should(calls => {
      const completed = calls.filter(call => call.response);
      expect(completed, 'completed portfolio response before deletion').not.to.be.empty;
      completed.forEach(call => expect(call.response.statusCode).to.eq(200));
      const parent = completed.at(-1).response.body[0];
      expect(Number(parent.portfolio_id)).to.eq(portfolioId);
      expect(parent.building_list.some(row => row.building_number === number), 'building in parent API before deletion').to.eq(true);
    });
    cy.get('input[placeholder="Search..."]').filter(':visible').clear().type(number);
    cy.contains('tbody tr', number).find('[role="checkbox"]').click();
    cy.contains('button', 'Delete Selected').click();
    cy.get('[role="dialog"]').should('contain.text', 'Delete Building');
    cy.intercept('PUT', '**/buildings/delete/*').as('deleteBuilding');
    cy.intercept('POST', '**/employee-feed/create').as('deletedBuildingFeed');
    cy.contains('[role="dialog"] button', /^Confirm$/).click();
    cy.wait('@deleteBuilding').its('response.statusCode').should('eq', 200);
    cy.wait('@deletedBuildingFeed').its('response.statusCode').should('be.oneOf', [200, 201]);
    cy.task('db:building', number, { log: false }).then(rows => {
      expect(rows).to.have.length(1);
      expect(Number(rows[0].is_offline)).to.eq(1);
    });
    cy.intercept('GET', `**/portfolios/detail/${portfolioId}`).as(afterAlias);
    this.open(`/portfolio/${portfolioId}`);
    cy.get(`@${afterAlias}.all`, { timeout: Cypress.config('responseTimeout') }).should(calls => {
      const completed = calls.filter(call => call.response);
      expect(completed, 'completed portfolio response after deletion').not.to.be.empty;
      completed.forEach(call => expect(call.response.statusCode).to.eq(200));
      const parent = completed.at(-1).response.body[0];
      expect(Number(parent.portfolio_id)).to.eq(portfolioId);
      expect(parent.building_list.some(row => row.building_number === number), 'building excluded from parent API after deletion').to.eq(false);
    });
    cy.get('input[placeholder="Search..."]').filter(':visible').clear().type(number);
    cy.contains('tbody tr', number).should('not.exist');
  }

  assertDetailMatchesApi(buildingId, portfolioId, { expectZeroBilling = false } = {}) {
    cy.intercept('GET', `**/buildings/detail/${buildingId}`).as('buildingDetail');
    this.open(`/building/${buildingId}`);
    cy.wait('@buildingDetail').then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      const row = response.body[0];
      expect(String(row.building_id)).to.eq(String(buildingId));
      cy.get('[aria-current="page"]').should('be.visible').and('have.text', row.building_name);
      cy.contains('[role="tab"]', /^Tenants\s*\d*$/).should('be.visible');
      cy.intercept('GET', `**/portfolios/detail/${portfolioId}`).as('parentPortfolio');
      this.open(`/portfolio/${portfolioId}`);
      cy.wait('@parentPortfolio').then(({ response: parent }) => {
        expect(parent.statusCode).to.eq(200);
        const listed = parent.body[0].building_list.find(item => String(item.building_id) === String(buildingId));
        expect(listed, 'created building in parent API').to.exist;
        expect(listed.building_number).to.eq(row.building_number);
        expect(listed.building_name).to.eq(row.building_name);
        cy.get('input[placeholder="Search..."]').filter(':visible').clear().type(String(row.building_number));
        cy.contains('tbody tr', String(row.building_number)).should('be.visible').and('contain.text', row.building_name);
        if (expectZeroBilling) {
          expect(Number(listed.billed_to_date || 0)).to.eq(0);
          cy.contains('tbody tr', String(row.building_number)).find('td').last().should('have.text', '$0.00').and('not.contain.text', 'NaN');
        }
      });
    });
  }
}
