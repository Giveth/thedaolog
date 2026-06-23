import "@testing-library/jest-dom/vitest";

// Quiet the Fastify/pino logger during tests.
process.env.LOG_LEVEL = "silent";

// The server's ADMIN_ADDRESSES allowlist is computed once when api.mjs is
// first imported. Add the test admin account (Anvil account #0) via the
// env hook the server reads, so the suite can sign valid admin actions.
// Must be set before api.mjs is imported — setup files run first.
process.env.EXTRA_ADMIN_ADDRESSES =
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

// Default the staging-only vote bypass OFF; individual tests toggle it.
process.env.ALLOW_ADMIN_VOTE_BYPASS = "0";
