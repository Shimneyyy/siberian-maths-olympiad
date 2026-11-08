import { fromBuffer, type ZipFile } from "yauzl";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
// Only worker/service-selected manifest indices; never a public download API.
export function readVerifiedZipEntry(buffer: Buffer, index: number, expectedHash: string): Promise<Buffer> {
  return new Promise((ok,bad)=>{
    let done=false,stream:Readable|undefined,zipRef:ZipFile|undefined;
    const timer=setTimeout(()=>fail(),10000);
    const fail=()=>{if(done)return;done=true;clearTimeout(timer);stream?.destroy();zipRef?.close();bad(new Error("DIPLOMA_ZIP_ENTRY_REJECTED"));};
    fromBuffer(buffer,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true},(error,zip)=>{
      if(error||!zip)return fail();zipRef=zip;if(done){zip.close();return;}
      let ordinal=0;
      zip.on("error",()=>{zip.close();fail();});zip.on("end",()=>{zip.close();fail();});
      zip.on("entry",async entry=>{
        if(done)return;
        if(++ordinal!==index){zip.readEntry();return;}
        try{
          if(entry.isEncrypted()||entry.uncompressedSize>10*1024*1024)throw new Error();
          stream=await new Promise<Readable>((resolve,reject)=>zip.openReadStream(entry,(e,s)=>e?reject(e):resolve(s)));
          const chunks:Buffer[]=[];let size=0;
          for await(const value of stream){const chunk=Buffer.from(value);size+=chunk.length;if(size>10*1024*1024||done)throw new Error();chunks.push(chunk);}
          const bytes=Buffer.concat(chunks);if(size!==entry.uncompressedSize||createHash("sha256").update(bytes).digest("hex")!==expectedHash)throw new Error();
          if(done){zip.close();return;}done=true;clearTimeout(timer);zip.close();ok(bytes);
        }catch{zip.close();fail();}
      });zip.readEntry();
    });
  });
}
