/** @jsxImportSource solid-js */
import { createSignal, For, Show } from "solid-js";
import { exampleSkills, type ExampleSkill } from "./skills-data.js";

// Selection and toggles live above the screen so they survive tab changes, and reset on refresh.
export function createSkills() {
  const [selected, setSelected] = createSignal<ExampleSkill>(exampleSkills[0]);
  const [enabled, setEnabled] = createSignal<readonly boolean[]>(exampleSkills.map((skill) => skill.on));

  const toggle = (index: number) => setEnabled((current) => current.map((value, position) => position === index ? !value : value));

  return { selected, select: setSelected, enabled, toggle };
}

export type Skills = ReturnType<typeof createSkills>;

export function SkillsInspector(props: { skill: ExampleSkill }) {
  const [notice, setNotice] = createSignal("");

  return <section class="skills-inspector">
    <h2>Selected · example skill</h2>
    <p class="skills-selected-name">{props.skill.name}</p>
    <pre>{props.skill.instructions}</pre>
    <div class="skills-actions">
      <button onClick={() => setNotice("Editing is not connected. These example instructions cannot be saved.")}>Edit</button>
      <button onClick={() => setNotice("Duplication is not connected. No skill has been created.")}>Duplicate</button>
    </div>
    <Show when={notice()}><p role="status">{notice()}</p></Show>
  </section>;
}

export function SkillsScreen(props: { skills: Skills }) {
  const [notice, setNotice] = createSignal("");

  return <div class="skills-preview">
    <span class="skills-library-label">Library</span>
    <h1>Skills</h1>
    <p class="skills-intro">Explore example instructions and tools for different tasks.</p>
    <p class="skills-disclosure"><strong>UI-only preview.</strong> These skills and tools are examples, not connected to the assistant. On/Off changes only this preview. Selection and toggles survive tab changes and reset on refresh.</p>
    <table class="skills-table">
      <caption>Example skills</caption>
      <thead><tr><th scope="col">Skill</th><th scope="col">What it does</th><th scope="col">Tools</th><th scope="col">State</th></tr></thead>
      <tbody><For each={exampleSkills}>{(skill, index) => <tr data-selected={props.skills.selected().name === skill.name}>
        <th scope="row"><button class="skills-select" aria-pressed={props.skills.selected().name === skill.name} onClick={() => props.skills.select(skill)}>{skill.name}</button></th>
        <td>{skill.description}</td>
        <td class="skills-tools">{skill.tools}</td>
        <td><button class="skills-toggle" role="switch" aria-checked={props.skills.enabled()[index()]} aria-label={`${skill.name} preview`} onClick={() => props.skills.toggle(index())}>{props.skills.enabled()[index()] ? "On" : "Off"}</button></td>
      </tr>}</For></tbody>
    </table>
    <button class="skills-create" onClick={() => setNotice("Creating skills from a conversation is not connected. No conversation was read and no skill has been created.")}><span>Create A Skill From This Conversation</span><span aria-hidden="true">+</span></button>
    <Show when={notice()}><p role="status">{notice()}</p></Show>
    <div class="skills-inline-inspector"><SkillsInspector skill={props.skills.selected()} /></div>
  </div>;
}
