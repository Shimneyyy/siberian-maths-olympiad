import { test } from "node:test";
import assert from "node:assert/strict";
import { ZipFile } from "yazl";
import { createHash } from "node:crypto";
import { previewDiplomaZip, type ZipLimits } from "../src/lib/private-files/zip-preview";
const limits: ZipLimits = { archiveBytes: 65536, fileBytes: 8192, entries: 20, expandedBytes: 16384, ratio: 100, timeoutMs: 1000 };
const pdf = Buffer.from("%PDF-1.7\nsynthetic preflight bytes only, not a validated diploma");
async function archive(files: [string, Buffer, number?][]) {
  const zip=new ZipFile();
  for(const [name,bytes,mode] of files) zip.addBuffer(bytes,name,{compress:false,mode});
  const chunks:Buffer[]=[];zip.end();for await(const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);
}
test("E09b ZIP preflight preserves exact login spelling/hash and reports invalid rows without disk extraction",async()=>{
 const bytes=await archive([["smc.i.petrov.pdf",pdf],["Legacy.Mixed.PDF",pdf],["notes.txt",Buffer.from("synthetic")],["invalid.pdf",Buffer.from("not a pdf")]]);
 const rows=await previewDiplomaZip(bytes,limits);
 assert.deepEqual(rows.map(r=>r.error),[null,null,"INVALID_NAME","NOT_PDF"]);
 assert.equal(rows[1].login,"Legacy.Mixed");assert.equal(rows[0].sha256,createHash("sha256").update(pdf).digest("hex"));
});
test("E09b rejects every duplicate login, including a non-PDF duplicate, and blocks nested archives/paths/symlinks",async()=>{
 const rows=await previewDiplomaZip(await archive([["legacy.pdf",pdf],["legacy.PDF",Buffer.from("invalid")],["legacy.pdf",pdf,0o120777],["folder/name.pdf",pdf],["nested.zip",pdf],["link.pdf",pdf,0o120777]]),limits);
 assert.deepEqual(rows.map(r=>r.error),["DUPLICATE","DUPLICATE","DUPLICATE","INVALID_NAME","INVALID_NAME","UNSUPPORTED_ENTRY"]);
 const good=await archive([["safe.pdf",pdf]]);
 for(const bad of ["../x.pdf","C:/a.pdf","bad\\a.pdf"]){
   const source=await archive([["abcdef.pdf",pdf]]), needle=Buffer.from("abcdef.pdf"), name=Buffer.from(bad.padEnd(10,"x").slice(0,10));
   // Mutate both local/central names, never construct an unsafe archive on disk.
   for(let i=source.indexOf(needle);i>=0;i=source.indexOf(needle,i+needle.length))name.copy(source,i);
   await assert.rejects(previewDiplomaZip(source,limits));
 }
 assert.equal((await previewDiplomaZip(good,limits)).length,1);
});
test("E09b corrupt ZIP, CRC mismatch, encrypted entries and bounded expansion/count/size fail closed",async()=>{
 const good=await archive([["safe.pdf",pdf]]);
 await assert.rejects(previewDiplomaZip(Buffer.from("not a zip"),limits));
 await assert.rejects(previewDiplomaZip(good.subarray(0,good.length-10),limits));
 const broken=Buffer.from(good);broken[broken.indexOf(pdf)+10]^=1;await assert.rejects(previewDiplomaZip(broken,limits));
 for(const change of [{archiveBytes:22},{fileBytes:5},{expandedBytes:5},{entries:1}]){
   const source=change.entries?await archive([["a.pdf",pdf],["b.pdf",pdf]]):good;
   await assert.rejects(previewDiplomaZip(source,{...limits,...change}));
 }
 const encrypted=Buffer.from(good);for(let i=0;i<encrypted.length-4;i++)if(encrypted.readUInt32LE(i)===0x02014b50) encrypted.writeUInt16LE(encrypted.readUInt16LE(i+8)|1,i+8);
 await assert.rejects(previewDiplomaZip(encrypted,limits));
 const zip=new ZipFile();zip.addBuffer(Buffer.alloc(8000,65),"bomb.pdf",{compress:true});zip.end();const chunks:Buffer[]=[];for await(const c of zip.outputStream)chunks.push(Buffer.from(c));
 await assert.rejects(previewDiplomaZip(Buffer.concat(chunks),{...limits,ratio:2}));
});
