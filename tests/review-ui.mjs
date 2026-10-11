import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root='public/';
const html=await readFile(root+'index.html','utf8'),runtime=await readFile(root+'i18n.js','utf8'),app=await readFile(root+'app.js','utf8'),sample=JSON.parse(await readFile(root+'sample-result.json','utf8'));
let count=0;const pass=name=>{count++;console.log('PASS '+name);};
async function page({blocked=false,jobs=[]}={}){
 const dom=new JSDOM(html,{url:'https://timelens-511210.web.app/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.matchMedia=()=>({matches:false});w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLMediaElement.prototype.pause=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};w.crypto.randomUUID=randomUUID;
 if(blocked)w.indexedDB={open:()=>({})};
 const requests=[];
 w.fetch=async(path,options={})=>{
  requests.push({path,options});let value={};
  if(path==='/api/config')value={configured:true,googleClientId:'',user:null,guestMode:true,requiresLogin:false};
  if(path==='/api/history')value={records:[]};
  if(path==='sample-result.json')value=structuredClone(sample);
  if(path==='/api/generate')value={jobId:'test-job'};
  if(path==='/api/jobs/test-job')value=jobs.shift();
  return {ok:true,json:async()=>value};
 };
 w.eval(runtime);w.eval(app+'\nwindow.testLoadPhoto=loadPhoto;');await new Promise(resolve=>setTimeout(resolve,30));
 return {w,d:w.document,requests,close:()=>w.close()};
}
let p=await page({blocked:true});p.d.querySelector('#history-tab').click();await new Promise(resolve=>setTimeout(resolve,1650));
assert(p.d.querySelector('.empty-history'));assert(!p.d.querySelector('#history-grid').textContent.includes('Loading'));
pass('blocked browser storage resolves into a usable empty guest album');p.close();
p=await page();p.d.querySelector('#hero-demo').click();await new Promise(resolve=>setTimeout(resolve,30));
assert.equal(p.d.querySelector('#result-cards').children.length,4);
assert(p.d.querySelector('#scene-image').src.endsWith('/paris-1888.webp'));
assert(!p.d.querySelector('#result-credit').hidden);assert.match(p.d.querySelector('#result-credit').textContent,/CC BY-SA 3.0/);
assert.equal(p.d.querySelectorAll('#sources-list a').length,3);assert.equal(p.requests.filter(r=>r.path==='/api/generate').length,0);
pass('public sample shows actual prepared images, sources and derivative licence without generating');
p.d.querySelector('#timeline').value='3';p.d.querySelector('#timeline').dispatchEvent(new p.w.Event('input'));
assert.match(p.d.querySelector('#overlay-year').textContent,/2011/);assert(!p.d.querySelector('#overlay-year').textContent.includes('Now'));
pass('the dated source photograph is labelled 2011 rather than the current year');
p.d.querySelector('#timeline').value='1';p.d.querySelector('#timeline').dispatchEvent(new p.w.Event('input'));
p.d.querySelector('#language-toggle').click();assert.match(p.d.querySelector('#evidence-text').textContent,/Всемирной выставки/);assert.match(p.d.querySelector('#result-place').textContent,/Париж/);
assert.equal(p.d.querySelector('#timeline').value,'1');assert(p.d.querySelector('#scene-image').src.endsWith('/paris-1900.webp'));
pass('prepared example descriptions translate without changing the selected frame');
assert(!p.d.querySelector('.hero-copy h1').textContent.includes('*'));pass('headline has no literal markdown stars');p.close();
const pending=structuredClone(sample);pending.sample=false;pending.location={latitude:48.86,longitude:2.28,source:'photo'};pending.frames.forEach(frame=>{frame.image=null;frame.status='pending';});
const partial=structuredClone(pending);partial.frames[1].image=sample.frames[1].image;partial.frames[1].status='limited';
const done=structuredClone(sample);done.sample=false;done.location=pending.location;
p=await page({jobs:[{status:'working',phase:'images',message:'Research complete',progress:25,record:pending},{status:'working',phase:'images',message:'One ready',progress:48,record:partial},{status:'done',phase:'images',progress:100,record:done}]});
// Seed a source photo and location through the same functions used by the camera.
p.w.testLoadPhoto('data:image/jpeg;base64,AAAA',{latitude:48.86,longitude:2.28,source:'photo'});
// Shorten read-only polling in this harness; production remains at five seconds.
const timer=p.w.setTimeout;p.w.setTimeout=(fn,ms,...args)=>timer(fn,ms===5000?80:ms,...args);
p.d.querySelector('#generate-button').click();await new Promise(resolve=>setTimeout(resolve,35));
assert(!p.d.querySelector('#result-details').hidden);assert.match(p.d.querySelector('#overlay-tag').textContent,/RENDERING/);assert(!p.d.querySelector('#epoch-cards button').disabled);assert(p.d.querySelector('#busy-overlay').classList.contains('partial-results'));
pass('early research exposes sources and selectable eras while image generation continues');
await new Promise(resolve=>setTimeout(resolve,85));assert(p.d.querySelector('#scene-image').src.endsWith('/paris-1900.webp'));assert.equal(p.d.querySelector('#timeline').value,'1');assert(!p.d.querySelector('#compare-button').disabled);
pass('first completed era opens immediately with comparison available');
await new Promise(resolve=>setTimeout(resolve,120));assert(p.d.querySelector('#busy-overlay').hidden);assert(p.d.querySelector('#result-cards img').src.endsWith('/paris-1888.webp'));assert.equal(p.requests.filter(r=>r.path==='/api/generate').length,1);
pass('completed progressive journey has three frames with a single generation submission');p.close();
console.log(`${count} review UI checks passed; mocked provider, no paid calls.`);
