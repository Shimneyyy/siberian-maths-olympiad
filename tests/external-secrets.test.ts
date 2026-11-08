import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test,before,after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes,randomUUID } from "node:crypto";
import { mkdtemp,readFile,stat,chmod,rm,readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { sealExternalPassword,openExternalPassword,rewrapExternalPassword,type SecretContext } from "../src/lib/external-secrets/envelope";
import { DemoLocalKeyProtector,initializeDemoKeyring,loadDemoKeyProtector,addDemoKeyVersion } from "../src/lib/external-secrets/local-keys";
import { storePreparedExternalAccount,rewrapPreparedExternalAccounts,externalSecretContext,initializeDemoKeyringForDatabase } from "../src/lib/external-secrets/storage";
import { submitLegacyNsuhw } from "../src/lib/legacy-nsuhw";
import { saveNsuhwLoginNames } from "../src/lib/nsuhw-login-names";
process.env.DEMO_REGISTRATION="true";
const roots={v1:randomBytes(32).toString("base64"),v2:randomBytes(32).toString("base64")};
const provider=(version="v1",keys=roots)=>new DemoLocalKeyProtector({activeVersion:version,keys});
const context=():SecretContext=>({accountId:randomUUID(),userId:randomUUID(),login:"smc.s.synthetic",credentialVersion:1});
test("AEAD randomizes ciphertext and binds it to account, owner, login and credential version",async()=>{
 const ctx=context(),password=`Synthetic-external-${randomUUID()}`;
 const first=await sealExternalPassword(password,ctx,provider()),second=await sealExternalPassword(password,ctx,provider());
 assert.notDeepEqual(first,second);assert.equal(await openExternalPassword(first,ctx,provider()),password);
 const serialized=JSON.stringify(first);assert.ok(!serialized.includes(password));assert.ok(!serialized.includes(roots.v1));
 for(const changed of [{...ctx,accountId:randomUUID()},{...ctx,userId:randomUUID()},{...ctx,login:"other"},{...ctx,credentialVersion:2}])await assert.rejects(openExternalPassword(first,changed,provider()),e=>(e as Error).message==="External credential unavailable");
 await assert.rejects(openExternalPassword(first,ctx,provider("v1",{...roots,v1:randomBytes(32).toString("base64")})));
});
test("tampered envelope fields, wrong key version and malformed data fail without reflecting secrets",async()=>{
 const ctx=context(),password=`Synthetic-${randomUUID()}`,source=await sealExternalPassword(password,ctx,provider());
 const flip=(s:string)=>{const b=Buffer.from(s,"base64");b[0]^=1;return b.toString("base64");};
 const edits=[{...source,wrappedKey:flip(source.wrappedKey)},{...source,keyVersion:"missing"},{...source,password:{...source.password,ciphertext:flip(source.password.ciphertext)}},{...source,password:{...source.password,iv:flip(source.password.iv)}},{...source,password:{...source.password,tag:flip(source.password.tag)}},{...source,format:99},{password},null];
 for(const bad of edits)await assert.rejects(openExternalPassword(bad,ctx,provider()),e=>(e as Error).message==="External credential unavailable"&&!String(e).includes(password));
 await assert.rejects(sealExternalPassword("",ctx,provider()));
 await assert.rejects(sealExternalPassword("x".repeat(1025),ctx,provider()));
});
test("key rotation rewraps DEK without changing password/ciphertext and verifies integrity before rewrap",async()=>{
 const ctx=context(),password=`Synthetic-${randomUUID()}`,source=await sealExternalPassword(password,ctx,provider());
 const moved=await rewrapExternalPassword(source,ctx,provider("v2"));
 assert.equal(moved.keyVersion,"v2");assert.deepEqual(moved.password,source.password);assert.notEqual(moved.wrappedKey,source.wrappedKey);
 const onlyV2=new DemoLocalKeyProtector({activeVersion:"v2",keys:{v2:roots.v2}});
 assert.equal(await openExternalPassword(moved,ctx,onlyV2),password);
 await assert.rejects(openExternalPassword(source,ctx,onlyV2));
 await assert.rejects(rewrapExternalPassword({...source,password:{...source.password,tag:Buffer.alloc(16).toString("base64")}},ctx,provider("v2")));
});
test("local key setup preserves existing keys, requires private permissions and refuses production",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"smo-keys-")),oldPath=process.env.NSUHW_KEYRING_FILE;
 process.env.NSUHW_KEYRING_FILE=join(dir,"keys.json");
 try{
  assert.deepEqual(await initializeDemoKeyring(),{created:true});const original=await readFile(process.env.NSUHW_KEYRING_FILE,"utf8");
  assert.deepEqual(await initializeDemoKeyring(),{created:false});assert.equal(await readFile(process.env.NSUHW_KEYRING_FILE,"utf8"),original);
  assert.equal((await stat(process.env.NSUHW_KEYRING_FILE)).mode&0o777,0o600);
  const ctx=context(),before=await sealExternalPassword("Synthetic password",ctx,await loadDemoKeyProtector());
  await addDemoKeyVersion("v2");assert.equal(await openExternalPassword(before,ctx,await loadDemoKeyProtector()),"Synthetic password");
  const saved=await readFile(process.env.NSUHW_KEYRING_FILE,"utf8");await assert.rejects(addDemoKeyVersion("v2"));assert.equal(await readFile(process.env.NSUHW_KEYRING_FILE,"utf8"),saved);
  await chmod(process.env.NSUHW_KEYRING_FILE,0o644);await assert.rejects(loadDemoKeyProtector());await chmod(process.env.NSUHW_KEYRING_FILE,0o600);
  await assert.rejects(promisify(execFile)(process.execPath,["--import","tsx","scripts/nsuhw-keys.ts","init"],{env:{...process.env,NODE_ENV:"production"}}),e=>(e as {code:number}).code===1);
 }finally{if(oldPath===undefined)delete process.env.NSUHW_KEYRING_FILE;else process.env.NSUHW_KEYRING_FILE=oldPath;await rm(dir,{recursive:true,force:true});}
});
const schema=`secrets_${randomUUID().replaceAll("-","")}`,connection=process.env.DATABASE_URL!;
const sql=new Client({connectionString:connection});
const db=new PrismaClient({adapter:new PrismaPg({connectionString:connection,options:`-c search_path=${schema}`},{schema})});
before(async()=>{await sql.connect();await sql.query(`CREATE SCHEMA "${schema}"`);await sql.query(`SET search_path TO "${schema}"`);for(const m of (await readdir("prisma/migrations")).filter(x=>/^\d/.test(x)).sort())await sql.query(await readFile(`prisma/migrations/${m}/migration.sql`,"utf8"));});
after(async()=>{await db.$disconnect();await sql.query('SET search_path TO public');await sql.query(`DROP SCHEMA "${schema}" CASCADE`);await sql.end();});
const student=()=>db.user.create({data:{name:"Учебный владелец секрета",email:`${randomUUID()}@example.test`,emailVerified:true}});
test("storage contains only envelope, rejects legacy/duplicates and freezes login inputs without changing local auth",async()=>{
 const owner=await student(),other=await student(),password=`Synthetic-${randomUUID()}`;
 await db.account.create({data:{accountId:owner.id,userId:owner.id,providerId:"credential",password:"synthetic-local-hash-unchanged"}});
 const before=await db.user.findUniqueOrThrow({where:{id:owner.id},include:{accounts:true}});
 const record=await db.$transaction(tx=>storePreparedExternalAccount(tx,owner.id,"smc.s.one",password,provider()));
 const row=await db.preparedExternalAccount.findUniqueOrThrow({where:{id:record.id}});
 assert.equal(await openExternalPassword(row.secretEnvelope,externalSecretContext(row),provider()),password);
 assert.ok(!JSON.stringify(row).includes(password));assert.ok(!JSON.stringify(await db.auditEvent.findMany()).includes(password));
 await assert.rejects(db.$transaction(tx=>storePreparedExternalAccount(tx,other.id,row.login,password,provider())));
 await assert.rejects(submitLegacyNsuhw(db,owner.id,{login:"legacy.new",confirmed:true}));
 await assert.rejects(saveNsuhwLoginNames(db,owner.id,{firstNameLatin:"Other",lastNameLatin:"Person",revision:0}));
 assert.deepEqual(await db.user.findUniqueOrThrow({where:{id:owner.id},include:{accounts:true}}),before);
 await submitLegacyNsuhw(db,other.id,{login:"legacy.reserved",confirmed:true});
 await assert.rejects(db.$transaction(tx=>storePreparedExternalAccount(tx,other.id,"smc.s.other",password,provider())));
 const third=await student();await assert.rejects(db.$transaction(tx=>storePreparedExternalAccount(tx,third.id,"legacy.reserved",password,provider())));
 assert.equal(await db.outboxJob.count(),0);
});
test("storage rollback and rotation are atomic per account, resumable and do not rotate passwords",async()=>{
 const owner=await student();await assert.rejects(db.$transaction(async tx=>{await storePreparedExternalAccount(tx,owner.id,"smc.s.rollback","Synthetic rollback",provider());throw new Error("Synthetic rollback");}));
 assert.equal(await db.preparedExternalAccount.count({where:{userId:owner.id}}),0);
 const before=await db.preparedExternalAccount.findMany();const passwords=await Promise.all(before.map(r=>openExternalPassword(r.secretEnvelope,externalSecretContext(r),provider())));
 const result=await rewrapPreparedExternalAccounts(db,provider("v2"));assert.equal(result.count,before.length);
 assert.equal((await rewrapPreparedExternalAccounts(db,provider("v2"))).count,0);
 const onlyV2=new DemoLocalKeyProtector({activeVersion:"v2",keys:{v2:roots.v2}});
 for(let i=0;i<before.length;i++){const after=await db.preparedExternalAccount.findUniqueOrThrow({where:{id:before[i].id}});assert.equal(after.credentialVersion,before[i].credentialVersion);assert.equal(after.login,before[i].login);assert.equal(after.revision,before[i].revision+1);assert.equal(await openExternalPassword(after.secretEnvelope,externalSecretContext(after),onlyV2),passwords[i]);}
});
test("unavailable old keys cannot overwrite ciphertext during rotation",async()=>{
 const owner=await student(),account=await db.$transaction(tx=>storePreparedExternalAccount(tx,owner.id,"smc.s.missing","Synthetic missing key",provider()));
 const before=await db.preparedExternalAccount.findUniqueOrThrow({where:{id:account.id}});
 const onlyV2=new DemoLocalKeyProtector({activeVersion:"v2",keys:{v2:roots.v2}});
 await assert.rejects(rewrapPreparedExternalAccounts(db,onlyV2));
 assert.deepEqual(await db.preparedExternalAccount.findUniqueOrThrow({where:{id:account.id}}),before);
});

test("missing keyring cannot be silently replaced while encrypted records exist",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"smo-lost-keys-")),old=process.env.NSUHW_KEYRING_FILE;
 process.env.NSUHW_KEYRING_FILE=join(dir,"missing.json");
 try{assert.ok(await db.preparedExternalAccount.count());await assert.rejects(initializeDemoKeyringForDatabase(db));await assert.rejects(stat(process.env.NSUHW_KEYRING_FILE),e=>(e as NodeJS.ErrnoException).code==="ENOENT");}
 finally{if(old===undefined)delete process.env.NSUHW_KEYRING_FILE;else process.env.NSUHW_KEYRING_FILE=old;await rm(dir,{recursive:true,force:true});}
});
