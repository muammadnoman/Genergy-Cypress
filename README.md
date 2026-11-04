# Genergy Utility Manager automation

JavaScript Cypress project for `https://staging.um.genergy.com/login`. Selectors, UI actions and UI assertions live in page classes. Specs are grouped by module and use the test-case sheet IDs.

## Run locally

Agents implement and fix code without starting test runs by default. The user runs cases and shares results; automated execution requires an explicit user request. The commands below are for the user's own execution.

Use Node 22.13 or newer. Run `npm ci`, then `npm run db:check`. Private `.env.local` has been configured on this PC using the Genergy staging connector and Noman's supplied QA login; it is ignored by Git. `.env.example` documents the keys for another machine. Never copy passwords or tokens into specs, reports or Git.

```sh
npm run lint
npm run test:unit
npm run test:smoke
npm run test:auth
npm run test:portfolio
npm run test:building
npm run test:api
npm run open
```

Filter any run with `npm test -- --expose grepTags=@portfolio` or combine supported grep tags. The default run uses Chrome. Mochawesome HTML/JSON reports are written under `cypress/reports/html` with failure screenshots embedded.

API tasks authenticate privately through staging Cognito and send the raw ID token in `Authorization` plus lowercase `origin: https://localhost:4200`. Preserve that casing: staging currently returns 502 for `Origin`. JSON bodies receive content-type only when present; portfolio update uses multipart form data as specified in the collection. Credentials and request headers stay in Node rather than Cypress request logs.

Spec folders use uppercase names: `0.AUTHENTICATION`, `1.DASHBOARD`, `2.PORTFOLIO`, `3.BUILDING`, and `4.TENANT`. Authentication comes first as setup; implemented UI modules follow the application menu order. `API_TESTS` groups API-only specs separately from the numbered UI modules. Folder numbering controls display order; each test still establishes its own session and data.

`cypress/API_CLIENTS/UtilityManagerApiClient.js` is the shared Utility Manager API client used by UI and API specs. It delegates authentication and HTTP requests to Node tasks, checks allowed response statuses, loads billing templates, creates registered Portfolio fixtures with DB verification, and validates reference-data responses. API test cases themselves live in `cypress/e2e/API_TESTS/`.

API-only specs, including Dashboard, live in `cypress/e2e/API_TESTS/`. Default waits are centralized in `cypress.config.js`: UI commands 60 seconds, page loads 120 seconds, request start 60 seconds, responses 120 seconds, Node tasks 240 seconds and shell commands 120 seconds. The shared API client uses responseTimeout for HTTP deadlines and taskTimeout for Node tasks; API authentication uses requestTimeout. These are maximum wait budgets, not fixed delays. Assertions and HTTP success requirements still apply. The application can still cancel its own requests earlier; Cypress timeouts do not change application or server timeouts.

The shared support hook handles the Cypress/React hydration mismatch for staging document navigations. It executes Cypress's bootstrap through its supported placeholder, then removes only the two test-injected script tags before React hydrates. Scripts, styles, images and API requests are excluded. Application exceptions still fail tests. All six Authentication tests passed in fresh Chrome on 18 October 2026 after this change (`cypress/reports/html/Genergy-2026-10-18T163926+0500.html`). Restart Cypress Open before your rerun to load the updated support hook.

## Database and cleanup

DB credentials remain in Node. The configured host is pinned to the verified staging connector's host fingerprint; another host/schema is rejected. `cy.task('db:query', { sql, params })` permits read-only parameterized SELECT. Named tasks provide portfolio/building lookups.

Faker and `recordData(type)` create names such as `Auto_Portfolio_<run>_<company>`, `Auto_Building_<run>_<company>` and `Auto_Tenant_<run>_<company>`. Number fields use `Auto_<run>_<random>` so they fit the 25-character database limit. All future record types must follow the same naming convention and add their ownership/dependency cleanup before writes are enabled. Tests reserve every identity **before** writing through UI/API. Reservations are stored in ignored `.qa-runs/<run>.json`. After all cases in each spec, and again after the run as a fallback, transactional cleanup checks exact reserved numbers, run markers, creation time and parent/child ownership before deleting records, their attributes, assignments and feed entries. Unexpected accounts, meters, tenants, periods or notes cause a rollback and a visible failure. No shared records, broad prefix scans or disabled FK checks are allowed.

Before each test, `fixtures:run` refreshes the browser's fixture context from the active Node run. The factory rejects malformed run IDs/prefixes rather than generating unsafe records. This prevents stale browser exposure after a configuration reload from supplying another run's prefix; reservation and cleanup ownership checks remain strict.

If a process is killed, recover its registered leftovers with:

```sh
npm run cleanup -- --run <12-character-run-id>
```

Finish with `npm run cleanup:all` (equivalent to `npm run cleanup -- --all`) only after all Cypress tests have stopped. Do not run this sweep alongside Cypress Open tests or another execution: it processes all local ledgers and can physically remove an active test's fixtures before soft-delete assertions finish. During execution, spec-end after/after:run already clean only that run's registered fixtures. The final sweep processes this project's local ledgers, including earlier UMQA runs, checks that every registered record is absent, and prints deleted/remaining/failed totals. A failure in one ledger is reported while other ledgers are still attempted. Do not delete ledgers until cleanup has succeeded. New modules must add explicit ownership/dependency support before introducing their records.

UI soft deletion is verified only in UM-PORT-008 for Portfolio and UM-BLDG-001 for Building. Creation, update, logo, validation and Dashboard cases leave their owned fixtures for DB cleanup; setup parents are not deleted through UI. Cancel-delete coverage only verifies cancellation. API-delete cases retain endpoint assertions. The shared root after hook physically removes all registered records after the spec finishes, including failures, with child-before-parent ownership and dependency checks. The after:run hook retries cleanup as a fallback. Authentication uses the shared cleanup hook but creates no fixtures. The known Portfolio list/selector defect remains visible in UM-PORT-008 for PM discussion.

Portfolio now also has `portfolio-options.cy.js`, `portfolio-notes.cy.js` and `portfolio-letters.cy.js`. These seven additional cases cover custom attributes, notes/tickets and letter preview/recipient validation/cancellation. They use owned Portfolio fixtures and shared spec-end DB cleanup. UI deletion is exercised once for attributes (UM-OPT-001) and notes (UM-NOTE-023); setup portfolios are never UI-deleted by these cases. API create/update specs use DB cleanup and do not require UI login for teardown.

Before writing a note or ticket, `fixtures:reserveNote` records its exact Auto_Note/Auto_Ticket marker and kind under its already registered Portfolio or Building in the durable run ledger. Cleanup checks every note against this reservation, owning parent and creation time, deletes note/tag links and Note/Ticket feed entries, then removes the notes before their parent. Shared tags are preserved; unknown notes cause a rollback. New cleanup safety checks were added but have not been executed.

The Portfolio module is not yet complete: Threshold Save/Delete handlers in the reviewed frontend do not persist changes; the 50-character portfolio-number UI limit exceeds the DB's 25-character column; broader notes tag/assignee/date/hierarchy matrices remain pending. The user excluded mailbox delivery verification because staging does not send email. Letter submission/history creation, attachments and context-placeholder resolution are not claimed by the validation/cancel case. All new cases are awaiting the user's execution.

Building's `cypress/e2e/3.BUILDING/building-segments.cy.js` adds four cases: Building note roll-up to its Portfolio (UM-NOTE-005), notes/tickets persistence and edits (UM-NOTE-012), custom attribute validation/lifecycle/isolation (UM-OPT-002), and letter preview/validation/cancellation (UM-LTR-002). On 24 October the user reported the three Notes/Letters cases passed; UM-OPT-002 fails because the deleted last attribute remains in the UI after the valid empty-list 404. Threshold persistence and the remaining hierarchy/letter variants are not claimed.

Added 24 October, not executed: UM-BLDG-008 in `building-management.cy.js` checks two owned empty Buildings, API/DB identities, zero badges, tab empty states, Bill Period headers/disabled edit, and Tenant/Note/Meter shortcut context. Populated rows, Tenant/Meter creation and per-utility billing data remain pending. UM-NOTE-024 in `portfolio-notes.cy.js` reuses NotesPage for note/ticket create/update/delete HTTP 500 failures, error toasts, no success feed, DB/timeline preservation and create/update retry. Positive UI deletion stays in UM-NOTE-023. Other error statuses, duplicate clicks and other entity types remain pending. Failed delete may expose the application's unhandled rejected promise; it is not suppressed. Both new cases remain In Progress / Not Run in the tracker. All records use existing owned registration and spec-end DB cleanup; create retry is allowed only for an already-reserved marker/kind with no existing DB note.

`NotesPage`, `OptionsPage` and `LettersPage` reuse the same UI implementation for Portfolio and Building. Their default context remains Portfolio; Building specs pass `Building` explicitly. Notes/tickets are reserved under the exact owning Portfolio or Building before writes. Owned children are cleaned before their parents at spec end. UM-PORT-008 is a confirmed application failure and is unchanged.

Tenant cases are in `cypress/e2e/4.TENANT/tenant-management.cy.js`. On 24 October the user reported UM-TEN-001/005 failed because the backend drops the supplied initial lease end date during Tenant creation; UM-TEN-002/003/004/006/014 and UM-NOTE-013 passed for their implemented scope. No agent test execution was performed. Assigned-utility propagation in UM-TEN-006 and adjacent-context coverage in UM-NOTE-013 remain partial.

Added next, not executed: UM-TEN-015 creates a second lease, checks required fields and saved values, cancels an edit, then saves changes while verifying the sibling. UM-TEN-018 checks cancellation and soft deletion of one empty lease, including API/DB/UI exclusion and sibling preservation; utility and dependent deletion policies remain pending. UM-LTR-003 reuses LettersPage for Tenant template loading, required fields, recipient validation, cancellation and empty history. Delivery remains skipped as requested; sent history, attachments and resolved placeholders are not claimed. These three new mappings are In Progress / Not Run. TenantPage holds lease UI logic, and existing edit/reload methods are reused.

Before Tenant creation, the ledger records the exact owned Building and initial Auto_Lease location marker. Each additional lease is registered under its existing owned Tenant before creation. Cleanup validates the entire graph and timestamps before any deletion, rejects unregistered or duplicate lease markers, mismatched parents, utility/attribute/PDF dependencies, and removes owned notes, leases, Tenant, Building and Portfolio in order at spec end. New safety checks were written but not executed. No standalone cleanup helper or frontend changes were introduced.

Added in the larger 24 October batch: `tenant-utilities.cy.js` maps UM-TEN-008/009/016 to lease-utility settings, percentage validation, compatible rates, dependent selection reset and cancellation. `tenant-lease-segments.cy.js` maps UM-NOTE-014 and UM-OPT-003 to Lease notes/tickets and custom attributes with sibling isolation. `notes-validation.cy.js` maps UM-NOTE-001/002/003 to shared Portfolio form validation; their catalog Meter context remains pending. All eight new cases are In Progress / Not Run. Syntax and ESLint checks passed; Cypress and cleanup safety tests were not executed for this batch. Populated utility accounts, meter dependencies, thresholds and broader context matrices remain pending.

The user confirmed UM-TEN-015, UM-TEN-018, UM-NOTE-013 and UM-LTR-003 passed in the supplied screenshot. This supersedes the earlier Not Run entries for their implemented scope; partial-case limitations remain in the tracker. Known application failures UM-PORT-008, UM-OPT-002, UM-TEN-001 and UM-TEN-005 remain visible.

Lease children use exact registration before writes: utility pairs use owned Lease ID plus utility ID, attributes use owned Lease ID plus a run-marked key, and notes use owned Lease ID plus a run-marked body and kind. Cleanup validates all owned parents, child creation times and unexpected meter/billing dependencies before any DELETE; registered children are removed before their Lease. New refusal/ordering safety checks were written but not executed. Reopening a lease utility checks its saved rate; a potential frontend rate reset on edit is retained as an assertion rather than bypassed.

## GitHub Actions

`.github/workflows/main.yml` follows the ChargeAutomation manual Chrome/Mochawesome pattern. It installs dependencies, lints, runs cleanup safety checks, verifies DB access, filters by input tags, runs Chrome and uploads reports/recovery ledgers. Cleanup also runs after failures. No schedule or automatic push trigger is enabled.

Configure `UM_EMAIL`, `UM_PASSWORD`, `GENERGY_STAGING_DB_HOST`, `GENERGY_STAGING_DB_PORT`, `GENERGY_STAGING_DB_USER` and `GENERGY_STAGING_DB_PASSWORD` as repository/environment secrets. The runner needs network access to staging MySQL; use a suitable runner/network route if GitHub-hosted runners cannot reach it. The checked-in host fingerprint must match staging. Use a CA file if the DB requires one; never disable verification merely to hide an unexpected certificate.

Email delivery is opt-in at dispatch. Configure `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD` and `GENERGY_REPORT_TO` for the Genergy recipient; no ChargeAutomation or Waqas email/account is carried over.

## Coverage

Lease Utility segment setup now creates one owned Portfolio/Building/Tenant/Lease and both Utilities in the spec's `before` hook. Login remains in `beforeEach`; JavaScript fixture references survive Cypress's per-test alias reset. The shared support bootstrap runs in both root `before` and `beforeEach`, so UI setup has the existing document hydration handling and synchronized run context. Guarded cleanup remains once after the spec. Note expectations are retained per Utility; each test adds uniquely registered markers and verifies the accumulated saved records instead of assuming every shared fixture stays empty. Creation/deletion scenarios in other specs still use isolated fixtures when their required initial state differs.

UM-NOTE-015 is a confirmed frontend null-owner failure, not an automation selector issue. Its first incorrect owner assertion remains failed and the bad write is blocked before staging. Subsequent dependent note-write tests dynamically skip after this specific failure; they are blocked/pending, never counted as passed. Independent sidebar and attribute cases continue. The flag resets with the spec's NotesPage instance on a new run; corrected application behavior still executes all utility variants. The sheet records UM-NOTE-015 Failed (Electric evidence; Cold Water not independently verified) and UM-NOTE-004 Blocked. These setup changes passed static syntax/ESLint checks only.

Electric and Cold Water are the current supported utility matrix, shared in `cypress/data/qaData.js`. Utility-dependent cases must cover both; future utilities are added only when introduced. Tenant utility cases UM-TEN-008/009/016 each run once per utility, with switching in both directions and owned Buildings in New York City, where active rates for both were confirmed by read-only inspection on 25 October. These six variants and the expanded utility reference-data assertion require a fresh staging run. Utility-neutral cases are not duplicated; Portfolio meter-count checks already cover both. The catalog adds the matrix requirement to 274 relevant cases without claiming they are all automated. Full per-utility completion remains tracked separately from historical single-utility results.

The implementation contains 109 test variants mapped to 87 unique catalog IDs: 94 UI variants and 15 API tests. `docs/` contains the reviewed 793-case catalog and request coverage for all 195 Postman entries. Many implemented checks cover only part of a catalog case; `docs/automation-coverage.json` records the scope, execution evidence and remaining gaps. API mutations beyond the implemented owned fixtures are not bulk-run.

On 25 October the user confirmed tenant-utilities (all six variants), reference-data, tenant-lease-segments and notes-validation passed. The sheet and local catalogs record user-reported Passed evidence for their 13 mapped IDs; partial scope remains In Progress where appropriate. The next batch is `cypress/e2e/4.TENANT/lease-utility-segments.cy.js`: eight explicit Electric/Cold Water tests mapped to UM-NOTE-015 (notes/tickets with cancel/edit/reload), UM-NOTE-004 (two utility IDs isolated), UM-NOTE-006 (nonmodal sidebar, main-page interaction and breadcrumb navigation closure) and UM-OPT-004 (attribute cancel/create/edit/zero/reload/sibling isolation). New cases are In Progress / Not Run. Thresholds, extra entity contexts and stale-edit sidebar switching remain pending. Existing page classes handle all selectors, interactions and assertions; the spec only sets up owned fixtures and calls those methods.

Lease Utility notes and attributes require an already registered Utility pair under an owned Lease and Tenant. Exact run-prefixed child markers are reserved before writes. Cleanup validates ownership, duplicate keys, UTC creation times, supported context types and all remaining meter/billing dependencies before any DELETE, then removes note/tag/feed rows and attributes before the Utility. Unknown dependencies refuse cleanup. Safety cases were extended but not executed; only syntax and ESLint checks were run for the new batch.

On 18 October 2026, the user confirmed the existing 13 Authentication, Portfolio and Building tests passed locally. This report predates the new assertions and 18 added tests. Six catalog scenarios are marked Automated; partial cases remain In Progress. Password-reset scenarios are blocked because the test inbox is unavailable; restricted-role scenarios are blocked because QA accounts are unavailable. First-login challenge and controlled session-expiry fixtures are also missing.

Before the hydration workaround, the agent's expanded Portfolio/Building run failed in login setup with React #418 (2 setup failures, 13 skipped tests). Five distinct Dashboard API checks passed; recent meter readings timed out at 60000 ms before response assertions. The cause is unresolved. On 17 October, the older API batch passed 8 of 9 implemented checks; portfolio deletion set is_offline but its list still returned the ID. Those historical passes do not verify the later UI deletion phase in API create/update tests. Current verification is recorded separately in `docs/hydration-verification.json`.

Lint, six cleanup/naming safety unit checks, DB TLS connectivity and an owned portfolio/building cleanup integration probe passed. See `docs/staging-findings.md` for earlier evidence, the empty-attributes API defect and dependency audit findings. Run-scoped cleanup remains enabled. A global recovery sweep must wait until all Cypress executions, including Open tests, have stopped. The GitHub workflow is prepared but has not been executed or configured in a remote repository.

Do not edit frontend repositories to make tests pass, suppress application exceptions, force dialogs closed or weaken assertions. Report application defects with evidence.

2026-10-30: `cypress/e2e/4.TENANT/tenant-utility-actions.cy.js` adds six explicit Electric/Cold Water tests for empty meter selection (UM-TEN-010), no-match search/reset (UM-TEN-011), and cancel/confirm empty utility deletion (UM-TEN-018). One hierarchy is created in before; login restores per test and guarded DB cleanup runs after the spec. New scope is In Progress / Not Run. Physical/virtual assignment, long-list scrolling, and deletion with meter/billing dependencies remain pending.

2026-10-30: User confirmed all six tenant-utility-actions tests passed; mapped UM-TEN-010/011/018 execution is Passed for implemented scope, with remaining assignment/long-list/dependency matrices still In Progress. New `cypress/e2e/1.DASHBOARD/dashboard-search.cy.js` adds six tests across UM-DASH-011/012/014 and UM-NAV-005 for search limits/filters/order, exact Building/Tenant navigation, and Building route/breadcrumb context. New scope Not Run; saturated search populations and Meter navigation remain pending.

2026-10-31: dashboard-search user result is 5 passed / 1 failed. UM-DASH-012 Clear Filters/order passed; deselection is a confirmed frontend bug (selected Building retained, Tenant removed, filter=building; handler uses equality instead of inequality). New `cypress/e2e/5.METER/meter-validation.cy.js` has six explicit Electric/Cold Water tests for required fields (UM-MTR-003), equal/earlier end dates (UM-MTR-004), and valid confirmation cancellation (partial UM-MTR-001). New scope In Progress / Not Run. All Meter POSTs blocked and asserted absent; physical persistence is not claimed.

2026-10-31: User confirmed all six meter-validation variants passed. New `cypress/e2e/5.METER/meter-management.cy.js` adds eight explicit Electric/Cold Water tests: physical creation (UM-MTR-001), optional reading type on create/update (UM-MTR-002), cancel/confirm decimal updates (UM-MTR-006), physical assignment (partial UM-TEN-010). One parent hierarchy, independent exact registered Meter per test; guarded cleanup before parent deletion, including recovery leftover checks. Expanded scopes Not Run, preserving historical cancellation/empty-assignment passes. Virtual/duplicate assignment still pending.

### Meter actions — 2026-11-01

User confirmed all eight meter-management.cy.js variants passed. Next run: cypress/e2e/5.METER/meter-actions.cy.js (six new explicit tests: Electric and Cold Water duplicate cancellation, confirmed duplication/source preservation, and No Billing cancellation/persistence/prefill). Shared Building and source meters; existing MeterPage owns all UI/API/DB checks. New tests not run. Historical-reading/virtual-child duplicate behavior and billing-engine exclusion remain pending.

### Meter read APIs — 2026-11-01

meter-actions.cy.js: user confirmed four duplication tests Passed; both No Billing variants Failed because saved flag=1/details checked becomes unchecked in Edit. Strict regression checks retained.

Next run: cypress/e2e/API_TESTS/meter-read-api.cy.js (six tests). Electric and Cold Water lists/details use two owned Building controls and exact API/DB identity checks; missing Building and Meter checks are utility-neutral reads. Shared fixtures are created once through existing page methods and cleanup remains once after spec. New API variants Not Run.
