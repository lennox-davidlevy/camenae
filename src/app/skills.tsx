/** @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { SkillName, skillTemplate, type Skill } from "../skills-contract.js";
import { enableSkill, listSkills, removeSkill, saveSkill, SkillRequestError } from "./skills-api.js";

const generic = "The request failed. Nothing was changed.";

// The library, the selected skill, and its unsaved edit live above the screen so they survive tab changes.
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

  const select = (name: string) => {
    setSelectedName(name);
    setDraft(skills().find((skill) => skill.name === name)?.content ?? "");
    setConfirming(false);
    setNotice("");
  };

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
    enabled ? "Switched on. The assistant picks it up when its worker next restarts." : "Switched off. The assistant drops it when its worker next restarts.");

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

  return { skills, loaded, selected, draft, setDraft, dirty, confirming, busy, error, notice, select, create, save, toggle, remove };
}

export type Skills = ReturnType<typeof createSkills>;

export function SkillsInspector(props: { skills: Skills }) {
  return <section class="skills-inspector">
    <Show when={props.skills.selected()} fallback={<><h2>Selected skill</h2><p>Select a skill to read or edit it.</p></>}>
      {(skill) => <>
        <h2>Selected · {skill().enabled ? "on" : "off"}</h2>
        <p class="skills-selected-name">{skill().name}</p>
        <textarea class="skills-editor" aria-label={`Instructions for ${skill().name}`} spellcheck={false} value={props.skills.draft()}
          onInput={(event) => props.skills.setDraft(event.currentTarget.value)} />
        <div class="skills-actions">
          <button disabled={!props.skills.dirty() || props.skills.busy()} onClick={() => void props.skills.save()}>Save</button>
          <button disabled={props.skills.busy()} onClick={() => void props.skills.remove()}>{props.skills.confirming() ? "Confirm delete" : "Delete"}</button>
        </div>
      </>}
    </Show>
    <Show when={props.skills.error()}><p role="alert">{props.skills.error()}</p></Show>
    <Show when={props.skills.notice()}><p role="status">{props.skills.notice()}</p></Show>
  </section>;
}

export function SkillsScreen(props: { skills: Skills }) {
  const [name, setName] = createSignal("");

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();

    if (await props.skills.create(name().trim())) setName("");
  };

  return <div class="skills-preview">
    <span class="skills-library-label">Library</span>
    <h1>Skills</h1>
    <p class="skills-intro">Instructions the assistant can follow for a kind of task. Switch a skill on to let it see it.</p>
    <p class="skills-disclosure">Skills are files the assistant reads, and they shape how it works. New skills start switched off; read one before you switch it on. They are stored apart from your workspace files. The assistant reads them when its worker starts, so a change takes effect after the next restart.</p>
    <Show when={props.skills.loaded()} fallback={<p role="status">Loading skills…</p>}>
      <Show when={props.skills.skills().length > 0} fallback={<p>No skills yet. Create one below.</p>}>
        <table class="skills-table">
          <caption>Your skills</caption>
          <thead><tr><th scope="col">Skill</th><th scope="col">What it does</th><th scope="col">State</th></tr></thead>
          <tbody><For each={props.skills.skills()}>{(skill) => <tr data-selected={props.skills.selected()?.name === skill.name}>
            <th scope="row"><button class="skills-select" aria-pressed={props.skills.selected()?.name === skill.name} onClick={() => props.skills.select(skill.name)}>{skill.name}</button></th>
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
    <div class="skills-inline-inspector"><SkillsInspector skills={props.skills} /></div>
  </div>;
}
