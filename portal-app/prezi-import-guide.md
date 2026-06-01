# Prezi Import Guide — Portal Rewrite Pitch

Author the management-approval Prezi using the slide content below. Pair with `portal-rewrite-keynotes.md` (the 28-minute speaker script).

**Plan:** Prezi.com → New presentation → blank canvas → 11 slides + 1 overview → wire the camera path → rehearse. ~90 minutes.

## Design rules — apply throughout

- **One dominant visual per slide.** Photograph, render, or illustration that fills 50–60% of the frame.
- **No bullet lists in slide bodies.** Render the content as a visual primitive (two-column comparison, before/after pair, number contrast, three-card row). Bullets belong in the speaker notes, not on screen.
- **Maximum 30 words of body copy per slide.** If a thought needs more, it goes in narration.
- **Consistent typography.** One sans-serif (Inter, Söhne, or Prezi's default), one display weight (900 for headlines), tabular numerals for the 5→1 / 7→5 / 9→5 / 10 decisions.
- **One accent colour per slide,** lifted from the dominant image. Background stays neutral (cream, off-white, charcoal, or deep navy).
- **Zoom hierarchy:**
  - Overview at the start: camera pulled back wide (scale 6–8).
  - Story slides: camera at natural scale (~1).
  - The opener (Slide 1) and the close (Slide 11): camera tight (scale 0.7–0.85).
- **Transitions are Prezi's default smart-zoom.** No custom Z-axis, no rotation tricks, no stretch.
- **No audio bed.** The speaker is the audio.

## Spatial map

Use Prezi's free-positioning canvas with a simple two-spine layout:

```
                                           ┌────────────┐
                                           │  06        │
                                           │  Mental    │
                                           │  model     │
                                           └────────────┘
                                                 ▲
                                                 │
   ┌───────────┐                            ┌────┴───┐                       ┌───────────┐
   │  02       │ ┌───────────┐ ┌───────────┐│  01    │┌───────────┐ ┌───────────┐  07    │
   │  Funnel   │ │  03       │ │  04       ││  Open   ││  07       │ │  08       │       │
   │  5→1      │ │  Consent  │ │  Operator ││  Ten    ││  Roadmap  │ │  Migrate  │       │
   │           │ │  ≠ Action │ │  7→5      ││  fric.  ││  v1 vs    │ │  Soft     │       │
   │           │ │           │ │           ││  (the   ││  deferred │ │  landing  │       │
   └───────────┘ └───────────┘ └───────────┘│  open)  │└───────────┘ └───────────┘
                                ┌───────────┤        ├──────────┐
                                │  05       │        │  09      │
                                │  Admin    │        │  New     │
                                │  9→5      │        │  orgs    │
                                └───────────┘        └──────────┘
                                                 │
                                                 ▼
                                           ┌────────────┐
                                           │  10        │
                                           │  Three     │
                                           │  asks      │
                                           └────────────┘
```

Section 01 sits dead centre. Sections 02–05 fan out to the upper-left (the operator/admin journey). Sections 07–09 fan out to the upper-right (the rollout journey). Section 06 sits above (the conceptual bridge). Section 10 sits below as the destination.

Or — if this is too involved — **a straight horizontal path** also works. Prezi's smart-zoom will keep transitions interesting on a linear layout because each slide is composed differently. The 2D spine is a polish move, not a requirement.

**Camera order:** 0 (overview) → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10.

---

## Slide-by-slide build sheet

### Slide 0 · Overview

| Title | Portal Rewrite |
|---|---|
| Subtitle | Ten frictions. One prototype. Three calls before we build. |
| Caption | Dex Technologies leadership · May 2026 |
| Visual | Sleek hero image — abstract data-flow visualization, modern operations dashboard photograph, or a clean isometric illustration of connected nodes. Subdued, professional, sets the tone. |
| AI prompt | "Cinematic abstract visualization of interconnected data streams flowing between nodes against a deep navy background, with selective warm amber highlights. Editorial style, sophisticated, no readable text, 16:9." |
| Time | ~60 sec opener |

### Slide 1 · Ten frictions

| Title | Ten frictions. Eleven costs we pay every quarter. |
|---|---|
| Subhead | Five paid by customers. Five paid by our own teams. |
| Body | Two columns of 5 personas each, with a single-phrase pain after each name. **Customer side:** Operator · *retention risk* / Service Provider · *audit exposure* / DEX admin · *time-to-market* / Platform admin · *activation drop-off* / Pack dispatcher · *top-account ceiling*. **Internal side:** BD · *pipeline velocity* / Product · *roadmap drag* / Engineering · *catalogue relay* / UIUX · *surface-area sprawl* / Ops · *ticket & change load*. |
| Closing line | *Customers move the metric. Our teams move the cost.* |
| Visual | A photographic or rendered "operations centre at the end of a long day" — overhead shot of a busy desk with multiple monitors, scattered paperwork, low warm light. Or a sophisticated infographic where the 10 names sit in a 5+5 grid against the visual. |
| AI prompt | "Overhead photograph of a modern operations centre at dusk, multiple monitors glowing softly, scattered paperwork on a wide desk, low warm light, no people visible, editorial photography style, 16:9." |
| Time | ~8 min (the core pitch) |

### Slide 2 · Five consent types collapse into one

| Title | Five consent types collapse into one Agreement. |
|---|---|
| Body | Today's system has 5 contract types (Subscription · DER · SPR · Tripartite · Direct). The new portal has one Agreement with two intents. **One contract type. One wizard. One lifecycle.** |
| Visual | A converging-flow diagram — five differently-shaped paths merging into a single channel. Or a stock photograph of multiple paper documents being stacked into one folder. |
| AI prompt | "Minimalist editorial illustration of five differently-shaped streams converging into a single broader channel, deep navy background with warm amber accent on the converged channel, no readable text, 16:9." |
| Time | ~2 min |

### Slide 3 · Consent and action are decoupled

| Title | Consent and action are decoupled. |
|---|---|
| Body | **Consent** is decided once, at Agreement creation — who can send, what data, under what terms. **Action** is just filling the data — for every Message under that Agreement. The structural shift. Not a UI re-skin. |
| Visual | A clean photograph or render of a signed document on a desk in the foreground (consent) with translucent abstract data flowing in the background (action). One frame, two layers of activity. |
| AI prompt | "Editorial photograph of a signed contract on a wooden desk in sharp focus, with translucent flowing-data light streaks in soft focus behind it, warm desk lamp, deep background, no readable text on the contract, 16:9." |
| Time | ~2 min |

### Slide 4 · Send a Cargo manifest. Two fewer steps.

| Title | Send a Cargo manifest. Two fewer steps. |
|---|---|
| Body | Pre-Composer: **7 steps**, refresh-to-verify, two form-route vocabularies. Post: **5 steps**, live timeline, one vocabulary. Same task. Two fewer translation steps. |
| Visual | A clean before/after diptych. Left: 7 numbered dots on a longer path. Right: 5 numbered dots on a shorter path. Both styled identically; the difference is the count and the visual breathing room. |
| AI prompt | "Minimalist editorial diptych showing two horizontal paths: left path has 7 small circular markers, right path has 5 small circular markers, deep navy on cream, accent line in warm amber, clean editorial style, no readable text, 16:9." |
| Time | ~2 min |

### Slide 5 · Register a new document type. Days → minutes.

| Title | Register a new document type. Days → minutes. |
|---|---|
| Body | Today: **9 steps**, 4 actor types in a relay, days to weeks. New: **5 steps**, 1 admin at 1 screen, minutes. Smart Start drafts. Test-as-operator verifies. The catalogue relay is gone. |
| Sarah quote (read aloud) | *"Every quarter I open three tabs — the Confluence requirements page, the BD spec sheet, the IMDA standard — and hand-translate them into a schema."* |
| Visual | Before/after diptych. Left: photo or illustration of a cluttered shared workspace with multiple people involved in paper-shuffling. Right: clean focused workstation, one person, one screen, calm. |
| AI prompt | "Editorial diptych: left panel shows a cluttered office with multiple people exchanging paperwork around a central desk (chaotic warm light); right panel shows a single person at a clean modern workstation in cool blue light (calm). Same scale, different vibe, no readable text, 16:9." |
| Time | ~2 min |

### Slide 6 · Three questions. Three sections.

| Title | Three questions. Three sections. |
|---|---|
| Body (three pillars) | **WORK** · *"What needs my attention?"* · Inbox · Drafts. **EXCHANGE** · *"What's the business state?"* · Agreements · Messages. **DIRECTORY** · *"What are the building blocks?"* · Data elements · Participants. |
| Visual | Three equal columns or three clean illustrated panels — one icon per concept. Keep the typography big. The slide's job is to make the three labels memorable. |
| AI prompt | "Three minimal editorial illustrations side by side, equal width: first shows a stylised inbox stack, second shows a stylised contract-and-data-flow pair, third shows a stylised catalog of indexed records. Deep navy background, warm amber accents, no readable text, 16:9." |
| Time | ~1 min |

### Slide 7 · Ten decisions

| Title | Ten decisions. Each cancels a friction from slide 1. |
|---|---|
| Body | Ten short labels arranged as a 2 × 5 grid: 01 Inbox is home · 02 One Messages page · 03 One status vocabulary · 04 Compose under an Agreement · 05 Terms frozen at acceptance · 06 Notifications match the stakes · 07 Multi-counterparty packs · 08 Describe your own side · 09 Admins author elements · 10 Pre-staged Drafts. |
| Caption | *Read each as: because operators pay X today, we made decision Y.* |
| Visual | Ten small numbered cards arranged in a clean 2 × 5 grid, each with the decision label. Or — for more wow — a constellation of ten dots connected by faint lines on a dark background. |
| AI prompt | "Editorial illustration of ten small luminous dots arranged in a loose constellation pattern on a deep navy field, faint connecting lines between adjacent dots, each dot tagged with a numbered brass plate at its base (leave numbers blank for overlay), warm amber glow, no readable text, 16:9." |
| Time | ~3 min |

### Slide 8 · Six months to v1. Honest about deferred.

| Title | Six months to v1. Honest about deferred. |
|---|---|
| Body — two columns | **v1 ships in 6 months:** One portal · Inbox home · One Messages page · Live timeline · One Composer + auto-review · Watch toggle · Cross-network warnings · Settings → Pitstops. **Deferred (waits on platform):** Schema-negotiation handshake · In-place Agreement amendments · Bulk send · Test mode · Org-wide failure banner · Mobile push. |
| Pull | *All deferred items wait on one shared coordination layer.* |
| Visual | A clean two-column board — left column saturated and bold (v1), right column muted and faded (deferred). Or a stylised Gantt-strip showing v1 items on the timeline and deferred items in a holding lane. |
| AI prompt | "Minimalist editorial illustration of two parallel timeline strips: top strip vibrant with cards arranged along it (v1), bottom strip faded with cards in a holding-bay arrangement (deferred). Deep navy background, warm amber for the active strip, cool grey for the faded strip, no readable text, 16:9." |
| Time | ~2 min |

### Slide 9 · Migration is a design problem.

| Title | Migration is a design problem. Not a flag-day. |
|---|---|
| Body — three guarantees | 🔗 **Bookmarks don't break** — legacy URLs redirect automatically. 📁 **Drafts carry over** — in-progress work appears at the same stage. ℹ **One first-login panel** — dismissible, audit-logged, gone after acknowledgement. |
| Visual | A three-panel row of clean illustrations or icons — one per guarantee. Keep them consistent in style. |
| AI prompt | "Editorial triptych of three minimalist illustrations: first shows a redirected arrow connecting old and new addresses; second shows a half-written letter being lifted between trays without disturbing the writing; third shows a single information card being handed across a counter. Warm amber and cream on cool navy, consistent style across all three, no readable text, 16:9." |
| Time | ~1 min |

### Slide 10 · Empty inbox → consequential inbox.

| Title | Empty inbox → consequential inbox. |
|---|---|
| Body — before/after | **Today:** new org logs in, inbox is empty, support ticket: *"Where do I start?"* **New portal:** pre-staged Drafts populated during the same KYC pass — *"Welcome. 8 drafts ready for review."* |
| Pull | *The Platform Admin's due-diligence labour becomes the new operator's first impression.* |
| Visual | Two clean inbox mocks side by side. Left: empty, just a "Welcome" line. Right: populated with 8 labelled drafts. Realistic UI styling, same shell, different state. |
| AI prompt | "Editorial side-by-side comparison of two clean modern inbox UIs in the same shell. Left panel: empty inbox with just a 'Welcome' greeting visible. Right panel: same inbox shell but populated with eight labelled draft items. Cream cards on deep navy background, no readable text content, 16:9." |
| Time | ~1 min |

### Slide 11 · Three asks. One decision.

| Title | Three calls before the build begins. |
|---|---|
| Body — three asks | **A · Confirm who can send data on each Agreement.** Only the data owner (or a service provider explicitly acting on their behalf) composes Messages. Today's system is more permissive. *Product Lead + Compliance · before kickoff.* **B · Confirm "revoke and recreate" for schema changes.** In-place amendments arrive later, once the coordination layer ships. *Product Lead + Engineering Lead · before kickoff.* **C · Greenlight a one-week user-test round.** 5–6 operators · 3 sample tasks each. *UIUX Lead + Product Lead · within 2 weeks.* |
| Closer | Approvals today. Build starts in 2 weeks. v1 ships in 6 months. |
| Visual | Three clean cards side by side, each with the letter (A, B, C) in large display weight, the title, the brief, and the owner line in tabular numerals. The cards are the slide. |
| AI prompt | "Editorial photograph of three pristine blank cards laid out on a polished wood desk, equal spacing, soft directional warm light from upper left, deep navy background, subtle paper texture, no readable text on the cards, 16:9." |
| Time | ~3 min — *the most important slide. Pause after each ask. Look at the owner.* |

---

## What to NOT do

- **No metaphors.** Not city, not mail, not port, not anything. The content stands.
- **No bullet lists in slide bodies.** Render every list as a visual primitive (grid, columns, dots, cards).
- **No clip-art or stock-photo cliché.** If you can't get a great image, leave the slide cleaner with just typography. Bad imagery is worse than none.
- **No more than one accent colour per slide.** Background neutral; one warm amber or signal red highlight at the focal point.
- **No audio bed.** The speaker is the audio.
- **No animation gimmicks.** Prezi's smart-zoom is sufficient. Don't add page-turn or fly-in.

## Image direction (pick one path)

1. **Stock photography (fastest, free).** Unsplash search terms per slide are baked into the AI prompts above — use them as keywords. Look for: editorial photography, no people front-of-frame, deep navy + warm amber, sophisticated. Avoid: stock-photo handshakes, fake-smile teams, generic concept clip-art.
2. **AI generation (best fidelity, medium effort).** Copy the AI prompts above into FLUX / Gemini / DALL-E / Midjourney. The prompts are written to produce editorial-style images, not generic AI looks.
3. **Prezi's built-in library (lowest effort, lowest ceiling).** Searching Prezi for "data flow", "operations", "contract", "timeline" turns up usable assets — quality varies.

## Where the rest lives

- **28-minute speaker script:** `portal-app/portal-rewrite-keynotes.md` — read this alongside each slide.
- **Q&A pre-answers + acceptance criteria:** appendix of the keynotes file.
- **Web version of the same content:** `portal-app/index.html` — share as a link after the meeting.

## Build order

1. **Slide 1** first — it sets the visual direction. Get the imagery, typography scale, and accent colour right here.
2. **Slide 11** second — confirms the close lands.
3. **Slide 0 (overview)** third — once 1 and 11 exist, you know what to thumbnail.
4. Fill in slides 2–10 in order.
5. Wire the camera path.
6. Rehearse once end-to-end with the keynote file open.

## In-repo presenter view

`portal-app/present.html` — deprecated. The Prezi is the authoritative presentation.
