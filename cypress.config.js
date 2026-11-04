const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env.local'), quiet: true });
const { defineConfig } = require('cypress');
const { beforeRunHook, afterRunHook } = require('cypress-mochawesome-reporter/lib');
const dbConfig = require('./cypress/config/dbConfig.cjs');
const { Database, assertOwnership } = require('./cypress/tasks/database.cjs');
const { apiToken } = require('./cypress/tasks/auth.cjs');
const { request } = require('./cypress/tasks/http.cjs');

module.exports = defineConfig({
  viewportWidth: 1440,
  viewportHeight: 1000,
  video: false,
  screenshotOnRunFailure: true,
  reporter: 'cypress-mochawesome-reporter',
  reporterOptions: {
    charts: true,
    reportPageTitle: 'Genergy UM Staging Report',
    embeddedScreenshots: true,
    inlineAssets: true,
    saveAllAttempts: false,
    reportDir: 'cypress/reports/html',
    reportFilename: 'Genergy-[datetime]',
    overwrite: false,
    html: true,
    json: true,
  },
  expose: { environment: 'staging', apiUrl: 'https://staging-api.genergy.com', grepFilterSpecs: true, ...(process.env.GREP_TAGS ? { grepTags: process.env.GREP_TAGS } : {}) },
  e2e: {
    baseUrl: 'https://staging.um.genergy.com',
    specPattern: 'cypress/e2e/**/*.cy.js',
    supportFile: 'cypress/support/e2e.js',
    testIsolation: true,
    defaultCommandTimeout: 60000,
    pageLoadTimeout: 120000,
    requestTimeout: 60000,
    responseTimeout: 120000,
    taskTimeout: 240000,
    execTimeout: 120000,
    retries: { runMode: 0, openMode: 0 },
    async setupNodeEvents(on, config) {
      if (config.baseUrl !== 'https://staging.um.genergy.com') throw new Error('Only Genergy staging is supported.');
      const db = new Database(dbConfig(), __dirname);
      await db.health();
      const run = await db.start();
      config.expose = { ...config.expose, run };
      on('task', {
        'auth:credentials'() {
          const email = process.env.UM_EMAIL;
          const password = process.env.UM_PASSWORD;
          if (!email || !password) throw new Error('Set UM_EMAIL and UM_PASSWORD in private config.');
          return { email, password };
        },
        'auth:apiLogin': async () => { await apiToken(config.requestTimeout); return { authenticated: true }; },
        'auth:sessionValid': async ({ token }) => {
          try {
            const response = await request('https://staging-api.genergy.com/associated/utility_id_names', {
              timeout: config.responseTimeout,
              headers: { Authorization: token, origin: 'https://localhost:4200' },
            });
            return response.status === 200;
          } catch { return false; }
        },
        'api:request': async ({ method, path: route, body, encoding, timeout = config.responseTimeout }) => {
          const url = new URL(route, 'https://staging-api.genergy.com');
          if (url.origin !== 'https://staging-api.genergy.com') throw new Error('Only staging API is allowed.');
          if (method !== 'GET') {
            if (body) {
              const fixture = db.run.fixtures.find(x => x.kind === 'portfolio' && x.number === body.portfolio_number);
              if (!fixture) throw new Error('Mutation must preserve a registered fixture number.');
              assertOwnership({ portfolio_number: body.portfolio_number, name: body.name }, fixture, db.run.prefix);
            }
            if (method === 'POST' && route === '/portfolios/create') {
              if (!db.run.fixtures.some(x => x.kind === 'portfolio' && x.number === body.portfolio_number)) throw new Error('Reserve this portfolio before creating it.');
            } else if (method === 'PUT' && /^\/portfolios\/(update|delete)\/\d+$/.test(route)) {
              const id = Number(route.split('/').at(-1));
              const matches = await db.read({ sql: 'SELECT portfolio_number FROM core.portfolio WHERE id = ?', params: [id] });
              if (!matches.length || !db.run.fixtures.some(x => x.kind === 'portfolio' && x.number === matches[0].portfolio_number)) throw new Error('Cannot mutate an unregistered portfolio.');
              if (body && body.portfolio_number !== matches[0].portfolio_number) throw new Error('Changing fixture identity is not supported.');
            } else throw new Error('Add explicit fixture ownership and cleanup support before this API mutation.');
          }
          const token = await apiToken(config.requestTimeout);
          let requestBody = body;
          if (encoding === 'form') {
            requestBody = new FormData();
            for (const [key, value] of Object.entries(body)) requestBody.append(key, String(value));
          }
          return request(url, {
            method,
            timeout,
            headers: { Authorization: token, origin: 'https://localhost:4200', ...(body === undefined || encoding === 'form' ? {} : { 'content-type': 'application/json' }) },
            ...(body === undefined ? {} : { body: requestBody }),
          });
        },
        'db:health': () => db.health(),
        'db:query': query => db.read(query),
        'db:portfolio': number => db.lookup('portfolio', number),
        'db:building': number => db.lookup('building', number),
        'fixtures:run': () => ({ id: db.run.id, prefix: db.run.prefix }),
        'fixtures:reserve': fixture => db.reserve(fixture),
        'fixtures:reserveLease': fixture => db.reserveLease(fixture),
        'fixtures:reserveMeter': fixture => db.reserveMeter(fixture),
        'fixtures:reserveLeaseChild': fixture => db.reserveLeaseChild(fixture),
        'fixtures:reserveNote': fixture => db.reserveNote(fixture),
        'fixtures:cleanup': () => db.cleanup(),
      });
      require('cypress-mochawesome-reporter/plugin')(on);
      on('before:run', details => beforeRunHook(details));
      on('after:run', async () => {
        try { await db.cleanup(); }
        finally {
          try { await afterRunHook(); }
          finally { await db.close(); }
        }
      });
      const { plugin } = require('@cypress/grep/plugin');
      plugin(config);
      return config;
    },
  },
});
