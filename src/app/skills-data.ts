// Design examples only: these are not installed skills or available tool claims.
export const exampleSkills = [
  { name: "Data Analyst", description: "Loads CSVs, runs Python, returns tables and charts with the method shown.", tools: "read_file · run_python", on: true, instructions: "---\nname: data-analyst\ntools: [read_file, run_python]\n---\nWhen given tabular data, inspect columns first.\nState sample sizes. Prefer tables to prose\nfor comparisons. Show the code you ran." },
  { name: "Writer", description: "Drafts and edits long-form text in your voice from past documents.", tools: "read_file · write_file", on: true, instructions: "---\nname: writer\ntools: [read_file, write_file]\n---\nMatch the tone of /files/voice.\nNo filler. Keep paragraphs short." },
  { name: "Researcher", description: "Searches the web, reads sources, and cites them inline.", tools: "web_search · fetch", on: true, instructions: "---\nname: researcher\ntools: [web_search, fetch]\n---\nCite every claim. Prefer primary sources." },
  { name: "Contract Review", description: "Flags unusual clauses against your standard terms.", tools: "read_file", on: false, instructions: "---\nname: contract-review\ntools: [read_file]\n---\nCompare against /files/legal/standard.md." },
  { name: "Meeting Notes", description: "Turns transcripts into decisions, owners and dates.", tools: "read_file · calendar", on: true, instructions: "---\nname: meeting-notes\ntools: [read_file, calendar]\n---\nOutput: Decisions, Owners, Dates." },
  { name: "SQL", description: "Writes and explains queries against the connected warehouse.", tools: "sql_query", on: false, instructions: "---\nname: sql\ntools: [sql_query]\n---\nRead-only. Always LIMIT exploratory queries." },
] as const;

export type ExampleSkill = typeof exampleSkills[number];
