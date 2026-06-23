# Testing

The murmuration app has an automated test suite built on
[Vitest](https://vitest.dev). It covers the server API, the Postgres storage
layer, the client API wrapper, eligibility helpers, the wallet gate, and the
main UI flows.

## Running

```bash
pnpm test            # run the whole suite once
pnpm test:watch      # watch mode
pnpm test:coverage   # run with a coverage report (text + HTML in ./coverage)
```

No database or wallet is required — Postgres, on-chain reads, IPFS, GitHub,
and the wallet client are all mocked. EIP-712 signatures are produced with
real viem test keys so signature verification is genuinely exercised.

## Layout

```
tests/
  setup.ts              # global setup (silences logs, seeds a test admin)
  helpers.ts            # test accounts + EIP-712 signing matching the server
  server/               # Fastify API tests, run via app.inject()
    create / vote / read / options / commit-github / db / smoke
  client/               # jsdom component + lib tests
    votingApi / eligibility / wagmi / main / app*
```

Server tests mock `server/db.mjs` (in-memory) and the viem chain client.
Client component tests mock `wagmi`, `@rainbow-me/rainbowkit`, and
`src/votingApi`. A few app.jsx flows live in their own files because app.jsx
keeps module-level state that leaks between sequential renders in one file.

## Coverage (current)

| Area                    | Lines |
| ----------------------- | ----- |
| `server/api.mjs`        | ~95%  |
| `server/db.mjs`         | ~99%  |
| `src/votingApi.ts`      | 100%  |
| `src/eligibility.ts`    | 100%  |
| `src/wagmi.ts`          | 100%  |
| `src/main.tsx`          | ~80%  |
| `src/app.jsx`           | ~52%  |
| **Overall**             | ~67%  |

The business logic — vote casting (budget, eligibility, scheduling, admin
bypass), proposal CRUD with EIP-712 admin auth, the tally/merkle math, the
storage layer, and the wallet-gate role derivation — is covered at 95–100%.

The gap to 100% is almost entirely **`src/app.jsx`**, a single ~4,100-line
auto-generated UI module. Its main flows (rounds list with the active /
upcoming / past split, round detail + scheduling gate, the allocations panel,
admin editor, the propose-a-direction screen + back button) are tested via
`F2App` integration renders, but the long tail of UI branches (every admin
form path, the slider drag interaction, the badge PFP modal, the verify
panel, every error toast) is not.

Reaching ~100% there would mean either a large number of brittle
interaction tests or — better — extracting app.jsx's pure helpers
(date/phase utilities, QV cost math, coin/PFP mapping) and smaller
components into separately-exported, unit-testable modules. That refactor is
the recommended next step.

## Testability changes

Two production modules were given small, behavior-preserving hooks so they
can be imported by tests without side effects:

- `server/api.mjs` exports `app` and only calls `app.listen()` when run
  directly (`node server/api.mjs`); the admin allowlist accepts
  `EXTRA_ADMIN_ADDRESSES` (mirroring the client's `VITE_EXTRA_ADMIN_ADDRESSES`)
  and the staging vote-bypass flag is read per-request.
- `src/main.tsx` exports `WalletGate` / `useCurrentPath` / `WalletLockedHint`
  / `AppErrorBoundary` and only mounts the React root in a browser (not under
  the test runner).
