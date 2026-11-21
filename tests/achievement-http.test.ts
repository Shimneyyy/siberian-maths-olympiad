import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { hashPassword } from "better-auth/crypto";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
async function keyboardLayout(page:Page,label:string){
 await page.locator("details").evaluateAll(items=>items.forEach(e=>(e as HTMLDetailsElement).open=true));
 for(const width of [375,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: overflow at ${width}`);}
 const count=await page.evaluate(()=>{
  const controls=[...document.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,summary,[tabindex]')].filter(e=>e.tabIndex>=0&&e.checkVisibility()&&!!e.getClientRects().length&&!e.matches(":disabled")&&e.getAttribute("type")!=="hidden");
  controls.forEach((e,i)=>e.dataset.keyboardProbe=String(i));controls[0]?.focus();
  for(const e of controls){if(e.matches("input,select,textarea")){const c=e as HTMLInputElement;if(!c.labels?.length&&!e.getAttribute("aria-label")&&!e.getAttribute("aria-labelledby"))throw Error("Control has no accessible label");}}
  return controls.length;
 });
 const seen=new Set<number>();
 for(let i=0;i<count*2+10;i++){
  const value=await page.evaluate(()=>{const e=document.activeElement as HTMLElement|null;return e?.dataset.keyboardProbe;});if(value!==undefined)seen.add(Number(value));
  if(seen.size===count)break;await page.keyboard.press("Tab");
 }
 assert.equal(seen.size,count,`${label}: every enabled visible control is reachable by Tab`);
 await page.evaluate(()=>document.querySelectorAll<HTMLElement>('[data-keyboard-probe]').forEach(e=>delete e.dataset.keyboardProbe));
}
test("chief versions/revocation and team import are visible to fixed recipients; owner corrects login; lost amendment response retries safely",{timeout:300000},async()=>{
 const base=process.env.TEST_BASE_URL!;assert.ok(new URL(process.env.DATABASE_URL!).pathname.startsWith("/smo_test_"));
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||"/usr/bin/chromium",args:["--no-sandbox"]});const errors:string[]=[];
 const post=(ctx:BrowserContext,path:string,data:unknown)=>ctx.request.post(`${base}/api/${path}`,{headers:{Origin:base},data});
 const prove=async(group:Locator)=>{await group.getByLabel("Текущий пароль",{exact:true}).fill(password);await group.getByLabel("Подтверждаю действие с этим результатом",{exact:true}).check();};
 const password=`Synthetic-${randomUUID()}`;
 try{
  const chief=await db.user.create({data:{name:"Учебный главный браузер",email:`${randomUUID()}@example.test`,emailVerified:true,role:"CHIEF_ORGANIZER"}});
  const edition=await db.olympiadEdition.create({data:{year:9800,title:"Учебные достижения",registrationOpensAt:new Date(0),registrationClosesAt:new Date(Date.now()+86400000)}});
  await db.editionStaffGrant.create({data:{userId:chief.id,editionId:edition.id}});
  const uni=await db.university.findFirstOrThrow(),course=await db.courseOption.findFirstOrThrow();const people=[];
  for(let i=0;i<2;i++){const user=await db.user.create({data:{name:`Учебный участник браузер ${i}`,email:`${randomUUID()}@example.test`,emailVerified:true}});const consent=await db.consentRecord.create({data:{userId:user.id,purpose:"synthetic-demo-only",textVersion:"demo",textHash:"a".repeat(64)}});const p=await db.participation.create({data:{userId:user.id,editionId:edition.id,format:"REMOTE",remoteZone:"NSK",fullName:user.name,universityId:uni.id,universityName:uni.name,universityAbbreviation:uni.abbreviation,courseId:course.id,courseLabel:String(i+1),consentId:consent.id}});const login=`Old.${randomUUID()}`;await db.legacyNsuhwClaim.create({data:{userId:user.id,login}});await db.studentProfile.create({data:{userId:user.id,fullName:user.name,universityId:uni.id,courseId:course.id}});people.push({user,p,login});}
  const writer=await browser.newContext(),owner=await browser.newContext(),member=await browser.newContext();
  for(const [ctx,user]of [[writer,chief],[owner,people[0].user],[member,people[1].user]] as const){await db.account.create({data:{userId:user.id,accountId:user.id,providerId:"credential",password:await hashPassword(password)}});assert.equal((await post(ctx,"auth/sign-in/email",{email:user.email,password})).status(),200);}
  const scope={editionId:edition.id},proof={password,confirmed:true},source={...scope,kind:"PRELIMINARY",csv:`Логин,Задача 1,Задача 2,Сумма\n${people[0].login},0,,7`};
  const preview=await(await post(writer,"results/import/preview",source)).json();const id=randomUUID();assert.equal((await post(writer,"results/import/apply",{...source,...proof,id,selectionHash:preview.selectionHash})).status(),200);assert.equal((await post(writer,"results/publish",{...scope,...proof,batchId:id})).status(),200);
  const page=await writer.newPage();page.on("pageerror",e=>errors.push(e.message));await page.goto(`${base}/cabinet/results-import`);
  const doc=await db.resultDocument.findFirstOrThrow({where:{sourceResult:{batchId:id}}});
  await page.getByRole("button",{name:"Показать результаты для исправления",exact:true}).click();await page.getByRole("button",{name:`Управлять результатом ${doc.id.slice(0,8)}`,exact:true}).click();
  const edit=page.getByRole("group",{name:"Новая версия результата",exact:true});await edit.getByLabel("Задача 1",{exact:true}).fill("5");await edit.getByLabel("Сумма баллов",{exact:true}).fill("11");await edit.getByLabel("Причина исправления",{exact:true}).fill("Учебное исправление через интерфейс");
  const attempts:string[]=[];await page.route("**/api/results/amend",async route=>{attempts.push(route.request().postDataJSON().id);if(attempts.length===1){const r=await route.fetch();assert.equal(r.status(),200);await r.dispose();await route.abort("failed");}else await route.continue();});
  await prove(edit);await edit.getByRole("button",{name:"Сохранить новую версию",exact:true}).click();await page.getByRole("status").filter({hasText:"Ответ не получен"}).waitFor();assert.equal(await edit.getByLabel("Сумма баллов",{exact:true}).inputValue(),"11");assert.equal(await edit.getByLabel("Текущий пароль",{exact:true}).inputValue(),"");
  await prove(edit);await edit.getByRole("button",{name:"Сохранить новую версию",exact:true}).click();await page.getByRole("status").filter({hasText:"Новая версия сохранена"}).waitFor();await page.unroute("**/api/results/amend");assert.equal(attempts.length,2);assert.equal(attempts[0],attempts[1]);assert.equal(await db.resultVersion.count({where:{documentId:doc.id}}),2);
  assert.equal((await(await post(owner,"results/search",scope)).json()).rows[0].total,7);
  await db.rateLimit.deleteMany({where:{key:`correction-reauth:${chief.id}`}});
  const publish=page.getByRole("group",{name:"Отдельная публикация версии 2",exact:true});await prove(publish);await publish.getByRole("button",{name:"Опубликовать выбранную версию",exact:true}).click();await page.getByRole("status").filter({hasText:"Публикация изменена"}).waitFor();assert.equal((await(await post(owner,"results/search",scope)).json()).rows[0].total,11);
  const ownerPage=await owner.newPage();ownerPage.on("pageerror",e=>errors.push(e.message));await ownerPage.goto(`${base}/cabinet/nsuhw`);await ownerPage.getByRole("button",{name:"Показать мой аккаунт nsuhw",exact:true}).click();const corrected=`Corrected.${randomUUID()}`;await ownerPage.getByLabel("Исправить старый логин nsuhw",{exact:true}).fill(corrected);await ownerPage.getByRole("button",{name:"Исправить логин",exact:true}).click();await ownerPage.getByRole("status").filter({hasText:"Логин исправлен"}).waitFor();assert.equal((await(await post(owner,"results/search",scope)).json()).rows[0].total,11);
  const revoke=page.getByRole("group",{name:"Отзыв текущей публикации",exact:true});await revoke.getByLabel("Причина отзыва",{exact:true}).fill("Учебный отзыв через интерфейс");await prove(revoke);await revoke.getByRole("button",{name:"Отозвать публикацию результата",exact:true}).click();await page.getByRole("status").filter({hasText:"Публикация изменена"}).waitFor();assert.equal((await(await post(owner,"results/search",scope)).json()).total,0);
  const created=await post(owner,"teams",{...scope,coachName:"Учебный тренер"});assert.equal(created.status(),200);const team=await created.json();await db.teamMember.create({data:{teamId:team.id,participationId:people[1].p.id,editionId:edition.id,universityId:uni.id}});
  await page.goto(`${base}/cabinet/team-results-import`);await page.getByRole("button",{name:"Показать команды для CSV",exact:true}).click();await page.getByRole("table",{name:"Команды, ID и курсы участников",exact:true}).getByText(team.id,{exact:true}).waitFor();
  const teamCsv=`ID команды,Курсы участников,Задача 1,Задача 2,Сумма баллов\n${team.id},"1; 2",4,,12`;
  await page.getByLabel("Файл CSV (до 2 МиБ)",{exact:true}).setInputFiles({name:"synthetic-team.csv",mimeType:"text/csv",buffer:Buffer.from(teamCsv)});await page.getByRole("button",{name:"Предпросмотр результатов",exact:true}).click();await page.getByRole("status").filter({hasText:"Верных строк: 1. Ошибок: 0."}).waitFor();
  const table=page.getByRole("table",{name:"Предпросмотр CSV",exact:true});await table.getByText(`${people[1].user.name} · курс 2`,{exact:true}).waitFor();
  await page.getByLabel("Текущий пароль",{exact:true}).fill(password);await page.getByLabel("Подтверждаю загрузку только верных строк",{exact:false}).check();await page.getByRole("button",{name:"Загрузить верные строки",exact:true}).click();await page.getByRole("status").filter({hasText:"Загружено: 1. Пропущено: 0."}).waitFor();
  const teamDoc=await db.resultDocument.findFirstOrThrow({where:{teamKey:team.id}});await page.getByRole("button",{name:"Показать результаты для исправления",exact:true}).click();await page.getByRole("button",{name:`Управлять результатом ${teamDoc.id.slice(0,8)}`,exact:true}).click();const publishTeam=page.getByRole("group",{name:"Отдельная публикация версии 1",exact:true});await prove(publishTeam);await publishTeam.getByRole("button",{name:"Опубликовать выбранную версию",exact:true}).click();await page.getByRole("status").filter({hasText:"Публикация изменена"}).waitFor();
  const memberPage=await member.newPage();memberPage.on("pageerror",e=>errors.push(e.message));await memberPage.goto(`${base}/cabinet/results`);await memberPage.getByRole("button",{name:"Показать результаты",exact:true}).click();await memberPage.getByText(`${people[1].user.name} · курс 2 · ${uni.name}`,{exact:true}).waitFor();assert.equal((await(await post(member,"results/search",scope)).json()).rows[0].total,12);
  for(const width of [375,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await keyboardLayout(page,"loaded team result/version forms");
  for(const [context,paths]of [[writer,["organization","announcements","mail","nsuhw-export","results-import","team-results-import","catalogs","registrations","results","diplomas"]],[owner,["profile","olympiad","teams","nsuhw","results","history","diplomas"]]] as const){
    const sweep=await context.newPage();sweep.on("pageerror",e=>errors.push(e.message));
    for(const path of paths){await sweep.goto(`${base}/cabinet/${path}`);await keyboardLayout(sweep,path);}
    await sweep.close();
  }
  // The browser tab still renders the first owner, but its shared cookies now belong to the second.
  await ownerPage.goto(`${base}/cabinet/profile`);await ownerPage.getByRole("button",{name:"Сохранить сведения",exact:true}).waitFor();
  assert.equal((await post(owner,"auth/sign-out",{})).status(),200);assert.equal((await post(owner,"auth/sign-in/email",{email:people[1].user.email,password})).status(),200);
  const denied=ownerPage.waitForResponse(r=>new URL(r.url()).pathname==="/api/profile"&&r.request().method()==="PATCH");
  await ownerPage.evaluate(()=>{(document.querySelector('input[name="fullName"]') as HTMLInputElement).value="Учебные данные из старой вкладки";(document.querySelector("form") as HTMLFormElement).requestSubmit();});
  const staleResponse=await denied;assert.equal(staleResponse.status(),409);
  await ownerPage.waitForURL(`${base}/cabinet`);assert.equal((await db.studentProfile.findUniqueOrThrow({where:{userId:people[1].user.id}})).fullName,people[1].user.name);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await db.$disconnect();}
});
