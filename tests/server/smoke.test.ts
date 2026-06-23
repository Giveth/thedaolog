import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory replacement for the Postgres layer.
vi.mock("../../server/db.mjs", () => {
  let proposals: Record<string, any> = {};
  let ballots: Record<string, any> = {};
  return {
    pool: { query: vi.fn(async () => ({ rows: [] })), end: vi.fn() },
    bootstrap: vi.fn(async () => {}),
    loadProposals: vi.fn(async () => structuredClone(proposals)),
    saveProposals: vi.fn(async (m: any) => { proposals = structuredClone(m); }),
    loadBallots: vi.fn(async () => structuredClone(ballots)),
    saveBallots: vi.fn(async (m: any) => { ballots = structuredClone(m); }),
    __reset: () => { proposals = {}; ballots = {}; },
    __seedProposals: (p: any) => { proposals = structuredClone(p); },
    __seedBallots: (b: any) => { ballots = structuredClone(b); },
  };
});

// Stub on-chain reads (badge balanceOf) and writes (tally commit).
vi.mock("viem", async (orig) => {
  const actual: any = await orig();
  return {
    ...actual,
    createPublicClient: () => ({ readContract: async () => (globalThis as any).__BADGE_BALANCE ?? 0n }),
    createWalletClient: () => ({ writeContract: async () => "0xdeadbeef" }),
  };
});

import { app } from "../../server/api.mjs";
import * as db from "../../server/db.mjs";

beforeEach(() => {
  (db as any).__reset();
  (globalThis as any).__BADGE_BALANCE = 0n;
});

describe("harness smoke", () => {
  it("GET /api/health returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("GET /api describes the read endpoints", async () => {
    const res = await app.inject({ method: "GET", url: "/api" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.readEndpoints.listProposals).toContain("/api/proposals");
    expect(body.notes).toContain("no API key");
  });

  it("GET /api/proposals starts empty", async () => {
    const res = await app.inject({ method: "GET", url: "/api/proposals" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ proposals: [] });
  });
});
