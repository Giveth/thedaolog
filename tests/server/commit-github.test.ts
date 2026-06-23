import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeAdminAuth, adminAccount, strangerAccount } from "../helpers";

const ZERO_ROOT = "0x" + "00".repeat(32);

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
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: async ({ functionName }: any) => {
        if ((globalThis as any).__RPC_THROW) throw new Error("rpc boom");
        if (functionName === "roots") return (globalThis as any).__ONCHAIN_ROOT ?? ("0x" + "00".repeat(32));
        if (functionName === "ballotCounts") return (globalThis as any).__ONCHAIN_COUNT ?? 3n;
        return 0n;
      },
      waitForTransactionReceipt: async () => ({ status: (globalThis as any).__TX_STATUS ?? "success" }),
    }),
    createWalletClient: () => ({ writeContract: async () => "0xdeadbeefdeadbeef" }),
  };
});

import { app } from "../../server/api.mjs";
import * as db from "../../server/db.mjs";

const PID = "r-commit";
function seed(over: Record<string, any> = {}) {
  (db as any).__seedProposals({
    [PID]: {
      id: PID, title: "C", votingMode: "quadratic", budget: 100, options: [{ id: 1, label: "A" }],
      deadline: new Date(Date.now() + 86400000).toISOString(), opensAt: null,
      tokenId: "tok-buidler", createdAt: new Date().toISOString(), createdBy: "0x0", ...over,
    },
  });
}
function seedBallots() {
  (db as any).__seedBallots({ [PID]: { "0xaaa": { ballot: { voter: "0xaaa", allocations: [{ issueId: 1, points: 5 }] }, signature: "0xsig", signedAt: "", badgeBalance: "1", cid: null } } });
}

beforeEach(() => {
  (db as any).__reset();
  (globalThis as any).__RPC_THROW = false;
  (globalThis as any).__ONCHAIN_ROOT = ZERO_ROOT;
  (globalThis as any).__TX_STATUS = "success";
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("GET /api/proposals/:id/commit (on-chain read)", () => {
  it("returns the on-chain root + count", async () => {
    const res = await app.inject({ method: "GET", url: `/api/proposals/${PID}/commit` });
    expect(res.statusCode).toBe(200);
    expect(res.json().proposalId).toBe(PID);
    expect(res.json().ballotCount).toBe("3");
  });
  it("503 rpc_failed when the chain read throws", async () => {
    (globalThis as any).__RPC_THROW = true;
    const res = await app.inject({ method: "GET", url: `/api/proposals/${PID}/commit` });
    expect(res.statusCode).toBe(503);
  });
});

describe("POST /api/proposals/:id/commit", () => {
  it("404 when the proposal is missing", async () => {
    expect((await app.inject({ method: "POST", url: `/api/proposals/${PID}/commit` })).statusCode).toBe(404);
  });
  it("400 deadline_not_passed before the deadline", async () => {
    seed();
    const res = await app.inject({ method: "POST", url: `/api/proposals/${PID}/commit` });
    expect(res.json().error).toBe("deadline_not_passed");
  });
  it("400 no_ballots_to_commit after the deadline with no ballots", async () => {
    seed({ deadline: new Date(Date.now() - 1000).toISOString() });
    const res = await app.inject({ method: "POST", url: `/api/proposals/${PID}/commit` });
    expect(res.json().error).toBe("no_ballots_to_commit");
  });
  it("returns alreadyCommitted when a root already exists on-chain", async () => {
    seed({ deadline: new Date(Date.now() - 1000).toISOString() });
    seedBallots();
    (globalThis as any).__ONCHAIN_ROOT = "0x" + "11".repeat(32);
    const res = await app.inject({ method: "POST", url: `/api/proposals/${PID}/commit` });
    expect(res.json().alreadyCommitted).toBe(true);
  });
  it("500 commit_failed without a deployer key", async () => {
    delete process.env.DEPLOYER_PRIVATE_KEY;
    seed({ deadline: new Date(Date.now() - 1000).toISOString() });
    seedBallots();
    const res = await app.inject({ method: "POST", url: `/api/proposals/${PID}/commit` });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("commit_failed");
  });
  it("commits the root on-chain with a deployer key", async () => {
    process.env.DEPLOYER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    seed({ deadline: new Date(Date.now() - 1000).toISOString() });
    seedBallots();
    const res = await app.inject({ method: "POST", url: `/api/proposals/${PID}/commit` });
    expect(res.statusCode).toBe(200);
    expect(res.json().txHash).toBe("0xdeadbeefdeadbeef");
    delete process.env.DEPLOYER_PRIVATE_KEY;
  });
  it("500 tx_reverted when the receipt status is not success", async () => {
    process.env.DEPLOYER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    (globalThis as any).__TX_STATUS = "reverted";
    seed({ deadline: new Date(Date.now() - 1000).toISOString() });
    seedBallots();
    const res = await app.inject({ method: "POST", url: `/api/proposals/${PID}/commit` });
    expect(res.json().error).toBe("tx_reverted");
    delete process.env.DEPLOYER_PRIVATE_KEY;
  });
});

describe("GET /api/github/preview", () => {
  it("400 bad_github_url for a non-issue url", async () => {
    const res = await app.inject({ method: "GET", url: "/api/github/preview?url=https://example.com" });
    expect(res.statusCode).toBe(400);
  });
  it("returns the issue when the url is valid", async () => {
    process.env.GITHUB_TOKEN = "t";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ number: 9, html_url: "u", title: "T", body: "B", labels: [] }), text: async () => "" })));
    const res = await app.inject({ method: "GET", url: "/api/github/preview?url=https://github.com/o/r/issues/9" });
    expect(res.statusCode).toBe(200);
    expect(res.json().number).toBe(9);
  });
  it("502 github_fetch_failed when GitHub errors", async () => {
    process.env.GITHUB_TOKEN = "t";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => "nope" })));
    const res = await app.inject({ method: "GET", url: "/api/github/preview?url=https://github.com/o/r/issues/9" });
    expect(res.statusCode).toBe(502);
  });
});

describe("DELETE /api/proposals/:id", () => {
  it("404 when missing", async () => {
    const adminAuth = await makeAdminAuth(adminAccount, { action: "delete_proposal", proposalId: PID });
    expect((await app.inject({ method: "DELETE", url: `/api/proposals/${PID}`, payload: { adminAuth } })).statusCode).toBe(404);
  });
  it("401 missing_admin_signature", async () => {
    seed();
    expect((await app.inject({ method: "DELETE", url: `/api/proposals/${PID}`, payload: {} })).json().error).toBe("missing_admin_signature");
  });
  it("403 not_an_admin", async () => {
    seed();
    const adminAuth = await makeAdminAuth(strangerAccount, { action: "delete_proposal", proposalId: PID });
    expect((await app.inject({ method: "DELETE", url: `/api/proposals/${PID}`, payload: { adminAuth } })).json().error).toBe("not_an_admin");
  });
  it("deletes the proposal and its ballots with a valid admin signature", async () => {
    seed(); seedBallots();
    const adminAuth = await makeAdminAuth(adminAccount, { action: "delete_proposal", proposalId: PID });
    const res = await app.inject({ method: "DELETE", url: `/api/proposals/${PID}`, payload: { adminAuth } });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(PID);
    expect((await app.inject({ method: "GET", url: "/api/proposals" })).json().proposals).toHaveLength(0);
  });
});
