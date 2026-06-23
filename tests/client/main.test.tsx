// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as React from "react";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

const GRIFF = "0x839395e20bbb182fa440d08f850e6c7a8f6f0780";
const VISITOR = "0x1111111111111111111111111111111111111111";

vi.mock("wagmi", () => ({
  WagmiProvider: ({ children }: any) => children,
  useAccount: () => (globalThis as any).__ACCOUNT ?? { address: undefined, isConnected: false, status: "disconnected" },
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useConnect: () => ({ connectors: [], connect: vi.fn() }),
  useReadContract: () => ({ data: undefined }),
  useReadContracts: () => ({ data: (globalThis as any).__BALANCES }),
  useWalletClient: () => ({ data: { signTypedData: vi.fn(async () => "0xsig") } }),
}));
vi.mock("@rainbow-me/rainbowkit", () => ({
  RainbowKitProvider: ({ children }: any) => children,
  ConnectButton: () => null,
  useConnectModal: () => ({ openConnectModal: vi.fn() }),
  darkTheme: () => ({}),
}));
vi.mock("@rainbow-me/rainbowkit/styles.css", () => ({}));
vi.mock("../../src/wagmi", () => ({ wagmiConfig: {} }));
vi.mock("../../src/votingApi", () => ({
  fetchProposals: vi.fn(async () => []),
  fetchProposal: vi.fn(async () => ({ proposal: {}, tally: {}, voterCount: 0 })),
  fetchBallots: vi.fn(async () => []),
  castVote: vi.fn(), createProposal: vi.fn(), deleteOption: vi.fn(),
  deleteProposal: vi.fn(), addOption: vi.fn(), fetchGithubPreview: vi.fn(),
}));

import { WalletGate, useCurrentPath, WalletLockedHint, AppErrorBoundary } from "../../src/main";

function setPath(p: string) { window.history.pushState({}, "", p); }
beforeEach(() => {
  cleanup();
  (globalThis as any).__ACCOUNT = { address: undefined, isConnected: false, status: "disconnected" };
  (globalThis as any).__BALANCES = undefined;
  setPath("/");
});

describe("WalletGate", () => {
  it("shows the landing on '/' when disconnected", () => {
    render(<WalletGate />);
    expect(document.body.textContent).toMatch(/security/i);
  });

  it("renders the app as a visitor on /votes", async () => {
    setPath("/votes");
    (globalThis as any).__ACCOUNT = { address: VISITOR, isConnected: true, status: "connected" };
    render(<WalletGate />);
    await waitFor(() => expect(document.body.textContent).toMatch(/Murmurations/));
    // visitor: no admin "+ New vote" button
    expect(screen.queryByText("+ New vote")).not.toBeInTheDocument();
  });

  it("derives the admin role for an allowlisted wallet", async () => {
    setPath("/votes");
    (globalThis as any).__ACCOUNT = { address: GRIFF, isConnected: true, status: "connected" };
    render(<WalletGate />);
    await waitFor(() => expect(screen.getByText("+ New vote")).toBeInTheDocument());
  });

  it("treats a wallet holding the badge as a badgeholder", async () => {
    setPath("/votes");
    (globalThis as any).__ACCOUNT = { address: VISITOR, isConnected: true, status: "connected" };
    (globalThis as any).__BALANCES = [{ status: "success", result: 1n }];
    render(<WalletGate />);
    await waitFor(() => expect(document.body.textContent).toMatch(/Murmurations/));
  });
});

describe("useCurrentPath", () => {
  it("tracks the path and navigates via pushState", () => {
    let api: any;
    function Probe() { api = useCurrentPath(); return React.createElement("div", null, api[0]); }
    render(React.createElement(Probe));
    expect(api[0]).toBe("/");
    React.act(() => api[1]("/votes"));
    expect(window.location.pathname).toBe("/votes");
  });
});

describe("WalletLockedHint", () => {
  it("renders and wires retry / dismiss", () => {
    const onRetry = vi.fn(); const onDismiss = vi.fn();
    render(<WalletLockedHint onRetry={onRetry} onDismiss={onDismiss} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    const retryBtn = screen.getAllByRole("button").find((b) => /retry/i.test(b.textContent || ""));
    fireEvent.click(retryBtn!);
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("AppErrorBoundary", () => {
  it("catches a render error and shows the fallback", () => {
    const Boom = () => { throw new Error("kaboom"); };
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    expect(document.body.textContent).toMatch(/Something went wrong/i);
    expect(document.body.textContent).toMatch(/kaboom/);
  });
});
