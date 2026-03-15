# Testing Guide

**[English](TESTING.md) | [한국어](TESTING.ko.md)**

## 1) Local Test Matrix

Run these commands from the repository root:

- `npm test` — Unit + compatibility tests (`test/*.test.js`)
- `npm run e2e` — End-to-end smoke checks (`e2e/*.test.js`)
- `npm run lint` — Syntax check for runtime JS files

## 2) Required Runtime

- Node.js 18+
- Internet access is only needed when you run ad-hoc scripts that call remote services
- Test suites themselves do **not** require real Supabase or network access; all external interactions in tests are mocked or use local temporary files

## 3) Unit and Compatibility Tests

`npm test` executes:

- `test/cli-compatibility.test.js` — validates CLI command help text and compatibility flags
- `test/config-secrets.test.js` — verifies secret persistence and decryption logic
- `test/idempotency.test.js` — checks operation idempotency helper behavior
- `test/supabase-append-event.test.js` — validates Supabase append behavior with conflict handling

### Expected result

- Non-zero exit code indicates at least one failing assertion
- On success, each test file prints its standard Node test summary and exits with `0`

## 4) End-to-End Tests

`npm run e2e` executes:

- `e2e/cli-e2e.test.js` — validates basic CLI command behavior with temporary isolated config paths
- `e2e/viewer-e2e.test.js` — starts the viewer in read-only mode and verifies `/health` endpoint response

### Notes

- The viewer e2e test binds to a random free port and tears down the process after verification
- Failures can occur when the local machine is under heavy resource pressure, usually resolved by re-running the suite

## 5) Recommended Validation Flow

For every change, we use this order:

1. `npm run lint`
2. `npm test`
3. `npm run e2e`

When all three pass, the repository is ready for PR-ready validation.

## 6) Related documentation

- [README.md](README.md)
- [README.ko.md](README.ko.md)
