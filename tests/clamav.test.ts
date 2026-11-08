import { test } from "node:test";
import assert from "node:assert/strict";
import { scanWithClamav } from "../src/lib/private-files/clamav";
process.env.DEMO_REGISTRATION="true";
test("E09c real local ClamAV accepts benign bytes and rejects the standard synthetic EICAR test",{timeout:60000},async()=>{
 assert.equal(await scanWithClamav(Buffer.from("Synthetic benign bytes, no personal data")),"CLEAN");
 const eicar=Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
 assert.equal(await scanWithClamav(eicar),"REJECTED");
});
