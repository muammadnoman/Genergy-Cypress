import { LoginPage } from '../../../pageObjects/LoginPage';
import { BuildingPage } from '../../../pageObjects/BuildingPage';
import { MeterPage } from '../../../pageObjects/MeterPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData, buildingData } from '../../data/qaData';

const login = new LoginPage();
const buildings = new BuildingPage();
const meters = new MeterPage();
const api = new UtilityManagerApiClient();

describe('Meter Validation and Creation Cancellation', { tags: ['@meter', '@ui'] }, () => {
  let building;

  before(() => {
    login.useSession();
    api.createPortfolio(portfolioData()).then(parent => buildings.create(buildingData(), parent.id).then(saved => { building = saved; }));
  });

  beforeEach(() => login.useSession());

  it('UM-MTR-003 - Electric: require meter identity, utility, type and location', () => {
    meters.checkRequiredFields(building, 'Electric');
  });

  it('UM-MTR-003 - Cold Water: require meter identity, utility, type and location', () => {
    meters.checkRequiredFields(building, 'Cold Water');
  });

  it('UM-MTR-004 - Electric: reject end dates equal to and before the start date', () => {
    meters.checkDateRange(building, 'Electric');
  });

  it('UM-MTR-004 - Cold Water: reject end dates equal to and before the start date', () => {
    meters.checkDateRange(building, 'Cold Water');
  });

  it('UM-MTR-001 - Electric: cancel creation confirmation without saving a meter', () => {
    meters.checkCreateCancellation(building, 'Electric');
  });

  it('UM-MTR-001 - Cold Water: cancel creation confirmation without saving a meter', () => {
    meters.checkCreateCancellation(building, 'Cold Water');
  });
});
