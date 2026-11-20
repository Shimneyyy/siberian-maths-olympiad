import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { stageOrphanFiles } from "../src/lib/private-files/orphan-staging";
async function main(){const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});try{
 const args=process.argv.slice(2),at=args.indexOf("--min-age-hours");
 if(at<0||args.some((x,i)=>i!==at+1&&!["--min-age-hours","--apply","--confirmed-quiesced"].includes(x)))throw new Error("Invalid arguments");
 console.log(JSON.stringify(await stageOrphanFiles(db,{directory:process.env.DIPLOMA_DIRECTORY||".local/diplomas",minAgeHours:Number(args[at+1]),apply:args.includes("--apply"),confirmedQuiesced:args.includes("--confirmed-quiesced")})));
 }finally{await db.$disconnect();}}
void main().catch(()=>{console.error("Не удалось проверить файлы. Укажите --min-age-hours, для перемещения остановите app/worker и добавьте --apply --confirmed-quiesced. Проверьте приватные права.");process.exitCode=1;});
