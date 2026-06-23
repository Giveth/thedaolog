// @vitest-environment jsdom
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
  tokens: [{ id: "tok-buidler", address: "0x32d664ca9ea4bad60b2b8ed61dec30692df43ac9", chain: "Arbitrum One", symbol: "TDSB", name: "BUIDLER", kind: "ERC-721" }],
  setTokens: vi.fn(),
};
const p = {
  id: "r-now", title: "Open round", description: "", votingMode: "quadratic", budget: 100,
  options: [{ id: 1, label: "Alice" }], deadline: new Date(Date.now() + 86400000).toISOString(),
  opensAt: null, tokenAddress: null, tokenChainId: null, tokenId: "tok-buidler",
  createdAt: new Date().toISOString(), createdBy: ADDR, deletedOptionIds: [],
};

beforeEach(() => cleanup());

it("opens the propose-a-direction screen with a back button, then navigates back", async () => {
  (votingApi.fetchProposals as any).mockResolvedValue([p]);
  (votingApi.fetchProposal as any).mockResolvedValue({ proposal: p, tally: {}, voterCount: 0 });
  render(<F2App {...props} />);
  fireEvent.click(await screen.findByText("Open round"));
  // The add-direction card sits at the bottom of the directions list.
  const addCard = await screen.findByText("Add a new direction");
  fireEvent.click(addCard);
  await waitFor(() => {
    expect(document.body.textContent).toMatch(/Propose a new option/i);
    expect(screen.getByText("Back")).toBeInTheDocument();
  });
  // Back returns to the round.
  fireEvent.click(screen.getByText("Back"));
  await waitFor(() => expect(screen.getByText("Directions")).toBeInTheDocument());
});
