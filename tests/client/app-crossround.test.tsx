// @vitest-environment jsdom
// Regression for the 2026-06-24 cross-round mixup (Griff): option ids are
// per-round (1,2,3…) and collide across rounds. The "My murmur" page must
// label each stored ballot from ITS OWN round, not the global ISSUES cache
// (which holds whichever round loaded last). Isolated file due to app.jsx
// module-level state.
import { it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

vi.mock("wagmi", () => ({
  useConnect: () => ({ connectors: [], connect: vi.fn() }),
  useReadContract: () => ({ data: undefined }),
  useReadContracts: () => ({ data: undefined }),
  useWalletClient: () => ({ data: { signTypedData: vi.fn(async () => "0xsig") } }),
}));
vi.mock("../../src/votingApi", () => ({
  fetchProposals: vi.fn(async () => []),
  fetchProposal: vi.fn(async () => ({ proposal: {}, tally: {}, voterCount: 0 })),
  fetchBallots: vi.fn(async () => []),
  castVote: vi.fn(), createProposal: vi.fn(), deleteOption: vi.fn(),
  deleteProposal: vi.fn(), addOption: vi.fn(), fetchGithubPreview: vi.fn(),
}));

import { F2App } from "../../src/app.jsx";
import * as votingApi from "../../src/votingApi";

const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const props = {
  role: "badgeholder", address: ADDR, isIncognito: false, isPublicBadgeholder: true,
  isBadgeholder: true, onDisconnect: vi.fn(), onConnectClick: vi.fn(),
  tokens: [{ id: "tok-buidler", address: "0x32d6", chain: "Arbitrum One", symbol: "TDSB", name: "BUIDLER", kind: "ERC-721" }],
  setTokens: vi.fn(),
};
const round = (id: string, label: string) => ({
  id, title: id, description: "", votingMode: "token-weight", budget: 100,
  // BOTH rounds use option id 1 — the collision that caused the mixup.
  options: [{ id: 1, label }],
  deadline: new Date(Date.now() + 86400000).toISOString(), opensAt: null,
  tokenAddress: null, tokenChainId: null, tokenId: "tok-buidler",
  createdAt: new Date().toISOString(), createdBy: ADDR, deletedOptionIds: [],
});
const ballot = (proposalId: string) => ({
  ballot: { voter: ADDR, proposalId, allocations: [{ issueId: 1, points: 2 }], budget: 100, deadline: 0, nonce: 1 },
  signature: "0xsig", signedAt: new Date().toISOString(), badgeBalance: "1",
});

beforeEach(() => { cleanup(); });

it("labels each ballot from its own round on My murmur (option ids collide)", async () => {
  const rA = round("r-a", "Alpha");
  const rB = round("r-b", "Beta");
  (votingApi.fetchProposals as any).mockResolvedValue([rA, rB]);
  (votingApi.fetchBallots as any).mockImplementation(async (id: string) =>
    id === "r-a" ? [ballot("r-a")] : id === "r-b" ? [ballot("r-b")] : []);
  render(<F2App {...props} />);

  // Go to "My murmur". Both ballots use option id 1 but different labels;
  // each must render its OWN round's label, not a single shared one.
  fireEvent.click(await screen.findByText("My murmur"));
  await waitFor(() => {
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });
});
