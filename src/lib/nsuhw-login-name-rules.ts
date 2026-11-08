import { z } from "zod";
// These are login components, not legal names. Do not transliterate or guess ФИО.
export const latinLoginPart = z.string().trim().min(1).max(80).regex(/^[A-Za-z]+$/, "Используйте буквы A–Z без пробелов и знаков");
export const nsuhwLoginNamesSchema = z.object({firstNameLatin:latinLoginPart,lastNameLatin:latinLoginPart}).strict();
export function nsuhwLoginPreview(raw:unknown) {
  const result=nsuhwLoginNamesSchema.safeParse(raw);
  return result.success?`smc.${result.data.firstNameLatin[0].toLowerCase()}.${result.data.lastNameLatin.toLowerCase()}`:null;
}
