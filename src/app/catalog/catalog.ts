import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/solid/schema";
import { componentProps } from "../../apps-contract.js";

// The Camenae catalog. Props come from the application contract, which also checks every definition
// before it is stored or drawn. Descriptions are what a model will read when it authors a spec.
export const catalog = defineCatalog(schema, {
  components: {
    Page: { props: componentProps.Page, slots: ["default"], description: "The app's page: a title, an optional one-line description, then its parts." },
    Section: { props: componentProps.Section, slots: ["default"], description: "A titled group of parts." },
    Columns: { props: componentProps.Columns, slots: ["default"], description: "Places its parts side by side in 2 to 4 columns." },
    Table: { props: componentProps.Table, slots: [], description: "Entries of one collection as rows, with optional sort, filters, grouping, inline edits, delete and muted rows." },
    EntryForm: { props: componentProps.EntryForm, slots: [], description: "A form that adds an entry to a collection." },
    Stat: { props: componentProps.Stat, slots: [], description: "A count, sum or average over a collection's entries, optionally only those matching a condition." },
  },
  actions: {},
});
