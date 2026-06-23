// @vitest-environment jsdom
// Isolated in its own file: app.jsx keeps module-level state (issue cache,
// hydration flags) that leaks between sequential renders, so the round-detail
// flows are exercised here against a fresh module registry.
import { describe, it, expect, beforeEach, vi } from "vitest";
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
const sp = (o: any = {}) => ({
  id: "r-1", title: "T", description: "", votingMode: "quadratic", budget: 100,
  options: [{ id: 1, label: "Alice" }, { id: 2, label: "Bob" }],
  deadline: new Date(Date.now() + 86400000).toISOString(), opensAt: null,
  tokenAddress: null, tokenChainId: null, tokenId: "tok-buidler",
  createdAt: new Date().toISOString(), createdBy: ADDR, deletedOptionIds: [], ...o,
});

beforeEach(() => { cleanup(); });

it("opens an active round's voting screen with the allocations header + mode pill", async () => {
  const p = sp({ id: "r-now", title: "Open round" });
  (votingApi.fetchProposals as any).mockResolvedValue([p]);
  (votingApi.fetchProposal as any).mockResolvedValue({ proposal: p, tally: {}, voterCount: 0 });
  render(<F2App {...props} />);
  fireEvent.click(await screen.findByText("Open round"));
  await waitFor(() => {
    expect(screen.getByText("Directions")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/Quadratic Voting/i);
    expect(document.body.textContent).toMatch(/Your allocations/i);
  });
});
