import { LoginPage } from '../../../pageObjects/LoginPage';
import { BuildingPage } from '../../../pageObjects/BuildingPage';
import { TenantPage } from '../../../pageObjects/TenantPage';
import { NotesPage } from '../../../pageObjects/NotesPage';
import { OptionsPage } from '../../../pageObjects/OptionsPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData, buildingData, tenantData } from '../../data/qaData';

const login = new LoginPage();
const buildings = new BuildingPage();
const tenants = new TenantPage();
const notes = new NotesPage('Lease Utility');
const options = new OptionsPage('Lease Utility');
const api = new UtilityManagerApiClient();

describe('Lease Utility Notes and Options', { tags: ['@tenant', '@lease-utility', '@ui'] }, () => {
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

  describe('Electric', () => {
    it('UM-NOTE-015 - Electric: save and edit utility notes and tickets', function () {
      if (notes.ownershipFailure) this.skip();
      notes.checkUtilityNotes(tenant, building, electric, water);
    });
    it('UM-NOTE-004 - Electric: isolate notes between utility IDs', function () {
      if (notes.ownershipFailure) this.skip();
      notes.checkUtilityNotes(tenant, building, electric, water, { isolation: true });
    });
    it('UM-NOTE-006 - Electric: keep the notes sidebar nonmodal and close on navigation', function () {
      notes.checkUtilitySidebar(tenant, building, electric, water);
    });
    it('UM-OPT-004 - Electric: save and edit attributes without changing Cold Water', function () {
      options.checkUtilityAttributes(tenant, building, electric, water);
    });
  });

  describe('Cold Water', () => {
    it('UM-NOTE-015 - Cold Water: save and edit utility notes and tickets', function () {
      if (notes.ownershipFailure) this.skip();
      notes.checkUtilityNotes(tenant, building, water, electric);
    });
    it('UM-NOTE-004 - Cold Water: isolate notes between utility IDs', function () {
      if (notes.ownershipFailure) this.skip();
      notes.checkUtilityNotes(tenant, building, water, electric, { isolation: true });
    });
    it('UM-NOTE-006 - Cold Water: keep the notes sidebar nonmodal and close on navigation', function () {
      notes.checkUtilitySidebar(tenant, building, water, electric);
    });
    it('UM-OPT-004 - Cold Water: save and edit attributes without changing Electric', function () {
      options.checkUtilityAttributes(tenant, building, water, electric);
    });
  });
});
