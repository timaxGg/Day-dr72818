/* Day-Trader Rechenkern: dieselbe Rechnung im Bot (Node) und in der App (Browser).
   Alles hier rechnet nur mit echten Kursen (5-Minuten-Kerzen). Nichts wird geschätzt oder erfunden:
   Wo zu wenige Fälle vorliegen, kommt null zurück und die App zeigt „keine Daten“.

   Kerzen-Format (B): {t:[Sekunden], o:[], h:[], l:[], c:[], v:[]} nur reguläre Handelszeit, aufsteigend.
   Raster: Ziel (T) und Stop (S) in % der Aktie, je 4 Stufen → 16 Kombinationen, Index g = ti*4+si. */
(function(G){
"use strict";
const GT=[.5,.75,1,1.5],GS=[.5,.75,1,1.5],NG=16,gi=(T,S)=>Math.max(0,GT.indexOf(+T))*4+Math.max(0,GS.indexOf(+S));
const MAXB=24;          // längste nachgerechnete Haltezeit: 24 Kerzen = 2 Stunden
const PFAD=13;          // Verlauf für „ähnliche Fälle“: 13 Punkte = Einstieg bis +60 Min.
const MIN_START=15,MIN_REST=45; // keine Einstiege in den ersten 15 und letzten 45 Minuten des Handelstags

/* ---------- Muster (Long: Aktie soll steigen, Short: Aktie soll fallen) ---------- */
// Jedes Muster ist eine feste, nachprüfbare Regel aus Kursdaten. x = Merkmale der gerade abgeschlossenen Kerze.
const MUSTER={
  "long:rueck":   {n:"Rücksetzer im Aufwärtstrend",t:"Kurs liegt über dem Tagesschnitt, kommt kurz an die 21er-Linie zurück und dreht mit einer grünen Kerze wieder hoch.",
                   f:x=>x.c>x.vw&&x.e9>x.e21&&x.l<=x.e21*1.001&&x.c>x.o&&x.rsi>=40&&x.rsi<=60&&x.mkt>=0},
  "long:vwap":    {n:"Zurück über den Tagesschnitt",t:"Kurs war unter dem Tagesschnitt (VWAP) und schiebt sich mit erhöhtem Umsatz zurück darüber.",
                   f:x=>x.cP<x.vwP&&x.c>x.vw&&x.e9>x.e9P&&x.rv>=1.2&&x.mkt>=0},
  "long:ausbruch":{n:"Ausbruch über die erste halbe Stunde",t:"Kurs bricht mit Umsatz über das Hoch der ersten 30 Minuten.",
                   f:x=>x.min>=30&&x.min<=150&&x.orh!=null&&x.c>x.orh&&x.cP<=x.orh&&x.rv>=1.3&&x.mkt>=0},
  "long:schwung": {n:"Schwung mit neuem Tageshoch",t:"Starker Tag (≥ +1 %), neues Tageshoch, Trend und Markt zeigen nach oben.",
                   f:x=>x.dch>=1&&x.c>x.vw&&x.e9>x.e21&&x.hod!=null&&x.c>=x.hod&&x.min<=240&&x.rsi<75&&x.mkt>=0},
  "long:abprall": {n:"Abprall nach starkem Abverkauf",t:"Stark überverkauft (RSI unter 28), weit unter dem Tagesschnitt, erste grüne Kerze. Gegen den Trend – riskanter.",
                   f:x=>x.rsi<28&&x.c<x.vw*(1-1.5*x.atr/100)&&x.c>x.o&&x.mkt>-1},
  "short:ruecklauf":{n:"Erholung im Abwärtstrend",t:"Kurs liegt unter dem Tagesschnitt, läuft kurz an die 21er-Linie hoch und dreht mit einer roten Kerze wieder nach unten.",
                   f:x=>x.c<x.vw&&x.e9<x.e21&&x.h>=x.e21*.999&&x.c<x.o&&x.rsi>=40&&x.rsi<=60&&x.mkt<=0},
  "short:schwaeche":{n:"Schwäche unter dem Tagesschnitt",t:"Kurs war über dem Tagesschnitt (VWAP) und fällt mit erhöhtem Umsatz darunter.",
                   f:x=>x.cP>x.vwP&&x.c<x.vw&&x.e9<x.e9P&&x.rv>=1.2&&x.mkt<=0},
  "short:bruch":  {n:"Bruch unter die erste halbe Stunde",t:"Kurs bricht mit Umsatz unter das Tief der ersten 30 Minuten.",
                   f:x=>x.min>=30&&x.min<=150&&x.orl!=null&&x.c<x.orl&&x.cP>=x.orl&&x.rv>=1.3&&x.mkt<=0},
  "short:abwaerts":{n:"Abwärts mit neuem Tagestief",t:"Schwacher Tag (≤ −1 %), neues Tagestief, Trend und Markt zeigen nach unten.",
                   f:x=>x.dch<=-1&&x.c<x.vw&&x.e9<x.e21&&x.lod!=null&&x.c<=x.lod&&x.min<=240&&x.rsi>25&&x.mkt<=0},
  "short:ueberkauft":{n:"Rücklauf nach Übertreibung",t:"Stark überkauft (RSI über 72), weit über dem Tagesschnitt, erste rote Kerze. Gegen den Trend – riskanter.",
                   f:x=>x.rsi>72&&x.c>x.vw*(1+1.5*x.atr/100)&&x.c<x.o&&x.mkt<1}
};
const MKEYS=Object.keys(MUSTER);

/* ---------- Zeit ---------- */
const FMT={};
function tagVon(sec,tz){const f=FMT[tz]||(FMT[tz]=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}));return f.format(new Date(sec*1000))}
function minutenVon(sec,tz){const f=FMT[tz+"m"]||(FMT[tz+"m"]=new Intl.DateTimeFormat("en-GB",{timeZone:tz,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}));const [h,m]=f.format(new Date(sec*1000)).split(":").map(Number);return h*60+m}

/* ---------- Vorbereitung: Indikatoren über alle Kerzen ---------- */
function ema(a,n){const r=new Array(a.length),k=2/(n+1);let e=a[0];for(let i=0;i<a.length;i++){e=i?a[i]*k+e*(1-k):a[i];r[i]=e}return r}
function rsi(c,n=14){const r=new Array(c.length).fill(50);let g=0,l=0;for(let i=1;i<c.length;i++){const d=c[i]-c[i-1],up=Math.max(d,0),dn=Math.max(-d,0);
  if(i<=n){g+=up/n;l+=dn/n}else{g=(g*(n-1)+up)/n;l=(l*(n-1)+dn)/n}if(i>=n)r[i]=l===0?100:100-100/(1+g/l)}return r}
function prep(B,tz){const n=B.c.length,P={B,tz,n,tag:new Array(n),ds:new Array(n),de:new Array(n),min:new Array(n)};
  let start=0;for(let i=0;i<n;i++){P.tag[i]=tagVon(B.t[i],tz);P.min[i]=minutenVon(B.t[i],tz);if(i&&P.tag[i]!==P.tag[i-1])start=i;P.ds[i]=start}
  let ende=n-1;for(let i=n-1;i>=0;i--){if(i<n-1&&P.tag[i]!==P.tag[i+1])ende=i;P.de[i]=ende}
  P.e9=ema(B.c,9);P.e21=ema(B.c,21);P.rsi=rsi(B.c);P.vw=new Array(n);P.atr=new Array(n);P.orh=new Array(n);P.orl=new Array(n);P.hod=new Array(n);P.lod=new Array(n);P.rv=new Array(n);P.vor=new Array(n);
  let pv=0,vv=0,ty=0,cnt=0,hi=-Infinity,lo=Infinity,oh=-Infinity,ol=Infinity,prevClose=null,lastDayClose=null;
  for(let i=0;i<n;i++){if(i===P.ds[i]){pv=0;vv=0;ty=0;cnt=0;hi=-Infinity;lo=Infinity;oh=-Infinity;ol=Infinity;prevClose=lastDayClose}
    const tp=(B.h[i]+B.l[i]+B.c[i])/3,v=B.v[i]||0;pv+=tp*v;vv+=v;ty+=tp;cnt++;P.vw[i]=vv>0?pv/vv:ty/cnt;
    P.hod[i]=hi>-Infinity?hi:null;P.lod[i]=lo<Infinity?lo:null;hi=Math.max(hi,B.h[i]);lo=Math.min(lo,B.l[i]);
    if(i-P.ds[i]<6){oh=Math.max(oh,B.h[i]);ol=Math.min(ol,B.l[i])}P.orh[i]=i-P.ds[i]>=6?oh:null;P.orl[i]=i-P.ds[i]>=6?ol:null;
    let s=0,k=0;for(let j=Math.max(0,i-13);j<=i;j++){s+=(B.h[j]-B.l[j])/B.c[j];k++}P.atr[i]=s/k*100;
    let sv=0,kv=0;for(let j=Math.max(0,i-20);j<i;j++){sv+=B.v[j]||0;kv++}P.rv[i]=kv&&sv>0?(B.v[i]||0)/(sv/kv):1;
    P.vor[i]=prevClose;if(i===P.de[i])lastDayClose=B.c[i]}
  return P}
// Marktlage: Index-Trend (9er über/unter 21er-Linie) zur selben Zeit; +1 steigend, −1 fallend, 0 unbekannt/seitwärts
function marktKarte(R){if(!R)return null;const m=new Map();for(let i=0;i<R.n;i++){const d=(R.e9[i]-R.e21[i])/R.B.c[i]*100;m.set(R.B.t[i],d>.03?1:d<-.03?-1:0)}return m}
function merkmale(P,i,MK){const B=P.B;if(i<1||i<P.ds[i]+1)return null;
  return {o:B.o[i],h:B.h[i],l:B.l[i],c:B.c[i],cP:B.c[i-1],vw:P.vw[i],vwP:P.vw[i-1],e9:P.e9[i],e9P:P.e9[i-1],e21:P.e21[i],rsi:P.rsi[i],atr:P.atr[i],
    orh:P.orh[i],orl:P.orl[i],hod:P.hod[i],lod:P.lod[i],rv:P.rv[i],dch:P.vor[i]?(B.c[i]/P.vor[i]-1)*100:0,min:(i-P.ds[i])*5,rest:(P.de[i]-i)*5,
    mkt:MK?(MK.get(B.t[i])??0):0,vwAbst:(B.c[i]/P.vw[i]-1)*100,schnell:i>=3?(B.c[i]/B.c[i-3]-1)*100:0}}
function muster(x){if(!x||x.min<MIN_START||x.rest<MIN_REST)return [];return MKEYS.filter(k=>{try{return MUSTER[k].f(x)}catch(e){return false}})}

/* ---------- Ausgang nachrechnen: Was passierte nach dem Einstieg? ---------- */
// Einstieg zum Eröffnungskurs der NÄCHSTEN Kerze (realistisch: das Signal kommt erst nach Kerzenschluss).
// Je Ziel/Stop: was kam zuerst? Kommen beide in derselben 5-Minuten-Kerze, zählt es als Stop (gegen uns gerechnet).
function ausgang(P,i,d){const B=P.B,e=B.o[i+1];if(!(e>0)||i+1>P.de[i])return null;const ende=Math.min(P.de[i]-1,i+MAXB);if(ende<=i+1)return null;
  const tT=[null,null,null,null],tS=[null,null,null,null],pfad=[0];let mae=0,maeVorZiel=[0,0,0,0];
  for(let j=i+1;j<=ende;j++){const gut=d>0?(B.h[j]/e-1)*100:(1-B.l[j]/e)*100,schlecht=d>0?(1-B.l[j]/e)*100:(B.h[j]/e-1)*100;
    for(let k=0;k<4;k++){if(tS[k]==null&&schlecht>=GS[k])tS[k]=j;if(tT[k]==null&&gut>=GT[k])tT[k]=j;if(tT[k]==null)maeVorZiel[k]=Math.max(maeVorZiel[k],schlecht)}
    mae=Math.max(mae,schlecht);if((j-i)%1===0&&pfad.length<PFAD&&j-i<=PFAD-1)pfad.push(+(d*(B.c[j]/e-1)*100).toFixed(3))}
  while(pfad.length<PFAD)pfad.push(pfad[pfad.length-1]);
  const schluss=d*(B.c[ende]/e-1)*100,r=[];
  for(let ti=0;ti<4;ti++)for(let si=0;si<4;si++){const a=tT[ti],b=tS[si];
    if(a!=null&&(b==null||a<b))r.push([1,(a-i)*5,0]);else if(b!=null)r.push([-1,(b-i)*5,0]);else r.push([0,(ende-i)*5,schluss])}
  return {e,r,pfad,mae,maeVorZiel}}

/* ---------- Statistik ---------- */
// Je Kombination: [Fälle, Ziel zuerst, Stop zuerst, Summe Rendite bei „Zeit um“, Summe Minuten bis Ziel, 24er-Histogramm Minuten bis Ziel]
const TOH=31,toBucket=r=>Math.max(0,Math.min(TOH-1,Math.round((r+1.5)*10))); // Verteilung der Ergebnisse bei „Zeit um“: −1,5 % … +1,5 % in 0,1-%-Schritten
const leer=()=>Array.from({length:NG},()=>[0,0,0,0,0,new Array(24).fill(0),0,new Array(TOH).fill(0)]);
function zaehle(st,a){for(let g=0;g<NG;g++){const [res,min,ret]=a.r[g],z=st[g];z[0]++;if(res>0){z[1]++;z[4]+=min;z[5][Math.min(23,Math.max(0,Math.ceil(min/5)-1))]++}else if(res<0)z[2]++;else{z[3]+=ret;z[6]+=ret*ret;z[7][toBucket(ret)]++}}}
function kompakt(st){return st.map(z=>[z[0],z[1],z[2],+z[3].toFixed(2),z[4],z[5].join("."),+z[6].toFixed(3),z[7].join(".")])}
function p80aus(h,w){if(!w)return null;const a=String(h).split(".").map(Number);let s=0;for(let k=0;k<a.length;k++){s+=a[k];if(s>=.8*w)return (k+1)*5}return 120}
// Geschrumpfte Wahrscheinlichkeit: wenige Fälle dieser Aktie → Richtung Durchschnitt aller Aktien mit demselben Muster ziehen
function wahrsch(eigen,alle,k=25){const p=[],pt=[],to=[],min=[],p80=[],toSq=[],toH=[];let nS=0,nT=0;
  for(let g=0;g<NG;g++){const a=alle&&alle[g]||[0,0,0,0,0,""],e=eigen&&eigen[g]||[0,0,0,0,0,""];nS=e[0];nT=a[0];if(a[0]<30){p.push(null);pt.push(null);to.push(0);min.push(null);p80.push(null);toSq.push(0);toH.push(null);continue}
    const pa=a[1]/a[0],pta=(a[0]-a[1]-a[2])/a[0],pe=(e[1]+k*pa)/(e[0]+k),pte=((e[0]-e[1]-e[2])+k*pta)/(e[0]+k),toA=a[0]-a[1]-a[2]>0?a[3]/(a[0]-a[1]-a[2]):0;
    p.push(+pe.toFixed(3));pt.push(+pte.toFixed(3));to.push(+toA.toFixed(3));min.push(a[1]?Math.round(a[4]/a[1]):null);p80.push(p80aus(a[5],a[1]));const nt=a[0]-a[1]-a[2];toSq.push(nt&&a[6]!=null?+(a[6]/nt).toFixed(4):+(toA*toA+.25).toFixed(4));toH.push(a[7]||null)}
  return {p,pt,to,min,p80,toSq,toH,nS,nT}}

/* ---------- Dip: lohnt sich das Warten auf einen Rücksetzer? ---------- */
// Für jedes Muster: Wie weit lief der Kurs bei späteren Gewinnern erst gegen uns (Median)? Wie oft kam dieser Rücksetzer überhaupt,
// und wie oft erreichte ein Einstieg genau dort das (gleiche) Ziel vor dem (gleichen) Stop?
function dipStat(P,liste,d,T,S){const ti=GT.indexOf(T),si=GS.indexOf(S),g=ti*4+si,gew=liste.filter(x=>x.a.r[g][0]>0).map(x=>x.a.maeVorZiel[ti]).sort((a,b)=>a-b);
  if(liste.length<40||gew.length<20)return null;const tief=Math.min(gew[Math.floor(gew.length/2)],S*.5);if(tief<.05)return null;
  let gefuellt=0,gut=0;for(const x of liste){const B=P[x.s]?P[x.s].B:null;if(!B)continue;const e=x.a.e,lim=e*(1-d*tief/100),zl=e*(1+d*T/100),st=e*(1-d*S/100),ende=Math.min(P[x.s].de[x.i]-1,x.i+MAXB);let ein=null;
    for(let j=x.i+1;j<=ende;j++){if(ein==null){if(d>0?B.l[j]<=lim:B.h[j]>=lim)ein=j;else if(d>0?B.h[j]>=zl:B.l[j]<=zl)break;else continue}
      const sch=d>0?B.l[j]<=st:B.h[j]>=st,ziel=d>0?B.h[j]>=zl:B.l[j]<=zl;if(sch){break}if(ziel&&j>ein){gut++;break}}
    if(ein!=null)gefuellt++}
  if(gefuellt<20)return null;return {tief:+tief.toFixed(2),q:+(gefuellt/liste.length).toFixed(2),p:+(gut/gefuellt).toFixed(3),n:gefuellt}}

/* ---------- Kosten und Ergebnis in Euro ---------- */
// E = Einstellungen {spreadZ, spreadA, gebuehr, einsatz, steuer}; f = Hebel (Faktor). Spread gilt beim Faktor-Zertifikat (f>1), sonst der der Aktie.
const spreadF=(E,f)=>f>1?+E.spreadZ:+E.spreadA,kostenF=(E,f,ein=E.einsatz)=>spreadF(E,f)+2*E.gebuehr/ein*100,nachSt=(E,v)=>v>0?v*(1-E.steuer/100):v;
// Gewinn-Chance: Ziel erreicht ODER bei „Zeit um“ mehr als die Kosten gelaufen. Sicherheit: wie viele Standardfehler der Ø nach Kosten über null liegt.
function bewerte(E,x,T,S,f,ein=E.einsatz){const g=gi(T,S),p=x.p[g];if(p==null)return null;const pt=x.pt[g]||0,pl=Math.max(0,1-p-pt),k=kostenF(E,f,ein),win=f*T-k,loss=-f*S-k,to=f*(x.to[g]||0)-k,ev=p*win+pl*loss+pt*to,eur=v=>ein*v/100;
  const ex2=p*(f*T)**2+pl*(f*S)**2+pt*f*f*((x.toSq&&x.toSq[g])||((x.to[g]||0)**2+.25)),roh=ev+k,sd=Math.sqrt(Math.max(1e-9,ex2-roh*roh)),n=Math.max(1,x.nT||30),t=ev/(sd/Math.sqrt(n));
  let toPlus=.5;const h=x.toH&&x.toH[g];if(h){const a=String(h).split(".").map(Number),sum=a.reduce((q,v)=>q+v,0),thr=k/f;if(sum){let o=0;a.forEach((v,i)=>{if(-1.5+i*.1>thr)o+=v});toPlus=o/sum}}
  const pPlus=p+pt*toPlus,pZvS=p+pl>0?p/(p+pl):0;
  return {g,p,pt,pl,win,loss,to,ev,f,k,t,pPlus,pZvS,eWin:nachSt(E,eur(win)),eLoss:eur(loss),eEv:nachSt(E,eur(ev)),min:x.min[g]||null,richt:x.p80&&x.p80[g]||null}}

/* ---------- Ähnliche Fälle ---------- */
// Fall-Format: {s,t,k,d,f:[rsi,vwAbst,dch,min,mkt,rv,atr,schnell],pf:[13 Werte ×100],r:"16 Zeichen w/l/z",tm:[16 Minuten bis Entscheidung],nw?:Nachrichten,zh?:Tage bis Zahlen}
function fallAus(s,t,k,x,a){return {s,t,k,d:k.startsWith("short")?-1:1,f:[+x.rsi.toFixed(0),+x.vwAbst.toFixed(2),+x.dch.toFixed(2),x.min,x.mkt,+x.rv.toFixed(2),+x.atr.toFixed(2),+x.schnell.toFixed(2)],
  pf:a.pfad.map(v=>Math.round(v*100)),r:a.r.map(z=>z[0]>0?"w":z[0]<0?"l":"z").join(""),tm:a.r.map(z=>z[1])}}
const GEW=[.03,1.2,.5,.01,.8,.6,1,1];
function aehnlich(faelle,ziel,n=100){const z=ziel.f;return faelle.filter(f=>f.d===ziel.d).map(f=>{let dist=f.k===ziel.k?0:1.5;for(let j=0;j<z.length;j++)dist+=Math.abs((f.f[j]||0)-(z[j]||0))*GEW[j];return {f,dist}})
  .sort((a,b)=>a.dist-b.dist).slice(0,n).map(o=>Object.assign({},o.f,{sim:Math.max(1,Math.round(100-o.dist*8))}))}
// Halten oder verkaufen – aus echten Fällen: Fälle derselben Richtung, die zum selben Zeitpunkt ähnlich weit im Plus/Minus waren und noch offen,
// was passierte danach? Gibt null zurück, wenn es weniger als 30 solche Fälle gibt (dann rechnet stand() mit einer vorsichtigen Faustregel).
function haltenAus(faelle,d,T,S,u,peakU,minSeit){if(!faelle||!faelle.length)return null;const g=gi(T,S),k=Math.max(1,Math.min(PFAD-1,Math.round(minSeit/5)));let n=0,w=0,l=0;
  for(const f of faelle){if(f.d!==d||f.tm[g]<=k*5)continue;const v=f.pf[k]/100,mx=Math.max(...f.pf.slice(0,k+1))/100;if(Math.abs(v-u)>.2||Math.abs(mx-peakU)>.3)continue;n++;if(f.r[g]==="w")w++;else if(f.r[g]==="l")l++}
  return n>=30?{pZ:w/n,pS:l/n,n}:null}

/* ---------- Offener Trade: Stand und Empfehlung (Halten / Achtung / Verkaufen) ---------- */
// x: {dir, f, kaufZ, stk, basis, T, S, t, bis, pSig, peak, peakU}; p: aktueller Aktienkurs; zu: Börsenschluss (ms); jetzt: ms
function stand(E,x,p,zu,jetzt,faelle){const d=x.dir==="short"?-1:1,u=d*(p/x.basis-1)*100,f=x.f||1,sp=spreadF(E,f);
  const wert=x.kaufZ*Math.max(0,1+f*u/100),verk=wert*(1-sp/100),einsatz=x.stk*x.kaufZ,net=x.stk*verk-einsatz-2*E.gebuehr,netP=net/einsatz*100;
  const peak=Math.max(x.peak||0,netP),peakU=Math.max(x.peakU??0,u),k=sp+2*E.gebuehr/einsatz*100,start=Math.max(.5,(f*x.T-k)*.5),linie=peak>=start?Math.max(.2,peak*.5):null,eur=v=>einsatz*v/100;
  const zielE=eur(f*x.T-k),stopE=eur(-f*x.S-k),beU=(((1+2*E.gebuehr/einsatz)/(1-sp/100)-1)/f)*100;
  // Chance aufs Ziel / Risiko Stop ab jetzt. Ausgangswert: Trefferquote des Signals. Fortschritt erhöht, Rückgang vom Hoch und verstrichene Zeit senken sie.
  const prog=u/x.T,dd=Math.max(0,peakU-u)/x.T,richt=Math.max(5,((x.bis||jetzt)-x.t)/6e4),tf=(jetzt-x.t)/6e4/richt,base=x.pSig||.55;
  let pZ=Math.min(.95,Math.max(.03,base+.3*prog-.7*dd-.3*Math.max(0,tf-.5))),pS=Math.min(.95,Math.max(.02,(1-base)-.3*prog+.55*dd+.1*tf));if(pZ+pS>.97){const q=.97/(pZ+pS);pZ*=q;pS*=q}
  const seit=(jetzt-x.t)/6e4,aus=(x.setup&&faelle?haltenAus(faelle.filter(f=>f.k===x.setup),d,x.T,x.S,u,peakU,seit):null)||haltenAus(faelle,d,x.T,x.S,u,peakU,seit);if(aus){pZ=aus.pZ;pS=aus.pS}
  const jetztE=nachSt(E,net),evHalt=pZ*nachSt(E,zielE)+pS*stopE+(1-pZ-pS)*jetztE,marge=Math.max(.5,einsatz*.002),gedreht=peakU>=x.T*.4&&dd>=.25;
  let st="halten";
  if(u>=x.T)st="ziel";else if(u<=-x.S)st="stop";
  else if((net>0||gedreht&&net>-2*marge)&&evHalt<jetztE+marge)st="dreht";
  else if(linie!=null&&netP<=linie)st="schmilzt";else if(zu&&jetzt>zu-20*6e4)st="schluss";else if(x.bis&&jetzt>=x.bis)st="zeit";
  else if((linie!=null&&netP<peak*.8)||evHalt<jetztE+2*marge&&net>0)st="sinkt";
  return {quelle:aus?`${aus.n} echte Fälle${x.setup&&aus.gleich?" mit diesem Muster":""}`:"Faustregel",p,u,net,netP,st,linie,beU,einsatz,peak,peakU,peakE:eur(peak),linieE:linie!=null?eur(linie):null,zielE,stopE,pZ,pS,evHalt,jetztE,gedreht}}

const K={GT,GS,NG,gi,MAXB,PFAD,MUSTER,MKEYS,tagVon,minutenVon,prep,marktKarte,merkmale,muster,ausgang,leer,zaehle,kompakt,p80aus,wahrsch,dipStat,fallAus,aehnlich,haltenAus,spreadF,kostenF,nachSt,bewerte,stand};
if(typeof module!=="undefined"&&module.exports)module.exports=K;G.KERN=K;
})(typeof globalThis!=="undefined"?globalThis:this);
