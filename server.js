import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import session from 'express-session';
import { rateLimit } from 'express-rate-limit';
import { randomBytes,scryptSync,timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import {couponPNG} from './coupon-image.js';
import {indiaDate,expiryFor,displayVisitDate} from './dates.js';
import { brandAssets } from './branding.js';
import { createWhatsAppWorker } from './whatsapp.js';
import { openDatabase,claim } from './db.js';
const app=express(),db=openDatabase(process.env.DB_PATH || './data/salon.sqlite');
const whatsapp=createWhatsAppWorker(db);
const whatsappTimer=setInterval(()=>whatsapp.processNext().catch(()=>console.error('WhatsApp queue processing failed')),5000);
whatsappTimer.unref();
setImmediate(()=>whatsapp.processNext().catch(()=>console.error('WhatsApp queue processing failed')));
const production=process.env.NODE_ENV==='production';
if(production && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length<32 || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length<12)) throw new Error('Production requires SESSION_SECRET (at least 32 characters) and ADMIN_PASSWORD (at least 12 characters).');
if(process.env.TRUST_PROXY) app.set('trust proxy',Number(process.env.TRUST_PROXY));
app.set('view engine','ejs');
app.use(helmet({contentSecurityPolicy:{directives:{'script-src':["'self'",'https://connect.facebook.net'],'img-src':["'self'",'data:','https://www.facebook.com'],'connect-src':["'self'",'https://www.facebook.com'],'media-src':["'self'"]}}}));
app.use(compression());
app.use(express.urlencoded({extended:false,limit:'16kb'}));
app.use(express.static('public',{maxAge:production?'1d':0}));
class SQLiteStore extends session.Store {
 get(sid,cb){try{const row=db.prepare('SELECT value FROM sessions WHERE sid=? AND expires>?').get(sid,Date.now());cb(null,row?JSON.parse(row.value):null);}catch(e){cb(e);}}
 set(sid,value,cb){try{db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?)').run(sid,JSON.stringify(value),Date.now()+8*3600000);cb?.();}catch(e){cb?.(e);}}
 destroy(sid,cb){try{db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);cb?.();}catch(e){cb?.(e);}}
}
app.use(session({store:new SQLiteStore(),secret:process.env.SESSION_SECRET||randomBytes(32).toString('hex'),resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:production,maxAge:8*3600000}}));
const limit=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false});
app.use((req,res,next)=>{
 req.session.csrf ||=randomBytes(24).toString('hex');
 res.locals={...res.locals,path:req.path,csrf:req.session.csrf,pixel:/^\d{5,25}$/.test(process.env.META_PIXEL_ID||'')?process.env.META_PIXEL_ID:'',...brandAssets(db),today:indiaDate(),visitDate:displayVisitDate,timestamp:n=>new Date(n).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),music:existsSync('public/music/song.mp3'),song:process.env.MUSIC_TITLE||'A little nostalgia',date:n=>new Date(n).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}),admin:!!req.session.admin};
 if(req.path.startsWith('/admin')||req.path.startsWith('/coupon/')||req.path.startsWith('/claim')) res.set('Cache-Control','no-store');
 if(req.path.startsWith('/admin')||req.path.startsWith('/coupon/')||req.path==='/claim/success')res.set('X-Robots-Tag','noindex, nofollow');
 if(req.method==='POST'&&(req.get('X-CSRF-Token')||req.body?.csrf)!==req.session.csrf) return res.status(403).send('Your session expired. Refresh the page and try again.');
 next();
});
const services=()=>db.prepare('SELECT * FROM services').all();
const offers=()=>db.prepare('SELECT * FROM offers WHERE active=1').all();
const stats=()=>({recent:db.prepare('SELECT count(*) n FROM leads WHERE created_at>=?').get(Date.now()-86400000).n,total:db.prepare('SELECT count(*) n FROM leads').get().n});
app.get('/',(req,res)=>res.render('home',{services:services(),settings:db.prepare('SELECT * FROM settings').get()}));
app.get('/links',(req,res)=>res.render('links'));
app.get('/link',(req,res)=>res.redirect('/links'));
app.get('/assets/logo',(req,res)=>{const asset=db.prepare("SELECT display FROM assets WHERE name='logo'").get();if(!asset)return res.sendStatus(404);res.set('Cache-Control','public, max-age=86400').type('png').send(Buffer.from(asset.display));});
app.get('/offers',(req,res)=>res.render('offers',{offers:offers()}));
function form(req,res,error='',status=200){res.status(status).render('claim',{services:services(),offers:offers(),settings:db.prepare('SELECT * FROM settings').get(),stats:stats(),selected:Number(req.query.offer||req.body?.offer||1),values:req.method==='POST'?req.body:{service:String(req.query.service||'')},maxVisitDate:indiaDate(expiryFor(db.prepare('SELECT validity FROM settings').get().validity)),error});}
app.get('/claim',(req,res)=>form(req,res));
app.post('/claim',limit,(req,res)=>{
 const name=String(req.body.name||'').trim(),mobile=String(req.body.mobile||'').replace(/[\s+-]/g,'').replace(/^91(?=\d{10}$)/,''),service=String(req.body.service||''),preferredVisitDate=String(req.body.preferred_visit_date||'');
 if(name.length<2||name.length>80||! /^[6-9]\d{9}$/.test(mobile)||!services().some(x=>x.name===service)||req.body.consent!=='yes') return form(req,res,'Please enter your name, a valid Indian mobile number, service, preferred visit date and consent.',400);
 try{const token=claim(db,{name,mobile,service,preferredVisitDate,offer:Number(req.body.offer),whatsapp:true});req.session.newCoupon=token;req.session.lastCoupon=token;res.redirect('/claim/success');setImmediate(()=>whatsapp.processNext().catch(()=>console.error('WhatsApp queue processing failed')));}catch(e){form(req,res,e.message,409);}
});
app.get('/claim/success',(req,res)=>{
 const lead=db.prepare('SELECT * FROM leads WHERE token=?').get(req.session.lastCoupon||'');if(!lead)return res.redirect('/claim');
 const fresh=req.session.newCoupon===lead.token;delete req.session.newCoupon;
 res.set('Cache-Control','no-store').set('Referrer-Policy','no-referrer').render('coupon',{lead,fresh});
});
app.get('/coupon/:token',(req,res)=>{
 const lead=db.prepare('SELECT * FROM leads WHERE token=?').get(req.params.token);if(!lead)return res.sendStatus(404);
 const fresh=req.session.newCoupon===lead.token;delete req.session.newCoupon;
 res.set('Referrer-Policy','no-referrer').render('coupon',{lead,fresh});
});
app.get('/coupon/:token/download',async(req,res)=>{
 const lead=db.prepare('SELECT * FROM leads WHERE token=?').get(req.params.token);if(!lead)return res.sendStatus(404);
 const png=await couponPNG(lead,db);res.type('png').attachment('raju-reyaz-'+lead.code+'.png').send(png);
});
const guard=(req,res,next)=>req.session.admin?next():res.redirect('/admin/login');
app.get('/admin/login',(req,res)=>res.render('login',{error:'',configured:!!process.env.ADMIN_PASSWORD}));
app.post('/admin/login',limit,(req,res)=>{
 const expected=process.env.ADMIN_PASSWORD;
 if(!expected||!timingSafeEqual(scryptSync(String(req.body.password||''),'salon-admin',64),scryptSync(expected,'salon-admin',64))) return res.status(401).render('login',{error:'Invalid password or admin access is not configured.',configured:!!expected});
 req.session.regenerate(e=>{if(e)return res.sendStatus(500);req.session.admin=true;req.session.csrf=randomBytes(24).toString('hex');req.session.save(()=>res.redirect('/admin'));});
});
app.post('/admin/logout',guard,(req,res)=>req.session.destroy(()=>res.redirect('/')));
app.get('/admin',guard,(req,res)=>{
 const q=String(req.query.q||'').slice(0,100),pattern='%'+q+'%',now=Date.now();
 const section=['overview','leads','services','offers','settings'].includes(req.query.section)?req.query.section:(q?'leads':'overview');
 const status=['available','used','expired'].includes(req.query.status)?req.query.status:'all';
 const statusSQL={all:'1=1',available:'l.used=0 AND l.expires_at>?',used:'l.used=1',expired:'l.used=0 AND l.expires_at<=?'}[status];
 const parameters=[pattern,pattern,pattern,...(['available','expired'].includes(status)?[now]:[])];
 const leads=db.prepare(`SELECT l.*,w.status AS whatsapp_status,w.error AS whatsapp_error FROM leads l LEFT JOIN whatsapp_messages w ON w.lead_id=l.id WHERE (l.name LIKE ? OR l.mobile LIKE ? OR l.code LIKE ?) AND ${statusSQL} ORDER BY l.created_at DESC,l.id DESC`).all(...parameters);
 const counts=db.prepare('SELECT count(*) total,coalesce(sum(used=1),0) used,coalesce(sum(used=0 AND expires_at>?),0) available,coalesce(sum(used=0 AND expires_at<=?),0) expired,coalesce(sum(preferred_visit_date=?),0) visitsToday FROM leads').get(now,now,indiaDate());
 const flash=req.session.adminFlash||'';delete req.session.adminFlash;
 res.render('admin',{q,status,section,leads:section==='overview'?leads.slice(0,5):leads,counts,services:services(),offers:db.prepare('SELECT * FROM offers').all(),settings:db.prepare('SELECT * FROM settings').get(),stats:stats(),whatsappConfigured:whatsapp.configured,flash,now});
});
app.post('/admin/logo',guard,express.raw({type:['image/png','image/jpeg','image/webp'],limit:'5mb'}),async(req,res)=>{
 if(!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:'Choose a PNG, JPG or WebP file.'});
 try {
   const original=req.body,image=sharp(original,{limitInputPixels:16000000}),metadata=await image.metadata();
   if(!['png','jpeg','webp'].includes(metadata.format))return res.status(400).json({error:'Choose a PNG, JPG or WebP image.'});
   const display=await image.rotate().trim({background:'#ffffff',threshold:8}).resize({width:1200,height:600,fit:'inside',withoutEnlargement:true}).png().toBuffer();
   db.prepare('INSERT OR REPLACE INTO assets VALUES(?,?,?,?,?)').run('logo',req.get('Content-Type'),original,display,Date.now());
   req.session.adminFlash='Salon logo updated. Your website and new coupon downloads now use this logo.';
   res.json({ok:true});
 }catch{return res.status(400).json({error:'This image could not be opened. Use a valid image smaller than 5 MB and 16 megapixels.'});}
});
function returnToLeads(req,res,message){
 req.session.adminFlash=message;
 const query=new URLSearchParams({section:req.body.section==='overview'?'overview':'leads'});
 if(req.body.q)query.set('q',String(req.body.q).slice(0,100));
 if(['available','used','expired'].includes(req.body.status))query.set('status',req.body.status);
 res.redirect('/admin?'+query);
}
app.post('/admin/lead/:id',guard,(req,res)=>{const result=db.prepare('UPDATE leads SET used=? WHERE id=?').run(req.body.used==='1'?1:0,Number(req.params.id));if(!result.changes)return res.sendStatus(404);returnToLeads(req,res,req.body.used==='1'?'Coupon marked as used.':'Coupon marked as unused. Its original expiry date still applies.');});
app.post('/admin/whatsapp/:id/retry',guard,(req,res)=>{
 db.prepare("UPDATE whatsapp_messages SET status='pending',attempts=0,next_attempt=0,error='' WHERE lead_id=? AND status='failed' AND lead_id IN (SELECT id FROM leads WHERE expires_at>?)").run(Number(req.params.id),Date.now());
 returnToLeads(req,res,'WhatsApp retry requested for eligible failed messages.');setImmediate(()=>whatsapp.processNext().catch(()=>console.error('WhatsApp queue processing failed')));
});
app.post('/admin/settings',guard,(req,res)=>{const d=200,v=Number(req.body.validity);if(!Number.isInteger(v)||v<1||v>90)return res.status(400).send('Validity must be 1–90 days. New spin awards are always ₹100–₹150.');db.prepare('UPDATE settings SET discount=?,validity=? WHERE id=1').run(d,v);req.session.adminFlash='Coupon validity updated for future claims.';res.redirect('/admin?section=settings');});
app.post('/admin/service/:id',guard,(req,res)=>{const p=req.body.price===''?null:Number(req.body.price);if(p!==null&&(!Number.isInteger(p)||p<0||p>100000))return res.sendStatus(400);db.prepare('UPDATE services SET price=? WHERE id=?').run(p,Number(req.params.id));req.session.adminFlash='Service price updated on your website.';res.redirect('/admin?section=services');});
app.post('/admin/offer',guard,(req,res)=>{const title=String(req.body.title||'').trim(),description=String(req.body.description||'').trim(),active=req.body.active==='1'?1:0;if(!title||title.length>100||!description||description.length>600)return res.sendStatus(400);if(req.body.id)db.prepare('UPDATE offers SET title=?,description=?,active=? WHERE id=?').run(title,description,active,Number(req.body.id));else db.prepare('INSERT INTO offers(title,description,active) VALUES(?,?,?)').run(title,description,active);req.session.adminFlash=req.body.id?'Offer updated.':'New offer created.';res.redirect('/admin?section=offers');});
app.get('/admin/export',guard,(req,res)=>{
 const rows=db.prepare('SELECT name,mobile,service,preferred_visit_date,code,discount,created_at,expires_at,used FROM leads ORDER BY created_at DESC').all();
 const cell=v=>'"'+String(v).replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
 res.type('text/csv').attachment('salon-leads.csv').send(['name,mobile,service,preferred_visit_date,coupon,discount,claimed_at_utc,expires_at_utc,used',...rows.map(r=>Object.values({...r,created_at:new Date(r.created_at).toISOString(),expires_at:new Date(r.expires_at).toISOString()}).map(cell).join(','))].join('\r\n'));
});
app.get('/privacy',(req,res)=>res.render('privacy'));
app.use((err,req,res,next)=>{console.error(err.message);res.status(500).send('Something went wrong. Please try again or call 9126691868.');});
app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Salon server listening on port '+(process.env.PORT||3000)));
