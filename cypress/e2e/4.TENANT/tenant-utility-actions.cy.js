import { LoginPage } from '../../../pageObjects/LoginPage';
import { BuildingPage } from '../../../pageObjects/BuildingPage';
import { TenantPage } from '../../../pageObjects/TenantPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData, buildingData, tenantData } from '../../data/qaData';

const login = new LoginPage();
const buildings = new BuildingPage();
const tenants = new TenantPage();
const api = new UtilityManagerApiClient();

describe('Lease Utility Meter Controls and Deletion', { tags: ['@tenant', '@lease-utility', '@ui'] }, () => {
  let building, tenant, electric, water;

  before(() => {
    login.useSession();
    api.createPortfolio(portfolioData()).then(parent => buildings.create({ ...buildingData(), region: 'New York City' }, parent.id).then(savedBuilding => {
      building = savedBuilding;
      tenants.create(tenantData({ useDefaultDates: true }), building).then(savedTenant => {
        tenant = savedTenant;
        tenants.createUtility(tenant, building, 'Electric').then(savedElectric => {
          electric = savedElectric;
          tenants.createUtility(tenant, building, 'Cold Water').then(savedWater => { water = savedWater; });
        });
      });
    }));
  });

  beforeEach(() => login.useSession());

  it('UM-TEN-010 - Electric: require a meter and cancel without assigning', () => {
    tenants.checkEmptyMeterSelection(tenant, building, electric);
  });

  it('UM-TEN-010 - Cold Water: require a meter and cancel without assigning', () => {
    tenants.checkEmptyMeterSelection(tenant, building, water);
  });

  it('UM-TEN-011 - Electric: search an empty meter list and reset the search', () => {
    tenants.checkEmptyMeterSelection(tenant, building, electric, { search: true });
  });

  it('UM-TEN-011 - Cold Water: search an empty meter list and reset the search', () => {
    tenants.checkEmptyMeterSelection(tenant, building, water, { search: true });
  });

  it('UM-TEN-018 - Electric: cancel then delete only the empty lease utility', () => {
    tenants.deleteUtility(tenant, building, electric);
  });

  it('UM-TEN-018 - Cold Water: cancel then delete only the empty lease utility', () => {
    tenants.deleteUtility(tenant, building, water);
  });
});
