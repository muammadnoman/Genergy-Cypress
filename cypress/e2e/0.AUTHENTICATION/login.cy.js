import { LoginPage } from '../../../pageObjects/LoginPage';
import { DashboardPage } from '../../../pageObjects/DashboardPage';

const login = new LoginPage();
const dashboard = new DashboardPage();

describe('Authentication', { tags: ['@auth', '@ui'] }, () => {
  beforeEach(() => login.visit());

  it('UM-AUTH-001 - Sign in with a valid active UM account', { tags: '@smoke' }, () => {
    login.signIn();
    login.assertAuthenticated();
    dashboard.assertLoaded();
  });

  it('UM-AUTH-002 - Reject an incorrect password', () => {
    login.signIn({ wrongPassword: true });
    login.assertRejected();
  });

  it('UM-AUTH-003 - Validate missing login fields', () => {
    login.assertRequiredFields();
  });

  it('UM-AUTH-004 - Protect a deep URL without a session', () => {
    login.assertProtectedRouteRequiresLogin();
  });

  it('UM-AUTH-005 - Redirect an authenticated user away from login', () => {
    login.signIn();
    login.assertAuthenticated();
    login.assertLoginRedirect();
  });

  it('UM-AUTH-011 - Remove access after logout', { tags: '@smoke' }, () => {
    login.signIn();
    login.assertAuthenticated();
    login.logout();
    login.assertProtectedRouteRequiresLogin(1);
  });
});
