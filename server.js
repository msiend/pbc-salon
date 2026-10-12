import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import session from 'express-session';
import { rateLimit } from 'express-rate-limit';
import { randomBytes,scryptSync,timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
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
 res.locals={...res.locals,path:req.path,csrf:req.session.csrf,pixel:/^\d{5,25}$/.test(process.env.META_PIXEL_ID||'')?process.env.META_PIXEL_ID:'',logo:existsSync('public/brand/logo.png'),hero:existsSync('public/brand/exterior-night.webp'),music:existsSync('public/music/song.mp3'),song:process.env.MUSIC_TITLE||'A little nostalgia',date:n=>new Date(n).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}),admin:!!req.session.admin};
 if(req.path.startsWith('/admin')||req.path.startsWith('/coupon/')||req.path.startsWith('/claim')) res.set('Cache-Control','no-store');
 if(req.path.startsWith('/admin')||req.path.startsWith('/coupon/')||req.path==='/claim/success')res.set('X-Robots-Tag','noindex, nofollow');
 if(req.method==='POST'&&req.body.csrf!==req.session.csrf) return res.status(403).send('Your session expired. Refresh the page and try again.');
 next();
});
const services=()=>db.prepare('SELECT * FROM services').all();
const offers=()=>db.prepare('SELECT * FROM offers WHERE active=1').all();
const stats=()=>({recent:db.prepare('SELECT count(*) n FROM leads WHERE created_at>=?').get(Date.now()-86400000).n,total:db.prepare('SELECT count(*) n FROM leads').get().n});
app.get('/',(req,res)=>res.render('home',{services:services()}));
app.get('/offers',(req,res)=>res.render('offers',{offers:offers()}));
function form(req,res,error='',status=200){res.status(status).render('claim',{services:services(),offers:offers(),settings:db.prepare('SELECT * FROM settings').get(),stats:stats(),selected:Number(req.query.offer||req.body?.offer||1),error});}
app.get('/claim',(req,res)=>form(req,res));
app.post('/claim',limit,(req,res)=>{
 const name=String(req.body.name||'').trim(),mobile=String(req.body.mobile||'').replace(/[\s+-]/g,'').replace(/^91(?=\d{10}$)/,''),service=String(req.body.service||''),timeframe=String(req.body.timeframe||'');
 if(name.length<2||name.length>80||! /^[6-9]\d{9}$/.test(mobile)||!['5','7','10'].includes(timeframe)||!services().some(x=>x.name===service)||req.body.consent!=='yes') return form(req,res,'Please enter your name, a valid Indian mobile number, service, visit timeframe and consent.',400);
 try{const token=claim(db,{name,mobile,service,timeframe,offer:Number(req.body.offer),whatsapp:true});req.session.newCoupon=token;req.session.lastCoupon=token;res.redirect('/claim/success');setImmediate(()=>whatsapp.processNext().catch(()=>console.error('WhatsApp queue processing failed')));}catch(e){form(req,res,e.message,409);}
});
const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
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
app.get('/coupon/:token/download',(req,res)=>{
 const l=db.prepare('SELECT * FROM leads WHERE token=?').get(req.params.token);if(!l)return res.sendStatus(404);
 const expiry=res.locals.date(l.expires_at);
 const status=l.used?'ALREADY REDEEMED':l.expires_at<Date.now()?'EXPIRED':'';
 const logo=res.locals.logo?`<image href="data:image/png;base64,${readLogo()}" x="440" y="25" width="120" height="80"/>`:'';
 res.type('image/svg+xml').attachment('raju-riyaz-coupon.svg').send(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="640" viewBox="0 0 1000 640"><defs><linearGradient id="gold"><stop stop-color="#f7e8bb"/><stop offset="1" stop-color="#cfaa5b"/></linearGradient></defs><rect width="1000" height="640" rx="30" fill="url(#gold)"/><rect x="22" y="22" width="956" height="596" rx="22" fill="none" stroke="#826223"/>${logo}<g text-anchor="middle" fill="#302617" font-family="Georgia,serif"><text x="500" y="140" font-size="35">RAJU RIYAZ UNISEX SALON</text><text x="500" y="205" font-size="22">A LITTLE LUXURY, JUST FOR YOU</text><text x="500" y="295" font-size="70">Up to ₹${l.discount} OFF</text><text x="500" y="355" font-size="27">${xml(l.name)}</text><text x="500" y="410" font-size="34">${xml(l.code)}</text><text x="500" y="455" font-size="21">Expires ${xml(expiry)} · Single use · Present at the salon</text><text x="500" y="485" font-size="18">${status}</text><text x="500" y="510" font-size="19">Daccapatty, Nagaon · 9126691868</text><text x="500" y="555" font-size="17">Eligible services only. Discount cannot exceed the bill. No cash value.</text><text x="500" y="585" font-size="17">Cannot be combined with other offers. Terms and conditions apply.</text></g></svg>`);
});
import {readFileSync} from 'node:fs';
const readLogo=()=>readFileSync('public/brand/logo.png').toString('base64');
const guard=(req,res,next)=>req.session.admin?next():res.redirect('/admin/login');
app.get('/admin/login',(req,res)=>res.render('login',{error:'',configured:!!process.env.ADMIN_PASSWORD}));
app.post('/admin/login',limit,(req,res)=>{
 const expected=process.env.ADMIN_PASSWORD;
 if(!expected||!timingSafeEqual(scryptSync(String(req.body.password||''),'salon-admin',64),scryptSync(expected,'salon-admin',64))) return res.status(401).render('login',{error:'Invalid password or admin access is not configured.',configured:!!expected});
 req.session.regenerate(e=>{if(e)return res.sendStatus(500);req.session.admin=true;req.session.csrf=randomBytes(24).toString('hex');req.session.save(()=>res.redirect('/admin'));});
});
app.post('/admin/logout',guard,(req,res)=>req.session.destroy(()=>res.redirect('/')));
app.get('/admin',guard,(req,res)=>{
 const q=String(req.query.q||'').slice(0,100),pattern='%'+q+'%';
 res.render('admin',{q,leads:db.prepare('SELECT l.*,w.status AS whatsapp_status,w.error AS whatsapp_error FROM leads l LEFT JOIN whatsapp_messages w ON w.lead_id=l.id WHERE l.name LIKE ? OR l.mobile LIKE ? OR l.code LIKE ? ORDER BY l.created_at DESC').all(pattern,pattern,pattern),services:services(),offers:db.prepare('SELECT * FROM offers').all(),settings:db.prepare('SELECT * FROM settings').get(),stats:stats(),whatsappConfigured:whatsapp.configured,error:req.query.error||''});
});
app.post('/admin/lead/:id',guard,(req,res)=>{db.prepare('UPDATE leads SET used=? WHERE id=?').run(req.body.used==='1'?1:0,Number(req.params.id));res.redirect('/admin');});
app.post('/admin/whatsapp/:id/retry',guard,(req,res)=>{
 db.prepare("UPDATE whatsapp_messages SET status='pending',attempts=0,next_attempt=0,error='' WHERE lead_id=? AND status='failed' AND lead_id IN (SELECT id FROM leads WHERE expires_at>?)").run(Number(req.params.id),Date.now());
 res.redirect('/admin');setImmediate(()=>whatsapp.processNext().catch(()=>console.error('WhatsApp queue processing failed')));
});
app.post('/admin/settings',guard,(req,res)=>{const d=Number(req.body.discount),v=Number(req.body.validity);if(!Number.isInteger(d)||d<1||d>200||!Number.isInteger(v)||v<1||v>90)return res.status(400).send('Discount must be ₹1–₹200 and validity 1–90 days.');db.prepare('UPDATE settings SET discount=?,validity=? WHERE id=1').run(d,v);res.redirect('/admin');});
app.post('/admin/service/:id',guard,(req,res)=>{const p=req.body.price===''?null:Number(req.body.price);if(p!==null&&(!Number.isInteger(p)||p<0||p>100000))return res.sendStatus(400);db.prepare('UPDATE services SET price=? WHERE id=?').run(p,Number(req.params.id));res.redirect('/admin');});
app.post('/admin/offer',guard,(req,res)=>{const title=String(req.body.title||'').trim(),description=String(req.body.description||'').trim(),active=req.body.active==='1'?1:0;if(!title||title.length>100||!description||description.length>600)return res.sendStatus(400);if(req.body.id)db.prepare('UPDATE offers SET title=?,description=?,active=? WHERE id=?').run(title,description,active,Number(req.body.id));else db.prepare('INSERT INTO offers(title,description,active) VALUES(?,?,?)').run(title,description,active);res.redirect('/admin');});
app.get('/admin/export',guard,(req,res)=>{
 const rows=db.prepare('SELECT name,mobile,service,timeframe,code,discount,created_at,expires_at,used FROM leads ORDER BY created_at DESC').all();
 const cell=v=>'"'+String(v).replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
 res.type('text/csv').attachment('salon-leads.csv').send(['name,mobile,service,visit_within_days,coupon,discount,created_at,expires_at,used',...rows.map(r=>Object.values(r).map(cell).join(','))].join('\r\n'));
});
app.get('/privacy',(req,res)=>res.render('privacy'));
app.use((err,req,res,next)=>{console.error(err.message);res.status(500).send('Something went wrong. Please try again or call 9126691868.');});
app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Salon server listening on port '+(process.env.PORT||3000)));
