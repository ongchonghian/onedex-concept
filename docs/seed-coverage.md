# SCENE_SEEDS coverage

> **Auto-generated.** Run `node portal-app/scripts/build-seed-coverage.js` to regenerate.
> Last build: 2026-05-17

## Roster

- **13** users
- **12** orgs
- **13** user–org affiliations
- **12** org–DEX memberships

## Scene catalogue

- **8** total scenes in `SCENE_SEEDS`
- **8** with full `detail` seed
- **0** with placeholder slots (null screens) — render via per-DEX fallbacks

Legend: **F** = full seed · **·** = placeholder (null/empty) · **—** = slot absent

| Scene key | User | Org | DEX | Scen | detail | inbox | message-detail | dashboard | drafts | participants | agreements | messages |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `bea-cosco-bx-C` | bea | cosco | bx | C | F | F | F | · | F | F | F | F |
| `david-cosco-hx-C` | david | cosco | hx | C | F | F | F | · | F | F | F | F |
| `marcus-cosco-tx-A` | marcus | cosco | tx | A | F | — | — | — | — | — | — | — |
| `marcus-cosco-tx-B` | marcus | cosco | tx | B | F | — | — | — | — | — | — | — |
| `marcus-cosco-tx-C` | marcus | cosco | tx | C | F | · | · | · | F | F | F | F |
| `pat-crimsonlogic-tx-D` | pat | crimsonlogic | tx | D | F | F | — | — | — | — | — | — |
| `marcus-cosco-tx-E` | marcus | cosco | tx | E | F | — | — | — | — | — | — | — |
| `marcus-cosco-tx-F` | marcus | cosco | tx | F | F | — | — | — | — | — | — | — |

## Per-DEX coverage

- **SGTradex**: 6 scenes (6 full)
  - `marcus-cosco-tx-A`
  - `marcus-cosco-tx-B`
  - `marcus-cosco-tx-C`
  - `pat-crimsonlogic-tx-D`
  - `marcus-cosco-tx-E`
  - `marcus-cosco-tx-F`
- **SGBuildex**: 1 scene (1 full)
  - `bea-cosco-bx-C`
- **SGHealthdex**: 1 scene (1 full)
  - `david-cosco-hx-C`

## How to add a scene

See [seed-authoring.md](./seed-authoring.md). Quick path:

```js
// in the browser console
const s = scaffoldScene('bea', 'bx', 'A');
copy(s.toJSCode());                       // copy to clipboard
// then paste into SCENE_SEEDS in portal-app/scripts/state.js
```

Run the doctor (`?doctor=1` in the URL, or `runSeedDoctor()` in the console) after editing to catch orphan references.
