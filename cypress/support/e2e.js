import { register } from '@cypress/grep';
import 'cypress-mochawesome-reporter/register';
import './commands';

register();

function prepareTestContext() {
  cy.task('fixtures:run', null, { log: false }).then(run => {
    Cypress.expose('run', run);
  });
  cy.intercept({ method: 'GET', hostname: 'staging.um.genergy.com', resourceType: 'document' }, request => {
    request.continue(response => {
      if (typeof response.body !== 'string' || !response.headers['content-type']?.includes('text/html')) return;
      // Execute Cypress's bootstrap, then remove only our two test scripts before React hydrates.
      // https://github.com/cypress-io/cypress/pull/33295
      response.body = response.body.replace(/<head\b[^>]*>/i, '$&<script data-cy-bootstrap></script><script>document.querySelector("script[data-cy-bootstrap]").remove();document.currentScript.remove();</script>');
    });
  });
}

before(prepareTestContext);
beforeEach(prepareTestContext);

after(() => {
  cy.task('fixtures:cleanup', null, { log: false });
});
