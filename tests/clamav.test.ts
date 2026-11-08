import { test } from "node:test";
import assert from "node:assert/strict";
import { scanWithClamav } from "../src/lib/private-files/clamav";
process.env.DEMO_REGISTRATION="true";
test("E09c real local ClamAV accepts benign bytes and rejects the standard synthetic EICAR test",{timeout:60000},async()=>{
 assert.equal(await scanWithClamav(Buffer.from("Synthetic benign bytes, no personal data")),"CLEAN");
 const eicar=Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
 assert.equal(await scanWithClamav(eicar),"REJECTED");
});

test("E09d complete PDF inspection uses the real parser and real ClamAV on identical synthetic bytes",{timeout:60000},async()=>{
 const {PDFDocument}=await import("pdf-lib"),{inspectDiplomaPdf}=await import("../src/lib/private-files/pdf-inspection");
 const pdf=await PDFDocument.create();pdf.addPage().drawText("Synthetic diploma only");
 const result=await inspectDiplomaPdf(await pdf.save(),"application/pdf");assert.equal(result.scan,"CLEAN");assert.equal(result.pages,1);
});
