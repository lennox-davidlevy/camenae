/** @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { SkillName, skillTemplate, type Skill } from "../skills-contract.js";
import { EditorHeader, TextEditor } from "./editor.js";
import { enableSkill, listSkills, removeSkill, saveSkill, SkillRequestError } from "./skills-api.js";

const generic = "The request failed. Nothing was changed.";

// The library, the open skill, and its unsaved edit live above the screen so they survive tab changes.
export function createSkills(props: { csrf: () => string | undefined; active: () => boolean }) {
  const [skills, setSkills] = createSignal<readonly Skill[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [selectedName, setSelectedName] = createSignal<string>();
  const [draft, setDraft] = createSignal("");
  const [confirming, setConfirming] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");

  const selected = createMemo(() => skills().find((skill) => skill.name === selectedName()));
  const dirty = createMemo(() => selected() !== undefined && draft() !== selected()?.content);

  const load = async () => {
    try {
      const next = await listSkills();
      setSkills(next);
      setLoaded(true);
      setError("");

      // The editor follows the saved text unless there is an unsaved edit.
      const current = next.find((skill) => skill.name === selectedName());

      if (!current) {
        setSelectedName(undefined);
        setDraft("");
      } else if (!dirty()) setDraft(current.content);
    } catch (failure) {
      setError(failure instanceof SkillRequestError ? failure.message : generic);
    }
  };

  createEffect(on(props.active, (active) => { if (active) void load(); }));

  // An unsaved edit is only dropped when you say so.
  const discardable = () => !dirty() || window.confirm(`Discard unsaved changes to ${selectedName()}?`);

  const select = (name: string) => {
    if (name === selectedName() || !discardable()) return;
    setSelectedName(name);
    setDraft(skills().find((skill) => skill.name === name)?.content ?? "");
    setConfirming(false);
    setNotice("");
  };

  const close = () => {
    if (selectedName() === undefined || !discardable()) return;
    setSelectedName(undefined);
    setDraft("");
    setConfirming(false);
    setNotice("");
  };

  const revert = () => setDraft(selected()?.content ?? "");

  // One write at a time; the list is reloaded from the server afterwards.
  const change = async (work: (csrf: string) => Promise<void>, message: string) => {
    const csrf = props.csrf();

    if (!csrf || busy()) return false;
    setBusy(true);
    setNotice("");

    try {
      await work(csrf);
      await load();
      setNotice(message);

      return true;
    } catch (failure) {
      setError(failure instanceof SkillRequestError ? failure.message : generic);

      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = async (name: string) => {
    if (!SkillName.safeParse(name).success) {
      setError("Use lowercase letters, numbers and single hyphens, for example data-analyst.");

      return false;
    }

    if (skills().some((skill) => skill.name === name)) {
      setError("A skill with that name already exists.");

      return false;
    }

    const made = await change((csrf) => saveSkill(csrf, name, skillTemplate(name)), "Created, and switched off. Edit it, save, then switch it on.");

    if (made) select(name);

    return made;
  };

  const save = () => {
    const name = selectedName();

    return name ? change((csrf) => saveSkill(csrf, name, draft()), "Saved.") : Promise.resolve(false);
  };

  const toggle = (name: string, enabled: boolean) => change((csrf) => enableSkill(csrf, name, enabled),
    enabled ? "Switched on. The assistant sees it from its next turn." : "Switched off. The assistant stops seeing it from its next turn.");

  const remove = async () => {
    const name = selectedName();

    if (!name) return;

    if (!confirming()) {
      setConfirming(true);

      return;
    }

    setConfirming(false);
    await change((csrf) => removeSkill(csrf, name), "Deleted.");
  };

  return { skills, loaded, selected, draft, setDraft, dirty, confirming, busy, error, notice, select, close, revert, create, save, toggle, remove };
}

export type Skills = ReturnType<typeof createSkills>;

// The rail: while browsing, what skills are; with one open, the library beside it.
export function SkillsInspector(props: { skills: Skills }) {
  return <section class="skills-inspector">
    <Show when={props.skills.selected()} fallback={<>
      <h2>Skills</h2>
      <p>Open a skill to read or edit it here. A skill is one SKILL.md file: a short front matter with its name and description, then the instructions.</p>
      <small>The assistant reads the switched-on skills before each turn.</small>
    </>}>
      {(skill) => <>
        <h2>Open skill · {skill().enabled ? "on" : "off"}</h2>
        <p class="skills-selected-name">{skill().name}</p>
        <small>{props.skills.dirty() ? "Unsaved changes. Ctrl+S or Cmd+S saves." : "Ctrl+S or Cmd+S saves."}</small>
        <Show when={props.skills.skills().length > 1}>
          <h2>Library</h2>
          <ul class="editor-siblings"><For each={props.skills.skills()}>{(item) => <li>
            <button aria-current={item.name === skill().name ? "true" : undefined} onClick={() => props.skills.select(item.name)}>
              <span>{item.name}</span><small>{item.enabled ? "on" : "off"}</small></button></li>}</For></ul>
        </Show>
        <small>The front matter's <code>description</code> is what the assistant sees first; keep it to one clear sentence about when to use the skill.</small>
      </>}
    </Show>
  </section>;
}

// An open skill takes the whole column: its state and description, what you can do, and its text.
function OpenSkill(props: { skills: Skills; skill: Skill }) {
  const skills = () => props.skills;

  return <section class="editor-screen" aria-label={`Open skill ${props.skill.name}`}>
    <EditorHeader title={props.skill.name}
      crumbs={<><span class="editor-crumb-label">Skills</span><span><span aria-hidden="true">›</span><button onClick={() => skills().close()}>Library</button></span></>}
      detail={<><span class="editor-state" data-on={props.skill.enabled}>{props.skill.enabled ? "On" : "Off"}</span><span>{props.skill.description}</span></>}
      actions={<>
        <button class="editor-primary" disabled={!skills().dirty() || skills().busy()} onClick={() => void skills().save()}>Save</button>
        <button disabled={!skills().dirty() || skills().busy()} onClick={() => skills().revert()}>Revert</button>
        <span class="editor-gap" />
        <button role="switch" aria-checked={props.skill.enabled} disabled={skills().busy()} onClick={() => void skills().toggle(props.skill.name, !props.skill.enabled)}>
          {props.skill.enabled ? "Switch off" : "Switch on"}</button>
        <button class="editor-danger" disabled={skills().busy()} onClick={() => void skills().remove()}>{skills().confirming() ? "Confirm delete" : "Delete"}</button>
        <button class="editor-close" onClick={() => skills().close()}>Close ×</button>
      </>} />
    <Show when={skills().error()}><p role="alert">{skills().error()}</p></Show>
    <Show when={skills().notice()}><p role="status">{skills().notice()}</p></Show>
    <TextEditor label={`Instructions for ${props.skill.name}`} value={skills().draft()} original={props.skill.content} markdown busy={skills().busy()}
      onInput={skills().setDraft} onSave={() => void skills().save()} />
  </section>;
}

function Library(props: { skills: Skills }) {
  const [name, setName] = createSignal("");

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();

    if (await props.skills.create(name().trim())) setName("");
  };

  return <div class="skills-preview">
    <span class="skills-library-label">Library</span>
    <h1>Skills</h1>
    <p class="skills-intro">Instructions the assistant can follow for a kind of task. Switch a skill on to let it see it.</p>
    <p class="skills-disclosure">Skills are files the assistant reads, and they shape how it works. New skills start switched off; read one before you switch it on. They are stored apart from your workspace files. The assistant reads them before each turn, so a change takes effect on its next turn.</p>
    <Show when={props.skills.loaded()} fallback={<p role="status">Loading skills…</p>}>
      <Show when={props.skills.skills().length > 0} fallback={<p>No skills yet. Create one below.</p>}>
        <table class="skills-table">
          <caption>Your skills</caption>
          <thead><tr><th scope="col">Skill</th><th scope="col">What it does</th><th scope="col">State</th></tr></thead>
          <tbody><For each={props.skills.skills()}>{(skill) => <tr>
            <th scope="row"><button class="skills-select" onClick={() => props.skills.select(skill.name)}>{skill.name}</button></th>
            <td>{skill.description}</td>
            <td><button class="skills-toggle" role="switch" aria-checked={skill.enabled} aria-label={skill.name} disabled={props.skills.busy()}
              onClick={() => void props.skills.toggle(skill.name, !skill.enabled)}>{skill.enabled ? "On" : "Off"}</button></td>
          </tr>}</For></tbody>
        </table>
      </Show>
    </Show>
    <form class="skills-create" onSubmit={(event) => void submit(event)}>
      <label>New skill name <input value={name()} maxLength={64} placeholder="data-analyst" onInput={(event) => setName(event.currentTarget.value)} /></label>
      <button type="submit" disabled={props.skills.busy() || name().trim() === ""}>Create skill</button>
    </form>
    <Show when={props.skills.error()}><p role="alert">{props.skills.error()}</p></Show>
    <Show when={props.skills.notice()}><p role="status">{props.skills.notice()}</p></Show>
  </div>;
}

export function SkillsScreen(props: { skills: Skills }) {
  return <Show when={props.skills.selected()} fallback={<Library skills={props.skills} />}>
    {(skill) => <OpenSkill skills={props.skills} skill={skill()} />}
  </Show>;
}
