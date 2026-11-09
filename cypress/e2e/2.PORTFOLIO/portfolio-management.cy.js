import { LoginPage } from '../../../pageObjects/LoginPage';
import { PortfolioPage } from '../../../pageObjects/PortfolioPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData } from '../../data/qaData';

const login = new LoginPage();
const portfolio = new PortfolioPage();
const api = new UtilityManagerApiClient();

describe('Portfolio Management', { tags: ['@portfolio', '@ui'] }, () => {
  beforeEach(() => login.useSession());

  it('UM-PORT-001 - Create a portfolio with its required billing template', { tags: '@smoke' }, () => {
    const data = portfolioData();
    portfolio.openCreate(data);
    portfolio.fill(data);
    portfolio.saveCreate(data);
    portfolio.assertRowMatchesApi(data);
  });

  it('UM-PORT-002 - Validate portfolio required fields', () => {
    const data = portfolioData();
    portfolio.openCreate(data);
    portfolio.assertRequired(data);
  });

  it('UM-PORT-003 - Validate over-limit portfolio names and numbers', () => {
    const data = portfolioData();
    portfolio.assertLengthValidation(data);
    const boundary = { ...data, name: `${data.name}${'x'.repeat(100 - data.name.length)}` };
    portfolio.openCreate();
    portfolio.fill(boundary);
    portfolio.saveCreate(boundary);
  });

  it('UM-PORT-004 - Update portfolio details and verify persistence', () => {
    const data = portfolioData();
    api.createPortfolio(data);
    portfolio.edit(data, `${data.name} Updated`.slice(0, 100));
  });

  it('UM-PORT-005 - Upload supported portfolio logos and verify persistence', () => {
    for (const extension of ['png', 'jpg', 'svg']) {
      const data = portfolioData();
      api.createPortfolio(data);
      portfolio.edit(data, data.name, { logo: `cypress/fixtures/Auto_logo.${extension}` });
    }
  });

  it('UM-PORT-006 - Reject unsupported and oversized portfolio logos', () => {
    const data = portfolioData();
    api.createPortfolio(data);
    portfolio.edit(data, data.name, { logo: 'cypress/fixtures/Auto_logo.png' });
    portfolio.assertInvalidLogo(data);
  });

  it('UM-PORT-007 - Cancel portfolio deletion', () => {
    const data = portfolioData();
    api.createPortfolio(data);
    portfolio.openDelete(data.number, { cancel: true });
  });

  it('UM-PORT-008 - Exclude an offline portfolio from lists and selectors', () => {
    const data = portfolioData();
    api.createPortfolio(data);
    portfolio.openDelete(data.number);
    portfolio.confirmDelete(data.number);
    portfolio.assertExcludedFromBillingSelector(data);
  });

  it('UM-PORT-009 - Compare Electric and Cold Water meter counts with DB', () => {
    portfolio.assertMeterCounts();
  });

  it('UM-PORT-010 - Check portfolio tabs, record details and empty lists', () => {
    portfolio.assertScopedTabs();
    const empty = portfolioData();
    api.createPortfolio(empty).then(saved => portfolio.assertScopedTabs(saved.id));
  });

});
