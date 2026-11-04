import { LoginPage } from '../../../pageObjects/LoginPage';
import { DashboardPage } from '../../../pageObjects/DashboardPage';
import { BuildingPage } from '../../../pageObjects/BuildingPage';
import { TenantPage } from '../../../pageObjects/TenantPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData, buildingData, tenantData } from '../../data/qaData';

const login = new LoginPage();
const dashboard = new DashboardPage();
const buildings = new BuildingPage();
const tenants = new TenantPage();
const api = new UtilityManagerApiClient();

describe('Global Search and Building Route Context', { tags: ['@dashboard', '@search', '@ui'] }, () => {
  let portfolio, building, tenant, term;

  before(() => {
    login.useSession();
    api.createPortfolio(portfolioData()).then(parent => {
      portfolio = parent;
      term = parent.portfolio_number.split('_')[1];
      buildings.create(buildingData(), portfolio.id).then(savedBuilding => {
        building = { ...savedBuilding, parentNumber: parent.portfolio_number };
        tenants.create(tenantData({ useDefaultDates: true }), building).then(savedTenant => { tenant = savedTenant; });
      });
    });
  });

  beforeEach(() => login.useSession());

  it('UM-DASH-011 - Apply the result-limit contract for four, three, two and one entity filters', () => {
    dashboard.checkSearchLimits(term);
  });

  it('UM-DASH-012 - Keep Building before Tenant results and restore all groups with Clear Filters', () => {
    dashboard.checkSearchFilters(term);
  });

  it.only('UM-DASH-012 - Remove only the selected filter and preserve the remaining group', () => {
    dashboard.checkSearchFilters(term, { deselect: true });
  });

  it('UM-DASH-014 - Open the exact Building result with its owning Portfolio context', () => {
    dashboard.checkSearchNavigation(building);
  });

  it('UM-DASH-014 - Open the exact Tenant result under its owning Building', () => {
    dashboard.checkSearchNavigation(building, tenant);
  });

  it('UM-NAV-005 - Preserve Building context in direct and Portfolio routes and breadcrumbs', () => {
    buildings.checkRouteContext(building, portfolio);
  });
});
