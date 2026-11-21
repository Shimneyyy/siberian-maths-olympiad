import { createHash } from "node:crypto";
import { scanWithClamav } from "./clamav";
export class PdfRejected extends Error { constructor() { super("DIPLOMA_PDF_REJECTED"); } }
export class PdfInspectorUnavailable extends Error { constructor() { super("PDF_INSPECTOR_UNAVAILABLE"); } }
export async function inspectPassivePdf(input: Uint8Array, mime: string) {
  if (process.env.DEMO_REGISTRATION !== "true" || process.env.NODE_ENV === "production") throw new PdfInspectorUnavailable();
  if (mime !== "application/pdf" || !input.byteLength || input.byteLength > 10 * 1024 * 1024) throw new PdfRejected();
  const bytes = Buffer.from(input);
  try {
    const response=await fetch("http://127.0.0.1:3320/inspect",{method:"POST",headers:{"Content-Type":"application/pdf"},body:bytes,signal:AbortSignal.timeout(15000),cache:"no-store",redirect:"error"});
    if(!response.body)throw new PdfInspectorUnavailable();
    const reader=response.body.getReader();let output="",size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512){await reader.cancel();throw new PdfInspectorUnavailable();}output+=new TextDecoder().decode(value);}}finally{reader.releaseLock();}
    const result=JSON.parse(output);
    if(response.status===400&&result.valid===false)throw new PdfRejected();
    if(!response.ok||result.valid!==true||!Number.isInteger(result.pages)||result.pages<1||result.pages>100)throw new PdfInspectorUnavailable();
    return {pages:result.pages as number,sha256:createHash("sha256").update(bytes).digest("hex")};
  }catch(error){if(error instanceof PdfRejected)throw error;throw new PdfInspectorUnavailable();}
}
// Both stages operate on the exact same private copy; a CLEAN answer alone cannot
// bypass structural inspection, and caller mutation cannot change the scanned PDF.
export async function inspectDiplomaPdf(input: Uint8Array, mime: string) {
  if (!input.byteLength || input.byteLength > 10 * 1024 * 1024) throw new PdfRejected();
  const bytes = Buffer.from(input);
  const structure = await inspectPassivePdf(bytes, mime);
  if (await scanWithClamav(bytes) !== "CLEAN") throw new PdfRejected();
  return { ...structure, scan: "CLEAN" as const };
}
