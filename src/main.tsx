import * as React from "react";
import ReactDOM from "react-dom/client";
import { WagmiProvider, useAccount, useDisconnect, useReadContracts } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RainbowKitProvider,
  ConnectButton,
  useConnectModal,
  darkTheme,
} from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";

import { wagmiConfig } from "./wagmi";
import { F2App, F2Connect } from "./app.jsx";
import * as votingApi from "./votingApi";
import {
  DEFAULT_TOKEN_REGISTRY,
  ERC721_BALANCE_OF_ABI,
  loadTokenRegistry,
  saveTokenRegistry,
  type RegisteredToken,
} from "./eligibility";

// Legacy tokenId → {address, chainId} resolution, mirroring the server's
// KNOWN_ELIGIBILITY_TOKENS. Proposals created the old way carry a tokenId
// instead of an explicit tokenAddress+tokenChainId.
const LEGACY_TOKEN_BY_ID: Record<string, { address: `0x${string}`; chainId: number }> = {
  "tok-buidler": { address: "0x32d664ca9ea4bad60b2b8ed61dec30692df43ac9", chainId: 42161 },
};

// Hardcoded admin wallets. Lowercased so the comparison against
// `useAccount().address` is case-insensitive. These ship to prod and
// match the server's ADMIN_ADDRESSES allowlist (server/api.mjs).
//
// Additional per-environment admins can be added via
// VITE_EXTRA_ADMIN_ADDRESSES (comma-separated, baked in at build time)
// without editing this list.
const ADMIN_ADDRESSES = new Set<string>(
  [
    "0x839395e20bbb182fa440d08f850e6c7a8f6f0780", // Griff
    "0x72315dddeb862cd484b9f37d37952ec9080557cd", // Zep (also in server allowlist)
    ...String(import.meta.env.VITE_EXTRA_ADMIN_ADDRESSES || "")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean),
  ],
);

// How long to wait on a "connecting" status before assuming the wallet
// isn't going to respond (most often: extension is locked and the
// password prompt is hidden behind another window). EIP-1193 has no
// "wallet locked" event, so a timer is the only signal we have.
const CONNECT_TIMEOUT_MS = 60_000;

/**
 * Wallet gate. Pre-connect renders the design team's F2Connect landing
 * (the "200 experts. One signal. ETH Security." dual-pane screen), with
 * its "Connect Wallet" button rewired to RainbowKit's real modal. Once
 * a wallet connects, F2App takes over with role derived from the address
 * + on-chain balanceOf reads against the registered eligibility tokens.
 *
 * Includes a wallet-locked hint: when `useAccount().status` stays in
 * "connecting"/"reconnecting" for >CONNECT_TIMEOUT_MS, we surface a banner
 * pointing at the likely cause (locked extension) plus a Retry button.
 */
export function WalletGate(): React.ReactElement {
  const { address, isConnected, status } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  // Token registry — lifted out of F2App so it's the same source of
  // truth for role derivation here AND the eligibility filter inside
  // F2App's children. Persists to localStorage.
  const [tokens, setTokensState] = React.useState<RegisteredToken[]>(() => loadTokenRegistry());
  const setTokens = React.useCallback(
    (next: RegisteredToken[] | ((prev: RegisteredToken[]) => RegisteredToken[])) => {
      setTokensState((prev) => {
        const value = typeof next === "function" ? (next as (p: RegisteredToken[]) => RegisteredToken[])(prev) : next;
        saveTokenRegistry(value);
        return value;
      });
    },
    [],
  );

  // Badgeholder status is CONTEXTUAL: a wallet is a badgeholder only if
  // there is (or was) a vote whose eligibility token it holds. Holding a
  // badge with no vote that uses it does NOT make you a badgeholder. So
  // when an admin deletes the only vote that used a given badge, holders
  // of that badge stop being badgeholders. (Per Zep, 2026-06-03.)
  //
  // We fetch the proposal list, collect the DISTINCT eligibility tokens
  // those proposals require (each as address+chainId, resolving legacy
  // tokenIds), and check the wallet's balance of each. Eligible for any
  // one → badgeholder.
  const [proposals, setProposals] = React.useState<votingApi.Proposal[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    votingApi.fetchProposals()
      .then((ps) => { if (!cancelled) setProposals(ps); })
      .catch(() => { if (!cancelled) setProposals([]); });
    return () => { cancelled = true; };
  }, [address]);

  // Distinct eligibility tokens required by existing proposals, keyed
  // "chainId:address" so the same token on the same chain dedupes.
  const requiredTokens = React.useMemo(() => {
    const map = new Map<string, { address: `0x${string}`; chainId: number }>();
    for (const p of proposals) {
      let addr: string | null | undefined = p.tokenAddress;
      let chain: number | null | undefined = p.tokenChainId;
      if ((!addr || !chain) && p.tokenId && LEGACY_TOKEN_BY_ID[p.tokenId]) {
        addr = LEGACY_TOKEN_BY_ID[p.tokenId].address;
        chain = LEGACY_TOKEN_BY_ID[p.tokenId].chainId;
      }
      if (addr && chain) {
        map.set(`${chain}:${addr.toLowerCase()}`, { address: addr as `0x${string}`, chainId: Number(chain) });
      }
    }
    return Array.from(map.values());
  }, [proposals]);

  // balanceOf each required token on its own chain.
  const { data: balances } = useReadContracts({
    contracts: requiredTokens.map((t) => ({
      address: t.address,
      abi: ERC721_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: address ? [address] : undefined,
      chainId: t.chainId,
    })),
    query: { enabled: !!address && requiredTokens.length > 0 },
  });
  const isBadgeholder = React.useMemo(() => {
    if (!balances) return false;
    return balances.some((b) => b.status === "success" && typeof b.result === "bigint" && b.result > 0n);
  }, [balances]);

  // Two mainnet ETHSecurity-Badge contracts that grant badgeholder status:
  //   * Public badge — the named-bird identity each holder votes with.
  //     PFP comes from public/assets/pfp-mapping.json (200-holder snapshot).
  //   * Private badge — the anonymous/incognito-side mint. Wallets holding
  //     this NFT render the spy-starling PFP instead of their named one,
  //     and the isIncognito flag flows through to BadgePfp.
  // Both are dynamic balanceOf reads so new mints surface without any
  // redeploy of the static JSON snapshots.
  const PUBLIC_BADGE_CONTRACT = "0xf67c0ade41c607efebf198f9d6065ab1ec5ad4cd" as const;
  const PRIVATE_BADGE_CONTRACT = "0x3b49f45ec8796f64febb1ae0f5661791845ce35c" as const;
  const { data: mainnetBadgeBalances } = useReadContracts({
    contracts: [
      {
        address: PUBLIC_BADGE_CONTRACT,
        abi: ERC721_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
        chainId: 1,
      },
      {
        address: PRIVATE_BADGE_CONTRACT,
        abi: ERC721_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
        chainId: 1,
      },
    ],
    query: { enabled: !!address },
  });
  // isIncognito drives the spy-starling PFP for private-badge holders.
  // (The public-badge balance — mainnetBadgeBalances[0] — is no longer
  // read for role; badgeholder status comes from proposal-required tokens
  // above. The public badge still grants the role whenever a proposal
  // actually requires it, via requiredTokens.)
  const isIncognito = React.useMemo(() => {
    const b = mainnetBadgeBalances?.[1];
    return !!b && b.status === "success" && typeof b.result === "bigint" && b.result > 0n;
  }, [mainnetBadgeBalances]);
  // isPublicBadgeholder = holds the public ETHSecurity badge (mainnet
  // balance[0]). Used by the app to tell, per-round, whether the connected
  // wallet can act on a PUBLIC-badge-gated round and to label the connected
  // identity (🐦 Public vs 🕵️ Incognito). NOT part of the role gate — role
  // still comes from proposal-required tokens above.
  const isPublicBadgeholder = React.useMemo(() => {
    const b = mainnetBadgeBalances?.[0];
    return !!b && b.status === "success" && typeof b.result === "bigint" && b.result > 0n;
  }, [mainnetBadgeBalances]);

  const role: "visitor" | "badgeholder" | "admin" = React.useMemo(() => {
    if (!address) return "visitor";
    if (ADMIN_ADDRESSES.has(address.toLowerCase())) return "admin";
    // Badgeholder ONLY if eligible for an existing vote (isBadgeholder is
    // now computed from proposal-required tokens, above). Holding a badge
    // with no vote that uses it does not grant the role. isPublicBadgeholder
    // / isIncognito are intentionally NOT part of this gate anymore — they
    // only drive the PFP/incognito visual when the wallet IS a badgeholder.
    if (isBadgeholder) return "badgeholder";
    return "visitor";
  }, [address, isBadgeholder]);

  const [waitedTooLong, setWaitedTooLong] = React.useState(false);
  React.useEffect(() => {
    setWaitedTooLong(false);
    // Only arm the banner on user-initiated "connecting" — not on
    // wagmi's passive "reconnecting" auto-probe at page load. Otherwise
    // a sluggish wallet extension triggers the banner for users who
    // never clicked Connect.
    if (status === "connecting") {
      const t = setTimeout(() => setWaitedTooLong(true), CONNECT_TIMEOUT_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [status]);
  const handleRetry = React.useCallback(() => {
    setWaitedTooLong(false);
    disconnect();
    setTimeout(() => openConnectModal?.(), 150);
  }, [disconnect, openConnectModal]);

  // Aggressive disconnect: clear every layer (wagmi state, wagmi localStorage,
  // wallet permission). Without all three, switching wallets after disconnect
  // gets funky — wagmi auto-reconnects to the old connector, or MetaMask
  // returns the same account silently, or RainbowKit's modal hangs.
  const fullDisconnect = React.useCallback(async () => {
    // 1) EIP-2255: drop the site permission from the wallet itself.
    try {
      await (window as unknown as { ethereum?: { request?: (a: { method: string; params: unknown[] }) => Promise<unknown> } })
        .ethereum?.request?.({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
    } catch { /* wallet doesn't implement EIP-2255 — ignore */ }

    // 2) wagmi disconnect (clears connector state).
    disconnect();

    // 3) Nuke wagmi's persisted connector memory so it doesn't auto-reconnect
    //    or remember the previous wallet on the next Connect.
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("wagmi.") || k.startsWith("@w3m") || k.startsWith("@rainbow-me")) {
          localStorage.removeItem(k);
        }
      }
    } catch { /* private mode / quota — ignore */ }
  }, [disconnect]);

  // Two surfaces, path-routed:
  //   /        → F2Connect landing ("200 experts. One signal. ETH Security.")
  //   /votes…  → F2App (the working app, visitor mode allowed)
  // Sharing the bare domain shows the landing; sharing /votes or a deeper
  // path lands the recipient directly in the app for read-only browsing
  // or for a wallet connect inside the app's header.
  const [path, navigate] = useCurrentPath();
  const onLanding = path === "/";

  // Connect-driven auto-navigate: when a wallet transitions from
  // disconnected → connected while the user is on the landing, send
  // them into the app. We only fire on the transition (not on every
  // render with isConnected === true), so a returning user with an
  // auto-reconnected wallet still sees the landing if they navigate
  // back to /.
  const wasConnectedRef = React.useRef(isConnected);
  React.useEffect(() => {
    const justConnected = !wasConnectedRef.current && isConnected;
    wasConnectedRef.current = isConnected;
    if (onLanding && justConnected) navigate("/votes");
  }, [onLanding, isConnected, navigate]);

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}>
      {onLanding ? (
        <F2Connect
          onConnect={() => navigate("/votes")}
          onConnectClick={() => {
            // RainbowKit's openConnectModal returns undefined when a
            // wallet is already connected — in that case the visitor
            // doesn't need to connect, just enter the app.
            if (openConnectModal) openConnectModal();
            else navigate("/votes");
          }}
        />
      ) : (
        <F2App
          role={role}
          address={address}
          isIncognito={isIncognito}
          isPublicBadgeholder={isPublicBadgeholder}
          isBadgeholder={isBadgeholder}
          tokens={tokens}
          setTokens={setTokens}
          onDisconnect={fullDisconnect}
          onConnectClick={openConnectModal}
        />
      )}
      {waitedTooLong && !isConnected && (
        <WalletLockedHint
          onRetry={handleRetry}
          onDismiss={() => setWaitedTooLong(false)}
        />
      )}
    </div>
  );
}

/**
 * Minimal pathname router. window.location.pathname is the source of
 * truth; pushState updates it without a full reload; popstate listens
 * for back/forward.
 */
export function useCurrentPath(): [string, (next: string) => void] {
  const [path, setPath] = React.useState<string>(
    () => (typeof window === "undefined" ? "/" : window.location.pathname || "/"),
  );
  React.useEffect(() => {
    const onPop = () => setPath(window.location.pathname || "/");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = React.useCallback((next: string) => {
    if (typeof window === "undefined") return;
    if (next === window.location.pathname) return;
    window.history.pushState({}, "", next);
    setPath(next);
  }, []);
  return [path, navigate];
}

/**
 * Banner overlay that surfaces during a stuck connect — the most common
 * cause is a locked browser-wallet extension. Sits above the landing
 * (z-index over RainbowKit's modal too) so the user sees it whether
 * they left the modal open or closed it.
 */
export function WalletLockedHint({
  onRetry,
  onDismiss,
}: {
  onRetry: () => void;
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <div
      style={{
        position: "fixed",
        top: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 100000,
        maxWidth: 520,
        background: "rgba(20, 46, 74, 0.96)",
        border: "1px solid rgba(218,165,32,0.35)",
        borderRadius: 14,
        boxShadow: "0 18px 48px -12px rgba(0,0,0,0.6)",
        padding: "16px 20px",
        color: "white",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
      role="alert"
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "rgb(218,165,32)",
          marginBottom: 6,
        }}
      >
        Wallet didn't respond
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 14 }}>
        It's been a minute with no answer from your wallet. Most often this
        means the extension is <b>locked</b> — open MetaMask / Rabby from your
        browser toolbar, enter your password, then retry.
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={onDismiss}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.25)",
            color: "rgba(255,255,255,0.85)",
            padding: "6px 14px",
            borderRadius: 8,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Keep waiting
        </button>
        <button
          onClick={onRetry}
          style={{
            background: "rgb(255,60,56)",
            border: "none",
            color: "white",
            padding: "6px 14px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}

const queryClient = new QueryClient();

// App-wide error boundary. Without this, any throw during render — e.g. a
// bug inside a third-party component such as RainbowKit's WalletConnect QR
// encoder — unmounts the whole React tree and leaves a blank screen with no
// way out. The boundary catches it, keeps the page alive, and offers a
// reload instead of the white-screen-of-death.
export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("App crashed:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            background: "#0d1f33",
            color: "rgba(255,255,255,0.9)",
            fontFamily: "system-ui, sans-serif",
            padding: 24,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong.</div>
          <div style={{ fontSize: 13, opacity: 0.7, maxWidth: 420 }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "rgb(255,60,56)",
              border: "none",
              color: "white",
              padding: "8px 18px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Mount the app — but only in a real browser, not under the test runner
// (which imports this module to unit-test WalletGate via app.inject-style
// renders and must not auto-create a root). import.meta.env.VITEST is set by
// Vitest and undefined in the prod build, so prod always mounts.
const _rootEl = typeof document !== "undefined" ? document.getElementById("app") : null;
if (_rootEl && !import.meta.env.VITEST) {
  ReactDOM.createRoot(_rootEl).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <RainbowKitProvider theme={darkTheme()} appInfo={{ appName: "Murmuration" }}>
              <WalletGate />
            </RainbowKitProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}

// Silence unused-import warning until we surface a manual ConnectButton
// somewhere in the app (the in-flow F2Connect handles the pre-connect
// state; F2App's chrome calls disconnect()).
void ConnectButton;
void DEFAULT_TOKEN_REGISTRY;
