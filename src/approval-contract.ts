import { z } from "zod";

export const approvalKinds = ["edit", "delete", "execute", "search", "fetch"] as const;

const Decision = z.enum(["ask", "allow", "deny"]);

// Complete, strict application preferences. The SDK owns category matching and
// selection of native one-time permission options; Camenae never infers a kind.
export const ApprovalPolicy = z.strictObject({
  kinds: z.strictObject({ edit: Decision, delete: Decision, execute: Decision, search: Decision, fetch: Decision }),
  fallback: z.enum(["ask", "deny"]),
});

export type ApprovalPolicy = z.infer<typeof ApprovalPolicy>;

export const ApprovalSettings = z.object({ saved: ApprovalPolicy, active: ApprovalPolicy.nullable() });

export type ApprovalSettings = z.infer<typeof ApprovalSettings>;
