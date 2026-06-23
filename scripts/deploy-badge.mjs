// Deploy TheDAOSecurityBadge to Arbitrum One. Reads the deployer key
// from DEPLOYER_PRIVATE_KEY or DEPLOYER_KEY_FILE. Idempotent-ish: prints address
// + tx hash + Arbiscan link on success. Run this once per chain.
//
// Usage: node scripts/deploy-badge.mjs
//   ADMIN_ADDRESS    override (default: the admin wallet)
//   METADATA_URI     override (default: TheDAOlog funnel /badge.json)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { getContractsLogFile, readDeployerKey } from "./deployer-key.mjs";
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const ADMIN = process.env.ADMIN_ADDRESS ?? "0x72315dddeb862cD484b9F37d37952eC9080557cd";
const METADATA_URI = process.env.METADATA_URI ?? "https://desktop-dvvupq4.tail301743.ts.net:10000/badge.json";

// ---- compile ----
const sourcePath = path.join(ROOT, "contracts", "TheDAOSecurityBadge.sol");
const source = fs.readFileSync(sourcePath, "utf8");

const ozRoot = path.join(ROOT, "node_modules", "@openzeppelin");

function findImports(importPath) {
  // Resolve @openzeppelin/* imports to local node_modules.
  if (importPath.startsWith("@openzeppelin/")) {
    const rel = importPath.replace("@openzeppelin/", "");
    const full = path.join(ozRoot, rel);
    return { contents: fs.readFileSync(full, "utf8") };
  }
  return { error: "File not found: " + importPath };
}

const input = {
  language: "Solidity",
  sources: { "TheDAOSecurityBadge.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

console.log("▸ Compiling…");
const compiled = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (compiled.errors || []).filter((e) => e.severity === "error");
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
const warnings = (compiled.errors || []).filter((e) => e.severity === "warning");
if (warnings.length) for (const w of warnings) console.warn("  warn:", w.message);

const c = compiled.contracts["TheDAOSecurityBadge.sol"]["TheDAOSecurityBadge"];
const abi = c.abi;
const bytecode = "0x" + c.evm.bytecode.object;
console.log("  bytecode size:", (bytecode.length - 2) / 2, "bytes");

// ---- wallet ----
const { privateKey, address: deployerAddress } = readDeployerKey();
const account = privateKeyToAccount(privateKey);
if (deployerAddress && account.address.toLowerCase() !== deployerAddress.toLowerCase()) {
  throw new Error(`Key file address mismatch: ${account.address} vs ${deployerAddress}`);
}

const publicClient = createPublicClient({ chain: arbitrum, transport: http() });
const walletClient = createWalletClient({ account, chain: arbitrum, transport: http() });

// ---- preflight ----
const balance = await publicClient.getBalance({ address: account.address });
console.log(`▸ Deployer: ${account.address}  balance: ${formatEther(balance)} ETH on Arbitrum One`);
if (balance < 100000000000000n) {
  // < 0.0001 ETH ≈ 30¢ — not enough for safety margin
  throw new Error(`Insufficient balance for deploy. Have ${formatEther(balance)} ETH, recommend at least 0.0005 ETH.`);
}

console.log(`▸ Constructor args:`);
console.log(`    admin   = ${ADMIN}`);
console.log(`    minter  = ${account.address}`);
console.log(`    tokenURI= ${METADATA_URI}`);

// ---- deploy ----
console.log("▸ Sending deploy tx…");
const txHash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [ADMIN, account.address, METADATA_URI],
});
console.log(`  tx hash: ${txHash}`);
console.log(`  https://arbiscan.io/tx/${txHash}`);

console.log("▸ Waiting for receipt…");
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
if (receipt.status !== "success") {
  throw new Error(`Deploy failed. Receipt: ${JSON.stringify(receipt, null, 2)}`);
}

const contractAddress = receipt.contractAddress;
console.log(`✅ Contract deployed at ${contractAddress}`);
console.log(`   https://arbiscan.io/address/${contractAddress}`);
console.log(`   gas used: ${receipt.gasUsed.toString()}`);
console.log(`   effective gas price: ${receipt.effectiveGasPrice.toString()} wei`);
const cost = receipt.gasUsed * receipt.effectiveGasPrice;
console.log(`   total cost: ${formatEther(cost)} ETH`);

// ---- save deploy log ----
const logFile = getContractsLogFile();
fs.mkdirSync(path.dirname(logFile), { recursive: true });
let log = { contracts: [] };
if (fs.existsSync(logFile)) log = JSON.parse(fs.readFileSync(logFile, "utf8"));
log.contracts.push({
  name: "TheDAOSecurityBadge",
  chain: "arbitrum-one",
  chainId: 42161,
  address: contractAddress,
  deployer: account.address,
  admin: ADMIN,
  minter: account.address,
  metadataURI: METADATA_URI,
  txHash,
  blockNumber: receipt.blockNumber.toString(),
  deployedAt: new Date().toISOString(),
  abi,
});
fs.writeFileSync(logFile, JSON.stringify(log, null, 2));
console.log(`▸ Logged to ${logFile}`);
