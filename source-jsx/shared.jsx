// Shared primitives + sample data used across all four flows.
// Exposes globals on `window` so each flow JSX file can use them.

const ISSUES = [
  {
    id: 1, num: 412,
    title: "Re-entrancy risk in StakingVault.withdraw via ERC-777 hook",
    repo: "ethereum/seal-audits",
    severity: "critical",
    area: "Staking",
    chain: "Mainnet",
    author: "samczsun",
    opened: "3d",
    comments: 28,
    bounty: "120,000 USDC",
    body: "ERC-777 token hooks allow the recipient to re-enter `withdraw()` before the `balances` mapping is updated. A malicious staker can drain up to 100% of the vault in a single transaction. Reproduced on local fork — PoC attached.",
    labels: ["high-impact", "staking", "needs-review"],
    yourVote: 0, totalVotes: 1820, voters: 87,
  },
  {
    id: 2, num: 408,
    title: "Signature malleability in `permit2` integration leaks allowances",
    repo: "uniswap/permit2-router",
    severity: "high",
    area: "Allowances",
    chain: "Mainnet, Base",
    author: "pcaversaccio",
    opened: "5d",
    comments: 41,
    bounty: "75,000 USDC",
    body: "The router accepts both low-s and high-s ECDSA signatures without canonicalizing. Combined with a stale `permit2` nonce window an attacker can replay an allowance approval cross-chain.",
    labels: ["signatures", "cross-chain"],
    yourVote: 0, totalVotes: 1410, voters: 71,
  },
  {
    id: 3, num: 405,
    title: "Oracle freshness check missing in lending market liquidation path",
    repo: "ethereum/seal-audits",
    severity: "critical",
    area: "Oracles",
    chain: "Arbitrum",
    author: "tayvano",
    opened: "1w",
    comments: 19,
    bounty: "200,000 USDC",
    body: "Liquidator path calls `oracle.latestAnswer()` without verifying `updatedAt`. During a sequencer outage stale prices can liquidate healthy positions. Suggested fix: require `block.timestamp - updatedAt < 30 min`.",
    labels: ["oracles", "l2", "liquidation"],
    yourVote: 0, totalVotes: 2240, voters: 104,
  },
  {
    id: 4, num: 401,
    title: "Front-running governance: timelock window allows MEV vote-bribery",
    repo: "thedao/governance",
    severity: "medium",
    area: "Governance",
    chain: "Mainnet",
    author: "vitalik",
    opened: "1w",
    comments: 64,
    bounty: "Discussion",
    body: "Two-day timelock + commit-reveal disabled means proposers can sandwich the queue with bribes to flip a marginal vote. Recommend extending the reveal window and adding a vote-encryption layer.",
    labels: ["governance", "mev"],
    yourVote: 0, totalVotes: 980, voters: 53,
  },
  {
    id: 5, num: 397,
    title: "Cross-chain message replay possible via low-fee Hyperlane mailbox",
    repo: "ethereum/bridge-review",
    severity: "high",
    area: "Bridges",
    chain: "Optimism, Polygon",
    author: "jordi.b",
    opened: "2w",
    comments: 33,
    bounty: "90,000 USDC",
    body: "Mailbox accepts processed message IDs as long as gas-payment is below threshold. Two stuck-then-replayed messages observed in mainnet logs.",
    labels: ["bridges", "messaging"],
    yourVote: 0, totalVotes: 1660, voters: 79,
  },
  {
    id: 6, num: 392,
    title: "Storage collision in upgradeable proxy when adding new mapping",
    repo: "openzeppelin/contracts-upgradeable",
    severity: "high",
    area: "Upgradeable",
    chain: "All",
    author: "frangio",
    opened: "2w",
    comments: 22,
    bounty: "50,000 USDC",
    body: "Layout audit shows a 1-slot drift between V2 and V3 when a new mapping is inserted before the gap. Slither-storage-layout misses it because the gap was renamed. Adding a layout-diff CI step.",
    labels: ["proxy", "upgrades"],
    yourVote: 0, totalVotes: 740, voters: 42,
  },
  {
    id: 7, num: 388,
    title: "Validator slashing edge case: double-sign on reorg above 2 epochs",
    repo: "ethereum/consensus-specs",
    severity: "medium",
    area: "Consensus",
    chain: "Beacon",
    author: "djrtwo",
    opened: "3w",
    comments: 56,
    bounty: "Discussion",
    body: "Slashable offense detector marks honest validators as double-signers when a deep reorg crosses an epoch boundary. Affects ~0.4% of slashings observed in shadow forks.",
    labels: ["consensus", "validators"],
    yourVote: 0, totalVotes: 1120, voters: 66,
  },
  {
    id: 8, num: 384,
    title: "Withdrawal queue griefing: spam exit messages stall finality",
    repo: "ethereum/withdrawals",
    severity: "low",
    area: "Withdrawals",
    chain: "Beacon",
    author: "pol.l",
    opened: "3w",
    comments: 14,
    bounty: "20,000 USDC",
    body: "An attacker controlling 0.1% of validators can spam exit requests to delay legitimate withdrawals by ~6 hours. Mitigations: rate-limit per-credential, charge anti-spam.",
    labels: ["queues", "spam"],
    yourVote: 0, totalVotes: 410, voters: 31,
  },
  {
    id: 9, num: 379,
    title: "ERC-4337 paymaster can be drained via revert-after-validation pattern",
    repo: "ethereum/account-abstraction",
    severity: "high",
    area: "Account Abstraction",
    chain: "Mainnet, Base, Arb",
    author: "alex.vds",
    opened: "4w",
    comments: 47,
    bounty: "60,000 USDC",
    body: "validatePaymasterUserOp returns a context the bundler trusts, but a callback during execution can revert after the paymaster has committed gas. Net result: paymaster pays for failed bundle.",
    labels: ["aa", "paymaster"],
    yourVote: 0, totalVotes: 1290, voters: 68,
  },
  {
    id: 10, num: 375,
    title: "Frontend: ENS reverse-record cache poisoning via malformed TXT record",
    repo: "ensdomains/ensjs",
    severity: "low",
    area: "Frontend",
    chain: "Mainnet",
    author: "alex.vds",
    opened: "5w",
    comments: 9,
    bounty: "10,000 USDC",
    body: "Reverse-resolver doesn't sanitize TXT records before caching. A malicious TXT can persist a phishing display name across libraries that share the cache.",
    labels: ["ens", "frontend"],
    yourVote: 0, totalVotes: 280, voters: 22,
  },
  {
    id: 11, num: 369,
    title: "Gas-grief: unbounded loop in batch claim makes claims unfeasible past N=400",
    repo: "thedao/distributor",
    severity: "medium",
    area: "Gas",
    chain: "Mainnet",
    author: "sample.g",
    opened: "6w",
    comments: 18,
    bounty: "15,000 USDC",
    body: "Batch claim iterates all unclaimed leaves; past N=400 the call exceeds 30M gas. Migration path: pull-pattern with merkle proof.",
    labels: ["gas", "merkle"],
    yourVote: 0, totalVotes: 520, voters: 38,
  },
  {
    id: 12, num: 360,
    title: "Tooling: Foundry `vm.warp` desync hides time-locked exploit windows",
    repo: "foundry-rs/foundry",
    severity: "info",
    area: "Tooling",
    chain: "All",
    author: "samczsun",
    opened: "7w",
    comments: 11,
    bounty: "Discussion",
    body: "vm.warp affects block.timestamp but not block.number. Tests asserting on both can pass while the corresponding mainnet condition fails. Documentation + test helper proposed.",
    labels: ["foundry", "tests"],
    yourVote: 0, totalVotes: 220, voters: 19,
  },
];

const BADGEHOLDERS = [
  { id: "vitalik",      name: "Vitalik Buterin",  org: "Ethereum Foundation", img: "assets/portraits/vitalik.png", votes: 12, allocated: 8400, rep: 9.8 },
  { id: "tayvano",      name: "Taylor Monahan",   org: "Metamask",            img: "assets/portraits/taylor.png",  votes: 18, allocated: 9100, rep: 9.6 },
  { id: "jordi",        name: "Jordi Baylina",    org: "ZisK",                img: "assets/portraits/jordi.png",   votes: 9,  allocated: 7200, rep: 9.4 },
  { id: "pcaversaccio", name: "pcaversaccio",     org: "SEAL 911",            img: "assets/portraits/pcaversaccio.png", votes: 24, allocated: 9800, rep: 9.9 },
  { id: "alex",         name: "Alex Van de Sande",org: "ENS",                 img: "assets/portraits/alex.png",    votes: 14, allocated: 8800, rep: 9.5 },
  { id: "sample",       name: "Sample Holder",    org: "Giveth",              img: "assets/portraits/sample.png",  votes: 11, allocated: 6900, rep: 9.1 },
  { id: "pol",          name: "Pol Lanski",       org: "Dappnode",            img: "assets/portraits/pol.png",     votes: 7,  allocated: 5400, rep: 8.9 },
];

// ── Common UI primitives ────────────────────────────────────────────

// Real theDAO logomark — red rounded square with white "Đ" (D-with-bar).
// Geometry mirrors /Export/Logomark from the Figma: 30% padding, the bar
// runs left-of-D and is overlapped by the D's vertical stem.
function DaoLogo({ size = 32, color = "rgb(255,60,56)", shadow = true }) {
  return (
    <span style={{
      display: "inline-block",
      width: size,
      height: size,
      background: color,
      borderRadius: size * 0.077, // 29.87/390 from Figma spec
      position: "relative",
      flexShrink: 0,
      boxShadow: shadow
        ? `0 ${size * 0.08}px ${size * 0.18}px -${size * 0.04}px rgba(0,0,0,0.45),
           0 ${size * 0.02}px ${size * 0.04}px rgba(0,0,0,0.25),
           inset 0 0 0 1px rgba(255,255,255,0.06)`
        : "none",
    }}>
      <span style={{
        position: "absolute",
        // place the D group with the same proportions as Figma:
        // group is 215.145×230.208 inside a 390×390 logomark
        left:   `${(88.02 / 390) * 100}%`,
        top:    `${(79.896 / 390) * 100}%`,
        width:  `${(215.145 / 390) * 100}%`,
        height: `${(230.208 / 390) * 100}%`,
      }}>
        {/* horizontal bar — runs from x=0, halfway down the group */}
        <span style={{
          position: "absolute",
          left:   0,
          top:    `${(104.235 / 230.208) * 100}%`,
          width:  `${(120.65 / 215.145) * 100}%`,
          height: `${(21.291 / 230.208) * 100}%`,
          background: "white",
        }} />
        {/* D glyph — sits on top of the bar */}
        <svg
          viewBox="0 0 190.322 230.208"
          preserveAspectRatio="xMidYMid meet"
          style={{
            position: "absolute",
            left:   `${(24.823 / 215.145) * 100}%`,
            top:    0,
            width:  `${(190.322 / 215.145) * 100}%`,
            height: "100%",
            color: "white",
            display: "block",
          }}
        >
          <path
            d="M 0 230.208 L 0 0 L 79.301 0 C 97.203 0 110.864 1.099 120.286 3.298 C 133.477 6.334 144.731 11.83 154.048 19.786 C 166.192 30.045 175.247 43.184 181.214 59.201 C 187.286 75.113 190.322 93.329 190.322 113.848 C 190.322 131.331 188.281 146.825 184.198 160.329 C 180.115 173.834 174.881 185.036 168.495 193.934 C 162.109 202.728 155.095 209.69 147.453 214.819 C 139.915 219.844 130.755 223.665 119.972 226.283 C 109.294 228.9 96.993 230.208 83.07 230.208 L 0 230.208 Z M 30.464 203.042 L 79.615 203.042 C 94.795 203.042 106.677 201.629 115.261 198.802 C 123.95 195.975 130.86 191.997 135.989 186.868 C 143.213 179.644 148.814 169.961 152.792 157.817 C 156.875 145.568 158.916 130.755 158.916 113.377 C 158.916 89.299 154.938 70.821 146.982 57.945 C 139.13 44.963 129.551 36.274 118.245 31.877 C 110.079 28.737 96.941 27.166 78.83 27.166 L 30.464 27.166 L 30.464 203.042 Z"
            fill="currentColor"
            fillRule="nonzero"
          />
        </svg>
      </span>
    </span>
  );
}

// Murmuration logotype — flock-Eth-diamond logomark + "Murmuration" wordmark.
// `light` swaps text + logo color to white for use on dark surfaces.
// `compact` drops the wordmark text and shows only the logo.
function Wordmark({ light = false, size = 32, compact = false }) {
  const fontSize = Math.round(size * 0.62);
  const textColor = light ? "white" : "rgb(44,94,134)";
  // Source logo is black-on-transparent; invert on dark surfaces.
  const logoFilter = light ? "invert(1) brightness(2)" : "none";
  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 0,
    }}>
      <img
        src="/assets/murmuration-logo.png"
        alt="Murmuration"
        style={{
          height: size * 1.4,
          width: "auto",
          filter: logoFilter,
          userSelect: "none",
          pointerEvents: "none",
        }}
      />
      {!compact && (
        <div style={{
          fontFamily: "'Inter Tight', 'Inter', sans-serif",
          fontSize,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: "-0.01em",
          color: textColor,
          whiteSpace: "nowrap",
        }}>
          Murmuration
        </div>
      )}
    </div>
  );
}

// Gold Ethereum Security Badge shield — the real PNG from the Figma asset
function ShieldGlyph({ withShadow = true }) {
  return (
    <img
      className="shield"
      src="assets/badge-shield.png"
      alt="Ethereum Security Badge"
      style={{
        width: "78%",
        height: "auto",
        position: "relative",
        zIndex: 2,
        filter: withShadow
          ? "drop-shadow(0 4px 14px rgba(0,0,0,0.55)) drop-shadow(0 1px 2px rgba(0,0,0,0.4))"
          : "none",
        userSelect: "none",
        pointerEvents: "none",
      }}
      draggable={false}
    />
  );
}

// Full medallion — the badge centered on a deep-blue disc with concentric
// "TheDAO Security Fund" text rings, exactly as in the Figma "Dao Badge Neon".
function BadgeMedallion({ size = 320, rings = true }) {
  const ringText = "TheDAO Security Fund · TheDAO Security Fund · TheDAO Security Fund · TheDAO Security Fund · ";
  return (
    <div style={{
      position: "relative",
      width: size,
      height: size,
      borderRadius: "50%",
      background: "radial-gradient(circle at 50% 45%, rgb(44,94,134) 0%, rgb(20,46,74) 60%, rgb(8,24,42) 100%)",
      boxShadow: "0 30px 80px -20px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(132,213,230,0.18), inset 0 0 60px rgba(132,213,230,0.08)",
      overflow: "hidden",
      flexShrink: 0,
    }}>
      {rings && (
        <>
          {/* outer ring */}
          <div style={{
            position: "absolute", inset: "5%",
            borderRadius: "50%",
            border: "1px solid rgba(162,238,250,0.35)",
          }} />
          {/* inner ring */}
          <div style={{
            position: "absolute", inset: "14%",
            borderRadius: "50%",
            border: "1px solid rgba(162,238,250,0.25)",
          }} />
          {/* curved text — using SVG textPath */}
          <svg viewBox="0 0 320 320" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
            <defs>
              <path id="ring-text-path" d="M 160,160 m -132,0 a 132,132 0 1,1 264,0 a 132,132 0 1,1 -264,0" />
            </defs>
            <text fill="rgba(205,224,240,0.7)" style={{
              fontFamily: "'Inter Tight', 'Inter', sans-serif",
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: "0.08em",
            }}>
              <textPath href="#ring-text-path" startOffset="0">{ringText}</textPath>
            </text>
          </svg>
        </>
      )}
      {/* shield centered */}
      <div style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <ShieldGlyph />
      </div>
    </div>
  );
}

// Square-pattern backdrop matching theDAO brand image — soft translucent rounded squares
function SquaresBackdrop({ density = 14, opacity = 1, tint = "light", withDaoMark = false, redEvery = 0, redOnly = false }) {
  const squares = [];
  for (let i = 0; i < density; i++) {
    const seed = i * 9301 + 49297;
    const x = ((seed % 100) + (i * 7) % 100) % 100;
    const y = ((seed * 3 % 100) + (i * 11) % 100) % 100;
    const s = 90 + ((seed * 5) % 220);
    const a = 0.04 + ((i % 5) * 0.014);
    const r = ((i * 13) % 18) - 9;
    squares.push({ x, y, s, a, r });
  }
  // Default tinting (unchanged behavior for existing callers)
  const fill = tint === "light"
    ? (a) => `rgba(180,210,235,${a * 1.4})`
    : (a) => `rgba(255,255,255,${a})`;
  // Red tint for branded squares (only used when redEvery > 0)
  const redFill = (a) => `rgba(255,60,56,${a * 1.6})`;
  return (
    <div className="dao-squares-bg" style={{ opacity }}>
      {squares.map((sq, i) => {
        const isRed = redEvery > 0 && i % redEvery === 0;
        // `redOnly` mode: skip rendering the non-red squares entirely
        // (used on the Murmuration landing to keep the bg lean — only the
        // branded red Đ squares show).
        if (redOnly && !isRed) return null;
        const bg = isRed ? redFill(sq.a) : fill(sq.a);
        return (
          <div key={i} className="sq" style={{
            left: `${sq.x}%`, top: `${sq.y}%`,
            width: sq.s, height: sq.s,
            background: bg,
            transform: `translate(-50%,-50%) rotate(${sq.r}deg)`,
            display: withDaoMark ? "flex" : undefined,
            alignItems: withDaoMark ? "center" : undefined,
            justifyContent: withDaoMark ? "center" : undefined,
          }}>
            {withDaoMark && (
              <div aria-hidden="true" style={{
                width: "55%",
                height: "55%",
                background: isRed ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.32)",
                WebkitMaskImage: "url(/assets/thedao-d-mark.png)",
                maskImage: "url(/assets/thedao-d-mark.png)",
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskPosition: "center",
                pointerEvents: "none",
                userSelect: "none",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// "Avatar" is now a gold shield badge — same call sites, branded look
function Avatar({ holder, size = 32, ring = false }) {
  // size may be a number or "100%"
  const isPct = typeof size === "string";
  return (
    <div
      className="dao-badge"
      style={{
        width: isPct ? size : size,
        height: isPct ? size : size,
        border: ring ? "2px solid white" : "none",
        boxShadow: ring ? "0 0 0 1px rgba(255,255,255,0.2), 0 4px 12px rgba(0,0,0,0.25)" : "none",
      }}>
      <ShieldGlyph />
    </div>
  );
}

function SevDot({ s }) {
  return <span className={`sev-dot sev-${s}`} title={s} />;
}

function SevTag({ s }) {
  const map = {
    critical: { bg: "rgba(255,60,56,0.10)", fg: "rgb(232,54,51)" },
    high: { bg: "rgba(247,144,9,0.12)",     fg: "rgb(180,95,5)" },
    medium: { bg: "rgba(244,198,36,0.18)",  fg: "rgb(140,100,8)" },
    low: { bg: "rgba(123,179,224,0.20)",    fg: "rgb(40,86,122)" },
    info: { bg: "rgba(160,168,180,0.18)",   fg: "rgb(85,92,104)" },
  };
  const c = map[s];
  return (
    <span className={`font-mono sev-tag sev-${s}`} style={{
      fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
      padding: "3px 7px", borderRadius: 4, background: c.bg, color: c.fg,
    }}>{s}</span>
  );
}

// theDAO branded backdrop — deep blue radial with floating squares (matches brand image)
function CuratorBackdrop() {
  return (
    <div style={{
      position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none",
      background: "radial-gradient(ellipse at 25% 20%, var(--dao-blue-700) 0%, var(--dao-blue-800) 38%, var(--dao-blue-900) 72%, var(--dao-blue-950) 100%)",
    }}>
      <SquaresBackdrop density={20} tint="light" />
    </div>
  );
}

// ── Rounds ───────────────────────────────────────────────────────────
// Multiple rounds run concurrently. Each has its own voting curve, budget,
// timeline, and issue set. Some are open-ended ("rolling") with no end date.

const ROUNDS = [
  {
    id: "r7",
    title: "Round 7 — ETH Mainnet Security",
    blurb: "Allocate 100 points across the most pressing security issues across L1, AA, and bridges.",
    voting: "quadratic",          // "quadratic" | "token-weight"
    budget: 100,                  // points or votes
    cap: 3,                       // submissions per holder
    opens: "2026-04-22 08:00 UTC",
    closes: "2026-05-03 20:00 UTC",
    rolling: false,
    status: "open",               // "draft" | "open" | "closed"
    voters: 142,
    issueIds: [1, 2, 3, 4, 5, 6, 9, 11],
    accent: "red",
  },
  {
    id: "r-rolling",
    title: "Continuous Bug Bounty Triage",
    blurb: "Open-ended ballot for incoming reports. Vote any time; tallies snapshot weekly.",
    voting: "token-weight",
    budget: 100,                  // 100 votes per holder, distributed freely
    cap: 5,
    opens: "2026-01-01 00:00 UTC",
    closes: null,
    rolling: true,
    status: "open",
    voters: 89,
    issueIds: [8, 10, 12, 7],
    accent: "blue",
  },
  {
    id: "r-l2",
    title: "L2 Sequencer Safety",
    blurb: "Targeted round for sequencer / forced-inclusion issues across major rollups.",
    voting: "quadratic",
    budget: 100,
    cap: 2,
    opens: "2026-04-29 12:00 UTC",
    closes: "2026-05-13 12:00 UTC",
    rolling: false,
    status: "open",
    voters: 47,
    issueIds: [3, 5, 9, 7],
    accent: "gold",
  },
  {
    id: "r6",
    title: "Round 6 — Validator & Consensus",
    blurb: "Closed. Final allocations published on-chain.",
    voting: "quadratic",
    budget: 100,
    cap: 3,
    opens: "2026-03-08 08:00 UTC",
    closes: "2026-03-22 20:00 UTC",
    rolling: false,
    status: "closed",
    voters: 184,
    issueIds: [7, 11, 12, 4],
    accent: "blue",
  },
];

Object.assign(window, {
  ISSUES, BADGEHOLDERS, ROUNDS,
  DaoLogo, Wordmark, Avatar, SevDot, SevTag, CuratorBackdrop, SquaresBackdrop, ShieldGlyph, BadgeMedallion,
});
