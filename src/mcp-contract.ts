import { z } from "zod";

// Fixed deployment catalog, not runtime discovery. Exact server-native names:
// https://github.com/upstash/context7#available-tools
export const context7Tools = ["resolve-library-id", "query-docs"] as const;

export const DisabledTools = z.array(z.enum(context7Tools)).max(context7Tools.length)
  .refine((tools) => new Set(tools).size === tools.length)
  .transform((tools) => tools.sort());

export type DisabledTools = z.infer<typeof DisabledTools>;

export const McpDecision = z.enum(["allow", "ask", "deny"]);

// The model is per server, with exact-name exceptions. Deployment owns the
// catalog; adding a server is not an untrusted settings/API operation.
export const McpServerPolicy = z.strictObject({
  fallback: McpDecision,
  tools: z.record(z.string().min(1).max(200), McpDecision),
});

export const McpPolicies = z.strictObject({ context7: McpServerPolicy }).refine(
  (value) => Object.keys(value.context7.tools).every((name) => context7Tools.some((tool) => tool === name)),
);

export type McpPolicies = z.infer<typeof McpPolicies>;

export const McpAutomaticDecision = z.object({
  decisionId: z.uuid(), serverName: z.string(), toolName: z.string(),
  match: z.enum(["tool", "fallback", "disabled"]), decision: z.enum(["allow", "deny"]),
});

export const McpPermission = z.object({ permissionId: z.uuid(), serverName: z.string(), toolName: z.string() });

export const McpHistory = z.object({
  decisions: z.array(McpAutomaticDecision), pending: z.array(McpPermission),
  incomplete: z.boolean(),
});

export const McpSettings = z.object({
  disabledTools: DisabledTools,
  activeDisabledTools: DisabledTools.nullable(),
  permissions: McpPolicies,
  activePermissions: McpPolicies.nullable(),
});

export type McpSettings = z.infer<typeof McpSettings>;
