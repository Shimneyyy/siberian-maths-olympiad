import { readFile,stat,mkdir,open,rename,unlink } from "node:fs/promises";
import { dirname,resolve } from "node:path";
import { randomBytes,randomUUID } from "node:crypto";
import { z } from "zod";
import { encryptBox,decryptBox,ExternalSecretError,keyVersionSchema,type KeyProtector } from "./envelope";
export class ExternalKeyConfigurationError extends Error{constructor(readonly code: "KEYRING_UNAVAILABLE" | "WINDOWS_REQUIRES_WSL" = "KEYRING_UNAVAILABLE"){super("Configure the demo external-account keyring; production KMS is not configured");}}
const keySchema=z.string().refine(s=>Buffer.from(s,"base64").length===32&&Buffer.from(s,"base64").toString("base64")===s);
const ringSchema=z.object({activeVersion:keyVersionSchema,keys:z.record(keyVersionSchema,keySchema)}).strict().refine(r=>Object.hasOwn(r.keys,r.activeVersion));
type Ring=z.infer<typeof ringSchema>;
function demo(){if(process.platform==="win32")throw new ExternalKeyConfigurationError("WINDOWS_REQUIRES_WSL");if(process.env.NODE_ENV==="production"||process.env.DEMO_REGISTRATION!=="true")throw new ExternalKeyConfigurationError();}
export class DemoLocalKeyProtector implements KeyProtector{
 #keys:Map<string,Buffer>;readonly activeVersion:string;
 constructor(raw:unknown){demo();const ring=ringSchema.safeParse(raw);if(!ring.success)throw new ExternalKeyConfigurationError();this.activeVersion=ring.data.activeVersion;this.#keys=new Map(Object.entries(ring.data.keys).map(([v,k])=>[v,Buffer.from(k,"base64")]));}
 async wrapKey(key:Buffer,aad:Buffer){demo();const version=this.activeVersion;return {keyVersion:version,wrappedKey:Buffer.from(JSON.stringify(encryptBox(key,this.#keys.get(version)!,Buffer.concat([aad,Buffer.from(`:${version}`)]))))};}
 async unwrapKey(version:string,wrappedKey:Buffer,aad:Buffer){demo();try{const key=this.#keys.get(version);if(!key)throw new ExternalSecretError();return decryptBox(JSON.parse(wrappedKey.toString("utf8")),key,Buffer.concat([aad,Buffer.from(`:${version}`)]));}catch{throw new ExternalSecretError();}}
}
export function demoKeyringPath(){return resolve(process.env.NSUHW_KEYRING_FILE||".local/nsuhw-keyring.json");}
async function readRing(path:string):Promise<Ring>{try{const info=await stat(path);if(!info.isFile()||(info.mode&0o077)!==0||info.size>65536)throw new ExternalKeyConfigurationError();return ringSchema.parse(JSON.parse(await readFile(path,"utf8")));}catch{throw new ExternalKeyConfigurationError();}}
export async function loadDemoKeyProtector(){demo();return new DemoLocalKeyProtector(await readRing(demoKeyringPath()));}
export async function initializeDemoKeyring(){
 demo();const path=demoKeyringPath();await mkdir(dirname(path),{recursive:true,mode:0o700});
 try{const file=await open(path,"wx",0o600);try{await file.writeFile(JSON.stringify({activeVersion:"v1",keys:{v1:randomBytes(32).toString("base64")}}));}finally{await file.close();}return {created:true};}
 catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")throw new ExternalKeyConfigurationError();await readRing(path);return {created:false};}
}
export async function addDemoKeyVersion(version:string){
 demo();if(!keyVersionSchema.safeParse(version).success)throw new ExternalKeyConfigurationError();
 const path=demoKeyringPath(),lock=await open(`${path}.lock`,"wx",0o600),temporary=`${path}.${randomUUID()}.tmp`;
 try{const ring=await readRing(path);if(Object.hasOwn(ring.keys,version))throw new ExternalKeyConfigurationError();ring.keys[version]=randomBytes(32).toString("base64");ring.activeVersion=version;
  const file=await open(temporary,"wx",0o600);try{await file.writeFile(JSON.stringify(ring));}finally{await file.close();}await rename(temporary,path);
 }finally{await lock.close();await unlink(`${path}.lock`);await unlink(temporary).catch(e=>{if((e as NodeJS.ErrnoException).code!=="ENOENT")throw new ExternalKeyConfigurationError();});}
}
