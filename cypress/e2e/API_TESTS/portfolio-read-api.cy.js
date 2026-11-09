import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData } from '../../data/qaData';

const api = new UtilityManagerApiClient();

describe('Portfolio Read APIs', { tags: ['@api', '@portfolio-api'] }, () => {
  beforeEach(() => api.authenticate());

  it('UM-API-004-POS - List an active portfolio with its saved identity and zero meter counts', () => {
    api.createPortfolio(portfolioData()).then(portfolio => {
      return api.request('GET', '/portfolios').then(({ status, body }) => {
        expect(status).to.eq(200);
        expect(body).to.be.an('array');
        const matches = body.map(item => item.portfolio_json).filter(item => Number(item.portfolio_id) === Number(portfolio.id));
        expect(matches).to.have.length(1);
        const [record] = matches;
        expect(record).to.include({ portfolio_name: portfolio.name, portfolio_number: portfolio.portfolio_number });
        for (const key of ['electric_meter_count', 'cold_water_meter_count', 'total_buildings']) {
          expect(record[key], key).to.be.oneOf([0, '0']);
        }
      });
    });
  });

  it('UM-API-005-POS - Return the requested portfolio and its empty building list', () => {
    api.createPortfolio(portfolioData()).then(portfolio => {
      return api.portfolioSection(portfolio, 'detail').then(detail => {
        expect(detail.building_list).to.deep.eq([]);
      });
    });
  });

  it('UM-API-006-POS - Return an empty tenant list for a new portfolio', () => {
    api.createPortfolio(portfolioData()).then(portfolio => {
      return api.portfolioSection(portfolio, 'tenants').then(detail => {
        expect(detail.tenant_list).to.deep.eq([]);
      });
    });
  });

  it('UM-API-007-POS - Electric: list meters in the requested portfolio and utility group', () => {
    api.assertPortfolioMeters('Electric');
  });

  it('UM-API-007-POS - Cold Water: list meters in the requested portfolio and utility group', () => {
    api.assertPortfolioMeters('Cold Water');
  });

  it('UM-API-005-NEG - Reject a detail lookup for an unknown portfolio', () => {
    api.assertUnknownRecord('portfolio', '/portfolios/detail');
  });

  it('UM-API-006-NEG - Reject a tenant list lookup for an unknown portfolio', () => {
    api.assertUnknownRecord('portfolio', '/portfolios/tenants');
  });

  it('UM-API-007-NEG - Reject a meter list lookup for an unknown portfolio', () => {
    api.assertUnknownRecord('portfolio', '/portfolios/meter');
  });
});
