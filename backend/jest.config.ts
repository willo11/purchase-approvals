import type { Config } from 'jest';

/**
 * Backend Jest configuration.
 *
 * Two test areas, one runner:
 * - Unit tests: `tests/unit/**` — pure domain/application/api logic with fakes.
 * - Integration tests: `tests/integration/**` — real AWS SDK adapters against
 *   a local DynamoDB (docker compose service `dynamodb-local`). They are gated
 *   by the `DYNAMODB_LOCAL` env var and skipped when the endpoint is not set,
 *   so the default `pnpm test` stays green without Docker.
 *
 * Coverage threshold: global >= 60% (assignment requirement FR9 / config.yaml
 * `coverage_threshold: 60`). Placeholder PR #0 keeps it above threshold; later
 * capability PRs raise it while staying green.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.ts',
    '<rootDir>/tests/integration/**/*.test.ts',
  ],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      statements: 60,
      branches: 60,
      functions: 60,
      lines: 60,
    },
  },
  // CI safety (fresh-review FIX 4): Jest 29 REMOVED the `forbidOnly` option
  // (it existed through Jest 27), so the guard is a pre-hook script
  // (`scripts/no-focused-tests.mjs`) that fails any jest run containing a
  // committed `.only`/`fit`/`fdescribe`.
};

export default config;
