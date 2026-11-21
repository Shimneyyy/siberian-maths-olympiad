import { test } from "node:test";
import assert from "node:assert/strict";
import { authProxyIdentity,UntrustedProxy } from "../src/lib/proxy-identity";
test("proxy identity ignores forwarded headers without explicit proxy configuration",()=>{
 assert.equal(authProxyIdentity(new Headers({"x-forwarded-for":"192.0.2.1","x-smo-client-ip":"192.0.2.2"}),""),undefined);
});
test("proxy identity requires its own secret and a valid address, without trusting forwarded chains",()=>{
 const secret="synthetic-proxy-only-"+"a".repeat(32);
 const cases:Record<string,string>[]=[{},{"x-smo-proxy-key":"forged","x-smo-client-ip":"192.0.2.1"},{"x-smo-proxy-key":secret,"x-smo-client-ip":"192.0.2.1, 192.0.2.2"}];for(const headers of cases)assert.throws(()=>authProxyIdentity(new Headers(headers),secret),UntrustedProxy);
 assert.equal(authProxyIdentity(new Headers({"x-smo-proxy-key":secret,"x-smo-client-ip":"192.0.2.1","x-forwarded-for":"forged"}),secret),"192.0.2.1");
 assert.throws(()=>authProxyIdentity(new Headers(),"short"));
});
