import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as realCore from '../functions/core.mjs';
import * as preferenceModule from '../functions/preferences.mjs';
import * as messageModule from '../functions/messages.mjs';
const docs=new Map(),files=new Map(),tasks=[];let transaction=Promise.resolve(),calls=0,billingFailure=false,holdEdits=false,publicCap='12';
const held=[];
const clone=v=>structuredClone(v);
const ref=path=>({path,id:path.split('/').at(-1),get:async()=>snap(path),set:async v=>docs.set(path,clone(v)),update:async v=>{if(!docs.has(path))throw Error('missing');docs.set(path,{...docs.get(path),...clone(v)});},delete:async()=>docs.delete(path)});
const snap=path=>({exists:docs.has(path),id:path.split('/').at(-1),data:()=>clone(docs.get(path))});
const db={doc:ref,collection:path=>({orderBy:()=>({limit:limit=>({get:async()=>({docs:[...docs.keys()].filter(key=>key.startsWith(path+'/')&&!key.slice(path.length+1).includes('/')).map(snap).sort((a,b)=>b.data().createdAt-a.data().createdAt).slice(0,limit)})})})}),runTransaction:fn=>{const task=transaction.then(()=>fn({get:async r=>snap(r.path),set:(r,v)=>docs.set(r.path,clone(v)),update:(r,v)=>docs.set(r.path,{...docs.get(r.path),...clone(v)}),delete:r=>docs.delete(r.path)}));transaction=task.catch(()=>{});return task;}};
const storage={bucket:()=>({file:path=>({save:async value=>files.set(path,Buffer.from(value)),download:async()=>{if(!files.has(path)){const error=Error('Missing file');error.code=404;throw error;}return [files.get(path)];},delete:async()=>files.delete(path)})})};
const publicClient='test.apps.googleusercontent.com';
const core={...realCore,
 verifyGoogle:async(token,nonce)=>{if(!nonce||!['ordinary','admin','other'].includes(token))realCore.fail(401,'Invalid token');return {sub:token,name:token,email:token==='admin'?'vadim.g1003@gmail.com':token+'@example.com'};},
 researchHistory:async({years})=>({place:'Test monument',scene:'Test scene',usage:[],searchCalls:1,researchPasses:1,periods:years.map(year=>({year,status:'limited',description:'Test evidence',visualChanges:'Test changes',evidenceType:'text',evidenceYears:'Nearby',uncertainties:'Approximate',sources:[{url:'https://example.com/source',title:'Verified source'}]}))}),
 edit:async()=>{calls++;if(billingFailure){const error=Error('Billing unavailable');error.providerStatus=429;throw error;}if(holdEdits)return new Promise(resolve=>held.push(()=>resolve({image,usage:{images:1}})));return {image:image,usage:{images:1}};}
};
const modules={
 'firebase-functions/v2/https':{onRequest:(opts,handler)=>handler},
 'firebase-functions/v2/tasks':{onTaskDispatched:(opts,handler)=>{assert.equal(opts.retryConfig.maxAttempts,1);assert.equal(opts.maxInstances,1);return handler;}},
 'firebase-functions/params':{defineSecret:()=>({value:()=> 'sk-test-only-never-network'}),defineString:(name,opts)=>({value:()=>name==='TIMELENS_OPENAI_READY'?'true':name==='TIMELENS_GOOGLE_CLIENT_ID'?publicClient:name==='TIMELENS_ADMIN_EMAIL'?'vadim.g1003@gmail.com':name==='TIMELENS_PUBLIC_DAILY_CAP'?publicCap:opts.default})},
 'firebase-admin/app':{initializeApp:()=>{}},'firebase-admin/firestore':{getFirestore:()=>db},'firebase-admin/storage':{getStorage:()=>storage},'firebase-admin/functions':{getFunctions:()=>({taskQueue:()=>({enqueue:async(data,opts)=>{assert.equal(opts.dispatchDeadlineSeconds,540);tasks.push(clone(data));}})})},'./core.mjs':core,
 './preferences.mjs':preferenceModule,'./messages.mjs':messageModule,'node:crypto':await import('node:crypto')
};
const context=vm.createContext({console,Buffer,Date,JSON,Set,Math,Number,String,Error,Promise,AbortController,setTimeout,clearTimeout,setInterval,clearInterval});
const module=new vm.SourceTextModule(await readFile('functions/index.mjs','utf8'),{context});
await module.link(name=>{const exports=modules[name];if(!exports)throw Error('Unexpected import '+name);const names=Object.keys(exports),m=new vm.SyntheticModule(names,function(){for(const name of names)this.setExport(name,exports[name]);},{context});return m;});await module.evaluate();
const {timelensApi:api,timelensWorker:worker}=module.namespace;
let checkCount=0;const check=(name,fn)=>{fn();console.log('PASS '+name);checkCount++;};
const image='data:image/jpeg;base64,'+(await readFile('public/sample.jpg')).subarray(0,3000).toString('base64');
// A minimal valid PNG, source validation checks dimensions rather than decoding pixels.
const png=Buffer.alloc(120);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(400,16);png.writeUInt32BE(300,20);
const payload={image:'data:image/png;base64,'+png.toString('base64'),years:[1400,1500,1900],location:{latitude:41.89,longitude:12.49,source:'photo'}};
async function call(path,{method='GET',body={},cookie='',origin='https://timelens-511210.web.app',ip='test-ip'}={}){let status=200,result,headers={};const res={set:value=>{Object.assign(headers,value);return res;},setHeader:(key,value)=>headers[key]=value,status:value=>{status=value;return res;},json:value=>{result=value;return res;},send:value=>{result=value;return res;}};await api({path,method,headers:{cookie,origin,'content-type':'application/json'},body,rawBody:Buffer.from(JSON.stringify(body)),ip},res);return {status,result,headers,cookie:headers['Set-Cookie']?.split(';')[0]};}
async function login(token){const nonce=await call('/api/auth/nonce');const result=await call('/api/auth/google',{method:'POST',cookie:nonce.cookie,body:{credential:token}});assert.equal(result.status,200);return result;}
async function drain(){while(tasks.length)await worker({data:tasks.shift()});}
const config=await call('/api/config');check('public config creates a secure guest session without exposing a secret',()=>{assert.equal(docs.size,1);assert.equal(config.result.user,null);assert.equal(config.result.guestMode,true);assert.equal(config.result.requiresLogin,false);assert.equal(config.result.maxDailyTrips,1);assert(config.headers['Set-Cookie'].includes('Secure'));assert(!JSON.stringify(config).includes('sk-test'));});
check('anonymous generation denied',()=>{});assert.equal((await call('/api/generate',{method:'POST',body:payload})).status,401);
assert.equal((await call('/api/generate',{method:'POST',body:payload,origin:'https://evil.example'})).status,403);check('foreign origin denied before billing',()=>assert.equal(calls,0));
const alice=await login('ordinary'),bob=await login('other'),admin=await login('admin');check('verified owner is admin; ordinary profile is not',()=>{assert.equal(alice.result.user.isAdmin,false);assert.equal(admin.result.user.isAdmin,true);assert(admin.headers['Set-Cookie'].includes('Secure'));});
assert.equal((await call('/api/preferences',{method:'POST',body:{preferences:{language:'ru',theme:'dark'}}})).status,401);check('anonymous preference writes denied',()=>{});
assert.equal((await call('/api/preferences',{method:'POST',cookie:alice.cookie,body:{preferences:{language:'ru',theme:'dark',isAdmin:true}}})).status,200);
const aliceConfig=await call('/api/config',{cookie:alice.cookie});check('profile preferences persist without granting an admin role',()=>{assert.equal(aliceConfig.result.preferences.language,'ru');assert.equal(aliceConfig.result.preferences.theme,'dark');assert.equal(aliceConfig.result.user.isAdmin,false);assert.deepEqual(Object.keys(aliceConfig.result.preferences).sort(),['language','theme']);});
assert.equal((await call('/api/preferences',{cookie:bob.cookie})).result.preferences,null);check('language and theme are private to each profile',()=>{});
const aliceAgain=await login('ordinary');check('preferences follow the same Google profile into a new session',()=>{assert.equal(aliceAgain.result.preferences.language,'ru');assert.equal(aliceAgain.result.preferences.theme,'dark');});
assert.equal((await call('/api/preferences',{method:'POST',cookie:alice.cookie,body:{preferences:{language:'xx',theme:'dark'}}})).status,400);check('unsupported language rejected without changing saved preferences',()=>{});
assert.equal((await call('/api/auth/google',{method:'POST',cookie:alice.cookie,body:{credential:'admin'}})).status,401);check('nonce cannot be replayed',()=>{});
assert.equal((await call('/api/generate',{method:'POST',cookie:alice.cookie,body:{...payload,location:null}})).status,400);check('missing GPS rejected before billing',()=>assert.equal(calls,0));
const job=await call('/api/generate',{method:'POST',cookie:alice.cookie,body:payload});assert.equal(job.status,202);
const repeat=await call('/api/generate',{method:'POST',cookie:alice.cookie,body:payload});check('duplicate submission reuses queued job',()=>assert.equal(repeat.result.jobId,job.result.jobId));
const queued=await call('/api/generate',{method:'POST',cookie:bob.cookie,body:payload});check('another visitor is queued rather than rejected while the worker is busy',()=>assert.equal(queued.status,202));
const busy=await call('/api/generate',{method:'POST',cookie:alice.cookie,body:{...payload,regenerationId:realCore.newRecord(payload,{}).id}});check('one visitor cannot flood the queue with simultaneous jobs',()=>assert.equal(busy.status,429));
assert.equal((await call(`/api/jobs/${job.result.jobId}`,{cookie:bob.cookie})).status,404);check('job is private to profile',()=>{});
const task=tasks[0];await drain();const billed=calls;await worker({data:task});check('three edits per journey; duplicate worker execution bills nothing',()=>{assert.equal(billed,6);assert.equal(calls,billed);});
const result=await call(`/api/jobs/${job.result.jobId}`,{cookie:alice.cookie});check('completed record has all three frames',()=>{assert.equal(result.result.status,'done');assert.equal(result.result.record.frames.length,3);});
const history=await call('/api/history',{cookie:alice.cookie});check('history persists in cloud store',()=>assert.equal(history.result.records.length,1));
const recordId=history.result.records[0].id;assert.equal((await call(`/api/history/${recordId}`,{cookie:bob.cookie})).status,404);assert.equal((await call(`/api/media/${recordId}`,{cookie:bob.cookie})).status,404);check('record and thumbnail cannot be read by another profile',()=>{});
const cached=await call('/api/generate',{method:'POST',cookie:alice.cookie,body:payload});check('finished job reused without quota or fees',()=>{assert.equal(cached.result.cached,true);assert.equal(tasks.length,0);});
for(let index=0;index<2;index++){const attempt=await call('/api/generate',{method:'POST',cookie:alice.cookie,body:{...payload,regenerationId:realCore.newRecord(payload,{}).id}});assert.equal(attempt.status,202);await drain();}
assert.equal((await call('/api/generate',{method:'POST',cookie:alice.cookie,body:{...payload,regenerationId:realCore.newRecord(payload,{}).id}})).status,429);check('ordinary daily quota is enforced',()=>{});
const bobSecond=await call('/api/generate',{method:'POST',cookie:bob.cookie,body:{...payload,regenerationId:realCore.newRecord(payload,{}).id}});assert.equal(bobSecond.status,202);await drain();check('one profile hitting its limit does not consume another profile quota',()=>{});
const guest=await call('/api/generate',{method:'POST',cookie:config.cookie,body:payload});assert.equal(guest.status,202);await drain();const guestDone=await call(`/api/jobs/${guest.result.jobId}`,{cookie:config.cookie});check('guest can generate and privately reopen their result without Google',()=>{assert.equal(guestDone.result.status,'done');assert.equal((guestDone.result.record.frames.filter(f=>f.image)).length,3);});
assert.equal((await call(`/api/jobs/${guest.result.jobId}`,{cookie:bob.cookie})).status,404);
const anotherGuest=await call('/api/config');assert.equal((await call('/api/generate',{method:'POST',cookie:anotherGuest.cookie,body:payload})).status,429);check('new cookies cannot bypass the guest network allowance',()=>{});
publicCap='6';const capped=await call('/api/generate',{method:'POST',cookie:bob.cookie,body:{...payload,regenerationId:realCore.newRecord(payload,{}).id}});assert.equal(capped.status,429);check('public cap is enforced separately from per-profile quota',()=>{});
for(let index=0;index<4;index++){const attempt=await call('/api/generate',{method:'POST',cookie:admin.cookie,body:{...payload,regenerationId:realCore.newRecord(payload,{}).id}});assert.equal(attempt.status,202);await drain();}check('admin can generate beyond ordinary quota and public cap',()=>{});

holdEdits=true;const progressive=await call('/api/generate',{method:'POST',cookie:admin.cookie,body:{...payload,regenerationId:realCore.newRecord(payload,{}).id}});
await worker({data:tasks.shift()});const early=await call(`/api/jobs/${progressive.result.jobId}`,{cookie:admin.cookie});
check('sources are readable immediately after research before any image finishes',()=>{assert.equal(early.result.status,'working');assert(early.result.record.frames.every(frame=>frame.sources.length&&frame.status==='pending'));});
const imageTask=tasks.shift(),working=worker({data:imageTask});
for(let i=0;i<30&&held.length<3;i++)await new Promise(resolve=>setTimeout(resolve,2));
check('three image requests run in parallel',()=>assert.equal(held.length,3));
held[1]();await new Promise(resolve=>setTimeout(resolve,10));const partial=await call(`/api/jobs/${progressive.result.jobId}`,{cookie:admin.cookie});
check('a completed image is visible while other eras are still pending',()=>{assert(partial.result.record.frames[1].image);assert.equal(partial.result.record.frames[0].status,'pending');assert.equal(partial.result.status,'working');});
held[0]();held[2]();await working;await worker({data:imageTask});holdEdits=false;check('parallel output completes once and clears private working files',()=>{assert.equal(docs.get('jobs/'+progressive.result.jobId).status,'done');assert(![...files.keys()].some(path=>path.includes('/jobs/'+progressive.result.jobId+'/')));});
const cancelled=await call('/api/generate',{method:'POST',cookie:admin.cookie,body:{...payload,regenerationId:realCore.newRecord(payload,{}).id}});await call(`/api/jobs/${cancelled.result.jobId}/cancel`,{method:'POST',cookie:admin.cookie});const before=calls;await drain();check('queued cancellation prevents paid calls',()=>assert.equal(calls,before));
billingFailure=true;const failed=await call('/api/generate',{method:'POST',cookie:admin.cookie,body:{...payload,regenerationId:realCore.newRecord(payload,{}).id}});await drain();check('parallel image failures are never retried',()=>{assert.equal(calls,before+3);assert.equal(docs.get('jobs/'+failed.result.jobId).status,'error');});
await call('/api/auth/logout',{method:'POST',cookie:alice.cookie});check('logout revokes server session',()=>{});assert.equal((await call('/api/history',{cookie:alice.cookie})).status,401);
console.log(`${checkCount} cloud checks passed; no real provider requests.`);
