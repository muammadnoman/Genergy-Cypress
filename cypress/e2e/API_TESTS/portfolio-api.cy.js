import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData } from '../../data/qaData';

const api = new UtilityManagerApiClient();

describe('Portfolio APIs', { tags: ['@api', '@portfolio-api'] }, () => {
  beforeEach(() => api.authenticate());

  it('UM-API-001-POS - Create Portfolio: valid request', () => {
    const data = portfolioData();
    api.createPortfolio(data).then(saved => {
      expect(saved.portfolio_number).to.eq(data.number);
      expect(saved.name).to.eq(data.name);
    });
  });

  it('UM-API-002-POS - Update Portfolio: valid request', () => {
    const data = portfolioData();
    api.createPortfolio(data).then(saved => {
      const name = `${data.name} Updated`.slice(0, 100);
      api.request('PUT', `/portfolios/update/${saved.id}`, {
        name, portfolio_number: data.number, billing_template_id: saved.billing_template_id, updated_by: 'UMQA',
        footer: '<p>QA footer</p>', attributes: JSON.stringify([{ key: 'theme', value: 'dark' }]),
      }, { encoding: 'form' }).its('status').should('eq', 200);
      cy.task('db:portfolio', data.number, { log: false }).then(rows => {
        expect(rows).to.have.length(1);
        expect(rows[0].name).to.eq(name);
        expect(rows[0].id).to.eq(saved.id);
      });
    });
  });

  it('UM-API-003-POS - Delete Portfolio: valid request', () => {
    const data = portfolioData();
    api.createPortfolio(data).then(saved => {
      api.request('PUT', `/portfolios/delete/${saved.id}`).its('status').should('eq', 200);
      cy.task('db:portfolio', data.number, { log: false }).then(rows => {
        expect(rows).to.have.length(1);
        expect(Number(rows[0].is_offline)).to.eq(1);
      });
      api.request('GET', '/portfolios').then(({ body }) => {
        expect(body.map(x => x.portfolio_json.portfolio_id)).not.to.include(saved.id);
      });
    });
  });
});
