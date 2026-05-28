import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  coinbaseWallet,
  rainbowWallet,
  frameWallet,
  safeWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { mainnet, arbitrum } from "wagmi/chains";

// WalletConnect projectId. The placeholder is enough for injected
// wallets (Rabby, MetaMask, Frame, etc.) to work — those don't go
// through the WalletConnect relay. To enable the WalletConnect QR
// flow for mobile wallets, drop a real projectId from
// https://cloud.reown.com into VITE_WALLETCONNECT_PROJECT_ID.
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "PLACEHOLDER";

// walletConnectWallet is intentionally NOT in the connectors list. The
// Giveth Reown project (the only one we have a projectId for) doesn't
// have this app's tunnel hostname on its allowed-origins list, so the
// WalletConnect relay returns 403 and the modal silently does nothing
// when the user clicks WalletConnect. Until a Reown project is
// provisioned with the murmurations origin allowlisted, the WC option
// is removed from the modal to avoid the dead-click UX.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [injectedWallet, rabbyWallet, metaMaskWallet],
    },
    {
      groupName: "Other",
      wallets: [rainbowWallet, coinbaseWallet, frameWallet, safeWallet],
    },
  ],
  { appName: "theDAO/log", projectId },
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
