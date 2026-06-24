// @vitest-environment jsdom
// Regression: the "No credits left" strip must fire on the issue DETAIL view
// when the user drags a direction's slider after the budget is fully spent.
// The detail slider was capped at the affordable max (0 when tapped out), so
// its range collapsed to 0..1 and onChange barely fired — the feedback never
// showed. The slider now spans the full round scale and setSafe clamps + flashes.
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
const sp = (o: any = {}) => ({
  id: "r-1", title: "T", description: "", votingMode: "quadratic", budget: 100,
  options: [{ id: 1, label: "Alice" }, { id: 2, label: "Bob" }],
  deadline: new Date(Date.now() + 86400000).toISOString(), opensAt: null,
  tokenAddress: null, tokenChainId: null, tokenId: "tok-buidler",
  createdAt: new Date().toISOString(), createdBy: ADDR, deletedOptionIds: [], ...o,
});

beforeEach(() => { cleanup(); });

it("shows the out-of-credits strip on the detail view when dragging past a spent budget", async () => {
  const p = sp({ id: "r-now", title: "Open round" });
  (votingApi.fetchProposals as any).mockResolvedValue([p]);
  (votingApi.fetchProposal as any).mockResolvedValue({ proposal: p, tally: {}, voterCount: 0 });
  render(<F2App {...props} />);

  // round → list
  fireEvent.click(await screen.findByText("Open round"));
  await screen.findByText("Directions");

  // open Alice, spend the whole 100-credit budget (10 pts = 100 credits)
  fireEvent.click(screen.getByText("Alice"));
  const aliceSlider = await screen.findByRole("slider");
  fireEvent.change(aliceSlider, { target: { value: "10" } });
  // no strip yet — that allocation was affordable
  expect(screen.queryByText(/No credits left/i)).toBeNull();

  // back to the list, open Bob (now 0 credits remain for Bob)
  fireEvent.click(screen.getByText(/Back/i));
  await screen.findByText("Directions");
  fireEvent.click(screen.getByText("Bob"));
  const bobSlider = await screen.findByRole("slider");

  // drag Bob past 0 — unaffordable → strip must appear
  fireEvent.change(bobSlider, { target: { value: "5" } });
  await waitFor(() => {
    expect(screen.getByText(/No credits left\. Lower another direction first\./i)).toBeInTheDocument();
  });
});
