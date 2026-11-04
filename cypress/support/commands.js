Cypress.Commands.add('verifyToast', message => {
  expect(message, 'expected toast message').to.satisfy(value =>
    (typeof value === 'string' && value.trim().length > 0) || value instanceof RegExp
  );
  return cy.contains('[data-sonner-toast] [data-title]', message).should('be.visible');
});
