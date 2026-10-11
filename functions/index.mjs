import { onRequest } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { defineSecret, defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getFunctions } from 'firebase-admin/functions';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { validPreferences } from './preferences.mjs';
import { translate } from './messages.mjs';
import { configure, fail, validatePayload, validateImage, dimensions, verifyGoogle, researchHistory, RESEARCH_VERSION, newRecord, openai, edit, imageModel, researchModel } from './core.mjs';

initializeApp();
const db=getFirestore();
const key=defineSecret('TIMELENS_OPENAI_KEY');
const client=defineString('TIMELENS_GOOGLE_CLIENT_ID',{default:'91532542806-edevjd06j3b6m9vqvmvbgbgjo3hm94oh.apps.googleusercontent.com'});
const ready=defineString('TIMELENS_OPENAI_READY',{default:'false'});
const bucketName=defineString('TIMELENS_BUCKET',{default:'timelens-511210.firebasestorage.app'});
const adminEmail=defineString('TIMELENS_ADMIN_EMAIL',{default:''});
const capacity=defineString('TIMELENS_PUBLIC_DAILY_CAP',{default:'12'});
const REGION='us-central1',TTL=7*86400000;
const ORIGINS=new Set(['https://timelens-511210.web.app','https://timelens-511210.firebaseapp.com']);
const hash=value=>createHash('sha256').update(value).digest('hex');
const queue=()=>getFunctions().taskQueue(`locations/${REGION}/functions/timelensWorker`);
const bucket=()=>getStorage().bucket(bucketName.value());
const clean=value=>JSON.parse(JSON.stringify(value));
const json=(res,status,value)=>res.status(status).json(clean(value));
const owner=s=>s.user?hash(`google:${s.user.sub}`):s.guestId;
const admin=s=>!!s.user&&!!adminEmail.value()&&s.user.email.toLowerCase()===adminEmail.value().toLowerCase();
const quota=s=>admin(s)?null:s.user?3:1;
const publicCap=()=>Math.max(1,Math.min(100,Number(capacity.value())||12));
const user=s=>s?.user?{name:s.user.name,email:s.user.email,isAdmin:admin(s)}:null;
async function preferences(s){if(!s?.user)return null;return validPreferences((await db.doc(`profiles/${owner(s)}`).get()).data()?.preferences);}
function sid(req){const match=String(req.headers.cookie||'').match(/(?:^|;\s*)__session=([a-f0-9]{64})(?:;|$)/);return match?.[1]||null;}
function cookie(res,id){res.setHeader('Set-Cookie',`__session=${id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TTL/1000}`);}
async function session(req){const id=sid(req);if(!id)return null;const ref=db.doc(`sessions/${hash(id)}`),snap=await ref.get();if(!snap.exists||snap.data().expires<Date.now())return null;return {...snap.data(),ref};}
async function newSession(res,value={}){const id=randomBytes(32).toString('hex'),ref=db.doc(`sessions/${hash(id)}`),s={user:null,guestId:hash(`guest:${id}`),nonce:null,expires:Date.now()+TTL,...value};await ref.set(s);cookie(res,id);return {...s,ref};}
function requireUser(s){if(!s?.user)fail(401,'Войдите через Google перед генерацией.');}
async function put(path,value){await bucket().file(path).save(JSON.stringify(clean(value)),{resumable:false,contentType:'application/json',metadata:{cacheControl:'private, no-store'}});}
async function get(path){const [bytes]=await bucket().file(path).download();return JSON.parse(bytes.toString('utf8'));}
function recordPath(who,id){return `private/${who}/records/${id}.json`;}
function jobPath(who,id,stage){return `private/${who}/jobs/${id}/stage-${stage}.json`;}
function expired(job){return ['working','queued'].includes(job.status)&&Date.now()-job.updatedAt>(job.status==='queued'?86400000:10*60000);}
async function preview(job,id){
 const record=await get(jobPath(job.owner,id,'preview'));
 record.frames=await Promise.all(record.frames.map(async(frame,index)=>{try{return await get(jobPath(job.owner,id,`frame-${index}`));}catch(error){if(error.code!==404)throw error;return frame;}}));
 return record;
}
async function cleanup(who,id){await Promise.allSettled([0,1,2,3,'preview','frame-0','frame-1','frame-2'].map(stage=>bucket().file(jobPath(who,id,stage)).delete({ignoreNotFound:true})));}
async function rate(req){
 const id=hash(String(req.ip||req.headers['x-forwarded-for']||'unknown')+':'+Math.floor(Date.now()/60000)),ref=db.doc(`rate/${id}`);
 await db.runTransaction(async tx=>{const snap=await tx.get(ref),count=snap.data()?.count||0;if(count>=20)fail(429,'Слишком много попыток входа. Попробуйте через минуту.');tx.set(ref,{count:count+1,expires:Date.now()+120000});});
}

export const timelensApi=onRequest({region:REGION,invoker:'public',minInstances:0,maxInstances:2,memory:'512MiB',timeoutSeconds:60,concurrency:20},async(req,res)=>{
 res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'});
 try{
  const path=req.path;
  if(req.method==='POST'){
   if(!ORIGINS.has(req.headers.origin))fail(403,'Недопустимый источник запроса.');
   if(!String(req.headers['content-type']).startsWith('application/json'))fail(415,'Ожидается JSON.');
   if((req.rawBody?.length||0)>8*1024*1024)fail(413,'Фотография слишком большая.');
  }
  if(!path.startsWith('/api/'))fail(404,'Запрос не найден.');
  configure({apiKey:'',googleClientId:client.value()});
  let s=await session(req);
  if(req.method==='GET'&&path==='/api/config'){if(!s)s=await newSession(res);json(res,200,{configured:ready.value()==='true',googleClientId:client.value(),user:user(s),preferences:await preferences(s),imageModel,researchModel,maxDailyTrips:quota(s),requiresLogin:false,guestMode:true,publicDailyCap:publicCap()});return;}
  if(req.method==='GET'&&path==='/api/auth/nonce'){
   await rate(req);const nonce=randomBytes(24).toString('hex');if(s){await s.ref.update({nonce});}else{s=await newSession(res,{nonce});}json(res,200,{nonce});return;
  }
  if(req.method==='POST'&&path==='/api/auth/google'){
   await rate(req);if(!s?.nonce)fail(401,'Откройте профиль и попробуйте снова.');
   const verified=await verifyGoogle(req.body?.credential,s.nonce);
   await db.runTransaction(async tx=>{const fresh=await tx.get(s.ref);if(!fresh.exists||fresh.data().nonce!==s.nonce)fail(401,'Этот вход уже использован.');tx.delete(s.ref);});
   s=await newSession(res,{user:verified});json(res,200,{user:user(s),preferences:await preferences(s)});return;
  }
  if(req.method==='POST'&&path==='/api/auth/logout'){if(s)await s.ref.delete();await newSession(res);json(res,200,{ok:true});return;}
  if(path==='/api/preferences')requireUser(s);
  if(!s)fail(401,'Refresh the page to start a guest session.');const who=owner(s);
  if(req.method==='GET'&&path==='/api/preferences'){json(res,200,{preferences:await preferences(s)});return;}
  if(req.method==='POST'&&path==='/api/preferences'){
   const value=validPreferences(req.body?.preferences);if(!value)fail(400,'Invalid language or theme.');
   await db.doc(`profiles/${who}`).set({preferences:value,updatedAt:Date.now()},{merge:true});json(res,200,{preferences:value});return;
  }
  if(req.method==='POST'&&path==='/api/generate'){
   if(ready.value()!=='true')fail(503,'ИИ ещё не подключён к облачному серверу.');
   const payload=validatePayload(req.body||{}),id=randomUUID(),now=Date.now();
   const fingerprint=hash(`${RESEARCH_VERSION}:${payload.language}:${who}:${payload.image}:${JSON.stringify(payload.location)}:${payload.years.join(',')}:${payload.regenerationId||''}`);
   const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(new Date());
   const jobRef=db.doc(`jobs/${id}`),fpRef=db.doc(`fingerprints/${fingerprint}`),pending=db.doc(`pending/${who}`),usage=db.doc(`usage/${date}-${who}`),total=db.doc(`usage/${date}-public`),ipUsage=db.doc(`usage/${date}-ip-${hash(String(req.ip||'unknown'))}`);
   const existing=await db.runTransaction(async tx=>{
    const [fp,busy,used,globalUsed,ipUsed]=await Promise.all([tx.get(fpRef),tx.get(pending),tx.get(usage),tx.get(total),tx.get(ipUsage)]);
    if(fp.exists){const prev=await tx.get(db.doc(`jobs/${fp.data().id}`));if(prev.exists&&['queued','working','done'].includes(prev.data().status)&&!expired(prev.data()))return prev.id;}
    if(busy.data()?.id){const prior=await tx.get(db.doc(`jobs/${busy.data().id}`));if(prior.exists&&['queued','working'].includes(prior.data().status)&&!expired(prior.data()))fail(429,'You already have a journey in the queue. Open it before starting another.');}
    if(!admin(s)){
     if((used.data()?.count||0)>=quota(s))fail(429,s.user?'Your daily limit is 3 new journeys. Saved examples and your album remain available.':'Your guest limit is 1 new journey per day. Saved examples remain free.');
     if(!s.user&&(ipUsed.data()?.count||0)>=1)fail(429,'The guest allowance for this network has been used today. Saved examples remain free.');
     if((globalUsed.data()?.count||0)>=publicCap())fail(429,'The public daily generation allowance is used up. Please explore the free saved examples.');
     tx.set(usage,{count:(used.data()?.count||0)+1,expires:now+2*86400000});tx.set(total,{count:(globalUsed.data()?.count||0)+1,expires:now+2*86400000});
     if(!s.user)tx.set(ipUsage,{count:(ipUsed.data()?.count||0)+1,expires:now+2*86400000});
    }
    tx.set(jobRef,{owner:who,fingerprint,status:'queued',progress:5,phase:'queued',message:'Waiting in the queue. You can cancel before processing starts.',createdAt:now,updatedAt:now,stage:0,claimedStage:-1,cancelled:false,previewReady:false,imagesReady:0});
    tx.set(fpRef,{id});tx.set(pending,{id});return null;
   });
   if(existing){json(res,200,{jobId:existing,cached:true});return;}
   try{await put(jobPath(who,id,0),{payload});await queue().enqueue({id,stage:0},{id:`${id}-0`,dispatchDeadlineSeconds:540});}
   catch{await finish(id,{status:'error',error:'Не удалось поставить снимок в очередь. Новая платная попытка автоматически не запускается.'});await cleanup(who,id);fail(503,'Очередь недоступна. Попытка автоматически не повторяется.');}
   json(res,202,{jobId:id});return;
  }
  const match=path.match(/^\/api\/jobs\/([a-f0-9-]{36})(\/cancel)?$/);
  if(match){
   const ref=db.doc(`jobs/${match[1]}`),snap=await ref.get();if(!snap.exists||snap.data().owner!==who)fail(404,'Запрос не найден.');let job=snap.data();
   if(req.method==='POST'&&match[2]){
    const queued=await db.runTransaction(async tx=>{
     const fresh=await tx.get(ref),value=fresh.data(),pending=db.doc(`pending/${who}`),busy=await tx.get(pending);
     if(value.status==='queued'){
      tx.update(ref,{status:'cancelled',cancelled:true,error:'Queued journey cancelled before processing.',updatedAt:Date.now(),finishedAt:Date.now()});
      if(busy.data()?.id===snap.id)tx.set(pending,{id:null});return true;
     }
     if(value.status==='working')tx.update(ref,{cancelled:true});return false;
    });
    if(queued)await cleanup(who,snap.id);json(res,200,{ok:true});return;
   }
   if(req.method==='GET'&&!match[2]){
    if(expired(job)){await finish(snap.id,{status:'error',error:'Сервер прервал обработку. Автоматический платный повтор отключён.'});job=(await ref.get()).data();}
    const record=job.status==='done'?await get(recordPath(who,job.recordId)):job.previewReady&&['working','queued'].includes(job.status)?await preview(job,snap.id):null;
    json(res,200,{status:job.status,phase:job.phase,message:job.message,progress:job.progress,error:job.error,...(record?{record}:{})});return;
   }
  }
  if(req.method==='GET'&&path==='/api/history'){
   const records=await db.collection(`profiles/${who}/records`).orderBy('createdAt','desc').limit(100).get();
   json(res,200,{records:records.docs.map(doc=>({...doc.data(),thumbnail:`/api/media/${doc.id}`}))});return;
  }
  const history=path.match(/^\/api\/history\/([a-f0-9-]{36})$/);
  if(req.method==='GET'&&history){const ref=db.doc(`profiles/${who}/records/${history[1]}`);if(!(await ref.get()).exists)fail(404,'Путешествие не найдено.');json(res,200,await get(recordPath(who,history[1])));return;}
  const media=path.match(/^\/api\/media\/([a-f0-9-]{36})$/);
  if(req.method==='GET'&&media){const record=await db.doc(`profiles/${who}/records/${media[1]}`).get();if(!record.exists)fail(404,'Фотография не найдена.');const [bytes]=await bucket().file(`private/${who}/thumbnails/${media[1]}.jpg`).download();const mime=record.data().thumbnailMime;res.set({'Content-Type':['image/jpeg','image/png','image/webp'].includes(mime)?mime:'image/jpeg','Cache-Control':'private, max-age=300'}).status(200).send(bytes);return;}
  fail(404,'Запрос не найден.');
 }catch(error){json(res,error.status||500,{error:translate(error.status?error.message:'Не удалось выполнить запрос. Попробуйте позже.',req.headers['x-timelens-language']==='ru'?'ru':'en')});}
});

async function finish(id,result){
 await db.runTransaction(async tx=>{
  const jobRef=db.doc(`jobs/${id}`),job=await tx.get(jobRef);if(!job.exists||!['working','queued'].includes(job.data().status))return;
  const pending=db.doc(`pending/${job.data().owner}`),busy=await tx.get(pending);
  tx.update(jobRef,{...clean(result),updatedAt:Date.now(),finishedAt:Date.now()});if(busy.data()?.id===id)tx.set(pending,{id:null});
 });
}

export const timelensWorker=onTaskDispatched({region:REGION,secrets:[key],invoker:['91532542806-compute@developer.gserviceaccount.com'],minInstances:0,maxInstances:1,concurrency:1,memory:'1GiB',timeoutSeconds:540,retryConfig:{maxAttempts:1},rateLimits:{maxConcurrentDispatches:1,maxDispatchesPerSecond:1}},async request=>{
 const {id,stage}=request.data||{};
 if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)||!Number.isInteger(stage)||stage<0||stage>3)return;
 const ref=db.doc('jobs/'+id);
 const job=await db.runTransaction(async tx=>{
  const snap=await tx.get(ref);if(!snap.exists)return null;
  const value=snap.data();if(!['queued','working'].includes(value.status)||value.stage!==stage||value.claimedStage===stage)return null;
  tx.update(ref,{claimedStage:stage,status:'working',updatedAt:Date.now()});return value;
 });
 if(!job)return;
 let heartbeat;
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),180000);
 try{
  if(job.cancelled)throw new Error('CANCELLED');
  configure({apiKey:key.value(),googleClientId:client.value()});
  heartbeat=setInterval(async()=>{try{const fresh=await ref.get();if(fresh.data()?.cancelled||fresh.data()?.status!=='working')controller.abort();else await ref.update({updatedAt:Date.now()});}catch{controller.abort();}},10000);
  const input=await get(jobPath(job.owner,id,stage));let {payload,report,record}=input;
  if(stage===0){
   await ref.update({phase:'research',message:'Определяем место и ищем исторические источники',progress:10});
   report=await researchHistory({image:payload.image,location:payload.location,years:payload.years,language:payload.language,request:openai,signal:controller.signal,onProgress:message=>ref.update({message,updatedAt:Date.now()})});
   record=newRecord(payload,report);
   record.frames=report.periods.map(period=>({year:period.year,status:period.status==='unavailable'?'unavailable':'pending',evidenceStatus:period.status,text:period.description,sources:period.sources,evidenceType:period.evidenceType,evidenceYears:period.evidenceYears,uncertainties:period.uncertainties,image:null}));
   await put(jobPath(job.owner,id,'preview'),record);
   await put(jobPath(job.owner,id,1),{payload,report,record});
   const fresh=(await ref.get()).data();if(fresh.cancelled)throw new Error('CANCELLED');
   await ref.update({previewReady:true,stage:1,progress:25,phase:'images',message:'Evidence found. Reconstructing three eras in parallel.',updatedAt:Date.now()});
   await queue().enqueue({id,stage:1},{id:id+'-1',dispatchDeadlineSeconds:540});return;
  }
  const file=validateImage(payload.image),dim=dimensions(file.buffer,file.mime);
  let completed=0,publishing=Promise.resolve();
  // Finish old staged jobs from the first unfinished era; never regenerate a ready frame.
  const start=stage===1?0:stage-1;
  if(record.frames.length<3)record.frames=report.periods.map((period,i)=>record.frames[i]||{year:period.year,status:'pending',image:null});
  const results=await Promise.allSettled(report.periods.map(async(period,index)=>{
   if(index<start||record.frames[index]?.image)return;
   const frame={year:period.year,status:period.status,text:period.description,sources:period.sources,evidenceType:period.evidenceType,evidenceYears:period.evidenceYears,uncertainties:period.uncertainties,image:null};
   if(period.status!=='unavailable'){
    try{
     const output=await edit(payload.image,{...period,scene:report.scene},report.place,dim.height>dim.width,controller.signal);
     frame.image=output.image;record.usage.images[index]=output.usage;
     frame.quality={status:'unreviewed',note:'Compare with the original to check camera alignment. No paid automatic review or retry.'};
    }catch(error){
     if(controller.signal.aborted)throw error;
     frame.status='failed';const message=translate(error.message,payload.language);
     frame.text+=payload.language==='ru'?'\n\nИзображение не создано: '+message:'\n\nImage not created: '+message;
    }
   }
   record.frames[index]=frame;
   await put(jobPath(job.owner,id,'frame-'+index),frame);
   completed++;
   const count=completed;
   publishing=publishing.then(()=>ref.update({imagesReady:count,progress:25+count*23,message:count+' of 3 eras processed. Ready images can be viewed now.',updatedAt:Date.now()}));await publishing;
  }));
  const rejected=results.find(result=>result.status==='rejected');if(rejected)throw rejected.reason;
  const fresh=(await ref.get()).data();if(fresh.cancelled||controller.signal.aborted)throw new Error('CANCELLED');
  await complete(id,job.owner,record);
 }catch(error){
  const cancelled=(await ref.get()).data()?.cancelled||error.message==='CANCELLED';
  await finish(id,{status:cancelled?'cancelled':'error',error:cancelled?'Генерация отменена. Уже отправленные запросы могли быть оплачены.':controller.signal.aborted?'Processing timed out. Automatic paid retries are disabled.':String(error.message||'Processing interrupted.').slice(0,1500)});
 }finally{
  clearInterval(heartbeat);clearTimeout(timeout);
  const final=(await ref.get()).data();if(final&&!['working','queued'].includes(final.status))await cleanup(job.owner,id);
 }
});

async function complete(id,who,record){
 if(!record.frames.some(frame=>frame.image))throw new Error(record.frames.find(frame=>frame.status==='failed')?.text||'Недостаточно свидетельств для реконструкции.');
 const fresh=(await db.doc(`jobs/${id}`).get()).data();if(fresh?.cancelled||fresh?.status!=='working')throw new Error('CANCELLED');
 await put(recordPath(who,record.id),record);
 const original=validateImage(record.original);
 await bucket().file(`private/${who}/thumbnails/${record.id}.jpg`).save(original.buffer,{resumable:false,contentType:original.mime,metadata:{cacheControl:'private, no-store'}});
 await db.doc(`profiles/${who}/records/${record.id}`).set({id:record.id,place:record.place,years:record.years,createdAt:record.createdAt,demo:false,thumbnailMime:original.mime});
 await finish(id,{status:'done',recordId:record.id,progress:100,message:'Путешествие готово'});
}
