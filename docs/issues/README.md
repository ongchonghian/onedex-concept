# Issues — local markdown queue

Tracer-bullet vertical slices broken out from the grilling session of 2026-05-17 on the user / role / company / DEX-enrolled fixture model. Sources: [ADR 0029](../adr/0029-user-org-affiliation-as-n-to-m-with-embedded-dex-roles.md), [ADR 0030](../adr/0030-demo-persona-resolution-via-persona-pill-and-url-dex.md), [ADR 0031](../adr/0031-counterparty-attribution-dispatch-rule.md).

Every issue carries the `needs-triage` label until a triage role picks it up. Each is either **AFK** (no human decisions, implementable straight through) or **HITL** (design or architectural judgement required — needs review).

## Queue

| # | Title | Type | Blocked by |
|---|---|---|---|
| [0001](./0001-resolver-foundation.md) | Resolver foundation — schema migration + resolveSeat() under adapter | AFK | — |
| [0002](./0002-bea-on-buildex.md) | Bea on SGBuildex with off-DEX redirect minimum gate | HITL | 0001 |
| [0003](./0003-david-on-healthdex.md) | David on SGHealthdex | AFK | 0002 |
| [0004](./0004-wei-lin-canonicalised-platform-tier.md) | Wei Lin canonicalised as platform-tier teammate | AFK | 0002 |
| [0005](./0005-counterparty-attribution-rule-wen-chen-psa.md) | Counterparty attribution rule — Wen Chen at PSA | HITL | 0001 |
| [0006](./0006-lars-andersen-maersk-scenario-d.md) | Lars Andersen on Maersk + Scenario D end-to-end | AFK | 0005 |
| [0007](./0007-tan-boon-keng-acme-cross-dex.md) | Tan Boon Keng at Acme + cross-DEX named contact | AFK | 0005 |
| [0008](./0008-profile-menu-colleague-switcher.md) | Profile menu colleague switcher + workspace pill chevron | HITL | 0003, 0004 |
| [0009](./0009-off-dex-cta-polish.md) | Off-DEX CTA polish | AFK | 0002 |
| [0010](./0010-scene-seeds-key-migration.md) | SCENE_SEEDS key migration to affiliation-keyed shape | AFK | 0002, 0003 |
| [0011](./0011-portal-wide-chrome-de-hardcoding.md) | Portal-wide chrome de-hardcoding sweep — composer, picker placeholders, settings, onboarding overlay | HITL | — |

## Dependency graph

```
0001 ──┬── 0002 ──┬── 0003 ──┬── 0008
       │         ├── 0004 ──┘
       │         ├── 0009
       │         └── 0010 ◄── 0003
       └── 0005 ──┬── 0006
                  └── 0007
```

After **0001** lands, **0002** and **0005** can run in parallel. After **0002** lands, **0003 / 0004 / 0009** are all unblocked; after **0003** also lands, **0010** can start. **0008** is the last gate — it needs both Cosco trio (0002 + 0003) and SGTradex pair (0004) to be demonstrable.

## Sequencing recommendation

1. **0001** alone (non-visible migration foundation, regression-tested)
2. **0002** alone (first visible cut, design review locks the chrome contract)
3. **0003 + 0004 + 0005** in parallel (independent slices reusing precedents)
4. **0006 + 0007 + 0009** in parallel after their respective blockers
5. **0010** after 0003 (seed migration with full DEX coverage)
6. **0008** last (colleague switcher demoable with the full roster)

Three HITL issues (0002, 0005, 0008) sequence the design-review checkpoints.
