// Day-Trader Bot. Läuft auf dem Handy (Termux), einem Raspberry Pi, einem Server oder als Backup auf GitHub.
// Rechnet nur mit echten Kursen (Yahoo 5-Minuten-Kerzen, Finnhub live für US), schreibt Ergebnisse in den Zweig „daten“
// (day.json, zeiten.json, faelle.json, log.json, tage.json) und schickt Telegram-Meldungen. Keine Anlageberatung.
import fs from "node:fs";
import {execSync} from "node:child_process";
import K from "../kern.js";
import {verschluesseln,entschluesseln} from "./krypto.mjs";

const E=process.env,ROOT=E.ROOT||process.cwd(),WER=E.WER||"github",DRY=E.DRY==="1",FIX=E.FIXTURE||"";
const TG=E.TELEGRAM_TOKEN||"",FH=E.FINNHUB_KEY||"",PASS=E.SYNC_PASSWORD||"",API=E.ANTHROPIC_API_KEY||"";
let CHAT=String(E.TELEGRAM_CHAT||"");
const REPO=E.GITHUB_REPOSITORY||E.REPO||"timaxGg/Day-dr72818";
const APP=(E.APP_URL||`https://${REPO.split("/")[0].toLowerCase()}.github.io/${REPO.split("/")[1]}/`).replace(/\/?$/,"/");
const LAUF_MIN=+(E.LAUF_MIN||(WER==="github"?330:360)); // GitHub: höchstens 5,5 Std. am Stück; Handy/Server: alle 6 Std. kurz neu starten (holt dabei Updates)
const P=f=>`${ROOT}/${f}`,SF=P(".state/stand.json"),OUT=P(".state/out");
const log=(...a)=>console.log(new Date().toLocaleTimeString("de-DE",{timeZone:"Europe/Berlin"}),...a);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const readJSON=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch(e){return d}};
const writeJSON=(f,o)=>{fs.mkdirSync(f.replace(/\/[^/]*$/,""),{recursive:true});fs.writeFileSync(f,JSON.stringify(o))};
const esc=s=>String(s??"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
const nf=(v,d=2)=>(+v).toLocaleString("de-DE",{minimumFractionDigits:d,maximumFractionDigits:d});
const pz=(v,d=1)=>v==null||!isFinite(v)?"–":(v>0?"+":v<0?"−":"±")+nf(Math.abs(v),d)+" %";
const eu=v=>(v>0?"+":v<0?"−":"")+nf(Math.abs(v))+" €";
const uhr=t=>new Date(t).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Berlin"});

/* ---------- Aktien ---------- */
const US=[["AAPL","Apple"],["MSFT","Microsoft"],["NVDA","Nvidia"],["AMZN","Amazon"],["GOOGL","Alphabet"],["META","Meta"],["TSLA","Tesla"],["AVGO","Broadcom"],["AMD","AMD"],["NFLX","Netflix"],
 ["JPM","JPMorgan"],["V","Visa"],["MA","Mastercard"],["XOM","Exxon Mobil"],["LLY","Eli Lilly"],["UNH","UnitedHealth"],["COST","Costco"],["WMT","Walmart"],["ORCL","Oracle"],["CRM","Salesforce"],
 ["ADBE","Adobe"],["INTC","Intel"],["QCOM","Qualcomm"],["MU","Micron"],["AMAT","Applied Materials"],["PLTR","Palantir"],["UBER","Uber"],["COIN","Coinbase"],["MSTR","Strategy"],["BA","Boeing"],
 ["GS","Goldman Sachs"],["BAC","Bank of America"],["DIS","Disney"],["PYPL","PayPal"],["SMCI","Super Micro"],["ARM","Arm"],["PANW","Palo Alto"],["CRWD","CrowdStrike"],["SHOP","Shopify"],["QQQ","Nasdaq 100 ETF"],
 ["TTWO","Take-Two"],["ASML","ASML"],["NBIS","Nebius"],["TSM","TSMC"],["MRVL","Marvell"],["LRCX","Lam Research"],["KLAC","KLA"],["TXN","Texas Instruments"],["ANET","Arista"],["CSCO","Cisco"],
 ["IBM","IBM"],["NOW","ServiceNow"],["INTU","Intuit"],["DELL","Dell"],["APP","AppLovin"],["HOOD","Robinhood"],["SOFI","SoFi"],["RKLB","Rocket Lab"],["IONQ","IonQ"],["RIVN","Rivian"],
 ["ABNB","Airbnb"],["DDOG","Datadog"],["NET","Cloudflare"],["ZS","Zscaler"],["TTD","Trade Desk"],["SPOT","Spotify"],["RDDT","Reddit"],["SNOW","Snowflake"],["MARA","MARA Holdings"],["RIOT","Riot Platforms"],
 ["BABA","Alibaba"],["NKE","Nike"],["SBUX","Starbucks"],["MCD","McDonald's"],["KO","Coca-Cola"],["PEP","PepsiCo"],["PFE","Pfizer"],["CVX","Chevron"],["F","Ford"],["GM","General Motors"]];
const DE=[["SAP.DE","SAP"],["SIE.DE","Siemens"],["ALV.DE","Allianz"],["DTE.DE","Deutsche Telekom"],["AIR.DE","Airbus"],["RHM.DE","Rheinmetall"],["MUV2.DE","Münchener Rück"],["IFX.DE","Infineon"],
 ["BMW.DE","BMW"],["MBG.DE","Mercedes-Benz"],["VOW3.DE","Volkswagen"],["BAS.DE","BASF"],["BAYN.DE","Bayer"],["DBK.DE","Deutsche Bank"],["CBK.DE","Commerzbank"],["ADS.DE","Adidas"],["DHL.DE","DHL Group"],
 ["ENR.DE","Siemens Energy"],["MTX.DE","MTU Aero"],["DB1.DE","Deutsche Börse"],["HNR1.DE","Hannover Rück"],["CON.DE","Continental"],["HEI.DE","Heidelberg Materials"],["BEI.DE","Beiersdorf"],
 ["FRE.DE","Fresenius"],["MRK.DE","Merck KGaA"],["SY1.DE","Symrise"],["ZAL.DE","Zalando"],["SHL.DE","Siemens Healthineers"],["P911.DE","Porsche AG"],["EOAN.DE","E.ON"],["RWE.DE","RWE"],
 ["VNA.DE","Vonovia"],["HEN3.DE","Henkel"],["QIA.DE","Qiagen"],["DTG.DE","Daimler Truck"],["BNR.DE","Brenntag"],["G1A.DE","GEA"],["PAH3.DE","Porsche SE"],["SRT3.DE","Sartorius"],
 ["ASML.AS","ASML (Amsterdam)"],["ADYEN.AS","Adyen"],["INGA.AS","ING"],["PHIA.AS","Philips"],["SHELL.AS","Shell"],["PRX.AS","Prosus"],
 ["MC.PA","LVMH"],["OR.PA","L'Oréal"],["RMS.PA","Hermès"],["TTE.PA","TotalEnergies"],["SAN.PA","Sanofi"],["SU.PA","Schneider Electric"],["BNP.PA","BNP Paribas"],["SAF.PA","Safran"],["AI.PA","Air Liquide"],
 ["RACE.MI","Ferrari"],["UCG.MI","UniCredit"],["ISP.MI","Intesa Sanpaolo"],["ENEL.MI","Enel"],["STLAM.MI","Stellantis"],
 ["SAN.MC","Santander"],["ITX.MC","Inditex"],["IBE.MC","Iberdrola"],["BBVA.MC","BBVA"],
 ["NESN.SW","Nestlé"],["NOVN.SW","Novartis"],["UBSG.SW","UBS"],["NOVO-B.CO","Novo Nordisk"],["NOKIA.HE","Nokia"],["ERIC-B.ST","Ericsson"]];
const MARKT={us:{tz:"America/New_York",auf:570,zu:960,ref:"SPY",liste:US,cur:"USD"},de:{tz:"Europe/Berlin",auf:540,zu:1050,ref:"^GDAXI",liste:DE,cur:"EUR"}};
const NAME=Object.fromEntries([...US,...DE]),MVON=s=>/\.[A-Z]{1,3}$/.test(s)?"de":"us"; // „de“ = alle europäischen Börsen (9:00–17:30 Uhr)
const REPLAY=["ASML","ASML.AS","TTWO","NBIS","NVDA","TSLA","AMD","AAPL","META","MSFT","AMZN","PLTR","COIN","MSTR","SMCI","NFLX","AVGO","GOOGL","QQQ","SAP.DE","RHM.DE","SIE.DE","IFX.DE","ALV.DE","DBK.DE","ENR.DE","AIR.DE","MBG.DE","BMW.DE","DTE.DE","ZAL.DE","CBK.DE","BAYN.DE","ADS.DE"];

/* ---------- Eigene Aktien aus der App (+ Aktie hinzufügen) ---------- */
// Die App schickt Suchbegriffe (Name, Kürzel oder ISIN der Aktie). Der Bot sucht das passende Yahoo-Kürzel und nimmt die Aktie in Statistik und Suche auf.
const EXTRA=()=>Object.values(S.extra||{}).filter(x=>x.s);
const liste=m=>[...MARKT[m].liste.map(x=>x[0]),...EXTRA().filter(x=>x.m===m&&!MARKT[m].liste.some(y=>y[0]===x.s)).map(x=>x.s)];
async function aufloesen(q){const z=String(q).trim();if(!z)return null;
  try{const j=await holen(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(z)}&quotesCount=8&newsCount=0`);
    const qs=((j&&j.quotes)||[]).filter(x=>["EQUITY","ETF"].includes(x.quoteType)&&x.symbol);
    const gut=qs.find(x=>!/\./.test(x.symbol))||qs.find(x=>/\.(DE|AS|PA|MI|MC|SW|CO|HE|ST)$/.test(x.symbol))||qs[0];if(!gut)return {q:z,fehler:"nichts gefunden"};
    const r=await yahoo(gut.symbol,"5d");if(r.B.c.length<50)return {q:z,fehler:"zu wenig Kurse"};
    return {q:z,s:gut.symbol,n:gut.shortname||gut.longname||gut.symbol,m:MVON(gut.symbol),cur:r.cur}}catch(e){return {q:z,fehler:e.message}}}
async function extrasPruefen(){const wunsch=Array.isArray(EINST.extra)?EINST.extra.slice(0,30):[];S.extra=S.extra||{};let neu=[];
  for(const q of wunsch){if(S.extra[q])continue;const r=await aufloesen(q);if(r){S.extra[q]=r;if(r.s){NAME[r.s]=r.n;neu.push(r.s)}}}
  for(const q of Object.keys(S.extra))if(!wunsch.includes(q))delete S.extra[q];
  for(const x of EXTRA())NAME[x.s]=NAME[x.s]||x.n;
  D.extra=Object.values(S.extra).map(x=>({q:x.q,s:x.s||null,n:x.n||null,fehler:x.fehler||null}));
  for(const s of neu){try{await symbolStatistik(s);protokoll("info",s,`Aktie hinzugefügt: ${NAME[s]} (${s})`)}catch(e){fehler("extra",`${s}: ${e.message}`)}}
  if(neu.length)geaendert=true}

/* ---------- Zeit ---------- */
function zeit(tz,d=new Date()){const p=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",weekday:"short",hourCycle:"h23"}).formatToParts(d),g=k=>(p.find(x=>x.type===k)||{}).value;
  return {date:`${g("year")}-${g("month")}-${g("day")}`,min:+g("hour")*60+ +g("minute"),wd:g("weekday")}}
const handelstag=m=>E.TEST_OFFEN?true:!["Sat","Sun"].includes(zeit(MARKT[m].tz).wd);
const offen=(m,vor=0,nach=0)=>{if(E.TEST_OFFEN)return true;const z=zeit(MARKT[m].tz);return handelstag(m)&&z.min>=MARKT[m].auf-vor&&z.min<MARKT[m].zu+nach};
function schlussMs(m){const z=zeit(MARKT[m].tz);return Date.now()+(MARKT[m].zu-z.min)*6e4}

/* ---------- Daten holen ---------- */
async function holen(url,opt={}){if(FIX){const f=`${FIX}/${url.replace(/[^a-z0-9]+/gi,"_").slice(-150)}.json`;if(fs.existsSync(f))return JSON.parse(fs.readFileSync(f,"utf8"));throw new Error("Testdatei fehlt: "+f)}
  const r=await fetch(url,Object.assign({headers:{"user-agent":"Mozilla/5.0 (compatible; DayTrader/1.0)"}},opt));if(!r.ok){const e=new Error(`HTTP ${r.status}`);e.status=r.status;throw e}
  const t=await r.text();try{return JSON.parse(t)}catch(e){return t}}
// Yahoo: reguläre Handelszeit, Kerzen ohne Lücken; Zeit in Sekunden
async function yahoo(s,range,interval="5m"){const j=await holen(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=${range}&interval=${interval}`);
  const res=j&&j.chart&&j.chart.result&&j.chart.result[0];if(!res||!res.timestamp)throw new Error("keine Kurse für "+s);const q=(res.indicators.quote||[])[0]||{},m=res.meta||{},B={t:[],o:[],h:[],l:[],c:[],v:[]};
  for(let i=0;i<res.timestamp.length;i++){const o=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];if([o,h,l,c].some(v=>v==null||!(v>0)))continue;B.t.push(res.timestamp[i]);B.o.push(o);B.h.push(h);B.l.push(l);B.c.push(c);B.v.push(q.volume&&q.volume[i]||0)}
  return {B,p:m.regularMarketPrice,mt:(m.regularMarketTime||0)*1000,vor:m.chartPreviousClose??m.previousClose,cur:m.currency}}
async function finnhub(path){if(!FH)throw new Error("FINNHUB_KEY fehlt");return holen(`https://finnhub.io/api/v1/${path}${path.includes("?")?"&":"?"}token=${FH}`)}
async function parallel(liste,n,f){let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<liste.length){const x=liste[i++];try{await f(x)}catch(e){fehler("daten",`${x}: ${e.message}`);if(e.status===429)await sleep(5000)}}}))}

/* ---------- Zustand ---------- */
let S=Object.assign({offset:0,stat:{},statSym:{},dip:{},statTag:"",gesendet:{},posSt:{},bilanz:[],log:[],faelleLive:[],fehler:{},ausfall:[],letzt:0,news:{},zahlen:{d:"",s:[]},sigTag:{}},readJSON(SF,{}));
let D={t:0,wer:WER,markt:{},kurse:{},signale:[],setups:{},bilanz:[],fehler:{}},V={},Z=null,FAELLE=[],TAGE={},LIVE={},POS={pos:[],einst:{}},EINST=null,geaendert=true;
const STD={modus:"ko",faktor:10,spreadZ:.4,spreadA:.1,gebuehr:1,einsatz:500,steuer:26.375,T:1,S:1,minP:50,minT:2};EINST=Object.assign({},STD);
function fehler(art,txt){S.fehler[art]={t:Date.now(),txt:String(txt).slice(0,160)};log("Fehler",art,txt)}
function protokoll(typ,s,text,daten){S.log.push({t:Date.now(),typ,s,text,daten:daten||{}});if(S.log.length>1500)S.log=S.log.slice(-1200);geaendert=true}
const sichern=()=>writeJSON(SF,S);

/* ---------- Telegram ---------- */
async function tg(method,body){if(!TG||DRY)return null;try{const r=await fetch(`https://api.telegram.org/bot${TG}/${method}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(((body&&body.timeout)||0)*1000+20000)});return await r.json()}catch(e){fehler("telegram",`${e.message}${e.cause&&e.cause.code?" ("+e.cause.code+")":""}`);return null}}
async function senden(text,o={}){if(!CHAT){log("(kein Chat)",WER==="test"?text:text.slice(0,80));return}
  const body={chat_id:CHAT,text:text.slice(0,4000),parse_mode:"HTML",disable_web_page_preview:true};if(o.knopf)body.reply_markup={inline_keyboard:[[{text:o.knopf[0],url:o.knopf[1]}]]};
  const r=await tg("sendMessage",body);if(r&&!r.ok)fehler("telegram",r.description)}
async function telegramEingang(warte){if(!TG)return sleep(warte*1000);const r=await tg("getUpdates",{offset:S.offset,timeout:warte,allowed_updates:["message"]});
  if(!r||!r.ok){if(r&&r.error_code===409)log("Telegram: anderer Bot-Lauf aktiv");else if(r&&r.error_code===401)fehler("telegram","TELEGRAM_TOKEN ist falsch (401)");else if(r)fehler("telegram",`${r.error_code}: ${r.description}`);await sleep(2000);return}
  delete S.fehler.telegram; // Verbindung klappt wieder → alte Meldung weg
  for(const u of r.result||[]){S.offset=u.update_id+1;const m=u.message;if(!m||!m.text)continue;const chat=String(m.chat.id);
    if(!CHAT){await tg("sendMessage",{chat_id:chat,parse_mode:"HTML",text:`👋 Hallo! Deine Chat-ID ist:\n\n<code>${chat}</code>\n\nTrag sie bei GitHub als Secret <b>TELEGRAM_CHAT</b> ein (und auf dem Handy in der Datei .env). Danach schreibe ich dir.`});continue}
    if(chat!==CHAT){fehler("telegram",`Nachricht von Chat ${chat}, eingetragen ist TELEGRAM_CHAT=${CHAT} – stimmt die Chat-ID?`);continue}await befehl(m.text.trim().split(/\s+/)[0].toLowerCase().replace(/@.*/,""))}}
async function befehl(c){const jetzt=Date.now();log("Telegram-Befehl",c);
  if(c==="/start"||c==="/hilfe")return senden(`🤖 <b>Day-Trader Bot</b>\n/jetzt – aktuelle Einstiege\n/meine – deine offenen Trades\n/status – läuft alles?\n\nEilige Meldungen kommen mit 🚨.`,{knopf:["App öffnen",APP]});
  if(c==="/jetzt"){const l=D.signale.filter(x=>x.bis>jetzt).map(x=>({x,b:K.bewerte(EINST,x,EINST.T,EINST.S,hebel())})).filter(o=>o.b).sort((a,b)=>b.b.eEv-a.b.eEv).slice(0,6);
    return senden(l.length?`📋 <b>Aktive Einstiege</b>\n`+l.map(o=>`${o.b.ev>0&&o.b.t>=2?"🟢":o.b.ev>0?"🟡":"⚪"} <b>${esc(o.x.n)}</b> ${o.x.dir==="short"?"SHORT ↘":"LONG ↗"} · Gewinn-Chance ${Math.round(o.b.pPlus*100)} % · bis ${uhr(o.x.bis)} · Ø ${eu(o.b.eEv)}`).join("\n"):"Gerade kein Einstieg. Ich melde mich, sobald einer kommt.",{knopf:["App öffnen",APP]})}
  if(c==="/meine"){const l=POS.pos.map(x=>({x,s:S.posSt[x.id]})).filter(o=>o.s);return senden(l.length?`📈 <b>Deine Trades</b>\n`+l.map(o=>`${o.x.ueb?"🧪 ":""}<b>${esc(o.x.n)}</b> ${eu(o.s.net)} · ${TUN[o.s.st][1]}`).join("\n"):"Keine offenen Trades.",{knopf:["App öffnen",APP+"#meine"]})}
  if(c==="/status"){const f=Object.entries(S.fehler).filter(([,v])=>jetzt-v.t<36e5);return senden(`ℹ️ <b>Status</b>\nLäuft auf: ${WER}\nKurse: ${D.t?uhr(D.t):"noch keine"}\nStatistik: ${S.statTag||"noch keine"}\nTrades überwacht: ${POS.pos.length}${f.length?"\n\n⚠️ "+f.map(([k,v])=>`${k}: ${esc(v.txt)}`).join("\n⚠️ "):"\nKeine Fehler."}`)}
  return senden("Unbekannter Befehl. /hilfe zeigt alle.")}

/* ---------- Statistik aus den letzten 60 Handelstagen (einmal pro Tag) ---------- */
async function tagesStatistik(){const t0=Date.now();log("Tagesstatistik startet");const PR={},RP={},MK={};
  for(const m of ["us","de"]){const M=MARKT[m];
    try{const r=await yahoo(M.ref,"60d");RP[m]=K.prep(r.B,M.tz);MK[m]=K.marktKarte(RP[m])}catch(e){fehler("index",`${M.ref}: ${e.message}`)}
    await parallel(liste(m),4,async s=>{const r=await yahoo(s,"60d");if(r.B.c.length<500)throw new Error("zu wenige Kerzen");PR[s]=K.prep(r.B,M.tz);PR[s].m=m;PR[s].cur=r.cur})}
  const stat={},statSym={},events={},slot={us:{long:[],short:[]},de:{long:[],short:[]}},slotSym={long:{},short:{}},nach={},faelle=[],ab=Date.now()/1000-30*86400;
  const sl=(arr,k)=>arr[k]||(arr[k]=Array.from({length:K.NG},()=>[0,0]));
  for(const [s,Pr] of Object.entries(PR)){const m=Pr.m;for(let i=0;i<Pr.n-1;i++){const x=K.merkmale(Pr,i,MK[m]);if(!x||x.rest<30)continue;const k=Math.floor(x.min/30);
    for(const d of [1,-1]){const a=K.ausgang(Pr,i,d);if(!a)continue;const dir=d>0?"long":"short",S1=sl(slot[m][dir],k),S2=sl(slotSym[dir][s]||(slotSym[dir][s]=[]),k);
      for(let g=0;g<K.NG;g++){const w=a.r[g][0]>0?1:0;S1[g][0]++;S1[g][1]+=w;S2[g][0]++;S2[g][1]+=w}
      const ctx=x.schnell>=.6?"1":x.schnell<=-.6?"-1":null;if(ctx&&x.min>=15){const N=nach[m]||(nach[m]={}),C=N[ctx]||(N[ctx]={}),st=C[dir]||(C[dir]=K.leer());K.zaehle(st,a)}
      for(const key of K.muster(x).filter(k=>k.startsWith(dir))){K.zaehle(stat[key]||(stat[key]=K.leer()),a);const ss=statSym[s]||(statSym[s]={});K.zaehle(ss[key]||(ss[key]=K.leer()),a);
        (events[key]||(events[key]=[])).push({s,i,a});if(Pr.B.t[i]>=ab)faelle.push(K.fallAus(s,Pr.B.t[i]*1000,key,x,a))}}}}
  // Dip je Muster und Ziel/Stop
  const dip={};for(const [key,l] of Object.entries(events)){const d=key.startsWith("short")?-1:1;dip[key]=[];for(const T of K.GT)for(const S of K.GS)dip[key].push(K.dipStat(PR,l,d,T,S))}
  S.stat=Object.fromEntries(Object.entries(stat).map(([k,v])=>[k,K.kompakt(v)]));S.statSym=Object.fromEntries(Object.entries(statSym).map(([s,o])=>[s,Object.fromEntries(Object.entries(o).map(([k,v])=>[k,K.kompakt(v)]))]));S.dip=dip;
  // Zeitfenster-Beschriftung in deutscher Zeit (aus dem letzten Handelstag)
  const slots={};for(const m of ["us","de"]){const Pr=Object.values(PR).find(x=>x.m===m);if(!Pr){slots[m]=[];continue}const i0=Pr.ds[Pr.n-1],b=K.minutenVon(Pr.B.t[i0],"Europe/Berlin");
    slots[m]=Array.from({length:Math.ceil((MARKT[m].zu-MARKT[m].auf)/30)},(_,k)=>{const v=b+k*30;return `${String(Math.floor(v/60)).padStart(2,"0")}:${String(v%60).padStart(2,"0")}`})}
  const nachAus={};for(const [m,o] of Object.entries(nach))for(const [ctx,C] of Object.entries(o))for(const [dir,st] of Object.entries(C)){const w=K.wahrsch(null,K.kompakt(st),0);((nachAus[m]||(nachAus[m]={}))[ctx]||(nachAus[m][ctx]={}))[dir]={p:w.p,pt:w.pt,to:w.to,min:w.min,n:st[0][0]}}
  const symKomp=o=>Object.fromEntries(Object.entries(o).map(([s,arr])=>[s,arr.map(z=>z.map(c=>[c[0],c[1]]))]));
  Z={d:zeit("Europe/Berlin").date,slots,markt:{us:slot.us.long,de:slot.de.long},sym:symKomp(slotSym.long),short:{markt:{us:slot.us.short,de:slot.de.short},sym:symKomp(slotSym.short)},nach:nachAus,
     muster:Object.fromEntries(K.MKEYS.map(k=>[k,{n:K.MUSTER[k].n,t:K.MUSTER[k].t}])),
     stat:S.stat,statSym:Object.fromEntries(REPLAY.filter(s=>S.statSym[s]).map(s=>[s,S.statSym[s]]))}; // für die Übung mit echten Tagen
  FAELLE=faelle.slice(-6000);
  // Echte vergangene Tage für die Übung (Zeitreise): die letzten 3 Handelstage der beliebtesten Aktien, plus Vortag für die Linien
  TAGE={};for(const s of [...REPLAY,"SPY","^GDAXI"]){const Pr=PR[s]||(s==="SPY"?RP.us:s==="^GDAXI"?RP.de:null);if(!Pr)continue;const tage=[...new Set(Pr.tag)].slice(-4),a=Pr.tag.indexOf(tage[0]),B=Pr.B,r=v=>+v.toFixed(v>=100?2:3);
    TAGE[s]={m:MVON(s),n:NAME[s]||s,tage:tage.slice(1),t:B.t.slice(a),o:B.o.slice(a).map(r),h:B.h.slice(a).map(r),l:B.l.slice(a).map(r),c:B.c.slice(a).map(r),v:B.v.slice(a)}}
  S.statTag=zeit("Europe/Berlin").date;writeJSON(P(".state/zeiten.json"),Z);writeJSON(P(".state/faelle.json"),FAELLE);writeJSON(P(".state/tage.json"),TAGE);
  protokoll("info","",`Statistik neu berechnet: ${Object.keys(PR).length} Aktien, ${faelle.length} Fälle`,{Dauer:Math.round((Date.now()-t0)/1000)+" s"});log("Tagesstatistik fertig",Object.keys(PR).length,"Aktien",Math.round((Date.now()-t0)/1000),"s");geaendert=true}

// Statistik für eine einzelne neu hinzugefügte Aktie (die Gesamt-Statistik aller Muster bleibt, nur die eigenen Werte dieser Aktie kommen dazu)
async function symbolStatistik(s){const m=MVON(s),M=MARKT[m],r=await yahoo(s,"60d"),rr=await yahoo(M.ref,"60d");if(r.B.c.length<300)throw new Error("zu wenige Kerzen");
  const Pr=K.prep(r.B,M.tz),MK=K.marktKarte(K.prep(rr.B,M.tz)),own={},sl={long:[],short:[]};
  for(let i=0;i<Pr.n-1;i++){const x=K.merkmale(Pr,i,MK);if(!x||x.rest<30)continue;const k=Math.floor(x.min/30);
    for(const d of [1,-1]){const a=K.ausgang(Pr,i,d);if(!a)continue;const dir=d>0?"long":"short",S2=sl[dir][k]||(sl[dir][k]=Array.from({length:K.NG},()=>[0,0]));
      for(let g=0;g<K.NG;g++){S2[g][0]++;S2[g][1]+=a.r[g][0]>0?1:0}
      for(const key of K.muster(x).filter(q=>q.startsWith(dir)))K.zaehle(own[key]||(own[key]=K.leer()),a)}}
  S.statSym[s]=Object.fromEntries(Object.entries(own).map(([k,v])=>[k,K.kompakt(v)]));
  if(Z){Z.sym[s]=sl.long;Z.short.sym[s]=sl.short;writeJSON(P(".state/zeiten.json"),Z)}}

/* ---------- Nachrichten und Quartalszahlen ---------- */
const GUT=/\b(beat|beats|raise[sd]?|upgrade[sd]?|record|surge[sd]?|jump[sd]?|soar|strong|buyback|approval|wins?|übertrifft|hebt|anhebt|rekord|kaufempfehlung|hochgestuft|steigt|gewinnt|auftrag)\b/i;
const SCHLECHT=/\b(miss(es|ed)?|cut[s]?|downgrade[sd]?|lawsuit|probe|investigation|recall|plunge[sd]?|fall[s]?|weak|warns?|warning|fraud|senkt|gesenkt|abgestuft|warnt|klage|ermittlung|rückruf|bricht ein|verlust|schwach)\b/i;
async function nachrichten(s){const alt=S.news[s];if(alt&&Date.now()-alt.t<20*6e4)return alt;let list=[];
  try{if(MVON(s)==="us"&&FH){const bis=new Date().toISOString().slice(0,10),von=new Date(Date.now()-2*864e5).toISOString().slice(0,10);const j=await finnhub(`company-news?symbol=${encodeURIComponent(s)}&from=${von}&to=${bis}`);
      list=(Array.isArray(j)?j:[]).slice(0,6).map(n=>({t:n.headline,u:n.url,q:n.source,ts:n.datetime*1000}))}
    else{const x=await holen(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(s)}&region=DE&lang=de-DE`);if(typeof x==="string")list=[...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,6).map(m=>{const g=t=>((m[1].match(new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`))||[])[1]||"").trim();return {t:g("title"),u:g("link"),q:"Yahoo",ts:Date.parse(g("pubDate"))||0}}).filter(n=>n.t)}}
  catch(e){fehler("nachrichten",`${s}: ${e.message}`)}
  for(const n of list){n.sc=SCHLECHT.test(n.t)?-1:GUT.test(n.t)?1:0}
  if(API&&list.length)try{const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":API,"anthropic-version":"2023-06-01","content-type":"application/json"},
      body:JSON.stringify({model:E.KI_MODELL||"claude-haiku-5-5",max_tokens:400,messages:[{role:"user",content:`Bewerte für einen Kurzfrist-Trader (nächste Stunde) jede Schlagzeile zu ${NAME[s]||s}: -1 schlecht, 0 neutral, 1 gut, plus 4–8 Wörter Begründung auf Deutsch. Nur JSON-Liste [{"i":0,"sc":0,"kurz":"..."}].\n`+list.map((n,i)=>`${i}: ${n.t}`).join("\n")}]})});
    const j=await r.json(),txt=(j.content||[]).map(c=>c.text||"").join(""),arr=JSON.parse(txt.slice(txt.indexOf("["),txt.lastIndexOf("]")+1));for(const o of arr)if(list[o.i]){list[o.i].sc=Math.max(-1,Math.min(1,+o.sc||0));list[o.i].kurz=String(o.kurz||"").slice(0,80)}}catch(e){fehler("ki",e.message)}
  const frisch=list.filter(n=>Date.now()-n.ts<24*36e5),sum=frisch.reduce((a,n)=>a+n.sc,0),g=frisch.some(n=>n.sc<0)&&sum<=0?"negativ":sum>=2?"positiv":"neutral";
  return S.news[s]={t:Date.now(),g,list:list.map(n=>({t:n.t,u:n.u,q:n.q,sc:n.sc,kurz:n.kurz}))}}
async function quartalszahlen(){const heute=zeit("America/New_York").date;if(S.zahlen.d===heute||!FH)return;try{const bis=new Date(Date.now()+864e5).toISOString().slice(0,10);
  const j=await finnhub(`calendar/earnings?from=${heute}&to=${bis}`);S.zahlen={d:heute,s:((j&&j.earningsCalendar)||[]).map(e=>e.symbol)}}catch(e){fehler("zahlen",e.message)}}

/* ---------- Live: Kurse, Signale ---------- */
const hebel=()=>EINST.modus==="aktie"?1:+EINST.faktor;
async function scan(m){const M=MARKT[m],jetzt=Date.now(),z=zeit(M.tz);let R=null;
  try{const r=await yahoo(M.ref,"5d");R=K.prep(r.B,M.tz)}catch(e){fehler("index",e.message)}const MK=K.marktKarte(R);
  const mk=R?MK.get(R.B.t[R.n-1]):0;D.markt[m]={offen:offen(m),auf:jetzt-(z.min-M.auf)*6e4,zu:schlussMs(m),trend:mk>0?"auf":mk<0?"ab":"seit"};
  await parallel(liste(m),5,async s=>{const r=await yahoo(s,"5d");const Pr=K.prep(r.B,M.tz),B=r.B,n=Pr.n;if(n<30)return;
    // nur abgeschlossene Kerzen bewerten (die letzte läuft evtl. noch)
    let i=n-1;if(B.t[i]+300>jetzt/1000)i--;const heute=Pr.ds[n-1];if(E.TEST_ALLE)i=heute+30+Math.floor(Math.random()*30);const x=K.merkmale(Pr,i,MK),p=LIVE[s]&&jetzt-LIVE[s].t<6e4?LIVE[s].p:(r.p||B.c[n-1]);
    const tag=(a,b)=>B.t.slice(a,b).map((t,j)=>[t*1000,+B.c[a+j].toFixed(3)]),idx5=Pr.ds[Math.max(0,heute-1)];
    const v1d=tag(heute,n),sample=(arr,k)=>arr.filter((_,j)=>j%k===0||j===arr.length-1);
    D.kurse[s]={n:NAME[s],m,p:+(+p).toFixed(3),dp:r.vor?+((p/r.vor-1)*100).toFixed(2):0,cur:r.cur||M.cur,t:r.mt||jetzt,vwAbst:x?+x.vwAbst.toFixed(2):null,rsi:x?Math.round(x.rsi):null};
    V[s]={"1d":v1d,"5d":sample(tag(0,n),6),"1M":(V[s]&&V[s]["1M"])||[]}; // Kursverläufe für den Chart (eigene Datei, wird nur bei Bedarf geladen)
    if(!x||!offen(m))return;
    for(const key of K.muster(x)){const id=`${s}:${key}:${B.t[i]}`;if(D.signale.some(y=>y.id===id))continue;
      const w=K.wahrsch(S.statSym[s]&&S.statSym[s][key],S.stat[key]);if(w.nT<30||w.p.every(v=>v==null))continue;
      const dir=key.startsWith("short")?"short":"long",d=dir==="short"?-1:1,t=(B.t[i]+300)*1000,MU=K.MUSTER[key];
      const warum=[MU.t,`RSI ${Math.round(x.rsi)} · Abstand zum Tagesschnitt ${pz(x.vwAbst,2)} · heute ${pz(x.dch,2)}`,`Markt ${x.mkt>0?"steigt ↗":x.mkt<0?"fällt ↘":"seitwärts →"} · Umsatz ${nf(x.rv,1)}× üblich`];
      const sig={id,dir,s,n:NAME[s],m,cur:r.cur||M.cur,setup:key,setupN:MU.n,warum,t,p0:+B.c[i].toFixed(3),bis:t+10*6e4,zu:schlussMs(m),...w,
        dip16:(S.dip[key]||[]).map(o=>o||null),spark:v1d,vw:Pr.vw.slice(heute,n).map(v=>+v.toFixed(3)),fall:K.fallAus(s,t,key,x,{pfad:new Array(K.PFAD).fill(0),r:new Array(16).fill([0,0,0])}).f};
      if(m==="us"&&S.zahlen.s.includes(s)){sig.block="Quartalszahlen heute oder morgen – zu unberechenbar";}
      D.signale.push(sig);await neuesSignal(sig)}
    try{await vorstufe(s,m,x,+p)}catch(e){fehler("vorwarnung",`${s}: ${e.message}`)}});
  // Monatsverlauf einmal pro Tag (Tageskerzen)
  if(S.monatTag!==z.date+m){S.monatTag=z.date+m;await parallel(liste(m),4,async s=>{const r=await yahoo(s,"1mo","1d");if(V[s])V[s]["1M"]=r.B.t.map((t,j)=>[t*1000,+r.B.c[j].toFixed(3)])})}
  if(!E.TEST_ALLE)D.signale=D.signale.filter(x=>jetzt-x.t<3*36e5);geaendert=true}
async function neuesSignal(x){x.news=await nachrichten(x.s);if(x.news.g==="negativ"&&!x.block)x.block="Schlechte Nachricht heute";
  const b=K.bewerte(EINST,x,EINST.T,EINST.S,hebel());if(!b)return;const p=Math.round(b.pPlus*100),sich=b.t>=3?"sehr gut belegt":b.t>=2?"gut belegt":"wenig belegt";
  protokoll("signal",x.s,`Signal: ${x.n} ${x.dir==="short"?"SHORT":"LONG"} ${p} %`,{Muster:x.setupN,"Gewinn-Chance":p+" %","Ziel zuerst":Math.round(b.p*100)+" %","Ø nach Kosten":eu(b.eEv),Sicherheit:`${sich} (t=${b.t.toFixed(1)})`,Hebel:"×"+hebel(),"Ziel/Stop":`${pz(EINST.T,2)} / ${pz(-EINST.S,2)}`,Fälle:`${x.nS} dieser Aktie, ${x.nT} gesamt`,Nachrichten:x.news.g,Gründe:x.warum.slice(1).join(" · "),Sperre:x.block||"–"});
  if(x.block||b.ev<=0||b.t<(EINST.minT??2)||b.pPlus<EINST.minP/100)return;const key=`${x.s}:${x.dir}`;if(Date.now()-(S.sigTag[key]||0)<20*6e4)return;S.sigTag[key]=Date.now();
  const d=x.dir==="short"?-1:1,zl=x.p0*(1+d*EINST.T/100),st=x.p0*(1-d*EINST.S/100),cur=x.cur==="USD"?"$":"€",richt=b.richt||b.min*2||30;
  await senden(`🚨 <b>EINSTIEG: ${esc(x.n)} ${x.dir==="short"?"SHORT ↘":"LONG ↗"}</b> 🟢 Gewinn-Chance ${p} %\n`+
    `⏱ Kaufen bis <b>${uhr(x.bis)}</b> · Aktie ${d<0?"über":"unter"} ${nf(x.p0*(1+d*EINST.T*.25/100))} ${cur}\n`+
    `🎯 Ziel ${nf(zl)} ${cur} (${pz(d*EINST.T,2)}) → <b>${eu(b.eWin)}</b>\n🛑 Stop ${nf(st)} ${cur} → ${eu(b.eLoss)}\n`+
    `⌛ Ziel meist nach ~${b.min} Min. · Richtwert bis ${uhr(x.t+richt*6e4)}\n📊 Hebel ×${hebel()} · Ø ${eu(b.eEv)} nach Kosten · ${sich}\n🎯 Ziel zuerst ${Math.round(b.p*100)} % · Stop zuerst ${Math.round(b.pl*100)} % · Rest: Richtzeit\n📰 Nachrichten: ${x.news.g}${dipZeile(x,b)}`,{knopf:["Aktie in der App öffnen",APP+"#k="+encodeURIComponent(x.s)]});
  const vv=S.vw&&S.vw.vor&&S.vw.vor[`${x.s}:${x.setup}`];if(vv)vv.erl="signal";
  S.offeneSig=S.offeneSig||[];S.offeneSig.push({id:x.id,s:x.s,n:x.n,m:x.m,dir:x.dir,p0:x.p0,bis:x.bis})}
// Dip-Limit aus den echten Fällen dieses Musters: wie tief es vor dem Ziel meist zurückkam, wie oft das Limit erreicht wurde und wie oft es danach geklappt hat
function dipZeile(x,b){const dp=(x.dip16||[])[K.gi(EINST.T,EINST.S)];if(!dp||dp.p<=b.p)return "";const d=x.dir==="short"?-1:1,c=x.cur==="USD"?"$":"€";
  return `\n💧 <b>Dip-Kauf:</b> Limit ${nf(x.p0*(1-d*dp.tief/100))} ${c} (${pz(-d*dp.tief,2)}) – früher in ${Math.round(dp.q*100)} % erreicht, danach Ziel ${Math.round(dp.p*100)} % statt ${Math.round(b.p*100)} %`}

/* ---------- Morgenmeldung, Vorwarnung und „doch nicht kaufen“ ---------- */
// Nachgerechnet: Eine Uhrzeit allein bringt nach Kosten keinen belegbaren Vorteil (keines der Aktie×Halbe-Stunde-Fenster liegt bei Hebel 10 sicher über der Gewinnschwelle).
// Der Vorteil steckt in den Mustern. Darum warnt der Bot vor, wenn sich ein lohnendes Dip-Muster anbahnt, und meldet dann den Einstieg oder ein „nicht kaufen“.
const nmDir=(s,dir)=>`${esc(NAME[s]||s)} ${dir==="short"?"SHORT ↘":"LONG ↗"}`,wz=s=>MVON(s)==="us"?"$":"€";
// Vorstufe: das Muster ist noch nicht da (die Wende-Kerze fehlt), aber der Abverkauf bzw. die Übertreibung läuft schon
const VORSTUFE={"long:abprall":x=>x.rsi<35&&x.c<x.vw*(1-x.atr/100)&&x.mkt>-1,"short:ueberkauft":x=>x.rsi>65&&x.c>x.vw*(1+x.atr/100)&&x.mkt<1};
const AUFGELOEST={"long:abprall":x=>x.rsi>45||x.c>x.vw,"short:ueberkauft":x=>x.rsi<55||x.c<x.vw};
function lohntSich(s,key){const w=K.wahrsch(S.statSym[s]&&S.statSym[s][key],S.stat[key]);if(w.nT<30)return null;const b=K.bewerte(EINST,w,EINST.T,EINST.S,hebel());
  if(!b||b.ev<=0||b.t<(EINST.minT??2)||b.pPlus<EINST.minP/100)return null;return b}
const vwTag=()=>{const tag=zeit("Europe/Berlin").date;if(!S.vw||S.vw.d!==tag)S.vw={d:tag,morgen:{},vor:{}};S.vw.vor=S.vw.vor||{};S.vw.morgen=S.vw.morgen||{};return S.vw};
async function vorstufe(s,m,x,p){const V=vwTag(),jetzt=Date.now(),c=wz(s);
  for(const key of Object.keys(VORSTUFE)){const dir=key.startsWith("short")?"short":"long";if(EINST.richtung&&EINST.richtung!=="beide"&&EINST.richtung!==dir)continue;
    const id=`${s}:${key}`,d=dir==="short"?-1:1,nm=nmDir(s,dir),MU=K.MUSTER[key];let v=V.vor[id];if(v&&v.erl&&jetzt-v.t>90*6e4){delete V.vor[id];v=null}
    if(!v){if(!VORSTUFE[key](x)||K.muster(x).includes(key))continue;const b=lohntSich(s,key);if(!b)continue;if(Object.values(V.vor).filter(y=>!y.erl).length>=4)continue;
      V.vor[id]={t:jetzt,p,erl:null};protokoll("info",s,`Vorwarnung: ${NAME[s]} ${dir} (${MU.n})`,{RSI:Math.round(x.rsi),"Abstand Tagesschnitt":pz(x.vwAbst,2),"Gewinn-Chance":Math.round(b.pPlus*100)+" %","Ø nach Kosten":eu(b.eEv)});
      await senden(`⏰ <b>VORWARNUNG – ${d>0?"Dip bahnt sich an":"Übertreibung bahnt sich an"}: ${nm}</b>\nKurs ${nf(p)} ${c} · heute ${pz(x.dch,2)} · RSI ${Math.round(x.rsi)} · ${pz(x.vwAbst,1)} zum Tagesschnitt\n\nIch warte auf das Muster „${esc(MU.n)}“: die erste ${d>0?"grüne":"rote"} Kerze nach dem ${d>0?"Abverkauf":"Anstieg"}.\nFrüher bei diesem Muster: Gewinn-Chance <b>${Math.round(b.pPlus*100)} %</b> · Ø <b>${eu(b.eEv)}</b> nach Kosten (×${hebel()}, ${nf(EINST.einsatz,0)} €) · ${b.t>=3?"sehr gut belegt":"gut belegt"}\n\n👉 Jetzt ${d>0?"Long":"Short"}-Knock-out raussuchen und bereithalten.\n✋ Noch <b>nicht kaufen</b> – ${d>0?"nicht ins fallende Messer greifen":"nicht gegen den laufenden Anstieg"}.\nIch schicke 🚨 EINSTIEG, sobald es dreht – oder ❌, wenn es nicht mehr passt.`,{knopf:["Aktie in der App öffnen",APP+"#k="+encodeURIComponent(s)]});continue}
    if(v.erl)continue;const gr=[];if(d>0&&x.mkt<=-1)gr.push("der Gesamtmarkt bricht ein");if(d<0&&x.mkt>=1)gr.push("der Gesamtmarkt zieht stark an");
    if(m==="us"&&S.zahlen.s.includes(s))gr.push("Quartalszahlen heute oder morgen");const nw=await nachrichten(s);if(d>0&&nw.g==="negativ")gr.push("schlechte Nachricht heute – der Abverkauf kann einen Grund haben");if(d<0&&nw.g==="positiv")gr.push("gute Nachricht heute – der Anstieg kann einen Grund haben");
    if(!lohntSich(s,key))gr.push("die Rechnung lohnt sich mit deinen Einstellungen nicht mehr");
    if(gr.length){v.erl="nein";protokoll("info",s,`Vorwarnung zurückgezogen: ${NAME[s]} – ${gr.join(", ")}`);await senden(`❌ <b>NICHT KAUFEN: ${nm}</b>\nDie Vorwarnung von ${uhr(v.t)} gilt nicht mehr: ${gr.join(" · ")}.\nKurs ${nf(p)} ${c}.`)}
    else if(AUFGELOEST[key](x)||jetzt-v.t>60*6e4){v.erl="weg";await senden(`ℹ️ <b>${nm}:</b> Vorwarnung von ${uhr(v.t)} erledigt – ${AUFGELOEST[key](x)?"der Kurs hat sich ohne sauberes Muster erholt":"seit einer Stunde kein sauberes Muster"}. Nicht kaufen.`)}}}
async function vorwarnungen(){const jetzt=Date.now(),V=vwTag();
  // Morgenmeldung 30 Min. vor Börsenstart: welche Muster sich mit deinen Einstellungen gerade nach Kosten lohnen
  for(const m of ["us","de"]){if(!handelstag(m)||!S.stat||V.morgen[m])continue;const M=MARKT[m],z=zeit(M.tz);if(!(z.min>=M.auf-30&&z.min<M.zu-60))continue;V.morgen[m]=1;
    const l=K.MKEYS.map(k=>{const w=K.wahrsch(null,S.stat[k]);const b=w.nT>=30?K.bewerte(EINST,w,EINST.T,EINST.S,hebel()):null;return {k,b}}).filter(o=>o.b&&o.b.ev>0&&o.b.t>=(EINST.minT??2)&&o.b.pPlus>=EINST.minP/100&&(!EINST.richtung||EINST.richtung==="beide"||o.k.startsWith(EINST.richtung)));
    await senden(`☀️ <b>Guten Morgen – ${m==="us"?"USA ab "+uhr(jetzt+(M.auf-z.min)*6e4):"Europa ab "+uhr(jetzt+(M.auf-z.min)*6e4)}</b>\n`+(l.length?`Mit Hebel ×${hebel()} und Ziel ${pz(EINST.T,2)} / Stop ${pz(-EINST.S,2)} lohnt sich nach Kosten:\n`+l.map(o=>`• ${esc(K.MUSTER[o.k].n)} ${o.k.startsWith("short")?"SHORT":"LONG"} – Chance ${Math.round(o.b.pPlus*100)} % · Ø ${eu(o.b.eEv)}`).join("\n")+`\n\nIch melde mich mit ⏰ Vorwarnung, sobald sich so ein Dip anbahnt, dann mit 🚨 EINSTIEG oder ❌.`
      :`Mit deinen Einstellungen lohnt sich nach Kosten gerade kein Muster sicher genug. Ich melde nur, wenn sich das ändert.`)+`\n<i>Grundlage: letzte 60 Handelstage, alle 150 Aktien.</i>`)}
  // Gesendete EINSTIEG-Signale: noch nicht gekauft und die Lage kippt → sofort warnen
  S.offeneSig=(S.offeneSig||[]).filter(x=>jetzt<x.bis+10*6e4&&!x.erl);
  for(const x of S.offeneSig){if(POS.pos.some(p=>p.s===x.s))continue;const p=await kursJetzt(x.s);if(!p)continue;const d=x.dir==="short"?-1:1,u=d*(p/x.p0-1)*100,mt=D.markt[x.m]&&D.markt[x.m].trend;let gr=null;
    if(u<=-.5*EINST.S)gr=`Der Kurs ist schon ${pz(u,2)} gegen dich gelaufen – das Muster gilt nicht mehr`;
    else if(u>=.25*EINST.T)gr=`Schon ${pz(u,2)} gelaufen, über dem Kauflimit – zu spät, nicht hinterherkaufen`;
    else if((d>0&&mt==="ab")||(d<0&&mt==="auf"))gr=`Der Gesamtmarkt hat gedreht (${mt==="ab"?"fällt":"steigt"})`;
    if(gr){x.erl=1;protokoll("info",x.s,`Signal zurückgezogen: ${x.n} – ${gr}`);await senden(`❌ <b>NICHT MEHR KAUFEN: ${nmDir(x.s,x.dir)}</b>\n${gr}.\nKurs ${nf(p)} ${wz(x.s)} (Signal bei ${nf(x.p0)}).\nFalls du schon gekauft hast: in der App eintragen, dann rechne ich Halten gegen Verkaufen.`)}}}

/* ---------- Offene Trades überwachen ---------- */
const TUN={ko:["💥","KNOCK-OUT – Zertifikat ist wertlos"],konah:["🚨","SOFORT VERKAUFEN – Knock-out ist nah"],halten:["⏳","HALTEN"],ziel:["🎯","JETZT VERKAUFEN – Ziel erreicht"],stop:["🛑","SOFORT VERKAUFEN – Stop erreicht"],dreht:["⚠️","VERKAUFEN – lieber jetzt sichern"],
  schmilzt:["⚠️","VERKAUFEN – Gewinn schmilzt"],sinkt:["📉","ACHTUNG – Gewinn geht zurück"],zeit:["⌛","RICHTZEIT erreicht – du entscheidest"],schluss:["🔔","ACHTUNG – Börse schließt bald"]};
const EILIG=new Set(["ziel","stop","dreht","schmilzt","konah","ko"]);
async function positionenLesen(){if(!PASS){EINST=Object.assign({},STD,EINST);D.posInfo={t:Date.now(),ok:false,fehler:"SYNC_PASSWORD fehlt beim Bot"};return}let txt=null;
  try{if(WER==="test"&&fs.existsSync(P("data/pos.enc")))txt=fs.readFileSync(P("data/pos.enc"),"utf8");else{execSync("git fetch -q --depth=1 origin main",{cwd:ROOT,stdio:"ignore",timeout:20000});txt=execSync("git show origin/main:data/pos.enc",{cwd:ROOT,stdio:["ignore","pipe","ignore"]}).toString()}}catch(e){txt=null}
  if(!txt){EINST=Object.assign({},STD,EINST);D.posInfo={t:Date.now(),n:0,ok:true,leer:true};return}
  try{const o=await entschluesseln(txt,PASS);POS={pos:Array.isArray(o.pos)?o.pos:[],einst:o.einst||{}};EINST=Object.assign({},STD,POS.einst);delete S.fehler.sync;D.posInfo={t:Date.now(),n:POS.pos.length,von:o.updatedAt||0,ok:true}}catch(e){fehler("sync","pos.enc nicht lesbar – stimmt SYNC_PASSWORD?");D.posInfo={t:Date.now(),ok:false,fehler:"Sync-Passwort passt nicht"}}}
async function kursJetzt(s){const jetzt=Date.now();if(LIVE[s]&&jetzt-LIVE[s].t<15e3)return LIVE[s].p;
  try{if(MVON(s)==="us"&&FH){const q=await finnhub(`quote?symbol=${encodeURIComponent(s)}`);if(q&&q.c>0){LIVE[s]={p:q.c,t:jetzt};return q.c}}
    const r=await yahoo(s,"1d","1m");if(r.p>0){LIVE[s]={p:r.p,t:jetzt};return r.p}}catch(e){fehler("kurs",`${s}: ${e.message}`)}return null}
async function ueberwachen(){const jetzt=Date.now(),aus={};for(const x of POS.pos){const m=x.m||MVON(x.s);if(!offen(m,0,5))continue;const p=await kursJetzt(x.s);
    if(!p){const a=S.posSt[x.id]||{};if(jetzt-(a.kursT||jetzt)>2*6e4&&!a.keinKurs){a.keinKurs=1;await senden(`⚠️ <b>Keine Kurse für ${esc(x.n)}</b> seit 2 Minuten. Schau bitte selbst in Trade Republic.`)}continue}
    const alt=S.posSt[x.id]||{},y=Object.assign({},x,{peak:Math.max(x.peak||0,alt.peak||0),peakU:Math.max(x.peakU??0,alt.peakU??-99)}),s=K.stand(EINST,y,p,D.markt[m]&&D.markt[m].zu,jetzt,FAELLE);
    S.posSt[x.id]={...s,st:s.st,kursT:jetzt,gemeldet:alt.gemeldet,peak:s.peak,peakU:s.peakU};aus[x.id]={p,u:+s.u.toFixed(3),net:+s.net.toFixed(2),st:s.st,peak:+s.peak.toFixed(3),peakU:+s.peakU.toFixed(3),pZ:+s.pZ.toFixed(2),pS:+s.pS.toFixed(2),quelle:s.quelle,t:jetzt};
    if(s.st!=="halten"&&alt.gemeldet!==s.st){S.posSt[x.id].gemeldet=s.st;const t=TUN[s.st],eilig=EILIG.has(s.st);
      protokoll(s.st,x.s,`${t[1]}: ${x.n}${x.ueb?" (Übung)":""}`,{Netto:eu(s.jetztE),"Weiter halten Ø":eu(s.evHalt),"Chance Ziel":Math.round(s.pZ*100)+" %",Grundlage:s.quelle});
      await senden(`${eilig?"🚨🚨 ":""}${t[0]} <b>${t[1]}</b>\n<b>${esc(x.n)}</b> ${x.dir==="short"?"SHORT":"LONG"}${x.ueb?" 🧪 Übung":""}\n\nJetzt verkaufen: <b>${eu(s.jetztE)}</b>\nWeiter halten: Ø ${eu(s.evHalt)} (Ziel ${Math.round(s.pZ*100)} % · Stop ${Math.round(s.pS*100)} %)\nAktie ${pz((x.dir==="short"?-1:1)*s.u,2)} seit Kauf · Grundlage: ${s.quelle}${s.ko?`\nKnock-out bei ${nf(s.ko)} · noch ${pz(s.koAbst,2)} Abstand · Hebel jetzt ×${nf(s.hebelJetzt,1)}`:""}`,{knopf:["Trade in der App",APP+"#meine"]})}
    else if(s.st==="halten"&&alt.gemeldet&&alt.gemeldet!=="halten")S.posSt[x.id].gemeldet="halten"}
  for(const id of Object.keys(S.posSt))if(!POS.pos.some(x=>x.id===id))delete S.posSt[id];
  if(PASS&&Object.keys(aus).length){D.pe=await verschluesseln(aus,PASS);geaendert=true}}

/* ---------- Bilanz: jedes Signal nach Ablauf mit dem echten Verlauf abgleichen ---------- */
async function bilanz(){const jetzt=Date.now();for(const x of D.signale){if(x.geprueft||jetzt<Math.min(x.t+2*36e5,x.zu))continue;
  try{const r=await yahoo(x.s,"5d"),Pr=K.prep(r.B,MARKT[x.m].tz),i=r.B.t.indexOf(x.t/1000-300);if(i<0)continue;const a=K.ausgang(Pr,i,x.dir==="short"?-1:1);if(!a)continue;x.geprueft=1;
    const b=K.bewerte(EINST,x,EINST.T,EINST.S,hebel());S.bilanz.push({d:zeit("Europe/Berlin").date,t:x.t,s:x.s,setup:x.setup,dir:x.dir,p:b?+b.p.toFixed(3):null,res:a.r.map(z=>z[0])});
    const f=K.fallAus(x.s,x.t,x.setup,K.merkmale(Pr,i,null),a);f.nw=x.news&&x.news.g;f.live=1;S.faelleLive.push(f);if(S.faelleLive.length>3000)S.faelleLive=S.faelleLive.slice(-2500)}catch(e){}}
  if(S.bilanz.length>1500)S.bilanz=S.bilanz.slice(-1200)}

/* ---------- Ausgabe: Zweig „daten“ ---------- */
let letzterPush=0;
async function veroeffentlichen(zwingend){if(!geaendert&&!zwingend)return;geaendert=false;const jetzt=Date.now();
  D.t=jetzt;D.wer=WER;D.bilanz=S.bilanz.slice(-600);D.fehler=Object.fromEntries(Object.entries(S.fehler).filter(([,v])=>jetzt-v.t<2*36e5));D.ausfall=S.ausfall.slice(-20);D.statTag=S.statTag;
  D.setups=Object.fromEntries(Object.entries(S.stat).map(([k,v])=>[k,{n:K.MUSTER[k].n,t:K.MUSTER[k].t,st:v.map(z=>[z[0],z[1],z[2]])}]));
  writeJSON(`${OUT}/day.json`,D);writeJSON(`${OUT}/verlauf.json`,V);writeJSON(`${OUT}/log.json`,S.log.slice(-1000));
  for(const f of ["zeiten","faelle","tage"]){const q=P(`.state/${f}.json`);if(fs.existsSync(q))fs.copyFileSync(q,`${OUT}/${f}.json`)}
  if(fs.existsSync(`${OUT}/faelle.json`)&&S.faelleLive.length){const a=readJSON(`${OUT}/faelle.json`,[]);writeJSON(`${OUT}/faelle.json`,[...a,...S.faelleLive].slice(-7000))}
  if(DRY||WER==="test")return;
  try{const o={cwd:ROOT},dateien=fs.readdirSync(OUT).filter(f=>f.endsWith(".json"));let baum="";
    for(const f of dateien){const blob=execSync(`git hash-object -w "${OUT}/${f}"`,o).toString().trim();baum+=`100644 blob ${blob}\t${f}\n`}
    const tree=execSync("git mktree",Object.assign({input:baum},o)).toString().trim(),c=execSync(`git -c user.name=DayTrader -c user.email=daytrader@users.noreply.github.com commit-tree ${tree} -m "Daten ${new Date(jetzt).toISOString()}"`,o).toString().trim();
    execSync(`git push -f -q origin ${c}:refs/heads/daten`,Object.assign({timeout:30000,stdio:"ignore"},o));letzterPush=jetzt;delete S.fehler.push}catch(e){fehler("push",e.message)}}
// Wer läuft gerade noch? GitHub tritt zurück, sobald Handy/Server frische Daten schreibt.
function fremderLauf(){try{execSync("git fetch -q --depth=1 origin daten",{cwd:ROOT,stdio:"ignore",timeout:20000});const d=JSON.parse(execSync("git show origin/daten:day.json",{cwd:ROOT,stdio:["ignore","pipe","ignore"],maxBuffer:64e6}).toString());
  return d.wer&&d.wer!==WER&&Date.now()-d.t<4*6e4?d.wer:null}catch(e){return null}}

/* ---------- Ablauf ---------- */
export async function main(){const start=Date.now();log("Start",WER,REPO);
  if(WER==="github"){const f=fremderLauf();if(f){log(`${f} läuft – GitHub bleibt Backup und beendet sich.`);return}}
  // Ausfall erkennen: Lücke während der Börsenzeit
  if(S.letzt&&start-S.letzt>10*6e4&&(offen("us")||offen("de"))){S.ausfall.push({von:S.letzt,bis:start,min:Math.round((start-S.letzt)/6e4)});protokoll("info","",`Bot war ${Math.round((start-S.letzt)/6e4)} Min. nicht erreichbar`)}
  if(S.statTag&&fs.existsSync(P(".state/zeiten.json"))){Z=readJSON(P(".state/zeiten.json"),null);FAELLE=readJSON(P(".state/faelle.json"),[]);TAGE=readJSON(P(".state/tage.json"),{})}
  const altD=readJSON(`${OUT}/day.json`,null);if(altD&&Date.now()-altD.t<6*36e5){D.signale=altD.signale||[];D.kurse=altD.kurse||{};V=readJSON(`${OUT}/verlauf.json`,{})}
  await positionenLesen();await telegramEingang(0);
  const tick={pos:0,scan:{us:0,de:0},pub:0,fremd:Date.now(),bil:0,vw:0};
  while(true){const jetzt=Date.now(),z=zeit("Europe/Berlin"),offenM=["us","de"].filter(m=>offen(m)),bald=["us","de"].some(m=>offen(m,90,0));S.letzt=jetzt;
    if(bald&&S.statTag!==z.date&&["us","de"].some(handelstag))try{await tagesStatistik()}catch(e){fehler("statistik",e.message)}
    if(!S.statTag&&!Z)try{await tagesStatistik()}catch(e){fehler("statistik",e.message)}
    if(jetzt-tick.pos>30e3){tick.pos=jetzt;await positionenLesen();await extrasPruefen()}
    if(POS.pos.length)await ueberwachen();
    for(const m of offenM)if(jetzt-tick.scan[m]>120e3){tick.scan[m]=jetzt;if(m==="us")await quartalszahlen();try{await scan(m)}catch(e){fehler("scan",e.message)}}
    for(const m of ["us","de"])if(!offen(m)&&D.markt[m]&&D.markt[m].offen){D.markt[m].offen=false;geaendert=true}
    if(jetzt-tick.vw>60e3){tick.vw=jetzt;try{await vorwarnungen()}catch(e){fehler("vorwarnung",e.message)}}
    if(jetzt-tick.bil>10*6e4){tick.bil=jetzt;await bilanz()}
    if(jetzt-tick.pub>(offenM.length?60e3:5*6e4)){tick.pub=jetzt;await veroeffentlichen(true)}else await veroeffentlichen(false);
    sichern();
    if(WER==="test")break;
    if(WER==="github"){if(jetzt-tick.fremd>60e3){tick.fremd=jetzt;const f=fremderLauf();if(f){log(`${f} ist wieder da – GitHub übergibt.`);break}}
      if(!offenM.length&&!POS.pos.length&&!bald&&jetzt-start>(+E.RUHE_MIN||14)*6e4)break} // auch nachts ~14 Min. wach bleiben, damit Telegram-Befehle schnell beantwortet werden
    if(LAUF_MIN&&jetzt-start>LAUF_MIN*6e4)break;
    await telegramEingang(offenM.length||POS.pos.length?15:25)}
  await veroeffentlichen(true);sichern();log("Ende")}
if(import.meta.url===`file://${process.argv[1]}`)main().catch(e=>{console.error(e);process.exit(1)});
