import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  coinbaseWallet,
  rainbowWallet,
  frameWallet,
  safeWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { mainnet, arbitrum } from "wagmi/chains";

// WalletConnect projectId. The placeholder is enough for injected
// wallets (Rabby, MetaMask, Frame, etc.) to work — those don't go
// through the WalletConnect relay. The WalletConnect QR flow for mobile
// wallets needs a real projectId from https://cloud.reown.com, set via
// VITE_WALLETCONNECT_PROJECT_ID (baked in at build time by Vite).
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "PLACEHOLDER";

// Only offer the WalletConnect option when a real projectId is present.
// Without one (or with a project whose allowed-origins list is missing
// this app's hostname) the WC relay returns 403 and the modal silently
// does nothing — a dead click. Gating on a real projectId keeps that
// option out of dev/placeholder builds while enabling it in production.
const hasRealProjectId = projectId !== "PLACEHOLDER" && projectId.length > 0;

const otherWallets = [rainbowWallet, coinbaseWallet, frameWallet, safeWallet];
if (hasRealProjectId) otherWallets.push(walletConnectWallet);

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [injectedWallet, rabbyWallet, metaMaskWallet],
    },
    {
      groupName: "Other",
      wallets: otherWallets,
    },
  ],
  { appName: "Murmuration", projectId },
);

// Arbitrum is included so on-chain reads (BUIDLER badge balanceOf for
// role derivation + F2Submit eligibility filter) can target the actual
// chain the badge contract lives on. The wallet itself can stay on
// mainnet — wagmi reads with explicit chainId don't require switching.
// Explicit CORS-friendly RPCs. wagmi's `http()` default for mainnet is
// `eth.merkle.io`, which doesn't return Access-Control-Allow-Origin from
// browser fetches — every read silently fails. PublicNode and Arbitrum's
// official RPC return wildcard CORS headers (verified 2026-05-12), so all
// reads (balanceOf for role derivation, totalSupply / contractURI for the
// registry) work in-browser.
//
// LlamaRPC was tried first but its Cloudflare frontend returns 503s
// intermittently — moved to PublicNode for stability.
export const wagmiConfig = createConfig({
  connectors,
  chains: [mainnet, arbitrum],
  transports: {
    [mainnet.id]: http("https://ethereum-rpc.publicnode.com"),
    [arbitrum.id]: http("https://arb1.arbitrum.io/rpc"),
  },
  ssr: false,
});
