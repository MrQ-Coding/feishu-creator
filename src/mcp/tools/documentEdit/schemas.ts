import { z } from "zod";

export const richTextBlockSchema = z.object({
  type: z.enum(["heading", "text", "ordered", "bullet", "quote", "code"]),
  text: z
    .string()
    .describe("Text content. Non-code blocks support inline code spans with backticks, for example `foo`."),
  headingLevel: z.number().int().min(1).max(9).optional(),
  codeLanguage: z.number().int().min(0).optional(),
  codeWrap: z.boolean().optional(),
});
