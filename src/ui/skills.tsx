import { useState } from "react";
import "./skills.css";

// Design examples only: these are not installed skills or available tool claims.
export const exampleSkills = [
  { name: "Data Analyst", description: "Loads CSVs, runs Python, returns tables and charts with the method shown.", tools: "read_file · run_python", on: true, instructions: "---\nname: data-analyst\ntools: [read_file, run_python]\n---\nWhen given tabular data, inspect columns first.\nState sample sizes. Prefer tables to prose\nfor comparisons. Show the code you ran." },
  { name: "Writer", description: "Drafts and edits long-form text in your voice from past documents.", tools: "read_file · write_file", on: true, instructions: "---\nname: writer\ntools: [read_file, write_file]\n---\nMatch the tone of /files/voice.\nNo filler. Keep paragraphs short." },
  { name: "Researcher", description: "Searches the web, reads sources, and cites them inline.", tools: "web_search · fetch", on: true, instructions: "---\nname: researcher\ntools: [web_search, fetch]\n---\nCite every claim. Prefer primary sources." },
  { name: "Contract Review", description: "Flags unusual clauses against your standard terms.", tools: "read_file", on: false, instructions: "---\nname: contract-review\ntools: [read_file]\n---\nCompare against /files/legal/standard.md." },
  { name: "Meeting Notes", description: "Turns transcripts into decisions, owners and dates.", tools: "read_file · calendar", on: true, instructions: "---\nname: meeting-notes\ntools: [read_file, calendar]\n---\nOutput: Decisions, Owners, Dates." },
  { name: "SQL", description: "Writes and explains queries against the connected warehouse.", tools: "sql_query", on: false, instructions: "---\nname: sql\ntools: [sql_query]\n---\nRead-only. Always LIMIT exploratory queries." },
];

type ExampleSkill = typeof exampleSkills[number];

export function SkillsInspector({ skill }: { skill: ExampleSkill }) {
  const [notice, setNotice] = useState("");

  return <section className="skills-inspector">
    <h2>Selected · example skill</h2>
    <p className="skills-selected-name">{skill.name}</p>
    <pre>{skill.instructions}</pre>
    <div className="skills-actions">
      <button onClick={() => setNotice("Editing is not connected. These example instructions cannot be saved.")}>Edit</button>
      <button onClick={() => setNotice("Duplication is not connected. No skill has been created.")}>Duplicate</button>
    </div>
    {notice && <p role="status">{notice}</p>}
  </section>;
}

export function SkillsPreview({ selected, onSelect }: { selected: ExampleSkill; onSelect: (skill: ExampleSkill) => void }) {
  const [enabled, setEnabled] = useState(() => exampleSkills.map((skill) => skill.on));
  const [notice, setNotice] = useState("");

  return <div className="skills-preview">
    <span className="skills-library-label">Library</span>
    <h1>Skills</h1>
    <p className="skills-intro">Explore example instructions and tools for different tasks.</p>
    <p className="skills-disclosure"><strong>UI-only preview.</strong> These skills and tools are examples, not connected to the assistant. On/Off changes only this preview. Selection and toggles survive tab changes and reset on refresh.</p>
    <table className="skills-table">
      <caption>Example skills</caption>
      <thead><tr><th scope="col">Skill</th><th scope="col">What it does</th><th scope="col">Tools</th><th scope="col">State</th></tr></thead>
      <tbody>{exampleSkills.map((skill, index) => <tr key={skill.name} data-selected={selected.name === skill.name}>
        <th scope="row"><button className="skills-select" aria-pressed={selected.name === skill.name} onClick={() => onSelect(skill)}>{skill.name}</button></th>
        <td>{skill.description}</td>
        <td className="skills-tools">{skill.tools}</td>
        <td><button className="skills-toggle" role="switch" aria-checked={enabled[index]} aria-label={`${skill.name} preview`} onClick={() => setEnabled((current) => current.map((value, position) => position === index ? !value : value))}>{enabled[index] ? "On" : "Off"}</button></td>
      </tr>)}</tbody>
    </table>
    <button className="skills-create" onClick={() => setNotice("Creating skills from a conversation is not connected. No conversation was read and no skill has been created.")}><span>Create A Skill From This Conversation</span><span aria-hidden="true">+</span></button>
    {notice && <p role="status">{notice}</p>}
    <div className="skills-inline-inspector"><SkillsInspector key={selected.name} skill={selected} /></div>
  </div>;
}
