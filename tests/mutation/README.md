# Mutation Testing

This directory holds configuration and notes for mutation testing via Stryker.

Stryker introduces small semantic changes (mutants) to the codebase and checks whether our test suite catches them (i.e. whether tests fail).

## Running Mutation Tests Locally

```bash
npm run test:mutation
```

## Thresholds

We enforce a minimum mutation score threshold of 80% (`thresholds.break: 80`).
