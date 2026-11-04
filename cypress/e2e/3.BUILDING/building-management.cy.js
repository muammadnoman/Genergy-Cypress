import { LoginPage } from '../../../pageObjects/LoginPage';
import { BuildingPage } from '../../../pageObjects/BuildingPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData, buildingData } from '../../data/qaData';

const login = new LoginPage();
const building = new BuildingPage();
const api = new UtilityManagerApiClient();

describe('Building Management', { tags: ['@building', '@ui'] }, () => {
  beforeEach(() => login.useSession());

  it('UM-BLDG-001 - Create a building within a portfolio and verify UI soft deletion', { tags: '@smoke' }, () => {
    const parent = portfolioData();
    const data = buildingData();
    api.createPortfolio(parent).then(row => {
      building.create(data, row.id).then(saved => {
        building.assertDetailMatchesApi(saved.id, row.id);
        building.deleteBuilding(data.number, row.id);
      });
    });
  });

  it('UM-BLDG-002 - Validate required building fields', () => {
    const data = buildingData();
    api.createPortfolio(portfolioData()).then(row => {
      building.assertRequired(data, row.id);
    });
  });
  it('UM-BLDG-003 - Validate ZIP formats and persist both valid formats', () => {
    api.createPortfolio(portfolioData()).then(parent => {
      const invalid = buildingData();
      building.assertInvalidValues(invalid, parent.id, { 'ZIP Code': [['ABCDE', 'Please enter a valid ZIP code'], ['1234', 'Please enter a valid ZIP code'], ['100001', 'Please enter a valid ZIP code']] });
      for (const zip of ['10001', '10001-1234']) {
        const data = { ...buildingData(), zip };
        building.create(data, parent.id);
      }
    });
  });

  it('UM-BLDG-004 - Validate fee precision and persist zero and two-decimal fees', () => {
    api.createPortfolio(portfolioData()).then(parent => {
      const invalid = buildingData();
      building.assertInvalidValues(invalid, parent.id, {
        'Admin Fee': [['-1', 'Admin fee cannot be negative'], ['12.345', 'Admin fee must have at most 2 decimal places']],
        'Add-on Fee': [['-1', 'Add-on fee cannot be negative'], ['12.345', 'Add-on fee must have at most 2 decimal places']],
      });
      for (const value of ['0', '12.34']) {
        const data = { ...buildingData(), adminFee: value, addOnFee: value };
        building.create(data, parent.id);
      }
    });
  });

  it('UM-BLDG-005 - Update address and fees without changing building identity', () => {
    api.createPortfolio(portfolioData()).then(parent => {
      const data = buildingData();
      building.create(data, parent.id).then(saved => {
        building.edit({ ...data, street: '200 Auto Test Avenue', city: 'Brooklyn', zip: '11201', adminFee: '20.25', addOnFee: '3.50' }, parent.id, saved.id);
      });
    });
  });

  it('UM-BLDG-007 - Render zero billed amount for a building without bills', () => {
    api.createPortfolio(portfolioData()).then(parent => {
      const data = buildingData();
      building.create(data, parent.id).then(saved => building.assertDetailMatchesApi(saved.id, parent.id, { expectZeroBilling: true }));
    });
  });

  it('UM-BLDG-008 - Check empty building tabs, badges and shortcut context', () => {
    api.createPortfolio(portfolioData()).then(parent => {
      for (let index = 0; index < 2; index++) {
        building.create(buildingData(), parent.id).then(saved => building.assertEmptyTabs(saved, parent.id));
      }
    });
  });
});
