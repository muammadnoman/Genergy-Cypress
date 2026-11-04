import { AppPage } from './AppPage';

export class PortfolioPage extends AppPage {
  visitNumber = 0;

  visit() {
    const alias = `portfolios${++this.visitNumber}`;
    cy.intercept('GET', /\/portfolios\/?$/).as(alias);
    this.open('/manage');
    return cy.get(`@${alias}.all`, { timeout: Cypress.config('responseTimeout') }).should(calls => {
      const completed = calls.filter(call => call.response);
      expect(completed, `GET /portfolios must complete within ${Cypress.config('responseTimeout')}ms; the application list cannot load without an API response`).not.to.be.empty;
      completed.forEach(call => expect(call.response.statusCode, 'portfolio list status').to.eq(200));
    }).then(calls => {
      const { response } = calls.findLast(call => call.response);
      cy.contains('[role="tab"]', 'Portfolios').should('be.visible');
      return cy.get('tbody', { timeout: Cypress.config('responseTimeout') })
        .should('not.contain.text', 'Loading...').then(() => response);
    });
  }

  openCreate(data) {
    if (data) cy.task('fixtures:reserve', { kind: 'portfolio', ...data }, { log: false });
    cy.intercept('GET', '**/associated/billing_template_details').as('billingTemplates');
    this.visit();
    cy.contains('button', /^Add$/).click();
    cy.contains('[data-sidebar="content"] button', /^Portfolio$/).click();
    cy.get('[role="dialog"]').should('contain.text', 'Add Portfolio');
  }

  fill(data) {
    this.field('Portfolio Name').clear().type(data.name);
    this.field('Portfolio Number').clear().type(data.number);
    return cy.wait('@billingTemplates').then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      const template = response.body[0];
      this.select('Billing Template', template.billing_template);
    });
  }

  saveCreate(data) {
    cy.intercept('POST', '**/portfolios/create').as('createPortfolio');
    cy.intercept('POST', '**/employee-feed/create').as('portfolioFeed');
    cy.contains('[role="dialog"] button', /^Save$/).click();
    return cy.wait('@createPortfolio').then(({ request, response }) => {
      expect(response.statusCode).to.be.oneOf([200, 201]);
      expect(request.body.name).to.eq(data.name);
      expect(request.body.portfolio_number).to.eq(data.number);
      cy.verifyToast(response.body.message);
      cy.location('pathname').should('match', /^\/portfolio\/\d+$/);
      cy.wait('@portfolioFeed').its('response.statusCode').should('be.oneOf', [200, 201]);
      return cy.task('db:portfolio', data.number, { log: false }).then(rows => {
        expect(rows).to.have.length(1);
        expect(rows[0].name).to.eq(data.name);
        expect(rows[0].portfolio_number).to.eq(data.number);
        expect(Number(rows[0].billing_template_id)).to.eq(Number(request.body.billing_template_id));
        expect(Number(response.body.portfolioId)).to.eq(rows[0].id);
        return rows[0];
      });
    });
  }

  search(number) {
    cy.get('input[placeholder="Search..."]').filter(':visible').clear().type(number);
    cy.get('tbody tr', { timeout: Cypress.config('responseTimeout') }).should(rows => {
      expect(rows).to.have.length(1);
      expect(rows.text()).to.contain(number);
      expect(rows.text()).not.to.contain('Loading...');
    });
  }

  assertRowMatchesApi(data) {
    this.visit().then(response => {
      const item = response.body.map(x => x.portfolio_json).find(x => x.portfolio_number === data.number);
      expect(item, 'created portfolio in API').to.exist;
      this.search(data.number);
      cy.contains('tbody tr', data.number).should('contain.text', item.portfolio_name);
      cy.contains('tbody tr', data.number).should('contain.text', String(item.total_buildings));
    });
  }

  openEdit(number) {
    this.visit();
    this.search(number);
    cy.contains('tbody tr', number).find('[role="checkbox"]').click();
    cy.contains('button', 'Edit Selected').click();
    cy.get('[role="dialog"]').should('contain.text', 'Edit Portfolio');
  }

  edit(data, newName, { logo } = {}) {
    this.openEdit(data.number);
    this.field('Portfolio Name').clear().type(newName);
    if (logo) cy.get('[role="dialog"] input[type="file"]').selectFile(logo, { force: true });
    cy.intercept('PUT', '**/portfolios/update/*').as('updatePortfolio');
    cy.intercept('POST', '**/employee-feed/create').as('portfolioFeed');
    cy.contains('[role="dialog"] button', /^Update$/).click();
    cy.wait('@updatePortfolio').its('response.statusCode').should('eq', 200);
    // Match the current application text, including its spelling.
    cy.verifyToast('Portfolo updated successfully');
    cy.wait('@portfolioFeed').its('response.statusCode').should('be.oneOf', [200, 201]);
    cy.get('[role="dialog"]').should('not.exist');
    this.assertRowMatchesApi({ ...data, name: newName });
    return cy.task('db:portfolio', data.number, { log: false }).then(rows => {
      expect(rows).to.have.length(1);
      expect(rows[0].name).to.eq(newName);
      if (logo) {
        expect(rows[0].logo_url).to.be.a('string').and.not.be.empty;
        this.openEdit(data.number);
        cy.get('[role="dialog"]').should('contain.text', rows[0].logo_url);
        this.closeDialog();
      }
    });
  }

  openDelete(number, { cancel = false } = {}) {
    this.visit();
    this.search(number);
    cy.contains('tbody tr', number).find('[role="checkbox"]').click();
    cy.contains('button', 'Delete Selected').click();
    cy.get('[role="dialog"]').should('contain.text', 'Delete Confirmation');
    if (cancel) {
      this.closeDialog();
      this.assertRowMatchesApi({ number });
      cy.task('db:portfolio', number, { log: false }).then(rows => {
        expect(rows).to.have.length(1);
        expect(Number(rows[0].is_offline)).to.eq(0);
      });
    }
  }

  confirmDelete(number) {
    cy.intercept('PUT', '**/portfolios/delete/*').as('deletePortfolio');
    cy.intercept('POST', '**/employee-feed/create').as('portfolioFeed');
    cy.contains('[role="dialog"] button', /^Confirm$/).click();
    cy.wait('@deletePortfolio').its('response.statusCode').should('eq', 200);
    cy.wait('@portfolioFeed').its('response.statusCode').should('be.oneOf', [200, 201]);
    cy.task('db:portfolio', number, { log: false }).then(rows => {
      expect(rows).to.have.length(1);
      expect(Number(rows[0].is_offline)).to.eq(1);
    });
    this.visit().then(response => {
      const returnedByApi = response.body.some(item => item.portfolio_json.portfolio_number === number);
      cy.get('input[placeholder="Search..."]').filter(':visible').clear().type(number);
      cy.get('tbody').should(table => {
        expect(table.text(), `Soft-deleted portfolio ${number} must disappear from the UI; GET /portfolios ${returnedByApi ? 'still includes' : 'excludes'} this record`).not.to.contain(number);
      });
    });
  }

  assertRequired(data) {
    cy.contains('[role="dialog"] button', /^Save$/).click();
    cy.get('[role="dialog"]').should('contain.text', 'Portfolio name is required.');
    cy.get('[role="dialog"]').should('contain.text', 'Portfolio number is required.');
    cy.get('[role="dialog"]').should('contain.text', 'Please select a billing template');
    this.field('Portfolio Name').type(data.name);
    this.field('Portfolio Number').type(data.number);
    cy.contains('[role="dialog"] button', /^Save$/).click();
    cy.get('[role="dialog"]').should('contain.text', 'Please select a billing template');
    cy.wait('@billingTemplates').then(({ response }) => this.select('Billing Template', response.body[0].billing_template));
    this.field('Portfolio Name').clear();
    cy.contains('[role="dialog"] button', /^Save$/).click();
    cy.get('[role="dialog"]').should('contain.text', 'Portfolio name is required.');
    this.field('Portfolio Name').type(data.name);
    this.field('Portfolio Number').clear();
    cy.contains('[role="dialog"] button', /^Save$/).click();
    cy.get('[role="dialog"]').should('contain.text', 'Portfolio number is required.');
    this.closeDialog();
    cy.task('db:portfolio', data.number, { log: false }).should('have.length', 0);
  }

  assertLengthValidation(data) {
    cy.task('fixtures:reserve', { kind: 'portfolio', ...data }, { log: false });
    cy.task('fixtures:reserve', { kind: 'portfolio', ...data, number: `${data.number}x` }, { log: false });
    this.openCreate();
    this.fill(data);
    this.field('Portfolio Name').clear().type(`${data.name}${'x'.repeat(101 - data.name.length)}`);
    cy.contains('[role="dialog"] button', /^Save$/).click();
    cy.get('[role="dialog"]').should('contain.text', 'Portfolio name cannot exceed 100 characters.');
    this.field('Portfolio Name').clear().type(data.name);
    this.field('Portfolio Number').clear().type(`${data.number}${'x'.repeat(51 - data.number.length)}`);
    cy.contains('[role="dialog"] button', /^Save$/).click();
    cy.get('[role="dialog"]').should('contain.text', 'Portfolio number cannot exceed 50 characters.');
    this.closeDialog();
    for (const number of [data.number, `${data.number}x`]) cy.task('db:portfolio', number, { log: false }).should('have.length', 0);
  }

  assertInvalidLogo(data) {
    let originalLogo;
    cy.task('db:portfolio', data.number, { log: false }).then(rows => {
      expect(rows).to.have.length(1);
      originalLogo = rows[0].logo_url;
    });
    this.openEdit(data.number);
    for (const file of [
      { contents: Cypress.Buffer.from('QA invalid logo'), fileName: 'Auto_invalid.txt', mimeType: 'text/plain', error: 'Only .png, .jpg, .jpeg, and .svg files are allowed.' },
      { contents: Cypress.Buffer.alloc(5 * 1024 * 1024 + 1), fileName: 'Auto_oversized.png', mimeType: 'image/png', error: 'Logo must be less than 5MB.' },
    ]) {
      cy.get('[role="dialog"] input[type="file"]').selectFile({ contents: file.contents, fileName: file.fileName, mimeType: file.mimeType }, { force: true });
      cy.contains('[role="dialog"] button', /^Update$/).click();
      cy.get('[role="dialog"]').should('contain.text', file.error);
    }
    this.closeDialog();
    cy.task('db:portfolio', data.number, { log: false }).then(rows => {
      expect(rows).to.have.length(1);
      expect(rows[0].name).to.eq(data.name);
      expect(rows[0].logo_url).to.eq(originalLogo);
    });
  }

  assertExcludedFromBillingSelector(data) {
    cy.intercept('GET', /\/portfolios\/?$/).as('billingSelectorPortfolios');
    this.open('/bill-period-management');
    cy.wait('@billingSelectorPortfolios').its('response.statusCode').should('eq', 200);
    cy.contains('button[role="combobox"]', /Select Portfolio/).as('portfolioSelector').click();
    cy.get('@portfolioSelector').should('have.attr', 'aria-expanded', 'true');
    cy.get('@portfolioSelector').invoke('attr', 'aria-controls').then(id => {
      expect(id, 'Portfolio dropdown list ID').to.be.a('string').and.not.be.empty;
      cy.get(`[id=${JSON.stringify(id)}]`).should('be.visible').as('portfolioOptions');
    });
    cy.get('@portfolioOptions').find('[role="option"]').should(options => {
      const names = [...options].map(option => option.textContent.trim());
      expect(names, `Deleted portfolio ${data.name} must not appear in the billing dropdown`).not.to.include(data.name);
    });
    cy.get('@portfolioOptions').type('{esc}');
  }

  assertMeterCounts(portfolioId) {
    if (portfolioId === undefined) {
      return cy.task('db:query', {
        sql: 'SELECT b.portfolio_id FROM core.building b JOIN core.meter m ON m.building_number = b.building_number JOIN core.utility u ON u.id = m.utility_id JOIN core.portfolio p ON p.id = b.portfolio_id WHERE p.is_offline = 0 AND b.is_offline = 0 AND m.is_offline = 0 AND u.utility IN (?, ?) GROUP BY b.portfolio_id HAVING COUNT(DISTINCT u.utility) = 2 LIMIT 1',
        params: ['Electric', 'Cold Water'],
      }, { log: false }).then(rows => {
        expect(rows, 'read-only portfolio with Electric and Cold Water meters').to.have.length(1);
        this.assertMeterCounts(rows[0].portfolio_id);
      });
    }
    this.visit().then(response => {
      const item = response.body.map(x => x.portfolio_json).find(x => Number(x.portfolio_id) === portfolioId);
      expect(item, 'portfolio count record').to.exist;
      this.search(item.portfolio_number);
      cy.task('db:query', {
        sql: 'SELECT u.utility, COUNT(*) AS total FROM core.meter m JOIN core.building b ON b.building_number = m.building_number JOIN core.utility u ON u.id = m.utility_id WHERE b.portfolio_id = ? AND b.is_offline = 0 AND m.is_offline = 0 GROUP BY u.utility',
        params: [portfolioId],
      }, { log: false }).then(counts => {
        for (const [utility, key, header] of [['Electric', 'electric_meter_count', 'E. Meter'], ['Cold Water', 'cold_water_meter_count', 'Cold W. Meter']]) {
          const expected = Number(counts.find(x => x.utility === utility)?.total || 0);
          expect(Number(item[key]), `${utility} API total`).to.eq(expected);
          cy.contains('thead th', header).invoke('index').then(index => {
            cy.contains('tbody tr', item.portfolio_number).find('td').eq(index).should('have.text', String(expected));
          });
        }
      });
    });
  }

  assertScopedTabs(portfolioId) {
    if (portfolioId === undefined) {
      return cy.task('db:query', {
        sql: 'SELECT p.id FROM core.portfolio p JOIN core.building b ON b.portfolio_id=p.id JOIN core.tenant t ON t.building_number=b.building_number JOIN core.meter m ON m.building_number=b.building_number WHERE p.is_offline=0 AND b.is_offline=0 AND t.is_offline=0 AND m.is_offline=0 LIMIT 1',
      }, { log: false }).then(rows => {
        expect(rows, 'read-only portfolio with children').to.have.length(1);
        this.assertScopedTabs(rows[0].id);
      });
    }
    const suffix = ++this.visitNumber;
    const requests = [];
    for (const [index, endpoint] of ['detail', 'tenants', 'meter'].entries()) {
      cy.intercept('GET', `**/portfolios/${endpoint}/${portfolioId}`).as(`scope${suffix}_${index}`);
    }
    this.open(`/portfolio/${portfolioId}`);
    for (const index of [0, 1, 2]) {
      cy.get(`@scope${suffix}_${index}.all`, { timeout: Cypress.config('responseTimeout') }).should(calls => {
        const completed = calls.filter(call => call.response);
        expect(completed, 'completed portfolio child request').not.to.be.empty;
        for (const { response } of completed) {
          expect(response.statusCode).to.eq(200);
          expect(Number(response.body[0].portfolio_id)).to.eq(portfolioId);
        }
      }).then(calls => { requests[index] = calls.findLast(call => call.response); });
    }
    cy.then(() => {
      const detail = requests[0].response.body[0];
      const buildings = detail.building_list;
      const tenants = requests[1].response.body[0].tenant_list;
      const meters = requests[2].response.body[0].utility_meter_list.flatMap(group => group.meter_list || []);
      const buildingIds = new Set(buildings.map(row => Number(row.building_id)));
      const buildingNumbers = new Set(buildings.map(row => row.building_number));
      for (const tenant of tenants) expect(buildingIds.has(Number(tenant.building_id)), 'tenant belongs to portfolio').to.eq(true);
      for (const meter of meters) {
        // The API type permits an empty utility's null meter placeholder.
        if (meter.meter_id == null) {
          expect(meter.meter_number, 'empty utility meter number').to.be.null;
          expect(meter.building_number, 'empty utility building number').to.be.null;
        } else {
          expect(buildingNumbers.has(meter.building_number), `meter ${meter.meter_id} belongs to portfolio`).to.eq(true);
        }
      }
      cy.get('[aria-current="page"]').should('have.text', detail.portfolio_name);
      for (const [label, rows, numberKey, nameKey, path] of [
        ['Building', buildings, 'building_number', 'building_name', row => `/portfolio/${portfolioId}/building/${row.building_id}`],
        ['Tenants', tenants, 'tenant_number', 'tenant_name', row => `/portfolio/${portfolioId}/building/${row.building_id}/tenant/${row.tenant_id}`],
        ['Meters', meters, 'meter_number', null, row => `/portfolio/${portfolioId}/meter/${row.meter_id}`],
      ]) {
        cy.contains('[role="tab"]', new RegExp(`^${label}\\s*${rows.length}$`)).click();
        if (!rows.length) {
          cy.get('[role="tabpanel"][data-state="active"]').should('contain.text', label === 'Meters' ? 'No meters found.' : 'No results found.');
          continue;
        }
        const first = label === 'Meters' ? rows.find(row => row.meter_id != null) : rows[0];
        if (!first) continue;
        if (label === 'Meters') {
          // The utility title sits beside the arrow button inside the heading.
          cy.contains('[role="tabpanel"][data-state="active"] h3', new RegExp(`^\\s*${Cypress._.escapeRegExp(first.utility)}\\s*$`))
            .parent().as('portfolioTabTable');
          cy.get('@portfolioTabTable').find('h3 button[aria-expanded]').then(button => {
            if (button.attr('aria-expanded') === 'false') cy.wrap(button).click();
          });
        } else {
          cy.get('[role="tabpanel"][data-state="active"]').as('portfolioTabTable');
          cy.get('@portfolioTabTable').find('input[placeholder="Search..."]').filter(':visible').first().clear().type(String(first[numberKey]));
        }
        cy.get('@portfolioTabTable').contains('tbody tr', String(first[numberKey])).should('be.visible');
        if (label === 'Meters') cy.get('@portfolioTabTable').contains('tbody tr', String(first[numberKey])).find('td').eq(1).should('have.text', String(first.meter_id));
        if (nameKey) cy.get('@portfolioTabTable').contains('tbody tr', String(first[numberKey])).should('contain.text', first[nameKey]);
        cy.get('@portfolioTabTable').contains('tbody tr', String(first[numberKey])).click();
        cy.location('pathname').should('eq', path(first));
        this.open(`/portfolio/${portfolioId}`);
        cy.get('[aria-current="page"]').should('have.text', detail.portfolio_name);
      }
      cy.contains('button', /^Add Building$/).should('be.visible');
    });
  }
}
