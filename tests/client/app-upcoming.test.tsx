// @vitest-environment jsdom
// Isolated (see app-detail.test.tsx) so app.jsx module state is fresh.
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
  isBadgeholder: true, onDisconnect: vi.fn(), onConnectClick: vi.fn(), tokens: [], setTokens: vi.fn(),
};
const sp = (o: any = {}) => ({
  id: "r-1", title: "T", votingMode: "quadratic", budget: 100, options: [{ id: 1, label: "Alice" }],
  deadline: new Date(Date.now() + 86400000).toISOString(), opensAt: null,
  tokenAddress: null, tokenChainId: null, tokenId: "tok-buidler",
  createdAt: new Date().toISOString(), createdBy: ADDR, deletedOptionIds: [], ...o,
});

beforeEach(() => cleanup());

it("shows the 'Voting opens' screen for an upcoming round instead of the voting UI", async () => {
  const future = sp({ id: "r-future", title: "Future round", opensAt: new Date(Date.now() + 86400000).toISOString() });
  (votingApi.fetchProposals as any).mockResolvedValue([sp({ id: "r-now", title: "Live round" }), future]);
  (votingApi.fetchProposal as any).mockResolvedValue({ proposal: future, tally: {}, voterCount: 0 });
  render(<F2App {...props} />);
  await waitFor(() => expect(document.body.textContent).toMatch(/Future round/));
  fireEvent.click(screen.getByText("Future round"));
  await waitFor(() => expect(document.body.textContent).toMatch(/Voting opens/i));
  expect(screen.queryByText("Directions")).not.toBeInTheDocument();
});
