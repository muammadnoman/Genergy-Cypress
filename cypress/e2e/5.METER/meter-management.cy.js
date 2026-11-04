import { LoginPage } from '../../../pageObjects/LoginPage';
import { BuildingPage } from '../../../pageObjects/BuildingPage';
import { TenantPage } from '../../../pageObjects/TenantPage';
import { MeterPage } from '../../../pageObjects/MeterPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData, buildingData, tenantData } from '../../data/qaData';

const login = new LoginPage();
const buildings = new BuildingPage();
const tenants = new TenantPage();
const meters = new MeterPage();
const api = new UtilityManagerApiClient();

describe('Physical Meter Persistence and Assignment', { tags: ['@meter', '@ui'] }, () => {
  let building, tenant, electric, water;
  before(() => {
    login.useSession();
    api.createPortfolio(portfolioData()).then(parent => buildings.create({ ...buildingData(), region: 'New York City' }, parent.id).then(saved => {
      building = saved;
      tenants.create(tenantData({ useDefaultDates: true }), building).then(savedTenant => {
        tenant = savedTenant;
        tenants.createUtility(tenant, building, 'Electric').then(utility => {
          electric = utility;
          tenants.createUtility(tenant, building, 'Cold Water').then(other => { water = other; });
        });
      });
    }));
  });
  beforeEach(() => login.useSession());

  it('UM-MTR-001 - Electric: create and reload a physical meter with saved values', () => {
    meters.create(building, 'Electric');
  });
  it('UM-MTR-001 - Cold Water: create and reload a physical meter with saved values', () => {
    meters.create(building, 'Cold Water');
  });
  it('UM-MTR-002 - Electric: create and update while leaving reading type blank', () => {
    meters.create(building, 'Electric').then(meter => meters.edit(meter, building, { reading_interval: 30 }));
  });
  it('UM-MTR-002 - Cold Water: create and update while leaving reading type blank', () => {
    meters.create(building, 'Cold Water').then(meter => meters.edit(meter, building, { reading_interval: 30 }));
  });
  it('UM-MTR-006 - Electric: cancel then persist decimal multiplier changes', () => {
    meters.create(building, 'Electric').then(meter => {
      const changes = { consumption_multiplier: 1.75, demand_multiplier: 2.25 };
      meters.edit(meter, building, changes, { cancel: true });
      meters.edit(meter, building, changes);
    });
  });
  it('UM-MTR-006 - Cold Water: cancel then persist decimal multiplier changes', () => {
    meters.create(building, 'Cold Water').then(meter => {
      const changes = { consumption_multiplier: 1.75, demand_multiplier: 2.25 };
      meters.edit(meter, building, changes, { cancel: true });
      meters.edit(meter, building, changes);
    });
  });
  it('UM-TEN-010 - Electric: assign the exact physical meter to its matching lease utility', () => {
    meters.create(building, 'Electric', { tenantNumber: tenant.tenant_number, leaseUtilityId: electric.id })
      .then(meter => tenants.assignMeter(tenant, building, electric, meter));
  });
  it('UM-TEN-010 - Cold Water: assign the exact physical meter to its matching lease utility', () => {
    meters.create(building, 'Cold Water', { tenantNumber: tenant.tenant_number, leaseUtilityId: water.id })
      .then(meter => tenants.assignMeter(tenant, building, water, meter));
  });
});
