import { createContext, useContext } from "solid-js";
import type { App, EntryAction, EntryChanges } from "../../apps-contract.js";

// What catalog components may do with entries. Every operation is one the definition declares, and the
// application checks it again. A failure resolves to a message; success resolves to undefined.
export interface AppOperations {
  app: () => App;
  allowed: (action: EntryAction, collection: string) => boolean;
  add: (collection: string, values: EntryChanges) => Promise<string | undefined>;
  update: (id: string, values: EntryChanges) => Promise<string | undefined>;
  remove: (id: string) => Promise<string | undefined>;
}

export const AppContext = createContext<AppOperations>();

export function useApp() {
  const operations = useContext(AppContext);

  if (!operations) throw new Error("Catalog components need an app");

  return operations;
}

// Entries live in json-render state at this path, so specs can refer to them later.
export const entriesPath = "/entries";
