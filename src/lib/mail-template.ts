export const MAIL_VARIABLES = ["name", "year", "university", "team", "venue"] as const;
export type MailValues = Record<typeof MAIL_VARIABLES[number], string>;
export class InvalidMailTemplate extends Error {}
const token = /\{\{\s*([A-Za-z_]+)\s*\}\}/g;
export function validateMailTemplate(template: string) {
  const rest = template.replace(token, (_, name: string) => {
    if (!(MAIL_VARIABLES as readonly string[]).includes(name)) throw new InvalidMailTemplate("Unknown template variable");
    return "";
  });
  if (rest.includes("{{") || rest.includes("}}")) throw new InvalidMailTemplate("Malformed template variable");
}
export function renderMailTemplate(template: string, values: MailValues, header = false) {
  validateMailTemplate(template);
  const result = template.replace(token, (_, name: keyof MailValues) => values[name].replace(/[\u0000-\u001f\u007f]/g, " "));
  if (Buffer.byteLength(result, "utf8") > 65536) throw new InvalidMailTemplate("Rendered template too large");
  return header ? result.replace(/[\u0000-\u001f\u007f]/g, " ") : result;
}
