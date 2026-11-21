# Brief: the 3D HUD's colors from the game's own UI tags

Repo: `P:\software\infinite-theater-3d`. Read its `CLAUDE.md` first, and check `docs/sys/lookup.json`
before searching. Work in a worktree under `.worktrees\` on a `work/` branch. Run only the test files
you touch (`--maxWorkers=2` for vitest), never full suites. Never commit anything under root `data/`,
game-derived assets, or `zz_*` probe files.

## Problem

Jordan: the replay's 3D HUD reads "washed out, like white". Every HUD ink is a CSS token in
`web/src/index.css` (lines about 30 to 60): `--replay-hud-weapon #c7ebfa`, `--replay-hud-weapon-mag
#e8f8ff`, `--replay-hud-on-dark #eaf2f5`, and the shield tokens. Their comments say they were
measured from LevelUp screen captures (glyph pixels over a dark floor), and the shield blues were
"set by eye". None is read from the game. A capture measures a glyph's bright core plus bloom, so the
values sit near white. The HUD consumers include `ReplayAth3d`, `WeaponIcon`, and
`web/src/features/match-replay/scene3d/padNavpointMarkers3d.ts` (pad navpoint icons and timers).

## Goal

Replace those tokens with the colors the game's HUD actually uses, decoded from the game's tags,
served by the Go side like the other HUD assets (`internal/weaponicons/hud.go` builds the HUD set into
`data/.../hud/`, read by the view from `/static/weapons-assets/halo_infinite/hud/`), with each value's
source (tag id, offset) in a comment or test.

## Where to look (unverified leads, confirm each)

- HUD globals `uihg`. The repo already reads one navpoint tag (`nvpt 259f5148`) in
  `internal/weaponicons/padnavpoint.go`; its decoded `PowerColor` 0xcb2b3e43 is unexplained.
- `matg 000024a6` references the HUD globals `hsgd 394f1a04` (seen while tracing outline services).
- Community tag layouts: `gh api repos/Z-15/Halo-Infinite-Tag-Editor/contents/Halo-Infinite-Tag-Editor/Tag_Structures/<group>.xml -H "Accept: application/vnd.github.raw"`
  (try `uihg.xml`, `hsgd.xml`, `cuis.xml`, `cusc.xml`, `ccsd.xml` and any color-table group).
- Tag readers to reuse: `internal/weaponicons` (`buildIndex`, `ix.extract`, `parseTagHeader`) and
  `third_party/map-images/himap` (`meilleurTagInfo`, `rootBlockIndex`, `subBlockTarget`, `blockAbs`).
- A way to find who references a tag across every module: `TestZZRefsProbe` style needle search
  (`himodule.Module.Files("")` lists every file in a module, then scan for the 4 GlobalID bytes).

## Done means

The served HUD set carries the decoded colors, the CSS tokens take them (falling back to today's
values only when the set predates them), a gamefiles test pins the decoded values, and the lead
session sees it in the browser before merge. Report which tokens are now game data and which are
still measured.
