import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { addDemoKeyVersion,loadDemoKeyProtector } from "../src/lib/external-secrets/local-keys";
import { rewrapPreparedExternalAccounts,initializeDemoKeyringForDatabase } from "../src/lib/external-secrets/storage";
async function main(){
 const operation=process.argv[2];
 if(operation==="init"){
  const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
  try{const result=await initializeDemoKeyringForDatabase(db);console.log(result.created?"Demo keyring created; key values are not displayed.":"Existing demo keyring preserved.");}finally{await db.$disconnect();}return;
 }
 if(operation==="add-version"){await addDemoKeyVersion(process.argv[3]||"");console.log("New active key version added; old keys retained. Run rewrap next.");return;}
 if(operation!=="rewrap")throw new Error("Unknown operation");
 const provider=await loadDemoKeyProtector();
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
 try{const result=await rewrapPreparedExternalAccounts(db,provider);console.log(`Rewrapped records: ${result.count}. No passwords changed or displayed.`);}finally{await db.$disconnect();}
}
main().catch(()=>{console.error("External key operation failed. Check demo mode, keyring permissions/versions and database. No secrets displayed.");process.exitCode=1;});
