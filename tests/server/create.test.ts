import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeAdminAuth, adminAccount, strangerAccount, pastDeadline } from "../helpers";

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
    createPublicClient: () => ({ readContract: async () => 0n }),
    createWalletClient: () => ({ writeContract: async () => "0xdeadbeef" }),
  };
});

import { app } from "../../server/api.mjs";
import * as db from "../../server/db.mjs";

const ID = "r-new";
const baseFields = () => ({
  id: ID, title: "A vote", description: "desc",
  votingMode: "quadratic", budget: 100, options: [],
  deadline: new Date(Date.now() + 86400000).toISOString(),
});
const create = (body: any) => app.inject({ method: "POST", url: "/api/proposals", payload: body });

beforeEach(() => { (db as any).__reset(); });

describe("POST /api/proposals (create + admin auth)", () => {
  it("400 missing_fields without id/title/deadline", async () => {
    const res = await create({ title: "x" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("missing_fields");
  });

  it("400 token_spec_incomplete when only one of tokenAddress/chainId is set", async () => {
    const adminAuth = await makeAdminAuth(adminAccount, { action: "create_proposal", proposalId: ID });
    const res = await create({ ...baseFields(), tokenAddress: "0x" + "1".repeat(40), adminAuth });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("token_spec_incomplete");
  });

  it("400 bad_token_address for a malformed token address", async () => {
    const adminAuth = await makeAdminAuth(adminAccount, { action: "create_proposal", proposalId: ID });
    const res = await create({ ...baseFields(), tokenAddress: "nope", tokenChainId: 1, adminAuth });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("bad_token_address");
  });

  it("400 unsupported_token_chain for a chain we don't read", async () => {
    const adminAuth = await makeAdminAuth(adminAccount, { action: "create_proposal", proposalId: ID });
    const res = await create({ ...baseFields(), tokenAddress: "0x" + "1".repeat(40), tokenChainId: 999, adminAuth });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("unsupported_token_chain");
  });

  it("401 missing_admin_signature without adminAuth", async () => {
    const res = await create({ ...baseFields() });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("missing_admin_signature");
  });

  it("400 action_mismatch when the signed action is wrong", async () => {
    const adminAuth = await makeAdminAuth(adminAccount, { action: "delete_proposal", proposalId: ID });
    const res = await create({ ...baseFields(), adminAuth });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("action_mismatch");
  });

  it("400 proposal_id_mismatch when the signed id differs", async () => {
    const adminAuth = await makeAdminAuth(adminAccount, { action: "create_proposal", proposalId: "other" });
    const res = await create({ ...baseFields(), adminAuth });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("proposal_id_mismatch");
  });

  it("400 signature_expired for a past deadline", async () => {
    const adminAuth = await makeAdminAuth(adminAccount, { action: "create_proposal", proposalId: ID, deadline: pastDeadline() });
    const res = await create({ ...baseFields(), adminAuth });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("signature_expired");
  });

  it("400 bad_actor_address for a malformed actor", async () => {
    const adminAuth = await makeAdminAuth(adminAccount, { action: "create_proposal", proposalId: ID });
    adminAuth.action.actor = "garbage";
    const res = await create({ ...baseFields(), adminAuth });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("bad_actor_address");
  });

  it("403 not_an_admin when a non-allowlisted wallet signs", async () => {
    const adminAuth = await makeAdminAuth(strangerAccount, { action: "create_proposal", proposalId: ID });
    const res = await create({ ...baseFields(), adminAuth });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("not_an_admin");
  });

  it("401 invalid_signature when the signed message is tampered", async () => {
    const adminAuth = await makeAdminAuth(adminAccount, { action: "create_proposal", proposalId: ID });
    adminAuth.action.nonce = 999; // breaks the recovered signature
    const res = await create({ ...baseFields(), adminAuth });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_signature");
  });

  it("400 signature_verification_threw for a malformed signature", async () => {
    const adminAuth = await makeAdminAuth(adminAccount, { action: "create_proposal", proposalId: ID });
    adminAuth.signature = "0x00";
    const res = await create({ ...baseFields(), adminAuth });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("signature_verification_threw");
  });

  it("creates a proposal with a valid admin signature, storing opensAt + createdBy", async () => {
    const opensAt = new Date(Date.now() + 3600000).toISOString();
    const adminAuth = await makeAdminAuth(adminAccount, { action: "create_proposal", proposalId: ID });
    const res = await create({ ...baseFields(), opensAt, adminAuth });
    expect(res.statusCode).toBe(200);
    const p = res.json().proposal;
    expect(p.id).toBe(ID);
    expect(p.opensAt).toBe(opensAt);
    expect(p.createdBy.toLowerCase()).toBe(adminAccount.address.toLowerCase());
    // round-trips through the list endpoint
    const list = (await app.inject({ method: "GET", url: "/api/proposals" })).json();
    expect(list.proposals).toHaveLength(1);
  });

  it("accepts a valid tokenAddress + supported chain, stored lowercased", async () => {
    const adminAuth = await makeAdminAuth(adminAccount, { action: "create_proposal", proposalId: ID });
    const addr = "0xABCDEF0123456789abcdef0123456789ABCDEF01";
    const res = await create({ ...baseFields(), tokenAddress: addr, tokenChainId: 42161, adminAuth });
    expect(res.statusCode).toBe(200);
    expect(res.json().proposal.tokenAddress).toBe(addr.toLowerCase());
    expect(res.json().proposal.tokenChainId).toBe(42161);
  });
});
