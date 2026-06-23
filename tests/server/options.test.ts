import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from "vitest";
import { makeSubmission, makeOptionDeleteAuth, adminAccount, voterAccount, strangerAccount, pastDeadline } from "../helpers";

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
    createPublicClient: () => ({ readContract: async () => (globalThis as any).__BADGE_BALANCE ?? 0n }),
    createWalletClient: () => ({ writeContract: async () => "0x0" }),
  };
});

import { app } from "../../server/api.mjs";
import * as db from "../../server/db.mjs";

const PID = "r-opt";
function seed(over: Record<string, any> = {}) {
  (db as any).__seedProposals({
    [PID]: {
      id: PID, title: "Opt", description: "", votingMode: "quadratic", budget: 100,
      options: [{ id: 1, label: "A" }], deadline: new Date(Date.now() + 86400000).toISOString(),
      opensAt: null, tokenId: "tok-buidler", tokenAddress: null, tokenChainId: null,
      createdAt: new Date().toISOString(), createdBy: "0x0", ...over,
    },
  });
}
const setBadge = (b: bigint) => { (globalThis as any).__BADGE_BALANCE = b; };
const addOption = (body: any) => app.inject({ method: "POST", url: `/api/proposals/${PID}/options`, payload: body });
const okFetch = () => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ number: 7, html_url: "https://github.com/o/r/issues/7", title: "T", body: "B" }), text: async () => "" })));

beforeAll(() => {
  process.env.GITHUB_TOKEN = "test-token";
  process.env.THEDAOLOG_GITHUB_REPO = "owner/repo";
});
beforeEach(() => { (db as any).__reset(); setBadge(0n); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("POST /api/proposals/:id/options (add)", () => {
  it("400 missing_label", async () => {
    expect((await addOption({ submission: {}, signature: "0x" })).json().error).toBe("missing_label");
  });
  it("401 missing_signed_submission", async () => {
    expect((await addOption({ label: "x" })).json().error).toBe("missing_signed_submission");
  });
  it("400 bad_github_url", async () => {
    const s = await makeSubmission(adminAccount, { proposalId: PID, label: "x" });
    const res = await addOption({ label: "x", ...s, githubUrl: "not-a-url" });
    expect(res.json().error).toBe("bad_github_url");
  });
  it("404 proposal_not_found", async () => {
    const s = await makeSubmission(adminAccount, { proposalId: PID, label: "x" });
    expect((await addOption({ label: "x", ...s })).statusCode).toBe(404);
  });
  it("400 voting_closed past the deadline", async () => {
    seed({ deadline: new Date(Date.now() - 1000).toISOString() });
    const s = await makeSubmission(adminAccount, { proposalId: PID, label: "x" });
    expect((await addOption({ label: "x", ...s })).json().error).toBe("voting_closed");
  });
  it("400 proposal_id_mismatch", async () => {
    seed();
    const s = await makeSubmission(adminAccount, { proposalId: "other", label: "x" });
    expect((await addOption({ label: "x", ...s })).json().error).toBe("proposal_id_mismatch");
  });
  it("400 label_mismatch", async () => {
    seed();
    const s = await makeSubmission(adminAccount, { proposalId: PID, label: "signed-label" });
    expect((await addOption({ label: "different", ...s })).json().error).toBe("label_mismatch");
  });
  it("400 signature_expired", async () => {
    seed();
    const s = await makeSubmission(adminAccount, { proposalId: PID, label: "x", deadline: pastDeadline() });
    expect((await addOption({ label: "x", ...s })).json().error).toBe("signature_expired");
  });
  it("400 bad_submitter_address", async () => {
    seed();
    const s = await makeSubmission(adminAccount, { proposalId: PID, label: "x" });
    (s.submission as any).submitter = "garbage";
    expect((await addOption({ label: "x", ...s })).json().error).toBe("bad_submitter_address");
  });
  it("401 invalid_signature when tampered", async () => {
    seed();
    const s = await makeSubmission(adminAccount, { proposalId: PID, label: "x" });
    (s.submission as any).nonce = 4242;
    expect((await addOption({ label: "x", ...s })).json().error).toBe("invalid_signature");
  });
  it("400 signature_verification_threw for a malformed signature", async () => {
    seed();
    const s = await makeSubmission(adminAccount, { proposalId: PID, label: "x" });
    s.signature = "0x12" as any;
    expect((await addOption({ label: "x", ...s })).json().error).toBe("signature_verification_threw");
  });
  it("403 no_known_eligibility_token for a non-admin with an unresolvable token", async () => {
    seed({ tokenId: "tok-nope" });
    const s = await makeSubmission(voterAccount, { proposalId: PID, label: "x" });
    expect((await addOption({ label: "x", ...s })).json().error).toBe("no_known_eligibility_token");
  });
  it("403 not_a_badgeholder for a non-admin with no badge", async () => {
    seed(); setBadge(0n);
    const s = await makeSubmission(voterAccount, { proposalId: PID, label: "x" });
    expect((await addOption({ label: "x", ...s })).json().error).toBe("not_a_badgeholder");
  });
  it("adds an option for an admin (badge bypass) via compose mode, auto-incrementing id", async () => {
    seed(); okFetch();
    const s = await makeSubmission(adminAccount, { proposalId: PID, label: "New direction" });
    const res = await addOption({ label: "New direction", body: "why", ...s });
    expect(res.statusCode).toBe(200);
    expect(res.json().option.id).toBe(2);
    expect(res.json().option.label).toBe("New direction");
  });
  it("adds an option for a non-admin badgeholder", async () => {
    seed(); setBadge(1n); okFetch();
    const s = await makeSubmission(voterAccount, { proposalId: PID, label: "Holder option" });
    const res = await addOption({ label: "Holder option", ...s });
    expect(res.statusCode).toBe(200);
    expect(res.json().option.submittedBy.toLowerCase()).toBe(voterAccount.address.toLowerCase());
  });
  it("adds an option via GitHub import mode (re-fetches the issue)", async () => {
    seed(); okFetch();
    const s = await makeSubmission(adminAccount, { proposalId: PID, label: "Imported" });
    const res = await addOption({ label: "Imported", ...s, githubUrl: "https://github.com/o/r/issues/5" });
    expect(res.statusCode).toBe(200);
    expect(res.json().option.github.source).toBe("import");
    expect(res.json().option.github.number).toBe(7);
  });
  it("502 github_intake_failed when issue creation fails", async () => {
    seed();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "boom" })));
    const s = await makeSubmission(adminAccount, { proposalId: PID, label: "x" });
    expect((await addOption({ label: "x", ...s })).statusCode).toBe(502);
  });
});

describe("DELETE /api/proposals/:id/options/:optionId", () => {
  const del = (optionId: string, body: any) => app.inject({ method: "DELETE", url: `/api/proposals/${PID}/options/${optionId}`, payload: body });
  it("400 bad_option_id for a non-numeric id", async () => {
    seed();
    expect((await del("abc", {})).json().error).toBe("bad_option_id");
  });
  it("404 proposal_not_found", async () => {
    expect((await del("1", {})).statusCode).toBe(404);
  });
  it("404 option_not_found", async () => {
    seed();
    expect((await del("99", {})).json().error).toBe("option_not_found");
  });
  it("409 already_deleted", async () => {
    seed({ options: [{ id: 1, label: "A", deleted: true }] });
    const auth = await makeOptionDeleteAuth(adminAccount, { proposalId: PID, optionId: 1 });
    expect((await del("1", { optionDeleteAuth: auth })).statusCode).toBe(409);
  });
  it("401 missing_admin_signature", async () => {
    seed();
    expect((await del("1", {})).json().error).toBe("missing_admin_signature");
  });
  it("403 not_an_admin", async () => {
    seed();
    const auth = await makeOptionDeleteAuth(strangerAccount, { proposalId: PID, optionId: 1 });
    expect((await del("1", { optionDeleteAuth: auth })).json().error).toBe("not_an_admin");
  });
  it("400 option_id_mismatch when the signed option differs", async () => {
    seed({ options: [{ id: 1, label: "A" }, { id: 2, label: "B" }] });
    const auth = await makeOptionDeleteAuth(adminAccount, { proposalId: PID, optionId: 2 });
    expect((await del("1", { optionDeleteAuth: auth })).json().error).toBe("option_id_mismatch");
  });
  it("soft-deletes the option for a valid admin signature", async () => {
    seed();
    const auth = await makeOptionDeleteAuth(adminAccount, { proposalId: PID, optionId: 1 });
    const res = await del("1", { optionDeleteAuth: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().deletedOptionId).toBe(1);
    // confirm it is now hidden from the public view
    const list = (await app.inject({ method: "GET", url: "/api/proposals" })).json();
    expect(list.proposals[0].options).toHaveLength(0);
    expect(list.proposals[0].deletedOptionIds).toEqual([1]);
  });
});
