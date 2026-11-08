import { z } from "zod";
// Preserve the external spelling: no invented transliteration or case conversion.
export const legacyNsuhwLogin = z.string().trim().min(1).max(254).refine(s => !/[\u0000-\u001f\u007f]/.test(s));
