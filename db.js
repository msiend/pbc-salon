import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
export function openDatabase(path) {
 mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
 const db = new DatabaseSync(path);
 chmodSync(path, 0o600);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS services(id INTEGER PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,price INTEGER);
 CREATE TABLE IF NOT EXISTS offers(id INTEGER PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),discount INTEGER NOT NULL,validity INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY,name TEXT NOT NULL,mobile TEXT NOT NULL,service TEXT NOT NULL,timeframe TEXT NOT NULL,offer_id INTEGER NOT NULL,code TEXT NOT NULL UNIQUE,token TEXT NOT NULL UNIQUE,discount INTEGER NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0,UNIQUE(mobile));
 CREATE TABLE IF NOT EXISTS whatsapp_messages(lead_id INTEGER PRIMARY KEY REFERENCES leads(id),status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,message_id TEXT,error TEXT NOT NULL DEFAULT '',accepted_at INTEGER);
 CREATE TABLE IF NOT EXISTS sessions(sid TEXT PRIMARY KEY,value TEXT NOT NULL,expires INTEGER NOT NULL);`);
 if(!db.prepare('SELECT id FROM settings').get()) {
 db.prepare('INSERT INTO settings VALUES(1,200,10)').run();
 const insert=db.prepare('INSERT INTO services(name,description) VALUES(?,?)');
 [['Hair styling','Cuts, styling and a fresh look, tailored to you.'],['Hair colour','A subtle refresh or a bold new shade.'],['Skin & facial care','A little care. A brighter, fresher feeling.'],['Grooming','Sharp details and a polished finish.'],['Bridal & occasion','Get ready for your moments in the spotlight.'],['Hair treatments','Personalised care for your hair.']].forEach(x=>insert.run(...x));
 db.prepare('INSERT INTO offers(title,description) VALUES(?,?)').run('Your first visit, a little more special','Claim up to ₹200 off an eligible service. Limited to the first 100 customers.');
 }
 return db;
}
export function claim(db,input) {
 db.exec('BEGIN IMMEDIATE');
 try {
 const offer=db.prepare('SELECT * FROM offers WHERE id=? AND active=1').get(input.offer);
 if(!offer) throw new Error('This offer is unavailable.');
 if(db.prepare('SELECT id FROM leads WHERE mobile=?').get(input.mobile)) throw new Error('This mobile number has already claimed a welcome coupon. Contact the salon to retrieve your coupon.');
 if(db.prepare('SELECT count(*) AS n FROM leads').get().n>=100) throw new Error('All 100 coupons have been claimed. Please check our other offers.');
 const settings=db.prepare('SELECT * FROM settings WHERE id=1').get();
 const now=Date.now(),token=randomBytes(24).toString('hex'),code='RR-'+randomBytes(5).toString('hex').toUpperCase();
 db.prepare('INSERT INTO leads(name,mobile,service,timeframe,offer_id,code,token,discount,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(input.name,input.mobile,input.service,input.timeframe,input.offer,code,token,settings.discount,now,now+settings.validity*86400000);
 if(input.whatsapp) db.prepare('INSERT INTO whatsapp_messages(lead_id) SELECT id FROM leads WHERE token=?').run(token);
 db.exec('COMMIT'); return token;
 } catch(e) { db.exec('ROLLBACK'); throw e; }
}
