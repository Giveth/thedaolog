// Frontend client for the signed-ballot API (server/api.mjs). Wraps
// proposal CRUD, EIP-712 signing via wagmi, and tally/ballots reads.
//
// All endpoints sit behind the same origin (vite proxies /api/* to the
// Fastify server on :7101), so no CORS dance and no separate funnel
// port to manage.

import { mainnet } from "viem/chains";
import type { WalletClient } from "viem";

export interface VoteOption {
  id: number;
  label: string;
}

export interface Proposal {
  id: string;
  title: string;
  description: string;
  votingMode: "quadratic" | "token-weight";
  budget: number;
  options: VoteOption[];
  deadline: string; // ISO
  tokenId: string | null; // legacy registry id (server may have a hardcoded entry)
  tokenAddress?: `0x${string}` | null; // eligibility-token contract — preferred over tokenId
  tokenChainId?: number | null; // chain the token lives on (mainnet=1, arbitrum=42161)
  createdAt: string;
  createdBy: string | null;
  deletedOptionIds?: number[]; // soft-deleted option ids; allocations to these refund
}

export interface Allocation {
  issueId: number;
  points: number;
}

export interface Ballot {
  voter: `0x${string}`;
  proposalId: string;
  allocations: Allocation[];
  budget: number;
  deadline: number; // unix seconds
  nonce: number;
}

export interface StoredBallot {
  ballot: Ballot;
  signature: `0x${string}`;
  signedAt: string;
  badgeBalance: string;
}

// EIP-712 domain. chainId is Ethereum mainnet (1) because that's the
// chain wagmi is configured to connect wallets to. Signatures are
// off-chain (verified server-side via viem's verifyTypedData) so this
// isn't tied to where the badge contract lives — it just needs to
// match the wallet's active chain at sign time, otherwise the wallet
// refuses with "Provided chainId X must match active chainId Y".
const DOMAIN = {
  name: "theDAOlog",
  version: "1",
  chainId: mainnet.id,
} as const;

const TYPES = {
  Allocation: [
    { name: "issueId", type: "uint256" },
    { name: "points", type: "uint256" },
  ],
  Ballot: [
    { name: "voter", type: "address" },
    { name: "proposalId", type: "string" },
    { name: "allocations", type: "Allocation[]" },
    { name: "budget", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

// Admin actions (create / delete proposal) are also EIP-712 signed.
// Server verifies the recovered signer is in its admin allowlist.
const ADMIN_ACTION_TYPES = {
  AdminAction: [
    { name: "action", type: "string" },
    { name: "proposalId", type: "string" },
    { name: "actor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

// Same idea but for soft-deleting an individual option (issue) inside a
// vote. Carries optionId in the signed payload so a captured admin sig
// can't be replayed against a different option in the same proposal.
const OPTION_DELETE_TYPES = {
  OptionDelete: [
    { name: "action", type: "string" },
    { name: "proposalId", type: "string" },
    { name: "optionId", type: "uint256" },
    { name: "actor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

// Issue submissions are EIP-712 signed by the submitter and verified
// against the proposal's eligibility-badge balanceOf check server-side.
const ISSUE_SUBMISSION_TYPES = {
  IssueSubmission: [
    { name: "submitter", type: "address" },
    { name: "proposalId", type: "string" },
    { name: "label", type: "string" },
    { name: "body", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

async function signAdminAction(
  walletClient: WalletClient,
  actor: `0x${string}`,
  action: "create_proposal" | "delete_proposal",
  proposalId: string,
): Promise<{ action: object; signature: `0x${string}` }> {
  const nonce = Date.now();
  const deadline = Math.floor(Date.now() / 1000) + 5 * 60; // 5 min signing window
  const message = {
    action,
    proposalId,
    actor,
    nonce: BigInt(nonce),
    deadline: BigInt(deadline),
  };
  const signature = await walletClient.signTypedData({
    account: actor,
    domain: DOMAIN,
    types: ADMIN_ACTION_TYPES,
    primaryType: "AdminAction",
    message,
  });
  return {
    action: { action, proposalId, actor, nonce, deadline },
    signature,
  };
}

export async function fetchProposals(): Promise<Proposal[]> {
  const res = await fetch("/api/proposals");
  if (!res.ok) throw new Error(`fetchProposals: ${res.status}`);
  const j = await res.json();
  return j.proposals || [];
}

export async function fetchProposal(id: string): Promise<{
  proposal: Proposal;
  tally: Record<string, number>;
  voterCount: number;
}> {
  const res = await fetch(`/api/proposals/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`fetchProposal: ${res.status}`);
  return res.json();
}

export async function fetchBallots(id: string): Promise<StoredBallot[]> {
  const res = await fetch(`/api/proposals/${encodeURIComponent(id)}/ballots`);
  if (!res.ok) throw new Error(`fetchBallots: ${res.status}`);
  const j = await res.json();
  return j.ballots || [];
}

export async function deleteOption(
  proposalId: string,
  optionId: number,
  walletClient: WalletClient,
  actor: `0x${string}`,
): Promise<void> {
  const nonce = Date.now();
  const deadline = Math.floor(Date.now() / 1000) + 5 * 60;
  const message = {
    action: "delete_option",
    proposalId,
    optionId: BigInt(optionId),
    actor,
    nonce: BigInt(nonce),
    deadline: BigInt(deadline),
  };
  const signature = await walletClient.signTypedData({
    account: actor,
    domain: DOMAIN,
    types: OPTION_DELETE_TYPES,
    primaryType: "OptionDelete",
    message,
  });
  const optionDeleteAuth = {
    action: { action: "delete_option", proposalId, optionId, actor, nonce, deadline },
    signature,
  };
  const res = await fetch(
    `/api/proposals/${encodeURIComponent(proposalId)}/options/${encodeURIComponent(String(optionId))}`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ optionDeleteAuth }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`deleteOption: ${res.status} ${err.error || ""}`);
  }
}

export async function deleteProposal(
  id: string,
  walletClient: WalletClient,
  actor: `0x${string}`,
): Promise<void> {
  const adminAuth = await signAdminAction(walletClient, actor, "delete_proposal", id);
  const res = await fetch(`/api/proposals/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminAuth }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`deleteProposal: ${res.status} ${err.error || ""}`);
  }
}

export async function fetchGithubPreview(url: string): Promise<{
  number: number;
  html_url: string;
  title: string;
  body: string;
  labels: string[];
}> {
  const res = await fetch(`/api/github/preview?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`preview: ${res.status} ${err.error || ""} ${err.detail || ""}`);
  }
  return res.json();
}

export async function addOption(
  proposalId: string,
  label: string,
  body: string,
  walletClient: WalletClient,
  submitter: `0x${string}`,
  githubUrl?: string,
): Promise<{ option: VoteOption; proposal: Proposal }> {
  const nonce = Date.now();
  const deadline = Math.floor(Date.now() / 1000) + 5 * 60; // 5 min signing window
  const submission = { submitter, proposalId, label, body: body || "", nonce, deadline };
  const signature = await walletClient.signTypedData({
    account: submitter,
    domain: DOMAIN,
    types: ISSUE_SUBMISSION_TYPES,
    primaryType: "IssueSubmission",
    message: {
      submitter,
      proposalId,
      label,
      body: body || "",
      nonce: BigInt(nonce),
      deadline: BigInt(deadline),
    },
  });
  const res = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/options`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label, body, submission, signature, githubUrl: githubUrl || undefined }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`addOption: ${res.status} ${err.error || ""}`);
  }
  return res.json();
}

export async function createProposal(
  input: {
    id: string;
    title: string;
    description?: string;
    votingMode: "quadratic" | "token-weight";
    budget: number;
    options: VoteOption[];
    deadline: string;
    tokenId?: string | null;
    tokenAddress?: `0x${string}` | null;
    tokenChainId?: number | null;
  },
  walletClient: WalletClient,
  actor: `0x${string}`,
): Promise<Proposal> {
  const adminAuth = await signAdminAction(walletClient, actor, "create_proposal", input.id);
  const res = await fetch("/api/proposals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, adminAuth }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`createProposal: ${res.status} ${err.error || ""}`);
  }
  const j = await res.json();
  return j.proposal;
}

/**
 * Sign + submit a ballot. Throws on validation failures (over-budget,
 * not a badgeholder, etc.) — caller renders the error.
 */
export async function castVote(
  walletClient: WalletClient,
  voter: `0x${string}`,
  proposal: Proposal,
  allocations: Allocation[],
): Promise<{ ok: true; voter: `0x${string}` }> {
  const deadlineSec = Math.floor(new Date(proposal.deadline).getTime() / 1000);
  const ballot: Ballot = {
    voter,
    proposalId: proposal.id,
    allocations,
    budget: proposal.budget,
    deadline: deadlineSec,
    nonce: Date.now(),
  };

  const signature = await walletClient.signTypedData({
    account: voter,
    domain: DOMAIN,
    types: TYPES,
    primaryType: "Ballot",
    message: {
      voter,
      proposalId: ballot.proposalId,
      allocations: allocations.map((a) => ({
        issueId: BigInt(a.issueId),
        points: BigInt(a.points),
      })),
      budget: BigInt(ballot.budget),
      deadline: BigInt(ballot.deadline),
      nonce: BigInt(ballot.nonce),
    },
  });

  const res = await fetch(`/api/proposals/${encodeURIComponent(proposal.id)}/vote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ballot, signature }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`castVote ${res.status}: ${body.error || "unknown"}`);
  }
  return body;
}
