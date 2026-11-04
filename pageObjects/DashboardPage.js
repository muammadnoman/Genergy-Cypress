import { AppPage } from './AppPage';

export class DashboardPage extends AppPage {
  searchInput = 'input[placeholder="Search anything here..."]';
  searchNumber = 0;

  visit() {
    this.searchResponses = new Map();
    this.open('/dashboard');
  }

  assertLoaded() {
    this.assertSignedIn();
    cy.contains('h2', /^Dashboard$/).should('be.visible');
    cy.contains('Open Alerts').should('be.visible');
    cy.contains('h3', /^Employee Feed$/).should('be.visible');
    cy.contains('h3', /^Recent Meter Readings$/).should('be.visible');
  }

  assertKpisMatchApi() {
    cy.intercept('GET', '**/dashboard/kpi?*').as('dashboardKpis');
    this.visit();
    this.assertLoaded();
    cy.wait('@dashboardKpis').then(({ request, response }) => {
      expect(response.statusCode).to.eq(200);
      expect(new URL(request.url).searchParams.get('date')).to.match(/^\d{4}-\d{2}-\d{2}$/);
      const values = response.body.data;
      for (const [title, key, description] of [
        ['Open Alerts', 'open_tickets', '{change} Alerts compared to last month'],
        ['This Month Alerts', 'this_month_tickets', '{change} Alerts compared to last month'],
        ['Total Meters Active', 'total_meters_active', 'You fitted {change} meters this year'],
        ['Total Real-time Meters Active', 'total_realtime_meters_active', 'You made {change} Real-time Meters this year'],
      ]) {
        const stat = values[key];
        expect(stat.count, title).to.be.a('number').and.be.at.least(0);
        expect(stat.percentage_change, `${title} percentage`).to.match(/^[+-]?\d+(\.\d+)?%$/);
        const change = stat.count_change ?? stat.count_since_jan_1;
        expect(change, `${title} description value`).not.to.be.oneOf([undefined, null]);
        cy.contains('span', new RegExp(`^${title}$`)).parent().parent().within(() => {
          cy.get('h3').should('have.text', String(stat.count));
          cy.get('h3 + span').should('have.text', stat.percentage_change)
            .and('have.class', stat.percentage_change.startsWith('+') ? 'text-primary' : 'text-secondary');
          cy.get('p').should('have.text', description.replace('{change}', String(change)));
          cy.root().should('not.contain.text', 'NaN').and('not.contain.text', 'Infinity').and('not.contain.text', 'undefined');
        });
      }
    });
  }

  assertSearchResultsMatchApi(body) {
    const items = [];
    for (const [group, titleKey, numberKey, label, parentKey, parentLabel] of [
      ['portfolios', 'portfolio_name', 'portfolio_number', 'Portfolio Number'],
      ['buildings', 'building_name', 'building_number', 'Building Number', 'portfolio_number', 'Portfolio Number'],
      ['tenants', 'tenant_name', 'tenant_number', 'Tenant Number', 'building_number', 'Building Number'],
      ['meters', 'meter_number', 'building_number', 'Building Number'],
    ]) {
      const rows = body.data[group] ?? [];
      expect(rows, group).to.be.an('array');
      for (const row of rows) {
        expect(row[titleKey], `${group} title`).not.to.be.oneOf([undefined, null]);
        expect(row[numberKey], `${group} number`).not.to.be.oneOf([undefined, null]);
        const details = [`${label}: ${row[numberKey]}`];
        if (parentKey && row[parentKey]) details.push(`${parentLabel}: ${row[parentKey]}`);
        items.push({ title: String(row[titleKey]), details: details.join('') });
      }
    }
    expect(items.length, 'API results and total metadata').to.eq(body.metadata.total_results);
    return cy.get(this.searchInput).parent().siblings('.bg-popover').should('be.visible').within(() => {
      cy.get('.cursor-pointer.relative').should('have.length', items.length).should(elements => {
        items.forEach((item, index) => {
          const paragraphs = Cypress.$(elements[index]).find('p');
          expect(paragraphs.first().text(), `result ${index + 1} title`).to.eq(item.title);
          expect(paragraphs.eq(1).text().replace(/\s+/g, ''), `result ${index + 1} number/context`)
            .to.eq(item.details.replace(/\s+/g, ''));
        });
      });
      if (items.length) {
        cy.contains('p', new RegExp(`^${items.length} result found$`)).should('be.visible');
        cy.contains('p', /^No results found$/).should('not.exist');
      } else cy.contains('p', /^No results found$/).should('be.visible');
    });
  }

  assertShortSearch(data) {
    cy.intercept({ method: 'GET', pathname: '/dashboard/search', query: { search: data.number } }).as('validShortSearch');
    this.visit();
    cy.get(this.searchInput).type(data.number, { delay: 0 });
    cy.wait('@validShortSearch').then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      expect(response.body.data.portfolios.some(row => row.portfolio_number === data.number && row.portfolio_name === data.name)).to.eq(true);
      this.assertSearchResultsMatchApi(response.body);
    });
    cy.intercept('GET', '**/dashboard/search?*').as('shortSearch');
    cy.get(this.searchInput).clear().type('a').should('have.value', 'a');
    cy.get(this.searchInput).parent().siblings('.bg-popover').should('not.exist');
    cy.get('@shortSearch.all').should('have.length', 0);
    cy.get(this.searchInput).type('b').should('have.value', 'ab');
    cy.get(this.searchInput).parent().siblings('.bg-popover').should('not.exist');
    cy.get('@shortSearch.all').should('have.length', 0);
    cy.get(this.searchInput).clear().should('have.value', '');
    cy.get(this.searchInput).parent().siblings('.bg-popover').should('not.exist');
    cy.get('@shortSearch.all').should('have.length', 0);
  }

  assertPortfolioSearch(data, portfolioId) {
    const term = data.name.slice(5, 30).toUpperCase();
    cy.intercept({ method: 'GET', pathname: '/dashboard/search', query: { search: term } }).as('portfolioSearch');
    this.visit();
    cy.get(this.searchInput).type(term, { delay: 0 });
    return cy.wait('@portfolioSearch').then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      const match = response.body.data.portfolios.find(row => Number(row.portfolio_id) === portfolioId);
      expect(match, 'partial case-insensitive portfolio match').to.exist;
      expect(match.portfolio_name).to.eq(data.name);
      expect(match.portfolio_number).to.eq(data.number);
      expect(response.body.metadata.search_term.toLowerCase()).to.eq(term.toLowerCase());
      this.assertSearchResultsMatchApi(response.body);
      cy.intercept('GET', `**/portfolios/detail/${match.portfolio_id}`).as('searchedPortfolioDetail');
      cy.get(this.searchInput).parent().siblings('.bg-popover').within(() => {
        cy.contains('p', new RegExp(`^${Cypress._.escapeRegExp(match.portfolio_name)}$`))
          .closest('.cursor-pointer.relative').scrollIntoView().should('be.visible').click();
      });
      cy.location('pathname').should('eq', `/portfolio/${match.portfolio_id}`);
      cy.wait('@searchedPortfolioDetail').then(({ response: detail }) => {
        expect(detail.statusCode).to.eq(200);
        expect(Number(detail.body[0].portfolio_id)).to.eq(Number(match.portfolio_id));
        expect(detail.body[0].portfolio_name).to.eq(match.portfolio_name);
        expect(detail.body[0].portfolio_number).to.eq(match.portfolio_number);
        cy.get('[aria-current="page"]').should('have.text', detail.body[0].portfolio_name);
      });
      cy.get(this.searchInput).should('have.value', '');
      cy.get(this.searchInput).parent().siblings('.bg-popover').should('not.exist');
    });
  }

  search(term, filters = []) {
    const responses = this.searchResponses;
    cy.intercept('GET', '**/dashboard/search?*', request => {
      const query = new URL(request.url).searchParams;
      const key = JSON.stringify([query.get('search'), query.get('filter') || '']);
      request.continue(response => {
        responses.set(key, { statusCode: response.statusCode, body: response.body });
      });
    });
    cy.get(this.searchInput).then(input => {
      if (input.val()) cy.wrap(input).parent().find('svg.cursor-pointer').click();
    });
    cy.get(this.searchInput).type(term, { delay: 0 });
    for (const filter of filters) {
      const label = filter[0].toUpperCase() + filter.slice(1);
      cy.get(this.searchInput).parent().siblings('.bg-popover')
        .contains('div.cursor-pointer', new RegExp(`^\\s*${label}\\s*$`)).click();
    }
    return this.assertSearchState(term, filters);
  }

  assertSearchState(term, filters = []) {
    const key = JSON.stringify([term, filters.join(',')]);
    cy.get(this.searchInput).should('have.value', term);
    for (const filter of ['portfolio', 'building', 'tenant', 'meter']) {
      const label = filter[0].toUpperCase() + filter.slice(1);
      cy.get(this.searchInput).parent().siblings('.bg-popover')
        .contains('div.cursor-pointer', new RegExp(`^\\s*${label}\\s*$`))
        .should(filters.includes(filter) ? 'have.class' : 'not.have.class', 'bg-primary');
    }
    // Returning to a fresh React Query entry renders its captured response without another GET.
    return cy.wrap(null, { log: false }).should(() => {
      expect(this.searchResponses.get(key), 'completed response for this exact search and filter combination').to.exist;
    }).then(() => {
      const response = this.searchResponses.get(key);
      expect(response.statusCode).to.eq(200);
      const body = response.body;
      expect(body.metadata.search_term.toLowerCase()).to.eq(term.toLowerCase());
      const applied = filters.length ? filters : ['portfolio', 'building', 'tenant', 'meter'];
      expect(body.metadata.filters_applied).to.have.members(applied);
      expect(body.metadata.per_entity_limit).to.eq(Math.floor(40 / applied.length));
      for (const [group, rows] of Object.entries(body.data)) {
        expect(rows, group).to.be.an('array').and.have.length.at.most(body.metadata.per_entity_limit);
        if (!applied.includes(group.replace(/s$/, ''))) expect(rows, `excluded ${group}`).to.have.length(0);
      }
      expect(body.metadata.total_results).to.be.at.most(40);
      this.assertSearchResultsMatchApi(body);
      return cy.wrap(body, { log: false });
    });
  }

  checkSearchFilters(term, { deselect = false } = {}) {
    this.visit();
    this.search(term, ['tenant', 'building']).then(body => {
      expect(body.data.buildings, 'owned Building search results').not.to.be.empty;
      expect(body.data.tenants, 'owned Tenant search results').not.to.be.empty;
    });
    const filters = deselect ? ['tenant'] : [];
    cy.get(this.searchInput).parent().siblings('.bg-popover').within(() => {
      if (deselect) cy.contains('div.cursor-pointer', /^\s*Building\s*$/).click();
      else cy.contains('button', /^Clear Filters$/).click();
    });
    this.assertSearchState(term, filters).then(body => {
      if (deselect) {
        expect(body.data.buildings).to.have.length(0);
        expect(body.data.tenants).not.to.be.empty;
      } else expect(body.data.portfolios).not.to.be.empty;
    });
    cy.get(this.searchInput).should('have.value', term);
  }

  checkSearchLimits(term) {
    this.visit();
    for (const filters of [
      ['portfolio', 'building', 'tenant', 'meter'],
      ['portfolio', 'building', 'tenant'],
      ['portfolio', 'building'],
      ['portfolio'],
    ]) this.search(term, filters);
  }

  checkSearchNavigation(building, tenant) {
    const isTenant = Boolean(tenant);
    const target = tenant || building;
    const kind = isTenant ? 'tenant' : 'building';
    const number = isTenant ? tenant.tenant_number : building.building_number;
    const name = isTenant ? tenant.data.name : building.name;
    const path = isTenant ? `/building/${building.id}/tenant/${tenant.id}` : `/building/${building.id}`;
    this.visit();
    this.search(number, [kind]).then(body => {
      const match = body.data[`${kind}s`].find(item => Number(item[`${kind}_id`]) === target.id);
      expect(match, 'exact owned search result').to.exist;
      expect(match[`${kind}_number`]).to.eq(number);
      expect(match[`${kind}_name`]).to.eq(name);
      if (isTenant) {
        expect(Number(match.building_id)).to.eq(building.id);
        expect(match.building_number).to.eq(building.building_number);
      } else expect(match.portfolio_number).to.eq(building.parentNumber);
      const alias = `searchedEntityDetail${++this.searchNumber}`;
      cy.intercept('GET', isTenant ? `**/tenants/details/${target.id}` : `**/buildings/detail/${target.id}`).as(alias);
      cy.get(this.searchInput).parent().siblings('.bg-popover')
        .contains('p', new RegExp(`^${Cypress._.escapeRegExp(name)}$`)).closest('.cursor-pointer.relative').scrollIntoView().click();
      cy.location('pathname').should('eq', path);
      cy.wait(`@${alias}`).then(({ response }) => {
        expect(response.statusCode).to.eq(200);
        const detail = response.body[0];
        expect(Number(detail[`${kind}_id`])).to.eq(target.id);
        expect(detail[`${kind}_number`]).to.eq(number);
        expect(isTenant ? detail.tenant_json.tenant_name : detail.building_name).to.eq(name);
      });
      cy.get('[aria-current="page"]').should('have.text', name);
      cy.get(this.searchInput).should('have.value', '');
      cy.get(this.searchInput).parent().siblings('.bg-popover').should('not.exist');
    });
  }
}
