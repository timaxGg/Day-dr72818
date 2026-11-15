"use strict";
/* Day-Trader: kurze Trades auf kleine Anstiege (Aktie +0,5 bis +1,5 %), mit Faktor-Zertifikaten bei Trade Republic.
   Der Bot (bot/daytrader.mjs, GitHub Actions) rechnet Einstiege, Zeiten und Wahrscheinlichkeiten und schreibt day.json + zeiten.json (Zweig „daten“).
   Die App rechnet daraus mit deinen Einstellungen (Faktor, Spread, Gebühr, Einsatz, Ziel, Stop) das Ergebnis in Euro.
   Positionen liegen verschlüsselt in data/pos.enc, damit der Bot dich in Telegram warnt. Ohne Daten zeigt die App Beispieldaten (deutlich markiert). */
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const GT=[.5,.75,1,1.5],GS=[.5,.75,1,1.5],gi=(T,S)=>Math.max(0,GT.indexOf(+T))*4+Math.max(0,GS.indexOf(+S));
const CS={EUR:"€",USD:"$"};
let MAIN={};try{MAIN=(JSON.parse(localStorage.getItem("kah")||"{}")||{}).settings||{}}catch(e){}
const STD={repo:"timaxGg/Day-dr72818",richtung:"beide",halt:0,minT:2,modus:"faktor",faktor:10,spreadZ:.4,spreadA:.1,gebuehr:1,einsatz:500,steuer:26.375,T:1,S:1,minP:50,ueb:true,konto:1000,ton:true,ghToken:"",syncPass:"",fhKey:""};
let E=Object.assign({},STD);try{Object.assign(E,JSON.parse(localStorage.getItem("dt-einst")||"{}"))}catch(e){}if(!E.v2){E.halt=0;E.v2=1}if(!E.v3){E.faktor=Math.max(10,+E.faktor||10);E.minP=50;E.minT=2;E.v3=1}if(!E.v4){E.modus="ko";E.v4=1}
let M={pos:[],verkauft:[],updatedAt:0};try{Object.assign(M,JSON.parse(localStorage.getItem("dt-mein")||"{}"))}catch(e){}
let tab="jetzt",zDir="long",zMarkt="us",zSym="",D=null,Z=null,DEMO=false,LIVE={},offen=null,fehler="",PE={};
const tok=()=>E.ghToken||MAIN.ghToken||"",pass=()=>E.syncPass||MAIN.syncPass||"",fhk=()=>E.fhKey||MAIN.fhKey||"";
const speichernE=()=>{try{localStorage.setItem("dt-einst",JSON.stringify(E))}catch(e){}};
const speichernM=()=>{M.updatedAt=Date.now();try{localStorage.setItem("dt-mein",JSON.stringify(M))}catch(e){};clearTimeout(speichernM.t);speichernM.t=setTimeout(hochladen,1200)};

/* ---------- Format ---------- */
const nf=(v,d=2)=>(+v).toLocaleString("de-DE",{minimumFractionDigits:d,maximumFractionDigits:d});
const pz=(v,d=1)=>v==null||!isFinite(v)?"–":(v>0?"+":v<0?"−":"±")+nf(Math.abs(v),d)+" %";
const eu=(v,d=2)=>v==null||!isFinite(v)?"–":(v>0?"+":v<0?"−":"")+nf(Math.abs(v),d)+" €";
const kurs=(v,c)=>`${nf(v,v>=1000?1:2)} ${CS[c]||c||""}`;
const uhr=t=>new Date(t).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const kl=v=>v>0?"up":v<0?"down":"muted";
const toast=t=>{const e=$("#toast");e.textContent=t;e.classList.add("on");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("on"),3200)};
const mmss=ms=>{if(ms<=0)return "0:00";const s=Math.round(ms/1000),m=Math.floor(s/60);return m>=60?`${Math.floor(m/60)} Std. ${m%60} Min.`:`${m}:${String(s%60).padStart(2,"0")}`};

/* ---------- Rechnung: aus Aktien-Bewegung wird Ergebnis in Euro ---------- */
const HEBEL=[1,3,5,10,15,20],HB={};let KF=null,RUHIG=false;
const F=()=>E.modus==="aktie"?1:+E.faktor;
const spreadF=f=>f>1?+E.spreadZ:+E.spreadA,spread=()=>spreadF(F());
const kostenF=(f,ein=E.einsatz)=>spreadF(f)+2*E.gebuehr/ein*100,kosten=()=>kostenF(F()); // % vom Einsatz für Kauf + Verkauf zusammen
const nachSt=v=>v>0?v*(1-E.steuer/100):v;
function bewerte(x,T=E.T,S=E.S,f=F(),ein=E.einsatz){
  // Echte Daten: Rechnung aus dem Rechenkern. Ring zeigt die Gewinn-Chance (Ziel erreicht oder bei Richtzeit im Plus nach Kosten).
  if(!DEMO&&x.nT!=null){const r=KERN.bewerte(E,x,+T,+S,f,ein);if(!r)return {keine:true,g:gi(T,S),p:0,pt:0,pl:1,ev:-1,eWin:0,eLoss:0,eEv:0,min:30,richt:54,k:kostenF(f,ein),t:0,pZiel:0,pZvS:0};
    return Object.assign({},r,{keine:false,pZiel:r.p,p:r.pPlus,min:r.min||30,richt:r.richt||Math.round((r.min||30)*1.8)})}const g=gi(T,S),keine=x.p[g]==null,p=keine?0:x.p[g],pt=keine?0:(x.pt[g]||0),pl=Math.max(0,1-p-pt),k=kostenF(f,ein);
  const win=f*T-k,loss=-f*S-k,to=f*(x.to[g]||0)-k,ev=p*win+pl*loss+pt*to,euro=v=>ein*v/100;
  return {keine,g,p,pt,pl,win,loss,to,ev:keine?-1:ev,f,richt:(x.p80&&x.p80[g])||Math.round((x.min[g]||30)*1.8),eWin:nachSt(euro(win)),eLoss:euro(loss),eEv:keine?0:nachSt(euro(ev)),min:x.min[g]||30,k}}
const ampel=p=>p>=.65?"g":p>=.55?"y":"r",ampelTxt=p=>p>=.65?"sicherer":p>=.55?"mittel":"unsicher";
function sicherste(x){let best=null;for(const T of GT)for(const S of GS){const b=bewerte(x,T,S);if(b.ev>0&&(!best||b.p>best.b.p))best={T,S,b}}return best}
/* ---------- Daten ---------- */
const roh=f=>`https://raw.githubusercontent.com/${E.repo}/daten/${f}?t=${Math.floor(Date.now()/3e4)}`;
async function hole(f){if(tok()){const r=await fetch(`https://api.github.com/repos/${E.repo}/contents/${f}?ref=daten`,{headers:{Authorization:`Bearer ${tok()}`,Accept:"application/vnd.github.raw+json"},cache:"no-store"});if(r.ok)return r.json()}
  const r=await fetch(roh(f),{cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);return r.json()}
let SYNC=null,FAELLE=null,VERL={},VERL_T=0,BOTLOG=[],TAGE=null;
async function laden(){try{const d=await hole("day.json");if(!d||!d.t)throw new Error("leer");
    if(DEMO){M.pos=M.pos.filter(p=>!p.demo);M.meld=[];M.log=(M.log||[]).filter(e=>!e.demo)}D=d;DEMO=false;fehler="";
    for(const x of D.signale||[])if(x.p0&&!x.px)x.px=x.p0;
    if(!Z||Date.now()-(Z._t||0)>36e5){try{Z=await hole("zeiten.json");Z._t=Date.now()}catch(e){}}
    if(tab==="archiv"&&Date.now()-(laden.logT||0)>6e4){laden.logT=Date.now();try{BOTLOG=await hole("log.json")}catch(e){}}
    if(D.pe&&pass())try{PE=await decJ(D.pe,pass())}catch(e){PE={}}}
  catch(e){if(!D||DEMO){fehler=String(e.message);demo()}}
  render();usLive()}

/* ---------- Beispieldaten (nur bis der Bot läuft) ---------- */
function demo(){DEMO=true;const jetzt=Date.now(),r=seed(7),auf=jetzt-75*6e4,zu=jetzt+315*6e4;
  const roh=[["NVDA","Nvidia","us",181.4,"rueck",[.71,.6]],["AMD","AMD","us",142.8,"vwap",[.66,.55]],["SAP.DE","SAP","de",236.1,"ausbruch",[.62,.52]],["TSLA","Tesla","us",331.2,"schwaeche",[.68,.57]],["META","Meta","us",612.3,"schwung",[.57,.47]],["RHM.DE","Rheinmetall","de",1712,"abprall",[.49,.4]]];
  const NAMEN={rueck:"Rücksetzer im Aufwärtstrend",vwap:"Zurück über den Tagesschnitt (VWAP)",ausbruch:"Ausbruch über die erste halbe Stunde",schwung:"Schwung mit neuem Tageshoch",abprall:"Abprall nach starkem Abverkauf",schwaeche:"Schwäche unter dem Tagesschnitt"};
  const WARUM={rueck:["Kurs liegt heute über dem Tagesschnitt (VWAP)","Kurzer Rücksetzer an die 21er-Linie, jetzt grüne Kerze","Gesamtmarkt (Nasdaq) steigt mit"],vwap:["Kurs war unter dem Tagesschnitt und ist mit viel Umsatz zurück darüber","Kurze Trendlinie dreht nach oben"],ausbruch:["Ausbruch über das Hoch der ersten 30 Minuten","Umsatz 1,6× so hoch wie üblich","DAX im Plus"],schwung:["Heute schon +1,4 %, gerade neues Tageshoch","Trend und Markt passen"],schwaeche:["Kurs fällt unter den Tagesschnitt (VWAP) mit viel Umsatz","Kurze Trendlinie zeigt nach unten","Nasdaq schwächelt mit"],abprall:["Stark überverkauft (RSI 24)","Erste grüne Kerze nach dem Abverkauf","Gegen den Trend: riskanter"]};
  const sig=roh.map(([s,n,m,p,set,[p1,p05]],i)=>{const p16=[],pt16=[],to16=[],min16=[];
    for(const T of GT)for(const S of GS){const base=p1+(S-T)*.32+(T<1?.04:0);p16.push(Math.max(.18,Math.min(.88,base)));pt16.push(.06+T*.04);to16.push(.15);min16.push(Math.round(6+T*12))}
    const spark=[],vw=[];const dd=set==="schwaeche"?-1:1;let c=p*(1-dd*.012+r()*.004),sum=0;for(let k=0;k<=15;k++){c*=1+dd*(r()-.47)*.004;spark.push([auf+k*5*6e4,+c.toFixed(2)]);sum+=c;vw.push(+(sum/(k+1)).toFixed(2))}spark.push([jetzt,p]);vw.push(vw[vw.length-1]);
    return {id:"d"+i,dir:set==="schwaeche"?"short":"long",s,n,m,cur:m==="us"?"USD":"EUR",setup:set,setupN:NAMEN[set],warum:WARUM[set],t:jetzt-(2+i*3)*6e4,p0:p,p,bis:jetzt+(13-i*3.2)*6e4,zu:m==="us"?zu:jetzt+(m==="de"?30:315)*6e4,p:p16,pt:pt16,to:to16,min:min16,nS:120+i*37,nT:2400,px:p,spark,vw,
      news:i===4?{g:"negativ",list:[{t:"Analyst senkt Kursziel nach Auftragsdelle",q:"Beispiel",sc:-1,kurz:"Belastet kurzfristig"}]}:{g:i===0?"positiv":"neutral",list:[{t:i===0?"Rechenzentren-Nachfrage bleibt hoch":"Keine größeren Meldungen heute",q:"Beispiel",sc:i===0?1:0,kurz:i===0?"Stützt den Kurs":"Kein Einfluss"}]}}});
  sig.forEach((x,i)=>{x.px=x.p0;x.dip={tief:[.35,.25,.3,.4,.2,.5][i%6],q:[.64,.58,.6,.55,.62,.5][i%6],plus:.07,min:[6,4,8,5,7,9][i%6]}});
  const kurse={};for(const x of sig)kurse[x.s]={n:x.n,m:x.m,p:x.p0,dp:+(r()*3-.8).toFixed(2),cur:x.cur};
  const _k=kurse;setTimeout(()=>{},0);
  for(const [s,n,m,p] of [["AAPL","Apple","us",228.5],["MSFT","Microsoft","us",418.2],["TSLA","Tesla","us",331],["AMZN","Amazon","us",204.3],["SIE.DE","Siemens","de",214.6],["ALV.DE","Allianz","de",352.1],["IFX.DE","Infineon","de",36.2]])kurse[s]={n,m,p,dp:+(r()*3-1.4).toFixed(2),cur:m==="us"?"USD":"EUR"};
  for(const k of Object.values(kurse)){k.vwAbst=+((r()-.35)*2).toFixed(2);k.rsi=Math.round(35+r()*45)}kurse.NVDA.vwAbst=1.4;kurse.NVDA.rsi=74;
  const setups={};for(const k of Object.keys(NAMEN)){const st=[];for(const T of GT)for(const S of GS){const n=900+Math.round(r()*400),w=Math.round(n*Math.max(.2,Math.min(.85,.5+(S-T)*.3+(k==="rueck"?.06:k==="abprall"?-.05:0))));st.push([n,w,Math.round((n-w)*.88)])}setups[k]={n:NAMEN[k],st}}
  const bil=[];for(let i=0;i<60;i++){const res=[];for(let g=0;g<16;g++)res.push(r()<.55+(g%4-g/4|0)*.06?1:r()<.85?-1:0);bil.push({d:new Date(jetzt-(i%12)*864e5).toISOString().slice(0,10),s:sig[i%5].s,setup:sig[i%5].setup,p:.6,res})}
  D={t:jetzt,markt:{us:{offen:true,auf,zu,trend:"auf"},de:{offen:true,auf:jetzt-6*36e5,zu:jetzt+30*6e4,trend:"auf"}},kurse,signale:sig,setups,bilanz:bil};
  const slots=m=>{const a=[];const start=m==="us"?15*60+30:9*60;const n=m==="us"?13:17;for(let i=0;i<n;i++){const t=start+i*30;a.push(`${String(t/60|0).padStart(2,"0")}:${String(t%60).padStart(2,"0")}`)}return a};
  const sl=(m,bonus)=>slots(m).map((_,i)=>{const o=[];for(const T of GT)for(const S of GS){const n=300+Math.round(r()*200),q=.47+(S-T)*.3+bonus(i)+(r()-.5)*.05;o.push([n,Math.round(n*Math.max(.15,Math.min(.9,q)))])}return o});
  Z={slots:{us:slots("us"),de:slots("de")},markt:{us:sl("us",i=>i===0?-.06:i===2||i===3?.05:i>10?-.03:0),de:sl("de",i=>i===0?-.05:i===1||i===2?.05:i===13||i===14?.03:0)},sym:{}};
  Object.keys(kurse).forEach((s,j)=>{const m=kurse[s].m,i0=[2,3,5,2,6,4,8,3,7,9,4,2][j%12],gut=j%3!==2?.12:.04;Z.sym[s]=sl(m,i=>(i===i0?gut:0)+(r()-.5)*.05)});
  Z.short={markt:{us:sl("us",i=>i===0?.02:i===9||i===10?.05:-.02),de:sl("de",i=>i===0?.03:i>=11&&i<=13?.04:-.02)},sym:{}};for(const s of Object.keys(kurse)){const m=kurse[s].m;Z.short.sym[s]=sl(m,i=>(s==="TSLA"&&i===2?.2:s==="RHM.DE"&&i===4?.18:-.02)+(r()-.5)*.05)}
  if(!M.demo2){M.demo2=1;M.pos=M.pos.filter(p=>!p.demo);const k1=kurse.NVDA.p,k2=kurse.AMD.p;
    M.pos.push({id:"p1",pSig:.71,demo:1,s:"NVDA",n:"Nvidia",m:"us",cur:"USD",f:5,kaufZ:10,stk:50,basis:k1*(1-.0035),T:1,S:1,t:jetzt-22*6e4,bis:jetzt+38*6e4,ueb:true,peak:0},
      {id:"p2",pSig:.66,demo:1,peakU:.7,s:"AMD",n:"AMD",m:"us",cur:"USD",f:3,kaufZ:10,stk:50,basis:k2*(1-.002),T:1,S:1,t:jetzt-48*6e4,bis:jetzt+12*6e4,ueb:true,peak:2.4});
    M.meld=[{art:"kauf",titel:"🧪 Gekauft: AMD",text:"Hebel ×3 · 500 € · Richtwert bis "+uhr(jetzt+12*6e4),t:jetzt-48*6e4},{art:"sinkt",titel:"ACHTUNG: AMD (Übung)",text:"Gewinn geht zurück · bester Stand +12,00 €",t:jetzt-9*6e4,neu:1},{art:"signal",titel:"🚨 Einstieg: Nvidia 71 %",text:"Kaufen bis "+uhr(jetzt+13*6e4)+" · Ziel +1 %",t:jetzt-2*6e4,neu:1}]}
  M.log=M.log||[];demoLog();
  for(const x of M.pos)if(x.demo&&!HIST[x.id]){const h=[];let v=0;for(let i=0;i<60;i++){v+=(Math.sin(i/9)*.9+(x.id==="p2"&&i>35?-.8:.25))*.6;h.push(+v.toFixed(2))}HIST[x.id]=h}}
function seed(a){return ()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

/* ---------- Live-Kurse US (Finnhub, Schlüssel aus der Haupt-App) ---------- */
let ws=null;
function usLive(){if(DEMO||!fhk()||!D||ws)return;const sy=[...new Set([...(D.signale||[]).map(x=>x.s),...M.pos.map(x=>x.s)])].filter(s=>!/\./.test(s));if(!sy.length)return;
  try{ws=new WebSocket("wss://ws.finnhub.io?token="+encodeURIComponent(fhk()))}catch(e){return}
  ws.onopen=()=>sy.forEach(s=>ws.send(JSON.stringify({type:"subscribe",symbol:s})));
  ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.type==="trade")for(const x of m.data||[])LIVE[x.s]={p:x.p,t:x.t}}catch(_){}};
  ws.onclose=()=>{ws=null;if(!document.hidden)setTimeout(usLive,8000)}}
// Übung mit Beispieldaten: Kurse sind NICHT zufällig. Hat eine Aktie ein Signal, spielt sie einen ihrer 100 ähnlichen Fälle nach.
// Welcher Fall kommt, wird so ausgelost, wie die Fälle früher ausgingen (Signal mit 70 % → in 7 von 10 Läufen ein Fall, der das Ziel erreichte).
// Zeitraffer ×10: 60 Minuten Verlauf laufen in 6 Minuten ab, damit du schneller üben kannst. Echt: Live-Kurse bzw. echte vergangene Tage.
const PFAD={},RAFFER=10;
function demoPfad(s){if(PFAD[s]!==undefined)return PFAD[s];const x=(D.signale||[]).find(y=>y.s===s&&y.setup!=="vorschlag");if(!x||!x.p)return PFAD[s]=null;
  const F=faelle(x),gew=Math.random()<bewerte(x,xT(x),xS(x)).p,pool=F.filter(f=>gew?f.res>0:f.res<=0),f=(pool.length?pool:F)[Math.floor(Math.random()*(pool.length||F.length))];
  return PFAD[s]={t0:Date.now(),path:f.path,d:dOf(x),p0:preis0(s),fall:f}}
const preis0=s=>{const k=D.kurse[s];return k.p*(1+Math.sin(Date.now()/9000+s.length)*.0008)};
function preis(s){const l=LIVE[s],k=D&&D.kurse&&D.kurse[s];if(l&&(!k||l.t>(k.t||0)))return l.p;
  if(DEMO&&k){const P=demoPfad(s),wackel=Math.sin(Date.now()/2300+s.length)*.0004;if(!P)return k.p*(1+Math.sin(Date.now()/9000+s.length)*.0025+Math.sin(Date.now()/31000+s.charCodeAt(0))*.004);
    const step=(Date.now()-P.t0)/(5*6e4/RAFFER),i=Math.min(P.path.length-1,Math.floor(step)),j=Math.min(P.path.length-1,i+1),fr=Math.min(1,step-i),v=P.path[i]+(P.path[j]-P.path[i])*fr;
    return P.p0*(1+P.d*v/100+wackel)}return k?k.p:null}

const xT=x=>x&&x.T!=null?+x.T:+E.T,xS=x=>x&&x.S!=null?+x.S:+E.S;
const pausiert=s=>(M.pause||{})[s]>Date.now(),gelaufen=x=>{const p=preis(x.s)??x.p0;return dOf(x)*(p/x.p0-1)*100};
const dOf=x=>x&&x.dir==="short"?-1:1,istShort=x=>x&&x.dir==="short";
const dirB=x=>`<span class="dirb ${istShort(x)?"s":"l"}">${istShort(x)?"SHORT ↘":"LONG ↗"}</span>`;
/* ---------- Verkaufshilfe: Stand einer Position und Empfehlung Halten/Verkaufen ---------- */
const HIST={}; // Verlauf des Netto-Gewinns je Position (nur solange die App offen ist)
function stand(x){const p=preis(x.s)??x.basis,zu=(D&&D.markt&&D.markt[x.m]&&D.markt[x.m].zu)||0,s=KERN.stand(E,x,p,zu,Date.now(),DEMO?null:FAELLE);x.peak=s.peak;x.peakU=s.peakU;return s}
// [Farbe, großes Wort, Überschrift]
const TUN={ko:["raus","KNOCK-OUT","Zertifikat ist wertlos"],konah:["raus","SOFORT VERKAUFEN","Knock-out ist nah!"],dreht:["raus","VERKAUFEN","Lieber jetzt sichern"],halten:["halten","HALTEN","Läuft nach Plan"],ziel:["gut","VERKAUFEN","Ziel erreicht 🎯"],stop:["raus","VERKAUFEN","Stop erreicht"],
  schmilzt:["raus","VERKAUFEN","Gewinn schmilzt"],sinkt:["acht","ACHTUNG","Gewinn geht zurück"],zeit:["acht","DU ENTSCHEIDEST","Richtzeit erreicht"],schluss:["acht","ACHTUNG","Börse schließt bald"]};
function grund(x,s){const zb=(x.T-s.u);return {halten:`Noch ${nf(Math.max(0,zb),2)} % ${istShort(x)?"Fall":"Anstieg"} der Aktie bis zum Ziel (dann ≈ ${eu(nachSt(s.zielE))}). Ich melde mich, wenn du raus solltest.`,
  ziel:`Die Aktie ist ${istShort(x)?"um "+nf(x.T,1)+" % gefallen":"um "+nf(x.T,1)+" % gestiegen"} – Ziel geschafft. Gewinn jetzt mitnehmen, nicht gierig werden.`,
  stop:`Die Aktie ist ${istShort(x)?"um "+nf(x.S,1)+" % gestiegen":pz(-x.S,1)+" gefallen"}. Raus, damit der Verlust mit Hebel nicht größer wird.`,
  dreht:s.gedreht?`Die Aktie war schon ${pz(x.peakU,2)} Richtung Ziel und dreht zurück (jetzt ${pz(s.u,2)}). Die Chance aufs Ziel ist auf ${Math.round(s.pZ*100)} % gefallen – weiter halten bringt im Schnitt weniger als jetzt sicher ${eu(s.jetztE)}.`:`Die Chance aufs Ziel ist nur noch ${Math.round(s.pZ*100)} %. Jetzt verkaufen sichert ${eu(s.jetztE)} – weiter halten bringt im Schnitt nur ${eu(s.evHalt)}.`,
  schmilzt:`Bester Stand war ${eu(s.peakE)}, jetzt nur noch ${eu(s.net)}. Raus, bevor es ins Minus dreht.`,
  sinkt:s.linieE!=null?`Bester Stand war ${eu(s.peakE)}. Noch halten – fällt es unter ${eu(s.linieE)}, sage ich „Verkaufen“.`:`Halten bringt gerade kaum mehr als verkaufen. Ich sage dir, sobald verkaufen klar besser ist.`,
  zeit:`Bis hierhin kam das Ziel meistens schon. Ab jetzt ist es deine Entscheidung: ${s.net>0?"Plus mitnehmen oder weiter halten":"halten oder Verlust klein halten"}. Gewinn- und Verlustschutz laufen weiter.`,
  ko:`Die Aktie hat die Knock-out-Schwelle ${kurs(s.ko,x.cur)} erreicht. Das Zertifikat ist wertlos – in Trade Republic prüfen und als verkauft eintragen.`,konah:`Nur noch ${pz(s.koAbst,2).replace("+","")} bis zum Knock-out bei ${kurs(s.ko,x.cur)}. Dort ist alles weg. Sofort raus!`,
  schluss:`Faktor-Zertifikate über Nacht sind riskant: Der Kurs kann morgens mit einem Sprung starten. Halten nur bewusst.`}[s.st]}

/* ---------- Dip-Einstieg: nicht sofort kaufen, sondern beim typischen Rücksetzer (Limit) ---------- */
// Der Bot misst in der Rückschau: Wie weit fiel der Kurs nach so einem Signal meist noch, bevor er zum Ziel lief (tief, in %),
// wie oft kam dieser Rücksetzer überhaupt (q) und wie viel sicherer war der Einstieg dort (plus). Kommt der Dip nicht, gibt es keinen Trade.
const ED={};
function dipRechnung(x,f){const T=xT(x),S=xS(x),echt=x.dip16?x.dip16[gi(T,S)]:null,dp=echt?{tief:echt.tief,q:echt.q,p:echt.p}:x.dip;if(!dp)return null;x.dip=x.dip||dp;const d=dOf(x),ein=KF&&KF.id===x.id?KF.ein:E.einsatz,k=kostenF(f,ein);
  const lim=x.p0*(1-d*dp.tief/100),zl=x.p0*(1+d*T/100),st=x.p0*(1-d*S/100),Te=d*(zl/lim-1)*100,Se=d*(lim/st-1)*100,b0=bewerte(x,T,S,f,ein);
  if(b0.keine)return null;const p=dp.p!=null?dp.p:Math.min(.92,b0.p+dp.plus),pl=Math.max(0,1-p-b0.pt),win=f*Te-k,loss=-f*Se-k,ev=p*win+pl*loss-b0.pt*k,eur=v=>ein*v/100;
  return {tief:dp.tief,lim,Te,Se,p,q:dp.q,min:dp.min,eWin:nachSt(eur(win)),eLoss:eur(loss),eEv:nachSt(eur(ev)),mehr:nachSt(eur(win))-b0.eWin,b0}}
function dipBox(x,f){const r=dipRechnung(x,f);if(!r)return "";const m=ED[x.id]||"sofort",p=preis(x.s)??x.p0,d=dOf(x),erreicht=d*(p-r.lim)<=0;
  return `<div class="dipw"><div class="seg dseg"><button data-ed="${x.id}:sofort" class="${m==="sofort"?"on":""}">Sofort kaufen</button><button data-ed="${x.id}:dip" class="${m==="dip"?"on":""}">Im Dip kaufen ${r.mehr>0?`<em>+${nf(r.mehr,0)} €</em>`:""}</button></div>
   ${m==="dip"?`<div class="dipinfo ${erreicht?"da":""}"><b>${erreicht?"🚨 DIP ERREICHT – jetzt kaufen":`Limit ${kurs(r.lim,x.cur)} setzen`}</b><small>In ${Math.round(r.q*100)} % der Fälle kam der Kurs erst um ${pz(-d*r.tief,2)} zurück${r.min?`, meist innerhalb ~${r.min} Min.`:""}. Dort eingestiegen: ${Math.round(r.p*100)} % Treffer, Gewinn ${eu(r.eWin)} statt ${eu(r.b0.eWin)}. In ${100-Math.round(r.q*100)} % kam der Dip nicht – dann verpasst du den Trade.</small></div>`:`<p class="small muted" style="margin:6px 2px 0">Tipp: In ${Math.round(r.q*100)} % der Fälle kam vorher noch ein Rücksetzer von ${pz(-d*r.tief,2)}.</p>`}</div>`}

/* ---------- Bausteine ---------- */
function ring(p,gross){const C=2*Math.PI*24,o=C*(1-p);return `<div class="ring ${ampel(p)} ${gross?"gross":""}"><svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="24" class="bg"/><circle cx="28" cy="28" r="24" class="v" style="--o:${o.toFixed(1)}"/></svg><b>${Math.round(p*100)}<small>%</small></b><i>${ampelTxt(p)}</i></div>`}
function plan(x,b){const bis=x.bis,start=Math.min(Math.max(Date.now(),x.t),bis),ende=x.zu||bis+4*36e5,raus=Math.min(start+(E.halt>0?Math.min(b.richt,E.halt):b.richt)*6e4,ende-15*6e4),zielT=Math.min(start+b.min*6e4,raus);return {bis,zielT,raus,ende,start}}
function eilBox(x){const rest=x.bis-Date.now(),tot=Math.max(1,x.bis-x.t);return `<div class="eil ${rest<=0?"weg":rest<4*6e4?"knapp":""}" data-cd="${x.id}"><i class="cdbar" style="width:${Math.max(0,rest/tot*100)}%"></i><span>${rest<=0?"⌛ Einstieg vorbei":"🚨 Jetzt kaufen"}</span><span class="cd">${rest>0?mmss(rest):""}</span></div>`}
function hebelChips(id,f,attr="hb"){return `<div class="hebel"><span>Hebel</span>${HEBEL.map(h=>`<button data-${attr}="${id}:${h}" class="${h===f?"on":""}">${h===1?"ohne":"×"+h}</button>`).join("")}</div>`}
function ergebnis(b,dip){return `<div class="erg"><div class="g"><i>🎯 Wenn Ziel</i><b>${eu(b.eWin)}</b></div><div class="r"><i>🛑 Wenn Stop</i><b>${eu(b.eLoss)}</b></div><div><i>${dip?"Ø wenn Dip kommt":"Ø pro Trade"}</i><b class="${kl(b.eEv)}">${eu(b.eEv)}</b></div></div>`}
function signalKarte(x,i=0,voll){const f=HB[x.id]??F(),b=bewerte(x,xT(x),xS(x),f),p=preis(x.s)??x.p0,d=dOf(x),weg=d*(p/x.p0-1)*100,zl=x.p0*(1+d*xT(x)/100),st=x.p0*(1-d*xS(x)/100),pl=plan(x,b),pz0=pausiert(x.s),alt=!!(M.beob&&M.beob[x.s]&&x.t<M.beob[x.s]),verp=weg>xT(x)*.35||alt,drin=M.pos.some(q=>q.s===x.s),stark=b.p>=E.minP/100&&b.ev>0&&(DEMO||b.t>=E.minT)&&x.bis>Date.now()&&!verp&&!drin&&!x.block;
  return `<div class="card sig ${RUHIG?"":"fade"} ${stark?"eilig":""}" style="--d:${i}" data-sig="${x.id}">
   <div class="kopf">${ring(b.p)}<div class="nm"><b>${esc(x.n)} ${dirB(x)}</b><span>${x.m==="us"?"🇺🇸":"🇪🇺"} ${esc(x.setupN)}</span></div>
    <div class="px"><span data-px="${esc(x.s)}">${kurs(p,x.cur)}</span><small class="${kl(weg)}">${pz(weg,2)} für dich</small></div></div>
   ${drin?`<div class="sperre">📌 Du bist schon drin<small>Kein zweiter Kauf derselben Aktie.</small></div>`:x.block?`<div class="sperre">⛔ Kein Einstieg<small>${esc(x.block)}</small></div>`:alt?`<div class="sperre">🔄 Altes Signal von vor deinem Verkauf<small>Ich rechne ${esc(x.n)} neu und schlage dir nur etwas vor, wenn es sich lohnt.</small></div>`:verp?`<div class="sperre">⏭ Verpasst – nicht hinterherkaufen<small>Schon ${pz(weg,2)} gelaufen. Der Platz bis zum Ziel fehlt, das Risiko oben zu kaufen ist hoch.</small></div>`:eilBox(x)}
   ${!drin&&!alt?dipBox(x,f):""}
   ${hebelChips(x.id,f)}
   ${ED[x.id]==="dip"&&dipRechnung(x,f)?ergebnis(dipRechnung(x,f),1):ergebnis(b)}
   <ol class="schritte">
    <li class="s1"><b>${uhr(pl.bis)}</b><span>${ED[x.id]==="dip"&&x.dip?`Limit: ${d<0?"Short-Zertifikat kaufen":"Kaufen"}, wenn die Aktie ${d<0?"auf":"auf"} <em>${kurs(dipRechnung(x,f).lim,x.cur)}</em> ${d<0?"steigt":"fällt"} – kommt der Dip nicht, auslassen`:`${d<0?"Short-Zertifikat kaufen":"Kaufen"}, solange die Aktie ${d<0?"über":"unter"} <em>${kurs(x.p0*(1+d*xT(x)*.25/100),x.cur)}</em> ist`}</span></li>
    <li class="s2"><b>~${uhr(pl.zielT)}</b><span>Verkaufen, wenn die Aktie ${d<0?"auf":"bei"} <em>${kurs(zl,x.cur)}</em> ${d<0?"fällt":"ist"} 🎯 · meist nach ${b.min} Min.</span></li>
    <li class="s3"><b>${uhr(pl.raus)}</b><span>Richtwert: bis ca. hier, danach entscheidest du</span></li>
    <li class="s4"><b>Stop</b><span>Sofort raus, wenn die Aktie ${d<0?"über":"unter"} <em>${kurs(st,x.cur)}</em> ${d<0?"steigt":"fällt"}</span></li></ol>
   ${x.news&&x.news.g==="negativ"?`<div class="hinweis">📰 Schlechte Nachricht heute: ${esc(x.news.list[0].t)}. Lieber auslassen.</div>`:""}
   <p class="small muted quote">${DEMO?`${Math.round(b.p*100)} von 100 ähnlichen Fällen erreichten das Ziel vor dem Stop (aus ${x.nS} Fällen).`:`Aus ${x.nT} echten Fällen: Ziel zuerst ${Math.round(b.pZiel*100)} %, Stop zuerst ${Math.round(b.pl*100)} %, sonst Richtzeit. Gewinn-Chance nach Kosten ${Math.round(b.p*100)} %. <b class="${b.t>=3?"up":b.t>=2?"":"warn"}">${b.t>=3?"Sehr gut belegt":b.t>=2?"Gut belegt":"Wenig belegt – Vorsicht"}</b> (t = ${nf(b.t,1)}).`}${d<0?" Short: Du gewinnst, wenn die Aktie fällt.":""}</p>
   ${voll?"":ED[x.id]==="dip"&&x.dip&&dOf(x)*((preis(x.s)??x.p0)-dipRechnung(x,f).lim)>0?`<div class="knoepfe"><button class="btn ghost" data-dipwarte="${x.id}">🔔 Dip abwarten – ich melde mich</button><button class="btn ghost" data-open="${x.id}">Details</button></div>`:`<div class="knoepfe"><button class="btn ${stark?"":"ghost"}" data-kauf="${x.id}">${E.ueb?"🧪 Übung kaufen":"Kaufen & überwachen"}</button><button class="btn ghost" data-open="${x.id}">Details</button></div><button class="lnk aehnl" data-arsig="${x.id}">🔍 So lief es in ähnlichen Fällen ›</button>`}</div>`}
function chart(x){const pts=x.spark||[];if(pts.length<2)return "";const W=600,H=170,ts=pts.map(p=>p[0]),t0=ts[0],t1=Math.max(ts[ts.length-1],x.bis||0);
  const dr=dOf(x),zl=x.p0*(1+dr*E.T/100),st=x.p0*(1-dr*E.S/100),ys=[...pts.map(p=>p[1]),...(x.vw||[]),zl,st],lo=Math.min(...ys),hi=Math.max(...ys),pad=(hi-lo)*.08||1;
  const X=t=>(t-t0)/(t1-t0||1)*(W-8)+4,Y=v=>H-6-(v-lo+pad)/(hi-lo+2*pad)*(H-12),line=a=>a.map((p,i)=>`${i?"L":"M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
  const hl=(v,c)=>`<line x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" stroke="${c}" stroke-width="1.5" stroke-dasharray="5 4"/>`,d=line(pts);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="cg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
   ${hl(zl,"var(--up)")}${hl(st,"var(--down)")}${hl(x.p0,"var(--muted)")}
   ${x.vw?`<path d="${line(x.vw.map((v,i)=>[pts[i]?pts[i][0]:t1,v]))}" fill="none" stroke="var(--warn)" stroke-width="1.5" opacity=".8"/>`:""}
   <path d="${d}L${X(pts[pts.length-1][0])},${H}L${X(pts[0][0])},${H}Z" fill="url(#cg)"/><path class="zeichne" d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.4" pathLength="1"/><circle class="puls" cx="${X(pts[pts.length-1][0])}" cy="${Y(pts[pts.length-1][1])}" r="5" fill="var(--accent)"/></svg>
   <div class="legende"><span><i style="border-color:var(--accent)"></i>Kurs heute</span><span><i style="border-color:var(--warn)"></i>Tagesschnitt</span><span><i style="border-color:var(--up);border-top-style:dashed"></i>Ziel</span><span><i style="border-color:var(--down);border-top-style:dashed"></i>Stop</span></div>`}
function sparkNet(x){const h=HIST[x.id]||[];if(h.length<3)return "";const W=300,H=46,lo=Math.min(0,...h),hi=Math.max(0,...h),r=hi-lo||1,X=i=>i/(h.length-1)*W,Y=v=>H-3-(v-lo)/r*(H-6);
  const d=h.map((v,i)=>`${i?"L":"M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(""),last=h[h.length-1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--muted)" stroke-dasharray="3 4" stroke-width="1"/><path d="${d}" fill="none" stroke="${last>=0?"var(--up)":"var(--down)"}" stroke-width="2"/></svg><div class="small muted" style="margin-top:-2px">Gewinn seit dem Kauf (Strich = 0 €)</div>`}
function kombiTabelle(x){const bs=sicherste(x);let h=`<table><tr><th>Ziel / Stop</th><th>Treffer</th><th>Gewinn</th><th>Verlust</th><th>Schnitt</th></tr>`;
  for(const T of GT)for(const S of GS){const b=bewerte(x,T,S),me=T===+E.T&&S===+E.S,best=bs&&bs.T===T&&bs.S===S;if(!me&&!best&&b.ev<=0&&(T+S)%1)continue;
    h+=`<tr class="${best?"best":""} ${me?"ich":""}"><td>${pz(T,T%1?2:0)} / ${pz(-S,S%1?2:0)}${best?" ✓":""}${me?" (du)":""}</td><td>${Math.round(b.p*100)} %</td><td class="up">${eu(b.eWin,0)}</td><td class="down">${eu(b.eLoss,0)}</td><td class="${kl(b.eEv)}">${eu(b.eEv)}</td></tr>`}
  return h+`</table><p class="small muted">✓ = höchste Trefferquote, bei der im Schnitt nach Kosten und Steuer noch etwas übrig bleibt. ${bs?`<button class="btn ghost" data-kombi="${bs.T}:${bs.S}" style="margin-top:6px">Diese Kombi für alle übernehmen</button>`:""}</p>`}

/* ---------- Seiten ---------- */
function seiteJetzt(){M.logged=M.logged||{};for(const x of D.signale||[])if(!M.logged[x.id+":"+x.t]){M.logged[x.id+":"+x.t]=1;const b=bewerte(x,xT(x),xS(x));logEintrag("signal",x.s,`Signal: ${x.n} ${istShort(x)?"SHORT":"LONG"} ${Math.round(b.p*100)} %`,{Muster:x.setupN,Trefferquote:Math.round(b.p*100)+" %","Ziel/Stop":pz(xT(x),2)+" / "+pz(-xS(x),2),Fälle:x.nS,Nachrichten:(x.news&&x.news.g)||"keine",Gründe:(x.warum||[]).join(" · ")})}const sig=(D.signale||[]).filter(x=>E.richtung==="beide"||(x.dir||"long")===E.richtung).map(x=>({x,b:bewerte(x,xT(x),xS(x),HB[x.id]??F())})),jetzt=Date.now();
  const gut=sig.filter(o=>o.x.bis>jetzt&&o.b.p>=E.minP/100&&o.b.ev>0&&(DEMO||o.b.t>=E.minT)&&!(o.x.news&&o.x.news.g==="negativ")&&!o.x.block&&gelaufen(o.x)<=xT(o.x)*.35&&!(M.beob&&M.beob[o.x.s]&&o.x.t<M.beob[o.x.s])&&!M.pos.some(p=>p.s===o.x.s)).sort((a,b)=>b.b.p-a.b.p);
  const rest=sig.filter(o=>!gut.includes(o)).sort((a,b)=>(b.x.bis>jetzt)-(a.x.bis>jetzt)||b.b.p-a.b.p);
  const offenM=["us","de"].filter(m=>D.markt&&D.markt[m]&&D.markt[m].offen),offenePos=M.pos.filter(x=>!!x.ueb===!!E.ueb);
  let h="";
  if(offenePos.length){const s=offenePos.map(x=>({x,s:stand(x)})),sum=s.reduce((a,o)=>a+o.s.net,0),raus=s.filter(o=>TUN[o.s.st][0]==="raus"||TUN[o.s.st][0]==="gut");
    h+=`<div class="card mini-pos ${raus.length?"alarm":""} fade" data-tab="meine"><div><b>${raus.length?`🚨 ${raus.length}× VERKAUFEN`:`${offenePos.length} offene${offenePos.length>1?"":"r"} Trade${offenePos.length>1?"s":""}`}</b><span class="small muted">${raus.length?raus.map(o=>esc(o.x.n)).join(", ")+" – jetzt ansehen":"Alles im Plan · tippen für Details"}</span></div><b class="${kl(sum)}">${eu(sum)}</b></div>`}
  h+=`<div class="haltinfo">⏱ ${E.halt>0?`Höchstens <b>${E.halt} Min.</b>`:`<b>Richtwert je Aktie</b>`} · Ziel ${pz(E.T,E.T%1?2:0)} · Stop ${pz(-E.S,E.S%1?2:0)} <button class="lnk" id="einst2">ändern</button></div><div class="seg rseg">${[["beide","Beide"],["long","LONG ↗"],["short","SHORT ↘"]].map(([k,t])=>`<button data-rich="${k}" class="${E.richtung===k?"on":""}">${t}</button>`).join("")}</div><h2>🚨 Jetzt einsteigen <span class="n">ab ${E.minP} % · ×${F()} · Ziel ${pz(E.T,E.T%1?2:0)} / Stop ${pz(-E.S,E.S%1?2:0)}</span></h2>`;
  h+=gut.length?gut.map((o,i)=>signalKarte(o.x,i)).join(""):`<div class="card leer fade"><div class="radar"></div><b>Gerade kein sicherer Einstieg.</b><p class="small muted">${offenM.length?"Ich suche laufend. Kein Trade ist besser als ein unsicherer Trade.":"Die Börsen sind zu. DAX ab 9:00 Uhr, USA ab 15:30 Uhr."}</p>${offenM.length?"":`<button class="btn voll" data-zrwahl style="margin-top:8px">⏪ Solange: einen echten Tag nachspielen</button>`}</div>`;
  if(rest.length)h+=`<details><summary>Weniger sicher, verpasst oder gesperrt (${rest.length})</summary>${rest.map((o,i)=>signalKarte(o.x,i)).join("")}</details>`;
  const em=empfohlen();
  if(em.length)h+=`<h2>⭐ Empfohlen heute <span class="n">beste Zeit je Aktie</span></h2><div class="card empfk">${em.map(empfZeile).join("")}<p class="small muted" style="margin-top:8px">Pro Aktie die halbe Stunde, in der ein Einstieg früher am öftesten geklappt hat (letzte 60 Handelstage, dein Ziel/Stop). <b>JETZT</b> = Fenster offen und Kurs nicht überhitzt. <b>ZU HEISS</b> = im Fenster, aber schon zu weit gelaufen. Ich warte dann auf einen Rücksetzer und melde mich.</p></div>`;
  const ks=Object.entries(D.kurse||{}).map(([s,k])=>({s,...k,ch:chanceJetzt(s,k.m)})).map(k=>({...k,c:k.ch?k.ch.c:null})).sort((a,b)=>(b.c??0)-(a.c??0));
  h+=`<h2>👀 Beobachten <span class="n">Chance, wenn du jetzt kaufst</span></h2><div class="card fade" style="--d:3">${ks.map(k=>`<div class="row" data-ksheet="${esc(k.s)}"><div class="nm"><b>${esc(k.n)}</b><span>${k.m==="us"?"🇺🇸":"🇪🇺"} <span class="${kl(k.dp)}">${pz(k.dp)} heute</span></span></div><span class="px">${kurs(preis(k.s)??k.p,k.cur)}</span>${k.c!=null?`<span class="mini ${ampel(k.c)}">${k.ch.dir==="short"?"↘":"↗"} ${Math.round(k.c*100)} %</span>`:""}</div>`).join("")}</div>
   <p class="small muted">Prozent = wie oft ein Einstieg zu dieser Uhrzeit früher dein Ziel vor dem Stop erreicht hat, ohne Signal. ↗ = Long besser, ↘ = Short besser. Tippen zeigt den Kurs-Chart.</p>`;
  return h}
/* ---------- Empfohlen: beste Zeitfenster je Aktie, mit Timer ---------- */
function slotZeit(m,i){const sl=Z.slots[m][i];if(DEMO){const b=Math.floor(Date.now()/18e5)*18e5-2*18e5;return b+i*18e5}const [h,mi]=sl.split(":").map(Number),d=new Date();d.setHours(h,mi,0,0);return +d}
function empfohlen(){if(!Z||!D)return [];const jetzt=Date.now(),g=gi(E.T,E.S),out=[];
  for(const [s,k] of Object.entries(D.kurse||{}))for(const dir of ["long","short"]){if(E.richtung!=="beide"&&E.richtung!==dir)continue;const r=zq(dir).sym[s];if(!r)continue;
    let best=null;r.forEach((o,i)=>{const [n,w]=o[g]||[0,0],a=slotZeit(k.m,i),b=a+18e5;if(n<30||b<=jetzt)return;const q=w/n;if(!best||q>best.q)best={q,n,a,b,i}});
    if(!best||best.q<E.minP/100)continue;
    const heiss=dir==="long"?(k.vwAbst>.8||k.rsi>70):(k.vwAbst<-.8||k.rsi<30);
    const st=jetzt<best.a?"warte":heiss?"heiss":"jetzt";out.push({s,k,dir,...best,st})}
  const bestJe=new Map();for(const o of out.sort((a,b)=>b.q-a.q))if(!bestJe.has(o.s))bestJe.set(o.s,o);
  return [...bestJe.values()].sort((a,b)=>(a.st==="jetzt"?0:1)-(b.st==="jetzt"?0:1)||b.q-a.q).slice(0,6)}
function empfZeile(o,i){const k=o.k,x={dir:o.dir},jetzt=Date.now();
  const txt=o.st==="jetzt"?`<span class="fst jetzt">JETZT</span><span class="fcd" data-fen="${o.b}" data-pre="noch ">noch ${mmss(o.b-jetzt)}</span>`:o.st==="warte"?`<span class="fst warte">WARTEN</span><span class="fcd" data-fen="${o.a}" data-pre="öffnet in ">öffnet in ${mmss(o.a-jetzt)}</span>`:`<span class="fst heiss">ZU HEISS</span><span class="fcd">warte auf Rücksetzer</span>`;
  return `<div class="empf fade ${o.st}" style="--d:${i}" data-ksheet="${esc(o.s)}"><div class="nm"><b>${esc(k.n)} ${dirB(x)}</b><span>Bestes Fenster <b>${uhr(o.a)}–${uhr(o.b)}</b> · ${Math.round(o.q*100)} % aus ${o.n}</span>
   ${o.st==="heiss"?`<span class="small warn">${o.dir==="long"?`Schon ${pz(k.vwAbst,1)} über dem Tagesschnitt`:`Schon ${pz(k.vwAbst,1)} unter dem Tagesschnitt`}${k.rsi>70||k.rsi<30?` · RSI ${k.rsi}`:""}. Nicht oben kaufen.</span>`:""}</div><div class="fr">${txt}</div></div>`}
function slotJetzt(m){const sl=Z&&Z.slots&&Z.slots[m];if(!sl)return -1;const z=new Date(),min=z.getHours()*60+z.getMinutes();let k=-1;sl.forEach((t,i)=>{const [a,b]=t.split(":").map(Number);if(min>=a*60+b)k=i});return DEMO?2:k}
const zq=dir=>dir==="short"?{markt:(Z.short||{}).markt||{},sym:(Z.short||{}).sym||{}}:{markt:Z.markt||{},sym:Z.sym||{}};
function chanceDir(s,m,dir){const r=Z&&zq(dir).sym[s],k=slotJetzt(m);if(!r||k<0||!r[k])return null;const [n,w]=r[k][gi(E.T,E.S)];return n?w/n:null}
function chanceJetzt(s,m){const l=E.richtung==="short"?null:chanceDir(s,m,"long"),k=E.richtung==="long"?null:chanceDir(s,m,"short");if(l==null&&k==null)return null;return (k??-1)>(l??-1)?{c:k,dir:"short"}:{c:l,dir:"long"}}
function seiteZeiten(){if(!Z)return `<div class="card">Die Zeiten-Statistik kommt mit dem ersten Lauf des Bots am Morgen.</div>`;
  const m=zMarkt,sl=Z.slots[m],g=gi(E.T,E.S),q=zq(zDir),quelle=zSym&&q.sym[zSym]?q.sym[zSym]:(q.markt[m]||[]),k=slotJetzt(m);
  const werte=sl.map((t,i)=>{const [n,w]=(quelle[i]||[])[g]||[0,0];return {t,n,q:n?w/n:null}}),gueltig=werte.filter(v=>v.q!=null&&v.n>=30),best=gueltig.slice().sort((a,b)=>b.q-a.q)[0],schlecht=gueltig.slice().sort((a,b)=>a.q-b.q)[0];
  const syms=Object.entries(D.kurse||{}).filter(([,v])=>v.m===m);
  const bis=t=>{const [a,b]=t.split(":").map(Number),x=a*60+b+30;return `${String(x/60|0).padStart(2,"0")}:${String(x%60).padStart(2,"0")}`};
  return `<div class="seg"><button data-zm="us" class="${m==="us"?"on":""}">🇺🇸 USA</button><button data-zm="de" class="${m==="de"?"on":""}">🇪🇺 Europa</button></div><div class="seg"><button data-zd="long" class="${zDir==="long"?"on":""}">LONG ↗ (steigt)</button><button data-zd="short" class="${zDir==="short"?"on":""}">SHORT ↘ (fällt)</button></div>
   <label class="f">Aktie<select id="zsym"><option value="">Alle Aktien zusammen</option>${syms.map(([s,v])=>`<option value="${esc(s)}" ${s===zSym?"selected":""}>${esc(v.n)}</option>`).join("")}</select></label>
   ${best?`<div class="card" style="margin-top:12px"><b>Am sichersten: ${DEMO?uhr(slotZeit(m,sl.indexOf(best.t)))+"–"+uhr(slotZeit(m,sl.indexOf(best.t))+18e5):best.t+"–"+bis(best.t)} Uhr</b><p class="small">${zDir==="short"?"Short-Einstieg":"Kauf"} in dieser halben Stunde: <b class="up">${Math.round(best.q*100)} %</b> erreichten das Ziel (${zDir==="short"?"Aktie":""} ${pz((zDir==="short"?-1:1)*E.T,E.T%1?2:0)}) vor dem Stop. ${schlecht?`Finger weg um ${schlecht.t} Uhr (${Math.round(schlecht.q*100)} %).`:""}</p></div>`:""}
   <div class="card">${werte.map((v,i)=>`<div class="slot ${i===k?"jetzt":""}"><span>${DEMO?uhr(slotZeit(m,i)):v.t}${i===k?" ◀":""}</span><div class="sb"><i style="width:${v.q!=null?v.q*100:0}%;background:${v.q==null?"none":v.q>=.65?"var(--up)":v.q>=.55?"var(--warn)":"var(--muted)"}"></i><em style="left:50%"></em></div><b>${v.q!=null?Math.round(v.q*100)+" %":"–"}</b></div>`).join("")}
   <p class="small muted">Balken = wie oft ein Kauf in dieser halben Stunde (letzte 60 Handelstage) dein Ziel vor dem Stop erreicht hat. Strich = 50 %. Ohne Signal, nur die Uhrzeit.</p></div>`}
function seiteMeine(){const pos=M.pos.filter(x=>!!x.ueb===!!E.ueb);let h="";
  if(E.ueb){const ver=M.verkauft.filter(v=>v.ueb),gew=ver.reduce((a,v)=>a+v.net,0),gebunden=pos.reduce((a,x)=>a+x.stk*x.kaufZ,0),offen=pos.reduce((a,x)=>a+stand(x).net,0);
    h+=`<div class="konto fade"><div><i>🧪 Übungskonto</i><b>${nf(E.konto+gew+offen,2)} €</b></div><div><i>Gewinn verkauft</i><b class="${kl(gew)}">${eu(gew)}</b></div><div><i>Offen</i><b class="${kl(offen)}">${eu(offen)}</b></div></div>`}
  if(E.ueb)h+=`<button class="btn voll zrbtn" data-zrwahl>⏪ Echten Tag nachspielen</button>`;
  h+=`<h2>${E.ueb?"Übungs-Trades":"💶 Echte Trades"} <span class="n">${pos.length} offen</span></h2>`;
  h+=pos.length?pos.map((x,i)=>posKarte(x,i)).join(""):`<div class="card leer fade"><b>Nichts offen.</b><p class="small muted">Unter „Jetzt“ auf ${E.ueb?"„Übung kaufen“":"„Kaufen & überwachen“"} tippen. Dann sage ich dir hier und in Telegram, ob du halten oder verkaufen sollst.</p></div>`;
  const ver=M.verkauft.filter(v=>!!v.ueb===!!E.ueb).slice(-15).reverse();
  if(ver.length)h+=`<h2>Verkauft</h2><div class="card"><table><tr><th>Aktie</th><th>Aktie</th><th>Netto</th></tr>${ver.map(v=>`<tr><td>${esc(v.n)}<br><span class="small muted">${new Date(v.t).toLocaleDateString("de-DE")} ${uhr(v.t)}</span></td><td class="${kl(v.u)}">${pz(v.u,2)}</td><td class="${kl(v.net)}">${eu(v.net)}</td></tr>`).join("")}</table></div>`;
  return h}
function posKarte(x,i=0){const s=stand(x),t=TUN[s.st],cur=(D.kurse[x.s]||{}).cur||x.cur,lo=-x.S,hi=x.T,L=v=>Math.max(0,Math.min(100,(v-lo)/(hi-lo)*100)),rest=x.bis?x.bis-Date.now():0;
  return `<div class="card pos ${RUHIG?"":"fade"} st-${t[0]}" style="--d:${i}">
   <div class="kopf"><div class="nm"><b>${esc(x.n)} ${dirB(x)}${x.ueb?" 🧪":""}</b><span>${x.f>1?`Hebel ×${x.f}`:"ohne Hebel"} · ${nf(s.einsatz,0)} € · seit ${uhr(x.t)}</span></div>
    <div class="px"><span class="gross ${kl(s.net)}">${eu(s.net)}</span><small class="${kl(s.netP)}">${pz(s.netP,1)} netto</small></div></div>
   <div class="emp ${t[0]}"><div class="wort">${t[1]}</div><div><b>${t[2]}</b><small>${grund(x,s)}</small></div></div>
   <div class="hv"><div class="hv1"><i>Jetzt verkaufen</i><b class="${kl(s.jetztE)}">${eu(s.jetztE)}</b><small>sicher</small></div><div class="hvvs">vs</div><div class="hv2"><i>Weiter halten</i><b class="${kl(s.evHalt)}">Ø ${eu(s.evHalt)}</b><small><span class="up">Ziel ${Math.round(s.pZ*100)} %</span> · <span class="down">Stop ${Math.round(s.pS*100)} %</span></small></div></div>
   <div class="hvbar"><i class="z" style="width:${s.pZ*100}%"></i><i class="o" style="width:${(1-s.pZ-s.pS)*100}%"></i><i class="s" style="width:${s.pS*100}%"></i></div>
   ${sparkNet(x)}
   <div class="balken"><div class="be" style="left:${L(s.beU)}%"></div><div class="ich" style="left:${L(s.u)}%"></div></div>
   <div class="blab"><span>🛑 ${eu(s.stopE,0)}</span><span>Aktie ${pz(dOf(x)*s.u,2)} · ${kurs(s.p,cur)}</span><span>🎯 ${eu(nachSt(s.zielE),0)}</span></div>
   ${s.ko?`<div class="koinfo ${s.koAbst<3?"nah":""}">💥 Knock-out bei <b>${kurs(s.ko,cur)}</b> · noch <b>${pz(s.koAbst,2).replace("+","")}</b> Abstand · Hebel jetzt <b>×${nf(Math.min(s.hebelJetzt,999),1)}</b></div>`:""}
   <div class="infos"><div><i>Bester Stand</i><b class="${kl(s.peakE)}">${eu(s.peakE)}</b></div><div><i>Verkaufen unter</i><b>${s.linieE!=null?eu(s.linieE):"–"}</b><small>${s.linieE!=null?"Gewinnschutz":"ab halbem Ziel"}</small></div>
    <div><i>Richtwert bis</i><b>${x.bis?uhr(x.bis):"–"}</b><small data-rest="${x.id}">${x.bis?(rest>0?"noch "+mmss(rest):"du entscheidest"):""}</small></div></div>
   <div class="knoepfe"><button class="btn ${t[0]==="raus"?"rot":t[0]==="gut"?"":"ghost"}" data-vk="${x.id}">${x.ueb?"Übung verkaufen":"Verkauft – eintragen"}</button><button class="btn ghost klein" data-del="${x.id}">Löschen</button></div></div>`}
function seiteBilanz(){const g=gi(E.T,E.S),st=D.setups||{},bil=D.bilanz||[];
  let h=`<h2>Wie gut sind die Einstiege? <span class="n">Ziel ${pz(E.T,E.T%1?2:0)} / Stop ${pz(-E.S,E.S%1?2:0)}</span></h2><div class="card"><table><tr><th>Einstieg</th><th>Fälle</th><th>Ziel zuerst</th><th>Stop zuerst</th></tr>`;
  for(const [k,v] of Object.entries(st)){const [n,w,l]=v.st[g]||[0,0,0];h+=`<tr><td>${esc(v.n)}</td><td>${n}</td><td class="up">${n?Math.round(w/n*100):"–"} %</td><td class="down">${n?Math.round(l/n*100):"–"} %</td></tr>`}
  h+=`</table><p class="small muted">Rückblick: alle Einstiege der letzten 60 Handelstage, nachgerechnet mit 5-Minuten-Kursen. Treffen Ziel und Stop in derselben 5 Minuten, zählt es als Stop.</p></div>`;
  const live=bil.map(b=>b.res[g]),n=live.length,w=live.filter(r=>r===1).length,l=live.filter(r=>r===-1).length;
  h+=`<h2>Seit Start echt mitgezählt</h2><div class="kz"><div><i>Signale</i><b>${n}</b></div><div><i>Ziel zuerst</i><b class="up">${n?Math.round(w/n*100):"–"} %</b></div><div><i>Stop zuerst</i><b class="down">${n?Math.round(l/n*100):"–"} %</b></div><div><i>Zeit um</i><b>${n?Math.round((n-w-l)/n*100):"–"} %</b></div></div>
   <p class="small muted">Jedes Signal wird nach Börsenschluss geprüft. Liegt diese Zahl deutlich unter dem Rückblick, ist die Rechnung gerade nicht verlässlich.</p>`;
  for(const ue of [false,true]){const v=M.verkauft.filter(x=>!!x.ueb===ue);if(!v.length)continue;const s=v.reduce((a,x)=>a+x.net,0),gw=v.filter(x=>x.net>0).length;
    h+=`<h2>${ue?"🧪 Deine Übung":"💶 Deine echten Trades"}</h2><div class="kz"><div><i>Trades</i><b>${v.length}</b></div><div><i>Gewonnen</i><b>${Math.round(gw/v.length*100)} %</b></div><div><i>Summe netto</i><b class="${kl(s)}">${eu(s)}</b></div><div><i>Schnitt</i><b class="${kl(s)}">${eu(s/v.length)}</b></div></div>`}
  return h}

/* ---------- Kurs-Chart: nah dran (15 Min., 1 Std.) bis weit weg (5 Tage, 1 Monat) ---------- */
const RANGES=[["15m","15 Min."],["1h","1 Std."],["1d","Heute"],["5d","5 Tage"],["1M","1 Monat"]],KR={},KPTS={};
const RCFG={"15m":[30,30e3,.0005],"1h":[60,6e4,.0008],"1d":[84,3e5,.0016],"5d":[70,18e5,.003],"1M":[22,864e5,.013]};
function verlauf(s,r){const k=D.kurse[s]||{},jetzt=Date.now(),p=preis(s)??k.p;
  if(!DEMO){const V=VERL[s];if(!V)return [];const tag=V["1d"]||[],a=r==="15m"?tag.slice(-4):r==="1h"?tag.slice(-13):(V[r]||[]).slice();if(p&&a.length&&(r==="15m"||r==="1h"||r==="1d")&&jetzt-a[a.length-1][0]<30*6e4)a.push([jetzt,p]);return a}
  const [n,step,sig]=RCFG[r],rnd=seed([...(s+r)].reduce((a,c)=>a*31+c.charCodeAt(0)|0,7)),out=[[jetzt,p]];let v=p;const trend=((k.dp||0)/100)/(r==="1d"?n:r==="5d"?n/3:n*4);
  const t0=r==="15m"||r==="1h"?Math.floor(jetzt/step)*step:jetzt;for(let i=1;i<n;i++){v=v/(1+trend+(rnd()-.5)*2*sig);out.unshift([t0-i*step,+v.toFixed(3)])}return out}
function zeitLabel(t,r){const d=new Date(t);return r==="5d"?d.toLocaleDateString("de-DE",{weekday:"short"})+" "+uhr(t):r==="1M"?d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"}):uhr(t)}
async function verlaufLaden(){if(DEMO||Date.now()-VERL_T<6e4)return;VERL_T=Date.now();try{VERL=await hole("verlauf.json");$$(".kc").forEach(b=>{const sy=b.dataset.kc,x=(D.signale||[]).find(y=>y.id===offen);b.querySelector(".kc-in").innerHTML=kursSvg(sy,KR[sy]||(x?"1h":"1d"),x&&x.s===sy?x:null)})}catch(e){}}
function kursChart(s,x){verlaufLaden();const r=KR[s]||(x?"1h":"1d"),k=D.kurse[s]||{},cur=k.cur||(x&&x.cur);
  return `<div class="kc" data-kc="${esc(s)}"><div class="seg kseg">${RANGES.map(([id,t])=>`<button data-kr="${esc(s)}:${id}" class="${r===id?"on":""}">${t}</button>`).join("")}</div><div class="kc-in">${kursSvg(s,r,x)}</div></div>`}
function kursSvg(s,r,x){const pts=verlauf(s,r);KPTS[s]={pts,r,cur:(D.kurse[s]||{}).cur||(x&&x.cur)};if(pts.length<2)return `<p class="small muted">Für diesen Zeitraum liefert der Bot noch keine Kurse.</p>`;
  const W=600,H=190,ys=pts.map(p=>p[1]),nah=x&&["15m","1h","1d"].includes(r),d=x?dOf(x):1,zl=x&&x.p0*(1+d*E.T/100),st=x&&x.p0*(1-d*E.S/100);
  const alle=nah?[...ys,zl,st,x.p0]:ys,lo=Math.min(...alle),hi=Math.max(...alle),pad=(hi-lo)*.1||1,t0=pts[0][0],t1=pts[pts.length-1][0];
  const X=t=>(t-t0)/(t1-t0||1)*(W-10)+5,Y=v=>H-8-(v-lo+pad)/(hi-lo+2*pad)*(H-16),line=pts.map((p,i)=>`${i?"L":"M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
  const ch=(ys[ys.length-1]/ys[0]-1)*100,col=ch>=0?"var(--up)":"var(--down)",cur=KPTS[s].cur,iH=ys.indexOf(Math.max(...ys)),iL=ys.indexOf(Math.min(...ys));
  const hl=(v,c,t)=>`<line x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" stroke="${c}" stroke-width="1.3" stroke-dasharray="5 4"/><text x="${W-4}" y="${Y(v)-4}" text-anchor="end" fill="${c}" font-size="13" font-weight="700">${t}</text>`;
  const sw=ys.slice(1).map((v,i)=>Math.abs(v/ys[i]-1)*100),schw=sw.reduce((a,b)=>a+b,0)/Math.max(1,sw.length);
  return `<div class="kstat"><div><i>${RANGES.find(z=>z[0]===r)[1]}</i><b class="${kl(ch)}">${pz(ch,2)}</b></div><div><i>Hoch</i><b>${kurs(ys[iH],cur)}</b></div><div><i>Tief</i><b>${kurs(ys[iL],cur)}</b></div><div><i>Ø Schritt</i><b>±${nf(schw,2)} %</b></div></div>
   <div class="kbox"><svg class="kchart" data-ks="${esc(s)}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="kg-${esc(s).replace(/\W/g,"")}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".32"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${[.25,.5,.75].map(f=>`<line x1="0" x2="${W}" y1="${H*f}" y2="${H*f}" stroke="var(--line)" stroke-width="1"/>`).join("")}
    ${nah?hl(zl,"var(--up)","Ziel")+hl(st,"var(--down)","Stop")+hl(x.p0,"var(--muted)","Einstieg"):""}
    <path d="${line}L${X(t1)},${H}L${X(t0)},${H}Z" fill="url(#kg-${esc(s).replace(/\W/g,"")})"/><path class="zeichne" d="${line}" fill="none" stroke="${col}" stroke-width="2.4" pathLength="1" stroke-linejoin="round"/>
    <circle class="puls" cx="${X(t1)}" cy="${Y(ys[ys.length-1])}" r="5" fill="${col}"/>
    <g class="kx" style="display:none"><line y1="0" y2="${H}" stroke="var(--fg)" stroke-width="1" opacity=".6"/><circle r="5" fill="var(--fg)"/></g></svg>
    <div class="ktip" hidden></div></div>
   <div class="kach"><span>${zeitLabel(t0,r)}</span><span>${zeitLabel(t0+(t1-t0)/2,r)}</span><span>${r==="15m"||r==="1h"||r==="1d"?"jetzt":zeitLabel(t1,r)}</span></div>
   <p class="small muted">Finger auf den Chart legen und ziehen zeigt Kurs und Uhrzeit.${!DEMO&&istEU(s)?" DAX-Kurse: Lang & Schwarz (wie Trade Republic).":""}</p>`}
const istEU=s=>/\.[A-Z]{1,3}$/.test(s);
function kursSheet(s){const k=D.kurse[s];if(!k)return;offen=null;const c=chanceJetzt(s,k.m);
  sheet(`<div class="kopf"><div class="nm"><b style="font-size:20px">${esc(k.n)}</b><span>${k.m==="us"?"🇺🇸":"🇪🇺"} ${esc(s)} · <span class="${kl(k.dp)}">${pz(k.dp)} heute</span></span></div><div class="px"><span data-px2="${esc(s)}" style="font-size:20px;font-weight:700">${kurs(preis(s)??k.p,k.cur)}</span></div></div>
   <div class="card" style="margin-top:12px">${kursChart(s)}</div>
   ${c?`<div class="card"><b>Chance jetzt: ${c.dir==="short"?"SHORT ↘":"LONG ↗"} ${Math.round(c.c*100)} %</b><p class="small muted">Wie oft ein Einstieg um diese Uhrzeit früher dein Ziel vor dem Stop erreicht hat.</p><button class="btn ghost voll" data-zsym="${esc(s)}" data-zdir="${c.dir}">Beste Zeiten für ${esc(k.n)} ansehen</button></div>`:""}
   <button class="btn voll" data-was="${esc(s)}">🤔 Long, Short oder Abwarten? Jetzt prüfen</button><button class="btn ghost voll" data-zu>Schließen</button>`)}
function scrub(svg,ev){const s=svg.dataset.ks,K=KPTS[s];if(!K||!K.pts.length)return;const rc=svg.getBoundingClientRect(),fx=Math.max(0,Math.min(1,(ev.clientX-rc.left)/rc.width)),pts=K.pts,t0=pts[0][0],t1=pts[pts.length-1][0],t=t0+fx*(t1-t0);
  let i=0;for(let j=0;j<pts.length;j++)if(Math.abs(pts[j][0]-t)<Math.abs(pts[i][0]-t))i=j;const vb=svg.viewBox.baseVal,ys=pts.map(p=>p[1]);
  const x=(pts[i][0]-t0)/(t1-t0||1)*(vb.width-10)+5,g=svg.querySelector(".kx"),tip=svg.parentNode.querySelector(".ktip");
  const lo=+svg.dataset.lo,hi=+svg.dataset.hi;g.style.display="";g.querySelector("line").setAttribute("x1",x);g.querySelector("line").setAttribute("x2",x);
  const circ=svg.querySelectorAll("path")[1],len=null;g.querySelector("circle").setAttribute("cx",x);
  const p0=pts[0][1],ch=(pts[i][1]/p0-1)*100;tip.hidden=false;tip.innerHTML=`<b>${kurs(pts[i][1],K.cur)}</b> <span class="${kl(ch)}">${pz(ch,2)}</span><br><span>${zeitLabel(pts[i][0],K.r)}</span>`;
  tip.style.left=Math.max(0,Math.min(rc.width-130,fx*rc.width-65))+"px";
  // y des Punkts: aus dem gezeichneten Pfad ablesen
  const d=svg.querySelectorAll("path")[1].getAttribute("d").split(/[ML]/).filter(Boolean)[i];if(d)g.querySelector("circle").setAttribute("cy",d.split(",")[1]);try{navigator.vibrate&&i!==scrub.i&&navigator.vibrate(3)}catch(e){}scrub.i=i}
document.addEventListener("pointerdown",e=>{const svg=e.target.closest&&e.target.closest(".kchart");if(!svg)return;scrub.on=svg;svg.setPointerCapture&&svg.setPointerCapture(e.pointerId);scrub(svg,e)});
document.addEventListener("pointermove",e=>{if(scrub.on)scrub(scrub.on,e)});
document.addEventListener("pointerup",()=>{if(!scrub.on)return;const svg=scrub.on;scrub.on=null;setTimeout(()=>{if(scrub.on)return;svg.querySelector(".kx").style.display="none";const t=svg.parentNode.querySelector(".ktip");if(t)t.hidden=true},1500)});

/* ---------- „Was jetzt?“: nach einem Verkauf (oder jederzeit) prüfen, ob Long, Short oder Abwarten sinnvoll ist ---------- */
// Grundlage: wie oft ein Einstieg in dieser halben Stunde früher geklappt hat (je Richtung, alle Ziel/Stop-Kombis).
// Echter Bot: zusätzlich die Statistik „nach einem schnellen Anstieg/Fall in den letzten 15 Min.“ (Feld nach im Kurs).
function optionen(s){const k=D.kurse[s];if(!k||!Z)return null;const slot=slotJetzt(k.m),spike=(M.spike||{})[s];
  const ctx=spike&&Date.now()-spike.t<45*6e4?spike.d:0; // +1 = gerade schnell gestiegen, −1 = gefallen
  const opt=[];for(const dir of ["long","short"]){const r=zq(dir).sym[s];if(!r||slot<0||!r[slot])continue;
    const nach=!DEMO&&ctx&&Z.nach&&Z.nach[k.m]&&Z.nach[k.m][String(ctx)]&&Z.nach[k.m][String(ctx)][dir]||null,p16=[],pt16=[],to16=[],min16=[],n=[];
    GT.forEach((T,ti)=>GS.forEach((S,si)=>{const g=ti*4+si,[nn,w]=r[slot][g]||[0,0];let p=nach?(nach.p[g]??0):(nn?w/nn:0);
      if(!nach&&DEMO&&ctx)p+=dir==="long"?-ctx*.14:ctx*.07; // Beispiel: nach schnellem Anstieg ist Short kurz etwas wahrscheinlicher
      p16.push(Math.max(.05,Math.min(.92,p)));pt16.push(.1);to16.push(0);min16.push(nach?(nach.min[g]||30):(DEMO?Math.round(5+T*11):30));n.push(nach?nach.n:nn)}));
    const x={p:p16,pt:pt16,to:to16,min:min16};let best=null;
    for(const T of GT)for(const S of GS){if(S>1.5*T)continue;const b=bewerte(x,T,S,F());if((E.halt>0&&b.min>E.halt)||n[gi(T,S)]<30)continue;if(b.ev>0&&(!best||b.p>best.b.p||(b.p===best.b.p&&b.eEv>best.b.eEv)))best={T,S,b}}
    const fallback=bewerte(x,E.T,E.S,F());opt.push({dir,x,best,b:best?best.b:fallback,T:best?best.T:E.T,S:best?best.S:E.S,n:n[gi(E.T,E.S)]})}
  for(const o of opt){const b=o.b,puffer=Math.max(.5,E.einsatz*.002); // vorsichtig: im Schnitt mindestens 0,2 % vom Einsatz übrig
    o.urteil=!o.best?"nein":b.p>=E.minP/100+.05&&b.eEv>=puffer?"ja":b.p>=E.minP/100&&b.eEv>0?"vorsicht":"nein"}
  const nf2=empfohlen().find(e=>e.s===s&&e.st==="warte");
  return {k,opt,ctx,naechstes:nf2}}
function wasJetztHtml(s,nachVerkauf){const o=optionen(s);if(!o)return "";const {k,opt,ctx}=o,best=opt.filter(x=>x.urteil!=="nein").sort((a,b)=>b.b.p-a.b.p)[0];
  const URT={ja:["g","✅ Lohnt sich"],vorsicht:["y","⚠️ Nur vorsichtig"],nein:["r","❌ Lohnt sich nicht"]};
  const karte=x=>{const u=URT[x.urteil],b=x.b,emp=best===x;return `<div class="opt ${u[0]} ${emp?"opt-emp":""} fade"><div class="ok"><b>${x.dir==="short"?"SHORT ↘":"LONG ↗"}${emp?" · Empfehlung":""}</b><span class="mini ${u[0]==="r"?"":u[0]}">${u[1]}</span></div>
    <div class="ozahl"><div><i>Klappt in</i><b>${Math.round(b.p*100)} %</b></div><div><i>Ziel / Stop</i><b>${pz((x.dir==="short"?-1:1)*x.T,x.T%1?2:1)} / ${pz((x.dir==="short"?1:-1)*x.S,x.S%1?2:1)}</b></div><div><i>Halten</i><b>~${b.min} Min.</b><small>bis ca. ${b.richt} Min.</small></div><div><i>Ø nach Kosten</i><b class="${kl(b.eEv)}">${eu(b.eEv)}</b></div></div>
    <p class="small muted">Gewinn ${eu(b.eWin)} · Verlust ${eu(b.eLoss)} bei ${F()===1?"ohne Hebel":"×"+F()} und ${nf(E.einsatz,0)} €. ${b.eWin>0?`Ein Verlust frisst ${nf(Math.abs(b.eLoss)/b.eWin,1)} Gewinne.`:""}${!x.best?" Keine Ziel/Stop-Kombi bringt in deiner Haltezeit im Schnitt etwas.":""}</p>
    ${x.urteil!=="nein"?`<button class="btn ${x.urteil==="ja"?"":"ghost"} voll" data-wj="${esc(s)}:${x.dir}:${x.T}:${x.S}">${E.ueb?"🧪 ":""}${x.dir==="short"?"Short":"Long"} ${E.ueb?"üben":"kaufen & überwachen"}</button>`:""}</div>`};
  return `<div class="wasjetzt"><h2>🤔 Was jetzt mit ${esc(k.n)}?</h2>
   ${ctx?`<p class="small">${ctx>0?"Die Aktie ist gerade schnell gestiegen.":"Die Aktie ist gerade schnell gefallen."} Danach dreht sie oft ein Stück zurück – ich habe beide Richtungen geprüft.</p>`:""}
   ${opt.map(karte).join("")}
   <div class="opt ${best?"":"opt-emp"} g2 fade"><div class="ok"><b>⏸ ABWARTEN${best?"":" · Empfehlung"}</b><span class="mini">immer sicher</span></div>
    <p class="small">${best?"Kostet nichts, wenn dir das Risiko zu hoch ist.":"Gerade lohnt sich keine Richtung sicher genug."} ${o.naechstes?`Nächstes gutes Fenster: <b>${uhr(o.naechstes.a)}–${uhr(o.naechstes.b)}</b> ${o.naechstes.dir==="short"?"SHORT":"LONG"} (${Math.round(o.naechstes.q*100)} %).`:""}</p></div>
   <p class="small muted">Vorsichtig gerechnet: „Lohnt sich“ nur, wenn die Trefferquote mindestens 5 Punkte über deiner Grenze (${E.minP} %) liegt und im Schnitt nach Spread, Gebühr und Steuer noch etwas übrig bleibt.${DEMO?" (Beispieldaten)":""}</p></div>`}
function wasJetzt(s,nachVerkauf){sheet(wasJetztHtml(s,nachVerkauf)+`<button class="btn ghost voll" data-ksheet="${esc(s)}">Kurs-Chart ansehen</button><button class="btn ghost voll" data-zu>Schließen</button>`)}
function wjKauf(s,dir,T,S){const k=D.kurse[s],o=optionen(s),x0=o.opt.find(y=>y.dir===dir),p=preis(s)??k.p,jetzt=Date.now();
  const sig={id:"w"+jetzt,T,S,dir,s,n:k.n,m:k.m,cur:k.cur,setup:"wasjetzt",setupN:"Nach deinem Verkauf geprüft",warum:[],t:jetzt,p0:p,bis:jetzt+5*6e4,zu:(D.markt[k.m]||{}).zu,...x0.x,nS:x0.n,nT:x0.n};
  D.signale.push(sig);kaufStart(sig)}

// Vorschläge von selbst: verkaufte Aktien weiter beobachten. Erst nach einer Ruhepause und nur, wenn eine Richtung „Lohnt sich“ ist,
// kommt ein neuer Einstieg als Vorschlag (Karte unter „Jetzt“ + Meldung). Der echte Bot macht dieselbe Prüfung für alle Aktien.
function vorschlaegePruefen(){if(!D||!Z)return;const jetzt=Date.now();M.vorg=M.vorg||{};
  for(const [s,t0] of Object.entries(M.beob||{})){if(jetzt-t0>90*6e4){delete M.beob[s];continue}
    if(pausiert(s)||M.pos.some(p=>p.s===s))continue;const o=optionen(s);if(!o)continue;
    const best=o.opt.filter(x=>x.urteil==="ja").sort((a,b)=>b.b.p-a.b.p)[0];if(!best)continue;const key=s+":"+best.dir;
    if(jetzt-(M.vorg[key]||0)<20*6e4||(D.signale||[]).some(y=>y.s===s&&y.dir===best.dir&&y.bis>jetzt))continue;M.vorg[key]=jetzt;
    const k=o.k,p=preis(s)??k.p,sig={id:"v"+jetzt,dir:best.dir,s,n:k.n,m:k.m,cur:k.cur,setup:"vorschlag",setupN:"Neu berechnet: lohnt sich jetzt",warum:[`Nach deinem Verkauf weiter beobachtet`,`${best.dir==="short"?"Short":"Long"} klappte in ${Math.round(best.b.p*100)} % ähnlicher Fälle`,`Im Schnitt nach Kosten ${eu(best.b.eEv)}`],
      t:jetzt,p0:p,bis:jetzt+8*6e4,zu:(D.markt[k.m]||{}).zu,...best.x,nS:best.n,nT:best.n};
    sig.T=best.T;sig.S=best.S;D.signale.push(sig);
    meldung("signal",`🚨 Vorschlag: ${k.n} ${best.dir==="short"?"SHORT ↘":"LONG ↗"} ${Math.round(best.b.p*100)} %`,`Ziel ${pz((best.dir==="short"?-1:1)*best.T,2)} · ca. ${best.b.min} Min. · Ø ${eu(best.b.eEv)} nach Kosten`);
    const ab=$("#alarmband");ab.className="alarmband on gut";ab.innerHTML=`<span class="aw">VORSCHLAG</span> ${esc(k.n)} ${best.dir==="short"?"SHORT ↘":"LONG ↗"}<small>${Math.round(best.b.p*100)} % · lohnt sich jetzt · tippen</small>`;ab.dataset.ziel="jetzt";clearTimeout(ab.t);ab.t=setTimeout(()=>ab.classList.remove("on"),15000);
    piep(true);try{navigator.vibrate&&navigator.vibrate([200,100,200])}catch(e){}if(tab==="jetzt")render(true)}
  try{localStorage.setItem("dt-mein",JSON.stringify(M))}catch(e){}}

/* ---------- Archiv: Protokoll aller App-Aktionen + ähnliche Fälle aus der Vergangenheit ---------- */
// Echter Bot: speichert jeden Fall (Muster, RSI, Abstand zum Tagesschnitt, Tagesveränderung, Uhrzeit, Marktlage, Umsatz,
// Nachrichten-Stimmung, Tage bis Quartalszahlen, Schwankung) mit dem Kursverlauf der folgenden 60 Min. im Zweig „daten“ (faelle/JJJJ-MM.json).
// Ähnlichkeit = gewichteter Abstand dieser Merkmale. Die App lädt die passenden Fälle zu jedem Signal.
let arMehr=false,arTab="proto",arSig="",arFilter={gleich:false,news:false,zahlen:false},protoFilter="alle";
const MUSTER_N={rueck:"Rücksetzer im Aufwärtstrend",vwap:"Zurück über den Tagesschnitt",ausbruch:"Ausbruch erste halbe Stunde",schwung:"Schwung mit neuem Tageshoch",abprall:"Abprall nach Abverkauf",schwaeche:"Schwäche unter dem Tagesschnitt"};
function logEintrag(typ,s,text,daten){M.log=(M.log||[]).concat({t:Date.now(),typ,s,text,daten:daten||{}}).slice(-500);try{localStorage.setItem("dt-mein",JSON.stringify(M))}catch(e){}}
function faelle(x){if(x._faelle&&x._faelleT===xT(x)+":"+xS(x))return x._faelle;
  if(!DEMO){if(!FAELLE||!x.fall)return [];const g=gi(xT(x),xS(x)),liste=KERN.aehnlich(FAELLE,{d:dOf(x),k:x.setup,f:x.fall},100);x._faelleT=xT(x)+":"+xS(x);
    return x._faelle=liste.map(f=>({sim:f.sim,s:f.s,n:(D.kurse[f.s]||{}).n||f.s,t:f.t,muster:f.k,rsi:f.f[0],vw:f.f[1],markt:f.f[4]>0?"auf":f.f[4]<0?"ab":"seit",
      news:f.nw==null?null:f.nw==="positiv"?1:f.nw==="negativ"?-1:0,zahlen:null,path:f.pf.map(v=>v/100),res:f.r[g]==="w"?1:f.r[g]==="l"?-1:0,min:f.tm[g]}))}
  const r=seed([...x.id+x.s].reduce((a,c)=>a*31+c.charCodeAt(0)|0,3)),T=xT(x),S=xS(x),out=[],andere=Object.keys(D.kurse).filter(s=>s!==x.s&&D.kurse[s].m===x.m);
  for(let i=0;i<100;i++){const sim=Math.round(97-i*.32-r()*3),gleich=r()<.55,s=gleich?x.s:andere[Math.floor(r()*andere.length)]||x.s,news=r()<.6?0:r()<.6?1:-1,zahlen=r()<.18?Math.ceil(r()*5):0;
    let pw=bewerte(x,T,S).p-(100-sim)*.004+(news===1?.06:news===-1?-.12:0)-(zahlen?.08:0);const win=r()<pw,steps=13,path=[0];let v=0,res=0,min=60;
    for(let k=1;k<steps;k++){const ziel=win?T*(k/(4+r()*6)):-S*(k/(3+r()*7));v=v+(ziel-v)*.35+(r()-.5)*.18;if(res===0&&v>=T){v=T;res=1;min=k*5}if(res===0&&v<=-S){v=-S;res=-1;min=k*5}path.push(+v.toFixed(3))}
    const tag=new Date(Date.now()-(1+Math.floor(r()*84))*864e5);tag.setHours(x.m==="us"?15+Math.floor(r()*6):9+Math.floor(r()*8),Math.floor(r()*12)*5,0,0);
    out.push({sim,s,n:(D.kurse[s]||{}).n||s,t:+tag,muster:x.setup,rsi:Math.round(40+r()*30),vw:+((r()-.3)*1.6).toFixed(2),markt:r()<.7?"auf":"ab",news,zahlen,path,res,min:res?min:60})}
  return x._faelle=out}
function faecher(liste){const n=liste[0]?liste[0].path.length:0,mid=[],lo=[],hi=[];for(let k=0;k<n;k++){const v=liste.map(f=>f.path[k]).sort((a,b)=>a-b),q=p=>v[Math.min(v.length-1,Math.floor(p*(v.length-1)))];mid.push(q(.5));lo.push(q(.25));hi.push(q(.75))}return {mid,lo,hi}}
function faecherSvg(liste,T,S){if(!liste.length)return "";const {mid,lo,hi}=faecher(liste),W=600,H=170,n=mid.length,ys=[...lo,...hi,T,-S,0],a=Math.min(...ys)-.1,b=Math.max(...ys)+.1;
  const X=k=>k/(n-1)*(W-10)+5,Y=v=>H-6-(v-a)/(b-a)*(H-12),pl=arr=>arr.map((v,k)=>`${k?"L":"M"}${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const band=pl(hi)+lo.slice().reverse().map((v,k)=>`L${X(n-1-k).toFixed(1)},${Y(v).toFixed(1)}`).join("")+"Z",hl=(v,c,t)=>`<line x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" stroke="${c}" stroke-dasharray="5 4" stroke-width="1.3"/><text x="${W-4}" y="${Y(v)-4}" text-anchor="end" fill="${c}" font-size="13" font-weight="700">${t}</text>`;
  const einzel=liste.slice(0,12).map(f=>`<path d="${pl(f.path)}" fill="none" stroke="${f.res>0?"var(--up)":f.res<0?"var(--down)":"var(--muted)"}" stroke-width="1" opacity=".22"/>`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${hl(T,"var(--up)","Ziel")}${hl(-S,"var(--down)","Stop")}${hl(0,"var(--muted)","Einstieg")}${einzel}<path d="${band}" fill="var(--accent)" opacity=".18"/><path class="zeichne" d="${pl(mid)}" pathLength="1" fill="none" stroke="var(--accent)" stroke-width="3"/></svg>
   <div class="legende"><span><i style="border-color:var(--accent)"></i>typischer Verlauf (Mitte)</span><span><i style="border-color:var(--accent);opacity:.4;border-top-width:6px"></i>die mittleren 50 %</span><span>dünn: einzelne Fälle</span></div>
   <div class="kach"><span>Einstieg</span><span>+30 Min.</span><span>+60 Min.</span></div>`}
function seiteArchiv(){const sigs=(D.signale||[]);if(!arSig&&sigs[0])arSig=sigs[0].id;
  let h=`<div class="seg"><button data-ar="proto" class="${arTab==="proto"?"on":""}">📜 Protokoll</button><button data-ar="aehnlich" class="${arTab==="aehnlich"?"on":""}">🔍 Ähnliche Fälle</button><button data-ar="muster" class="${arTab==="muster"?"on":""}">🧩 Muster</button></div>`;
  if(arTab==="proto"){if(!DEMO&&Date.now()-(laden.logT||0)>6e4){laden.logT=Date.now();hole("log.json").then(l=>{BOTLOG=l||[];if(tab==="archiv")render()}).catch(()=>{})}
    const typen=[["alle","Alles"],["signal","Signale"],["kauf","Käufe"],["verkauf","Verkäufe"],["warn","Warnungen"]],l=[...(M.log||[]),...(DEMO?[]:BOTLOG)].sort((a,b)=>a.t-b.t).reverse().filter(e=>protoFilter==="alle"||e.typ===protoFilter||(protoFilter==="warn"&&["ziel","stop","dreht","schmilzt","sinkt","zeit","schluss"].includes(e.typ)));
    h+=`<div class="chips">${typen.map(([k,t])=>`<button data-pf="${k}" class="${protoFilter===k?"on":""}">${t}</button>`).join("")}</div>`;
    let tag="";h+=l.length?l.slice(0,150).map((e,i)=>{const d=new Date(e.t).toLocaleDateString("de-DE",{weekday:"long",day:"2-digit",month:"2-digit"}),kopf=d!==tag?`<div class="tagkopf">${d}</div>`:"";tag=d;const a=MART[e.typ]||(e.typ==="verkauf"?["💶","n"]:["•","n"]);
      return `${kopf}<details class="proto ${a[1]}"><summary><span class="ic">${a[0]}</span><span class="pt"><b>${esc(e.text)}</b><small>${uhr(e.t)}${e.s?" · "+esc(e.s):""}</small></span>${e.daten&&e.daten.erg!=null?`<b class="${kl(e.daten.erg)}">${eu(e.daten.erg)}</b>`:""}</summary>
       <div class="pd">${Object.entries(e.daten||{}).filter(([k])=>k!=="erg").map(([k,v])=>`<div><i>${esc(k)}</i><b>${esc(v)}</b></div>`).join("")||"<span class='small muted'>Keine weiteren Daten.</span>"}</div></details>`}).join(""):`<div class="card leer">Noch nichts protokolliert.</div>`;
    h+=`<p class="small muted">Hier landet alles, was die App tut: jedes Signal mit Trefferquote und Begründung, jeder Vorschlag, jede Warnung, jeder Kauf und Verkauf mit Ergebnis. Der Bot speichert dasselbe dauerhaft im Repository (data/protokoll), damit nichts verloren geht.</p>`}
  if(arTab==="aehnlich"){const x=sigs.find(y=>y.id===arSig);
    h+=`<label class="f">Empfehlung<select id="arsig">${sigs.map(y=>`<option value="${y.id}" ${y.id===arSig?"selected":""}>${esc(y.n)} ${istShort(y)?"SHORT":"LONG"} · ${esc(y.setupN)}</option>`).join("")}</select></label>`;
    if(x&&!DEMO&&!FAELLE){hole("faelle.json").then(f=>{FAELLE=f||[];render()}).catch(()=>{FAELLE=[];render()});h+=`<div class="card leer"><div class="radar"></div>Lade die gespeicherten Fälle …</div>`}
    else if(x){const T=xT(x),S=xS(x),d=dOf(x);let l=faelle(x).slice();if(arFilter.gleich)l=l.filter(f=>f.s===x.s);const nx=x.news?({positiv:1,negativ:-1}[x.news.g]||0):0;if(arFilter.news)l=l.filter(f=>f.news===nx);if(arFilter.zahlen&&DEMO)l=l.filter(f=>!f.zahlen);
      const w=l.filter(f=>f.res>0).length,lo=l.filter(f=>f.res<0).length,mz=l.filter(f=>f.res>0).map(f=>f.min).sort((a,b)=>a-b);
      h+=`<div class="chips">${[["gleich","Nur "+esc(x.n)],["news","Gleiche Nachrichtenlage"],...(DEMO?[["zahlen","Ohne Quartalszahlen in der Nähe"]]:[])].map(([k,t])=>`<button data-af="${k}" class="${arFilter[k]?"on":""}">${t}</button>`).join("")}</div>
       <div class="card fade"><b>So lief es in den ${l.length} ähnlichsten Fällen</b>${faecherSvg(l,T,S)}
        <div class="kz" style="margin-top:8px"><div><i>Ziel zuerst</i><b class="up">${l.length?Math.round(w/l.length*100):"–"} %</b></div><div><i>Stop zuerst</i><b class="down">${l.length?Math.round(lo/l.length*100):"–"} %</b></div><div><i>Ziel meist nach</i><b>${mz.length?mz[Math.floor(mz.length/2)]+" Min.":"–"}</b></div><div><i>Ähnlichkeit</i><b>${l.length?Math.min(...l.map(f=>f.sim))+"–"+Math.max(...l.map(f=>f.sim))+" %":"–"}</b></div></div>
        <p class="small muted">Ausblick, keine Garantie: Die Fläche zeigt, wo die Aktie in der Hälfte der ähnlichen Fälle nach dem Einstieg lag. ${l.length<30?"<b>Wenige Fälle – Aussage unsicher.</b>":""}</p></div>
       <h2>Einzelne Fälle <span class="n">ähnlichste zuerst</span></h2>
       ${l.slice(0,arMehr?100:25).map((f,i)=>`<details class="fall fade" style="--d:${Math.min(i,8)}"><summary><span class="sim">${f.sim}%</span><span class="pt"><b>${esc(f.n)}</b><small>${new Date(f.t).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"2-digit"})} · ${uhr(f.t)}</small></span>${miniPfad(f,T,S)}<span class="mini ${f.res>0?"g":f.res<0?"r":""}">${f.res>0?"Ziel":f.res<0?"Stop":"Zeit"}${f.res?" "+f.min+"′":""}</span></summary>
        <div class="pd"><div><i>Muster</i><b>${esc(MUSTER_N[f.muster]||(Z&&Z.muster&&Z.muster[f.muster]||{}).n||f.muster)}</b></div><div><i>RSI</i><b>${f.rsi}</b></div><div><i>Zum Tagesschnitt</i><b>${pz(f.vw,2)}</b></div><div><i>Markt</i><b>${f.markt==="auf"?"↗ steigend":"↘ fallend"}</b></div><div><i>Nachrichten</i><b>${f.news==null?"nicht erfasst":f.news>0?"positiv":f.news<0?"negativ":"neutral"}</b></div>${DEMO?`<div><i>Quartalszahlen</i><b>${f.zahlen?"in "+f.zahlen+" Tagen":"keine nah"}</b></div>`:""}</div></details>`).join("")}
       ${l.length>25&&!arMehr?`<button class="btn ghost voll" data-armehr>Alle ${l.length} Fälle zeigen</button>`:""}
       <p class="small muted">${DEMO?"Beispieldaten. ":"Echte Fälle der letzten 30 Handelstage. "}Verglichen werden: Muster, RSI, Abstand zum Tagesschnitt, Tagesveränderung, Uhrzeit, Marktlage, Umsatz, Schwankung und schnelle Bewegung kurz davor. Nachrichten sind erst für Fälle erfasst, die der Bot selbst live gesehen hat. An Tagen mit Quartalszahlen gibt der Bot gar keine Signale. Je ähnlicher, desto weiter oben.</p>`}}
  if(arTab==="muster"){const st=D.setups||{},g=gi(E.T,E.S);
    h+=Object.entries(st).map(([k,v],i)=>{const [n,w,l]=v.st[g]||[0,0,0],q=n?w/n:0;return `<div class="card fade" style="--d:${i}"><div class="kopf">${ring(q)}<div class="nm"><b>${esc(v.n)}</b><span>${n} Fälle in 60 Handelstagen · Ziel ${pz(E.T,1)} / Stop ${pz(-E.S,1)}</span></div></div>
     <div class="kz" style="margin-top:8px"><div><i>Ziel zuerst</i><b class="up">${Math.round(q*100)} %</b></div><div><i>Stop zuerst</i><b class="down">${n?Math.round(l/n*100):0} %</b></div></div>
     <p class="small muted">${v.t?esc(v.t):""}${v.t?"":{rueck:"Kurs steigt heute, kommt kurz zurück und dreht wieder hoch.",vwap:"Kurs war unter dem Tagesschnitt und schiebt sich mit Umsatz zurück darüber.",ausbruch:"Kurs bricht über das Hoch der ersten 30 Minuten.",schwung:"Starker Tag, neues Tageshoch, Markt zieht mit.",abprall:"Nach heftigem Abverkauf die erste Gegenbewegung – riskant.",schwaeche:"Kurs fällt unter den Tagesschnitt, Markt schwach (Short)."}[k]||""}</p></div>`}).join("")}
  return h}
function miniPfad(f,T,S){const W=70,H=22,a=-S,b=T,X=k=>k/(f.path.length-1)*W,Y=v=>H-(Math.max(a,Math.min(b,v))-a)/(b-a)*H;return `<svg class="mp" viewBox="0 0 ${W} ${H}"><line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--muted)" stroke-width=".6" stroke-dasharray="2 2"/><path d="${f.path.map((v,k)=>`${k?"L":"M"}${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join("")}" fill="none" stroke="${f.res>0?"var(--up)":f.res<0?"var(--down)":"var(--muted)"}" stroke-width="1.6"/></svg>`}
function demoLog(){if(M.logDemo)return;M.logDemo=1;const r=seed(99),jetzt=Date.now(),namen=[["NVDA","Nvidia"],["AMD","AMD"],["SAP.DE","SAP"],["TSLA","Tesla"],["SIE.DE","Siemens"]];
  for(let d=3;d>=1;d--)for(let i=0;i<5;i++){const [s,n]=namen[Math.floor(r()*5)],t=jetzt-d*864e5+(i*70+r()*40)*6e4,p=Math.round(58+r()*14),dir=r()<.7?"LONG":"SHORT",ok=r()<p/100,erg=+(ok?8+r()*12:-(15+r()*15)).toFixed(2);
    M.log.push({demo:1,t,typ:"signal",s,text:`Signal: ${n} ${dir} ${p} %`,daten:{Muster:Object.values(MUSTER_N)[Math.floor(r()*5)],Trefferquote:p+" %","Ziel/Stop":"+1 % / −1 %",Nachrichten:r()<.7?"neutral":"positiv",Ausgang:ok?"Ziel nach "+Math.round(8+r()*20)+" Min.":"Stop"}});
    if(r()<.45){M.log.push({demo:1,t:t+2*6e4,typ:"kauf",s,text:`🧪 Gekauft: ${n} ${dir}`,daten:{Hebel:"×5",Einsatz:"500 €"}});M.log.push({demo:1,t:t+(14+r()*20)*6e4,typ:"verkauf",s,text:`Verkauft: ${n}`,daten:{erg,Grund:ok?"Ziel erreicht":"Stop"}})}}
  M.log.sort((a,b)=>a.t-b.t)}

/* ---------- Zeitreise-Übung: echte vergangene Handelstage nachspielen ---------- */
// Die Kerzen kommen aus tage.json (echte 5-Minuten-Kurse). Muster werden mit dem Rechenkern nur aus den Kerzen BIS zum jeweiligen Moment erkannt –
// die App weiß nicht, wie der Tag weitergeht. Die Trefferquoten stammen aus den letzten 60 Handelstagen (darin ist dieser Tag enthalten).
let ZR=null;
async function zeitreiseWahl(){if(DEMO)return toast("Die Zeitreise braucht echte Kurse – sie startet, sobald der Bot läuft.");
  if(!TAGE){sheet(`<div class="card leer"><div class="radar"></div>Lade echte Handelstage …</div>`);try{TAGE=await hole("tage.json")}catch(e){TAGE=null;sheetInhalt(`<p>Konnte die Handelstage nicht laden (${esc(e.message)}).</p><button class="btn ghost voll" data-zu>Schließen</button>`);return}}
  const l=Object.entries(TAGE).filter(([s])=>s!=="SPY"&&s!=="^GDAXI");
  const html=`<h2>⏪ Echten Tag nachspielen</h2><p class="small muted">Wähle Aktie und Tag. Der Kurs läuft wie damals, nur schneller. Die App erkennt Muster nur aus dem, was bis zu diesem Moment passiert ist.</p>
   ${l.map(([s,o])=>`<div class="zrw"><b>${esc(o.n)}</b><div class="chips">${o.tage.map(d=>`<button data-zr="${esc(s)}|${d}">${new Date(d+"T12:00:00").toLocaleDateString("de-DE",{weekday:"short",day:"2-digit",month:"2-digit"})}</button>`).join("")}</div></div>`).join("")}
   <button class="btn ghost voll" data-zu>Schließen</button>`;
  if($("#sheet").classList.contains("open"))sheetInhalt(html);else sheet(html)}
function zeitreiseStart(s,tag){const o=TAGE[s],tz=o.m==="us"?"America/New_York":"Europe/Berlin",B={t:o.t,o:o.o,h:o.h,l:o.l,c:o.c,v:o.v},P=KERN.prep(B,tz),ref=TAGE[o.m==="us"?"SPY":"^GDAXI"];
  const MK=ref?KERN.marktKarte(KERN.prep({t:ref.t,o:ref.o,h:ref.h,l:ref.l,c:ref.c,v:ref.v},tz)):null,i0=P.tag.indexOf(tag),i1=P.tag.lastIndexOf(tag);
  ZR={s,n:o.n,m:o.m,cur:o.m==="us"?"USD":"EUR",tag,P,MK,i0,i1,i:i0+2,tempo:10,lauf:true,auto:true,pos:null,trades:[],sig:[],letzt:Date.now(),rest:0};sheetInhalt(zeitreiseHtml());zeitreiseTakt()}
function zeitreiseTakt(){clearInterval(zeitreiseTakt.t);zeitreiseTakt.t=setInterval(()=>{if(!ZR||!$("#sheet").classList.contains("open")){clearInterval(zeitreiseTakt.t);return}
  const jetzt=Date.now(),dt=jetzt-ZR.letzt;ZR.letzt=jetzt;if(!ZR.lauf||ZR.i>=ZR.i1)return;ZR.rest+=dt*ZR.tempo;let neu=false;
  while(ZR.rest>=3e5&&ZR.i<ZR.i1){ZR.rest-=3e5;ZR.i++;neu=true;zrSchritt()}if(neu){const y=$("#sheet").scrollTop;sheetInhalt(zeitreiseHtml());$("#sheet").scrollTop=y}},400)}
function zrSchritt(){const P=ZR.P,i=ZR.i,x=KERN.merkmale(P,i,ZR.MK);
  for(const key of KERN.muster(x)){if(E.richtung!=="beide"&&!key.startsWith(E.richtung))continue;const w=KERN.wahrsch(Z&&Z.statSym&&Z.statSym[ZR.s]&&Z.statSym[ZR.s][key],Z&&Z.stat&&Z.stat[key]);if(w.nT<30)continue;
    w.nT=w.nT||30;const b=bewerte(w,E.T,E.S,F());if(b.keine)continue;const a=KERN.ausgang(P,i,key.startsWith("short")?-1:1);
    ZR.sig.push({i,key,dir:key.startsWith("short")?"short":"long",n:(Z.muster[key]||{}).n||key,b,p0:P.B.c[i],res:a?a.r[gi(E.T,E.S)][0]:null,stark:b.p>=E.minP/100&&b.ev>0&&b.t>=E.minT});
    if(ZR.auto&&b.p>=E.minP/100&&b.ev>0&&b.t>=E.minT){ZR.lauf=false;piep(true);try{navigator.vibrate&&navigator.vibrate([150,80,150])}catch(e){}}}
  if(ZR.pos){const s=zrStand();if(s.st!=="halten"&&s.st!==ZR.pos.gemeldet){ZR.pos.gemeldet=s.st;if(["ziel","stop","dreht","schmilzt"].includes(s.st)){ZR.lauf=false;piep(s.st==="ziel")}}}}
function zrZeit(i){return ZR.P.B.t[i]*1000}
function zrStand(){const p=ZR.P.B.c[ZR.i],x=ZR.pos;const s=KERN.stand(E,x,p,zrZeit(ZR.i1),zrZeit(ZR.i),FAELLE);x.peak=s.peak;x.peakU=s.peakU;return s}
function zrKauf(dir,sigI){const P=ZR.P,i=ZR.i,e=P.B.c[i],f=F(),ein=+E.einsatz,sg=sigI!=null?ZR.sig[sigI]:null;
  ZR.pos={dir,setup:sg?sg.key:null,f,kaufZ:10,stk:ein/10,basis:e,T:+E.T,S:+E.S,t:zrZeit(i),bis:zrZeit(i)+((sg&&sg.b.richt)||45)*6e4,pSig:sg?(sg.b.pZvS??sg.b.p):.5,peak:0,i};ZR.lauf=true;ZR.letzt=Date.now()}
function zrVerkauf(){const s=zrStand(),x=ZR.pos;ZR.trades.push({dir:x.dir,von:x.i,bis:ZR.i,net:s.jetztE,u:s.u,emp:TUN[s.st][1]});ZR.pos=null;if(s.jetztE>0)konfetti()}
function zrChart(){const P=ZR.P,a=ZR.i0,b=ZR.i,W=600,H=180,c=P.B.c.slice(a,b+1),vw=P.vw.slice(a,b+1),x=ZR.pos,d=x?(x.dir==="short"?-1:1):1;
  const lines=x?[x.basis,x.basis*(1+d*x.T/100),x.basis*(1-d*x.S/100)]:[],ys=[...c,...vw,...lines],lo=Math.min(...ys),hi=Math.max(...ys),pad=(hi-lo)*.08||1,n=ZR.i1-ZR.i0+1;
  const X=k=>k/(n-1)*(W-10)+5,Y=v=>H-6-(v-lo+pad)/(hi-lo+2*pad)*(H-12),pl=arr=>arr.map((v,k)=>`${k?"L":"M"}${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const hl=(v,col,t)=>`<line x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" stroke="${col}" stroke-dasharray="5 4" stroke-width="1.3"/><text x="${W-4}" y="${Y(v)-4}" text-anchor="end" fill="${col}" font-size="13" font-weight="700">${t}</text>`;
  const marks=ZR.sig.map(sg=>`<circle cx="${X(sg.i-a)}" cy="${Y(P.B.c[sg.i])}" r="5" fill="${sg.dir==="short"?"#c9a2ff":"var(--up)"}" stroke="var(--bg)" stroke-width="2"/>`).join("")+ZR.trades.map(t=>`<circle cx="${X(t.bis-a)}" cy="${Y(P.B.c[t.bis])}" r="4" fill="var(--warn)"/>`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${x?hl(lines[1],"var(--up)","Ziel")+hl(lines[2],"var(--down)","Stop")+hl(lines[0],"var(--muted)","Einstieg"):""}
   <path d="${pl(vw)}" fill="none" stroke="var(--warn)" stroke-width="1.4" opacity=".8"/><path d="${pl(c)}" fill="none" stroke="var(--accent)" stroke-width="2.2"/>${marks}<circle cx="${X(c.length-1)}" cy="${Y(c[c.length-1])}" r="5" fill="var(--fg)"/></svg>
   <div class="legende"><span><i style="border-color:var(--accent)"></i>Kurs</span><span><i style="border-color:var(--warn)"></i>Tagesschnitt</span><span>● grün/lila: Signal Long/Short · ● gelb: dein Verkauf</span></div>`}
function zeitreiseHtml(){const P=ZR.P,i=ZR.i,c=P.B.c[i],c0=P.vor[i]||P.B.c[ZR.i0],ende=i>=ZR.i1,cur=ZR.cur,offenSig=ZR.sig.filter(sg=>i-sg.i<=2);
  let h=`<div class="kopf"><div class="nm"><b style="font-size:19px">⏪ ${esc(ZR.n)}</b><span>${new Date(ZR.tag+"T12:00:00").toLocaleDateString("de-DE",{weekday:"long",day:"2-digit",month:"2-digit"})} · echter Verlauf</span></div>
    <div class="px"><span style="font-size:19px;font-weight:700">${kurs(c,cur)}</span><small class="${kl(c/c0-1)}">${pz((c/c0-1)*100,2)} heute · ${uhr(zrZeit(i)+3e5)}</small></div></div>
   <div class="card" style="margin-top:10px">${zrChart()}</div>
   <div class="zrctl"><button class="btn ${ZR.lauf?"ghost":""}" data-zrc="lauf">${ende?"Ende":ZR.lauf?"⏸ Pause":"▶ Weiter"}</button>${[10,30,60].map(t=>`<button class="btn ghost ${ZR.tempo===t?"on":""}" data-zrc="t${t}">×${t}</button>`).join("")}<button class="btn ghost" data-zrc="auto">${ZR.auto?"⏸ bei Signal":"▶ durchlaufen"}</button></div>`;
  for(const sg of offenSig.reverse()){const b=sg.b,d=sg.dir==="short"?-1:1;h+=`<div class="card ${sg.stark?"eilig":""}"><div class="kopf">${ring(b.p)}<div class="nm"><b>${sg.dir==="short"?"SHORT ↘":"LONG ↗"} · ${esc(sg.n)}</b><span>Ziel ${kurs(sg.p0*(1+d*E.T/100),cur)} · Stop ${kurs(sg.p0*(1-d*E.S/100),cur)} · Ø ${eu(b.eEv)}</span></div></div>
     ${!ZR.pos&&i-sg.i<=1?`<button class="btn voll" data-zrk="${sg.dir}:${ZR.sig.indexOf(sg)}">${sg.dir==="short"?"Short":"Long"} einsteigen</button>`:""}</div>`}
  if(ZR.pos){const s=zrStand(),t=TUN[s.st];h+=`<div class="card pos st-${t[0]}"><div class="kopf"><div class="nm"><b>Dein Trade ${ZR.pos.dir==="short"?"SHORT":"LONG"} ×${ZR.pos.f}</b><span>seit ${Math.round((i-ZR.pos.i)*5)} Min.</span></div><div class="px"><span class="gross ${kl(s.net)}">${eu(s.net)}</span></div></div>
     <div class="emp ${t[0]}"><div class="wort">${t[1]}</div><div><b>${t[2]}</b><small>${grund(ZR.pos,s)}</small></div></div>
     <div class="hv"><div class="hv1"><i>Jetzt verkaufen</i><b class="${kl(s.jetztE)}">${eu(s.jetztE)}</b></div><div class="hvvs">vs</div><div class="hv2"><i>Weiter halten</i><b class="${kl(s.evHalt)}">Ø ${eu(s.evHalt)}</b><small>${s.quelle}</small></div></div>
     <button class="btn ${t[0]==="raus"||t[0]==="gut"?"rot":""} voll" data-zrc="vk">Verkaufen</button></div>`}
  else if(!ende)h+=`<div class="knoepfe"><button class="btn ghost" data-zrk="long">Long kaufen</button><button class="btn ghost" data-zrk="short">Short kaufen</button></div><p class="small muted">Du kannst auch ohne Signal einsteigen und vergleichen.</p>`;
  if(ZR.trades.length||ende){const sum=ZR.trades.reduce((a,t)=>a+t.net,0),gut=ZR.sig.filter(sg=>sg.stark&&sg.res!=null&&sg.i<=i-12);
    h+=`<h2>Ergebnis bisher</h2><div class="kz"><div><i>Deine Trades</i><b>${ZR.trades.length}</b></div><div><i>Summe netto</i><b class="${kl(sum)}">${eu(sum)}</b></div>
     <div><i>Starke Signale (fertig)</i><b>${gut.length}</b></div><div><i>davon Ziel zuerst</i><b class="up">${gut.length?Math.round(gut.filter(sg=>sg.res>0).length/gut.length*100)+" %":"–"}</b></div></div>`}
  return h+`<p class="small muted" style="margin-top:10px">Ehrlich: Die Trefferquoten stammen aus den letzten 60 Handelstagen, dieser Tag ist darin enthalten.</p><button class="btn ghost voll" data-zrneu>Anderen Tag wählen</button><button class="btn ghost voll" data-zu>Beenden</button>`}

/* ---------- Detail, Formulare, Einstellungen ---------- */
function sheet(html){$("#sheet").innerHTML=`<div class="grab"></div>${html}`;$("#sheet").classList.add("open");$("#sheet-bg").classList.add("open");$("#sheet").scrollTop=0;history.pushState({sheet:1},"")}
function zu(){$("#sheet").classList.remove("open");$("#sheet-bg").classList.remove("open");offen=null}
function detail(id){const x=(D.signale||[]).find(y=>y.id===id);if(!x)return;offen=id;const b=bewerte(x);
  sheet(`${signalKarte(x,0,true)}<div class="card">${kursChart(x.s,x)}</div>
   <div class="card"><b>Warum dieser Einstieg?</b><ul class="small" style="margin:6px 0 0;padding-left:18px">${(x.warum||[]).map(w=>`<li>${esc(w)}</li>`).join("")}</ul>
    <p class="small muted">Aus ${x.nS} Fällen dieser Aktie und ${x.nT} Fällen aller Aktien mit demselben Muster.</p></div>
   <div class="card"><b>📰 Nachrichten: ${esc((x.news&&x.news.g)||"keine")}</b>${(x.news&&x.news.list||[]).map(n=>`<div class="news"><span class="sc ${n.sc>0?"p":n.sc<0?"n":"o"}">${n.sc>0?"+":n.sc<0?"−":"○"}</span>${n.u?`<a href="${esc(n.u)}" target="_blank" rel="noopener">${esc(n.t)}</a>`:esc(n.t)}<div class="small muted">${esc(n.q)}${n.kurz?" · "+esc(n.kurz):""}</div></div>`).join("")||`<p class="small muted">Keine Meldungen.</p>`}
    <p class="small muted">Nachrichten fließen nicht in die Prozentzahl ein, weil es dafür keine verlässliche Rückrechnung gibt. Bei schlechten Nachrichten wird das Signal ausgegraut.</p></div>
   <button class="btn ghost voll" data-arsig="${x.id}">🔍 Ähnliche Fälle aus der Vergangenheit ansehen</button>
   <div class="card"><b>Welche Ziel/Stop-Kombi ist am sichersten?</b>${kombiTabelle(x)}</div>
   <button class="btn voll gross" data-kauf="${x.id}">${E.ueb?"🧪 Übung kaufen":"Kaufen & überwachen"}</button><button class="btn ghost voll" data-zu>Schließen</button>`)}
function sheetInhalt(html){$("#sheet").innerHTML=`<div class="grab"></div>${html}`}
function kaufForm(x){KF=KF&&KF.id===x.id?KF:{id:x.id,f:HB[x.id]??F(),ein:+E.einsatz};const f=KF.f,ein=KF.ein,b=bewerte(x,xT(x),xS(x),f,ein),pl=plan(x,b),p=preis(x.s)??x.p0;
  const zeilen=HEBEL.map(h=>{const c=bewerte(x,xT(x),xS(x),h,ein);return `<button class="hz ${h===f?"on":""}" data-kh="${h}"><b>${h===1?"ohne":"×"+h}</b><span class="up">${eu(c.eWin,0)}</span><span class="down">${eu(c.eLoss,0)}</span><span class="${kl(c.eEv)}">${eu(c.eEv)}</span><i class="risk">${"●".repeat(h>=8?3:h>=3?2:1)}</i></button>`}).join("");
  return `<h2>${esc(x.n)} ${dirB(x)} ${E.ueb?"🧪":""}</h2>${istShort(x)?`<p class="small muted">Short-Faktor-Zertifikat: Du verdienst, wenn die Aktie <b>fällt</b>.</p>`:""}
   <label class="f">Einsatz (€)<input id="kf-ein" type="number" step="50" inputmode="decimal" value="${ein}"></label>
   <p class="small muted" style="margin-top:12px">Wie viel Hebel? Tippe eine Zeile an:</p>
   <div class="htab"><div class="hz kopfz"><b>Hebel</b><span>Ziel</span><span>Stop</span><span>Ø</span><i>Risiko</i></div>${zeilen}</div>
   <div class="sum fade"><b>Mit ${f===1?"ohne Hebel":"Hebel ×"+f} und ${nf(ein,0)} €:</b>
    <div class="erg2"><div class="up">Aktie ${pz(dOf(x)*xT(x),1)} → <b>${eu(b.eWin)}</b></div><div class="down">Aktie ${pz(-dOf(x)*xS(x),1)} → <b>${eu(b.eLoss)}</b></div></div>
    <ol class="schritte"><li class="s1"><b>jetzt</b><span>kaufen (bis ${uhr(pl.bis)})</span></li><li class="s2"><b>~${uhr(pl.zielT)}</b><span>Ziel erreicht → verkaufen</span></li><li class="s3"><b>${uhr(pl.raus)}</b><span>Richtwert – danach entscheidest du</span></li></ol>
    ${f>=8?`<div class="hinweis">Ab ×${f} kostet schon ein normales Wackeln der Aktie um 1 % gleich ${f} % deines Einsatzes.</div>`:""}</div>
   ${E.ueb?"":`<form id="kf" onsubmit="return false"><p class="small muted">Trag ein, was Trade Republic anzeigt:</p><div class="zwei"><label class="f">Kaufkurs je Stück (€)<input name="kz" type="number" step="any" inputmode="decimal"></label><label class="f">Stück<input name="stk" type="number" step="any" inputmode="decimal"></label></div>
    <label class="f">Aktienkurs beim Kauf (${CS[x.cur]||x.cur})<input name="basis" type="number" step="any" inputmode="decimal" value="${p.toFixed(2)}"></label>${E.modus==="ko"?`<label class="f">Produktname aus Trade Republic (einfügen, optional)<input name="trname" placeholder="z. B. Long 174,4353 $"></label><label class="f">Knock-out-Schwelle (${CS[x.cur]||x.cur}) – die Zahl im Namen, z. B. „Long 174,43“<input name="ko" type="number" step="any" inputmode="decimal" placeholder="${(p*(1-dOf(x)/f)).toFixed(2)}"></label>`:""}</form>`}
   <button class="btn voll gross" data-kauf-ok="${x.id}">${E.ueb?"🧪 Übung kaufen":"Eintragen & überwachen"}</button><button class="btn ghost voll" data-zu>Abbrechen</button>`}
function kaufStart(x){KF=null;sheet(kaufForm(x))}
function kaufOk(x){const f=KF.f,ein=KF.ein,b=bewerte(x,xT(x),xS(x),f,ein),pl=plan(x,b),p=preis(x.s)??x.p0;let kaufZ=10,stk=ein/10,basis=p,ko=E.modus==="ko"&&f>1?+(p*(1-dOf(x)/f)).toFixed(3):null;
  if(!E.ueb){const fm=$("#kf"),v=n=>+String(fm.elements[n].value).replace(",",".");if(!(v("kz")>0&&v("stk")>0))return toast("Kaufkurs und Stück eintragen");kaufZ=v("kz");stk=v("stk");basis=v("basis")||p;if(E.modus==="ko"){ko=v("ko");if(!(ko>0))return toast("Knock-out-Schwelle eintragen");if(dOf(x)*(basis-ko)<=0)return toast("Die Schwelle muss bei Long unter, bei Short über dem Aktienkurs liegen")}}
  M.pos.push({id:(E.ueb?"u":"e")+Date.now(),pSig:b.pZvS??b.p,setup:x.setup,dir:x.dir||"long",s:x.s,n:x.n,m:x.m,cur:x.cur,f:ko?+(basis/Math.abs(basis-ko)).toFixed(2):f,ko,kaufZ,stk,basis,T:+xT(x),S:+xS(x),t:Date.now(),bis:pl.raus,ueb:!!E.ueb,peak:0,sig:x.id});
  meldung("kauf",`${E.ueb?"🧪 ":""}Gekauft: ${x.n} ${istShort(x)?"SHORT":"LONG"}`,`${f===1?"ohne Hebel":"Hebel ×"+f} · ${nf(ein,0)} € · Richtwert bis ${uhr(pl.raus)}`);
  speichernM();history.back();tab="meine";render();toast(`${E.ueb?"Übung gekauft":"Eingetragen"}: ${x.n}. Ich passe auf.`);benachrichtigungErlauben()}

/* ---------- Meldungen (Glocke) ---------- */
const MART={dreht:["⚠️","r"],kauf:["🟢","n"],halten:["⏳","n"],ziel:["🎯","g"],stop:["🛑","r"],schmilzt:["⚠️","r"],sinkt:["📉","y"],zeit:["⌛","y"],schluss:["🔔","r"],signal:["🚨","g"]};
function meldung(art,titel,text){logEintrag(art,(text.match(/\b[A-Z0-9]+(\.DE)?\b/)||[])[0]||"",titel,{Info:text});M.meld=(M.meld||[]).concat({art,titel,text,t:Date.now(),neu:1}).slice(-60);try{localStorage.setItem("dt-mein",JSON.stringify(M))}catch(e){}glocke()}
function glocke(){const n=(M.meld||[]).filter(m=>m.neu).length,g=$("#glocke");g.querySelector(".bdg")?.remove();if(n)g.insertAdjacentHTML("beforeend",`<span class="bdg">${n}</span>`)}
function meldungen(){const l=(M.meld||[]).slice().reverse();sheet(`<h2>🔔 Meldungen</h2>${l.length?l.map((m,i)=>{const a=MART[m.art]||["•","n"];return `<div class="meld ${a[1]} ${m.neu?"neu":""} fade" style="--d:${Math.min(i,8)}"><span class="ic">${a[0]}</span><div><b>${esc(m.titel)}</b><small>${esc(m.text)}</small></div><time>${uhr(m.t)}</time></div>`}).join(""):`<p class="muted">Noch keine Meldungen.</p>`}
  <p class="small muted">Dieselben Meldungen schickt dir der Bot in Telegram, auch wenn die App zu ist. Eilige kommen mit 🚨.</p><button class="btn ghost voll" data-zu>Schließen</button>`);(M.meld||[]).forEach(m=>delete m.neu);try{localStorage.setItem("dt-mein",JSON.stringify(M))}catch(e){}glocke()}
function einstellungen(){sheet(`<h2>Einstellungen</h2>
  <div class="seg"><button data-e-modus="ko" class="${E.modus==="ko"?"on":""}">Knock-out</button><button data-e-modus="faktor" class="${E.modus==="faktor"?"on":""}">Faktor-Zertifikat</button><button data-e-modus="aktie" class="${E.modus==="aktie"?"on":""}">Aktie direkt</button></div>
  <div class="zwei"><label class="f">Faktor (Hebel)<input data-e="faktor" type="number" step="1" min="1" value="${E.faktor}"></label><label class="f">Einsatz pro Trade (€)<input data-e="einsatz" type="number" step="10" value="${E.einsatz}"></label></div>
  <div class="zwei"><label class="f">Spread Zertifikat (%)<input data-e="spreadZ" type="number" step="0.05" value="${E.spreadZ}"></label><label class="f">Spread Aktie (%)<input data-e="spreadA" type="number" step="0.01" value="${E.spreadA}"></label></div>
  <p class="small muted">Spread = Abstand zwischen Kauf- und Verkaufskurs in Trade Republic, geteilt durch den Kaufkurs. Beispiel: Kaufen 10,04 €, Verkaufen 10,00 € → 0,4 %.</p>
  <div class="zwei"><label class="f">Gebühr pro Order (€)<input data-e="gebuehr" type="number" step="0.5" value="${E.gebuehr}"></label><label class="f">Steuer auf Gewinne (%)<input data-e="steuer" type="number" step="0.1" value="${E.steuer}"></label></div>
  <div class="zwei"><label class="f">Ziel Aktie<select data-e="T">${GT.map(v=>`<option ${v==E.T?"selected":""} value="${v}">+${nf(v,v%1?2:0)} %</option>`).join("")}</select></label><label class="f">Stop Aktie<select data-e="S">${GS.map(v=>`<option ${v==E.S?"selected":""} value="${v}">−${nf(v,v%1?2:0)} %</option>`).join("")}</select></label></div>
  <label class="f">Haltezeit<select data-e="halt">${[0,15,30,60,120].map(v=>`<option value="${v}" ${+E.halt===v?"selected":""}>${v?"höchstens "+v+" Minuten":"Automatisch: Richtwert je Aktie"}</option>`).join("")}</select></label>
  <label class="f">Richtung<select data-e="richtung">${[["beide","Long und Short"],["long","Nur Long (Aktie steigt)"],["short","Nur Short (Aktie fällt)"]].map(([k,t])=>`<option value="${k}" ${E.richtung===k?"selected":""}>${t}</option>`).join("")}</select></label>
  <label class="f">Mindest-Sicherheit<select data-e="minT">${[[1.5,"locker (t ≥ 1,5)"],[2,"normal (t ≥ 2)"],[3,"streng (t ≥ 3)"]].map(([v,t])=>`<option value="${v}" ${+E.minT===v?"selected":""}>${t}</option>`).join("")}</select></label>
  <label class="f">Nur Einstiege zeigen ab Gewinn-Chance (%)<input data-e="minP" type="number" step="1" min="40" max="90" value="${E.minP}"></label>
  <label class="f">Übungskonto Startgeld (€)<input data-e="konto" type="number" step="100" value="${E.konto}"></label>
  <p class="small">Kosten pro Trade jetzt: <b>${pz(kosten(),2).replace("+","")}</b> vom Einsatz. ${F()>1?`Aktie ${pz(E.T,1)} bringt bei Faktor ${F()} brutto ${pz(F()*E.T,1)}.`:""}</p>
  ${verbindungHtml()}<details><summary>Verbindung (sonst aus der Haupt-App)</summary>
   <label class="f">Repository<input data-e="repo" value="${esc(E.repo)}"></label>
   <label class="f">GitHub-Token ${MAIN.ghToken?"(Haupt-App hat einen)":""}<input data-e="ghToken" type="password" value="${esc(E.ghToken)}" placeholder="leer = aus der Haupt-App"></label>
   <label class="f">Sync-Passwort ${MAIN.syncPass?"(Haupt-App hat eins)":""}<input data-e="syncPass" type="password" value="${esc(E.syncPass)}" placeholder="leer = aus der Haupt-App"></label>
   <label class="f">Finnhub-Schlüssel ${MAIN.fhKey?"(Haupt-App hat einen)":""}<input data-e="fhKey" type="password" value="${esc(E.fhKey)}" placeholder="leer = aus der Haupt-App"></label></details>
  <button class="btn ghost voll" data-wecken>Bot jetzt anstupsen</button><button class="btn voll" data-zu>Fertig</button>`)}

/* ---------- Verbindung App ↔ Bot: zeigt, ob alles ankommt ---------- */
function verbindungHtml(){const j=Date.now(),alt=D&&D.t?Math.round((j-D.t)/6e4):null,pi=D&&D.posInfo,zeile=(ok,t,s)=>`<div class="vz ${ok===true?"ok":ok===false?"nein":"warte"}"><span>${ok===true?"✅":ok===false?"❌":"⏳"}</span><div><b>${t}</b><small>${s}</small></div></div>`;
  return `<div class="card verb"><b>🔗 Verbindung App ↔ Bot</b>
   ${zeile(DEMO?false:alt!=null&&alt<20,"Daten vom Bot",DEMO?"Noch keine – Bot ist noch nicht gelaufen (oder Repository falsch)":`zuletzt vor ${alt} Min. · läuft auf: ${esc(D.wer||"?")}${alt>=20?" · außerhalb der Börsenzeit normal":""}`)}
   ${zeile(tok()?null:false,"GitHub-Token",tok()?(E.ghToken?"eigener Token in der App":"aus dem Aktien Helfer")+" – mit „Testen“ prüfen":"fehlt – unten bei „Verbindung“ eintragen")}
   ${zeile(pass()?true:false,"Sync-Passwort",pass()?"vorhanden (muss gleich sein wie das Secret SYNC_PASSWORD)":"fehlt – unten eintragen")}
   ${zeile(SYNC?SYNC.ok:null,"Trades an den Bot senden",SYNC?(SYNC.ok?`geschickt um ${uhr(SYNC.t)}`:`Fehler: ${esc(SYNC.txt)}`):"noch nichts gesendet")}
   ${zeile(pi?pi.ok:null,"Bot liest deine Trades",pi?(pi.ok?`${pi.leer?"noch keine Trades-Datei":pi.n+" Trades gelesen"} um ${uhr(pi.t)}`:esc(pi.fehler)):"noch keine Rückmeldung")}
   <button class="btn ghost voll" data-vtest>Verbindung testen</button><div id="vtest" class="small"></div></div>`}
async function verbindungTesten(){const o=$("#vtest");o.textContent="Prüfe …";const r=[];
  try{const x=await fetch(`https://api.github.com/repos/${E.repo}`,{headers:tok()?{Authorization:`Bearer ${tok()}`}:{}});if(!x.ok)r.push(`❌ Repository ${esc(E.repo)} nicht gefunden (${x.status})`);else{const j=await x.json();r.push(j.permissions&&j.permissions.push?"✅ Token darf ins Repository schreiben":"❌ Token darf NICHT schreiben – eigenen Token mit Zugriff auf Day-dr72818 eintragen (Contents + Actions: Read and write)")}}catch(e){r.push("❌ Keine Verbindung zu GitHub")}
  if(pass()&&tok()){await hochladen();r.push(SYNC&&SYNC.ok?"✅ Test-Upload der Trades geklappt – der Bot liest sie innerhalb von 30 s":"❌ Upload fehlgeschlagen: "+esc(SYNC&&SYNC.txt))}
  try{const d=await hole("day.json");r.push(d&&d.t?`✅ Bot-Daten gefunden (vom ${new Date(d.t).toLocaleString("de-DE")})`:"❌ Keine Bot-Daten")}catch(e){r.push("❌ Bot-Daten nicht abrufbar – ist der Bot schon gelaufen?")}
  o.innerHTML=r.map(x=>`<div style="margin-top:4px">${x}</div>`).join("")}

/* ---------- Synchronisieren (verschlüsselt, gleiches Verfahren wie die Haupt-App) ---------- */
const te=new TextEncoder(),td=new TextDecoder(),b64=u=>btoa(String.fromCharCode(...u)),unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function cKey(p,salt){const k=await crypto.subtle.importKey("raw",te.encode(p),"PBKDF2",false,["deriveKey"]);return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:150000,hash:"SHA-256"},k,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])}
async function encJ(o,p){const sa=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const c=await crypto.subtle.encrypt({name:"AES-GCM",iv},await cKey(p,sa),te.encode(JSON.stringify(o)));return JSON.stringify({v:1,s:b64(sa),i:b64(iv),c:b64(new Uint8Array(c))})}
async function decJ(t,p){const o=typeof t==="string"?JSON.parse(t):t;return JSON.parse(td.decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(o.i)},await cKey(p,unb64(o.s)),unb64(o.c))))}
async function gh(path,opt){const r=await fetch(`https://api.github.com/repos/${E.repo}/contents/${path}${opt?"":"?ref=main"}`,Object.assign({headers:{Authorization:`Bearer ${tok()}`,Accept:"application/vnd.github+json"}},opt||{}));if(r.status===404)return null;if(!r.ok)throw new Error("GitHub "+r.status);return r.json()}
async function hochladen(){if(DEMO||!tok()||!pass())return;try{const cur=await gh("data/pos.enc"),einst={modus:E.modus,faktor:E.faktor,spreadZ:E.spreadZ,spreadA:E.spreadA,gebuehr:E.gebuehr,einsatz:E.einsatz,steuer:E.steuer,T:E.T,S:E.S,minP:E.minP};
    await gh("data/pos.enc",{method:"PUT",body:JSON.stringify({message:"App: Positionen",content:btoa(await encJ({pos:M.pos,einst,updatedAt:M.updatedAt},pass())),sha:cur?cur.sha:undefined,branch:"main"})});SYNC={t:Date.now(),ok:true}}catch(e){SYNC={t:Date.now(),ok:false,txt:e.message};toast("Abgleich mit dem Bot nicht möglich: "+e.message)}}
async function wecken(){if(!tok())return toast("Dafür braucht es einen GitHub-Token.");try{const r=await fetch(`https://api.github.com/repos/${E.repo}/actions/workflows/wache.yml/dispatches`,{method:"POST",headers:{Authorization:`Bearer ${tok()}`,Accept:"application/vnd.github+json"},body:JSON.stringify({ref:"main"})});toast(r.status===204?"Bot angestupst. Läuft in 1–2 Minuten.":"Geht nicht (GitHub "+r.status+")")}catch(e){toast("Keine Verbindung")}}

/* ---------- Alarm in der App (wenn sie offen ist) ---------- */
const altSt={};let ctx=null;
function benachrichtigungErlauben(){try{if("Notification" in window&&Notification.permission==="default")Notification.requestPermission()}catch(e){}}
function piep(hoch){if(!E.ton)return;try{ctx=ctx||new (window.AudioContext||window.webkitAudioContext)();(hoch?[0,.18,.36]:[0,.25,.5]).forEach((d,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=hoch?660+i*220:880;o.connect(g);g.connect(ctx.destination);g.gain.setValueAtTime(.2,ctx.currentTime+d);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+d+.2);o.start(ctx.currentTime+d);o.stop(ctx.currentTime+d+.2)})}catch(e){}}
function konfetti(){const c=["#35d0a0","#f2b640","#7ad7ff","#ff8fb1","#fff"];for(let i=0;i<40;i++){const e=document.createElement("i");e.className="konf";e.style.cssText=`left:${50+(Math.random()-.5)*30}%;background:${c[i%5]};--x:${(Math.random()-.5)*520}px;--y:${-220-Math.random()*320}px;--r:${Math.random()*720}deg;animation-delay:${Math.random()*.15}s`;document.body.appendChild(e);setTimeout(()=>e.remove(),1800)}}
function alarmPruefen(){for(const x of M.pos){const s=stand(x);const vorher=altSt[x.id];altSt[x.id]=s.st;if(vorher===undefined||vorher===s.st||s.st==="halten")continue;
    const t=TUN[s.st],titel=`${t[1]}: ${x.n}${x.ueb?" (Übung)":""}`,text=`${t[2]} · ${eu(s.net)} netto`;meldung(s.st,titel,text);
    const ab=$("#alarmband");ab.className="alarmband on "+t[0];ab.innerHTML=`<span class="aw">${t[1]}</span> ${esc(x.n)}${x.ueb?" 🧪":""}<small>${esc(t[2])} · ${eu(s.net)} netto · tippen</small>`;clearTimeout(ab.t);ab.t=setTimeout(()=>ab.classList.remove("on"),15000);
    try{navigator.vibrate&&navigator.vibrate(t[0]==="acht"?[200]:[300,120,300,120,500])}catch(e){}piep(t[0]==="gut");if(s.st==="ziel")konfetti();
    try{if(Notification.permission==="granted")new Notification(titel,{body:text,tag:x.id})}catch(e){}}}
function verkaufe(x,net,u){const n=nachSt(net);logEintrag("verkauf",x.s,`Verkauft: ${x.n}${x.ueb?" (Übung)":""}`,{erg:n,"Aktie seit Kauf":pz(dOf(x)*u,2),Hebel:"×"+x.f,Haltezeit:Math.round((Date.now()-x.t)/6e4)+" Min."});M.pause=Object.assign({},M.pause||{},{[x.s]:Date.now()+(DEMO?60e3:10*6e4)});if(Math.abs(u)>=x.T*.6&&Date.now()-x.t<60*6e4)M.spike=Object.assign({},M.spike||{},{[x.s]:{t:Date.now(),d:Math.sign(dOf(x)*u)}});M.verkauft.push({n:x.n,s:x.s,u,net:n,t:Date.now(),ueb:!!x.ueb});M.pos=M.pos.filter(y=>y!==x);meldung(n>=0?"ziel":"stop",`Verkauft: ${x.n}${x.ueb?" (Übung)":""}`,`${eu(n)} netto`);M.beob=Object.assign({},M.beob||{},{[x.s]:Date.now()});speichernM();render(true);toast(`Verkauft: ${eu(n)} netto. Ich beobachte ${x.n} weiter.`);if(n>0)konfetti();meldung("halten",`👀 Ich beobachte ${x.n} weiter`,`Erst wenn sich Long oder Short wirklich lohnt, schlage ich es dir vor – nicht im ersten Hin und Her.`)}

/* ---------- Ablauf ---------- */
let letzterTab="";
function render(neu){if(!D)return;$("#modus").textContent=E.ueb?"🧪 Übung":"💶 Echt";$("#modus").className="modus "+(E.ueb?"ueb":"echt");
  $("#demo").innerHTML=DEMO?`<div class="demo">✨ <b>Vorschau mit Beispieldaten.</b> Übungskurse spielen ähnliche Fälle nach (so oft, wie sie früher ausgingen), im Zeitraffer ×10. Echte Kurse kommen mit dem Bot.</div>`:"";
  $("#status").textContent=DEMO?"Beispieldaten":`Stand ${uhr(D.t)} · ${(D.signale||[]).filter(x=>x.bis>Date.now()).length} aktive Einstiege`;
  $("#live").innerHTML=["us","de"].map(m=>{const k=D.markt&&D.markt[m]||{};return `<span class="chip"><span class="dot ${k.offen?"on":"off"}"></span>${m==="us"?"🇺🇸 USA":"🇪🇺 Europa"} ${k.offen?`bis ${uhr(k.zu)}`:"zu"}${k.trend?` ${k.trend==="auf"?"↗":k.trend==="ab"?"↘":"→"}`:""}</span>`}).join("");
  $$(".tabs button").forEach(b=>b.classList.toggle("on",b.dataset.tab===tab));$(".tabs .in").style.setProperty("--i",["jetzt","zeiten","meine","archiv","bilanz"].indexOf(tab));
  const nRaus=M.pos.filter(x=>["raus","gut"].includes(TUN[stand(x).st][0])).length,tb=$('.tabs [data-tab="meine"]');tb.querySelector(".bdg")?.remove();if(nRaus)tb.insertAdjacentHTML("beforeend",`<span class="bdg">${nRaus}</span>`);
  RUHIG=!neu&&letzterTab===tab;letzterTab=tab;const v=$("#view");v.classList.toggle("ruhig",RUHIG);
  v.innerHTML=tab==="jetzt"?seiteJetzt():tab==="zeiten"?seiteZeiten():tab==="meine"?seiteMeine():tab==="archiv"?seiteArchiv():seiteBilanz();RUHIG=false;glocke()}
let tickN=0;
function tick(){if(!D)return;tickN++;const jetzt=Date.now();
  for(const x of D.signale||[]){const e=$(`[data-cd="${x.id}"]`);if(e){const r=x.bis-jetzt,c=e.querySelector(".cd"),b=e.querySelector(".cdbar");if(c)c.textContent=r>0?mmss(r):"";if(b)b.style.width=Math.max(0,r/Math.max(1,x.bis-x.t)*100)+"%";e.classList.toggle("knapp",r>0&&r<4*6e4);e.classList.toggle("weg",r<=0)}}
  $$("[data-fen]").forEach(e=>{const r=+e.dataset.fen-jetzt;e.textContent=r>0?e.dataset.pre+mmss(r):"vorbei"});
  if(tickN%5===0&&!scrub.on)$$(".kc").forEach(b=>{const sy=b.dataset.kc,r=KR[sy]||(offen?"1h":"1d");if(r==="15m"||r==="1h"){const x=(D.signale||[]).find(y=>y.id===offen);b.querySelector(".kc-in").innerHTML=kursSvg(sy,r,x&&x.s===sy?x:null);b.querySelector(".zeichne")&&(b.querySelector(".zeichne").style.animation="none")}});
  $$("[data-px2]").forEach(e=>{const p=preis(e.dataset.px2),k=D.kurse[e.dataset.px2];if(p&&k)e.textContent=kurs(p,k.cur)});
  if(tickN%15===0)vorschlaegePruefen();
  for(const x of D.signale||[]){if(ED[x.id]!=="dip"||x.dipMeld||M.pos.some(p=>p.s===x.s))continue;const r=dipRechnung(x,HB[x.id]??F());if(!r)continue;const p=preis(x.s);
    if(p&&dOf(x)*(p-r.lim)<=0&&jetzt<x.bis+r.min*2*6e4){x.dipMeld=1;meldung("signal",`🚨 Dip erreicht: ${x.n} ${istShort(x)?"SHORT":"LONG"}`,`Jetzt kaufen bei ${kurs(p,x.cur)} · Ziel bleibt ${kurs(x.p0*(1+dOf(x)*xT(x)/100),x.cur)}`);
      const ab=$("#alarmband");ab.className="alarmband on gut";ab.innerHTML=`<span class="aw">DIP</span> ${esc(x.n)} jetzt kaufen<small>Kurs ${kurs(p,x.cur)} · Gewinn bis Ziel ${eu(r.eWin)} · tippen</small>`;ab.dataset.ziel="jetzt";clearTimeout(ab.t);ab.t=setTimeout(()=>ab.classList.remove("on"),15000);piep(true);try{navigator.vibrate&&navigator.vibrate([200,100,200])}catch(e){}if(tab==="jetzt")render()}}
  if(tickN%3===0)for(const x of M.pos){const h=HIST[x.id]=HIST[x.id]||[];h.push(+stand(x).net.toFixed(2));if(h.length>240)h.shift()}
  if(tab==="meine"&&!$("#sheet").classList.contains("open"))render();
  $$("[data-px]").forEach(e=>{const s=e.dataset.px,x=(D.signale||[]).find(y=>y.s===s),p=preis(s);if(p&&x){const t=kurs(p,x.cur);if(e.textContent!==t){const up=parseFloat(e.textContent.replace(/\./g,"").replace(",","."))<p;e.textContent=t;e.classList.remove("tick-up","tick-down");void e.offsetWidth;e.classList.add(up?"tick-up":"tick-down")}}});alarmPruefen()}
document.addEventListener("click",e=>{const t=e.target.closest("[data-tab],[data-open],[data-kauf],[data-kauf-ok],[data-vk],[data-vk-ok],[data-del],[data-zu],[data-zm],[data-zsym],[data-kombi],[data-e-modus],[data-wecken],[data-hb],[data-kh],[data-vtest],[data-zr],[data-zrc],[data-zrk],[data-zrneu],[data-zrwahl],[data-armehr],[data-ar],[data-pf],[data-af],[data-arsig],[data-dipwarte],[data-ed],[data-was],[data-wj],[data-kr],[data-ksheet],[data-rich],[data-zd],#einst,#einst2,#modus,#glocke,#sheet-bg,#alarmband");if(!t)return;
  if(t.dataset.tab){tab=t.dataset.tab;render(true);scrollTo({top:0,behavior:"smooth"})}
  else if(t.dataset.open)detail(t.dataset.open);
  else if(t.dataset.hb){const [id,h]=t.dataset.hb.split(":");HB[id]=+h;const x=D.signale.find(y=>y.id===id),card=t.closest(".sig");RUHIG=true;const voll=!card.querySelector("[data-kauf]")||card.closest(".sheet");card.outerHTML=signalKarte(x,0,!!card.closest(".sheet"));RUHIG=false;$$(`[data-sig="${id}"] .erg b`).forEach(b=>{b.classList.remove("pop");void b.offsetWidth;b.classList.add("pop")})}
  else if(t.dataset.kh){KF.f=+t.dataset.kh;HB[KF.id]=KF.f;const x=D.signale.find(y=>y.id===KF.id),y=$("#sheet").scrollTop;sheetInhalt(kaufForm(x));$("#sheet").scrollTop=y}
  else if(t.dataset.kauf){const x=D.signale.find(y=>y.id===t.dataset.kauf);if(!x)return;if($("#sheet").classList.contains("open")){KF=null;sheetInhalt(kaufForm(x));$("#sheet").scrollTop=0}else kaufStart(x)}
  else if(t.dataset.kaufOk){const x=D.signale.find(y=>y.id===t.dataset.kaufOk);if(x)kaufOk(x)}
  else if(t.dataset.vk){const x=M.pos.find(y=>y.id===t.dataset.vk);if(!x)return;const s=stand(x);
    if(x.ueb){verkaufe(x,s.net,s.u);return}
    sheet(`<h2>${esc(x.n)} verkauft</h2><form id="vf" onsubmit="return false"><label class="f">Verkaufskurs je Stück (€), wie in Trade Republic<input name="vk" type="number" step="any" inputmode="decimal" value="${(x.kaufZ*(1+x.f*s.u/100)*(1-spreadF(x.f)/100)).toFixed(3)}"></label><button class="btn voll" data-vk-ok="${x.id}">Verkauf speichern</button></form>`)}
  else if(t.dataset.vkOk){const x=M.pos.find(y=>y.id===t.dataset.vkOk),vk=+String($("#vf").elements.vk.value).replace(",",".");if(!x||!(vk>0))return toast("Kurs eintragen");history.back();verkaufe(x,x.stk*vk-x.stk*x.kaufZ-2*E.gebuehr,((vk/x.kaufZ)-1)/x.f*100)}
  else if(t.dataset.del){if(t.dataset.sicher){M.pos=M.pos.filter(y=>y.id!==t.dataset.del);speichernM();render(true)}else{t.dataset.sicher=1;t.textContent="Wirklich?";t.classList.add("rot")}}
  else if(t.dataset.kr){const [sy,r]=t.dataset.kr.split(":");KR[sy]=r;const box=t.closest(".kc");box.querySelectorAll("[data-kr]").forEach(b=>b.classList.toggle("on",b===t));const x=(D.signale||[]).find(y=>y.id===offen);box.querySelector(".kc-in").innerHTML=kursSvg(sy,r,x&&x.s===sy?x:null)}
  else if(t.dataset.ed){const [id,m]=t.dataset.ed.split(":");ED[id]=m;const x=D.signale.find(y=>y.id===id),card=t.closest(".sig");RUHIG=true;card.outerHTML=signalKarte(x,0,!!card.closest(".sheet"));RUHIG=false}
  else if(t.dataset.dipwarte){const x=D.signale.find(y=>y.id===t.dataset.dipwarte);toast(`Ich melde mich, wenn ${x.n} den Dip-Kurs erreicht.`);benachrichtigungErlauben();t.textContent="🔔 Ich warte auf den Dip …";t.disabled=true}
  else if(t.hasAttribute("data-armehr")){arMehr=true;render()}
  else if(t.dataset.ar){arTab=t.dataset.ar;render(true)}
  else if(t.dataset.pf){protoFilter=t.dataset.pf;render()}
  else if(t.dataset.af){arFilter[t.dataset.af]=!arFilter[t.dataset.af];render()}
  else if(t.dataset.arsig){arSig=t.dataset.arsig;arTab="aehnlich";if($("#sheet").classList.contains("open"))history.back();tab="archiv";render(true);scrollTo(0,0)}
  else if(t.dataset.zr){const [sy,tag]=t.dataset.zr.split("|");zeitreiseStart(sy,tag)}
  else if(t.hasAttribute("data-zrwahl"))zeitreiseWahl();
  else if(t.hasAttribute("data-zrneu")){clearInterval(zeitreiseTakt.t);ZR=null;zeitreiseWahl()}
  else if(t.dataset.zrc&&ZR){const c=t.dataset.zrc;if(c==="lauf"){ZR.lauf=!ZR.lauf;ZR.letzt=Date.now()}else if(c==="auto")ZR.auto=!ZR.auto;else if(c==="vk")zrVerkauf();else if(c[0]==="t")ZR.tempo=+c.slice(1);const y=$("#sheet").scrollTop;sheetInhalt(zeitreiseHtml());$("#sheet").scrollTop=y}
  else if(t.dataset.zrk&&ZR){const [dir,si]=t.dataset.zrk.split(":");zrKauf(dir,si!=null?+si:null);const y=$("#sheet").scrollTop;sheetInhalt(zeitreiseHtml());$("#sheet").scrollTop=y}
  else if(t.hasAttribute("data-vtest"))verbindungTesten();
  else if(t.dataset.ksheet)kursSheet(t.dataset.ksheet);
  else if(t.dataset.was){if($("#sheet").classList.contains("open"))sheetInhalt(wasJetztHtml(t.dataset.was)+`<button class="btn ghost voll" data-zu>Schließen</button>`);else wasJetzt(t.dataset.was)}
  else if(t.dataset.wj){const [sy,dir,T,S]=t.dataset.wj.split(":");if($("#sheet").classList.contains("open")){history.back();setTimeout(()=>wjKauf(sy,dir,+T,+S),320)}else wjKauf(sy,dir,+T,+S)}
  else if(t.dataset.rich){E.richtung=t.dataset.rich;speichernE();render()}
  else if(t.dataset.zd){zDir=t.dataset.zd;render()}
  else if(t.dataset.zm){zMarkt=t.dataset.zm;zSym="";render(true)}
  else if(t.dataset.zsym){if($("#sheet").classList.contains("open"))history.back();const k=D.kurse[t.dataset.zsym];if(t.dataset.zdir)zDir=t.dataset.zdir;zMarkt=k?k.m:zMarkt;zSym=t.dataset.zsym;tab="zeiten";render(true);scrollTo(0,0)}
  else if(t.dataset.kombi){const [a,b]=t.dataset.kombi.split(":").map(Number);E.T=a;E.S=b;speichernE();speichernM();toast(`Ziel +${nf(a,2)} % / Stop −${nf(b,2)} % übernommen`);if(offen)detail(offen);render(true)}
  else if(t.dataset.eModus){E.modus=t.dataset.eModus;speichernE();einstellungen();render(true)}
  else if(t.hasAttribute("data-wecken"))wecken();
  else if(t.id==="einst"||t.id==="einst2")einstellungen();
  else if(t.id==="glocke")meldungen();
  else if(t.id==="modus"){E.ueb=!E.ueb;speichernE();render(true);toast(E.ueb?"🧪 Übungsmodus: kein echtes Geld":"💶 Echt-Modus: du trägst echte Käufe ein")}
  else if(t.id==="alarmband"){t.classList.remove("on");tab=t.dataset.ziel||"meine";delete t.dataset.ziel;render(true);scrollTo({top:0,behavior:"smooth"})}
  else if(t.hasAttribute("data-zu")||t.id==="sheet-bg")history.back()});
document.addEventListener("input",e=>{if(e.target.name==="trname"){const m=e.target.value.match(/(long|short)\s*([\d.,]+)/i);if(m){const z=+m[2].replace(/\.(?=\d{3}(\D|$))/g,"").replace(",",".");const f=e.target.form;if(z>0&&f&&f.elements.ko){f.elements.ko.value=z;toast(`Knock-out-Schwelle ${nf(z,2)} übernommen (${m[1]})`)}}return}if(e.target.id==="kf-ein"&&KF){const v=+String(e.target.value).replace(",",".");if(v>0){KF.ein=v;const x=D.signale.find(y=>y.id===KF.id),y=$("#sheet").scrollTop,pos=e.target.selectionStart;sheetInhalt(kaufForm(x));$("#sheet").scrollTop=y;const n=$("#kf-ein");n.focus();try{n.setSelectionRange(pos,pos)}catch(_){}}}});
document.addEventListener("change",e=>{const t=e.target;if(t.id==="zsym"){zSym=t.value;render(true);return}if(t.id==="arsig"){arSig=t.value;render(true);return}const k=t.dataset&&t.dataset.e;if(!k)return;
  E[k]=["repo","ghToken","syncPass","fhKey","richtung"].includes(k)?t.value.trim():+String(t.value).replace(",",".");speichernE();if(["T","S","minP","faktor","einsatz","modus"].includes(k))speichernM();render(true);toast("Gespeichert")});
window.addEventListener("popstate",()=>{if($("#sheet").classList.contains("open"))zu()});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)laden()});
if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(()=>{});
{const h=location.hash.slice(1);if(["jetzt","zeiten","meine","archiv","bilanz"].includes(h)){tab=h;history.replaceState(null,"",location.pathname)}}
laden();setInterval(()=>{if(!document.hidden)laden()},30000);setInterval(tick,1000);
