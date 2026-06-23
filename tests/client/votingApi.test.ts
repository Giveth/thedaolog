import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as api from "../../src/votingApi";

const ACTOR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as `0x${string}`;
const wallet: any = { signTypedData: vi.fn(async () => "0xsignature" as `0x${string}`) };

let calls: { url: string; init?: any }[] = [];
function mockFetch(responder: (url: string, init?: any) => any) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
    calls.push({ url, init });
    return responder(url, init);
  }));
}
const okJson = (body: any) => ({ ok: true, status: 200, json: async () => body });
const errJson = (status: number, body: any = {}) => ({ ok: false, status, json: async () => body });

const proposal: any = { id: "r-1", title: "T", votingMode: "quadratic", budget: 100, options: [{ id: 1, label: "A" }], deadline: new Date(Date.now() + 86400000).toISOString() };

beforeEach(() => { wallet.signTypedData.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("read endpoints", () => {
  it("fetchProposals returns the list", async () => {
    mockFetch(() => okJson({ proposals: [proposal] }));
    expect(await api.fetchProposals()).toHaveLength(1);
    expect(calls[0].url).toBe("/api/proposals");
  });
  it("fetchProposals tolerates a missing list", async () => {
    mockFetch(() => okJson({}));
    expect(await api.fetchProposals()).toEqual([]);
  });
  it("fetchProposals throws on a non-200", async () => {
    mockFetch(() => errJson(500));
    await expect(api.fetchProposals()).rejects.toThrow("fetchProposals: 500");
  });
  it("fetchProposal returns the tally payload", async () => {
    mockFetch(() => okJson({ proposal, tally: { "1": 5 }, voterCount: 1 }));
    const r = await api.fetchProposal("r-1");
    expect(r.voterCount).toBe(1);
    expect(calls[0].url).toContain("/api/proposals/r-1");
  });
  it("fetchProposal throws on error", async () => {
    mockFetch(() => errJson(404));
    await expect(api.fetchProposal("x")).rejects.toThrow("fetchProposal: 404");
  });
  it("fetchBallots returns ballots and tolerates missing key", async () => {
    mockFetch(() => okJson({ ballots: [{}] }));
    expect(await api.fetchBallots("r-1")).toHaveLength(1);
    mockFetch(() => okJson({}));
    expect(await api.fetchBallots("r-1")).toEqual([]);
  });
  it("fetchBallots throws on error", async () => {
    mockFetch(() => errJson(500));
    await expect(api.fetchBallots("r-1")).rejects.toThrow("fetchBallots: 500");
  });
  it("fetchGithubPreview returns the issue / throws on error", async () => {
    mockFetch(() => okJson({ number: 3, title: "t" }));
    expect((await api.fetchGithubPreview("https://github.com/o/r/issues/3")).number).toBe(3);
    mockFetch(() => errJson(502, { error: "github_fetch_failed", detail: "x" }));
    await expect(api.fetchGithubPreview("u")).rejects.toThrow("preview: 502");
  });
});

describe("write endpoints (sign + submit)", () => {
  it("createProposal signs an admin action and posts the input", async () => {
    mockFetch(() => okJson({ proposal }));
    const out = await api.createProposal({ id: "r-1", title: "T", votingMode: "quadratic", budget: 100, options: [], deadline: proposal.deadline, opensAt: null }, wallet, ACTOR);
    expect(out.id).toBe("r-1");
    expect(wallet.signTypedData).toHaveBeenCalledOnce();
    const body = JSON.parse(calls[0].init.body);
    expect(body.adminAuth.signature).toBe("0xsignature");
    expect(body.adminAuth.action.action).toBe("create_proposal");
    expect(body.id).toBe("r-1");
  });
  it("createProposal throws on a rejected create", async () => {
    mockFetch(() => errJson(403, { error: "not_an_admin" }));
    await expect(api.createProposal({ id: "x", title: "T", votingMode: "quadratic", budget: 1, options: [], deadline: "d" }, wallet, ACTOR)).rejects.toThrow("createProposal: 403 not_an_admin");
  });
  it("deleteProposal signs delete_proposal and DELETEs", async () => {
    mockFetch(() => okJson({ ok: true }));
    await api.deleteProposal("r-1", wallet, ACTOR);
    expect(calls[0].init.method).toBe("DELETE");
    expect(JSON.parse(calls[0].init.body).adminAuth.action.action).toBe("delete_proposal");
  });
  it("deleteProposal throws on error", async () => {
    mockFetch(() => errJson(403, { error: "not_an_admin" }));
    await expect(api.deleteProposal("r-1", wallet, ACTOR)).rejects.toThrow("deleteProposal: 403");
  });
  it("deleteOption signs OptionDelete and DELETEs the option url", async () => {
    mockFetch(() => okJson({ ok: true }));
    await api.deleteOption("r-1", 2, wallet, ACTOR);
    expect(calls[0].url).toContain("/api/proposals/r-1/options/2");
    expect(JSON.parse(calls[0].init.body).optionDeleteAuth.action.optionId).toBe(2);
  });
  it("deleteOption throws on error", async () => {
    mockFetch(() => errJson(404, { error: "option_not_found" }));
    await expect(api.deleteOption("r-1", 2, wallet, ACTOR)).rejects.toThrow("deleteOption: 404");
  });
  it("addOption signs a submission and posts", async () => {
    mockFetch(() => okJson({ option: { id: 2, label: "B" }, proposal }));
    const r = await api.addOption("r-1", "B", "body", wallet, ACTOR, "https://github.com/o/r/issues/1");
    expect(r.option.id).toBe(2);
    const body = JSON.parse(calls[0].init.body);
    expect(body.label).toBe("B");
    expect(body.githubUrl).toBe("https://github.com/o/r/issues/1");
    expect(body.signature).toBe("0xsignature");
  });
  it("addOption throws on error", async () => {
    mockFetch(() => errJson(403, { error: "not_a_badgeholder" }));
    await expect(api.addOption("r-1", "B", "", wallet, ACTOR)).rejects.toThrow("addOption: 403 not_a_badgeholder");
  });
  it("castVote signs the ballot and returns the body", async () => {
    mockFetch(() => okJson({ ok: true, voter: ACTOR }));
    const r = await api.castVote(wallet, ACTOR, proposal, [{ issueId: 1, points: 5 }]);
    expect(r.ok).toBe(true);
    const body = JSON.parse(calls[0].init.body);
    expect(body.ballot.proposalId).toBe("r-1");
    expect(body.ballot.budget).toBe(100);
    expect(body.signature).toBe("0xsignature");
  });
  it("castVote throws with the server error code", async () => {
    mockFetch(() => errJson(400, { error: "over_budget" }));
    await expect(api.castVote(wallet, ACTOR, proposal, [{ issueId: 1, points: 99 }])).rejects.toThrow("castVote 400: over_budget");
  });
});
