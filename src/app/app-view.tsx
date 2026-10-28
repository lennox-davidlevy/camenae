/** @jsxImportSource solid-js */
import { createStateStore, JSONUIProvider, Renderer } from "@json-render/solid";
import { createSignal, ErrorBoundary, onMount, Show, type JSX } from "solid-js";
import { definitionProblems, type App, type Entry, type EntryChanges } from "../apps-contract.js";
import { AppRequestError, addEntry, loadApp, removeEntry, updateEntry } from "./apps-api.js";
import { AppContext, entriesPath, type AppOperations } from "./catalog/context.js";
import { registry } from "./catalog/components.js";

const generic = "The request failed. Nothing was changed.";

const message = (failure?: AppRequestError) => failure ? [failure.message, ...failure.problems].join(" ") : generic;

// A part of an app that cannot be shown is replaced with a fixed message; the shell stays usable.
function Unavailable(props: { onBack: () => void; children?: JSX.Element }) {
  return <div class="app-unavailable" role="alert">
    <p>{props.children ?? "This app could not be shown."}</p>
    <button onClick={() => props.onBack()}>Back to Chat</button>
  </div>;
}

export function AppScreen(props: { id: string; csrf: () => string | undefined; onBack: () => void }) {
  const [app, setApp] = createSignal<App>();
  const [refused, setRefused] = createSignal("");
  const store = createStateStore({ entries: [] });

  const entries = (): Entry[] => {
    const value = store.get(entriesPath);

    return Array.isArray(value) ? value : [];
  };

  onMount(async () => {
    try {
      const view = await loadApp(props.id);

      // The application-owned check runs again before anything is drawn.
      if (definitionProblems(view.app.definition).length > 0) return setRefused("This app's design is not valid, so it was not shown.");
      store.set(entriesPath, view.entries);
      setApp(view.app);
    } catch (failure) {
      setRefused(message(failure instanceof AppRequestError ? failure : undefined));
    }
  });

  const write = async (work: (csrf: string) => Promise<void>) => {
    const csrf = props.csrf();

    if (!csrf) return generic;

    try {
      await work(csrf);

      return undefined;
    } catch (failure) {
      return message(failure instanceof AppRequestError ? failure : undefined);
    }
  };

  const operations = (loaded: () => App): AppOperations => ({
    app: loaded,
    allowed: (action, collection) => loaded().definition.actions.some((entry) => entry.action === action && entry.collection === collection),
    add: (collection: string, values: EntryChanges) => write(async (csrf) => {
      const entry = await addEntry(csrf, props.id, collection, values);
      store.set(entriesPath, [...entries(), entry]);
    }),
    update: (id: string, values: EntryChanges) => write(async (csrf) => {
      const entry = await updateEntry(csrf, props.id, id, values);
      store.set(entriesPath, entries().map((current) => current.id === id ? entry : current));
    }),
    remove: (id: string) => write(async (csrf) => {
      await removeEntry(csrf, props.id, id);
      store.set(entriesPath, entries().filter((current) => current.id !== id));
    }),
  });

  return <div class="app-screen">
    <Show when={refused()}><Unavailable onBack={props.onBack}>{refused()}</Unavailable></Show>
    <Show when={app()}>{(loaded) => <ErrorBoundary fallback={<Unavailable onBack={props.onBack} />}>
      <AppContext.Provider value={operations(loaded)}>
        <JSONUIProvider registry={registry} store={store}>
          <Renderer spec={loaded().definition.spec} registry={registry} fallback={() => <Unavailable onBack={props.onBack}>A part of this app could not be shown.</Unavailable>} />
        </JSONUIProvider>
      </AppContext.Provider>
    </ErrorBoundary>}</Show>
  </div>;
}
