# Reference projects

Recorded 2026-10-26 from source reading only (nothing was run), so these are leads, not
verified behaviour. Local clones live outside this repository in
`/home/david/Projects/github/research-camenae/` (`agents`, `cc-switch`, `cindy`,
`bob-workspace`). Cindy is covered in [product direction](PRODUCT.md#competitive-notes).

Licences: `wshobson/agents` and `farion1231/cc-switch` are MIT, Cindy is Apache-2.0, and
`bob-workspace` is the owner's own project. Study and adapt freely. Credit the source
where a design or code is borrowed closely, and re-derive it against this product's
trust model. Each item says where the work belongs under the
[two-repository rule](../AGENTS.md#two-repositories).

## What each project is

- **wshobson/agents** (about 42,000 stars): a library of coding add-ons (94 plugins:
  subagents, skills, commands) written once in Claude Code's format and converted for
  Codex, Cursor, OpenCode, Antigravity, Copilot and Pi.
- **cc-switch** (about 149,000 stars): a Tauri desktop app that configures twelve coding
  tools from one place: providers and models, MCP servers, skills, prompts, a routing
  proxy, session reading and usage.

Neither runs an assistant for the user. Their popularity shows people want one setup
across many harnesses, which supports `camenae-sdk` as the single entry point.

## For the SDK (`camenae-sdk`)

1. **A harness-neutral message format.** cc-switch's session readers for Claude Code,
   Codex, OpenCode, Pi, Gemini and others all produce one shape
   (`cc-switch/src-tauri/src/session_manager/model.rs`, with shared fixtures under
   `tests/fixtures/sessions/`). A message has a role, a turn id, an `injected` flag for
   context files and reminders, metadata (model, tokens including reasoning and cache,
   cost, duration, stop reason) and blocks:
   - text;
   - thinking, with an optional summary, a `redacted` flag for encrypted or signature-only
     reasoning, and a duration;
   - tool call, with a kind (shell, read, search, edit, write, web, MCP, agent, ask,
     todo, other), a short title, an input preview and a diff summary;
   - tool result, with a status (success, error, interrupted, pending, unknown), a
     preview, exit code, duration and images;
   - events (aborted, compaction, model change, thinking level, hook, subagent, error).

   Large content travels as a preview plus a reference fetched on demand. This is the
   strongest starting point found for the unified message contract the SDK must design,
   and it gives reasoning its own block instead of answer text.
2. **A capability table with converters.** `agents/tools/adapters/capabilities.py` lists,
   per harness, support for skills, subagents, commands, hooks and MCP; limits (Codex
   truncates a skill body at 8 KB, its `AGENTS.md` at 32 KiB); built-in tool names
   (`Read` is `read` in OpenCode and `view_file` in Antigravity); and model alias maps.
   The adapters in the same folder rewrite one source per harness and record a warning
   whenever something is dropped or coerced (`resolve_model`). This is the design for
   common skills and instruction conversion. `docs/harnesses.md` there documents the
   degradation rules.
3. **Provider request fixes.** cc-switch's proxy retries after repairing requests that an
   upstream rejects, for example stripping invalid thinking signatures
   (`proxy/thinking_rectifier.rs`, with budget, image and error-mapping siblings). It
   confirms that fixes like Camenae's Haiku beta header and the inline `</think>` belong in
   the provider layer, not in the chat display.

Add item 1 to the SDK session prompt alongside the reasoning, skills-reload and retry
findings.

## For this application

Planned after step 1 of the [first app slice](FIRST-TOOL-SLICE.md).

1. **A conversation reading view.** cc-switch's reader
   (`cc-switch/src/components/sessions/reader/`): `turns.ts` groups each turn into
   question, work steps and final reply; `toolSummary.ts` collapses steps into a one-line
   summary (steps, files changed, failures) with failed steps marked; plus an outline,
   in-session search, diff view and Markdown export. Rebuild in Solid over the SDK's
   message format. It is also where silent provider retries would show.
2. **Thread deletion.** `bob-workspace/web/state.ts` (`deleteSession`): delete here and in
   the harness's store, then open the most recently active remaining thread, or a new one.
3. **A files view for the Skills editor.** `bob-workspace/web/files.tsx`: tree with
   breadcrumbs and search, a changes mode showing each turn's diffs with restore, drag and
   drop, rendered or source Markdown, download, and warnings when a name exists or a file
   changed while being edited. Replaces the Skills text box.
4. **Run detail panels.** `bob-workspace/web/details.tsx` and `run-outline.tsx`: a run
   overview, saved events with filters, and an outline grouping tool calls under plan
   items.
5. **Lesser leads.** cc-switch's single MCP panel with per-harness toggles, its usage page
   (tokens, cache hits, cost by provider and model, quotas), and its rule of editing only
   owned config fields with a backup before the first rewrite. The `gh skill` and
   `npx skills` installers (skills.sh) as a source for installing skills from GitHub.

Not to copy: cc-switch's sponsor-driven reseller presets, and its reuse of subscriptions
outside official clients, which it says may breach vendor terms.
