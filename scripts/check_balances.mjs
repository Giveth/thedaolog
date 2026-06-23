import {
  createPublicClient,
  http,
  getAddress,
} from "viem";
import { arbitrum } from "viem/chains";

const CONTRACT = "0x32d664ca9ea4bad60b2b8ed61dec30692df43ac9";

// Token-holder address list, 2026-05-20
const TODAY = [
  { name: "holder",      addr: "0x585c4d8f227AD78b0991176f0DF27d2393F7228d" },
  { name: "holder",    addr: "0x2d792c87C41131A3E6c13C83359E3C6Ab7D33Ed4" },
  { name: "holder",      addr: "0x29EE09Bd0f7f41EcD083Ad2708Df17691065790B" },
  { name: "holder", addr: "0xb0DDEa60ae36eFA8C298b46Ab342309FdFFd66cf" },
  { name: "holder", addr: "0xF6D7E64444b35fbA42876F6639A5Ae1d54f1f740" },
  { name: "holder",      addr: "0x839395e20bbb182fa440d08f850e6c7a8f6f0780" },
  { name: "holder",     addr: "0x0386C80880479B0Ddd0294FE8c0Cd9C0fCE8516E" },
  { name: "holder",        addr: "0xb760FE1bbC4A2752aBCBb28291a57Cb0cA99fF44" },
  { name: "holder",        addr: "0x9a5d42598eCca26E233AcbDfC0D38e46D153B289" },
  { name: "holder",     addr: "0x735CeEe359627C2176789B5AD23216dCb5f9849e" },
  { name: "holder",    addr: "0xb70A94dDaF521979FEC9Bb02Ab963F580E82cE0B" },
  { name: "holder",     addr: "0x6e7679d53C43a8A9E2cf87fCA99a1DB9B379FE29" },
  { name: "holder",        addr: "0x864af8991100d5E2Df52a3c7ae64db111E983D24" },
  { name: "holder",         addr: "0x17C8020dE84d4097b01387823f9D33Ff8E62577c" },
  { name: "holder",    addr: "0xA1179f64638adb613DDAAc32D918EB6BEB824104" },
  { name: "holder",       addr: "0x939E50655cf6dA7D643CFf8Cfa31c3033b16328A" },
  { name: "holder",      addr: "0x91eBbA819E4BbA03065a106290afcB44deB1F9d6" },
  { name: "holder",   addr: "0xA4D506434445Bb7303eA34A07bc38484cdC64a95" },
  { name: "holder",  addr: "0x6eb78c56f639b3d161456e9f893c8e8ad9d754f0" },
];

const abi = [
  { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "nextId", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
];

const pub = createPublicClient({ chain: arbitrum, transport: http() });
const next = await pub.readContract({ address: CONTRACT, abi, functionName: "nextId" });
console.log("nextId:", next.toString(), "(total minted ever)");
console.log("");
const needMint = [];
for (const r of TODAY) {
  const addr = getAddress(r.addr);
  const b = await pub.readContract({ address: CONTRACT, abi, functionName: "balanceOf", args: [addr] });
  const tag = b > 0n ? "HAS" : "—  ";
  console.log(`  ${tag}  ${r.name.padEnd(14)} ${addr}  bal=${b}`);
  if (b === 0n && !r.name.includes("OLD") && !r.name.includes("NEW")) needMint.push(r);
}
console.log("");
if (needMint.length === 0) {
  console.log("✅ Everyone in today's list holds a badge. Nothing to mint.");
} else {
  console.log("⚠️  Needs mint:");
  for (const r of needMint) {
    console.log(`  • ${r.name}  ${r.addr}`);
  }
}
