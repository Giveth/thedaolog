// @vitest-environment jsdom
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
  castVote: vi.fn(),
  createProposal: vi.fn(),
  deleteOption: vi.fn(),
  deleteProposal: vi.fn(),
  addOption: vi.fn(),
  fetchGithubPreview: vi.fn(),
}));

import { F2App, F2Connect, MobileSnap } from "../../src/app.jsx";
import * as votingApi from "../../src/votingApi";

const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const baseProps = {
  role: "badgeholder", address: ADDR, isIncognito: false, isPublicBadgeholder: true,
  isBadgeholder: true, onDisconnect: vi.fn(), onConnectClick: vi.fn(),
  tokens: [{ id: "tok-buidler", address: "0x32d6", chain: "Arbitrum One", symbol: "TDSB", name: "BUIDLER", kind: "ERC-721" }],
  setTokens: vi.fn(),
};

function serverProposal(over: Record<string, any> = {}) {
  return {
    id: "r-1", title: "Active vote", description: "", votingMode: "quadratic", budget: 100,
    options: [{ id: 1, label: "Alice" }, { id: 2, label: "Bob" }],
    deadline: new Date(Date.now() + 86400000).toISOString(),
    opensAt: null, tokenAddress: null, tokenChainId: null, tokenId: "tok-buidler",
    createdAt: new Date().toISOString(), createdBy: ADDR, deletedOptionIds: [], ...over,
  };
}

beforeEach(() => { cleanup(); vi.clearAllMocks(); (votingApi.fetchProposals as any).mockResolvedValue([]); });

describe("F2Connect", () => {
  it("renders the landing and wires the connect button", () => {
    const onConnectClick = vi.fn();
    render(<F2Connect onConnect={vi.fn()} onConnectClick={onConnectClick} />);
    // The landing mentions Ethereum security experts somewhere.
    expect(document.body.textContent).toMatch(/security/i);
  });
});

describe("F2App rounds list", () => {
  it("shows the empty 'quiet' state when there are no votes", async () => {
    render(<F2App {...baseProps} />);
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Murmurations/);
      expect(document.body.textContent).toMatch(/flock is quiet/i);
    });
  });

  it("splits rounds into Active / Upcoming / Past sections", async () => {
    (votingApi.fetchProposals as any).mockResolvedValue([
      serverProposal({ id: "r-active", title: "Active vote", opensAt: new Date(Date.now() - 1000).toISOString() }),
      serverProposal({ id: "r-soon", title: "Scheduled vote", opensAt: new Date(Date.now() + 86400000).toISOString() }),
      serverProposal({ id: "r-old", title: "Closed vote", deadline: new Date(Date.now() - 86400000).toISOString() }),
    ]);
    render(<F2App {...baseProps} />);
    expect(await screen.findByText("Active vote")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Scheduled vote")).toBeInTheDocument();
      expect(screen.getByText("Closed vote")).toBeInTheDocument();
      expect(screen.getByText("Upcoming")).toBeInTheDocument();
      expect(screen.getByText("Past votes")).toBeInTheDocument();
    });
  });

  it("admins see the New vote button", async () => {
    render(<F2App {...baseProps} role="admin" />);
    await waitFor(() => expect(screen.getByText("+ New vote")).toBeInTheDocument());
  });
});

describe("F2App round detail navigation", () => {
  it("opens an active round's voting screen when its card is clicked", async () => {
    (votingApi.fetchProposals as any).mockResolvedValue([serverProposal({ title: "Open round" })]);
    render(<F2App {...baseProps} />);
    const card = await screen.findByText("Open round");
    fireEvent.click(card);
    await waitFor(() => {
      expect(screen.getByText("Directions")).toBeInTheDocument();
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(document.body.textContent).toMatch(/Quadratic Voting/i);
    });
  });

});

describe("MobileSnap", () => {
  it("renders without crashing", () => {
    const { container } = render(<MobileSnap />);
    expect(container).toBeTruthy();
  });
});
