import assert from "node:assert/strict";
import { appLimits, checkDefinition, checkValues, type Definition } from "../src/apps-contract.js";
import { backlog, backlogFields } from "../src/apps-seed.js";

// The application-owned definition check, which runs before a definition is stored and again before it
// is drawn. Synthetic definitions only; no DOM or database.
const seeded = checkDefinition(JSON.stringify(backlog.definition));

assert.ok(seeded.ok, `The seeded backlog must pass: ${seeded.ok ? "" : seeded.problems.join(" ")}`);

const valid = structuredClone(backlog.definition);

const refused = (change: (definition: Definition) => void, expected: RegExp) => {
  const copy = structuredClone(valid);
  change(copy);
  const result = checkDefinition(JSON.stringify(copy));

  assert.equal(result.ok, false, `Accepted: ${expected}`);
  assert.ok(!result.ok && result.problems.some((problem) => expected.test(problem)), `Expected ${expected}, got ${result.ok ? "" : result.problems.join(" | ")}`);
};

const element = (definition: Definition, key: string) => {
  const found = definition.spec.elements[key];
  assert.ok(found);

  return found;
};

// Hostile or careless definitions are refused with a precise reason.
const hostile: [(definition: Definition) => void, RegExp][] = [
  [(definition) => { Object.assign(element(definition, "summary"), { type: "Script" }); }, /summary\.type|elements\.summary\.type/],
  [(definition) => { element(definition, "summary").props = { count: "three" }; }, /summary \(Columns\) has invalid props/],
  [(definition) => { element(definition, "table").props = { ...element(definition, "table").props, columns: "f_title0001" }; }, /table \(Table\) has invalid props/],
  [(definition) => { element(definition, "page").props = { title: "<script>alert(1)</script>" }; }, /page \(Page\) has invalid props/],
  [(definition) => { element(definition, "page").props = { title: "Backlog", onClick: "alert(1)" }; }, /page \(Page\) has invalid props/],
  [(definition) => { Object.assign(element(definition, "page"), { on: { press: { action: "setState" } } }); }, /elements\.page/],
  [(definition) => { Object.assign(element(definition, "games"), { visible: { $state: "/x" } }); }, /elements\.games/],
  [(definition) => { element(definition, "games").children = ["table", "missing"]; }, /missing child missing/],
  [(definition) => { element(definition, "games").children = ["table", "page"]; }, /page appears more than once/],
  [(definition) => { element(definition, "page").children = ["summary", "games"]; }, /add is not reachable/],
  [(definition) => { element(definition, "table").children = ["form"]; }, /table \(Table\) cannot have children/],
  [(definition) => { definition.spec.root = "nowhere"; }, /root element nowhere does not exist/],
  [(definition) => { definition.actions = definition.actions.filter((action) => action.action !== "entry.remove"); }, /needs the entry\.remove action/],
  [(definition) => { element(definition, "table").props = { ...element(definition, "table").props, filters: [backlogFields.hours] }; }, /cannot use number field/],
  [(definition) => { element(definition, "table").props = { ...element(definition, "table").props, muted: { field: backlogFields.status, equals: "Abandoned" } }; }, /not one of its options/],
  [(definition) => { element(definition, "form").props = { ...element(definition, "form").props, fields: [backlogFields.platform] }; }, /must include required field f_title0001/],
  [(definition) => { element(definition, "stat-hours").props = { label: "Hours", collection: "c_games0001", measure: "sum" }; }, /needs a number or rating field/],
  [(definition) => { definition.collections[0]?.fields.push({ id: backlogFields.title, label: "Again", type: "text" }); }, /Field ids must be unique/],
  [(definition) => { element(definition, "summary").props = { count: 3, title: "x".repeat(appLimits.definitionBytes) }; }, /at most 65536 bytes/],
];

for (const [change, expected] of hostile) refused(change, expected);

assert.equal(checkDefinition("{\"collections\": [").ok, false, "Text that is not JSON is refused");

// Values are checked against the field types; null clears, unknown fields are refused.
const games = valid.collections[0];

assert.ok(games);

assert.ok(checkValues(games, { [backlogFields.title]: "Hades", [backlogFields.status]: "Up next", [backlogFields.hours]: 2.5 }, undefined).ok);

const problems = (input: Parameters<typeof checkValues>[1], current?: Parameters<typeof checkValues>[2]) => {
  const result = checkValues(games, input, current);

  return result.ok ? [] : result.problems;
};

const { title, status, hours, started } = backlogFields;

const saved = { [title]: "Hades", [status]: "Up next", [hours]: 2 };

// Each case: changes, the stored entry they apply to (if any), and the problem expected (none when undefined).
const values: [Parameters<typeof checkValues>[1], Parameters<typeof checkValues>[2], RegExp | undefined][] = [
  [{ [status]: "Up next" }, undefined, /^Title is required\.$/],
  [{ [title]: "x", [status]: "Someday" }, undefined, /^Status/],
  [{ [title]: "x", [status]: "Up next", [hours]: -1 }, undefined, /^Hours/],
  [{ [title]: "x", [status]: "Up next", [started]: "2026-02-30" }, undefined, /^Started/],
  [{ [title]: "x", [status]: "Up next", f_unknown01: "x" }, undefined, /f_unknown01/],
  [{ [title]: "bad\u0007bell", [status]: "Up next" }, undefined, /^Title/],
  [{ [title]: null }, saved, /^Title is required\.$/],
  [{ [hours]: null }, saved, undefined],
];

for (const [input, current, expected] of values) {
  const found = problems(input, current);

  assert.ok(expected ? found.some((problem) => expected.test(problem)) : found.length === 0, `Expected ${expected ?? "no problem"}, got ${found.join(" | ")}`);
}

console.log("Apps: definition checks, hostile definitions and value validation passed.");
