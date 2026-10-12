import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase,claim} from '../db.js';
import {whatsappConfig,createWhatsAppWorker} from '../whatsapp.js';
const config=whatsappConfig({WHATSAPP_ACCESS_TOKEN:'mock-token',WHATSAPP_PHONE_NUMBER_ID:'1234567',WHATSAPP_TEMPLATE_NAME:'salon_coupon_confirmation',PUBLIC_BASE_URL:'https://salon.example.com'});
function fixture(){const dir=mkdtempSync(join(tmpdir(),'salon-wa-'));const db=openDatabase(join(dir,'db.sqlite'));const token=claim(db,{name:'Test Customer',mobile:'9123456789',service:'Hair styling',timeframe:'5',offer:1,whatsapp:true});return {db,token,close(){db.close();rmSync(dir,{recursive:true,force:true});}};}
const job=db=>db.prepare('SELECT * FROM whatsapp_messages').get();
test('queue is atomic with claim; existing leads are not backfilled',()=>{
 const f=fixture();try{assert.equal(job(f.db).status,'pending');assert.throws(()=>claim(f.db,{mobile:'9123456789',offer:1,whatsapp:true}),/already claimed/);assert.equal(f.db.prepare('SELECT count(*) n FROM whatsapp_messages').get().n,1);
 claim(f.db,{name:'No WhatsApp',mobile:'9123456790',service:'Hair styling',timeframe:'5',offer:1});assert.equal(f.db.prepare('SELECT count(*) n FROM whatsapp_messages').get().n,1);
 }finally{f.close();}
});
test('approved template payload sends once and records acceptance without claiming delivery',async()=>{
 const f=fixture();try{let calls=0;const worker=createWhatsAppWorker(f.db,{config,fetchImpl:async(url,options)=>{
 calls++;assert.equal(url,'https://graph.facebook.com/v23.0/1234567/messages');assert.equal(options.headers.Authorization,'Bearer mock-token');
 const body=JSON.parse(options.body);assert.equal(body.to,'919123456789');assert.equal(body.type,'template');assert.equal(body.template.name,'salon_coupon_confirmation');
 const params=body.template.components[0].parameters;assert.equal(params.length,5);assert.equal(params[0].text,'Test Customer');assert.equal(params[2].text,'200');assert.equal(params[4].text,'https://salon.example.com/coupon/'+f.token);
 return Response.json({messages:[{id:'wamid.mock'}]});
 }});
 await Promise.all([worker.processNext(),worker.processNext()]);await worker.processNext();assert.equal(calls,1);assert.equal(job(f.db).status,'accepted');assert.equal(job(f.db).message_id,'wamid.mock');
 }finally{f.close();}
});
test('missing configuration leaves coupon and queue intact without network access',async()=>{
 const f=fixture();try{const worker=createWhatsAppWorker(f.db,{config:null,fetchImpl:()=>{throw Error('Should not call network')}});assert.equal(worker.configured,false);await worker.processNext();assert.equal(job(f.db).status,'pending');assert.equal(f.db.prepare('SELECT count(*) n FROM leads').get().n,1);
 }finally{f.close();}
});
test('API rejection is recorded safely; timeout is uncertain and is not replayed',async()=>{
 for(const mode of ['reject','timeout','server']){const f=fixture();try{let calls=0;const worker=createWhatsAppWorker(f.db,{config,fetchImpl:async()=>{calls++;if(mode==='timeout')throw Error('sensitive-token');return Response.json({error:{code:190,message:'sensitive-token'}},{status:mode==='server'?503:401});}});await worker.processNext();await worker.processNext();assert.equal(calls,1);assert.equal(job(f.db).status,mode==='reject'?'failed':'unknown');assert.ok(!job(f.db).error.includes('sensitive-token'));assert.equal(f.db.prepare('SELECT count(*) n FROM leads').get().n,1);}finally{f.close();}}
});
test('rate limiting retries at most three times with a delay',async()=>{
 const f=fixture();try{let time=Date.now(),calls=0;const worker=createWhatsAppWorker(f.db,{config,now:()=>time,fetchImpl:async()=>{calls++;return Response.json({error:{code:4}},{status:429})}});await worker.processNext();await worker.processNext();assert.equal(calls,1);time+=60001;await worker.processNext();time+=60001;await worker.processNext();assert.equal(calls,3);assert.equal(job(f.db).status,'failed');assert.equal(job(f.db).attempts,3);
 }finally{f.close();}
});
test('restart does not resend interrupted requests; expired coupons are not sent',async()=>{
 const f=fixture();try{f.db.prepare("UPDATE whatsapp_messages SET status='sending'").run();const worker=createWhatsAppWorker(f.db,{config,fetchImpl:()=>{throw Error('must not send')}});await worker.processNext();assert.equal(job(f.db).status,'unknown');f.db.prepare("UPDATE whatsapp_messages SET status='pending'").run();f.db.prepare('UPDATE leads SET expires_at=0').run();await worker.processNext();assert.equal(job(f.db).status,'failed');assert.match(job(f.db).error,/expired/);
 }finally{f.close();}
});
test('configuration requires a trusted HTTPS origin, phone ID and template name',()=>{
 assert.ok(config);assert.equal(whatsappConfig({}),null);
 for(const url of ['http://example.com','https://user:password@example.com','https://example.com/path'])assert.equal(whatsappConfig({WHATSAPP_ACCESS_TOKEN:'mock',WHATSAPP_PHONE_NUMBER_ID:'123',WHATSAPP_TEMPLATE_NAME:'coupon',PUBLIC_BASE_URL:url}),null);
});
