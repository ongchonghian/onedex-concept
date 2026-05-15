# URL-anchored DEX context in the unified portal

The unified portal serves users who may hold memberships in multiple DEXes (SGTraDex, BuildEx, HealthDex). We need a way to know which DEX a given page is operating in. We chose to anchor the DEX in the URL path: `/portal/<dex>/...` for DEX-scoped views and `/portal/all/...` for the aggregated multi-DEX view. `/portal` alone redirects to the user's single DEX (if they have one) or `/portal/all` (if they have multiple).

## Considered Options

- **URL-anchored (chosen).** Every URL is unambiguous; permalinks share cleanly without session state; two browser tabs can each hold a different DEX.
- **Profile-default-anchored.** A `primary_dex` on the user profile drives initial landing; switcher mutates session. Rejected — breaks permalinks and creates cross-tab race conditions.
- **Record-scoped.** No top-level DEX; current DEX derives from whichever record is open. Rejected — the inbox-first home and the DEX switcher both need a notion of "where am I right now" that isn't tied to a record.
- **Hybrid (URL for sections, record-scoped for records).** Rejected — the rule is hard to teach and creates ambiguity when a record-level URL is pasted to someone who hasn't opened that record.

## Consequences

- Routing logic must redirect `/portal` based on the user's `org_dex_membership` cardinality.
- A pasted URL to a DEX the recipient doesn't belong to must produce a graceful "you don't have access to this DEX" page, not a generic 403.
- DEX theme is loaded from the path's `<dex>` segment; the `/portal/all` view requires its own neutral theme (not yet specified — open question).
