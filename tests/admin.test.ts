import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "../src/lib/pg-adapter";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { manageChief, saveRegistrationWindow, adminView, AdminRateLimit } from "../src/lib/admin";
import { authorizeStaff, AccessDenied } from "../src/lib/access";
import { registrationsOptions } from "../src/lib/registrations";
import { saveEdition } from "../src/lib/olympiad";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
after(() => db.$disconnect());
test("admin global schedule and chief lifecycle require verified email/password; roles and history survive revocation", async () => {
  const password = "Synthetic-admin-password", tag = randomUUID();
  const create = (role: "STUDENT" | "CHIEF_ORGANIZER" | "VENUE_ORGANIZER" | "TECHNICAL_ADMIN") => db.user.create({ data: { name: "Учебный аккаунт", email: `${role.toLowerCase()}-${tag}@example.test`, role, emailVerified: true } });
  const admin = await create("TECHNICAL_ADMIN"), chief = await create("CHIEF_ORGANIZER"), student = await create("STUDENT"), staff = await create("VENUE_ORGANIZER");
  const users = [admin.id, chief.id, student.id, staff.id];
  const e = await db.olympiadEdition.create({ data: { year: 6700, title: "Учебный год" } });
  const other = await db.olympiadEdition.create({ data: { year: 6701, title: "Другой учебный год" } });
  const passwordInput = { password, editionId: e.id }, input = { ...passwordInput, operation: "assign", email: chief.email, name: chief.name };
  const schedule = { ...passwordInput, revision: 0, registrationOpensAt: "2026-11-01T00:00:00Z", registrationClosesAt: "2026-12-01T00:00:00Z" };
  try {
    await db.account.create({ data: { userId: admin.id, accountId: admin.id, providerId: "credential", password: await hashPassword(password) } });
    for (const user of [chief, student, staff]) {
      await assert.rejects(manageChief(db, user.id, input), AccessDenied);
      await assert.rejects(saveRegistrationWindow(db, user.id, schedule), AccessDenied);
    }
    await db.user.update({ where: { id: admin.id }, data: { emailVerified: false } });
    await assert.rejects(manageChief(db, admin.id, input), AccessDenied);
    await db.user.update({ where: { id: admin.id }, data: { emailVerified: true } });
    await assert.rejects(manageChief(db, admin.id, { ...input, password: "wrong" }), AccessDenied);
    await manageChief(db, admin.id, input);
    await authorizeStaff(db, chief.id, "registrations:read", e.id);
    await db.editionStaffGrant.create({ data: { userId: chief.id, editionId: other.id } });
    await saveRegistrationWindow(db, admin.id, schedule);
    await assert.rejects(saveEdition(db, chief.id, { ...schedule, revision: 1, title: e.title, isCurrent: false, registrationManuallyClosed: true, password: undefined }), /./);
    await assert.rejects(saveEdition(db, chief.id, { editionId: e.id, revision: 1, title: e.title, isCurrent: false, registrationOpensAt: schedule.registrationOpensAt, registrationClosesAt: schedule.registrationClosesAt, registrationManuallyClosed: true }));
    await assert.rejects(registrationsOptions(db, admin.id), AccessDenied);
    await assert.rejects(authorizeStaff(db, admin.id, "venues:manage", e.id), AccessDenied);
    assert.equal((await adminView(db, admin.id)).length >= 2, true);
    await manageChief(db, admin.id, { ...input, operation: "revoke" });
    await assert.rejects(authorizeStaff(db, chief.id, "registrations:read", e.id), AccessDenied);
    await authorizeStaff(db, chief.id, "registrations:read", other.id);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: chief.id } })).role, "CHIEF_ORGANIZER");
    await assert.rejects(manageChief(db, admin.id, { ...input, password: "wrong" }), AccessDenied);
    await assert.rejects(manageChief(db, admin.id, input), AdminRateLimit);
    await db.rateLimit.deleteMany({ where: { key: `admin-reauth:${admin.id}` } });
    await assert.rejects(manageChief(db, admin.id, { ...input, email: student.email }), AccessDenied);
    await manageChief(db, admin.id, { ...input, editionId: other.id, email: `replacement-${tag}@example.test`, operation: "replace" });
    const replacement = await db.user.findUniqueOrThrow({ where: { email: `replacement-${tag}@example.test` } }); users.push(replacement.id);
    await assert.rejects(authorizeStaff(db, chief.id, "registrations:read", other.id), AccessDenied);
    await assert.rejects(authorizeStaff(db, replacement.id, "registrations:read", other.id), AccessDenied);
    await db.user.update({ where: { id: replacement.id }, data: { emailVerified: true } });
    await authorizeStaff(db, replacement.id, "registrations:read", other.id);
    await assert.rejects(manageChief(db, admin.id, { ...input, editionId: other.id }), /уже есть главный организатор/);
    await assert.rejects(db.editionStaffGrant.update({ where: { userId_editionId: { userId: chief.id, editionId: other.id } }, data: { revokedAt: null } }));
    assert.equal(await db.editionStaffGrant.count({ where: { editionId: other.id, revokedAt: null } }), 1);
    const audit = await db.auditEvent.findMany({ where: { actorId: admin.id } });
    assert.ok(audit.some(x => x.action === "REGISTRATION_WINDOW_UPDATED"));
    assert.ok(audit.some(x => x.action === "ADMIN_REAUTH_DENIED"));
    assert.ok(!JSON.stringify(audit).includes(password)); assert.ok(!JSON.stringify(audit).includes(chief.email));
  } finally {
    await db.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: users } }, { editionId: { in: [e.id, other.id] } }] } });
    await db.editionStaffGrant.deleteMany({ where: { editionId: { in: [e.id, other.id] } } });
    await db.olympiadEdition.deleteMany({ where: { id: { in: [e.id, other.id] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.rateLimit.deleteMany({ where: { key: `admin-reauth:${admin.id}` } });
  }
});

test("only a verified reauthenticated technical admin creates editions; retries preserve settings, races deduplicate and audit failure rolls back",async()=>{
 const {createAdminEdition}=await import("../src/lib/admin");
 const password=`Synthetic-edition-${randomUUID()}`,users=[] as string[],ids=Array.from({length:4},()=>randomUUID());
 const admin=await db.user.create({data:{email:`${randomUUID()}@example.test`,name:"Учебный администратор",emailVerified:true,role:"TECHNICAL_ADMIN"}});users.push(admin.id);
 const input={id:ids[0],year:6900,title:"Учебный новый выпуск",password,confirmed:true};
 const reset=()=>db.rateLimit.deleteMany({where:{key:`admin-reauth:${admin.id}`}});
 try{
  await db.account.create({data:{userId:admin.id,accountId:admin.id,providerId:"credential",password:await hashPassword(password)}});
  for(const role of ["STUDENT","CHIEF_ORGANIZER","VENUE_ORGANIZER"] as const){const user=await db.user.create({data:{email:`${randomUUID()}@example.test`,name:"Учебный аккаунт",emailVerified:true,role}});users.push(user.id);await assert.rejects(createAdminEdition(db,user.id,input),AccessDenied);}
  await db.user.update({where:{id:admin.id},data:{emailVerified:false}});await assert.rejects(createAdminEdition(db,admin.id,input),AccessDenied);await db.user.update({where:{id:admin.id},data:{emailVerified:true}});
  await assert.rejects(createAdminEdition(db,admin.id,{...input,password:"wrong"}),AccessDenied);
  for(const invalid of [{...input,confirmed:false},{...input,year:0},{...input,year:1.2},{...input,title:" "},{...input,actorId:admin.id}])await assert.rejects(createAdminEdition(db,admin.id,invalid));
  assert.equal(await db.olympiadEdition.count({where:{year:6900}}),0);
  await reset();const edition=await createAdminEdition(db,admin.id,input);
  const before=await db.olympiadEdition.findUniqueOrThrow({where:{id:edition.id}});assert.equal(before.registrationOpensAt,null);assert.equal(before.registrationClosesAt,null);assert.equal(before.isCurrent,false);assert.equal(await db.editionStaffGrant.count({where:{editionId:edition.id}}),0);
  await db.olympiadEdition.update({where:{id:edition.id},data:{title:"Изменено главным после создания",registrationManuallyClosed:true,revision:{increment:1}}});
  await createAdminEdition(db,admin.id,input);const after=await db.olympiadEdition.findUniqueOrThrow({where:{id:edition.id}});assert.equal(after.title,"Изменено главным после создания");assert.equal(after.registrationManuallyClosed,true);assert.equal(after.revision,1);
  await assert.rejects(createAdminEdition(db,admin.id,{...input,title:"Другое содержимое"}));await assert.rejects(createAdminEdition(db,admin.id,{...input,id:randomUUID()}));
  assert.equal(await db.auditEvent.count({where:{actorId:admin.id,action:"EDITION_CREATED",objectId:edition.id}}),1);
  await reset();const race=await Promise.allSettled([createAdminEdition(db,admin.id,{...input,id:ids[1],year:6901}),createAdminEdition(db,admin.id,{...input,id:ids[2],year:6901})]);assert.equal(race.filter(r=>r.status==="fulfilled").length,1);assert.equal(await db.olympiadEdition.count({where:{year:6901}}),1);
  const broken=db.$extends({query:{auditEvent:{async create(){throw new Error("Synthetic audit unavailable");}}}});
  await assert.rejects(createAdminEdition(broken as unknown as PrismaClient,admin.id,{...input,id:ids[3],year:6902}));assert.equal(await db.olympiadEdition.count({where:{year:6902}}),0);
  const audit=JSON.stringify(await db.auditEvent.findMany({where:{actorId:admin.id}}));assert.ok(!audit.includes(password));assert.ok(!audit.includes(input.title));
 }finally{
  await db.auditEvent.deleteMany({where:{OR:[{actorId:{in:users}},{editionId:{in:ids}}]}});await db.olympiadEdition.deleteMany({where:{id:{in:ids}}});await reset();await db.user.deleteMany({where:{id:{in:users}}});
 }
});
