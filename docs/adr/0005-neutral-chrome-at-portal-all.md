# Neutral platform chrome at `/portal/all`

The aggregated view (`/portal/all`) renders with neutral platform chrome — a small platform mark ("Dex"), a charcoal accent, monochrome icons. Per-DEX colour is restricted to the **DEX chip** on individual records in the inbox. Closes the open question in [ADR 0001](./0001-url-anchored-dex-context.md).

## Considered Options

- **Blended chrome (rejected).** Multi-DEX badge mosaic / cycling accent. Looks gimmicky and is hard to design well across three brands.
- **Last-active-DEX wins (rejected).** Inherits theme of the most-recently-visited DEX. Destroys the visual wayfinding signal that distinguishes `/portal/all` from `/portal/<dex>`.
- **Neutral platform chrome (chosen).** Unambiguous wayfinding, objective aggregated view, bounded design work.

## Consequences

- The Dex platform itself becomes a brand at the chrome level (logo, accent). Requires alignment with marketing/strategy on the platform name and visual identity.
- Single-DEX users never see this chrome — they always have a current DEX. The cost of this decision is borne entirely by multi-DEX users.
- If multi-DEX users push back ("/all looks cold"), a user-preference setting "tint /all in <my primary DEX>'s colour" can layer on later without changing the base design.
- The DEX chip becomes the load-bearing visual element for DEX recognition across aggregated views. Chip design must be robust at small sizes and high information density.
