// theDAO/log — Token Budget Allocator
// Multi-round voting with role-based access:
//   visitor   → connect any wallet, browse rounds, see votes (read-only)
//   badgeholder → vote + submit issues
//   admin     → create / edit rounds + everything above
// Rounds run concurrently; some are time-boxed, some rolling/open-ended.

const F2 = (() => {
  const { useState, useMemo } = React;

  // ── Role helpers ─────────────────────────────────────────────────
  // The connect screen lets you pick which wallet to mock; downstream
  // gates are driven by `role`.
  const ROLE_LABEL = {
    visitor:    "Visitor",
    badgeholder:"Badge holder",
    admin:      "Admin",
  };

  const canVote   = (r) => r === "badgeholder" || r === "admin";
  const canSubmit = (r) => r === "badgeholder" || r === "admin";
  const canAdmin  = (r) => r === "admin";

  // ── Top chrome ───────────────────────────────────────────────────
  function F2Chrome({ active, onNav, role, address, isIncognito, onDisconnect, onConnectClick, connected, children }) {
    // Submit tab intentionally omitted — issues are added from inside the
    // vote ("+ Add issue") and that route already pre-targets the current
    // round, so a standalone Submit tab is redundant noise.
    const items = [
      ["rounds",  "Murmurations"],
      ["ballot",  "My murmur",canVote(role)],
      ["admin",   "Admin",    canAdmin(role)],
    ].filter(x => x[2] !== false);
    // Đ-flock wallpaper — centroid-based clustering for a real
    // murmuration feel (dense cores, thinning at the edges). Each
    // centroid spawns squares around itself with distance-based size +
    // alpha falloff.
    //
    // Safe zones (squares NEVER appear here):
    //   - LEFT column (x < 32, y ∈ [8, 80]): covers vote-detail sidebar
    //     (title, donut, info card, ✓ Murmur on file, X murmurs remaining,
    //     ⚠️ "Your vote was invalidated" alert) AND every page's top-left
    //     heading + subtitle ("Votes", "My ballot", "Manage votes").
    //   - TOP-RIGHT band (x ∈ [32, 97], y < 26): covers right-side page
    //     headings ("What's on the ballot"), the red ETHSecurity-badge
    //     alert banner, AND the top-right action buttons ("+ Add a
    //     direction", "+ New vote").
    //   - SECONDARY left-heading band (x < 32, y ∈ [34, 48]): covers
    //     the "Past votes" heading on the rounds-list screen.
    // Card-backed content (option cards, info boxes, past-vote cards)
    // has solid backgrounds that occlude anything behind them, so we
    // don't need to exclude those regions.
    const _appDaoSquares = (() => {
      const rand = (i) => {
        const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
        return v - Math.floor(v);
      };
      // Centroids placed in the safe-to-flock zones: bottom band,
      // mid-right (behind cards but the cards occlude), far-right
      // corner. Top-corners removed — they always overlapped headings.
      const centroids = [
        { cx: 70, cy: 80, r: 22 },   // big bottom-right cloud (primary)
        { cx: 92, cy: 55, r: 12 },   // right edge mid
        { cx: 16, cy: 90, r: 12 },   // bottom-left tip
        { cx: 50, cy: 90, r: 18 },   // bottom-center cloud
        { cx: 60, cy: 60, r: 18 },   // mid-right (occluded by cards)
      ];
      const inSafeZone = (x, y) =>
        // Left column + sidebar
        (x < 32 && y >= 8 && y <= 80) ||
        // Top-right band (heading, alert, action buttons)
        (x >= 32 && x <= 97 && y < 26) ||
        // "Past votes" heading on /votes
        (x < 32 && y >= 34 && y <= 48);
      const out = [];
      let i = 0;
      let centroidIdx = 0;
      while (out.length < 180 && i < 20000) {
        i++;
        const c = centroids[centroidIdx % centroids.length];
        centroidIdx++;
        const u1 = rand(i * 3), u2 = rand(i * 5), u3 = rand(i * 7);
        const u4 = rand(i * 11), u5 = rand(i * 13), u6 = rand(i * 17);
        const dx = ((u1 + u2 + u3) - 1.5) * 2 * c.r;
        const dy = ((u4 + u5 + u6) - 1.5) * 2 * c.r;
        const x = c.cx + dx;
        const y = c.cy + dy;
        if (x < 1 || x > 99 || y < 6 || y > 96) continue;
        if (inSafeZone(x, y)) continue;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const falloff = Math.max(0, 1 - dist / (c.r * 1.4));
        const sz = 18 + Math.floor(falloff * 60 + rand(i * 19) * 20);
        const alpha = 0.04 + falloff * 0.08;
        out.push({
          top: y.toFixed(2) + "%",
          left: x.toFixed(2) + "%",
          size: sz,
          rot: Math.floor(rand(i * 23) * 50) - 25,
          a: +alpha.toFixed(3),
        });
      }
      return out;
    })();
    return (
      <div className="dark-app" style={{ width: "100%", height: "100%", background: "var(--surface-app)", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
        {/* Đ-flock layer — sits behind header + content. Header has its
            own opaque bg + zIndex 10 so it occludes any squares that
            land near the top. Content cards have opaque bg too. The
            squares only "show" in the empty padding of the left rail. */}
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
          {_appDaoSquares.map((sq, i) => (
            <div key={i} style={{
              position: "absolute",
              top: sq.top,
              left: sq.left,
              width: sq.size,
              height: sq.size,
              background: `rgba(255,60,56,${sq.a})`,
              transform: `translate(-50%,-50%) rotate(${sq.rot}deg)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 4,
              userSelect: "none",
            }}>
              <div style={{
                width: "55%",
                height: "55%",
                background: "rgba(255,255,255,0.55)",
                WebkitMaskImage: "url(/assets/thedao-d-mark.png)",
                maskImage: "url(/assets/thedao-d-mark.png)",
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskPosition: "center",
              }} />
            </div>
          ))}
        </div>
        <div style={{
          padding: "18px 40px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: "1px solid var(--stroke-line)",
          background: "var(--surface-elevated)",
          flexShrink: 0,
          position: "relative",
          zIndex: 10,
        }}>
          <div onClick={() => onNav("rounds")} style={{ cursor: "pointer" }}>
            <Wordmark size={44} light />
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {items.map(([k, l]) => (
              <button key={k} onClick={() => onNav(k)} className="font-display" style={{
                background: active === k ? "var(--dao-blue-900)" : "transparent",
                color: active === k ? "white" : "var(--dao-ink)",
                border: "none", cursor: "pointer",
                padding: "8px 14px", borderRadius: 999,
                fontWeight: 600, fontSize: 13,
              }}>{l}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {connected && (role === "badgeholder" || role === "admin")
              ? <BadgePfp address={address} role={role} isIncognito={isIncognito} />
              : <RoleChip role={role} />}
            {connected ? (
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onDisconnect}>Disconnect</button>
            ) : (
              <button className="btn btn-primary" style={{ fontSize: 12, padding: "6px 14px" }} onClick={onConnectClick}>Connect Wallet</button>
            )}
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", position: "relative", zIndex: 1 }}>
          {children}
        </div>
      </div>
    );
  }

  // PFP assignment — uses a frozen sorted-list snapshot of the 200
  // ETHSecurity badge holders so each holder gets a UNIQUE PFP (no
  // collisions). The mapping is generated by scripts/build-pfp-mapping.mjs
  // from on-chain Transfer events and cached as a static JSON.
  //
  // Addresses NOT in the snapshot fall back to:
  //   - the incognito PFP if they're on the anon-address list
  //     (public/assets/incognito-addresses.json), OR
  //   - the original BADGE HOLDER chip otherwise.
  let _pfpMapping = null; // { [lowerAddr]: index 1..200 } or null until fetched
  let _incognitoSet = null; // Set<lowerAddr> or null until fetched
  let _pfpDataPromise = null;
  function _ensurePfpMapping() {
    if (_pfpMapping && _incognitoSet) return Promise.resolve();
    if (_pfpDataPromise) return _pfpDataPromise;
    // Fetch both files in parallel; treat 404/parse errors as empty
    // so the UI degrades gracefully without blocking the badge chip.
    _pfpDataPromise = Promise.all([
      fetch("/assets/pfp-mapping.json").then((r) => r.json()).catch(() => ({ mapping: {} })),
      fetch("/assets/incognito-addresses.json").then((r) => r.json()).catch(() => ({ addresses: [] })),
    ]).then(([m, i]) => {
      _pfpMapping = m.mapping || {};
      _incognitoSet = new Set((i.addresses || []).map((a) => String(a).toLowerCase()));
    });
    return _pfpDataPromise;
  }
  function _isIncognito(addr) {
    if (!addr || !_incognitoSet) return false;
    return _incognitoSet.has(addr.toLowerCase());
  }
  function _pfpIndexFor(addr) {
    if (!addr) return null;
    const lower = addr.toLowerCase();
    // Strict 1:1 for the 200 ETHSecurity holders (prod).
    if (_pfpMapping && _pfpMapping[lower]) return _pfpMapping[lower];
    // Fallback for non-snapshot wallets (BUIDLER test holders, future
    // holder #201+): FNV-1a hash mod 200. Collisions possible — meant
    // for testing only; will be cleaned up before prod cut-over.
    let h = 2166136261 >>> 0;
    for (let i = 0; i < lower.length; i++) {
      h ^= lower.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return (h % 200) + 1;
  }
  function _pfpPath(n) {
    return "/assets/pfps/" + String(n).padStart(4, "0") + ".png";
  }

  // Header badge — replaces RoleChip for badgeholder/admin wallets.
  // Shows the wallet's deterministic PFP; click to zoom into a fullscreen
  // modal with the wallet address + role.
  function BadgePfp({ address, role, isIncognito }) {
    const [open, setOpen] = useState(false);
    // Re-render after the snapshot mapping + incognito list load so the
    // PFP can swap in (or we stay on the RoleChip if this wallet isn't
    // in either list).
    const [, _bump] = useReducer((n) => n + 1, 0);
    useEffect(() => { _ensurePfpMapping().then(_bump); }, []);
    const idx = _pfpIndexFor(address);
    const isIncog = isIncognito || _isIncognito(address);
    // Resolution order:
    //   1. address is on the anon list → spy starling
    //   2. address is in the 200-holder snapshot → its assigned PFP
    //   3. otherwise → hash-fallback PFP (testing only — collisions
    //      possible; switch to RoleChip fallback before prod cut-over).
    const src = isIncog ? "/assets/incognito.png" : _pfpPath(idx);
    const ringColor = isIncog
      ? "rgba(255,255,255,0.55)"
      : role === "admin" ? "var(--dao-red)" : "rgb(245, 210, 110)";
    const displayId = isIncog ? "INCOGNITO" : "PFP #" + String(idx).padStart(4, "0");
    const displayRole = isIncog ? "Anonymous badge holder" : role === "admin" ? "Admin" : "Badge holder";
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={`${displayRole} · click to view`}
          style={{
            width: 38, height: 38, padding: 0,
            background: "transparent", border: `2px solid ${ringColor}`,
            borderRadius: "50%", cursor: "pointer", overflow: "hidden",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            transition: "transform .15s, box-shadow .15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "scale(1.05)";
            const glow = isIncog ? "rgba(255,255,255,0.15)" : (role === "admin" ? "rgba(255,60,56,0.18)" : "rgba(245,210,110,0.18)");
            e.currentTarget.style.boxShadow = `0 0 0 4px ${glow}`;
          }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}
        >
          <img src={src} alt={displayId} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", userSelect: "none", pointerEvents: "none" }} />
        </button>
        {open && (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setOpen(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 9999,
              background: "rgba(8, 20, 36, 0.88)", backdropFilter: "blur(8px)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              padding: 24, cursor: "zoom-out",
              animation: "f2pop .18s ease-out",
            }}
          >
            <img
              src={src}
              alt={displayId}
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: "min(80vw, 560px)", maxHeight: "70vh",
                borderRadius: 18, boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
                border: `4px solid ${ringColor}`,
                cursor: "default",
              }}
            />
            <div className="font-mono" style={{ marginTop: 18, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)" }}>
              {displayId} · {displayRole}
            </div>
            <div className="font-mono" style={{ marginTop: 4, fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
              {isIncog ? "address hidden" : address}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn btn-ghost"
              style={{ marginTop: 18, color: "rgba(255,255,255,0.85)", fontSize: 12 }}
            >Close (or click anywhere)</button>
          </div>
        )}
      </>
    );
  }

  function RoleChip({ role }) {
    const palette = {
      visitor:    { bg: "rgba(132,156,180,0.15)",  fg: "var(--dao-blue-800)", dot: "rgb(132,156,180)" },
      badgeholder:{ bg: "rgba(218,165,32,0.18)",   fg: "rgb(140,100,8)",      dot: "rgb(218,165,32)" },
      admin:      { bg: "rgba(255,60,56,0.12)",    fg: "var(--dao-red-dim)",  dot: "var(--dao-red)" },
    }[role];
    return (
      <span className={`font-mono role-chip role-${role}`} style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "4px 10px", borderRadius: 999,
        background: palette.bg, color: palette.fg,
        fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: palette.dot }} />
        {ROLE_LABEL[role]}
      </span>
    );
  }

  // ── Connect ──────────────────────────────────────────────────────
  // RainbowKit-style wallet logos. Inline SVGs (or simplified glyphs) so the
  // modal looks production-grade without needing image assets. Each is a 36×36
  // square with rounded corners — matches RainbowKit's actual icon dimensions.
  const WalletLogo = ({ id }) => {
    const wrap = (bg, children, opts = {}) => (
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: bg,
        display: "grid", placeItems: "center",
        flexShrink: 0, overflow: "hidden",
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)",
        ...opts,
      }}>{children}</div>
    );
    switch (id) {
      case "rainbow":
        return wrap("#001E59", (
          <svg width="22" height="22" viewBox="0 0 120 120">
            <rect width="120" height="120" rx="28" fill="#001E59"/>
            <path d="M20 100 a60 60 0 0 1 60 -60" fill="none" stroke="url(#rg1)" strokeWidth="14" strokeLinecap="round"/>
            <path d="M20 100 a40 40 0 0 1 40 -40" fill="none" stroke="url(#rg2)" strokeWidth="14" strokeLinecap="round"/>
            <circle cx="20" cy="100" r="9" fill="#FF4000"/>
            <defs>
              <linearGradient id="rg1" x1="0" y1="100" x2="100" y2="0">
                <stop offset="0" stopColor="#FF4000"/><stop offset="0.4" stopColor="#FF9D00"/><stop offset="0.7" stopColor="#FCFC00"/><stop offset="1" stopColor="#1F8AFF"/>
              </linearGradient>
              <linearGradient id="rg2" x1="0" y1="100" x2="80" y2="20">
                <stop offset="0" stopColor="#FF4000"/><stop offset="0.5" stopColor="#FFB800"/><stop offset="1" stopColor="#7AE0FF"/>
              </linearGradient>
            </defs>
          </svg>
        ));
      case "metamask":
        return wrap("#FFFFFF", (
          <svg width="26" height="24" viewBox="0 0 256 240">
            <path d="M250 1L137 84l21-49z" fill="#E2761B" stroke="#E2761B" strokeWidth="0.8"/>
            <path d="M6 1l112 84-20-50zM214 175l-30 46 64 18 18-63zM4 176l18 63 64-18-30-46z" fill="#E4761B"/>
            <path d="M82 105l-18 27 64 3-2-69zM174 105l-46-40-2 70 64-3zM86 221l38-19-33-26zM132 202l38 19-5-45z" fill="#E4761B"/>
            <path d="M170 221l-38-19 3 25-1 11zM86 221l36 17-1-11 3-25z" fill="#D7C1B3"/>
            <path d="M123 159l-32-9 23-11zM133 159l9-20 23 11z" fill="#233447"/>
            <path d="M86 221l5-46-35 1zM165 175l5 46 30-45zM192 132l-64 3 6 36 9-20 23 11zM91 162l23-11 9 20 6-36-64-3z" fill="#CD6116"/>
            <path d="M64 132l27 53-1-26zM166 159l-1 26 27-53zM128 135l-6 36 7 36 8-36zM192 132l-64 3 6 36 9-20 23 11z" fill="#E4751F"/>
          </svg>
        ));
      case "coinbase":
        return wrap("#1652F0", (
          <svg width="22" height="22" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="16" fill="#1652F0"/>
            <rect x="11" y="11" width="10" height="10" rx="1" fill="white"/>
          </svg>
        ));
      case "walletconnect":
        return wrap("#3B99FC", (
          <svg width="22" height="14" viewBox="0 0 40 24">
            <path d="M8.2 7c6.5-6.4 17.1-6.4 23.6 0l.8.8c.3.3.3.8 0 1.1l-2.7 2.7c-.2.2-.4.2-.6 0l-1.1-1.1c-4.5-4.4-11.9-4.4-16.4 0L10.6 11.6c-.2.2-.4.2-.6 0L7.3 8.9c-.3-.3-.3-.8 0-1.1L8.2 7zm29.2 5.4l2.4 2.4c.3.3.3.8 0 1.1L29 26.7c-.3.3-.8.3-1.1 0l-7.7-7.5c-.1-.1-.2-.1-.3 0l-7.7 7.5c-.3.3-.8.3-1.1 0L.4 16c-.3-.3-.3-.8 0-1.1l2.4-2.4c.3-.3.8-.3 1.1 0l7.7 7.5c.1.1.2.1.3 0l7.7-7.5c.3-.3.8-.3 1.1 0l7.7 7.5c.1.1.2.1.3 0l7.7-7.5c.3-.4.7-.4 1 0z" fill="white"/>
          </svg>
        ));
      case "rabby":
        return wrap("#7084FF", (
          <svg width="24" height="24" viewBox="0 0 32 32">
            <ellipse cx="16" cy="20" rx="11" ry="8" fill="white"/>
            <ellipse cx="16" cy="14" rx="9" ry="9" fill="#7084FF"/>
            <circle cx="12" cy="13" r="1.6" fill="#001E59"/>
            <circle cx="20" cy="13" r="1.6" fill="#001E59"/>
            <path d="M5 18 L0 13 L0 22 Z" fill="#7084FF"/>
            <path d="M27 18 L32 13 L32 22 Z" fill="#7084FF"/>
          </svg>
        ));
      case "frame":
        return wrap("#1A1A1A", (
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path d="M3 3h12v6H9v6H3z" fill="white"/>
            <path d="M9 9h12v12H15v-6H9z" fill="#888"/>
          </svg>
        ));
      case "zerion":
        return wrap("#2461EC", (
          <svg width="22" height="22" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="16" fill="#2461EC"/>
            <path d="M8 11h16l-12 10h12v-3H14l12-10H8z" fill="white"/>
          </svg>
        ));
      case "trust":
        return wrap("#3375BB", (
          <svg width="20" height="22" viewBox="0 0 24 26">
            <path d="M12 0L0 5v8c0 7 5 11 12 13 7-2 12-6 12-13V5L12 0z" fill="#3375BB"/>
            <path d="M12 4L4 7v6c0 5 4 8 8 9 4-1 8-4 8-9V7l-8-3z" fill="white"/>
            <path d="M12 4v15c4-1 8-4 8-9V7l-8-3z" fill="#3375BB" opacity="0.4"/>
          </svg>
        ));
      case "ledger":
        return wrap("#000000", (
          <svg width="22" height="22" viewBox="0 0 32 32">
            <path d="M0 22v6h12v-2H2v-4H0zM0 4v6h2V6h10V4H0zM30 4H20v2h10v4h2V4h-2zM30 22v4H20v2h12v-6h-2zM6 10v12h6v-2H8v-10H6zM14 10v12h4v-2h-2v-8h2v-2h-4z" fill="white"/>
          </svg>
        ));
      case "safe":
        return wrap("#12FF80", (
          <svg width="22" height="22" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="14" fill="#12FF80"/>
            <path d="M11 13a5 5 0 1 1 10 0v6a5 5 0 1 1-10 0v-6z" fill="white"/>
            <circle cx="16" cy="16" r="2" fill="#12FF80"/>
          </svg>
        ));
      case "phantom":
        return wrap("linear-gradient(135deg,#534BB1,#AB9FF2)", (
          <svg width="22" height="22" viewBox="0 0 32 32">
            <path d="M16 4c-7 0-12 5-12 12 0 4 2 7 4 9-1-2 0-4 2-5l4-1c2-1 4-3 4-5 0 4 3 7 7 7h2c2 0 4-1 4-3v-2C31 9 24 4 16 4z" fill="white"/>
            <circle cx="11" cy="14" r="1.6" fill="#534BB1"/>
            <circle cx="20" cy="14" r="1.6" fill="#534BB1"/>
          </svg>
        ));
      case "browser":
        return wrap("var(--dao-paper-2)", (
          <svg width="20" height="20" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" fill="none" stroke="var(--dao-blue-900)" strokeWidth="1.6"/>
            <ellipse cx="12" cy="12" rx="4" ry="10" fill="none" stroke="var(--dao-blue-900)" strokeWidth="1.6"/>
            <path d="M2 12h20" stroke="var(--dao-blue-900)" strokeWidth="1.6"/>
          </svg>
        ));
      default:
        return wrap("var(--dao-paper-2)", null);
    }
  };

  // Role is auto-resolved from the connected wallet against the badgeholder
  // registry + admin set. The UI shows a single "Connect Wallet" button
  // (RainbowKit-style modal under the hood — all popular wallets supported).
  function F2Connect({ onConnect }) {
    // 200 TheDAO Đ squares — one for every ETHSecurity Badge holder in the
    // flock. Generated deterministically (seeded) so the arrangement is
    // stable across renders. Avoids overlapping the Murmuration logo
    // (top-left) and the hero text block (mid-bottom-left). Sizes weighted
    // toward small (squared rng) so the bg reads as a true swarm with a
    // few larger "anchor" squares.
    const _daoSquares = (() => {
      const rand = (i) => {
        const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
        return v - Math.floor(v);
      };
      const out = [];
      // Forbidden zones (panel-relative %) — sized to the actual visible
      // bounds of the logo + wordmark and the hero text block, with a small
      // breathing-room buffer. The "Murmuration" wordmark extends to ~x=42%
      // so the logo zone has to cover that, not just the bird icon. Hero
      // text block (eyebrow + headline + subtitle) reaches x≈55%, y from
      // ~44% to bottom.
      //   Logo + wordmark + buffer:  x in [0, 47], y in [0, 22]
      //   Hero text block + buffer:  x in [0, 58], y in [40, 100]
      const inForbidden = (x, y) =>
        (x < 43 && y < 19) || (x < 54 && y >= 43 && y <= 100);
      let i = 0;
      while (out.length < 200 && i < 6000) {
        i++;
        // 75% right side, 25% left/center stragglers — uniform spread within
        // each zone so the flock fills the panel evenly, not clumped.
        const bias = rand(i * 2);
        const x = bias < 0.75
          ? 50 + rand(i * 3) * 50      // right half
          : 8 + rand(i * 5) * 47;      // left/center stragglers
        const y = 2 + rand(i * 7) * 96;
        if (inForbidden(x, y)) continue;
        const r = rand(i * 11);
        // Bigger sizes for clearer flock: most 18-36px, anchors up to ~80px
        const sz = 16 + Math.floor(r * r * 70);
        const alpha = 0.08 + (1 - r) * 0.06;
        out.push({
          top: y.toFixed(2) + "%",
          left: x.toFixed(2) + "%",
          size: sz,
          rot: Math.floor(rand(i * 13) * 44) - 22,
          a: +alpha.toFixed(3),
        });
      }
      return out;
    })();
    return (
      <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "1.1fr 1fr", position: "relative" }}>
        <div className="dao-blue-surface" style={{ position: "relative", overflow: "hidden" }}>
          {/* Hand-placed red Đ squares — TheDAO brand wallpaper */}
          {_daoSquares.map((sq, i) => (
            <div
              key={i}
              aria-hidden="true"
              style={{
                position: "absolute",
                top: sq.top,
                left: sq.left,
                width: sq.size,
                height: sq.size,
                background: `rgba(255,60,56,${sq.a})`,
                transform: `translate(-50%,-50%) rotate(${sq.rot}deg)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1,
                pointerEvents: "none",
                userSelect: "none",
                borderRadius: 4,
              }}
            >
              <div style={{
                width: "55%",
                height: "55%",
                background: "rgba(255,255,255,0.55)",
                WebkitMaskImage: "url(/assets/thedao-d-mark.png)",
                maskImage: "url(/assets/thedao-d-mark.png)",
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskPosition: "center",
              }} />
            </div>
          ))}
          <div style={{ position: "absolute", inset: 40, display: "flex", flexDirection: "column", justifyContent: "space-between", color: "white", zIndex: 2 }}>
            <Wordmark light size={68} />
            <div>
              <div className="font-mono" style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--dao-gold-300)", marginBottom: 14, padding: "10px 18px", textShadow: "0 1px 2px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.9), 0 0 18px rgba(0,0,0,0.65)", position: "relative", zIndex: 2 }}>Murmuration ·{"  "}theDAO's DAO</div>
              <div className="font-display" style={{ fontSize: "clamp(36px, 7vw, 60px)", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.05, color: "white" }}>
                200 experts.<br/>Murmuring<br/><span style={{ color: "var(--dao-gold-300)" }}>To one direction</span>
              </div>
              <div className="font-body" style={{ fontSize: 16, color: "white", marginTop: 24, maxWidth: "min(480px, 100%)", lineHeight: 1.6, padding: "10px 18px", textShadow: "0 1px 2px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.9), 0 0 18px rgba(0,0,0,0.65)", position: "relative", zIndex: 2 }}>
                TheDAO's ETHSecurity Badge holders coordinate with Murmurations. Murmurs are opportunities where TheDAO's elite group of Ethereum security experts can signal the direction they want TheDAO to go. Anyone can watch the murmurs but only Badge holders can participate in murmurs and propose directions.
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60, background: "var(--dao-blue-950)" }}>
          <div style={{ width: 460, color: "white" }}>
            <div className="font-display" style={{ fontSize: 36, fontWeight: 700 }}>Welcome Starling</div>

            <div style={{ marginTop: 32 }}>
              <button
                className="btn btn-primary btn-lg"
                style={{ justifyContent: "center", width: "100%", fontSize: 16, padding: "16px 24px" }}
                onClick={() => onConnect && onConnect()}
              >
                Enter
              </button>
            </div>

            <div style={{ height: 1, background: "rgba(255,255,255,0.1)", marginTop: 22 }} />

            <div className="font-mono" style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 18, lineHeight: 1.6 }}>
              Don't hold a badge? You can still watch the murmurations of Ethereum security experts.
            </div>
          </div>
        </div>

        <style>{`
          @keyframes f2fadein { from { opacity: 0 } to { opacity: 1 } }
          @keyframes f2pop { from { opacity: 0; transform: translateY(8px) scale(.98) } to { opacity: 1; transform: none } }
          @keyframes f2statepop { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
        `}</style>
      </div>
    );
  }

  // ── Rounds list (landing) ────────────────────────────────────────
  function F2RoundsList({ rounds, role, onOpen, onCreate }) {
    const open = rounds.filter(r => r.status === "open");
    const closed = rounds.filter(r => r.status !== "open");
    return (
      <div style={{ padding: "40px 40px 80px", maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28 }}>
          <div>
            <div className="font-mono" style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>Active murmurations</div>
            <div className="font-display" style={{ fontSize: 56, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", lineHeight: 1.05 }}>Murmurations</div>
            <div className="font-body" style={{ fontSize: 16, color: "var(--text-muted)", marginTop: 8, maxWidth: 640 }}>
              {open.length} murmuration{open.length === 1 ? "" : "s"} open. {role === "visitor" ? "Connect an ETHSecurity Badge wallet to participate." : null}
            </div>
          </div>
          {canAdmin(role) && (
            <button className="btn btn-primary btn-lg" onClick={onCreate}>+ New vote</button>
          )}
        </div>

        {open.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 18 }}>
            {open.map(r => <RoundCard key={r.id} r={r} onOpen={() => onOpen(r.id)} />)}
          </div>
        ) : closed.length === 0 ? (
          // Totally empty — first-load / quiet period. Mascot says hi.
          <div style={{ textAlign: "center", padding: "32px 20px 16px" }}>
            <img
              src="/assets/murmuration-starling.png"
              alt="Murmuration mascot"
              style={{ width: 200, height: "auto", opacity: 0.92, userSelect: "none", pointerEvents: "none" }}
            />
            <div className="font-display" style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)", marginTop: 20 }}>
              The flock is quiet
            </div>
            <div className="font-body" style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 8, maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>
              No votes are open right now. Check back when an admin publishes one{canAdmin(role) ? ", or start one yourself" : ""}.
            </div>
          </div>
        ) : (
          // Past votes exist but nothing currently open — show a small note above the past section.
          <div style={{ padding: "20px 24px", background: "var(--dao-paper-2)", border: "1px dashed var(--dao-stroke-2)", borderRadius: 12, display: "flex", alignItems: "center", gap: 16 }}>
            <img
              src="/assets/murmuration-starling.png"
              alt=""
              style={{ width: 72, height: "auto", opacity: 0.9, userSelect: "none", pointerEvents: "none", flexShrink: 0 }}
            />
            <div>
              <div className="font-display" style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>The flock is resting</div>
              <div className="font-body" style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
                No active votes.
              </div>
            </div>
          </div>
        )}

        {closed.length > 0 && (
          <>
            <div className="font-display" style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)", marginTop: 56, marginBottom: 16 }}>Past votes</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 18 }}>
              {closed.map(r => <RoundCard key={r.id} r={r} onOpen={() => onOpen(r.id)} muted />)}
            </div>
          </>
        )}
      </div>
    );
  }

  function RoundCard({ r, onOpen, muted }) {
    const accentMap = {
      red:  "var(--dao-red)",
      gold: "rgb(218,165,32)",
      blue: "var(--dao-blue-700)",
    };
    const accent = accentMap[r.accent] || "var(--dao-red)";
    return (
      <div onClick={onOpen} style={{
        // Muted (past) votes use the deeper recessed surface instead of
        // a translucent overlay — opacity < 1 would let the Đ-flock
        // wallpaper show through the card content.
        background: muted ? "var(--surface-elevated)" : "var(--surface-card)",
        borderRadius: 16,
        border: "1px solid var(--stroke-line-2)",
        padding: 28,
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        transition: "transform .15s, box-shadow .15s",
      }}
      onMouseEnter={e => { if (!muted) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 16px 44px rgba(0,0,0,0.28)"; } }}
      onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: accent }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="font-mono" style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
              padding: "4px 9px", borderRadius: 4,
              background: r.status === "open" ? "rgba(92,183,90,0.16)" : "rgba(255,255,255,0.08)",
              color: r.status === "open" ? "var(--dao-green)" : "var(--text-muted)",
            }}>● {r.status}</span>
            {r.rolling && <span className="font-mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 9px", borderRadius: 4, background: "rgba(108,162,204,0.18)", color: "rgb(180,220,255)" }}>Always open</span>}
          </div>
          <span className="font-mono" style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.04em" }}>{r.voters} voted</span>
        </div>
        <div className="font-display" style={{ fontSize: 26, fontWeight: 700, color: "var(--text-primary)", marginTop: 18, lineHeight: 1.22, letterSpacing: "-0.01em" }}>{r.title}</div>
        <div className="font-body" style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.55 }}>{r.blurb}</div>
        <div style={{ display: "flex", gap: 22, marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--stroke-line-2)" }}>
          <Stat label="Voting" value={r.voting === "quadratic" ? "Quadratic" : "Token-weight"} />
          <Stat label="Budget" value={`${r.budget} ${r.voting === "quadratic" ? "pts" : "votes"}`} />
          <Stat label="Directions" value={r.issueIds.length} />
          <Stat label={r.rolling ? "Status" : "Closes"} value={r.rolling ? "Always open" : (_prettyLocalClose(r.closes) || "—")} />
        </div>
      </div>
    );
  }

  function Stat({ label, value }) {
    return (
      <div>
        <div className="font-mono" style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>{label}</div>
        <div className="font-display" style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginTop: 4, letterSpacing: "-0.01em" }}>{value}</div>
      </div>
    );
  }

  // ── Donut for budget visualization ──────────────────────────────
  function DonutBudget({ used, total, label }) {
    const r = 78, c = 2 * Math.PI * r;
    const pct = Math.min(used / total, 1);
    return (
      <div style={{ position: "relative", width: 200, height: 200 }}>
        <svg width="200" height="200" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r={r} fill="none" stroke="var(--dao-paper-2)" strokeWidth="20" />
          <circle cx="100" cy="100" r={r} fill="none" stroke="var(--dao-red)" strokeWidth="20"
            strokeDasharray={c} strokeDashoffset={c - c * pct}
            transform="rotate(-90 100 100)" strokeLinecap="round" style={{ transition: "stroke-dashoffset .25s" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div className="font-display" style={{ fontSize: 48, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1 }}>{used}</div>
          <div className="font-mono" style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginTop: 4 }}>of {total} {label}</div>
        </div>
      </div>
    );
  }

  function AllocSlider({ value, onChange, max, scaleMax, disabled, voting }) {
    // `max` = highest value user can currently set (affordability cap).
    // `scaleMax` = visual ceiling for the round (e.g. 10 for QV/100 budget,
    // 100 for token-weight). Bar fill = value/scaleMax, so two sliders with
    // different values look proportionally different. The "unaffordable"
    // zone (beyond `max`) renders as a dimmed segment of the track.
    const trackRef = React.useRef(null);
    const [dragging, setDragging] = React.useState(false);
    const safeMax = Math.max(max, 0);
    const safeScale = Math.max(scaleMax || max || 1, 1);
    const clampedValue = Math.min(value, safeMax);
    const affordablePct = Math.min(100, (safeMax / safeScale) * 100);
    const fillPct = Math.min(100, (clampedValue / safeScale) * 100);

    const valueFromEvent = (e) => {
      const rect = trackRef.current.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const raw = pct * safeScale;
      return Math.min(safeMax, Math.round(raw));
    };

    const onDown = (e) => {
      if (disabled) return;
      e.preventDefault();
      setDragging(true);
      onChange(valueFromEvent(e));
    };
    React.useEffect(() => {
      if (!dragging) return;
      const move = (e) => onChange(valueFromEvent(e));
      const up = () => setDragging(false);
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      window.addEventListener("touchmove", move);
      window.addEventListener("touchend", up);
      return () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        window.removeEventListener("touchmove", move);
        window.removeEventListener("touchend", up);
      };
    }, [dragging, safeMax, safeScale]);

    // Cost in credits — used in the drag bubble so the user sees the
    // quadratic curve as they slide. Token-weight votes don't have a
    // curve so the bubble just echoes the value.
    const _displayCost = voting === "quadratic" ? clampedValue * clampedValue : clampedValue;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, width: 260 }}>
        <div
          ref={trackRef}
          onMouseDown={onDown}
          onTouchStart={onDown}
          style={{
            flex: 1,
            position: "relative",
            height: 32,
            cursor: disabled ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          {/* base track (full scale) */}
          <div style={{
            position: "absolute", left: 0, right: 0, height: 6,
            background: "rgba(255,255,255,0.10)", borderRadius: 3,
          }} />
          {/* affordable zone (lighter than fill, darker than unaffordable) */}
          <div style={{
            position: "absolute", left: 0, height: 6,
            width: `${affordablePct}%`,
            background: "rgba(255,60,56,0.18)", borderRadius: 3,
          }} />
          {/* fill */}
          <div style={{
            position: "absolute", left: 0, height: 6,
            width: `${fillPct}%`,
            background: "var(--dao-red)", borderRadius: 3,
            transition: dragging ? "none" : "width .15s",
          }} />
          {/* affordable boundary marker (only shown when there's an unaffordable zone) */}
          {affordablePct < 100 && (
            <div style={{
              position: "absolute", left: `${affordablePct}%`, top: 9, height: 14,
              width: 1, background: "var(--stroke-line-2)",
              transform: "translateX(-0.5px)",
            }} />
          )}
          {/* floating value bubble — only on drag */}
          {dragging && !disabled && (
            <div style={{
              position: "absolute",
              left: `${fillPct}%`,
              transform: "translate(-50%, -100%)",
              top: -4,
              padding: "6px 10px",
              borderRadius: 8,
              background: "var(--dao-red)",
              color: "white",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
              boxShadow: "0 6px 18px rgba(255,60,56,0.35)",
              pointerEvents: "none",
              zIndex: 5,
            }}>
              {clampedValue} {voting === "quadratic" ? "pts" : "votes"}
              {voting === "quadratic" && <span style={{ opacity: 0.78, marginLeft: 6 }}>· {_displayCost} cr</span>}
              <div style={{
                position: "absolute",
                left: "50%", bottom: -4,
                width: 8, height: 8,
                background: "var(--dao-red)",
                transform: "translateX(-50%) rotate(45deg)",
              }} />
            </div>
          )}
          {/* thumb */}
          <div style={{
            position: "absolute", left: `${fillPct}%`,
            width: dragging ? 26 : 22, height: dragging ? 26 : 22,
            transform: "translate(-50%, 0)",
            top: dragging ? 3 : 5,
            background: "var(--surface-card)",
            border: "3px solid var(--dao-red)",
            borderRadius: 999,
            boxShadow: dragging ? "0 0 0 6px rgba(255,60,56,0.22)" : "0 2px 6px rgba(0,0,0,0.30)",
            transition: dragging ? "none" : "left .15s, width .12s, height .12s, top .12s, box-shadow .15s",
            opacity: disabled ? 0.5 : 1,
          }} />
        </div>
        <div className="font-mono" style={{
          width: 32, textAlign: "right",
          fontWeight: 600,
          fontSize: 14,
          color: value > 0 ? "var(--dao-red-dim)" : "var(--text-faint)",
        }}>{value}</div>
      </div>
    );
  }

  // ── Round detail (allocate) ──────────────────────────────────────
  // Mascot-driven empty / not-found state for /vote/<bad-id> + initial fetch flicker.
  // Covers both "404" (route doesn't match a real vote) and the brief moment
  // between page-load and the proposals-API hydration completing.
  // Skeleton shown on /vote/<id> while the bulk hydrate is in flight —
  // mimics the vote-detail layout (left sidebar + right card stack) so
  // the user sees the page shape immediately instead of a blank
  // navy screen + a flash of "Round not found".
  function F2RoundSkeleton() {
    const _bar = (w, h, mt) => (
      <div style={{
        width: w, height: h, marginTop: mt || 0, borderRadius: 6,
        background: "linear-gradient(90deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.05) 100%)",
        backgroundSize: "200% 100%",
        animation: "f2skel 1.4s ease-in-out infinite",
      }} />
    );
    const _row = (i) => (
      <div key={i} style={{
        background: "var(--surface-card)", borderRadius: 14,
        border: "1px solid var(--stroke-line-2)", padding: 18,
        display: "grid", gridTemplateColumns: "1fr auto", gap: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            background: "rgba(255,255,255,0.08)",
          }} />
          <div style={{ flex: 1 }}>
            {_bar("50%", 12)}
            {_bar("80%", 18, 10)}
            {_bar("35%", 10, 10)}
          </div>
        </div>
        <div style={{ width: 200, display: "flex", alignItems: "center" }}>
          {_bar("100%", 8)}
        </div>
      </div>
    );
    return (
      <>
        <style>{"@keyframes f2skel { 0%{background-position:200% 0} 100%{background-position:-200% 0} }"}</style>
        <div style={{ padding: "32px 40px", display: "grid", gridTemplateColumns: "320px 1fr", gap: 32, maxWidth: 1320, margin: "0 auto" }}>
          <div>
            {_bar("60%", 10)}
            {_bar("90%", 28, 10)}
            {_bar("70%", 28, 4)}
            {_bar("80%", 12, 16)}
            <div style={{
              width: 200, height: 200, marginTop: 24, borderRadius: "50%",
              border: "20px solid rgba(255,255,255,0.06)",
            }} />
          </div>
          <div>
            {_bar("40%", 36)}
            {_bar("80%", 14, 12)}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
              {[0,1,2,3].map(_row)}
            </div>
          </div>
        </div>
      </>
    );
  }

  function F2RoundNotFound({ onBack }) {
    return (
      <div style={{ textAlign: "center", padding: "80px 24px 60px", maxWidth: 560, margin: "0 auto" }}>
        <img
          src="/assets/murmuration-starling.png"
          alt="Murmuration mascot"
          style={{ width: 220, height: "auto", opacity: 0.92, userSelect: "none", pointerEvents: "none" }}
        />
        <div className="font-display" style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)", marginTop: 18 }}>
          This vote flew away
        </div>
        <div className="font-body" style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.55 }}>
          We couldn't find a murmuration at that address. It may have closed, the link may be wrong, or the flock is still settling — give it a second and try again.
        </div>
        <button className="btn btn-primary" style={{ marginTop: 24, fontSize: 14, padding: "10px 22px" }} onClick={onBack}>
          ← Back to all votes
        </button>
      </div>
    );
  }

  // Coin picker: cycles through 5 distinct DESIGNS by option index, then
  // randomly (but stably-per-option) picks a background variant within
  // that design. So a vote with 4 options shows 4 different designs;
  // a vote with 6 options shows designs 1-5 + design 1 again (repeats).
  // Within each design, the variant is hashed from the option id so it
  // stays the same across renders.
  const _DESIGN_GROUPS = {
    1: [1],
    2: [2, 16, 17, 18, 19, 20],
    3: [3, 11, 12, 13, 14, 15],
    4: [4, 6, 7, 8, 9, 10],
    5: [5],
  };
  function _coinFor(id, optionIndex) {
    const designNum = (((optionIndex || 0) % 5) + 5) % 5 + 1;
    const variants = _DESIGN_GROUPS[designNum] || [1];
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return variants[Math.abs(h) % variants.length];
  }

  function F2RoundDetail({ round, allocations, setAllocations, role, onOpenIssue, onSubmit }) {
    const issues = round.issueIds.map(id => ISSUES.find(i => i.id === id)).filter(Boolean);
    const used = Object.entries(allocations).reduce((s, [k, v]) => {
      const inRound = round.issueIds.includes(Number(k));
      return s + (inRound ? (round.voting === "quadratic" ? v * v : v) : 0);
    }, 0);
    const remaining = round.budget - used;
    const setVal = (id, nv) => {
      if (!canVote(role)) return;
      // Use functional update so we always clamp against the freshest state,
      // not a stale closure during fast slider drags.
      setAllocations(prev => {
        const cur = prev[id] || 0;
        // Recompute used WITHOUT this issue's current contribution
        const usedExcl = Object.entries(prev).reduce((s, [k, v]) => {
          if (Number(k) === id) return s;
          if (!round.issueIds.includes(Number(k))) return s;
          return s + (round.voting === "quadratic" ? v * v : v);
        }, 0);
        const budgetForThis = round.budget - usedExcl; // max credits this issue can spend
        const nvCost = round.voting === "quadratic" ? nv * nv : nv;
        let next = nv;
        if (nvCost > budgetForThis) {
          next = round.voting === "quadratic"
            ? Math.floor(Math.sqrt(Math.max(budgetForThis, 0)))
            : Math.max(budgetForThis, 0);
        }
        if (next < 0) next = 0;
        return { ...prev, [id]: next };
      });
    };

    return (
      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 32, padding: "32px 40px", maxWidth: 1400, margin: "0 auto" }}>
        {/* sidebar */}
        <div style={{ position: "sticky", top: 88, alignSelf: "start" }}>
          <div className="font-mono" style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>Your murmur</div>
          <div className="font-display" style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)", marginTop: 4, lineHeight: 1.2 }}>{round.title}</div>
          <div className="font-body" style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
            {round.voting === "quadratic" ? "Quadratic vote · Every extra point costs more" : "Token-weight vote · 1 vote = 1 credit"}
            {round.rolling ? " · Always open" : ` · Closes ${_prettyLocalClose(round.closes) || ""}`}
          </div>
          <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
            <DonutBudget used={used} total={round.budget} label={round.voting === "quadratic" ? "credits" : "votes"} />
          </div>
          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8, maxHeight: 200, overflowY: "auto" }}>
            {Object.entries(allocations).filter(([k, v]) => v > 0 && round.issueIds.includes(Number(k))).map(([id, v]) => {
              const iss = ISSUES.find(x => x.id === Number(id));
              if (!iss) return null;
              return (
                <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <img
                    src={"/assets/murmuration-coin-" + _coinFor(iss.id, (round.issueIds || []).indexOf(iss.id)) + ".png"}
                    alt=""
                    style={{ width: 18, height: 18, flexShrink: 0, userSelect: "none", pointerEvents: "none" }}
                  />
                  <span className="font-body" style={{ flex: 1, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{iss.title}</span>
                  <span className="font-mono" style={{ fontWeight: 600, color: "var(--dao-red-dim)" }}>{v}</span>
                </div>
              );
            })}
          </div>
          {canVote(role) ? (
            <button className="btn btn-primary btn-lg" style={{ width: "100%", justifyContent: "center", marginTop: 20 }}>Sign + commit →</button>
          ) : (
            <div style={{ marginTop: 20, padding: 14, background: "var(--dao-paper-2)", borderRadius: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>
              <b style={{ color: "var(--text-primary)" }}>Read-only.</b> Connect an ETHSecurity Badge wallet to allocate.
            </div>
          )}
        </div>

        {/* issue list */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
            <div>
              <div className="font-display" style={{ fontSize: 44, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>Directions</div>
            </div>
            {canSubmit(role) && (
              <button className="btn btn-ghost" onClick={onSubmit}>+ Add a direction</button>
            )}
          </div>
          <div style={{ background: "rgba(255,60,56,0.10)", border: "1px solid rgba(255,60,56,0.25)", borderLeft: "4px solid var(--dao-red)", borderRadius: 10, padding: "14px 18px", fontSize: 14, color: "var(--text-primary)", marginBottom: 18, lineHeight: 1.55 }}>
            Don't see the choice you want? {canSubmit(role) ? (
              <a onClick={onSubmit} style={{ color: "var(--dao-red)", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>create a direction here</a>
            ) : <span style={{ color: "var(--dao-red)", fontWeight: 700 }}>connect an ETHSecurity Badge wallet to add one to the murmuration</span>}.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {issues.map(iss => {
              const v = allocations[iss.id] || 0;
              const cost = round.voting === "quadratic" ? v * v : v;
              // Marginal cost of the NEXT vote (QV: (v+1)² - v² = 2v+1)
              const nextCost = round.voting === "quadratic" ? (2 * v + 1) : 1;
              const canAffordNext = nextCost <= remaining;
              // Slider max: never let the user pick a value they can't afford.
              const sliderMax = round.voting === "quadratic"
                ? Math.floor(Math.sqrt(cost + remaining))
                : v + remaining;
              return (
                <div key={iss.id} style={{
                  background: "var(--surface-card)", borderRadius: 14,
                  border: "1px solid var(--stroke-line-2)",
                  borderLeft: v > 0 ? "4px solid var(--dao-red)" : "1px solid var(--stroke-line-2)",
                  boxShadow: v > 0 ? "0 8px 24px rgba(255,60,56,0.08)" : "none",
                  padding: v > 0 ? "18px 18px 18px 15px" : 18,
                  display: "grid", gridTemplateColumns: "1fr auto 150px", gap: 16,
                  alignItems: "stretch",
                  position: "relative",
                  transition: "transform .15s, box-shadow .15s, border-color .15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = v > 0
                    ? "0 14px 36px rgba(255,60,56,0.16)"
                    : "0 10px 28px rgba(0,0,0,0.25)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "";
                  e.currentTarget.style.boxShadow = v > 0 ? "0 8px 24px rgba(255,60,56,0.08)" : "none";
                }}>
                  <div onClick={() => onOpenIssue(iss.id)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 16 }}>
                    {/* Stable per-option coin badge — cycles 1..5 by the option's
                        position within the round so re-ordering or adding options
                        keeps each one visually distinct without random reshuffles. */}
                    <img
                      src={"/assets/murmuration-coin-" + _coinFor(iss.id, (round.issueIds || []).indexOf(iss.id)) + ".png"}
                      alt=""
                      style={{ width: 56, height: 56, flexShrink: 0, userSelect: "none", pointerEvents: "none" }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="font-display" style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3 }}>{iss.title}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                    <AllocSlider
                      value={v}
                      onChange={(nv) => setVal(iss.id, nv)}
                      max={sliderMax}
                      scaleMax={round.voting === "quadratic" ? Math.floor(Math.sqrt(round.budget)) : round.budget}
                      disabled={!canVote(role)}
                      voting={round.voting}
                    />
                    {round.voting === "quadratic" ? (
                      <div className="font-mono" style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", textAlign: "right", lineHeight: 1.5 }}>
                        <div style={{ color: "var(--text-muted)" }}>
                          Cost: <span style={{ color: "var(--dao-red-dim)", fontWeight: 600 }}>{cost} credits</span>
                        </div>
                        <div style={{ color: "var(--text-muted)" }}>
                          Next: <span style={{ color: canAffordNext ? "var(--text-secondary)" : "var(--text-faint)", fontWeight: 600 }}>+{nextCost} credits</span>
                          {!canAffordNext && <span style={{ marginLeft: 4, color: "var(--text-faint)" }}>· over budget</span>}
                        </div>
                      </div>
                    ) : (
                      <div className="font-mono" style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        {v} votes
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Issue detail ─────────────────────────────────────────────────
  function F2IssueDetail({ issue, round, allocations, setAllocations, role, onBack }) {
    const v = allocations[issue.id] || 0;
    return (
      <div style={{ padding: "32px 40px", maxWidth: 1100, margin: "0 auto" }}>
        <a onClick={onBack} className="font-mono" style={{ fontSize: 11, color: "var(--text-secondary)", letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}>← {round.title}</a>
        <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <SevTag s={issue.severity} />
          <span className="tag-mono">{issue.area}</span>
          <span className="tag-mono">{issue.chain}</span>
          <span className="font-mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>· #{issue.num} · {issue.repo}</span>
        </div>
        <h1 className="font-display" style={{ fontSize: 44, fontWeight: 700, color: "var(--text-primary)", margin: "12px 0", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
          {issue.title}
        </h1>
        <div className="font-mono" style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 28 }}>
          opened by <b style={{ color: "var(--text-primary)" }}>{issue.author}</b> · {issue.opened} ago · {issue.comments} comments
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 32 }}>
          <div className="font-body" style={{ fontSize: 16, lineHeight: 1.7, color: "var(--text-primary)" }}>
            {issue.body}
            <div style={{ marginTop: 24, padding: 24, background: "var(--dao-paper-2)", borderRadius: 12, borderLeft: "3px solid var(--dao-red)" }}>
              <div className="font-mono" style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--dao-red-dim)", marginBottom: 8 }}>POC ATTACHED</div>
              <pre style={{ margin: 0, fontFamily: "JetBrains Mono", fontSize: 13, lineHeight: 1.6 }}>{`forge test --match-test test_Reentrancy_DrainsVault
[PASS] test_Reentrancy_DrainsVault (gas: 412,008)
   ↳ vault.balance: 75,224 ETH → 0 ETH`}</pre>
            </div>
          </div>
          <div>
            <div style={{ background: "var(--dao-blue-900)", color: "white", padding: 24, borderRadius: 14, position: "sticky", top: 88 }}>
              {(() => {
                // Compute round-wide budget excluding this issue's contribution
                const usedExcl = Object.entries(allocations).reduce((s, [k, vv]) => {
                  if (Number(k) === issue.id) return s;
                  if (!round.issueIds.includes(Number(k))) return s;
                  return s + (round.voting === "quadratic" ? vv * vv : vv);
                }, 0);
                const budgetForThis = round.budget - usedExcl;
                const maxForThis = round.voting === "quadratic"
                  ? Math.floor(Math.sqrt(Math.max(budgetForThis, 0)))
                  : Math.max(budgetForThis, 0);
                const cost = round.voting === "quadratic" ? v * v : v;
                const nextCost = round.voting === "quadratic" ? (2 * v + 1) : 1;
                const remaining = budgetForThis - cost;
                const setSafe = (raw) => {
                  if (!canVote(role)) return;
                  let next = raw;
                  const nCost = round.voting === "quadratic" ? next * next : next;
                  if (nCost > budgetForThis) next = maxForThis;
                  if (next < 0) next = 0;
                  setAllocations({ ...allocations, [issue.id]: next });
                };
                return (
                  <>
                    <div className="font-mono" style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--on-blue-soft)" }}>Your allocation</div>
                    <div className="font-display" style={{ fontSize: 56, fontWeight: 700, lineHeight: 1, marginTop: 8 }}>{v}<span style={{ fontSize: 20, color: "var(--on-blue-soft)" }}> {round.voting === "quadratic" ? (v === 1 ? "pt" : "pts") : (v === 1 ? "vote" : "votes")}</span></div>
                    <input
                      type="range" min="0" max={Math.max(maxForThis, 1)} value={Math.min(v, Math.max(maxForThis, 0))}
                      disabled={!canVote(role)}
                      onChange={e => setSafe(Number(e.target.value))}
                      style={{ width: "100%", marginTop: 14, accentColor: "var(--dao-red)" }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--on-blue-soft)" }} className="font-mono"><span>0</span><span>{maxForThis}</span></div>

                    {/* Running budget for the round */}
                    <div style={{ marginTop: 18, padding: "12px 14px", background: "rgba(255,255,255,0.06)", borderRadius: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span className="font-mono" style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--on-blue-soft)" }}>Round budget</span>
                        <span className="font-mono" style={{ fontSize: 12, color: "white" }}>
                          <b style={{ color: round.budget - usedExcl - cost < 5 ? "rgb(255,140,120)" : "white" }}>{round.budget - usedExcl - cost}</b>
                          <span style={{ color: "var(--on-blue-soft)" }}> / {round.budget} left</span>
                        </span>
                      </div>
                      <div style={{ height: 6, background: "rgba(255,255,255,0.1)", borderRadius: 3, overflow: "hidden", marginTop: 8 }}>
                        <div style={{
                          width: `${Math.min(100, ((usedExcl + cost) / round.budget) * 100)}%`,
                          height: "100%",
                          background: "linear-gradient(90deg, var(--dao-gold-300), var(--dao-red))",
                          transition: "width .18s",
                        }} />
                      </div>
                      {round.voting === "quadratic" && (
                        <div className="font-mono" style={{ fontSize: 10, marginTop: 8, color: "var(--on-blue-soft)", letterSpacing: "0.04em" }}>
                          This issue: <b style={{ color: "white" }}>{cost} cr</b> · Next vote: <b style={{ color: nextCost <= round.budget - usedExcl - cost ? "white" : "rgba(255,140,120,0.9)" }}>+{nextCost} cr</b>
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ color: "var(--on-blue-soft)" }}>Round total</span><span className="font-mono">{issue.totalVotes.toLocaleString()}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ color: "var(--on-blue-soft)" }}>Voters</span><span className="font-mono">{issue.voters}</span></div>
                    </div>
                    {!canVote(role) && (
                      <div style={{ marginTop: 14, fontSize: 11, color: "var(--on-blue-soft)", lineHeight: 1.5 }}>
                        Read-only. Connect an ETHSecurity Badge wallet to murmur.
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Submit issue ─────────────────────────────────────────────────
  // Two modes: "compose" — write directly here.
  //            "import"  — paste a public GitHub issue URL (auto-fetched).
  function F2Submit({ rounds, role }) {
    // Set to true to re-expose the "Import from GitHub" flow. Hidden for
    // production; the compose form is the supported path.
    const IMPORT_FROM_GITHUB_ENABLED = false;
    const [mode, setMode] = useState("compose");
    const [roundId, setRoundId] = useState(rounds.find(r => r.status === "open")?.id || rounds[0].id);
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [severity, setSeverity] = useState("info");
    const [area, setArea] = useState("");
    const [importUrl, setImportUrl] = useState("https://github.com/ethereum/seal-audits/issues/418");
    const [imported, setImported] = useState(false);

    if (!canSubmit(role)) {
      return (
        <div style={{ padding: 80, textAlign: "center" }}>
          <div className="font-display" style={{ fontSize: 32, fontWeight: 700, color: "var(--text-primary)" }}>Only ETHSecurity Badge holders can submit issues</div>
          <div className="font-body" style={{ color: "var(--text-muted)", marginTop: 8 }}>Don't want to connect? Open an issue on GitHub instead.</div>
          <a href="#" className="btn btn-ghost" style={{ marginTop: 20 }}>↗ Open on GitHub</a>
        </div>
      );
    }

    return (
      <div style={{ padding: "32px 40px", maxWidth: 880, margin: "0 auto" }}>
        <div className="font-display" style={{ fontSize: 44, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>Propose a new option</div>
        <div className="font-body" style={{ fontSize: 15, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.6 }}>
          What should theDAO weigh in on? Drop it here, sign and it lands on the murmuration.
        </div>

        {/* mode toggle — gated on IMPORT_FROM_GITHUB_ENABLED. The
            import-mode code paths below stay intact so flipping the flag
            re-exposes the flow with no other changes. */}
        {IMPORT_FROM_GITHUB_ENABLED && (
          <div style={{ display: "inline-flex", marginTop: 24, padding: 4, background: "var(--dao-paper-2)", borderRadius: 999 }}>
            {[["compose", "Write here"], ["import", "Import from GitHub"]].map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)} className="font-display" style={{
                background: mode === k ? "white" : "transparent",
                boxShadow: mode === k ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                color: mode === k ? "var(--dao-blue-900)" : "var(--text-muted)",
                border: "none", cursor: "pointer", padding: "8px 18px", borderRadius: 999,
                fontWeight: 600, fontSize: 13,
              }}>{l}</button>
            ))}
          </div>
        )}

        <div style={{ background: "var(--dao-paper-2)", borderRadius: 14, padding: 28, marginTop: 18, display: "flex", flexDirection: "column", gap: 18 }}>
          {/* round picker — applies to both modes */}
          <Field label="Round">
            <select className="input" value={roundId} onChange={e => setRoundId(e.target.value)}>
              {rounds.filter(r => r.status === "open").map(r => (
                <option key={r.id} value={r.id}>{r.title} · {r.voting === "quadratic" ? "QV" : "Token-weight"}{r.rolling ? " · rolling" : ""}</option>
              ))}
            </select>
          </Field>

          {mode === "compose" ? (
            <>
              <Field label="Title">
                <input className="input" value={title} onChange={e => setTitle(e.target.value)} />
              </Field>
              <Field label="Description (markdown supported)">
                <textarea className="input" rows={10} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1.65, resize: "vertical" }}
                  value={body} onChange={e => setBody(e.target.value)} />
              </Field>
            </>
          ) : (
            <>
              <Field label="GitHub issue URL" hint="Public issue URL — we'll mirror title, body, and labels.">
                <input className="input font-mono" value={importUrl} onChange={e => { setImportUrl(e.target.value); setImported(false); }} />
                <button className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={() => setImported(true)}>{imported ? "✓ Re-fetch" : "Fetch"}</button>
              </Field>
              {imported && (
                <div style={{ background: "var(--surface-card)", padding: 20, borderRadius: 12, border: "1px solid var(--dao-stroke-2)" }}>
                  <div className="font-mono" style={{ fontSize: 11, color: "var(--dao-green)", marginBottom: 6 }}>✓ FETCHED FROM GITHUB</div>
                  <div className="font-display" style={{ fontWeight: 600, fontSize: 17, color: "var(--text-primary)" }}>Withdrawal queue griefing — DOS via spam exit</div>
                  <div className="font-body" style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>An attacker controlling 0.1% of validators can spam exit requests…</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                    <span className="tag-mono">queues</span>
                    <span className="tag-mono">spam</span>
                    <span className="tag-mono">withdrawals</span>
                  </div>
                </div>
              )}
              <div style={{ background: "rgba(40,86,122,0.06)", padding: 14, borderRadius: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>
                <b style={{ color: "var(--text-primary)" }}>Don't want to connect GitHub?</b> Fork the repo, open the issue there, then paste the URL here.
              </div>
            </>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", paddingTop: 8 }}>
            <button className="btn btn-primary btn-lg">Sign + submit →</button>
          </div>
        </div>
      </div>
    );
  }

  function Field({ label, hint, children }) {
    return (
      <div>
        <label className="font-mono" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>{label}</label>
        {hint && <div className="font-body" style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{hint}</div>}
        <div style={{ marginTop: 6 }}>{children}</div>
      </div>
    );
  }

  // ── My ballot — across all rounds ────────────────────────────────
  // Read-only ledger of the user's signed ballots across every round.
  // No sliders, no signing — voting happens on each vote's detail page.
  // This page is purely a "what did I sign and where" view.
  function F2Ballot({ rounds, address }) {
    const [_ballots, _setBallots] = useState({}); // roundId -> StoredBallot
    const [_loading, _setLoading] = useState(true);

    useEffect(() => {
      if (!address || rounds.length === 0) {
        _setBallots({});
        _setLoading(false);
        return;
      }
      let cancelled = false;
      _setLoading(true);
      (async () => {
        const out = {};
        await Promise.all(rounds.map(async (r) => {
          try {
            const stored = await votingApi.fetchBallots(r.id);
            const mine = stored.find((b) => b.ballot.voter.toLowerCase() === address.toLowerCase());
            if (mine) out[r.id] = mine;
          } catch { /* skip — keep other rounds */ }
        }));
        if (!cancelled) {
          _setBallots(out);
          _setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, [address, rounds.map((r) => r.id).join(",")]);

    if (!address) {
      return (
        <div style={{ padding: 80, textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
          <div className="font-display" style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)" }}>Connect your wallet to see your murmur.</div>
        </div>
      );
    }

    const votedRounds = rounds.filter((r) => _ballots[r.id]);

    return (
      <div style={{ padding: "32px 40px", maxWidth: 1080, margin: "0 auto" }}>
        <div className="font-display" style={{ fontSize: 44, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>My murmur</div>
        <div className="font-body" style={{ fontSize: 15, color: "var(--text-muted)" }}>Your signed murmurs across every murmuration.</div>

        {_loading && (
          <div className="font-mono" style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 28 }}>Loading your ballots…</div>
        )}

        {!_loading && votedRounds.length === 0 && (
          <div style={{ padding: 40, marginTop: 28, background: "var(--surface-card)", borderRadius: 14, textAlign: "center", border: "1px solid var(--stroke-line-2)" }}>
            <div className="font-display" style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>You haven't voted yet</div>
            <div className="font-body" style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>Head to the Murmurations page and add your murmur to an open murmuration.</div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 24, marginTop: 28 }}>
          {votedRounds.map((r) => {
            const ballot = _ballots[r.id];
            const allocs = ballot.ballot.allocations || [];
            const used = allocs.reduce((s, a) => s + (r.voting === "quadratic" ? Number(a.points) * Number(a.points) : Number(a.points)), 0);
            const total = allocs.reduce((s, a) => s + Number(a.points), 0);
            return (
              <div key={r.id} style={{ background: "var(--surface-card)", borderRadius: 14, border: "1px solid var(--stroke-line-2)", overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", borderBottom: "1px solid var(--stroke-line-2)", background: "var(--surface-elevated)" }}>
                  <div>
                    <div className="font-display" style={{ fontWeight: 700, fontSize: 18, color: "var(--text-primary)" }}>{r.title}</div>
                    <div className="font-mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {r.voting === "quadratic" ? "Quadratic" : "Token-weight"} · {used}/{r.budget} {r.voting === "quadratic" ? "credits" : "votes"} used · signed {new Date(ballot.signedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <span className="font-mono" style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--dao-green)", fontWeight: 700 }}>✓ Voted</span>
                </div>
                {allocs.map((a, i) => {
                  const iss = ISSUES.find((x) => x.id === Number(a.issueId));
                  const pct = total > 0 ? (Number(a.points) / total) * 100 : 0;
                  const points = Number(a.points);
                  const cost = r.voting === "quadratic" ? points * points : points;
                  const optionIndex = (r.issueIds || []).indexOf(Number(a.issueId));
                  // Deleted options don't appear in r.issueIds anymore but
                  // the user's signed ballot still has the allocation.
                  const isDeleted = optionIndex === -1;
                  return (
                    <div key={a.issueId} style={{
                      padding: "20px 28px",
                      borderBottom: i === allocs.length - 1 ? "none" : "1px solid var(--stroke-line-2)",
                      display: "flex",
                      alignItems: "center",
                      gap: 18,
                    }}>
                      {/* Coin badge — same one used on the vote detail
                          so users see a consistent visual anchor for
                          each option. Falls back to a grey placeholder
                          for deleted options. */}
                      <img
                        src={"/assets/murmuration-coin-" + _coinFor(Number(a.issueId), Math.max(0, optionIndex)) + ".png"}
                        alt=""
                        style={{
                          width: 56, height: 56, flexShrink: 0,
                          opacity: isDeleted ? 0.35 : 1,
                          filter: isDeleted ? "grayscale(1)" : "none",
                          userSelect: "none", pointerEvents: "none",
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                          <div className="font-display" style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {iss ? iss.title : (isDeleted ? "Option deleted by admin" : ("Option #" + a.issueId))}
                          </div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexShrink: 0 }}>
                            <span className="font-display" style={{ fontSize: 22, fontWeight: 700, color: "var(--dao-red)", lineHeight: 1 }}>{points}</span>
                            <span className="font-mono" style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                              {r.voting === "quadratic" ? "credits" : "votes"}
                            </span>
                          </div>
                        </div>
                        <div style={{ height: 8, background: "var(--surface-elevated)", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "var(--dao-red)", borderRadius: 4 }} />
                        </div>
                        <div className="font-mono" style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                          <span>cost: {cost} {r.voting === "quadratic" ? "credits" : "votes"}</span>
                          <span>{pct.toFixed(0)}% of ballot</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Admin ────────────────────────────────────────────────────────
  function F2Admin({ rounds, setRounds, onCreate, onEdit }) {
    return (
      <div style={{ padding: "32px 40px", maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
          <div>
            <div className="font-mono" style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>Admin</div>
            <div className="font-display" style={{ fontSize: 44, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>Manage votes</div>
            <div className="font-body" style={{ fontSize: 15, color: "var(--text-muted)", marginTop: 4 }}>Create, edit, open, or close votes. Multiple votes run concurrently.</div>
          </div>
          <button className="btn btn-primary btn-lg" onClick={onCreate}>+ New vote</button>
        </div>

        {rounds.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 24px 32px", background: "var(--surface-card)", borderRadius: 14, border: "1px solid var(--stroke-line-2)" }}>
            <img
              src="/assets/murmuration-starling.png"
              alt="Murmuration mascot"
              style={{ width: 200, height: "auto", opacity: 0.92, userSelect: "none", pointerEvents: "none" }}
            />
            <div className="font-display" style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)", marginTop: 20, letterSpacing: "-0.01em" }}>
              No votes yet
            </div>
            <div className="font-body" style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 8, maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>
              Start the flock — create the first murmuration and badgeholders can begin allocating credits.
            </div>
            <button className="btn btn-primary btn-lg" onClick={onCreate} style={{ marginTop: 24 }}>+ New vote</button>
          </div>
        ) : (
        <div style={{ background: "var(--surface-card)", borderRadius: 14, border: "1px solid var(--dao-stroke-2)", overflow: "hidden" }}>
          <div className="font-mono" style={{
            display: "grid", gridTemplateColumns: "2.4fr 1fr 1fr 1fr 100px 230px", gap: 12,
            padding: "12px 20px", background: "var(--dao-paper-2)",
            fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)",
          }}>
            <span>Round</span><span>Voting</span><span>Budget</span><span>Schedule</span><span>Status</span><span></span>
          </div>
          {rounds.map((r, i) => (
            <div key={r.id} style={{
              display: "grid", gridTemplateColumns: "2.4fr 1fr 1fr 1fr 100px 230px", gap: 12,
              padding: "16px 20px", borderTop: i === 0 ? "none" : "1px solid var(--dao-stroke-2)",
              alignItems: "center",
            }}>
              <div>
                <div className="font-display" style={{ fontWeight: 600, color: "var(--text-primary)" }}>{r.title}</div>
                <div className="font-mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.id} · {r.issueIds.length} issues · {r.voters} voted</div>
              </div>
              <span className="font-mono" style={{ fontSize: 12 }}>{r.voting === "quadratic" ? "Quadratic" : "Token-weight"}</span>
              <span className="font-mono" style={{ fontSize: 12 }}>{r.budget} {r.voting === "quadratic" ? "pts" : "votes"}</span>
              <span className="font-mono" style={{ fontSize: 12 }}>{r.rolling ? "Always open" : (_prettyLocalClose(r.closes) || "—")}</span>
              <span className="font-mono" style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                padding: "3px 7px", borderRadius: 4, justifySelf: "start",
                background: r.status === "open" ? "rgba(82,168,82,0.14)" : "rgba(120,120,120,0.12)",
                color: r.status === "open" ? "var(--dao-green)" : "var(--text-muted)",
              }}>● {r.status}</span>
              <button className="btn btn-ghost" style={{ fontSize: 12, justifySelf: "end" }} onClick={() => onEdit(r.id)}>Edit →</button>
            </div>
          ))}
        </div>
        )}
      </div>
    );
  }

  // ── Token / NFT eligibility picker ──────────────────────────────
  // Always-visible list of registered contracts + inline "+ Add new"
  // form. Clicking a row selects that contract for this round. Clicking
  // the star sets the registry-wide default for future rounds.
  function TokenPicker({ tokens, setTokens, selectedId, onSelect }) {
    const _emptyDraft = { address: "", chain: "Ethereum", symbol: "", name: "", kind: "ERC-721" };
    const [showAdd, setShowAdd] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [draft, setDraft] = useState(_emptyDraft);
    // Form is open when adding OR editing.
    const _isFormOpen = showAdd || !!editingId;

    const shortAddr = (a) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";

    const _closeForm = () => {
      setShowAdd(false);
      setEditingId(null);
      setDraft(_emptyDraft);
    };
    const _beginEdit = (t) => {
      setShowAdd(false);
      setEditingId(t.id);
      setDraft({
        address: t.address || "",
        chain: t.chain || "Ethereum",
        symbol: t.symbol || "",
        name: t.name || "",
        kind: t.kind || "ERC-721",
      });
    };

    const setDefault = (id) => {
      setTokens(prev => prev.map(t => ({ ...t, isDefault: t.id === id })));
    };
    const removeToken = (id) => {
      const remaining = tokens.filter(t => t.id !== id);
      const removedDefault = tokens.find(t => t.id === id)?.isDefault;
      const next = removedDefault && remaining[0]
        ? remaining.map((t, i) => ({ ...t, isDefault: i === 0 }))
        : remaining;
      setTokens(next);
      if (selectedId === id && next[0]) onSelect(next[0].id);
      if (editingId === id) _closeForm();
    };
    const addToken = () => {
      if (!draft.address || !draft.symbol) return;
      const newToken = {
        ...draft,
        id: `tok-${Date.now().toString(36)}`,
        holders: Math.floor(40 + Math.random() * 800),
        isDefault: tokens.length === 0,
      };
      setTokens(prev => [...prev, newToken]);
      onSelect(newToken.id);
      _closeForm();
    };
    const saveEdit = () => {
      if (!editingId || !draft.address || !draft.symbol) return;
      setTokens(prev => prev.map(t => t.id === editingId
        ? { ...t, address: draft.address, chain: draft.chain, symbol: draft.symbol, name: draft.name, kind: draft.kind }
        : t));
      _closeForm();
    };

    const KindBadge = ({ kind }) => {
      const palette = {
        "ERC-721":  { bg: "rgba(255,60,56,0.10)",   fg: "var(--dao-red-dim)" },
        "ERC-1155": { bg: "rgba(218,165,32,0.16)",  fg: "rgb(140,100,8)" },
        "ERC-20":   { bg: "rgba(40,86,122,0.10)",   fg: "var(--dao-blue-800)" },
      }[kind] || { bg: "var(--surface-elevated)", fg: "var(--text-muted)" };
      return (
        <span className="font-mono" style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
          padding: "2px 6px", borderRadius: 4,
          background: palette.bg, color: palette.fg,
        }}>{kind}</span>
      );
    };

    return (
      <div style={{ marginTop: 8 }}>
        {/* Header with count + add button */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span className="font-mono" style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            {tokens.length} contract{tokens.length === 1 ? "" : "s"} in registry · click to select
          </span>
          <button
            type="button"
            onClick={() => _isFormOpen ? _closeForm() : setShowAdd(true)}
            className="font-mono"
            style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "6px 12px", borderRadius: 6,
              background: _isFormOpen ? "var(--dao-blue-900)" : "var(--dao-red)",
              color: "white",
              border: "none", cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            {_isFormOpen ? "Cancel" : "+ Add new contract"}
          </button>
        </div>

        {/* Add-new / edit inline form */}
        {_isFormOpen && (
          <div style={{ padding: 16, background: "var(--surface-card)", border: "1px dashed var(--dao-blue-700)", borderRadius: 12, marginBottom: 10 }}>
            <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 10 }}>{editingId ? "Edit eligibility contract" : "New eligibility contract"}</div>
            <input
              className="input font-mono"
              placeholder="Contract address (0x…)"
              value={draft.address}
              onChange={e => setDraft(d => ({ ...d, address: e.target.value }))}
              style={{ width: "100%", marginBottom: 8, fontSize: 12 }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <input
                className="input"
                placeholder="Symbol (e.g. BADGE)"
                value={draft.symbol}
                onChange={e => setDraft(d => ({ ...d, symbol: e.target.value.toUpperCase() }))}
                style={{ fontSize: 13 }}
              />
              <input
                className="input"
                placeholder="Name"
                value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                style={{ fontSize: 13 }}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              <select className="input" value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value }))} style={{ fontSize: 13 }}>
                <option>ERC-721</option>
                <option>ERC-1155</option>
                <option>ERC-20</option>
              </select>
              <select className="input" value={draft.chain} onChange={e => setDraft(d => ({ ...d, chain: e.target.value }))} style={{ fontSize: 13 }}>
                <option>Ethereum</option>
                <option>Optimism</option>
                <option>Base</option>
                <option>Arbitrum</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" onClick={_closeForm} style={{ fontSize: 12 }}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={editingId ? saveEdit : addToken}
                disabled={!draft.address || !draft.symbol}
                style={{ fontSize: 12, opacity: (!draft.address || !draft.symbol) ? 0.5 : 1 }}
              >{editingId ? "Save changes" : "Save contract"}</button>
            </div>
          </div>
        )}

        {/* Always-visible token list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {tokens.map(t => {
            const isSelected = t.id === selectedId;
            return (
              <div key={t.id}
                onClick={() => onSelect(t.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", borderRadius: 10,
                  background: isSelected ? "rgba(255,60,56,0.10)" : "var(--surface-card)",
                  border: isSelected ? "1.5px solid var(--dao-red)" : "1px solid var(--stroke-line-2)",
                  cursor: "pointer",
                  transition: "background .12s, border-color .12s",
                  position: "relative",
                }}
                onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.background = "var(--surface-elevated)"; e.currentTarget.style.borderColor = "var(--stroke-line-2)"; } }}
                onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.background = "var(--surface-card)"; e.currentTarget.style.borderColor = "var(--stroke-line-2)"; } }}
              >
                {/* Radio indicator */}
                <div style={{
                  width: 18, height: 18, borderRadius: 999, flexShrink: 0,
                  border: isSelected ? "5px solid var(--dao-red)" : "2px solid var(--stroke-line-2)",
                  background: "var(--surface-card)",
                  transition: "border .12s",
                }} />
                <TokenAvatar token={t} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="font-display" style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>{t.symbol}</span>
                    <span className="font-body" style={{ fontSize: 13, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                    <KindBadge kind={t.kind} />
                  </div>
                  <div className="font-mono" style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                    {shortAddr(t.address)} · {t.chain} · {t.holders} holders
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); _beginEdit(t); }}
                  title="Edit this contract"
                  style={{
                    width: 26, height: 26, borderRadius: 6, border: "none",
                    background: "transparent", cursor: "pointer",
                    color: "var(--text-faint)", fontSize: 15, lineHeight: 1, flexShrink: 0,
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = "var(--dao-blue-800)"}
                  onMouseLeave={e => e.currentTarget.style.color = "var(--text-faint)"}
                >✎</button>
                {tokens.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeToken(t.id); }}
                    title="Remove from registry"
                    style={{
                      width: 26, height: 26, borderRadius: 6, border: "none",
                      background: "transparent", cursor: "pointer",
                      color: "var(--text-faint)", fontSize: 18, lineHeight: 1, flexShrink: 0,
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = "var(--dao-red)"}
                    onMouseLeave={e => e.currentTarget.style.color = "var(--text-faint)"}
                  >×</button>
                )}
              </div>
            );
          })}
          {tokens.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13, background: "var(--surface-card)", border: "1px dashed var(--dao-stroke-2)", borderRadius: 10 }}>
              No contracts in your registry yet. Click <b>+ Add new contract</b> above.
            </div>
          )}
        </div>
      </div>
    );
  }

  function TokenAvatar({ token }) {
    if (!token) return null;
    // Deterministic gradient from address
    const seed = token.address ? parseInt(token.address.slice(2, 8), 16) : 0;
    const h1 = (seed % 360);
    const h2 = ((seed >> 6) % 360);
    return (
      <div style={{
        width: 36, height: 36, borderRadius: 999, flexShrink: 0,
        background: `linear-gradient(135deg, hsl(${h1} 70% 55%), hsl(${h2} 70% 35%))`,
        display: "grid", placeItems: "center",
        color: "white", fontWeight: 700, fontSize: 11,
        fontFamily: "JetBrains Mono, monospace",
        letterSpacing: "0.04em",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
      }}>{(token.symbol || "?").slice(0, 4)}</div>
    );
  }

  // ── Round editor (create / edit) ─────────────────────────────────
  function F2RoundEditor({ initial, tokens, setTokens, onSave, onCancel }) {
    const isNew = !initial;
    const [r, setR] = useState(initial || {
      id: `r-${Date.now().toString(36)}`,
      title: "",
      blurb: "",
      voting: "quadratic",
      budget: 100,
      cap: 3,
      opens: "",
      closes: "",
      rolling: false,
      status: "draft",
      voters: 0,
      issueIds: [],
      accent: "blue",
      tokenId: null,
    });
    const set = (k, v) => setR({ ...r, [k]: v });
    const selectedToken = tokens.find(t => t.id === r.tokenId);

    return (
      <div style={{ padding: "32px 40px", maxWidth: 880, margin: "0 auto" }}>
        <a onClick={onCancel} className="font-mono" style={{ fontSize: 11, color: "var(--text-secondary)", letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}>← Admin</a>
        <div className="font-display" style={{ fontSize: 44, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em", marginTop: 8 }}>
          {isNew ? "Create murmuration" : "Edit murmuration"}
        </div>

        <div style={{ background: "var(--dao-paper-2)", borderRadius: 14, padding: 28, marginTop: 24, display: "flex", flexDirection: "column", gap: 18 }}>
          <Field label="Title">
            <input className="input" value={r.title} onChange={e => set("title", e.target.value)} placeholder="Round 8 — …" />
          </Field>
          <Field label="Description">
            <textarea className="input" rows={2} value={r.blurb} onChange={e => set("blurb", e.target.value)} placeholder="What this murmuration is about. One or two sentences." />
          </Field>

          <div>
            <label className="font-mono" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Voting mechanism</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
              {[
                { v: "quadratic", t: "Quadratic", d: "Cost = pts². Depth gets expensive — encourages spread." },
                { v: "token-weight", t: "Token-weight", d: "1 vote = 1 credit. Each ETHSecurity Badge holder gets 100 votes." },
              ].map(opt => (
                <button key={opt.v} onClick={() => set("voting", opt.v)} style={{
                  textAlign: "left", padding: 16, borderRadius: 10, cursor: "pointer",
                  background: r.voting === opt.v ? "var(--dao-blue-900)" : "var(--surface-card)",
                  color: r.voting === opt.v ? "white" : "var(--text-primary)",
                  border: r.voting === opt.v ? "1px solid var(--dao-blue-900)" : "1px solid var(--stroke-line-2)",
                }}>
                  <div className="font-display" style={{ fontWeight: 700, fontSize: 16 }}>{opt.t}</div>
                  <div className="font-body" style={{ fontSize: 12, opacity: 0.75, marginTop: 4, lineHeight: 1.5 }}>{opt.d}</div>
                </button>
              ))}
            </div>
          </div>

          <Field label={r.voting === "quadratic" ? "Budget (credits)" : "Votes per holder"}>
            <input className="input font-mono" type="number" value={r.budget} onChange={e => set("budget", Number(e.target.value))} />
          </Field>

          <div>
            <label className="font-mono" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Schedule</label>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-primary)" }}>
                <input type="checkbox" checked={r.rolling} onChange={e => set("rolling", e.target.checked)} />
                Always open (no end date)
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
              <Field label="Opens (UTC)">
                <input className="input font-mono" placeholder="2026-05-01 08:00 UTC" value={r.opens} onChange={e => set("opens", e.target.value)} />
              </Field>
              <Field label="Closes (UTC)">
                <input className="input font-mono" placeholder={r.rolling ? "— rolling —" : "2026-05-15 20:00 UTC"} value={r.rolling ? "" : r.closes} onChange={e => set("closes", e.target.value)} disabled={r.rolling} />
              </Field>
            </div>
          </div>

          <div>
            <label className="font-mono" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Eligibility token / NFT</label>
            <div className="font-body" style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.55 }}>
              Holders of this contract are eligible to vote in this round. The first token in your registry is the default — change it any time.
            </div>
            <TokenPicker
              tokens={tokens}
              setTokens={setTokens}
              selectedId={r.tokenId}
              onSelect={(id) => set("tokenId", id)}
            />
            {showErrors && !r.tokenId && (
              <div className="font-mono" style={{ fontSize: 11, color: "var(--dao-red)", marginTop: 6 }}>
                Pick an eligibility token before publishing.
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTop: "1px solid var(--dao-stroke-2)" }}>
            <div style={{ display: "flex", gap: 8 }}>
              {!isNew && (
                <button className="btn btn-ghost" style={{ color: "var(--dao-red-dim)" }}>Pause</button>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
              <button className="btn btn-ghost" onClick={() => onSave({ ...r, status: "draft" })}>Save draft</button>
              <button className="btn btn-primary btn-lg" onClick={() => onSave({ ...r, status: "open" })}>{isNew ? "Publish murmuration →" : "Save & publish →"}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── App shell ────────────────────────────────────────────────────
  function F2App() {
    const [screen, setScreen] = useState("connect");
    const [role, setRole] = useState("badgeholder");
    const [rounds, setRounds] = useState(ROUNDS);
    const [currentRound, setCurrentRound] = useState(null);
    const [currentIssue, setCurrentIssue] = useState(null);
    const [editingRound, setEditingRound] = useState(null); // round obj or "new"
    // Start with a clean ballot — the prototype shouldn't surprise the
    // user with phantom allocations when they land on a round.
    const [allocations, setAllocations] = useState({});

    // Token / NFT eligibility registry — admin-managed. Each entry is a
    // contract whose holders can vote in a round. The first entry is the
    // default for new rounds; admin can change which one is default.
    const [tokens, setTokens] = useState([
      { id: "tok-badge",   address: "0xBA1F2c52f7B6A8d4e6bDc09b5e3A3D9e4cC4dd9e4", chain: "Ethereum", symbol: "BADGE",  name: "ETHSecurity Badge",      kind: "ERC-721",  holders: 200,  isDefault: true },
      { id: "tok-prysm",   address: "0x4E83362442B8d1bec281594cEa3050c8EB01311C", chain: "Ethereum", symbol: "PRYSM",  name: "Prysm Validator Pass",  kind: "ERC-721",  holders: 87,   isDefault: false },
      { id: "tok-seal",    address: "0x9CB3343Cd4F2D3F2B3aA1e0BBcA64DfFDEB3Cf45", chain: "Ethereum", symbol: "SEAL",   name: "SEAL 911 Responder",    kind: "ERC-1155", holders: 142,  isDefault: false },
      { id: "tok-eth-foundation", address: "0xDe0B295669a9FD93d5F28D9Ec85E40f4cb697BAe", chain: "Ethereum", symbol: "EFDAO", name: "EF Working Group", kind: "ERC-20",   holders: 1432, isDefault: false },
    ]);

    if (screen === "connect") {
      return <F2Connect onConnect={(r) => { setRole(r); setScreen("rounds"); }} />;
    }

    const nav = (s) => {
      setCurrentIssue(null);
      setEditingRound(null);
      if (s === "rounds") {
        setCurrentRound(null);
        if (typeof window !== "undefined" && window.location.pathname !== "/votes") {
          window.history.pushState({}, "", "/votes");
        }
      }
      setScreen(s);
    };

    // URL ↔ state sync for deep-linkable per-vote URLs (/vote/<id>).
    // Page-load + back/forward both flow through here.
    useEffect(() => {
      const syncFromUrl = () => {
        if (typeof window === "undefined") return;
        const m = window.location.pathname.match(/^\/vote\/([^/]+)\/?$/);
        if (m) {
          setCurrentRound(m[1]);
          setCurrentIssue(null);
          setEditingRound(null);
          setScreen("round");
        } else {
          // /votes (or anything else inside F2App) → rounds list.
          setCurrentRound(null);
          setCurrentIssue(null);
          setEditingRound(null);
          setScreen("rounds");
        }
      };
      syncFromUrl();
      window.addEventListener("popstate", syncFromUrl);
      return () => window.removeEventListener("popstate", syncFromUrl);
    }, []);

    const round = currentRound ? rounds.find(r => r.id === currentRound) : null;

    return (
      <F2Chrome active={screen === "round" || screen === "issue" ? "rounds" : screen} onNav={nav} role={role} address={address} isIncognito={isIncognito} onDisconnect={() => { setScreen("connect"); setRole("visitor"); }} onConnectClick={onConnectClick} connected={!!address}>
        {screen === "rounds" && (
          <F2RoundsList
            rounds={rounds}
            role={role}
            onOpen={(id) => {
              setCurrentRound(id);
              setScreen("round");
              if (typeof window !== "undefined") {
                window.history.pushState({}, "", "/vote/" + id);
              }
            }}
            onCreate={() => { setEditingRound("new"); setScreen("editor"); }}
          />
        )}
        {screen === "round" && round && (
          <F2RoundDetail
            round={round}
            allocations={allocations}
            setAllocations={setAllocations}
            role={role}
            onOpenIssue={(id) => { setCurrentIssue(id); setScreen("issue"); }}
            onSubmit={() => setScreen("submit")}
          />
        )}
        {screen === "round" && !round && _hydrationDone && (
          <F2RoundNotFound
            onBack={() => {
              setCurrentRound(null);
              setScreen("rounds");
              if (typeof window !== "undefined") {
                window.history.pushState({}, "", "/votes");
              }
            }}
          />
        )}
        {screen === "round" && !round && !_hydrationDone && (
          <F2RoundSkeleton />
        )}
        {screen === "issue" && round && currentIssue && (
          <F2IssueDetail
            issue={ISSUES.find(i => i.id === currentIssue)}
            round={round}
            allocations={allocations}
            setAllocations={setAllocations}
            role={role}
            onBack={() => setScreen("round")}
          />
        )}
        {screen === "submit" && (
          <F2Submit rounds={rounds} role={role} />
        )}
        {screen === "ballot" && (
          <F2Ballot rounds={rounds} address={address} />
        )}
        {screen === "admin" && canAdmin(role) && (
          <F2Admin
            rounds={rounds}
            setRounds={setRounds}
            onCreate={() => { setEditingRound("new"); setScreen("editor"); }}
            onEdit={(id) => { setEditingRound(id); setScreen("editor"); }}
          />
        )}
        {screen === "editor" && canAdmin(role) && (
          <F2RoundEditor
            initial={editingRound === "new" ? null : rounds.find(r => r.id === editingRound)}
            tokens={tokens}
            setTokens={setTokens}
            onSave={(saved) => {
              setRounds(prev => {
                const idx = prev.findIndex(p => p.id === saved.id);
                if (idx === -1) return [saved, ...prev];
                const copy = [...prev]; copy[idx] = saved; return copy;
              });
              setScreen("admin");
            }}
            onCancel={() => setScreen("admin")}
          />
        )}
      </F2Chrome>
    );
  }

  return { F2App };
})();

window.F2App = F2.F2App;
