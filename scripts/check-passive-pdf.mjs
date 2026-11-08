// Untrusted PDF parsing runs in a resource-bounded child, never in Next's process.
import { PDFDocument, PDFDict, PDFArray, PDFRawStream, PDFName, ParseSpeeds } from "pdf-lib";
const blocked = new Set(["JS","JavaScript","OpenAction","AA","AcroForm","XFA","EmbeddedFiles","EmbeddedFile","RichMedia","RichMediaContent","RichMediaSettings","Launch","SubmitForm","ImportData","GoToR","GoToE","URI","Sound","Movie","3D","Rendition"]);
try {
  const chunks=[];let size=0;
  for await(const chunk of process.stdin){size+=chunk.length;if(size>10*1024*1024)throw new Error();chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);
  if(!/^%PDF-[12]\.\d/.test(bytes.subarray(0,8).toString("ascii")) || !/%%EOF[\t\n\f\r ]*$/.test(bytes.subarray(-1024).toString("latin1")))throw new Error();
  const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,throwOnInvalidObject:true,updateMetadata:false,parseSpeed:ParseSpeeds.Fastest});
  if(pdf.isEncrypted||pdf.context.trailerInfo.Encrypt)throw new Error();
  const pages=pdf.getPages().length;if(pages<1||pages>100)throw new Error();
  const seen=new Set();let objects=0;
  function inspect(value,depth=0){
    if(depth>100||++objects>100000)throw new Error();
    if(value instanceof PDFName){const name=value.decodeText().replace(/#([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));if(blocked.has(name)||/[\u0000-\u001f\u007f]/.test(name))throw new Error();return;}
    if(!value||seen.has(value))return;seen.add(value);
    if(value instanceof PDFRawStream)inspect(value.dict,depth+1);
    else if(value instanceof PDFDict){for(const [key,entry] of value.entries()){inspect(key,depth+1);inspect(entry,depth+1);}}
    else if(value instanceof PDFArray){for(let i=0;i<value.size();i++)inspect(value.get(i),depth+1);}
  }
  inspect(pdf.catalog);
  for(const [,object] of pdf.context.enumerateIndirectObjects())inspect(object);
  process.stdout.write(JSON.stringify({valid:true,pages}));
}catch{process.stdout.write('{"valid":false}');process.exitCode=1;}
