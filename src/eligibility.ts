// Shared token-eligibility helpers for Murmuration.
//
// Right now the only registered eligibility token is the Giveth BUIDLER
// badge on Arbitrum One — the contract we deployed at
// 0x32d664ca9ea4bad60b2b8ed61dec30692df43ac9. Admin can add more via the
// in-app token registry; new entries persist to localStorage and are
// picked up on next mount by the role-derivation hook below.
//
// Eligibility check is ERC-721 only (balanceOf(address) → uint256). If
// admin registers an ERC-1155 or ERC-20 contract we treat it as
// non-eligible until a typed reader is added.

import type { Abi } from "viem";

export interface RegisteredToken {
  id: string;
  address: `0x${string}`;
  chain: string;
  symbol: string;
  name: string;
  kind: "ERC-721" | "ERC-1155" | "ERC-20";
  holders?: number;
  isDefault?: boolean;
}

export const ERC721_BALANCE_OF_ABI: Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address", name: "owner" }],
    outputs: [{ type: "uint256" }],
  },
];

// totalSupply() — for live "tokens issued" reads on the eligibility
// registry. For ERC-721 with 1-NFT-per-wallet badges, totalSupply
// equals unique holders (which is what the registry display claims).
// ERC-1155 has a different totalSupply(id) signature — skipped.
export const TOTAL_SUPPLY_ABI: Abi = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
];

// Display-name → wagmi chainId. Must match the chains array in wagmi.ts;
// unknown chains return undefined and the totalSupply read is skipped.
// Keys are lowercased on lookup via resolveChainId() — case- and
// punctuation-tolerant since admins type chain names by hand.
export const CHAIN_NAME_TO_ID: Record<string, number> = {
  "Ethereum": 1,
  "ethereum": 1,
  "Mainnet": 1,
  "mainnet": 1,
  "Eth": 1,
  "ETH": 1,
  "Arbitrum": 42161,
  "Arbitrum One": 42161,
  "arbitrum": 42161,
  "arbitrum one": 42161,
};

/** Resolve a free-text chain name to a chainId, or null if unknown. */
export function resolveChainId(chainName: string | undefined | null): number | null {
  if (!chainName) return null;
  const trimmed = chainName.trim();
  return CHAIN_NAME_TO_ID[trimmed] ?? CHAIN_NAME_TO_ID[trimmed.toLowerCase()] ?? null;
}

/**
 * Default registry seeded into the app on first run. Admin can add more
 * contracts via the UI; their state then lives in localStorage.
 */
export const DEFAULT_TOKEN_REGISTRY: RegisteredToken[] = [
  {
    id: "tok-buidler",
    address: "0x32d664ca9ea4bad60b2b8ed61dec30692df43ac9",
    chain: "Arbitrum One",
    symbol: "TDSB",
    name: "Giveth BUIDLER",
    kind: "ERC-721",
    isDefault: true,
  },
];

const STORAGE_KEY = "thedaolog:tokenRegistry";

export function loadTokenRegistry(): RegisteredToken[] {
  if (typeof localStorage === "undefined") return DEFAULT_TOKEN_REGISTRY;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TOKEN_REGISTRY;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return DEFAULT_TOKEN_REGISTRY;
  } catch {
    return DEFAULT_TOKEN_REGISTRY;
  }
}

export function saveTokenRegistry(tokens: RegisteredToken[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}
