import { BunServices } from "@effect/platform-bun";
import { Layer } from "effect";
import { Configuration } from "./configuration.js";
import { DatabaseLive } from "./database.js";
import { Installation } from "./installation.js";
import { Identity } from "./identity.js";
import { Workspace } from "./workspace.js";
import { Chat } from "./chat.js";
import { OpenCodeRuntime } from "./opencode-runtime.js";

const WorkspaceLive = Workspace.layer;

const InstallationLive = Installation.layer.pipe(
  Layer.provide(DatabaseLive), Layer.provide(BunServices.layer),
);

export const FoundationLive = Layer.mergeAll(
  Configuration.layer, WorkspaceLive, InstallationLive, OpenCodeRuntime.layer,
);

export const IdentityLive = Identity.layer.pipe(
  Layer.provide(InstallationLive), Layer.provide(DatabaseLive),
);

export const ChatLive = Chat.layer.pipe(Layer.provide(IdentityLive), Layer.provide(FoundationLive), Layer.provide(DatabaseLive));
