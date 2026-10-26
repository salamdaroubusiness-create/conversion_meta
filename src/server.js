import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"200kb"}));
app.use(rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:true,legacyHeaders:false}));
const dbPath=process.env.DB_PATH || path.join(__dirname,"../data/gsc.sqlite");
import fs from "node:fs";
fs.mkdirSync(path.dirname(dbPath),{recursive:true});
const db=new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS leads(
 id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 name TEXT NOT NULL, phone TEXT DEFAULT '', offer TEXT DEFAULT '', amount REAL DEFAULT 0,
 status TEXT NOT NULL, next_follow TEXT, purchase_date TEXT, ctwa_clid TEXT, notes TEXT DEFAULT '',
 meta_status TEXT DEFAULT 'Non envoyé'
);
CREATE TABLE IF NOT EXISTS meta_events(
 id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, event_name TEXT NOT NULL,
 event_id TEXT UNIQUE NOT NULL, status TEXT NOT NULL, response TEXT, created_at TEXT NOT NULL,
 FOREIGN KEY(lead_id) REFERENCES leads(id)
);
`);
const email=process.env.ADMIN_EMAIL, password=process.env.ADMIN_PASSWORD;
if(!process.env.JWT_SECRET || process.env.JWT_SECRET.length<32) {
 console.error("ERREUR: définissez JWT_SECRET avec au moins 32 caractères dans .env"); process.exit(1);
}
if(email && password && !db.prepare("SELECT id FROM users WHERE email=?").get(email.toLowerCase())){
 const hash=bcrypt.hashSync(password,12);
 db.prepare("INSERT INTO users(email,password_hash,created_at) VALUES(?,?,?)").run(email.toLowerCase(),hash,new Date().toISOString());
 console.log("Compte administrateur initial créé pour",email);
}
const statuses=["Nouveau","Contact établi","Prospect qualifié","Proposition envoyée","Paiement en attente","Client payant","Non converti","À relancer"];
const now=()=>new Date().toISOString();
function auth(req,res,next){const h=req.headers.authorization||"";const t=h.startsWith("Bearer ")?h.slice(7):"";try{req.user=jwt.verify(t,process.env.JWT_SECRET);next()}catch{return res.status(401).json({error:"Connexion requise ou session expirée."})}}
function safeLead(row){return row}
app.post("/api/login",rateLimit({windowMs:15*60*1000,limit:12}),async(req,res)=>{
 const em=String(req.body.email||"").toLowerCase().trim(),pw=String(req.body.password||"");
 const u=db.prepare("SELECT * FROM users WHERE email=?").get(em);
 if(!u||!(await bcrypt.compare(pw,u.password_hash)))return res.status(401).json({error:"E-mail ou mot de passe incorrect."});
 res.json({token:jwt.sign({id:u.id,email:u.email},process.env.JWT_SECRET,{expiresIn:"8h"})});
});
app.get("/api/leads",auth,(req,res)=>res.json({leads:db.prepare("SELECT * FROM leads ORDER BY updated_at DESC").all()}));
app.post("/api/leads",auth,(req,res)=>{
 const b=req.body||{},name=String(b.name||"").trim(),status=String(b.status||"Nouveau");
 if(!name)return res.status(400).json({error:"Le nom est obligatoire."});
 if(!statuses.includes(status))return res.status(400).json({error:"Statut invalide."});
 const amount=Number(b.amount||0);if(!Number.isFinite(amount)||amount<0)return res.status(400).json({error:"Montant invalide."});
 if(status==="Client payant"&&(!b.purchase_date||amount<=0))return res.status(400).json({error:"Pour un client payant, renseignez le montant et la date de paiement confirmée."});
 const t=now();const r=db.prepare(`INSERT INTO leads(created_at,updated_at,name,phone,offer,amount,status,next_follow,purchase_date,ctwa_clid,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(t,t,name,String(b.phone||""),String(b.offer||""),amount,status,b.next_follow||null,b.purchase_date||null,b.ctwa_clid||null,String(b.notes||""));
 res.status(201).json({lead:db.prepare("SELECT * FROM leads WHERE id=?").get(r.lastInsertRowid)});
});
app.put("/api/leads/:id",auth,(req,res)=>{
 const id=Number(req.params.id),old=db.prepare("SELECT * FROM leads WHERE id=?").get(id);if(!old)return res.status(404).json({error:"Prospect introuvable."});
 const b=req.body||{},name=String(b.name??old.name).trim(),status=String(b.status??old.status),amount=Number(b.amount??old.amount);
 if(!name||!statuses.includes(status)||!Number.isFinite(amount)||amount<0)return res.status(400).json({error:"Données invalides."});
 const purchase=b.purchase_date??old.purchase_date;
 if(status==="Client payant"&&(!purchase||amount<=0))return res.status(400).json({error:"Un paiement confirmé doit avoir une date et un montant supérieur à zéro."});
 db.prepare(`UPDATE leads SET updated_at=?,name=?,phone=?,offer=?,amount=?,status=?,next_follow=?,purchase_date=?,ctwa_clid=?,notes=? WHERE id=?`).run(now(),name,String(b.phone??old.phone),String(b.offer??old.offer),amount,status,b.next_follow??old.next_follow,purchase,b.ctwa_clid??old.ctwa_clid,String(b.notes??old.notes),id);
 res.json({lead:db.prepare("SELECT * FROM leads WHERE id=?").get(id)});
});
app.delete("/api/leads/:id",auth,(req,res)=>{
 const id=Number(req.params.id);db.prepare("DELETE FROM meta_events WHERE lead_id=?").run(id);const r=db.prepare("DELETE FROM leads WHERE id=?").run(id);if(!r.changes)return res.status(404).json({error:"Prospect introuvable."});res.json({ok:true});
});
app.get("/api/backup",auth,(req,res)=>res.json({exported_at:now(),leads:db.prepare("SELECT * FROM leads").all(),meta_events:db.prepare("SELECT * FROM meta_events").all()}));
app.post("/api/change-password",auth,async(req,res)=>{
 const old=String(req.body.oldPassword||""),next=String(req.body.newPassword||"");
 if(next.length<12)return res.status(400).json({error:"Le nouveau mot de passe doit contenir au moins 12 caractères."});
 const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);if(!u||!(await bcrypt.compare(old,u.password_hash)))return res.status(400).json({error:"Mot de passe actuel incorrect."});
 db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(await bcrypt.hash(next,12),u.id);res.json({ok:true});
});
app.get("/api/meta/status",auth,(req,res)=>res.json({configured:Boolean(process.env.META_ACCESS_TOKEN&&process.env.META_DATASET_ID&&process.env.META_WABA_ID&&process.env.META_API_VERSION),dataset_configured:Boolean(process.env.META_DATASET_ID),waba_configured:Boolean(process.env.META_WABA_ID),ctwa_capture:"Requires WhatsApp Business Platform webhook"}));
app.post("/api/leads/:id/meta-event",auth,async(req,res)=>{
 const id=Number(req.params.id),lead=db.prepare("SELECT * FROM leads WHERE id=?").get(id);
 if(!lead)return res.status(404).json({error:"Prospect introuvable."});
 const name=String(req.body.event_name||"");
 if(!["QualifiedLead","Purchase"].includes(name))return res.status(400).json({error:"Événement non autorisé."});
 if(name==="QualifiedLead"&&lead.status!=="Prospect qualifié"&&lead.status!=="Client payant")return res.status(400).json({error:"Le prospect doit être qualifié avant cet événement."});
 if(name==="Purchase"&&(lead.status!=="Client payant"||!lead.purchase_date||Number(lead.amount)<=0))return res.status(400).json({error:"Purchase exige un statut Client payant, une date et un montant confirmé."});
 if(!lead.ctwa_clid)return res.status(400).json({error:"CTWA_CLID manquant. Récupérez-le via le webhook WhatsApp Business Platform avant l'attribution Click-to-WhatsApp."});
 const previous=db.prepare("SELECT id,status FROM meta_events WHERE lead_id=? AND event_name=? AND status='accepted'").get(id,name);
 if(previous)return res.status(409).json({error:"Cet événement a déjà été accepté pour cette fiche; aucun doublon envoyé."});
 const {META_ACCESS_TOKEN,META_DATASET_ID,META_WABA_ID,META_API_VERSION}=process.env;
 if(!META_ACCESS_TOKEN||!META_DATASET_ID||!META_WABA_ID||!META_API_VERSION)return res.status(503).json({error:"Conversions API non configurée sur le serveur. Configurez les variables META_* dans .env."});
 const eventId=crypto.randomUUID(),eventTime=name==="Purchase"?Math.floor(new Date(lead.purchase_date+"T12:00:00Z").getTime()/1000):Math.floor(Date.now()/1000);
 const event={event_name:name,event_time:eventTime,event_id:eventId,action_source:"business_messaging",messaging_channel:"whatsapp",user_data:{whatsapp_business_account_id:String(META_WABA_ID),ctwa_clid:lead.ctwa_clid}};
 if(name==="Purchase")event.custom_data={currency:"XOF",value:Number(lead.amount)};
 db.prepare("INSERT INTO meta_events(lead_id,event_name,event_id,status,created_at) VALUES(?,?,?,?,?)").run(id,name,eventId,"pending",now());
 const url=`https://graph.facebook.com/${encodeURIComponent(META_API_VERSION)}/${encodeURIComponent(META_DATASET_ID)}/events?access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`;
 try{
  const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({data:[event]})});
  const body=await response.json().catch(()=>({}));
  const accepted=response.ok&&!body.error&&Number(body.events_received||0)>0;
  db.prepare("UPDATE meta_events SET status=?,response=? WHERE event_id=?").run(accepted?"accepted":"error",JSON.stringify(body).slice(0,4000),eventId);
  db.prepare("UPDATE leads SET meta_status=?,updated_at=? WHERE id=?").run(accepted?name+" accepté par Meta":"Erreur Meta — voir journal",now(),id);
  if(!accepted)return res.status(502).json({error:"Meta n'a pas confirmé l'événement.",details:body});
  res.json({ok:true,event_name:name,event_id:eventId,meta_response:body});
 }catch(err){
  db.prepare("UPDATE meta_events SET status='error',response=? WHERE event_id=?").run(String(err).slice(0,1000),eventId);
  res.status(502).json({error:"Erreur réseau lors de l'envoi à Meta."});
 }
});
app.get("/api/health",(req,res)=>res.json({ok:true,service:"gsc-crm",time:now()}));
app.use(express.static(path.join(__dirname,"../public")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"../public/index.html")));
const port=Number(process.env.PORT||3000);
app.listen(port,"0.0.0.0",()=>console.log(`GSC CRM disponible sur http://localhost:${port}`));
