import { LoginPage } from '../../../pageObjects/LoginPage';
import { BuildingPage } from '../../../pageObjects/BuildingPage';
import { MeterPage } from '../../../pageObjects/MeterPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData, buildingData } from '../../data/qaData';

const login = new LoginPage();
const buildings = new BuildingPage();
const meters = new MeterPage();
const api = new UtilityManagerApiClient();

describe('Physical Meter Duplication and Billing Flag', { tags: ['@meter', '@ui'] }, () => {
  let building, electric, water;
  before(() => {
    login.useSession();
    api.createPortfolio(portfolioData()).then(parent => buildings.create({ ...buildingData(), region: 'New York City' }, parent.id)
      .then(saved => {
        building = saved;
        meters.create(building, 'Electric').then(meter => { electric = meter; });
        meters.create(building, 'Cold Water').then(meter => { water = meter; });
      }));
  });
  beforeEach(() => login.useSession());

  it('UM-MTR-008 - Electric: cancel duplication without creating a meter or changing the source', () => {
    meters.create(building, 'Electric', { duplicateOf: electric, cancel: true });
  });
  it('UM-MTR-008 - Cold Water: cancel duplication without creating a meter or changing the source', () => {
    meters.create(building, 'Cold Water', { duplicateOf: water, cancel: true });
  });
  it('UM-MTR-008 - Electric: save a separate duplicate and preserve the source', () => {
    meters.create(building, 'Electric', { duplicateOf: electric });
  });
  it('UM-MTR-008 - Cold Water: save a separate duplicate and preserve the source', () => {
    meters.create(building, 'Cold Water', { duplicateOf: water });
  });
  it('UM-MTR-009 - Electric: cancel then save No Billing and verify detail and edit prefill', () => {
    meters.edit(electric, building, { not_billable_flag: true }, { cancel: true });
    meters.edit(electric, building, { not_billable_flag: true });
  });
  it('UM-MTR-009 - Cold Water: cancel then save No Billing and verify detail and edit prefill', () => {
    meters.edit(water, building, { not_billable_flag: true }, { cancel: true });
    meters.edit(water, building, { not_billable_flag: true });
  });
});
