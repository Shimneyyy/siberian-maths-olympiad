import { createConnection } from "node:net";
export class ScannerUnavailable extends Error { constructor(){super("FILE_SCANNER_UNAVAILABLE");} }
// No endpoint, path, filename or participant data is accepted from a caller.
export async function scannerDatabaseStatus(port=3310,timeoutMs=2000,maxAgeHours=Number(process.env.CLAMAV_MAX_DATABASE_AGE_HOURS||168),clock=Date.now()) {
 if(process.env.DEMO_REGISTRATION!=="true"||process.env.NODE_ENV==="production"||!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||!Number.isInteger(maxAgeHours)||maxAgeHours<1||maxAgeHours>720)throw new ScannerUnavailable();
 const reply=await new Promise<string>((resolve,reject)=>{
  let done=false,output="";const socket=createConnection({host:"127.0.0.1",port});
  const finish=(value?:string)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();if(value)resolve(value);else reject(new ScannerUnavailable());};
  const timer=setTimeout(()=>finish(),timeoutMs);socket.on("error",()=>finish());socket.on("end",()=>finish());socket.on("close",()=>finish());
  socket.once("connect",()=>socket.write("zVERSION\0"));socket.on("data",chunk=>{output+=chunk.toString("ascii");if(output.length>512)return finish();if(output.includes("\0"))finish(output);});
 });
 const matched=/^ClamAV ([0-9]+\.[0-9]+\.[0-9]+)\/([0-9]+)\/([A-Za-z]{3} [A-Za-z]{3} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\0$/.exec(reply);
 if(!matched)throw new ScannerUnavailable();
 const builtAt=Date.parse(matched[3]+" UTC"),ageHours=(clock-builtAt)/3600000;
 if(!Number.isFinite(builtAt)||ageHours< -1)throw new ScannerUnavailable();
 return {engineVersion:matched[1],databaseVersion:matched[2],builtAt:new Date(builtAt).toISOString(),ageHours:Math.max(0,Math.round(ageHours*100)/100),maxAgeHours,fresh:ageHours<=maxAgeHours};
}
