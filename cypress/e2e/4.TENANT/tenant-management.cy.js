import { LoginPage } from '../../../pageObjects/LoginPage';
import { BuildingPage } from '../../../pageObjects/BuildingPage';
import { TenantPage } from '../../../pageObjects/TenantPage';
import { NotesPage } from '../../../pageObjects/NotesPage';
import { LettersPage } from '../../../pageObjects/LettersPage';
import { UtilityManagerApiClient } from '../../API_CLIENTS/UtilityManagerApiClient';
import { portfolioData, buildingData, tenantData, recordData } from '../../data/qaData';

const login = new LoginPage();
const buildings = new BuildingPage();
const tenants = new TenantPage();
const notes = new NotesPage('Tenant');
const letters = new LettersPage('Tenant');
const api = new UtilityManagerApiClient();

describe('Tenant Management', { tags: ['@tenant', '@ui'] }, () => {
  beforeEach(() => {
    login.useSession();
    api.createPortfolio(portfolioData()).then(parent => {
      buildings.create(buildingData(), parent.id).then(building => cy.wrap(building, { log: false }).as('building'));
    });
  });

  it('UM-TEN-001 - Create a tenant and initial lease with the correct building and saved values', { tags: '@smoke' }, function () {
    const building = this.building;
    const data = tenantData();
    data.email = `${data.number}@example.invalid`;
    tenants.create(data, building).then(saved => tenants.open(saved, building, data, { endDate: data.endDate }));
  });

  it('UM-TEN-002 - Create and update a tenant while keeping optional email blank', function () {
    const building = this.building;
    const data = tenantData();
    tenants.create(data, building).then(saved => {
      tenants.edit(saved, building, { ...data, city: 'Brooklyn', zip: '11201' });
    });
  });

  it('UM-TEN-003 - Reject malformed email on create and edit without changing saved data', { tags: '@negative' }, function () {
    const building = this.building;
    const data = { ...tenantData(), email: 'invalid-address' };
    tenants.openCreate(data, building);
    tenants.fill(data, { initialLease: true });
    tenants.assertInvalidCreate(data, 'Please enter a valid email address');
    data.email = `${data.number}@example.invalid`;
    tenants.fill(data);
    tenants.save(data, building).then(saved => {
      tenants.edit(saved, building, { ...data, email: 'still-invalid' }, { invalidEmail: true });
    });
  });

  it('UM-TEN-004 - Reject an initial lease ending on or before its start date', { tags: '@negative' }, function () {
    const building = this.building;
    const data = tenantData();
    tenants.openCreate(data, building);
    tenants.fill(data, { initialLease: true });
    const previous = new Date(`${data.startDate}T12:00:00`);
    previous.setDate(previous.getDate() - 1);
    const beforeStart = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}-${String(previous.getDate()).padStart(2, '0')}`;
    for (const endDate of [data.startDate, beforeStart]) {
      tenants.assertInvalidCreate(data, 'Lease end date must be after start date', { endDate, cancel: endDate === beforeStart });
    }
  });

  it('UM-TEN-005 - Save an open-ended lease, add an end date and clear it again', function () {
    const building = this.building;
    const data = tenantData();
    const datedEnd = data.endDate;
    // UM-TEN-001 owns the supplied-date creation check; this case verifies editing.
    tenants.create(data, building).then(saved => {
      const changes = { location: `${data.location} Updated`, adminFee: '20.25' };
      tenants.editLease(saved, building, { ...changes, endDate: null });
      tenants.editLease(saved, building, { ...changes, endDate: datedEnd });
      tenants.editLease(saved, building, { ...changes, endDate: null });
    });
  });

  it('UM-TEN-006 - Conclude an initial lease and persist its moved-out state', function () {
    const building = this.building;
    const data = tenantData();
    tenants.create(data, building).then(saved => {
      tenants.editLease(saved, building, { endDate: data.startDate.slice(0, 8) + '02' });
    });
  });

  it('UM-TEN-014 - Cancel then save tenant contact and exemption changes without changing identity', function () {
    const building = this.building;
    const data = tenantData();
    const updated = { ...data, name: `${data.name} Updated`, email: `${data.number}@example.invalid`, city: 'Brooklyn', zip: '11201', taxExempt: '1', lmepExempt: '1' };
    tenants.create(data, building).then(saved => {
      tenants.edit(saved, building, updated, { cancel: true });
      tenants.edit(saved, building, updated);
    });
  });

  it('UM-TEN-015 - Add, cancel and edit a second lease without changing the first', function () {
    const building = this.building;
    const data = tenantData();
    const additional = { ...tenantData(), startDate: data.startDate.slice(0, 8) + '02', endDate: null,
      sqft: '350', occupancy: '2', adminFee: '0', setupCharge: '2.50', reviewCharge: '1.25' };
    tenants.create(data, building).then(saved => {
      tenants.addLease(saved, building, additional).then(lease => {
        const changes = { lease, endDate: null, location: `${additional.location} Updated`, adminFee: '18.25' };
        tenants.editLease(saved, building, { ...changes, cancel: true });
        tenants.editLease(saved, building, changes);
      });
    });
  });

  it('UM-TEN-018 - Cancel then delete an empty lease without changing its sibling', function () {
    const building = this.building;
    const data = tenantData();
    tenants.create(data, building).then(saved => {
      tenants.addLease(saved, building, { ...tenantData(), endDate: null }).then(lease => tenants.deleteLease(saved, building, lease));
    });
  });

  it('UM-NOTE-013 - Save tenant notes and tickets without leaking into a sibling tenant', { tags: '@notes' }, function () {
    const building = this.building;
    const data = tenantData();
    tenants.create(data, building).then(saved => {
      const expected = [];
      for (const kind of ['note', 'ticket']) {
        const entry = { ...recordData(kind === 'note' ? 'Note' : 'Ticket'), kind };
        entry.body = entry.name;
        cy.then(() => {
          notes.open(saved.id, expected, { buildingId: building.id });
          notes.create(saved, entry).then(() => {
            expected.push(entry);
            notes.open(saved.id, expected, { buildingId: building.id });
          });
        });
      }
      cy.then(() => {
        const sibling = tenantData();
        tenants.create(sibling, building).then(other => notes.open(other.id, [], { buildingId: building.id }));
      });
    });
  });

  it('UM-LTR-003 - Validate Tenant letter fields and recipients, then cancel', { tags: '@letters' }, function () {
    const building = this.building;
    const data = tenantData();
    tenants.create(data, building).then(saved => {
      letters.openPreview(saved.id, { buildingId: building.id });
      letters.validateRecipientsAndCancel(saved.id);
    });
  });
});
