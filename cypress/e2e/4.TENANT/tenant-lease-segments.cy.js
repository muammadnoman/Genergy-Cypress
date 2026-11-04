import { LoginPage } from '../../../pageObjects/LoginPage';
import { BuildingPage } from '../../../pageObjects/BuildingPage';
import { TenantPage } from '../../../pageObjects/TenantPage';
import { NotesPage } from '../../../pageObjects/NotesPage';
import { OptionsPage } from '../../../pageObjects/OptionsPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData, buildingData, tenantData, recordData } from '../../data/qaData';

const login = new LoginPage();
const buildings = new BuildingPage();
const tenants = new TenantPage();
const notes = new NotesPage('Lease');
const options = new OptionsPage('Lease');
const api = new UtilityManagerApiClient();

describe('Lease Notes and Attributes', { tags: ['@tenant', '@lease', '@ui'] }, () => {
  beforeEach(() => {
    login.useSession();
    api.createPortfolio(portfolioData()).then(parent => buildings.create(buildingData(), parent.id).then(building => {
      cy.wrap(building, { log: false }).as('building');
      tenants.create(tenantData(), building).then(tenant => {
        tenants.addLease(tenant, building, { ...tenantData(), endDate: null }).then(sibling => {
          cy.wrap(tenant, { log: false }).as('tenant');
          cy.wrap(sibling, { log: false }).as('sibling');
        });
      });
    }));
  });

  it('UM-NOTE-014 - Save lease notes and tickets without leaking into its sibling lease', { tags: '@notes' }, function () {
    const tenant = this.tenant, building = this.building;
    const context = { tenantId: tenant.id, buildingId: building.id, lease: tenant.lease };
    const parent = { id: tenant.lease.id, tenant_number: tenant.tenant_number };
    const expected = [];
    for (const kind of ['note', 'ticket']) {
      const data = { ...recordData(kind === 'note' ? 'Note' : 'Ticket'), kind };
      data.body = data.name;
      cy.then(() => {
        notes.open(parent.id, expected, context);
        notes.create(parent, data).then(() => {
          expected.push(data);
          notes.open(parent.id, expected, context);
        });
      });
    }
    notes.open(this.sibling.id, [], { ...context, lease: this.sibling });
  });

  it('UM-OPT-003 - Save, cancel and edit a lease attribute without changing its sibling', { tags: '@options' }, function () {
    const tenant = this.tenant, building = this.building;
    const context = { tenantId: tenant.id, tenantNumber: tenant.tenant_number, buildingId: building.id, lease: tenant.lease };
    const key = recordData('Attribute').name;
    options.open(tenant.lease.id, undefined, context);
    options.create(tenant.lease.id, key, 'Cancelled', { cancel: true, validateRequired: true });
    options.open(tenant.lease.id, key, context);
    options.create(tenant.lease.id, key, 'Original', { validateRequired: true });
    options.open(tenant.lease.id, undefined, context);
    options.edit(key, 'Cancelled edit', { cancel: true });
    options.assertAttribute(tenant.lease.id, key, { attribute_value: 'Original' });
    options.open(tenant.lease.id, undefined, context);
    options.edit(key, '0');
    options.open(tenant.lease.id, undefined, context);
    options.assertAttribute(tenant.lease.id, key, { attribute_value: '0' });
    options.open(this.sibling.id, key, { ...context, lease: this.sibling });
    options.assertAttribute(this.sibling.id, key, null);
  });
});
