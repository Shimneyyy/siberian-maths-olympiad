import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
export class ExternalSecretError extends Error { constructor(){super("External credential unavailable");} }
export const keyVersionSchema=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const base64=z.string().max(32768).refine(s=>s.length>0&&Buffer.from(s,"base64").toString("base64")===s);
const boxSchema=z.object({iv:base64,ciphertext:base64,tag:base64}).strict();
const envelopeSchema=z.object({format:z.literal(1),keyVersion:keyVersionSchema,wrappedKey:base64,password:boxSchema}).strict();
const contextSchema=z.object({accountId:z.uuid(),userId:z.uuid(),login:z.string().min(1).max(254),credentialVersion:z.int().positive()}).strict();
export type SecretContext=z.infer<typeof contextSchema>;
export type SecretEnvelope=z.infer<typeof envelopeSchema>;
export type Box=z.infer<typeof boxSchema>;
// A real KMS backend must authenticate this context when wrapping/unwrapping DEKs.
export interface KeyProtector {
 readonly activeVersion:string;
 wrapKey(key:Buffer,aad:Buffer):Promise<{keyVersion:string;wrappedKey:Buffer}>;
 unwrapKey(keyVersion:string,wrappedKey:Buffer,aad:Buffer):Promise<Buffer>;
}
function aad(raw:SecretContext,purpose:string){const c=contextSchema.parse(raw);return Buffer.from(JSON.stringify([1,"nsuhw",purpose,c.accountId,c.userId,c.login,c.credentialVersion]));}
export function encryptBox(plaintext:Buffer,key:Buffer,context:Buffer):Box {
 const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);cipher.setAAD(context);
 const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
 return {iv:iv.toString("base64"),ciphertext:ciphertext.toString("base64"),tag:cipher.getAuthTag().toString("base64")};
}
export function decryptBox(raw:unknown,key:Buffer,context:Buffer):Buffer {
 const box=boxSchema.parse(raw),iv=Buffer.from(box.iv,"base64"),tag=Buffer.from(box.tag,"base64");
 if(iv.length!==12||tag.length!==16)throw new ExternalSecretError();
 const cipher=createDecipheriv("aes-256-gcm",key,iv);cipher.setAAD(context);cipher.setAuthTag(tag);
 return Buffer.concat([cipher.update(Buffer.from(box.ciphertext,"base64")),cipher.final()]);
}
export async function sealExternalPassword(password:string,context:SecretContext,protector:KeyProtector):Promise<SecretEnvelope>{
 const key=randomBytes(32);let plaintext:Buffer|undefined;
 try {
  if(typeof password!=="string"||Buffer.byteLength(password)===0||Buffer.byteLength(password)>1024)throw new ExternalSecretError();
  plaintext=Buffer.from(password);const wrapped=await protector.wrapKey(key,aad(context,"dek"));
  return envelopeSchema.parse({format:1,keyVersion:wrapped.keyVersion,wrappedKey:wrapped.wrappedKey.toString("base64"),password:encryptBox(plaintext,key,aad(context,"password"))});
 }catch{throw new ExternalSecretError();}finally{key.fill(0);plaintext?.fill(0);}
}
export async function openExternalPassword(raw:unknown,context:SecretContext,protector:KeyProtector):Promise<string>{
 let key:Buffer|undefined,plaintext:Buffer|undefined;
 try{const e=envelopeSchema.parse(raw);key=await protector.unwrapKey(e.keyVersion,Buffer.from(e.wrappedKey,"base64"),aad(context,"dek"));if(key.length!==32)throw new ExternalSecretError();plaintext=decryptBox(e.password,key,aad(context,"password"));return plaintext.toString("utf8");}
 catch{throw new ExternalSecretError();}finally{key?.fill(0);plaintext?.fill(0);}
}
export async function rewrapExternalPassword(raw:unknown,context:SecretContext,protector:KeyProtector):Promise<SecretEnvelope>{
 let key:Buffer|undefined,check:Buffer|undefined;
 try{const e=envelopeSchema.parse(raw);key=await protector.unwrapKey(e.keyVersion,Buffer.from(e.wrappedKey,"base64"),aad(context,"dek"));if(key.length!==32)throw new ExternalSecretError();check=decryptBox(e.password,key,aad(context,"password"));const wrapped=await protector.wrapKey(key,aad(context,"dek"));return {...e,keyVersion:wrapped.keyVersion,wrappedKey:wrapped.wrappedKey.toString("base64")};}
 catch{throw new ExternalSecretError();}finally{key?.fill(0);check?.fill(0);}
}
