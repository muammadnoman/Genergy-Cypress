import { AppPage } from './AppPage';

export class LoginPage extends AppPage {
  visit() { this.open('/login'); }

  signIn({ wrongPassword = false, user } = {}) {
    return cy.task('auth:credentials', { user }, { log: false }).then(({ email, password }) => {
      cy.get('input[name="username"]').clear().type(email, { log: false, parseSpecialCharSequences: false });
      cy.get('input[name="password"]').clear().type(wrongPassword ? 'Intentionally-wrong-UMQA-password' : password, {
        log: false, parseSpecialCharSequences: false,
      });
      cy.contains('button', /^Login$/).click();
      if (!wrongPassword) cy.verifyToast('Login successful. Redirecting to dashboard...');
    });
  }

  assertAuthenticated() {
    cy.location('pathname').should('eq', '/dashboard');
    this.assertSignedIn();
  }

  assertRejected() {
    cy.verifyToast(/incorrect|not authorized|invalid.*password/i);
    cy.location('pathname').should('eq', '/login');
    cy.get('[data-sidebar="footer"] button[aria-haspopup="menu"]').should('not.exist');
  }

  assertRequiredFields() {
    cy.contains('button', /^Login$/).click();
    cy.contains('Email is required').should('be.visible');
    cy.contains('Password is required').should('be.visible');
    cy.task('auth:credentials', {}, { log: false }).then(({ email }) => {
      cy.get('input[name="username"]').type(email, { log: false });
      cy.contains('button', /^Login$/).click();
      cy.contains('Password is required').should('be.visible');
      cy.get('input[name="username"]').clear();
      cy.get('input[name="password"]').type('Validation-only-not-a-real-password', { log: false });
      cy.contains('button', /^Login$/).click();
      cy.contains('Email is required').should('be.visible');
    });
    cy.location('pathname').should('eq', '/login');
  }

  assertProtectedRouteRequiresLogin(buildingId) {
    if (buildingId === undefined) {
      return cy.task('db:query', { sql: 'SELECT id FROM core.building WHERE is_offline = 0 LIMIT 1' }, { log: false }).then(rows => {
        expect(rows).to.have.length(1);
        this.assertProtectedRouteRequiresLogin(rows[0].id);
      });
    }
    this.open(`/building/${buildingId}`);
    cy.location('pathname').should('eq', '/login');
    cy.contains('button', /^Login$/).should('be.visible');
    cy.get('table').should('not.exist');
  }

  assertLoginRedirect() {
    this.open('/login');
    this.assertAuthenticated();
  }

  token() {
    return cy.getAllLocalStorage({ log: false }).then(storage => {
      const local = storage['https://staging.um.genergy.com'] || {};
      const key = Object.keys(local).find(k => k.endsWith('.idToken'));
      if (!key || !local[key]) throw new Error('No UM Cognito ID token in authenticated session.');
      return local[key];
    });
  }

  useSession(user) {
    return cy.session(['um-staging', user ?? null], () => {
      this.visit();
      this.signIn({ user });
      this.assertAuthenticated();
    }, {
      cacheAcrossSpecs: true,
      validate: () => this.token().then(token => cy.task('auth:sessionValid', { token }, { log: false }).should('eq', true)),
    });
  }
}
