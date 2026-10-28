# Handoff: Camenae UI

> **Update (2026-10-24):** this handoff predates the framework decision. The intended
> UI framework is now **SolidJS**, not React, and `assistant-ui` is not planned for the
> rewrite. Read the React/assistant-ui references below as structure and behavior only.
> File paths below describe the original export; the current references are
> `Camenae.dc.html`, `Catalog.dc.html`, and `Login.dc.html` in this directory.
> See [product direction](../../PRODUCT.md) for decision status.

**Canonical file: `source/Camenae.dc.html` / `Camenae-standalone.html`.** `Assistant.dc.html` is a superseded earlier exploration — ignore it except for structure.

## Overview
Desktop UI for a chat assistant built on **assistant-ui** (https://github.com/assistant-ui/assistant-ui), with visible tools, skills, files, tool-approval and model settings. Visual structure was originally inspired by TypeSafe AI's editorial site: sage-grey paper, charcoal ink, flush white label chips, mono micro-labels, huge tight grotesk headlines, crop-mark frames, ruled accordions, comparison tables, dark chart panels.

## About the Design Files
These files are **design references made in HTML**, not production code. Recreate them in the target codebase (originally React + assistant-ui primitives; now SolidJS with application-owned chat components) using its own patterns.

- `Assistant-standalone.html`: open in any browser, offline, fully clickable. Best for visual reference.
- `source/Assistant.dc.html` + `source/support.js`: readable source. All styles are inline; all data and state are in the `class Component` at the bottom. Serve the folder over a local server (`npx serve source`) to run it.

## Fidelity
**High-fidelity.** Colors, type, spacing and interactions are final intent.

## Layout (all screens)
- Root: full viewport column. Top bar 40px, then 3-column grid: `clamp(200px,18vw,248px) | minmax(0,1fr) | clamp(240px,22vw,320px)`. Inspector hides below 1000px viewport width.
- Column dividers: 1px `rgba(46,50,50,.35)`.
- Top bar: chips flush to top edge, no margin. Left: "Assistant" (white chip). Center: Chat / Skills / Files / Settings (white chips, active = black). Right: "MODEL Balanced" chip + black "New Chat".
- Chips: padding 4px 7px, Geist 18px, no radius, no border. Gap 5px.
- Left sidebar: thread groups with a left rule (solid = Today, dashed = Last week). Thread item: title 14px + mono 10px meta. Active thread = black chip fill. Footer: black chips (Docs, Shortcuts, ⌘K) 13px.
- Inspector: mono 10px uppercase section labels (letter-spacing .06em, #4a5352); rows separated by 1px `rgba(46,50,50,.15)`.

## Screens
1. **New chat**: optional teal "punch-card" banner (1px ink border, dark / teal #12a99b / hatched panels, mono 22px digits). Crop-mark frame (9px L corners) holding dark tag chip "New Thread", mono date, H1 112px/0.9 weight 500 letter-spacing -0.055em. Composer: 1px ink border, bg `rgba(255,255,255,.28)`, 17px textarea, mono chips "+ File", "/ Skill", "@ Tool", black "Send ↵". Suggestions: dashed left-rule rows (solid on hover), mono 12px title, 19px boxed arrow.
2. **Chat**: tag + date, H1 64px. Message column max 780px with a 1px solid left rule. User byline italic "You"; assistant byline mono uppercase with tool count + duration. Body 17px/1.45.
   - **Tool call** (maps to assistant-ui tool UI): left rule solid when open, dashed when closed. Header mono 12px `Tool_name · arg · duration`, 19px boxed chevron rotates 180° when open. Body: result table or dark code block.
   - **Result chart**: dark panel #252828, bars teal #12a99b, highlight pink #e8479a, mono axis labels.
   - **Approval** (tool requiring human confirmation): 2px #1f6fe0 outline + 1px ink border. Header "Approval Required · Write_file". Diff preview in dark code block. Actions: black "Allow once", white "Always allow in /reports", white "Deny". Once resolved it collapses to a dashed-rule line with Undo.
   - Composer is sticky at the bottom with a fade to background.
3. **Skills**: tag "Library", H1 96px, intro 17px. Table: name / description / tools (mono) / On-Off chip. Row click selects → inspector shows SKILL.md in a dark code block + Edit/Duplicate.
4. **Files**: breadcrumb mono chips (last = black). Table: Name / Type / Size / Modified / Used in. Selected row bold + light fill → inspector preview + "Ask about this file". Dashed drop zone.
5. **Settings / Models**: comparison table with 3 model columns. The selected column gets a light fill and a black "Default" chip. Tool Permissions: Allow / Ask / Deny segmented chips per tool. Inspector: custom instructions textarea.

## Interactions & State
`screen` ('new'|'chat'|'skills'|'files'|'settings'), `t1/t2` (tool accordions open), `approval` ('pending'|'allowed'|'denied'), `skillOn[]`, `selSkill`, `selFile`, `model`, `perms[]` (0 Allow, 1 Ask, 2 Deny). No animations; state changes are instant. Selected rows use a light fill: `rgba(255,255,255,.3)`.

## Design Tokens (Camenae — these override any values above)
- bg stone `#e6dfd2` · surface `#fbf8f2` · ink `#23201b` · deep ink/panels `#1f1c18` · muted `#6b6255` / `#3b362e` · panel text `#e9e1d3`
- accent Roman red `#b4412c` (hover `#9a3524`) · on-accent `#f8f3ea` · chart secondary green `#5f9b86` · warning gold `#c08a2e` · approval outline `#2c4a9e`
- lines `rgba(35,32,27,.12–.35)`, input fill `rgba(255,252,245,.28)`
- Fonts: **Gloock** (display: H1 112/96/64, H2 44, wordmark), **Geist** (UI/body), **Geist Mono** (labels, tool names, code)
- Masthead: 46px bar, bottom rule; CAMENAE in Gloock 24px tracked .14em; nav as ruled cells numbered I–IV, active = dark fill; red "New Chat" block at right edge.
- New-chat banner: dark arch (coin inverted, screen blend) + red panel with Gloock wordmark over faint coin (multiply, 14%) + drawn column.
- Radius 0 (except arch). No shadows.

## Assets
`assets/camenae-coin.png` — Aegeria coin (black line art, transparent). Fonts via Google Fonts.

## Layout
No images. The banner is pure CSS. Fonts come from Google Fonts.
