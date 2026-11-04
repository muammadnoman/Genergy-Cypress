import { LoginPage } from '../../../pageObjects/LoginPage';
import { BuildingPage } from '../../../pageObjects/BuildingPage';
import { MeterPage } from '../../../pageObjects/MeterPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData, buildingData } from '../../data/qaData';

const login = new LoginPage();
const buildings = new BuildingPage();
const meters = new MeterPage();
const api = new UtilityManagerApiClient();

describe('Meter Read APIs and Building Isolation', { tags: ['@api', '@meter'] }, () => {
  let building, electric, water, otherElectric, otherWater;
  before(() => {
    login.useSession();
    api.createPortfolio(portfolioData()).then(parent => {
      buildings.create({ ...buildingData(), region: 'New York City' }, parent.id).then(saved => {
        building = saved;
        meters.create(building, 'Electric').then(meter => { electric = meter; });
        meters.create(building, 'Cold Water').then(meter => { water = meter; });
      });
      buildings.create({ ...buildingData(), region: 'New York City' }, parent.id).then(other => {
        meters.create(other, 'Electric').then(meter => { otherElectric = meter; });
        meters.create(other, 'Cold Water').then(meter => { otherWater = meter; });
      });
    });
  });
  beforeEach(() => api.authenticate());

  it('UM-API-037-POS - Electric: list the matching Building meters and exclude the other Building', () => {
    api.assertMeterList(building, electric, [otherElectric, otherWater]);
  });
  it('UM-API-037-POS - Cold Water: list the matching Building meters and exclude the other Building', () => {
    api.assertMeterList(building, water, [otherElectric, otherWater]);
  });
  it('UM-API-038-POS - Electric: return the exact physical Meter configuration', () => {
    api.assertMeterDetails(electric, [water, otherElectric, otherWater]);
  });
  it('UM-API-038-POS - Cold Water: return the exact physical Meter configuration', () => {
    api.assertMeterDetails(water, [electric, otherElectric, otherWater]);
  });
  it('UM-API-037-NEG - Return a useful not-found response for an unknown Building number', () => {
    api.assertMissingMeterContext('building', buildingData().number);
  });
  it('UM-API-038-NEG - Return a useful not-found response for a nonexistent Meter ID', () => {
    api.assertMissingMeterContext('meter');
  });
});
