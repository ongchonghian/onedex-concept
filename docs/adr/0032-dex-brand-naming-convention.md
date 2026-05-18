# DEX brand naming convention

DEX product names had drifted into at least six spellings (`TradeX`, `TradeDex`, `BuildEx`, `HealthDex`, `SGTraDex`, `SGTradEx`) plus lowercase, all-caps, and camel-case variants of the `dex*` product family (`dextech`, `dexconnect`, `DexConnect`, `dexweaver`). The drift was visible in user-facing copy, docs, and ADRs, and no rule existed to settle which spelling wins. This ADR pins the rule so future contributors stop re-litigating the question per surface.

## The rule

> **Every DEX brand name is `<3-letter prefix in CAPS><remainder in lowercase>`. The three canonical DEXes are family-prefixed with `SG`.**

The three DEXes:

| Internal id | Canonical brand name | Notes |
|---|---|---|
| `tx` | **SGTradex** | Already public-facing on the real SGTraDex initiative — the existing prefix stays. |
| `bx` | **SGBuildex** | `SG` prepended to align the family. |
| `hx` | **SGHealthdex** | `SG` prepended to align the family. |

The `dex*` product family (services that operate across the DEXes):

| Current variants | Canonical spelling |
|---|---|
| `dextech`, `Dextech`, `DEXTECH` | **DEXtech** |
| `dexconnect`, `DexConnect`, `DEXCONNECT` | **DEXconnect** |
| `dexweaver`, `Dexweaver`, `DEXWEAVER` | **DEXweaver** |

Forbidden variants for the three DEXes: anything with a capital letter mid-word (`BuildEx`, `HealthDex`, `SGTraDex`, `SGTradEx`), missing the `SG` prefix (`Buildex`, `Healthdex`), or rendered in all-caps prose (`BUILDEX`, `HEALTHDEX`, `TRADEX`). `DEXes` as a plural noun for the category is still allowed and unchanged.

## Exemptions — surfaces where the rule does NOT apply

The rule governs **brand surfaces**: user-visible copy, docs, ADRs, design specs, prose comments. It explicitly does not apply to:

1. **Code identifiers.** Two-letter dex ids (`tx`, `bx`, `hx`), JS object keys, CSS class names (`.chip-tx`, `.chip-bx`, `.chip-hx`), URL slugs (`/portal/tx/...`), constants like `VALID_DEXES = ['tx', 'bx', 'hx']`. These are technical tokens with no brand surface area; renaming would churn the codebase for zero brand-equity gain.
2. **External system references.** Go import paths (`github.com/dextech-ai/dex-monorepo/...`), DynamoDB table names (`sgtradextech-data-element-dev`), seed-file paths, repo names. These are identifiers of real infrastructure outside this repo's control.
3. **Lowercase prose nouns referring to the category.** `dex-monorepo`, `dex-repo`, the verb `dex` if it appears, references to "the dex platform" as a generic. The rule covers the *named* dexes, not the generic noun.
4. **The plural `DEXes`.** Generic plural of the category, used heavily in IA copy (`All DEXes`, `21 items across 3 DEXes`). Stays as-is.

## Why these specific choices

- **Why `SG` prefix on all three.** The TX brand has carried `SG` since inception (SGTraDex is a Singapore government-affiliated initiative). Generalising the prefix to BX and HX positions the three DEXes as one family with shared provenance, and avoids the awkwardness of the bare 3-caps rule on short stems (`BUIldex`, `HEAlthdex` read as shouts; `SGBuildex`, `SGHealthdex` read as siblings of `SGTradex`).
- **Why 3-letter caps, not 2 or 4.** Locks `SGT`/`SGB`/`SGH` into the prefix and keeps the rule mechanically applicable to future DEXes (`SG_x_…`). A 2-letter rule would only cap `SG` and leave the third character ambiguous; a 4-letter rule would split inconsistent stems.
- **Why lowercase the rest.** Mid-word capitals in `BuildEx`/`HealthDex` were artefacts of the original camel-case spellings — they convey no information once the prefix is fixed and just create more variants to police.

## Trademark / legal note

`SGBuildex` and `SGHealthdex` did not previously exist as public brand spellings. This ADR introduces them as the **internal canonical** for prototype, portal, and design-concept work. Before any of these names appears in outward-facing surfaces (press, contracts, marketing copy, customer-visible UI in production), the spellings must be confirmed with legal and marketing — the trademark wins over this rule if it disagrees.

`SGTradex` is the canonical internal spelling; the public-facing real-world brand is `SGTraDex`. Any external collateral that references the live initiative may need to revert to the trademarked spelling — flag at the point of publication.

## Migration

The first sweep of this rule covers user-facing copy in `portal-app/`, `portal-prototype.html`, `CONTEXT.md`, the `portal_*_brainstorm.md` files, and all ADRs in `docs/adr/`. Code identifiers and Go imports are excluded per the exemption list. Test files are renamed where they assert against display copy and left alone where they assert against `dexId`/key code identifiers.

## Status

Accepted 2026-05-18.
