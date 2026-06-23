import { describe, it, expect, beforeEach, vi } from "vitest";

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
vi.mock("viem", async (orig) => {
  const actual: any = await orig();
  return { ...actual, createPublicClient: () => ({ readContract: async () => 0n }), createWalletClient: () => ({ writeContract: async () => "0x0" }) };
});

import { app } from "../../server/api.mjs";
import * as db from "../../server/db.mjs";

const PID = "r-read";
function proposal(over: Record<string, any> = {}) {
  return {
    id: PID, title: "Read me", description: "d", votingMode: "quadratic", budget: 100,
    options: [{ id: 1, label: "A" }, { id: 2, label: "B" }],
    deadline: new Date(Date.now() + 86400000).toISOString(), opensAt: null,
    tokenId: "tok-buidler", tokenAddress: null, tokenChainId: null,
    createdAt: new Date().toISOString(), createdBy: "0x0", ...over,
  };
}
function ballot(voter: string, allocations: { issueId: number; points: number }[]) {
  return { ballot: { voter, proposalId: PID, allocations, budget: 100, deadline: 0, nonce: 0 }, signature: "0x", signedAt: new Date().toISOString(), badgeBalance: "1", cid: null };
}

beforeEach(() => { (db as any).__reset(); });

describe("GET /api/proposals (list)", () => {
  it("returns the public view and hides soft-deleted options", async () => {
    (db as any).__seedProposals({ [PID]: proposal({ options: [{ id: 1, label: "A" }, { id: 2, label: "B", deleted: true }] }) });
    const res = await app.inject({ method: "GET", url: "/api/proposals" });
    expect(res.statusCode).toBe(200);
    const [p] = res.json().proposals;
    expect(p.options).toHaveLength(1);
    expect(p.options[0].id).toBe(1);
    expect(p.deletedOptionIds).toEqual([2]);
  });
});

describe("GET /api/proposals/:id (tally)", () => {
  it("404 when the proposal does not exist", async () => {
    const res = await app.inject({ method: "GET", url: "/api/proposals/missing" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("proposal_not_found");
  });

  it("aggregates points per option and counts voters", async () => {
    (db as any).__seedProposals({ [PID]: proposal() });
    (db as any).__seedBallots({
      [PID]: {
        "0xaaa": ballot("0xaaa", [{ issueId: 1, points: 3 }, { issueId: 2, points: 2 }]),
        "0xbbb": ballot("0xbbb", [{ issueId: 1, points: 4 }]),
      },
    });
    const res = await app.inject({ method: "GET", url: `/api/proposals/${PID}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tally).toEqual({ "1": 7, "2": 2 });
    expect(body.voterCount).toBe(2);
  });

  it("excludes allocations pointing at a soft-deleted option", async () => {
    (db as any).__seedProposals({ [PID]: proposal({ options: [{ id: 1, label: "A" }, { id: 2, label: "B", deleted: true }] }) });
    (db as any).__seedBallots({ [PID]: { "0xaaa": ballot("0xaaa", [{ issueId: 1, points: 3 }, { issueId: 2, points: 9 }]) } });
    const res = await app.inject({ method: "GET", url: `/api/proposals/${PID}` });
    expect(res.json().tally).toEqual({ "1": 3 });
  });
});

describe("GET /api/proposals/:id/ballots", () => {
  it("returns the raw ballots for a proposal", async () => {
    (db as any).__seedBallots({ [PID]: { "0xaaa": ballot("0xaaa", [{ issueId: 1, points: 5 }]) } });
    const res = await app.inject({ method: "GET", url: `/api/proposals/${PID}/ballots` });
    expect(res.statusCode).toBe(200);
    expect(res.json().ballots).toHaveLength(1);
  });

  it("returns an empty list for an unknown proposal", async () => {
    const res = await app.inject({ method: "GET", url: "/api/proposals/none/ballots" });
    expect(res.json().ballots).toEqual([]);
  });
});

describe("GET /api/proposals/:id/local-root", () => {
  it("computes a deterministic merkle root + ballot count", async () => {
    (db as any).__seedBallots({
      [PID]: {
        "0xaaa": ballot("0xaaa", [{ issueId: 1, points: 5 }]),
        "0xbbb": ballot("0xbbb", [{ issueId: 2, points: 3 }]),
      },
    });
    const r1 = (await app.inject({ method: "GET", url: `/api/proposals/${PID}/local-root` })).json();
    const r2 = (await app.inject({ method: "GET", url: `/api/proposals/${PID}/local-root` })).json();
    expect(r1.ballotCount).toBe(2);
    expect(r1.root).toMatch(/^0x[0-9a-f]+$/i);
    expect(r1.root).toBe(r2.root); // deterministic
  });

  it("returns a root for zero ballots", async () => {
    const res = await app.inject({ method: "GET", url: `/api/proposals/${PID}/local-root` });
    expect(res.statusCode).toBe(200);
    expect(res.json().ballotCount).toBe(0);
  });
});
