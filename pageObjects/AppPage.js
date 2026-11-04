export class AppPage {
  open(path) {
    cy.visit(path);
  }

  field(label, scope = '[role="dialog"]') {
    const exact = new RegExp(`^${Cypress._.escapeRegExp(label)}$`);
    return cy.contains(`${scope} label`, exact).invoke('attr', 'for').then(id => {
      expect(id, `${label} control ID`).to.be.a('string').and.not.be.empty;
      return cy.get(`[id=${JSON.stringify(id)}]`);
    });
  }

  select(label, option, scope = '[role="dialog"]') {
    const exact = new RegExp(`^${Cypress._.escapeRegExp(option)}$`);
    this.field(label, scope).should('have.attr', 'role', 'combobox')
      .and('not.be.disabled').click();
    this.field(label, scope).should('have.attr', 'aria-expanded', 'true');
    cy.contains('[role="option"]', exact).should('be.visible').click();
    this.field(label, scope).should('contain.text', option).and('have.attr', 'aria-expanded', 'false');
  }

  closeDialog() {
    cy.get('[role="dialog"]').contains('button', 'Close').click();
    cy.get('[role="dialog"]').should('not.exist');
  }

  setDate(label, value, scope = '[role="dialog"]') {
    cy.contains(`${scope} label`, new RegExp(`^${Cypress._.escapeRegExp(label)}$`)).parent()
      .find('button[aria-haspopup="dialog"]').then(trigger => {
        const displayed = trigger.text().trim();
        if (displayed === (value || 'Pick a date')) return;
        cy.wrap(trigger).click();
        cy.get('.rdp:visible').as('dateCalendar');
        if (value === null) {
          cy.get('@dateCalendar').find('button[aria-selected="true"]').click();
          return;
        }
        const current = /^\d{4}-\d{2}-\d{2}$/.test(displayed) ? new Date(`${displayed}T12:00:00`) : new Date();
        const [year, month, day] = value.split('-').map(Number);
        const months = (year - current.getFullYear()) * 12 + month - current.getMonth() - 1;
        for (let step = 0; step < Math.abs(months); step++) cy.get('@dateCalendar')
          .find(`button[name="${months < 0 ? 'previous-month' : 'next-month'}"]`).click();
        cy.get('@dateCalendar').contains('button:not(.day-outside)', new RegExp(`^${day}$`)).click();
      });
  }

  assertSignedIn() {
    cy.get('[data-sidebar="footer"] button[aria-haspopup="menu"]')
      .should('be.visible')
      .and('not.contain.text', 'undefined')
      .invoke('text').should('match', /\S/);
  }

  logout() {
    cy.get('[data-sidebar="footer"] button[aria-haspopup="menu"]').click();
    cy.contains('[role="menuitem"]', /^Logout$/).should('be.visible').click();
    cy.location('pathname').should('eq', '/login');
    cy.get('input[name="username"]').should('be.visible');
  }
}
