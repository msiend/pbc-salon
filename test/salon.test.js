import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {openDatabase,claim} from '../db.js';
const input=(i=0)=>({name:'Customer '+i,mobile:String(9000000000+i),service:'Hair styling',timeframe:'5',offer:1});
test('coupon uniqueness, allocation, expiry, preserved terms and persistent data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'salon-db-')),path=join(dir,'db.sqlite');let db=openDatabase(path);
 try{
 const before=Date.now(),token=claim(db,input());
 const lead=db.prepare('SELECT * FROM leads WHERE token=?').get(token);
 assert.equal(lead.discount,200);assert.equal(lead.expires_at-lead.created_at,10*86400000);assert.ok(lead.created_at>=before);
 assert.throws(()=>claim(db,input()),/already claimed/);
 db.prepare('UPDATE settings SET discount=150,validity=7').run();
 claim(db,input(1));assert.equal(db.prepare('SELECT discount FROM leads WHERE mobile=?').get(input(1).mobile).discount,150);
 assert.equal(db.prepare('SELECT discount FROM leads WHERE token=?').get(token).discount,200);
 for(let i=2;i<100;i++)claim(db,input(i));
 assert.throws(()=>claim(db,input(100)),/100 coupons/);
 assert.equal(db.prepare('SELECT count(DISTINCT code) n FROM leads').get().n,100);
 db.close();db=openDatabase(path);assert.equal(db.prepare('SELECT count(*) n FROM leads').get().n,100);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTP lead, download, authentication, CSRF, settings, export and restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'salon-http-'));const dbPath=join(dir,'db.sqlite');
 const env={...process.env,PORT:'3197',DB_PATH:dbPath,ADMIN_PASSWORD:'a-test-password-12345',SESSION_SECRET:'test-session-secret-long-enough',NODE_ENV:'development'};
 let child;
 async function start(){child=spawn(process.execPath,['server.js'],{env,stdio:['ignore','pipe','pipe']});let output='';child.stderr.on('data',d=>output+=d);await Promise.race([new Promise(resolve=>child.stdout.on('data',d=>{if(String(d).includes('listening'))resolve();})),new Promise((_,reject)=>{child.once('exit',()=>reject(new Error(output)));setTimeout(()=>reject(new Error('Startup timed out: '+output)),5000).unref();})]);}
 let cookie='';
 async function request(path,body){const res=await fetch('http://127.0.0.1:3197'+path,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/x-www-form-urlencoded'}:{})},body:body?new URLSearchParams(body):undefined,redirect:'manual'});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];return{res,text:await res.text()};}
 const csrf=text=>text.match(/name="csrf" value="([a-f0-9]+)"/)[1];
 try{
 await start();
 for(const path of ['/','/offers','/claim','/privacy','/admin/login']){const r=await request(path);assert.equal(r.res.status,200,path);}
 assert.equal((await request('/admin')).res.status,302);
 let page=await request('/claim'),token=csrf(page.text);
 assert.match(page.text,/0 people have/);
 assert.equal((await request('/claim',{...input(),csrf:'bad',consent:'yes'})).res.status,403);
 assert.equal((await request('/claim',{...input(),csrf:token,mobile:'bad',consent:'yes'})).res.status,400);
 const claimResult=await request('/claim',{...input(),csrf:token,consent:'yes'});assert.equal(claimResult.res.status,302);assert.equal(claimResult.res.headers.get('location'),'/claim/success');
 const coupon=await request('/claim/success');assert.equal(coupon.res.status,200);assert.match(coupon.text,/data-lead-success="yes"/);assert.equal(coupon.res.headers.get('cache-control'),'no-store');
 const downloadPath=coupon.text.match(/href="(\/coupon\/[a-f0-9]+\/download)"/)[1];
 const svg=await request(downloadPath);assert.equal(svg.res.status,200);assert.match(svg.text,/Up to ₹200 OFF/);assert.match(svg.res.headers.get('content-type'),/image\/svg/);
 assert.match((await request('/claim/success')).text,/data-lead-success="no"/);
 assert.equal((await request('/claim',{...input(),csrf:token,consent:'yes'})).res.status,409);
 const login=await request('/admin/login');assert.equal((await request('/admin/login',{csrf:csrf(login.text),password:'wrong'})).res.status,401);
 assert.equal((await request('/admin/login',{csrf:csrf(login.text),password:env.ADMIN_PASSWORD})).res.status,302);
 const admin=await request('/admin');assert.equal(admin.res.status,200);assert.match(admin.text,/9000000000/);
 token=csrf(admin.text);
 assert.equal((await request('/admin/settings',{csrf:token,discount:'201',validity:'10'})).res.status,400);
 assert.equal((await request('/admin/settings',{csrf:token,discount:'150',validity:'7'})).res.status,302);
 assert.equal((await request('/admin/lead/1',{csrf:token,used:'1'})).res.status,302);
 assert.match((await request('/admin?q=Customer')).text,/Used/);
 assert.equal((await request('/admin/service/1',{csrf:token,price:'350'})).res.status,302);
 assert.match((await request('/')).text,/From ₹350/);
 assert.equal((await request('/admin/offer',{csrf:token,title:'Fresh look',description:'A special salon coupon.',active:'1'})).res.status,302);
 assert.match((await request('/offers')).text,/Fresh look/);
 const csv=await request('/admin/export');assert.match(csv.text,/9000000000/);assert.match(csv.res.headers.get('content-disposition'),/attachment/);
 child.kill();await once(child,'exit');await start();
 assert.match((await request('/admin')).text,/9000000000/); // Persistent session and lead
 assert.match((await request(downloadPath)).text,/Up to ₹200 OFF/); // Original terms remain
 assert.equal((await request('/admin/logout',{csrf:token})).res.status,302);
 assert.equal((await request('/admin/export')).res.status,302);
 }finally{if(child?.exitCode===null){child.kill();await once(child,'exit');}rmSync(dir,{recursive:true,force:true});}
});
