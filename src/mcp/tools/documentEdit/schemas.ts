import { z } from "zod";

export const richTextBlockSchema = z.object({
  type: z.enum(["heading", "text", "ordered", "bullet", "quote", "code"]),
  text: z.string(),
  headingLevel: z.number().int().min(1).max(9).optional(),
  codeLanguage: z.number().int().min(0).optional(),
  codeWrap: z.boolean().optional(),
});
