import { AppPage } from './AppPage';

export class LettersPage extends AppPage {
  constructor(entityType = 'Portfolio') {
    super();
    if (!['Portfolio', 'Building', 'Tenant'].includes(entityType)) throw new Error('Only owned Portfolio, Building and Tenant contexts are supported.');
    this.entityType = entityType;
    this.entityKind = entityType.toLowerCase();
    this.panel = entityType === 'Tenant' ? '[role="region"][data-state="open"]:first' : '[role="tabpanel"][data-state="active"]';
  }

  openPreview(entityId, { buildingId } = {}) {
    if (this.entityType === 'Tenant' && !Number.isInteger(buildingId)) throw new Error('Tenant letters require their owning Building ID.');
    this.path = this.entityType === 'Tenant' ? `/building/${buildingId}/tenant/${entityId}` : `/${this.entityKind}/${entityId}`;
    cy.intercept('GET', `**/letterTemplate/emails/history/${this.entityKind}/${entityId}`).as('portfolioLetterHistory');
    cy.intercept('GET', `**/letterTemplate/templates?entity_type=${this.entityKind}`).as('portfolioLetterTemplates');
    // These cases verify validation/cancellation only. Any send is a test failure.
    cy.intercept('POST', '**/letterTemplate/emails/create', { statusCode: 400, body: { message: 'Unexpected send from validation/cancel test' } }).as('unexpectedLetterSend');
    super.open(this.path);
    if (this.entityType === 'Tenant') cy.contains('[role="tab"]', /^Letter$/).click();
    cy.wait('@portfolioLetterHistory').then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      expect(response.body.data).to.deep.eq([]);
    });
    cy.contains('button', /^\s*Send Letter\s*$/).should('be.visible').click();
    cy.get('[role="dialog"]').should('contain.text', 'Send New Letter');
    cy.contains('[role="dialog"] button', /^Send Email$/).click();
    cy.get('[role="dialog"]').should('contain.text', 'Template is required').and('contain.text', 'Recipient is required').and('contain.text', 'Subject is required').and('contain.text', 'Message is required');
    cy.wait('@portfolioLetterTemplates').then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      expect(response.body.data, `compatible ${this.entityType} template fixture`).to.be.an('array').and.not.be.empty;
      const template = response.body.data[0];
      expect(template.entity_type.toLowerCase()).to.eq(this.entityKind);
      cy.intercept('GET', `**/letterTemplate/templates/${template.id}`).as('portfolioTemplateDetail');
      cy.contains('[role="dialog"] button[role="combobox"]', /^Select Template$/).should('not.be.disabled').click();
      cy.contains('[role="option"]', new RegExp(`^${Cypress._.escapeRegExp(template.name)}$`)).click();
    });
    cy.wait('@portfolioTemplateDetail').then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      const template = response.body.data;
      this.field('Subject').should('have.value', template.subject_tpl);
      const expectedText = Cypress.$('<div>').html(template.message_tpl).text().replace(/\s+/g, ' ').trim();
      cy.get('[role="dialog"] .ql-editor').should(editor => {
        expect(editor.text().replace(/\s+/g, ' ').trim()).to.eq(expectedText);
      });
    });
  }

  validateRecipientsAndCancel(entityId) {
    cy.contains('[role="dialog"] button[role="combobox"]', /^Recipients$/).click();
    cy.contains('[role="option"]', /^Custom Address$/).click();
    for (const [value, message] of [
      ['', 'Recipients are required'],
      ['invalid-address', 'Recipients must be comma-separated in format: to:email, cc:email, bcc:email'],
      ['cc:auto@example.invalid', 'At least one "to:" recipient is required'],
    ]) {
      cy.get('[role="dialog"] input[placeholder="Enter email"]').clear();
      if (value) cy.get('[role="dialog"] input[placeholder="Enter email"]').type(value);
      cy.contains('[role="dialog"] button', /^Send Email$/).click();
      cy.get('[role="dialog"]').should('contain.text', message);
    }
    cy.get('[role="dialog"] input[placeholder="Enter email"]').clear().type('to:auto@example.invalid, cc:auto-cc@example.invalid, bcc:auto-bcc@example.invalid').blur();
    cy.get('[role="dialog"]').should('not.contain.text', 'Recipients are required')
      .and('not.contain.text', 'At least one "to:" recipient is required')
      .and('not.contain.text', 'Recipients must be comma-separated in format: to:email, cc:email, bcc:email');
    cy.contains('[role="dialog"] button', /^Cancel$/).click();
    cy.get('[role="dialog"]').should('not.exist');
    cy.get('@unexpectedLetterSend.all').should('have.length', 0);
    cy.intercept('GET', `**/letterTemplate/emails/history/${this.entityKind}/${entityId}`).as('cancelledLetterHistory');
    super.open(this.path);
    cy.contains('[role="tab"]', /^Letter(?:\s*0)?$/).click();
    cy.wait('@cancelledLetterHistory').then(({ response }) => {
      expect(response.statusCode).to.eq(200);
      expect(response.body.data).to.deep.eq([]);
    });
    cy.get(this.panel).should('contain.text', 'No results found.');
  }
}
