import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import sharp from 'sharp';
import {openDatabase,claim} from '../db.js';
import {indiaDate,validVisitDate,expiryFor} from '../dates.js';
const input=(i=0)=>({name:'Customer '+i,mobile:String(9000000000+i),service:'Hair Styling',preferredVisitDate:indiaDate(),offer:1});
test('random awards stay in range; allocation, duplicate protection and immutable rewards persist',()=>{
 const dir=mkdtempSync(join(tmpdir(),'salon-db-')),path=join(dir,'db.sqlite');let db=openDatabase(path);
 try{
 const before=Date.now(),token=claim(db,input());const lead=db.prepare('SELECT * FROM leads WHERE token=?').get(token);
 assert.ok(Number.isInteger(lead.discount)&&lead.discount>=100&&lead.discount<=150);assert.equal(lead.expires_at,expiryFor(10,lead.created_at));assert.ok(lead.created_at>=before);assert.equal(lead.preferred_visit_date,indiaDate());assert.equal(lead.award_kind,'spin');
 assert.throws(()=>claim(db,input()),/already claimed/);
 db.prepare('UPDATE settings SET discount=200,validity=7').run();claim(db,input(1));
 assert.equal(db.prepare('SELECT discount FROM leads WHERE token=?').get(token).discount,lead.discount);
 for(let i=2;i<100;i++)claim(db,input(i));
 assert.throws(()=>claim(db,input(100)),/100 coupons/);
 const rows=db.prepare('SELECT code,discount FROM leads').all();assert.equal(new Set(rows.map(r=>r.code)).size,100);assert.ok(rows.every(r=>Number.isInteger(r.discount)&&r.discount>=100&&r.discount<=150));
 db.close();db=openDatabase(path);assert.equal(db.prepare('SELECT count(*) n FROM leads').get().n,100);assert.equal(db.prepare('SELECT discount FROM leads WHERE token=?').get(token).discount,lead.discount);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('visit date validates the Indian date boundary, impossible dates, past and expired dates',()=>{
 const now=Date.parse('2026-10-16T20:00:00Z');assert.equal(indiaDate(now),'2026-10-17');
 assert.ok(validVisitDate('2026-10-17',10,now));assert.ok(validVisitDate('2026-10-27',10,now));
 for(const date of ['','2026-02-30','2026-10-16','2026-10-28','2026-13-01'])assert.equal(validVisitDate(date,10,now),false,date);
});
test('migration preserves legacy coupons and previously edited prices',()=>{
 const dir=mkdtempSync(join(tmpdir(),'salon-legacy-')),path=join(dir,'db.sqlite');let db=new DatabaseSync(path);
 try{
 db.exec("CREATE TABLE leads(id INTEGER PRIMARY KEY,name TEXT NOT NULL,mobile TEXT NOT NULL,service TEXT NOT NULL,timeframe TEXT NOT NULL,offer_id INTEGER NOT NULL,code TEXT NOT NULL UNIQUE,token TEXT NOT NULL UNIQUE,discount INTEGER NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0,UNIQUE(mobile)); CREATE TABLE services(id INTEGER PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,price INTEGER); INSERT INTO services VALUES(50,'Hair colour','Owner edited price',600);");
 db.prepare('INSERT INTO leads VALUES(1,?,?,?,?,?,?,?,?,?,?,?)').run('Existing customer','9123456789','Hair colour','7',1,'RR-OLD','old-token',200,1000,2000,1);db.close();db=openDatabase(path);
 const old=db.prepare('SELECT * FROM leads WHERE id=1').get();assert.equal(old.discount,200);assert.equal(old.used,1);assert.equal(old.timeframe,'7');assert.equal(old.preferred_visit_date,null);assert.equal(old.award_kind,'legacy');assert.equal(db.prepare('SELECT price FROM services WHERE id=50').get().price,600);
 const count=db.prepare('SELECT count(*) n FROM services').get().n;db.close();db=openDatabase(path);assert.equal(db.prepare('SELECT count(*) n FROM services').get().n,count);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTP claim, PNG, social links, auth, CSRF, logo upload, export and restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'salon-http-')),dbPath=join(dir,'db.sqlite');
 const env={...process.env,PORT:'3197',DB_PATH:dbPath,ADMIN_PASSWORD:'a-test-password-12345',SESSION_SECRET:'test-session-secret-long-enough',NODE_ENV:'development',WHATSAPP_ACCESS_TOKEN:'',WHATSAPP_PHONE_NUMBER_ID:'',PUBLIC_BASE_URL:''};let child;
 async function start(){child=spawn(process.execPath,['server.js'],{env,stdio:['ignore','pipe','pipe']});let output='';child.stderr.on('data',d=>output+=d);await Promise.race([new Promise(resolve=>child.stdout.on('data',d=>{if(String(d).includes('listening'))resolve();})),new Promise((_,reject)=>{child.once('exit',()=>reject(new Error(output)));setTimeout(()=>reject(new Error('Startup timed out: '+output)),5000).unref();})]);}
 let cookie='';
 async function request(path,body,extra={}){const raw=Buffer.isBuffer(body);const res=await fetch('http://127.0.0.1:3197'+path,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{'content-type':raw?'image/png':'application/x-www-form-urlencoded'}:{}),...extra},body:body?(raw?body:new URLSearchParams(body)):undefined,redirect:'manual'});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];const buffer=Buffer.from(await res.arrayBuffer());return{res,buffer,text:buffer.toString()};}
 const csrf=text=>text.match(/name="csrf" value="([a-f0-9]+)"/)[1];
 const formInput=()=>({...input(),preferred_visit_date:indiaDate(),consent:'yes'});
 try{
 await start();for(const path of ['/','/links','/offers','/claim','/privacy','/admin/login'])assert.equal((await request(path)).res.status,200,path);
 const links=(await request('/links')).text;assert.match(links,/https:\/\/maps.app.goo.gl\/gXdakHQ4XLjzyviQ7/);assert.match(links,/https:\/\/www.instagram.com\/raju_reyaz.nagaon\//);assert.match(links,/61594204566462/);
 assert.equal((await request('/admin')).res.status,302);
 const page=await request('/claim');let token=csrf(page.text);assert.match(page.text,/0 people have/);assert.match(page.text,/Hydra Facial/);
 assert.equal((await request('/claim',{...formInput(),csrf:'bad'})).res.status,403);
 assert.equal((await request('/claim',{...formInput(),csrf:token,mobile:'bad'})).res.status,400);
 assert.equal((await request('/claim',{...formInput(),csrf:token,preferred_visit_date:'2020-01-01'})).res.status,409);
 const claimed=await request('/claim',{...formInput(),csrf:token,discount:'999999'});assert.equal(claimed.res.status,302);assert.equal(claimed.res.headers.get('location'),'/claim/success');
 const coupon=await request('/claim/success');assert.equal(coupon.res.status,200);assert.match(coupon.text,/data-new-spin="yes"/);assert.equal(coupon.res.headers.get('cache-control'),'no-store');
 const amount=Number(coupon.text.match(/data-spin-value="(\d+)"/)[1]);assert.ok(amount>=100&&amount<=150);
 const path=coupon.text.match(/href="(\/coupon\/[a-f0-9]+\/download)"/)[1];let png=await request(path);assert.equal(png.res.status,200);assert.match(png.res.headers.get('content-type'),/image\/png/);assert.match(png.res.headers.get('content-disposition'),/\.png/);assert.equal((await sharp(png.buffer).metadata()).width,1080);assert.equal((await sharp(png.buffer).metadata()).height,1350);
 assert.match((await request('/claim/success')).text,/data-new-spin="no"/);assert.equal((await request('/claim',{...formInput(),csrf:token})).res.status,409);
 const login=await request('/admin/login');assert.equal((await request('/admin/login',{csrf:csrf(login.text),password:'wrong'})).res.status,401);assert.equal((await request('/admin/login',{csrf:csrf(login.text),password:env.ADMIN_PASSWORD})).res.status,302);
 const admin=await request('/admin');assert.equal(admin.res.status,200);assert.match(admin.text,/9000000000/);assert.match(admin.text,/pending/);assert.match(admin.text,/Claimed \(IST\)/);token=csrf(admin.text);
 for(const section of ['leads','services','offers','settings'])assert.equal((await request('/admin?section='+section)).res.status,200,section);
 assert.match((await request('/admin?section=leads&status=available&q=Customer')).text,/9000000000/);
 assert.match((await request('/admin?section=leads&status=used')).text,/No matching customers/);
 assert.match((await request('/admin?section=leads&status=expired')).text,/No matching customers/);
 assert.match((await request('/admin?section=leads&q=missing')).text,/No matching customers/);
 assert.match((await request('/admin?section=leads&status=invalid')).text,/9000000000/);
 assert.equal((await request('/admin/lead/1',{csrf:'bad',used:'1'})).res.status,403);
 const update=await request('/admin/lead/1',{csrf:token,used:'1',section:'leads',q:'Customer',status:'available'});
 assert.equal(update.res.headers.get('location'),'/admin?section=leads&q=Customer&status=available');
 const feedback=await request(update.res.headers.get('location'));assert.match(feedback.text,/Coupon marked as used/);assert.match(feedback.text,/No matching customers/);
 assert.doesNotMatch((await request('/admin?section=leads')).text,/Coupon marked as used/);
 assert.match((await request('/admin?section=leads&status=used&q=9000000000')).text,/9000000000/);
 const fixture=new DatabaseSync(dbPath);const expiry=fixture.prepare('SELECT expires_at FROM leads WHERE id=1').get().expires_at;
 fixture.prepare('UPDATE leads SET used=0,expires_at=? WHERE id=1').run(Date.now()-1000);
 assert.match((await request('/admin?section=leads&status=expired')).text,/9000000000/);
 assert.match((await request('/admin?section=leads&status=available')).text,/No matching customers/);
 fixture.prepare('UPDATE leads SET expires_at=? WHERE id=1').run(expiry);fixture.close();
 assert.equal((await request('/admin/settings',{csrf:token,validity:'100'})).res.status,400);assert.equal((await request('/admin/settings',{csrf:token,validity:'7'})).res.status,302);
 assert.equal((await request('/admin/lead/1',{csrf:token,used:'1'})).res.status,302);assert.match((await request('/admin?q=Customer')).text,/Used/);
 assert.equal((await request('/admin/service/1',{csrf:token,price:'350'})).res.status,302);assert.match((await request('/')).text,/From ₹350/);
 assert.equal((await request('/admin/offer',{csrf:token,title:'Fresh look',description:'A special salon coupon.',active:'1'})).res.status,302);assert.match((await request('/offers')).text,/Fresh look/);
 const image=await sharp(Buffer.from('<svg width="300" height="100"><rect width="300" height="100" fill="white"/><rect x="50" y="30" width="200" height="40" fill="red"/></svg>')).png().toBuffer();
 assert.equal((await request('/admin/logo',image,{'X-CSRF-Token':'invalid'})).res.status,403);
 assert.equal((await request('/admin/logo',Buffer.from('not an image'),{'X-CSRF-Token':token})).res.status,400);
 assert.equal((await request('/admin/logo',image,{'X-CSRF-Token':token})).res.status,200);assert.equal((await request('/assets/logo')).res.status,200);assert.match((await request('/')).text,/\/assets\/logo\?v=/);png=await request(path);assert.equal((await sharp(png.buffer).metadata()).width,1080);
 const csv=await request('/admin/export');assert.match(csv.text,/preferred_visit_date/);assert.match(csv.text,new RegExp(indiaDate()));assert.match(csv.text,/T\d\d:\d\d:\d\d\.\d\d\dZ/);assert.match(csv.text,/9000000000/);
 child.kill();await once(child,'exit');await start();const persisted=await request('/admin');assert.match(persisted.text,/9000000000/);assert.match(persisted.text,/pending/);assert.equal((await request('/assets/logo')).res.status,200);assert.match((await request(path.replace('/download',''))).text,new RegExp('data-spin-value="'+amount+'"'));
 assert.equal((await request('/admin/logout',{csrf:token})).res.status,302);assert.equal((await request('/admin/export')).res.status,302);assert.equal((await request('/admin/logo',image,{'X-CSRF-Token':'not-authorised'})).res.status,403);
 }finally{if(child?.exitCode===null){child.kill();await once(child,'exit');}rmSync(dir,{recursive:true,force:true});}
});
