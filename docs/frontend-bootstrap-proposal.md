# Frontend proposal for developer review

Superseded for this automation project on 18 October 2026: a Cypress-only HTML response adaptation now runs and removes the test bootstrap before React hydrates. A fresh login test passed without exception suppression. See `staging-findings.md` for verification. The frontend proposal below remains an alternative for developer review, not a requirement for running these tests.

This proposal has not been applied to the frontend repository or deployed.

If investigation confirms the Cypress bootstrap hydration mismatch, add an inert placeholder to the root layout's head, as supported by [Cypress PR 33295](https://github.com/cypress-io/cypress/pull/33295):

```tsx
<script data-cy-bootstrap suppressHydrationWarning>
  {/* Cypress bootstrap placeholder. */}
</script>
```

Review against the deployed Next.js/React versions, deploy to staging, and rerun `npm run test:auth`. Preserve exception reporting in Cypress; this proposal does not establish the root cause by itself.
