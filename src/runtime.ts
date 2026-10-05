import { BunServices } from "@effect/platform-bun";
import { Layer } from "effect";
import { HarnessRuntime } from "./harness-runtime.js";
import { Configuration } from "./configuration.js";
import { DatabaseLive } from "./database.js";
import { Installation } from "./installation.js";
import { Identity } from "./identity.js";
import { Workspace } from "./workspace.js";
import { Chat } from "./chat.js";
import { McpPermissions } from "./mcp-permissions.js";

const WorkspaceLive = Workspace.layer;

const InstallationLive = Installation.layer.pipe(
  Layer.provide(DatabaseLive), Layer.provide(BunServices.layer),
);

const HarnessRuntimeLive = HarnessRuntime.layer.pipe(Layer.provide(WorkspaceLive));

export const FoundationLive = Layer.mergeAll(
  Configuration.layer, WorkspaceLive, InstallationLive, HarnessRuntimeLive,
);

export const IdentityLive = Identity.layer.pipe(
  Layer.provide(InstallationLive), Layer.provide(DatabaseLive),
);

export const ChatLive = Chat.layer.pipe(Layer.provide(McpPermissions.layer), Layer.provide(IdentityLive), Layer.provide(FoundationLive), Layer.provide(DatabaseLive));
