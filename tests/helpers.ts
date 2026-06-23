import { privateKeyToAccount } from "viem/accounts";

// Deterministic Anvil test accounts. ADMIN is added to the server's allowlist
// via EXTRA_ADMIN_ADDRESSES in tests/setup.ts.
export const ADMIN_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const adminAccount = privateKeyToAccount(ADMIN_KEY);
export const ADMIN_ADDR = adminAccount.address; // 0xf39Fd6...92266

export const VOTER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
export const voterAccount = privateKeyToAccount(VOTER_KEY);
export const VOTER_ADDR = voterAccount.address; // 0x709979...79C8

export const STRANGER_KEY =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
export const strangerAccount = privateKeyToAccount(STRANGER_KEY);
export const STRANGER_ADDR = strangerAccount.address;

// Mirrors server/api.mjs DOMAIN + EIP-712 type definitions exactly.
export const DOMAIN = { name: "murmurations", version: "1", chainId: 1 } as const;

const BALLOT_TYPES = {
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

const ADMIN_ACTION_TYPES = {
  AdminAction: [
    { name: "action", type: "string" },
    { name: "proposalId", type: "string" },
    { name: "actor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

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

export const futureDeadline = () => Math.floor(Date.now() / 1000) + 600;
export const pastDeadline = () => Math.floor(Date.now() / 1000) - 600;

type Account = ReturnType<typeof privateKeyToAccount>;

// Returns the full { ballot, signature } body POST /:id/vote expects.
export async function makeBallot(
  account: Account,
  opts: { proposalId: string; allocations: { issueId: number; points: number }[]; budget: number; deadline?: number; nonce?: number },
) {
  const deadline = opts.deadline ?? futureDeadline();
  const nonce = opts.nonce ?? 0;
  const message = {
    voter: account.address,
    proposalId: opts.proposalId,
    allocations: opts.allocations.map((a) => ({ issueId: BigInt(a.issueId), points: BigInt(a.points) })),
    budget: BigInt(opts.budget),
    deadline: BigInt(deadline),
    nonce: BigInt(nonce),
  };
  const signature = await account.signTypedData({ domain: DOMAIN, types: BALLOT_TYPES, primaryType: "Ballot", message });
  return {
    ballot: { voter: account.address, proposalId: opts.proposalId, allocations: opts.allocations, budget: opts.budget, deadline, nonce },
    signature,
  };
}

// Returns the { action, signature } adminAuth object.
export async function makeAdminAuth(
  account: Account,
  opts: { action: string; proposalId: string; nonce?: number; deadline?: number },
) {
  const nonce = opts.nonce ?? 1;
  const deadline = opts.deadline ?? futureDeadline();
  const message = { action: opts.action, proposalId: opts.proposalId, actor: account.address, nonce: BigInt(nonce), deadline: BigInt(deadline) };
  const signature = await account.signTypedData({ domain: DOMAIN, types: ADMIN_ACTION_TYPES, primaryType: "AdminAction", message });
  return { action: { action: opts.action, proposalId: opts.proposalId, actor: account.address, nonce, deadline }, signature };
}

export async function makeOptionDeleteAuth(
  account: Account,
  opts: { proposalId: string; optionId: number; nonce?: number; deadline?: number },
) {
  const nonce = opts.nonce ?? 1;
  const deadline = opts.deadline ?? futureDeadline();
  const message = { action: "delete_option", proposalId: opts.proposalId, optionId: BigInt(opts.optionId), actor: account.address, nonce: BigInt(nonce), deadline: BigInt(deadline) };
  const signature = await account.signTypedData({ domain: DOMAIN, types: OPTION_DELETE_TYPES, primaryType: "OptionDelete", message });
  return { action: { action: "delete_option", proposalId: opts.proposalId, optionId: opts.optionId, actor: account.address, nonce, deadline }, signature };
}

export async function makeSubmission(
  account: Account,
  opts: { proposalId: string; label: string; body?: string; nonce?: number; deadline?: number },
) {
  const body = opts.body ?? "";
  const nonce = opts.nonce ?? 1;
  const deadline = opts.deadline ?? futureDeadline();
  const message = { submitter: account.address, proposalId: opts.proposalId, label: opts.label, body, nonce: BigInt(nonce), deadline: BigInt(deadline) };
  const signature = await account.signTypedData({ domain: DOMAIN, types: ISSUE_SUBMISSION_TYPES, primaryType: "IssueSubmission", message });
  return { submission: { submitter: account.address, proposalId: opts.proposalId, label: opts.label, body, nonce, deadline }, signature };
}
