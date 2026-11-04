import { AppPage } from './AppPage';
import { TenantPage } from './TenantPage';
import { recordData } from '../cypress/data/qaData';

export class OptionsPage extends AppPage {
  constructor(entityType = 'Portfolio') {
    super();
    if (!['Portfolio', 'Building', 'Lease', 'Lease Utility'].includes(entityType)) throw new Error('Unsupported owned Options context.');
    this.entityType = entityType;
    this.entityKind = entityType.toLowerCase().replaceAll(' ', '_');
  }

  visitNumber = 0;

  open(entityId, excludedKey, { buildingId, tenantId, tenantNumber, lease, utility } = {}) {
    const alias = `${this.entityKind}Attributes${++this.visitNumber}`;
    cy.intercept('GET', `**/attributes/${encodeURIComponent(this.entityType)}/entity/${entityId}`).as(alias);
    this.tenantNumber = tenantNumber;
    this.leaseId = lease?.id;
    if (['Lease', 'Lease Utility'].includes(this.entityType)) {
      if (!Number.isInteger(tenantId) || !Number.isInteger(buildingId) || !tenantNumber || !lease?.id || (this.entityType === 'Lease' ? lease.id !== entityId : utility?.id !== entityId || utility.lease_id !== lease.id)) throw new Error('Lease options require their exact owning context.');
      super.open(`/building/${buildingId}/tenant/${tenantId}`);
      const tenants = new TenantPage();
      tenants.leaseSection(lease).as('leaseOptionsSection').children('h3').find('button[aria-expanded]').then(trigger => {
        if (trigger.attr('aria-expanded') === 'false') cy.wrap(trigger).click();
      });
      if (utility) {
        tenants.utilitySection(lease, utility).as('leaseOptionsSection').children('h3').find('button[aria-expanded]').then(trigger => {
          if (trigger.attr('aria-expanded') === 'false') cy.wrap(trigger).click();
        });
      }
      cy.get('@leaseOptionsSection').children('h3').contains('[role="tab"]', /^Options$/).click();
    } else {
      super.open(`/${this.entityKind}/${entityId}`);
      cy.contains('[role="tab"]', /^Options$/).click();
    }
    cy.wait(`@${alias}`).then(({ response }) => {
      expect(response, 'attribute-list API response').to.exist;
      return cy.task('db:query', {
        sql: `SELECT * FROM core.${this.entityKind}_attribute WHERE ${this.entityKind}_id=? AND COALESCE(is_offline,0)=0`,
        params: [entityId],
      }, { log: false }).then(saved => {
        expect(response.statusCode, 'attribute list status').to.be.oneOf(saved.length ? [200] : [200, 404]);
        if (response.statusCode === 404) {
          expect(response.body).to.deep.eq({
            message: `No attributes found for entity_type: ${this.entityType} and entity_id: ${entityId}`,
          });
        } else {
          expect(response.body.status).to.eq('success');
          expect(response.body.message).to.eq('Attributes retrieved successfully');
          expect(response.body.count).to.eq(saved.length);
          expect(response.body.data).to.be.an('array').and.have.length(saved.length);
        }
        const items = response.statusCode === 404 ? [] : response.body.data;
        cy.get(['Lease', 'Lease Utility'].includes(this.entityType) ? '@leaseOptionsSection' : '[role="tabpanel"][data-state="active"]').contains('h3', /Custom Attributes/).parent().as('attributeTable');
        for (const item of items) {
          expect(Number(item[`${this.entityKind}_id`])).to.eq(Number(entityId));
          expect(saved.find(row => Number(row.id) === Number(item.id))).to.include({
            attribute_key: item.attribute_key, attribute_value: item.attribute_value,
          });
          cy.get('@attributeTable').contains('tbody tr', item.attribute_key).should('contain.text', item.attribute_value ?? '');
        }
        if (!items.length) cy.get('@attributeTable').should('contain.text', 'No results found.');
        if (excludedKey) {
          expect(items.map(item => item.attribute_key), 'attribute excluded from sibling API').not.to.include(excludedKey);
          cy.get('@attributeTable').should('not.contain.text', excludedKey);
        }
      });
    });
  }

  create(parentId, key, value, { cancel = false, validateRequired = false } = {}) {
    if (this.entityType === 'Lease' && !cancel) cy.task('fixtures:reserveLeaseChild', { tenantNumber: this.tenantNumber, leaseId: parentId, type: 'attribute', marker: key }, { log: false });
    if (this.entityType === 'Lease Utility' && !cancel) cy.task('fixtures:reserveLeaseChild', { tenantNumber: this.tenantNumber, leaseId: this.leaseId, leaseUtilityId: parentId, type: 'utility_attribute', marker: key }, { log: false });
    cy.get(['Lease', 'Lease Utility'].includes(this.entityType) ? '@leaseOptionsSection' : '[role="tabpanel"][data-state="active"]').contains('button', /^Add Attribute$/).click();
    if (validateRequired) {
      cy.contains('[role="dialog"] button', /^Save$/).click();
      cy.get('[role="dialog"]').should('contain.text', 'Attribute key is required').and('contain.text', 'Attribute value is required');
    }
    // This popover creates and selects the key through Add New, not role=option.
    cy.contains('[role="dialog"] button', 'Type to add new or select').should('not.be.disabled').click();
    cy.get('[role="dialog"] input[placeholder="Search..."]').type(key);
    cy.contains('[role="dialog"] button', /^Add New$/).click();
    this.field('Attribute Value').type(value);
    if (cancel) {
      cy.contains('[role="dialog"] button', /^Cancel$/).click();
    } else {
      cy.intercept('POST', '**/attributes/create').as('createPortfolioAttribute');
      cy.contains('[role="dialog"] button', /^Save$/).click();
      cy.wait('@createPortfolioAttribute').then(({ request, response }) => {
        expect(response.statusCode).to.be.oneOf([200, 201]);
        expect(request.body.entity_type).to.eq(this.entityType);
        expect(Number(request.body.entity_id)).to.eq(parentId);
        expect(request.body).to.include({ attribute_key: key, attribute_value: value });
      });
      cy.verifyToast('Attribute created successfully');
    }
    cy.get('[role="dialog"]').should('not.exist');
    return this.assertAttribute(parentId, key, cancel ? null : { attribute_value: value });
  }

  assertAttribute(parentId, key, expected) {
    return cy.task('db:query', { sql: `SELECT * FROM core.${this.entityKind}_attribute WHERE ${this.entityKind}_id=? AND attribute_key=?`, params: [parentId, key] }, { log: false }).then(rows => {
      expect(rows).to.have.length(expected === null ? 0 : 1);
      for (const [column, value] of Object.entries(expected || {})) {
        expect(typeof value === 'number' ? Number(rows[0][column]) : rows[0][column], column).to.eq(value);
      }
      return rows[0] || null;
    });
  }

  edit(key, value, { cancel = false } = {}) {
    cy.get('@attributeTable').contains('tbody tr', key).find('button').first().click();
    this.field('Attribute Value').clear().type(value);
    if (cancel) cy.contains('[role="dialog"] button', /^Cancel$/).click();
    else {
      cy.intercept('PUT', `**/attributes/${encodeURIComponent(this.entityType)}/*`).as('updatePortfolioAttribute');
      cy.contains('[role="dialog"] button', /^Update$/).click();
      cy.wait('@updatePortfolioAttribute').then(({ request, response }) => {
        expect(response.statusCode).to.eq(200);
        expect(request.body.attribute_key).to.eq(key);
        expect(request.body.attribute_value).to.eq(value);
        cy.verifyToast(response.body.message);
      });
    }
    cy.get('[role="dialog"]').should('not.exist');
  }

  delete(key, { cancel = false } = {}) {
    cy.get('@attributeTable').contains('tbody tr', key).find('button').last().click();
    cy.get('[role="dialog"]').should('contain.text', key);
    if (cancel) this.closeDialog();
    else {
      cy.intercept('PUT', `**/attributes/${this.entityType}/*/delete`).as('deletePortfolioAttribute');
      cy.intercept('GET', `**/attributes/${this.entityType}/entity/*`).as('attributesAfterDelete');
      cy.contains('[role="dialog"] button', /^Confirm$/).click();
      cy.wait('@deletePortfolioAttribute').then(({ request, response }) => {
        expect(response.statusCode).to.eq(200);
        cy.verifyToast(response.body.message);
        const attributeId = Number(new URL(request.url).pathname.split('/').at(-2));
        expect(attributeId, 'deleted attribute ID').to.be.a('number').and.be.greaterThan(0);
        cy.task('db:query', {
          sql: `SELECT attribute_key, is_offline FROM core.${this.entityKind}_attribute WHERE id=?`,
          params: [attributeId],
        }, { log: false }).then(rows => {
          expect(rows).to.have.length(1);
          expect(rows[0].attribute_key).to.eq(key);
          expect(Number(rows[0].is_offline), 'attribute soft-deleted in DB').to.eq(1);
        });
      });
      cy.wait('@attributesAfterDelete').then(({ request, response }) => {
        expect(response.statusCode, 'refreshed attribute list status').to.be.oneOf([200, 404]);
        if (response.statusCode === 404) {
          const entityId = new URL(request.url).pathname.split('/').at(-1);
          expect(response.body).to.deep.eq({
            message: `No attributes found for entity_type: ${this.entityType} and entity_id: ${entityId}`,
          });
        } else {
          expect(response.body.data).to.be.an('array');
          expect(response.body.data.map(item => item.attribute_key), 'deleted attribute absent from refreshed API').not.to.include(key);
        }
      });
      cy.get('[role="dialog"]').should('not.exist');
      // Keep this check: a valid empty-list 404 must also clear the existing UI row.
      cy.get('@attributeTable').find('tbody').should(table => {
        expect(table.text(), 'deleted attribute must disappear from the UI after the API refresh').not.to.include(key);
      });
    }
  }

  checkUtilityAttributes(tenant, building, utility, sibling) {
    const context = { tenantId: tenant.id, tenantNumber: tenant.tenant_number, buildingId: building.id, lease: tenant.lease, utility };
    const key = recordData('Attribute').name;
    this.open(utility.id, undefined, context);
    this.create(utility.id, key, 'Cancelled', { cancel: true, validateRequired: true });
    this.create(utility.id, key, 'Original', { validateRequired: true });
    this.open(utility.id, undefined, context);
    this.edit(key, 'Cancelled edit', { cancel: true });
    this.assertAttribute(utility.id, key, { attribute_value: 'Original' });
    this.edit(key, '0');
    this.open(utility.id, undefined, context);
    this.assertAttribute(utility.id, key, { attribute_value: '0' });
    this.open(sibling.id, key, { ...context, utility: sibling });
    this.assertAttribute(sibling.id, key, null);
  }
}
