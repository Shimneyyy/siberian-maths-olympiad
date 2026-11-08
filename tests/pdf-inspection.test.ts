import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { inspectPassivePdf, PdfRejected } from "../src/lib/private-files/pdf-inspection";
process.env.DEMO_REGISTRATION="true";
async function fixture(active?:string){const pdf=await PDFDocument.create();pdf.addPage().drawText("Synthetic diploma only");if(active)pdf.catalog.set(PDFName.of(active),pdf.context.obj({S:"JavaScript",JS:PDFString.of("synthetic test")}));return pdf.save();}
test("E09d real PDF parser accepts a synthetic passive PDF and preserves exact hash",async()=>{
 const bytes=await fixture(), result=await inspectPassivePdf(bytes,"application/pdf");
 assert.equal(result.pages,1);assert.equal(result.sha256,createHash("sha256").update(bytes).digest("hex"));
});
test("E09d active actions/forms/attachments and escaped JavaScript names reject",async()=>{
 for(const name of ["OpenAction","AA","AcroForm","XFA","EmbeddedFiles","RichMedia"]){await assert.rejects(inspectPassivePdf(await fixture(name),"application/pdf"),PdfRejected);}
 const pdf=await PDFDocument.create();pdf.addPage();pdf.catalog.set(PDFName.of("Custom"),pdf.context.obj({S:PDFName.of("Java#53cript")}));
 await assert.rejects(inspectPassivePdf(await pdf.save(),"application/pdf"),PdfRejected);
});
test("E09d malformed/truncated/polyglot/wrong MIME/empty or oversized PDF fails closed",async()=>{
 const good=Buffer.from(await fixture());
 for(const bytes of [Buffer.from("%PDF-1.7\nnot a PDF\n%%EOF"),good.subarray(0,good.length-30),Buffer.concat([good,Buffer.from("<script>synthetic</script>")]),Buffer.alloc(0),Buffer.alloc(10*1024*1024+1)]) await assert.rejects(inspectPassivePdf(bytes,"application/pdf"));
 await assert.rejects(inspectPassivePdf(good,"text/html"));
 process.env.DEMO_REGISTRATION="false";try{await assert.rejects(inspectPassivePdf(good,"application/pdf"));}finally{process.env.DEMO_REGISTRATION="true";}
});

test("E09d encryption markers and active indirect objects cannot bypass inspection",async()=>{
 const encrypted=await PDFDocument.create();encrypted.addPage();
 encrypted.context.trailerInfo.Encrypt=encrypted.context.register(encrypted.context.obj({Filter:"Standard",V:1,R:2,Length:40}));
 await assert.rejects(inspectPassivePdf(await encrypted.save(),"application/pdf"),PdfRejected);
 const orphan=await PDFDocument.create();orphan.addPage();orphan.context.register(orphan.context.obj({S:"JavaScript",JS:PDFString.of("synthetic")}));
 await assert.rejects(inspectPassivePdf(await orphan.save(),"application/pdf"),PdfRejected);
});
