import { z } from "zod";

// What the welcome and sign-in screens show: one quotation and where it came from.
export const WelcomeQuote = z.object({
  text: z.string().min(1),
  attribution: z.string().min(1),
  source: z.string(),
  href: z.url(),
  kind: z.enum(["antiquity", "lore"]),
});

export type WelcomeQuote = z.infer<typeof WelcomeQuote>;
