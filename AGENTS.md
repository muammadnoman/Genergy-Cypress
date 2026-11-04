# Genergy Cypress automation

- Declare separate explicit tests for Electric and Cold Water (three named tests each for current Lease utility scenarios). Do not generate utility tests through a for/forEach loop. Reuse page-class scenario methods with a utility argument to avoid duplicating UI logic; keep one shared setup hook.

- Supported utilities are Electric and Cold Water only; more will be added later. Every utility-dependent UI/API/catalog scenario must cover both with a shared parameterized flow, including compatible rates, validation, persistence, switching, isolation and empty/error states where applicable. Keep selectors/interactions/assertions in page/API classes. Use registered fixtures in a region with compatible rates for positive variants; never silently skip a utility, substitute one for another or treat a missing-rate cancellation check as positive save coverage. Record missing fixtures as an explicit coverage gap. Utility-neutral scenarios need no duplicate runs. Add future utilities to the shared supportedUtilities matrix when introduced; do not claim other utility coverage now.

- Implement and fix code only by default. The user runs the cases and shares results. Do not launch Cypress, unit tests, smoke tests, CI runs or other test suites unless the user explicitly requests that execution. Do not treat a request to implement/fix automation as permission to run tests. Review changes statically and report that execution is left to the user. Cleanup of exact owned fixtures left by an already-stopped run is allowed; it is not permission to start another test run.
- Use JavaScript, Cypress and POM. Keep specs under `cypress/e2e/<module>/`.
- Do not use locators in spec files. Keep every UI selector, DOM traversal, interaction, wait/intercept and UI/API/DB assertion for a UI scenario in its existing page class. UI specs contain test data, scenario flow and page-method calls only; Cypress fixture alias access and queue control are allowed. API-only specs keep API assertions in the API test layer and must never contain UI locators/actions.
- Add one page class per automated page in `pageObjects/`; put shared shell behavior in AppPage only when reused.
- Use simple, reusable functions. Extend existing page methods instead of duplicating flows or adding wrappers/helpers for individual cases. Add a helper only when it removes actual repeated logic. Do not replace repeated spec code with a second copy of the same page implementation.
- Target only `https://staging.um.genergy.com` and `https://staging-api.genergy.com`.
- API requests must send `origin: https://localhost:4200` and the raw Cognito ID token in `Authorization` (no Bearer prefix).
- Read credentials from ignored `.env.local` or CI secrets. Never commit, print or attach passwords/tokens.
- Use `@cypress/grep` tags and sheet case IDs in test titles; group specs by module.
- Use recordData(type) and Faker for every new record. Names must be `Auto_<RecordType>_<run>_<unique value>` (Portfolio, Building, Tenant, etc.). Number fields use `Auto_<run>_<unique value>` to fit schema limits. Never reuse a previous run's identities.
- Run `npm run cleanup:all` as the final recovery sweep only after all Cypress executions have stopped. Never run it alongside Cypress Open tests or another test run: it can remove their live fixtures. During active execution, rely on the current run's spec-end after/after:run cleanup. Read-only investigation requires no recovery sweep. The final sweep must verify zero registered leftovers, retain failed ledgers, and remain compatible with legacy UMQA records. Add cleanup dependency support before automating any new record type.
- Before any write, register the exact fixture identity. Clean it using the guarded staging DB tasks after tests and after a run, including failures.
- Verify UI soft deletion in only one dedicated case per applicable module; do not use UI deletion as teardown in other cases or delete setup parents through UI. Keep the delete HTTP, DB is_offline=1 and UI absence checks in that case. Cancel-delete cases only verify cancellation. Preserve API deletion cases for their endpoint-specific coverage.
- Never broadly delete data, disable foreign keys or delete unregistered/shared records. Refuse unexpected dependencies.
- Keep DB credentials/connections in Node config/tasks; never expose them to browser code.
- Validate displayed values against intercepted API responses and saved DB data where applicable.
- Use request aliases and observable UI state, not fixed sleeps or forced clicks.
- Preserve application failures: do not suppress exceptions, force dialogs closed, weaken assertions or modify frontend repositories.
- Use Mochawesome HTML/JSON reports with screenshots. CI runs manually with Chrome; no recurring schedule is authorized.
- Update automation coverage only after the mapped scenario passes against staging. Report partial coverage honestly.

- Retain all registered test records until every case in the spec finishes. The shared root after hook performs guarded DB hard cleanup once per spec, including failed specs; after:run remains the fallback. Authentication uses the same hook but currently creates no records. Preserve ownership checks, dependency checks and child-before-parent DB deletion; never clean another active run.
