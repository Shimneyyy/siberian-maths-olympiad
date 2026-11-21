import "dotenv/config";
import { stat,realpath,readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { scannerDatabaseStatus } from "../src/lib/private-files/scanner-health";
import { requireDemoOperator } from "../src/lib/data-lifecycle";
async function main(){
 requireDemoOperator();const checks:{name:string;ok:boolean;code:string}[]=[];
 const check=async(name:string,run:()=>Promise<string>)=>{try{checks.push({name,ok:true,code:await run()});}catch{checks.push({name,ok:false,code:"UNAVAILABLE_OR_UNSAFE"});}};
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
 try{
  await check("runtime",async()=>{if(process.platform!=="linux"||Number(process.versions.node.split(".")[0])!==24)throw Error();return "LINUX_NODE_24";});
  await check("database_migrations",async()=>{const expected=(await readdir("prisma/migrations")).filter(x=>/^\d/.test(x));const rows=await db.$queryRaw<{migration_name:string}[]>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;if(expected.some(name=>!rows.some(r=>r.migration_name===name)))throw Error();return "UP_TO_DATE";});
  await check("private_keyring",async()=>{const path=resolve(process.env.NSUHW_KEYRING_FILE||".local/nsuhw-keyring.json"),info=await stat(path);if(!info.isFile()||(info.mode&0o077)||await realpath(path)!==path)throw Error();return "PRIVATE_FILE_PRESENT";});
  await check("private_pdf_storage",async()=>{const path=resolve(process.env.DIPLOMA_DIRECTORY||".local/diplomas");let info;try{info=await stat(path);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return "NOT_CREATED_YET";throw e;}if(!info.isDirectory()||(info.mode&0o077)||await realpath(path)!==path)throw Error();return "PRIVATE_DIRECTORY";});
  await check("pdf_sandbox_service",async()=>{const r=await fetch("http://127.0.0.1:3320/health",{signal:AbortSignal.timeout(2000)});if(!r.ok||(await r.json()).mode!=="isolated-pdf-v1")throw Error();return "RESPONDING";});
  await check("antivirus_freshness",async()=>{const status=await scannerDatabaseStatus();if(!status.fresh)throw Error();return `WITHIN_${status.maxAgeHours}_HOURS`;});
  await check("smtp",async()=>{const {createTransport}=await import("nodemailer");const transport=createTransport({host:process.env.SMTP_HOST||"127.0.0.1",port:Number(process.env.SMTP_PORT||1025),secure:false,connectionTimeout:2000,greetingTimeout:2000});try{await transport.verify();return "CONNECTION_ONLY_NO_MAIL_SENT";}finally{transport.close();}});
 }finally{await db.$disconnect();}
 const ready=checks.every(c=>c.ok);console.log(JSON.stringify({syntheticOnly:true,ready,checks,productionAccepted:false,externalAcceptanceRequired:["operator_and_legal_basis","providers_and_KMS","HTTPS_and_real_email_delivery","independent_backups_and_scheduler","target_host_restore_drill","actual_WSL_machine"]},null,2));if(!ready)process.exitCode=1;
}
void main().catch(()=>{console.error("OPS_CHECK_FAILED: only an explicitly configured local synthetic environment is supported");process.exitCode=1;});
