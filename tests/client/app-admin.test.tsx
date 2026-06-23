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

const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const props = {
  role: "admin", address: ADDR, isIncognito: false, isPublicBadgeholder: true,
  isBadgeholder: true, onDisconnect: vi.fn(), onConnectClick: vi.fn(),
  tokens: [{ id: "tok-buidler", address: "0x32d664ca9ea4bad60b2b8ed61dec30692df43ac9", chain: "Arbitrum One", symbol: "TDSB", name: "BUIDLER", kind: "ERC-721", isDefault: true }],
  setTokens: vi.fn(),
};

beforeEach(() => cleanup());

it("admin opens the vote editor from '+ New vote'", async () => {
  render(<F2App {...props} />);
  fireEvent.click(await screen.findByText("+ New vote"));
  await waitFor(() => {
    // F2RoundEditor renders the create form + publish button.
    expect(document.body.textContent).toMatch(/Publish murmuration/i);
    expect(document.body.textContent).toMatch(/Eligibility token/i);
  });
});

it("admin can reach the editor via the Admin nav tab", async () => {
  render(<F2App {...props} />);
  // The top-chrome 'Admin' nav switches to the admin screen.
  fireEvent.click(await screen.findByText("Admin"));
  await waitFor(() => expect(document.body.textContent).toMatch(/New vote|murmuration/i));
});
