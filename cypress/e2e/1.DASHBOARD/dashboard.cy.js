import { LoginPage } from '../../../pageObjects/LoginPage';
import { DashboardPage } from '../../../pageObjects/DashboardPage';
import { portfolioData } from '../../data/qaData';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';

const login = new LoginPage();
const dashboard = new DashboardPage();
const api = new UtilityManagerApiClient();

describe('Dashboard', { tags: ['@dashboard', '@ui'] }, () => {
  beforeEach(() => login.useSession());

  it('UM-DASH-001 - Render KPI values and percentages from the reference-date API', () => {
    dashboard.assertKpisMatchApi();
  });

  it('UM-DASH-009 - Clear API-backed results and suppress searches below the minimum length', () => {
    const data = portfolioData();
    api.createPortfolio(data).then(() => dashboard.assertShortSearch(data));
  });

  it('UM-DASH-010 - Find an owned portfolio by case-insensitive partial name', () => {
    const data = portfolioData();
    api.createPortfolio(data).then(saved => dashboard.assertPortfolioSearch(data, saved.id));
  });
});
