import { LoginPage } from '../../../pageObjects/LoginPage';
import { BuildingPage } from '../../../pageObjects/BuildingPage';
import { TenantPage } from '../../../pageObjects/TenantPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData, buildingData, tenantData } from '../../data/qaData';

const login = new LoginPage();
const buildings = new BuildingPage();
const tenants = new TenantPage();
const api = new UtilityManagerApiClient();

describe('Tenant Lease Utilities', { tags: ['@tenant', '@lease-utility', '@ui'] }, () => {
  beforeEach(() => {
    login.useSession();
    api.createPortfolio(portfolioData()).then(parent => buildings.create({ ...buildingData(), region: 'New York City' }, parent.id).then(building => {
      cy.wrap(building, { log: false }).as('building');
      tenants.create(tenantData({ useDefaultDates: true }), building).then(tenant => cy.wrap(tenant, { log: false }).as('tenant'));
    }));
  });

  describe('Electric', () => {
    it('UM-TEN-008 - Electric: save and edit settings without changing the sibling lease', function () {
      tenants.checkUtilitySettings(this.tenant, this.building, 'Electric');
    });

    it('UM-TEN-009 - Electric: validate precision and persist zero and two-decimal values', function () {
      tenants.checkUtilityPercentages(this.tenant, this.building, 'Electric');
    });

    it('UM-TEN-016 - Electric: reset rate choices on utility switch and preserve saved settings on cancel', function () {
      tenants.checkUtilitySwitch(this.tenant, this.building, 'Electric');
    });
  });

  describe('Cold Water', () => {
    it('UM-TEN-008 - Cold Water: save and edit settings without changing the sibling lease', function () {
      tenants.checkUtilitySettings(this.tenant, this.building, 'Cold Water');
    });

    it('UM-TEN-009 - Cold Water: validate precision and persist zero and two-decimal values', function () {
      tenants.checkUtilityPercentages(this.tenant, this.building, 'Cold Water');
    });

    it('UM-TEN-016 - Cold Water: reset rate choices on utility switch and preserve saved settings on cancel', function () {
      tenants.checkUtilitySwitch(this.tenant, this.building, 'Cold Water');
    });
  });
});
