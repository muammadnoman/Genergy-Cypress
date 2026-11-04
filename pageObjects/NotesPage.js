import { AppPage } from './AppPage';
import { TenantPage } from './TenantPage';
import { recordData } from '../cypress/data/qaData';

export class NotesPage extends AppPage {
  constructor(entityType = 'Portfolio') {
    super();
    if (!['Portfolio', 'Building', 'Tenant', 'Lease', 'Lease Utility'].includes(entityType)) throw new Error('Unsupported owned Notes context.');
    this.entityType = entityType;
    this.entityKind = entityType.toLowerCase().replaceAll(' ', '_');
    this.panel = entityType === 'Lease Utility' ? '[data-side="right"]' : this.entityKind === 'tenant' ? '[role="region"][data-state="open"]:first' : '[role="tabpanel"][data-state="active"]';
    this.formScope = entityType === 'Lease Utility' ? '[data-side="right"] form' : '[role="dialog"]';
  }

  visitNumber = 0;
  ownershipFailure = false;

  content() {
    return cy.get(this.entityType === 'Lease' ? '@leaseNotesPanel' : this.panel);
  }

  open(entityId, expected = [], { buildingId, tenantId, lease, utility } = {}) {
    expected = expected.map(item => ({ ...item }));
    const alias = `${this.entityKind}Notes${++this.visitNumber}`;
    cy.intercept('GET', `**/notesTickets/notes/by-entity/${encodeURIComponent(this.entityType)}/${entityId}*`).as(alias);
    if (this.entityKind === 'tenant' && !Number.isInteger(buildingId)) throw new Error('Tenant notes require the owning Building ID.');
    if (['Lease', 'Lease Utility'].includes(this.entityType)) {
      if (!Number.isInteger(tenantId) || !Number.isInteger(buildingId) || !lease?.id || (this.entityType === 'Lease' ? lease.id !== entityId : utility?.id !== entityId || utility.lease_id !== lease.id)) throw new Error('Lease notes require the exact owned Tenant, Building and Lease context.');
      super.open(`/building/${buildingId}/tenant/${tenantId}`);
      const tenants = new TenantPage();
      tenants.leaseSection(lease).children('h3').find('button[aria-expanded]').then(trigger => {
        if (trigger.attr('aria-expanded') === 'false') cy.wrap(trigger).click();
      });
      if (this.entityType === 'Lease Utility') tenants.utilitySection(lease, utility).contains('button', /^View Notes$/).click();
      else {
        tenants.leaseSection(lease).contains('[role="tab"]', /^Notes & Tickets$/).click();
        tenants.leaseSection(lease).children('h3').find('button[aria-controls]').invoke('attr', 'aria-controls').then(id => {
          cy.get(`[id=${JSON.stringify(id)}]`).as('leaseNotesPanel');
        });
      }
    } else {
      super.open(this.entityKind === 'tenant' ? `/building/${buildingId}/tenant/${entityId}` : `/${this.entityKind}/${entityId}`);
      cy.contains('[role="tab"]', /^Notes & Tickets\s*\d*$/).click();
    }
    cy.get(`@${alias}.all`, { timeout: Cypress.config('responseTimeout') }).should(calls => {
      const completed = calls.filter(call => call.response);
      expect(completed, 'completed notes list').not.to.be.empty;
      const response = completed.at(-1).response;
      expect(response.statusCode).to.be.oneOf(expected.length ? [200] : [200, 404]);
      const notes = response.statusCode === 404 ? [] : response.body.data.notes;
      expect(notes).to.have.length(expected.length);
      for (const item of expected) {
        const saved = notes.find(note => note.body === item.body);
        expect(saved, item.body).to.exist;
        expect(saved.entity_type).to.eq(item.entityType || this.entityType);
        expect(Number(saved.entity_id)).to.eq(item.entityId || entityId);
        expect(saved.kind).to.eq(item.kind);
        if (item.status) expect(saved.status).to.eq(item.status);
        if (item.priority) expect(saved.priority).to.eq(item.priority);
      }
    });
    for (const item of expected) this.content().should('contain.text', item.body);
    if (!expected.length) this.content().should('contain.text', 'No data found');
  }

  create(parent, data, { validateRequired = false, reject = false, retry = false } = {}) {
    const scope = this.formScope;
    cy.task('fixtures:reserveNote', { entityKind: this.entityKind, entityNumber: parent[['Lease', 'Lease Utility'].includes(this.entityType) ? 'tenant_number' : this.entityKind + '_number'], entityId: parent.id, marker: data.name, kind: data.kind, retry }, { log: false });
    cy.intercept('GET', '**/userManagement/users').as('noteAssignees');
    const createAlias = `createdNote${++this.visitNumber}`;
    cy.intercept('POST', '**/notesTickets/notes', request => {
      if (request.body.entity_type !== this.entityType || Number(request.body.entity_id) !== parent.id) {
        this.ownershipFailure = true;
        request.reply({ statusCode: 400, body: { message: 'QA blocked note write: incorrect entity ownership' } });
      }
      else if (reject) request.reply({ statusCode: 500, body: { message: 'QA simulated create failure' } });
      else request.continue();
    }).as(createAlias);
    this.content().contains('button', /^Add (?:New )?Note$/).click();
    cy.contains(`${scope} label`, /^Title$/).should('not.exist');
    if (validateRequired) {
      cy.contains(`${scope} button`, /^Save$/).click();
      cy.get(scope).should('contain.text', 'Description is required');
      cy.get(`@${createAlias}.all`).should('have.length', 0);
      cy.task('db:query', { sql: 'SELECT id FROM core.note WHERE entity_type=? AND entity_id=? AND body=?', params: [this.entityType, parent.id, data.body] }, { log: false }).should('have.length', 0);
    }
    this.field('Note', scope).type(data.body);
    if (data.kind === 'ticket') {
      cy.get(`${scope} [role="switch"]`).click();
      if (validateRequired) {
        cy.contains(`${scope} button`, /^Save$/).click();
        cy.get(scope).should('contain.text', 'Ticket assignee is required').and('contain.text', 'Priority is required');
        cy.get(`@${createAlias}.all`).should('have.length', 0);
      }
      cy.task('auth:credentials', null, { log: false }).then(({ email }) => {
        cy.get('@noteAssignees.all', { timeout: Cypress.config('responseTimeout') }).should(calls => {
          const response = calls.findLast(call => call.response)?.response;
          expect(response?.statusCode).to.eq(200);
          expect(response.body.find(user => user.email === email), 'current QA account is assignable').to.exist;
        }).then(calls => {
          const user = calls.findLast(call => call.response).response.body.find(account => account.email === email);
          this.select('Assigned to', `${user.firstname} ${user.lastname}`, scope);
          if (validateRequired) {
            cy.contains(`${scope} button`, /^Save$/).click();
            cy.get(scope).should('contain.text', 'Priority is required');
            cy.get(`@${createAlias}.all`).should('have.length', 0);
          }
          cy.wrap(Number(user.userid), { log: false }).as('qaAssigneeId');
        });
      });
      this.select('Priority', 'High', scope);
    }
    const feedAlias = `createdNoteFeed${++this.visitNumber}`;
    cy.intercept('POST', '**/employee-feed/create').as(feedAlias);
    cy.contains(`${scope} button`, /^Save$/).click();
    cy.wait(`@${createAlias}`).then(({ request, response }) => {
      expect(request.body.entity_id, `${this.entityType} note must use selected entity ID ${parent.id}; incorrect ownership is blocked before the API`).to.eq(parent.id);
      expect(request.body).to.include({ entity_type: this.entityType, kind: data.kind, body: data.body });
      expect(response.statusCode).to.be.oneOf(reject ? [500] : [200, 201]);
      expect(request.body.tags).to.deep.eq([]);
      expect(request.body).not.to.have.property('title');
      cy.verifyToast(reject ? 'Failed to create note: QA simulated create failure' : response.body.message);
      if (data.kind === 'ticket') cy.get('@qaAssigneeId').then(id => expect(Number(request.body.assigned_to)).to.eq(id));
    });
    if (reject) cy.get(`@${feedAlias}.all`).should('have.length', 0);
    else cy.wait(`@${feedAlias}`).its('response.statusCode').should('be.oneOf', [200, 201]);
    cy.get(scope).should('not.exist');
    return cy.task('db:query', { sql: 'SELECT * FROM core.note WHERE entity_type=? AND entity_id=? AND body=?', params: [this.entityType, parent.id, data.body] }, { log: false }).then(rows => {
      expect(rows).to.have.length(reject ? 0 : 1);
      if (!reject) {
        expect(rows[0].kind).to.eq(data.kind);
        expect(Number(rows[0].is_active)).to.eq(1);
      }
      return rows[0] || null;
    });
  }

  edit(data, { cancel = false, reject = false } = {}) {
    const scope = this.formScope;
    // The pencil is the clickable sibling of the text container in TicketCard.
    this.content().contains('p', data.body).parent().next('div.cursor-pointer').click();
    this.field('Note', scope).should('have.value', data.body).clear().type(`${data.name} Updated`);
    cy.get(`${scope} [role="switch"]`).should('be.disabled');
    if (data.kind === 'ticket') {
      this.select('Priority', 'Low', scope);
      this.select('Status', 'Closed', scope);
    }
    if (cancel) {
      cy.contains(`${scope} button`, /^Cancel$/).click();
    } else {
      cy.intercept('PUT', `**/notesTickets/notes/${data.id}/update`, request => {
        if (request.body.entity_type !== this.entityType || Number(request.body.entity_id) !== data.entityId) {
          this.ownershipFailure = true;
          request.reply({ statusCode: 400, body: { message: 'QA blocked note write: incorrect entity ownership' } });
        }
        else if (reject) request.reply({ statusCode: 500, body: { message: 'QA simulated update failure' } });
        else request.continue();
      }).as('updatePortfolioNote');
      const feedAlias = `updatedNoteFeed${++this.visitNumber}`;
      cy.intercept('POST', '**/employee-feed/create').as(feedAlias);
      cy.contains(`${scope} button`, /^Update$/).click();
      cy.wait('@updatePortfolioNote').then(({ request, response }) => {
        expect(request.body.kind).to.eq(data.kind);
        expect(request.body.entity_type).to.eq(this.entityType);
        expect(Number(request.body.entity_id)).to.eq(data.entityId);
        expect(response.statusCode).to.eq(reject ? 500 : 200);
        expect(request.body.body).to.eq(`${data.name} Updated`);
        cy.verifyToast(reject ? 'Failed to update note: QA simulated update failure' : response.body.message);
      });
      if (reject) cy.get(`@${feedAlias}.all`).should('have.length', 0);
      else cy.wait(`@${feedAlias}`).its('response.statusCode').should('be.oneOf', [200, 201]);
    }
    cy.get(scope).should('not.exist');
    cy.task('db:query', { sql: 'SELECT * FROM core.note WHERE id=?', params: [data.id] }, { log: false }).then(rows => {
      expect(rows).to.have.length(1);
      expect(rows[0].body).to.eq(cancel || reject ? data.body : `${data.name} Updated`);
      expect(rows[0].kind).to.eq(data.kind);
      expect(rows[0].entity_type).to.eq(this.entityType);
      expect(Number(rows[0].entity_id)).to.eq(data.entityId);
      if (!cancel && !reject && data.kind === 'ticket') expect(rows[0]).to.include({ status: 'closed', priority: 'low' });
      if (reject && data.kind === 'ticket') expect(rows[0]).to.include({ status: data.status || 'open', priority: data.priority || 'high' });
    });
  }

  filter(entityId, note, ticket) {
    const panel = this.panel;
    const search = panel + ' input[placeholder="Search"]';
    cy.get(search).type(note.body.toUpperCase());
    cy.contains(panel + ' p', note.body).should('be.visible');
    cy.contains(panel + ' p', ticket.body).should('not.exist');
    cy.get(search).clear().type(note.body + '_NO_MATCH');
    cy.get(panel).should('contain.text', 'No data found');
    cy.get(search).clear();

    for (const [current, selection, kind, expected] of [
      ['View All', 'View Tickets', 'ticket', [ticket]],
      ['View Tickets', 'View Notes', 'note', [note]],
      ['View Notes', 'View All', 'all', [note, ticket]],
    ]) {
      cy.contains(panel + ' button[role="combobox"]', new RegExp('^' + current + '$')).click();
      cy.contains('[role="option"]', new RegExp('^' + selection + '$')).click();
      const alias = 'appliedPortfolioNotes_' + kind;
      const url = '**/notesTickets/notes/by-entity/' + this.entityType + '/' + entityId + (kind === 'all' ? '' : '?kind=' + kind);
      cy.intercept('GET', url).as(alias);
      cy.contains(panel + ' button', /^\s*View\s*$/).click();
      cy.wait('@' + alias).then(({ request, response }) => {
        expect(new URL(request.url).searchParams.get('kind')).to.eq(kind === 'all' ? null : kind);
        expect(response.statusCode).to.eq(200);
        const rows = response.body.data.notes;
        expect(rows.map(row => row.body).sort()).to.deep.eq(expected.map(row => row.body).sort());
        for (const row of rows) {
          expect(row.entity_type).to.eq(this.entityType);
          expect(Number(row.entity_id)).to.eq(entityId);
          expect(row.kind).to.eq(expected.find(item => item.body === row.body).kind);
        }
      });
      for (const item of [note, ticket]) {
        cy.contains(panel + ' p', item.body).should(expected.includes(item) ? 'be.visible' : 'not.exist');
      }
    }
  }

  delete(data, { reject = false } = {}) {
    this.content().contains('p', data.body).parent().next('div.cursor-pointer').click();
    cy.intercept('PUT', `**/notesTickets/notes/${data.id}/delete`, request => {
      if (reject) request.reply({ statusCode: 500, body: { message: 'QA simulated delete failure' } });
      else request.continue();
    }).as('deletePortfolioNote');
    const feedAlias = `deletedNoteFeed${++this.visitNumber}`;
    cy.intercept('POST', '**/employee-feed/create').as(feedAlias);
    cy.contains('[role="dialog"] button', /^Delete$/).click();
    cy.wait('@deletePortfolioNote').then(({ response }) => {
      expect(response.statusCode).to.eq(reject ? 500 : 200);
      cy.verifyToast(reject ? 'Failed to delete note: QA simulated delete failure' : response.body.message);
    });
    if (reject) {
      cy.get(`@${feedAlias}.all`).should('have.length', 0);
      cy.get('[role="dialog"]').should('be.visible');
      this.field('Note').should('have.value', data.body);
      cy.contains('[role="dialog"] button', /^Cancel$/).click();
    } else cy.wait(`@${feedAlias}`).its('response.statusCode').should('be.oneOf', [200, 201]);
    cy.get('[role="dialog"]').should('not.exist');
    this.content().contains('p', data.body).should(reject ? 'be.visible' : 'not.exist');
    cy.task('db:query', { sql: 'SELECT is_active FROM core.note WHERE id=?', params: [data.id] }, { log: false }).then(rows => {
      expect(rows).to.have.length(1);
      expect(Number(rows[0].is_active)).to.eq(reject ? 1 : 0);
    });
  }

  checkUtilityNotes(tenant, building, utility, sibling, { isolation = false } = {}) {
    const context = { buildingId: building.id, tenantId: tenant.id, lease: tenant.lease, utility };
    const parent = { id: utility.id, tenant_number: tenant.tenant_number };
    const expected = utility.notes ||= [];
    const siblingExpected = sibling.notes ||= [];
    let added;
    for (const kind of isolation ? ['note'] : ['note', 'ticket']) {
      const data = { ...recordData(kind === 'note' ? 'Note' : 'Ticket'), kind, entityId: utility.id };
      data.body = data.name;
      cy.then(() => {
        this.open(utility.id, expected, context);
        this.create(parent, data).then(saved => {
          data.id = saved.id;
          expected.push(data);
          added = data;
          if (!isolation) {
            this.edit(data, { cancel: true });
            this.edit(data);
          }
          cy.then(() => {
            if (!isolation) { data.body = `${data.name} Updated`; if (kind === 'ticket') { data.priority = 'low'; data.status = 'closed'; } }
            this.open(utility.id, expected, context);
          });
        });
      });
    }
    cy.then(() => {
      this.open(sibling.id, siblingExpected, { ...context, utility: sibling });
      for (const item of expected) this.content().should('not.contain.text', item.body);
      if (isolation) {
        const data = { ...recordData('Note'), kind: 'note', entityId: sibling.id };
        data.body = data.name;
        this.create({ ...parent, id: sibling.id }, data).then(() => {
          siblingExpected.push(data);
          this.open(sibling.id, siblingExpected, { ...context, utility: sibling });
          this.open(utility.id, expected, context);
          this.content().should('not.contain.text', data.body);
          cy.task('db:query', { sql: 'SELECT entity_type,entity_id,body FROM core.note WHERE entity_id IN (?,?) AND body IN (?,?)', params: [utility.id, sibling.id, added.body, data.body] }, { log: false }).then(rows => {
            expect(rows).to.have.length(2);
            expect(rows.find(row => row.body === data.body)).to.include({ entity_type: 'Lease Utility', entity_id: sibling.id });
            expect(rows.find(row => row.body === added.body)).to.include({ entity_type: 'Lease Utility', entity_id: utility.id });
          });
        });
      }
    });
  }

  checkUtilitySidebar(tenant, building, utility, sibling) {
    const context = { buildingId: building.id, tenantId: tenant.id, lease: tenant.lease, utility };
    this.open(utility.id, utility.notes || [], context);
    cy.get('[role="dialog"][aria-modal="true"]').should('not.exist');
    cy.contains('[role="tab"]', /^Tenant Info$/).click();
    this.content().should('be.visible');
    cy.contains('a', new RegExp(`^${Cypress._.escapeRegExp(building.name)}$`)).click();
    cy.location('pathname').should('eq', `/building/${building.id}`);
    cy.get('[data-side="right"]').should('not.exist');
    this.open(sibling.id, sibling.notes || [], { ...context, utility: sibling });
    this.content().contains('button', /^Close$/).click();
    cy.get('[data-side="right"]').should('not.exist');
    cy.task('db:query', { sql: "SELECT id FROM core.note WHERE entity_type='Lease Utility' AND entity_id IN (?,?)", params: [utility.id, sibling.id] }, { log: false }).should('have.length', (utility.notes || []).length + (sibling.notes || []).length);
  }
}
