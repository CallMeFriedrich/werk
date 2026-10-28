// Ratio-Rechner – in das Panel integriert. Rezepte, Items und Maschinen sind gemeinsam
// für alle Benutzer (live abgeglichen), Rechner gehören je einem Benutzer und lassen sich lesend teilen.
// Die Rechenlogik (Simplex-Optimierer,
// Ratio-Bruchrechnung, Schnelleingabe) stammt unverändert aus dem eigenständigen Rechner.
import { h, api, get, post, del, dt, toast, copyText, onEvent, modal, confirmDialog, promptDialog, menu } from './core.js';
import { iconSvg } from './icons.js';
import { addCleanup, S } from './app.js';

/* ================= Rechenkern (unverändert) ================= */
const BELTS=[{n:'Gelb',v:15},{n:'Rot',v:30},{n:'Blau',v:45},{n:'Turbo',v:60},{n:'Turbo gestapelt',v:240}];
const uid=()=>Math.random().toString(36).slice(2,10);
const num=v=>{const n=parseFloat(String(v??'').replace(',','.'));return isFinite(n)?n:NaN};
const norm=s=>String(s??'').trim().toLowerCase();
const catsOf=m=>String(m.categories||'').split(',').map(norm).filter(Boolean);

function defaultPlan(){return{targets:[],unit:'min',belt:15,recipeChoice:{},machineChoice:{},catDefault:{},mods:{},inputs:[]}}

function sampleData(){
  const items=[],by={};
  const it=(n,k='item')=>{if(by[n])return by[n];const o={id:uid(),name:n,kind:k};items.push(o);by[n]=o.id;return o.id};
  ['Eisenerz','Kupfererz','Kohle','Eisenplatte','Kupferplatte','Stahlträger','Eisenzahnrad','Kupferkabel','Rohr',
   'Elektronischer Schaltkreis','Fortgeschrittener Schaltkreis','Kunststoffstange','Schwefel','Motoreinheit','Greifarm','Transportband',
   'Automatisierungsforschungspaket','Logistikforschungspaket','Chemieforschungspaket'].forEach(n=>it(n));
  ['Rohöl','Wasser','Schweröl','Leichtöl','Petroleumgas'].forEach(n=>it(n,'fluid'));
  items.find(i=>i.name==='Wasser').free=true;
  const M=(name,speed,cats)=>({id:uid(),name,speed,prod:0,categories:cats});
  const machines=[
    M('Elektrischer Bergbaubohrer',0.5,'Abbau'),
    M('Steinofen',1,'Schmelzen'),M('Stahlofen',2,'Schmelzen'),M('Elektrischer Ofen',2,'Schmelzen'),
    M('Montagemaschine 1',0.5,'Fertigung'),M('Montagemaschine 2',0.75,'Fertigung, Fertigung mit Flüssigkeit'),
    M('Montagemaschine 3',1.25,'Fertigung, Fertigung mit Flüssigkeit'),
    M('Chemiefabrik',1,'Chemie'),M('Ölraffinerie',1,'Ölverarbeitung'),
  ];
  const R=(name,time,cat,ing,prod)=>({id:uid(),name,time,category:cat,
    ingredients:ing.map(([a,n])=>({item:by[n],amount:a})),products:prod.map(([a,n])=>({item:by[n],amount:a}))});
  const recipes=[
    R('Eisenerz abbauen',1,'Abbau',[],[[1,'Eisenerz']]),
    R('Kupfererz abbauen',1,'Abbau',[],[[1,'Kupfererz']]),
    R('Kohle abbauen',1,'Abbau',[],[[1,'Kohle']]),
    R('Eisenplatte',3.2,'Schmelzen',[[1,'Eisenerz']],[[1,'Eisenplatte']]),
    R('Kupferplatte',3.2,'Schmelzen',[[1,'Kupfererz']],[[1,'Kupferplatte']]),
    R('Stahlträger',16,'Schmelzen',[[5,'Eisenplatte']],[[1,'Stahlträger']]),
    R('Eisenzahnrad',0.5,'Fertigung',[[2,'Eisenplatte']],[[1,'Eisenzahnrad']]),
    R('Kupferkabel',0.5,'Fertigung',[[1,'Kupferplatte']],[[2,'Kupferkabel']]),
    R('Rohr',0.5,'Fertigung',[[1,'Eisenplatte']],[[1,'Rohr']]),
    R('Elektronischer Schaltkreis',0.5,'Fertigung',[[1,'Eisenplatte'],[3,'Kupferkabel']],[[1,'Elektronischer Schaltkreis']]),
    R('Fortgeschrittener Schaltkreis',6,'Fertigung',[[2,'Elektronischer Schaltkreis'],[2,'Kunststoffstange'],[4,'Kupferkabel']],[[1,'Fortgeschrittener Schaltkreis']]),
    R('Motoreinheit',10,'Fertigung',[[1,'Stahlträger'],[1,'Eisenzahnrad'],[2,'Rohr']],[[1,'Motoreinheit']]),
    R('Greifarm',0.5,'Fertigung',[[1,'Elektronischer Schaltkreis'],[1,'Eisenzahnrad'],[1,'Eisenplatte']],[[1,'Greifarm']]),
    R('Transportband',0.5,'Fertigung',[[1,'Eisenzahnrad'],[1,'Eisenplatte']],[[2,'Transportband']]),
    R('Automatisierungsforschungspaket',5,'Fertigung',[[1,'Kupferplatte'],[1,'Eisenzahnrad']],[[1,'Automatisierungsforschungspaket']]),
    R('Logistikforschungspaket',6,'Fertigung',[[1,'Greifarm'],[1,'Transportband']],[[1,'Logistikforschungspaket']]),
    R('Chemieforschungspaket',24,'Fertigung',[[2,'Motoreinheit'],[3,'Fortgeschrittener Schaltkreis'],[1,'Schwefel']],[[2,'Chemieforschungspaket']]),
    R('Erweiterte Ölverarbeitung',5,'Ölverarbeitung',[[100,'Rohöl'],[50,'Wasser']],[[25,'Schweröl'],[45,'Leichtöl'],[55,'Petroleumgas']]),
    R('Schwerölcracken',2,'Chemie',[[40,'Schweröl'],[30,'Wasser']],[[30,'Leichtöl']]),
    R('Leichtölcracken',2,'Chemie',[[30,'Leichtöl'],[30,'Wasser']],[[20,'Petroleumgas']]),
    R('Kunststoffstange',1,'Chemie',[[20,'Petroleumgas'],[1,'Kohle']],[[2,'Kunststoffstange']]),
    R('Schwefel',1,'Chemie',[[30,'Wasser'],[30,'Petroleumgas']],[[2,'Schwefel']]),
  ];
  const mid=n=>machines.find(m=>m.name===n).id;
  const rid=n=>recipes.find(r=>r.name===n).id;
  const plan=defaultPlan();
  plan.unit='min';
  plan.targets=[{item:by['Automatisierungsforschungspaket'],rate:'60'},{item:by['Logistikforschungspaket'],rate:'60'}];
  plan.catDefault={'fertigung':mid('Montagemaschine 2'),'fertigung mit flüssigkeit':mid('Montagemaschine 2'),'schmelzen':mid('Stahlofen')};
  plan.recipeChoice={[by['Leichtöl']]:'auto',[by['Petroleumgas']]:'auto',[by['Schweröl']]:rid('Erweiterte Ölverarbeitung')};
  return{db:{items,machines,recipes},plan};
}

function buildIndex(db){
  const items=new Map(db.items.map(i=>[i.id,i]));
  const recipes=new Map(db.recipes.map(r=>[r.id,r]));
  const machines=new Map(db.machines.map(m=>[m.id,m]));
  const prodBy=new Map(),useBy=new Map();
  for(const r of db.recipes){
    for(const p of r.products){if(!prodBy.has(p.item))prodBy.set(p.item,[]);const a=prodBy.get(p.item);if(!a.includes(r))a.push(r)}
    for(const g of r.ingredients){if(!useBy.has(g.item))useBy.set(g.item,[]);const a=useBy.get(g.item);if(!a.includes(r))a.push(r)}
  }
  return{items,recipes,machines,prodBy,useBy};
}
function machinesFor(db,cat){const c=norm(cat);return db.machines.filter(m=>catsOf(m).includes(c))}
function pickMachine(db,plan,r,fits){
  if(!fits)fits=machinesFor(db,r.category);
  const ch=(plan.machineChoice||{})[r.id];const a=ch&&fits.find(m=>m.id===ch);if(a)return a;
  const cd=(plan.catDefault||{})[norm(r.category)];const b=cd&&fits.find(m=>m.id===cd);if(b)return b;
  return fits[0]||null;
}

/* Zwei-Phasen-Simplex: min c·x  u.d.N.  A·x >= b, x >= 0, b >= 0 (Bland-Regel gegen Zyklen) */
function lpMin(A,b,c){
  const m=A.length,n=c.length,W=n+2*m,EPS=1e-9;
  const T=[],basis=[];
  for(let i=0;i<m;i++){const row=new Float64Array(W+1);for(let j=0;j<n;j++)row[j]=A[i][j];row[n+i]=-1;row[n+m+i]=1;row[W]=b[i];T.push(row);basis.push(n+m+i)}
  const pivot=(r,col)=>{const pr=T[r],pv=pr[col];for(let j=0;j<=W;j++)pr[j]/=pv;
    for(let i=0;i<m;i++){if(i===r)continue;const f=T[i][col];if(Math.abs(f)>1e-15){const ri=T[i];for(let j=0;j<=W;j++)ri[j]-=f*pr[j]}}basis[r]=col};
  const run=(cost,allowed)=>{
    for(let it=0;it<50000;it++){
      let enter=-1;
      for(let j=0;j<W;j++){if(!allowed(j))continue;let rc=cost[j];for(let i=0;i<m;i++)rc-=cost[basis[i]]*T[i][j];if(rc<-EPS){enter=j;break}}
      if(enter<0)return'optimal';
      let leave=-1,best=Infinity;
      for(let i=0;i<m;i++){const a=T[i][enter];if(a>EPS){const ratio=T[i][W]/a;
        if(ratio<best-1e-12||(Math.abs(ratio-best)<=1e-12&&basis[i]<basis[leave])){best=ratio;leave=i}}}
      if(leave<0)return'unbounded';
      pivot(leave,enter);
    }
    return'limit';
  };
  const c1=new Float64Array(W);for(let j=n+m;j<W;j++)c1[j]=1;
  if(run(c1,()=>true)==='limit')return{status:'limit'};
  let infeas=0;for(let i=0;i<m;i++)if(basis[i]>=n+m)infeas+=T[i][W];
  const scale=1+Math.max(0,...b);
  if(infeas>1e-7*scale)return{status:'infeasible'};
  for(let i=0;i<m;i++){if(basis[i]>=n+m){for(let j=0;j<n+m;j++){if(Math.abs(T[i][j])>1e-9){pivot(i,j);break}}}}
  const c2=new Float64Array(W);for(let j=0;j<n;j++)c2[j]=c[j];
  const st=run(c2,j=>j<n+m);
  if(st!=='optimal')return{status:st};
  const x=new Array(n).fill(0);
  for(let i=0;i<m;i++)if(basis[i]<n)x[basis[i]]=Math.max(0,T[i][W]);
  return{status:'optimal',x};
}

function gcd(a,b){a=Math.abs(a);b=Math.abs(b);while(b){[a,b]=[b,a%b]}return a}
function toFrac(x){
  if(!(x>0))return null;
  let h0=0,h1=1,k0=1,k1=0,b=x;
  for(let i=0;i<40;i++){
    const a=Math.floor(b),h2=a*h1+h0,k2=a*k1+k0;
    if(k2>1e6)break;
    h0=h1;h1=h2;k0=k1;k1=k2;
    const f=b-a;
    if(Math.abs(x-h1/k1)<=1e-8*x||f<1e-12)break;
    b=1/f;
  }
  if(!k1||Math.abs(x-h1/k1)>1e-6*x)return null;
  return[h1,k1];
}
function perfectRatio(counts){
  const fr=[];
  for(const c of counts){const f=toFrac(c);if(!f)return null;fr.push(f)}
  let L=1;for(const[,q]of fr){L=L/gcd(L,q)*q;if(L>1e9)return null}
  let G=0;for(const[p,q]of fr)G=gcd(G,p*(L/q));
  if(!G)return null;
  const ints=fr.map(([p,q])=>Math.round(p*(L/q)/G));
  return{ints,s:L/G,total:ints.reduce((a,b)=>a+b,0)};
}

function computePlan(db,plan){
  const I=buildIndex(db);
  const per=plan.unit==='min'?1/60:1;
  const targets=new Map();
  for(const t of plan.targets){const r=num(t.rate);if(t.item&&I.items.has(t.item)&&r>0)targets.set(t.item,(targets.get(t.item)||0)+r*per)}
  if(!targets.size)return{empty:true};
  const inputs=new Set(plan.inputs||[]);
  const choice=plan.recipeChoice||{};
  const chosen=id=>{
    if(inputs.has(id))return[];
    const all=I.prodBy.get(id)||[];if(!all.length)return[];
    const c=choice[id];if(c==='auto')return all;
    const f=c&&all.find(r=>r.id===c);return[f||all[0]];
  };
  const itemOrder=[],itemSeen=new Set(),recOrder=[],recSeen=new Set(),importable=new Set();
  const queue=[...targets.keys()];
  while(queue.length){
    const id=queue.shift();if(itemSeen.has(id))continue;
    itemSeen.add(id);itemOrder.push(id);
    const recs=chosen(id);
    if(!recs.length){importable.add(id);continue}
    for(const r of recs){if(recSeen.has(r.id))continue;recSeen.add(r.id);recOrder.push(r);for(const g of r.ingredients)queue.push(g.item)}
  }
  for(const r of recOrder)for(const p of r.products)if(!itemSeen.has(p.item)){itemSeen.add(p.item);itemOrder.push(p.item)}

  const warnings=[];
  const recInfo=recOrder.map(r=>{
    const fits=machinesFor(db,r.category);
    const m=pickMachine(db,plan,r,fits);
    if(!m)warnings.push(`Keine Maschine für Kategorie „${r.category||'—'}“ (Rezept „${r.name}“) – gerechnet mit Tempo 1.`);
    const mod=(plan.mods||{})[r.id]||{};
    const spB=num(mod.speed)||0,prB=num(mod.prod)||0;
    let base=m?num(m.speed):1;if(!(base>0)){base=1;if(m)warnings.push(`Maschine „${m.name}“ hat kein gültiges Tempo – gerechnet mit 1.`)}
    const speed=base*Math.max(0.2,1+spB/100);
    const prod=(m?(num(m.prod)||0):0)+prB;
    const time=num(r.time)>0?num(r.time):1;
    return{r,m,fits,spB,prB,speed,prod,mult:1+prod/100,mpc:time/speed,time};
  });

  const row=new Map(itemOrder.map((id,i)=>[id,i]));
  const imp=[...importable],nR=recInfo.length,n=nR+imp.length,M=itemOrder.length;
  const A=Array.from({length:M},()=>new Array(n).fill(0)),b=new Array(M).fill(0),c=new Array(n).fill(0);
  recInfo.forEach((ri,j)=>{
    for(const g of ri.r.ingredients)A[row.get(g.item)][j]-=num(g.amount)||0;
    for(const p of ri.r.products)A[row.get(p.item)][j]+=(num(p.amount)||0)*ri.mult;
    c[j]=1e-3*ri.mpc;
  });
  imp.forEach((id,k)=>{A[row.get(id)][nR+k]=1;c[nR+k]=I.items.get(id).free?1e-4:1});
  for(const[id,r]of targets)b[row.get(id)]=r;

  const res=lpMin(A,b,c);
  if(res.status==='infeasible')return{error:'Keine Lösung: Mit den gewählten Rezepten lässt sich das Ziel nicht herstellen (z. B. ein Kreislauf ohne Nettogewinn). Wähle bei einem Item ein anderes Rezept oder „Von außen (Input)“.',warnings};
  if(res.status==='unbounded')return{error:'Unbegrenzt: Ein Rezept erzeugt kostenlos etwas, das andere Kosten senkt. Prüfe Rezepte, die Rohstoffe zurückgeben (z. B. Recycling), und setze dort eine feste Wahl.',warnings};
  if(res.status!=='optimal')return{error:'Der Optimierer hat abgebrochen. Vereinfache die Auswahl (weniger „Auto“).',warnings};
  const x=res.x;

  const flows=new Map(itemOrder.map(id=>[id,{id,item:I.items.get(id),produced:0,consumed:0,imported:0,target:targets.get(id)||0,importable:importable.has(id),forcedInput:inputs.has(id),recipes:I.prodBy.get(id)||[]}]));
  recInfo.forEach((ri,j)=>{
    const v=x[j]<1e-12?0:x[j];
    ri.rate=v;ri.machines=v*ri.mpc;
    for(const g of ri.r.ingredients)flows.get(g.item).consumed+=(num(g.amount)||0)*v;
    for(const p of ri.r.products)flows.get(p.item).produced+=(num(p.amount)||0)*ri.mult*v;
  });
  imp.forEach((id,k)=>{flows.get(id).imported=x[nR+k]});
  for(const f of flows.values()){f.surplus=f.produced+f.imported-f.consumed-f.target;if(Math.abs(f.surplus)<1e-9*(1+f.produced))f.surplus=0}

  const active=recInfo.filter(ri=>ri.machines>1e-9);
  const ratio=active.length?perfectRatio(active.map(ri=>ri.machines)):null;
  const totals=new Map();
  for(const ri of active){const k=ri.m?ri.m.name:'(keine Maschine)';const t=totals.get(k)||{exact:0,ceil:0};t.exact+=ri.machines;t.ceil+=Math.ceil(ri.machines-1e-9);totals.set(k,t)}
  return{targets,recipes:active,inactive:recInfo.length-active.length,flows:[...flows.values()],ratio,totals,warnings};
}

function parseQuick(text){
  const out={recipes:[],errors:[]};
  text.split(/\r?\n/).forEach((raw,li)=>{
    const line=raw.trim();if(!line||line.startsWith('#'))return;
    const parts=line.split(';').map(s=>s.trim());
    let core=parts[0];
    const tRaw=(parts[1]||'').replace(/s(ek)?$/i,'').trim();
    const time=tRaw===''?1:num(tRaw);
    const cat=(parts[2]||'Fertigung').trim();
    const arrow=core.indexOf('=>');
    if(arrow<0){out.errors.push(`Zeile ${li+1}: „=>“ fehlt`);return}
    let name='';const colon=core.indexOf(':');
    if(colon>=0&&colon<arrow){name=core.slice(0,colon).trim();core=core.slice(colon+1)}
    const[L,Rr]=core.split('=>');
    const pl=s=>{s=(s||'').trim();if(!s)return[];return s.split('+').map(t=>t.trim()).filter(Boolean).map(t=>{
      const m=t.match(/^(\d+(?:[.,]\d+)?)\s*[x×]?\s+(.+)$/i);
      if(!m)throw new Error(`„${t}“ – erwartet „Menge Name“`);
      const a=num(m[1]);if(!(a>0))throw new Error(`Menge bei „${t}“ ungültig`);
      return{amount:a,name:m[2].trim()};})};
    try{
      const ing=pl(L),prod=pl(Rr);
      if(!prod.length)throw new Error('kein Produkt nach „=>“');
      if(!(time>0))throw new Error('Zeit ungültig');
      out.recipes.push({name:name||prod[0].name,time,category:cat,ingredients:ing,products:prod});
    }catch(e){out.errors.push(`Zeile ${li+1}: ${e.message}`)}
  });
  return out;
}

/* ================= Panel-Integration ================= */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 });
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
const fmt = (v) => { if (!isFinite(v)) return '–'; if (Math.abs(v) < 1e-9) return '0'; if (Math.abs(v) < 0.001) return v.toExponential(2).replace('.', ','); return nf.format(v); };
const X = iconSvg('x');
const TABS = [['calc', 'Rechner'], ['recipes', 'Rezepte'], ['items', 'Items'], ['machines', 'Maschinen'], ['data', 'Import / Export']];
const COLS = ['items', 'recipes', 'machines'];
const CLIENT = uid() + uid();
const J = (o) => JSON.stringify(o);
const validDb = (d) => d && COLS.every((k) => Array.isArray(d[k]));
const normPlan = (p) => Object.assign(defaultPlan(), { machinesOff: [] }, p || {});

/* ---------- Icons ----------
   Eigene Bilder werden pro Item/Maschine hochgeladen (z. B. aus der eigenen Spielinstallation).
   Ohne Bild gibt es einen neutralen Platzhalter mit Kürzel. */
const CARGO_SLOTS = 40, FLUID_WAGON = 50000;          // Factorio 2.0 (Fluidwaggon seit 2.0.7)
// Deutsche Spielnamen → interne Namen, damit Icon-Dateien aus dem Spielordner automatisch passen
const GAME = Object.fromEntries(Object.entries({
  'iron-ore': 'Eisenerz', 'copper-ore': 'Kupfererz', 'coal': 'Kohle', 'stone': 'Stein', 'uranium-ore': 'Uranerz', 'wood': 'Holz',
  'iron-plate': 'Eisenplatte', 'copper-plate': 'Kupferplatte', 'steel-plate': 'Stahlträger', 'stone-brick': 'Steinziegel',
  'iron-gear-wheel': 'Eisenzahnrad', 'copper-cable': 'Kupferkabel', 'pipe': 'Rohr', 'electronic-circuit': 'Elektronischer Schaltkreis',
  'advanced-circuit': 'Fortgeschrittener Schaltkreis', 'processing-unit': 'Verarbeitungseinheit', 'plastic-bar': 'Kunststoffstange',
  'sulfur': 'Schwefel', 'engine-unit': 'Motoreinheit', 'electric-engine-unit': 'Elektromotor', 'inserter': 'Greifarm',
  'transport-belt': 'Transportband', 'battery': 'Batterie', 'explosives': 'Sprengstoff', 'solid-fuel': 'Festbrennstoff',
  'automation-science-pack': 'Automatisierungsforschungspaket', 'logistic-science-pack': 'Logistikforschungspaket',
  'chemical-science-pack': 'Chemieforschungspaket', 'military-science-pack': 'Militärforschungspaket',
  'production-science-pack': 'Produktionsforschungspaket', 'utility-science-pack': 'Hightech-Forschungspaket',
  'space-science-pack': 'Weltraumforschungspaket',
  'crude-oil': 'Rohöl', 'water': 'Wasser', 'heavy-oil': 'Schweröl', 'light-oil': 'Leichtöl', 'petroleum-gas': 'Petroleumgas',
  'sulfuric-acid': 'Schwefelsäure', 'lubricant': 'Schmiermittel', 'steam': 'Dampf',
  'electric-mining-drill': 'Elektrischer Bergbaubohrer', 'burner-mining-drill': 'Befeuerter Bergbaubohrer',
  'stone-furnace': 'Steinofen', 'steel-furnace': 'Stahlofen', 'electric-furnace': 'Elektrischer Ofen',
  'assembling-machine-1': 'Montagemaschine 1', 'assembling-machine-2': 'Montagemaschine 2', 'assembling-machine-3': 'Montagemaschine 3',
  'chemical-plant': 'Chemiefabrik', 'oil-refinery': 'Ölraffinerie', 'centrifuge': 'Zentrifuge',
  'foundry': 'Gießerei', 'electromagnetic-plant': 'Elektromagnetisches Werk', 'recycler': 'Recycler', 'biochamber': 'Biokammer',
  'cryogenic-plant': 'Kryogenanlage',
}).map(([k, v]) => [v.trim().toLowerCase(), k]));
const slug = (s) => norm(s).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hue = (s) => { let x = 7; for (const c of String(s || '')) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; };
function initials(name) {
  const w = String(name || '?').split(/[\s\-_]+/).filter(Boolean);
  if (w.length > 1) return (w[0][0] + (/^\d+$/.test(w[w.length - 1]) ? w[w.length - 1] : w[1][0])).toUpperCase().slice(0, 3);
  return (w[0] || '?').slice(0, 2).replace(/^./, (c) => c.toUpperCase());
}
// kind: 'item' | 'fluid' | 'machine'
function ico(o, kind = 'item', cls = '') {
  if (!o) return `<span class="ri fb ${cls}"></span>`;
  const t = esc(o.name || '');
  if (o.icon) return `<img class="ri ${cls}" src="/api/ratio/icon/${encodeURIComponent(o.icon)}" alt="${t}" title="${t}" loading="lazy" draggable="false">`;
  const k = kind === 'machine' ? 'mc' : (o.kind === 'fluid' || kind === 'fluid' ? 'fl' : '');
  return `<span class="ri fb ${k} ${cls}" style="--h:${hue(o.name)}" title="${t}" aria-label="${t}">${esc(initials(o.name))}</span>`;
}
async function iconBlob(file) {
  const bmp = await createImageBitmap(file);
  const w = bmp.width, hgt = bmp.height, s = Math.min(w, hgt);
  // Factorio-Icons enthalten Mipmaps nebeneinander (z. B. 120×64) – dann das linke, größte Bild nehmen
  const mip = w > hgt && Math.abs(w / hgt - 1.875) < 0.1;
  const sx = mip ? 0 : (w - s) / 2, sy = mip ? 0 : (hgt - s) / 2;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, sx, sy, s, s, 0, 0, 64, 64);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}
async function uploadIcon(file) {
  const blob = await iconBlob(file);
  const r = await fetch('/api/ratio/icons', { method: 'POST', headers: { 'x-fpanel': '1', 'content-type': 'image/png' }, body: blob });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  return (await r.json()).key;
}
const fmtS = (v) => (!isFinite(v) ? '–' : v > 0 && v < 0.1 ? '<0,1' : new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(v));
const fmtPow = (kw) => (kw >= 1e6 ? `${nf1.format(kw / 1e6)} GW` : kw >= 1000 ? `${nf1.format(kw / 1000)} MW` : `${nf1.format(kw)} kW`);

/* Übernimmt Einträge aus src in dst (Abgleich über den Namen) und liefert die ID-Zuordnung src → dst.
   add: fehlende Einträge anlegen · overwrite: gleichnamige Einträge mit den Werten aus src überschreiben */
function mergeDb(dst, src, { add = true, overwrite = false } = {}) {
  const map = {}, st = { added: 0, updated: 0 };
  const taken = new Set(COLS.flatMap((k) => dst[k].map((o) => o.id)));
  const freshId = (id) => (id && !taken.has(id) ? id : uid());
  for (const it of src.items || []) {
    const ex = dst.items.find((i) => norm(i.name) === norm(it.name));
    if (ex) { map[it.id] = ex.id; if (overwrite) { ex.kind = it.kind || 'item'; if (it.free) ex.free = true; else delete ex.free; st.updated++; } }
    else if (add && String(it.name || '').trim()) { const id = freshId(it.id); taken.add(id); dst.items.push({ ...it, id }); map[it.id] = id; st.added++; }
  }
  for (const m of src.machines || []) {
    const ex = dst.machines.find((x) => norm(x.name) === norm(m.name));
    if (ex) { map[m.id] = ex.id; if (overwrite) { Object.assign(ex, { ...m, id: ex.id }); st.updated++; } }
    else if (add) { const id = freshId(m.id); taken.add(id); dst.machines.push({ ...m, id }); map[m.id] = id; st.added++; }
  }
  const io = (l) => (l || []).filter((x) => map[x.item]).map((x) => ({ ...x, item: map[x.item] }));
  for (const r of src.recipes || []) {
    const ex = dst.recipes.find((x) => norm(x.name) === norm(r.name));
    const conv = { ...r, ingredients: io(r.ingredients), products: io(r.products) };
    if (ex) { map[r.id] = ex.id; if (overwrite) { Object.assign(ex, { ...conv, id: ex.id }); st.updated++; } }
    else if (add) { const id = freshId(r.id); taken.add(id); dst.recipes.push({ ...conv, id }); map[r.id] = id; st.added++; }
  }
  return { map, st };
}
function remapPlan(p, map) {
  p = normPlan(p);
  const m = (id) => (id && map[id]) || id;
  const obj = (o, fv) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [fv === 'key' ? k : m(k), fv === 'val' || fv === 'key' ? (v === 'auto' || v === 'input' ? v : m(v)) : v]));
  return { ...p, targets: p.targets.map((t) => ({ ...t, item: t.item ? m(t.item) : t.item })), inputs: (p.inputs || []).map(m),
    recipeChoice: Object.fromEntries(Object.entries(p.recipeChoice || {}).map(([k, v]) => [m(k), v === 'auto' ? v : m(v)])),
    machineChoice: Object.fromEntries(Object.entries(p.machineChoice || {}).map(([k, v]) => [m(k), m(v)])),
    catDefault: obj(p.catDefault, 'key'), mods: Object.fromEntries(Object.entries(p.mods || {}).map(([k, v]) => [m(k), v])),
    machinesOff: (p.machinesOff || []).map(m) };
}

export async function renderRatio(main) {
  const isAdmin = S.user && S.user.role === 'admin';
  let db = { items: [], recipes: [], machines: [] };
  let snap, erev, dbRev = 0;           // letzter bekannter Server-Stand des gemeinsamen Bestands
  let plans = { own: [], shared: [] }, cur = null, plan = normPlan(), planSnap = '';
  let prefs = {};
  const ui = { tab: 'calc', recipeSearch: '', itemSearch: '', edit: null, remoteNewer: false, resView: 'tree', treeOpen: new Set() };
  let saveT = null, prefT = null, busy = false, alive = true, lastBy = null, lastByT = null;

  const takeServer = (d) => {
    db = { items: d.items, recipes: d.recipes, machines: d.machines };
    snap = Object.fromEntries(COLS.map((k) => [k, new Map(db[k].map((o) => [o.id, J(o)]))]));
    erev = Object.fromEntries(COLS.map((k) => [k, new Map(Object.entries((d.revs || {})[k] || {}))]));
    dbRev = d.rev || 0;
  };
  function pendingChanges() {
    const out = {}; let n = 0;
    for (const k of COLS) {
      const sm = snap[k], ids = new Set(), upsert = [], del = [];
      for (const o of db[k]) { ids.add(o.id); const s = J(o); if (sm.get(o.id) !== s) upsert.push([o, s]); }
      for (const id of sm.keys()) if (!ids.has(id)) del.push(id);
      if (upsert.length || del.length) { out[k] = { upsert, delete: del }; n += upsert.length + del.length; }
    }
    return n ? out : null;
  }
  const planDirty = () => J(plan) !== planSnap;

  // ---------- Laden ----------
  try {
    const [d, pl, pr] = await Promise.all([get('/api/ratio/db'), get('/api/ratio/plans'), get('/api/me/data/ratio_ui')]);
    prefs = pr.value || {};
    if (prefs.tab) ui.tab = prefs.tab;
    if (prefs.resView) ui.resView = prefs.resView;
    plans = pl;
    let legacy = null;
    if (!prefs.migrated) { try { const l = (await get('/api/me/data/ratio')).value; if (l && validDb(l.db)) legacy = l; } catch {} }
    let seedMap = null;
    if (!d.initialized) {
      const seed = legacy ? legacy.db : sampleData().db;
      try { await post('/api/ratio/db/init', { items: seed.items, recipes: seed.recipes, machines: seed.machines }); seedMap = {}; } catch {}
      takeServer(await get('/api/ratio/db'));
    } else takeServer(d);
    if (legacy && !seedMap) {
      // Eigene, ältere Daten in den gemeinsamen Bestand übernehmen – nur was noch fehlt
      seedMap = mergeDb(db, legacy.db, { add: true, overwrite: false }).map;
    }
    if (!plans.own.length) {
      let first;
      if (legacy) first = remapPlan(legacy.plan, seedMap || {});
      else { const s = sampleData(); first = remapPlan(s.plan, mergeDb(db, s.db, { add: false }).map); }
      const r = await post('/api/ratio/plans', { name: 'Mein Rechner', data: first });
      plans = await get('/api/ratio/plans');
      prefs.plan = r.id;
    }
    if (!prefs.migrated) { prefs.migrated = true; savePrefs(); }
    const all = plans.own.concat(plans.shared);
    await openPlan(all.find((p) => p.id === prefs.plan) ? prefs.plan : plans.own[0].id, true);
  } catch (e) {
    main.append(h('div', { class: 'page' }, h('div', { class: 'note bad' }, iconSvgNode('warn'), h('div', null, 'Der Ratio-Rechner konnte nicht geladen werden: ' + e.message))));
    return;
  }
  function iconSvgNode(n) { const s = h('span'); s.innerHTML = iconSvg(n); return s.firstChild; }

  async function openPlan(id, initial) {
    if (!initial) await flush();
    const p = await get(`/api/ratio/plans/${id}`);
    cur = { id: p.id, name: p.name, owner: p.owner, readonly: p.readonly, updated_at: p.updated_at };
    plan = normPlan(p.data); planSnap = J(plan); ui.remoteNewer = false;
    if (prefs.plan !== id) { prefs.plan = id; savePrefs(); }
    if (!initial) { render(); setSave(); }
  }
  async function refreshPlans() { try { plans = await get('/api/ratio/plans'); } catch {} }

  // ---------- Speichern ----------
  async function flush() {
    clearTimeout(saveT);
    if (busy) { saveT = setTimeout(flush, 300); return; }
    const ch = pendingChanges();
    const doPlan = cur && !cur.readonly && planDirty();
    if (!ch && !doPlan) { setSave(); return; }
    busy = true; setSave('saving');
    try {
      if (ch) {
        const body = Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, { upsert: v.upsert.map(([o]) => o), delete: v.delete }]));
        const r = await post('/api/ratio/db/changes', { client: CLIENT, changes: body });
        for (const [k, v] of Object.entries(ch)) {
          for (const [o, s] of v.upsert) { snap[k].set(o.id, s); erev[k].set(o.id, r.rev); }
          for (const id of v.delete) { snap[k].delete(id); erev[k].set(id, r.rev); }
        }
        dbRev = Math.max(dbRev, r.rev);
      }
      if (doPlan) {
        const s = J(plan), pid = cur.id;
        const r = await api('PUT', `/api/ratio/plans/${pid}`, { data: plan, client: CLIENT });
        if (cur.id === pid) { planSnap = s; cur.updated_at = r.updated_at; }
      }
      busy = false; setSave(pendingChanges() || (cur && !cur.readonly && planDirty()) ? 'pending' : 'saved');
    } catch (e) {
      busy = false; setSave('error', e.message);
      clearTimeout(saveT); if (alive) saveT = setTimeout(flush, 5000);
    }
  }
  const save = () => { setSave('pending'); clearTimeout(saveT); saveT = setTimeout(flush, 700); };
  function savePrefs() { clearTimeout(prefT); prefT = setTimeout(() => api('PUT', '/api/me/data/ratio_ui', prefs).catch(() => {}), 600); }
  const unload = () => {
    const ch = pendingChanges();
    const send = (url, method, body) => { try { fetch(url, { method, keepalive: true, headers: { 'x-fpanel': '1', 'content-type': 'application/json' }, body: J(body) }); } catch {} };
    if (ch) send('/api/ratio/db/changes', 'POST', { client: CLIENT, changes: Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, { upsert: v.upsert.map(([o]) => o), delete: v.delete }])) });
    if (cur && !cur.readonly && planDirty()) send(`/api/ratio/plans/${cur.id}`, 'PUT', { data: plan, client: CLIENT });
  };

  // ---------- Live-Abgleich ----------
  function applyRemote(k, ups, dels, rev) {
    const arr = db[k], sm = snap[k], rm = erev[k];
    for (const o of ups) {
      if ((rm.get(o.id) || 0) >= rev) continue; rm.set(o.id, rev);
      const i = arr.findIndex((x) => x.id === o.id);
      const mine = i >= 0 ? J(arr[i]) !== sm.get(o.id) : sm.has(o.id);   // lokal noch ungespeichert geändert/gelöscht
      sm.set(o.id, J(o));
      if (mine) continue;
      if (i >= 0) arr[i] = o; else arr.push(o);
    }
    for (const id of dels) {
      if ((rm.get(id) || 0) >= rev) continue; rm.set(id, rev);
      const i = arr.findIndex((x) => x.id === id);
      const mine = i >= 0 && J(arr[i]) !== sm.get(id);
      sm.delete(id);
      if (!mine && i >= 0) arr.splice(i, 1);
    }
  }
  async function refetchDb(keepPending) {
    const pend = keepPending ? pendingChanges() : null;
    takeServer(await get('/api/ratio/db'));
    if (pend) for (const [k, v] of Object.entries(pend)) {
      for (const [o] of v.upsert) { const i = db[k].findIndex((x) => x.id === o.id); if (i >= 0) db[k][i] = o; else db[k].push(o); }
      db[k] = db[k].filter((x) => !v.delete.includes(x.id));
    }
    rerender(); if (pend) save();
  }
  async function checkRev() { try { const r = await get('/api/ratio/rev'); if (r.rev > dbRev && alive) await refetchDb(true); } catch {} }
  const remoteBy = (name) => { lastBy = name; clearTimeout(lastByT); lastByT = setTimeout(() => { lastBy = null; setSave(); }, 6000); setSave(); };

  async function onRemotePlan(ev) {
    if (ev.client === CLIENT) return;
    if (ev.deleted) {
      await refreshPlans();
      if (cur && ev.id === cur.id) { say(cur.readonly ? `${cur.owner.username} hat diesen Rechner gelöscht` : 'Dieser Rechner wurde gelöscht', 'info'); await openPlan(plans.own[0].id); }
      else renderPlanBar();
      return;
    }
    if (ev.renamed) { await refreshPlans(); }
    if (!cur || ev.id !== cur.id) { renderPlanBar(); return; }
    if (!planDirty()) {
      const p = await get(`/api/ratio/plans/${cur.id}`);
      cur.name = p.name; plan = normPlan(p.data); planSnap = J(plan); ui.remoteNewer = false; rerender();
    } else { ui.remoteNewer = true; renderPlanBar(); }
  }
  addCleanup(onEvent((ev) => {
    if (!alive) return;
    if (ev.type === 'hello') checkRev();
    else if (ev.type === 'ratio_db') {
      if (ev.reset) { refetchDb(false).then(() => { if (ev.by !== S.user.username) say(`Der gemeinsame Datenbestand wurde von ${ev.by} ersetzt`, 'info'); }); return; }
      if (ev.client === CLIENT) { dbRev = Math.max(dbRev, ev.rev); return; }
      if (ev.rev > dbRev + 1) { checkRev(); return; }
      for (const k of COLS) if (ev.changes[k]) applyRemote(k, ev.changes[k].upsert || [], ev.changes[k].delete || [], ev.rev);
      dbRev = Math.max(dbRev, ev.rev);
      remoteBy(ev.by); rerender();
    } else if (ev.type === 'ratio_plan') onRemotePlan(ev).catch(() => {});
    else if (ev.type === 'ratio_shares') {
      refreshPlans().then(async () => {
        if (ev.removed && cur && cur.id === ev.removed) { say('Der Rechner wird nicht mehr mit dir geteilt', 'info'); await openPlan(plans.own[0].id); }
        else renderPlanBar();
      });
    }
  }));
  const onVis = () => { if (document.visibilityState === 'visible') checkRev(); };
  document.addEventListener('visibilitychange', onVis);
  const poll = setInterval(checkRev, 60000);
  addCleanup(() => { alive = false; clearInterval(poll); clearTimeout(saveT); clearTimeout(lastByT); flush(); clearTimeout(prefT); api('PUT', '/api/me/data/ratio_ui', prefs).catch(() => {});
    document.removeEventListener('visibilitychange', onVis); removeEventListener('beforeunload', unload); });
  addEventListener('beforeunload', unload);

  // ---------- Grundgerüst ----------
  const root = h('div', { class: 'page rr' });
  main.append(root);
  root.innerHTML = `
    <div class="page-head">
      <div class="grow"><h1>Ratio-Rechner</h1>
        <p>Rezepte, Items und Maschinen sind für alle Benutzer gemeinsam und werden live abgeglichen. Deine Rechner gehören dir – teilen kannst du sie zum Ansehen.</p></div>
      <span class="rr-save" id="rr-save"></span>
    </div>
    <nav class="tabs" role="tablist" aria-label="Bereiche des Rechners">
      ${TABS.map(([k, l]) => `<button class="tab" data-tab="${k}" role="tab">${l}</button>`).join('')}
    </nav>
    <div id="view"></div>
    <datalist id="dl-items"></datalist><datalist id="dl-cats"></datalist>`;
  const $ = (s) => root.querySelector(s);

  function setSave(st, detail) {
    const el = $('#rr-save'); if (!el) return;
    if (!st) st = pendingChanges() || (cur && !cur.readonly && planDirty()) ? 'pending' : 'saved';
    let cls = '', ic = 'refresh', txt;
    if (st === 'saving') txt = 'Speichert …';
    else if (st === 'pending') txt = 'Änderungen …';
    else if (st === 'error') { cls = 'bad'; ic = 'warn'; txt = 'Speichern fehlgeschlagen – neuer Versuch läuft'; }
    else if (cur && cur.readonly && planDirty()) { cls = 'ro'; ic = 'lock'; txt = 'Rechner nur angesehen – nicht gespeichert'; }
    else if (lastBy) { cls = 'ok live'; ic = 'refresh'; txt = `Aktualisiert von ${lastBy}`; }
    else { cls = 'ok'; ic = 'check'; txt = 'Gespeichert · live abgeglichen'; }
    el.className = 'rr-save ' + cls; el.title = detail || '';
    el.innerHTML = `${iconSvg(ic)}<span>${esc(txt)}</span>`;
  }
  setSave();

  // ---------- Hilfen ----------
  const itemName = (id) => { const i = db.items.find((x) => x.id === id); return i ? i.name : '?'; };
  const itemByName = (n) => db.items.find((i) => norm(i.name) === norm(n));
  const unitLbl = () => (plan.unit === 'min' ? '/min' : '/s');
  const uMul = () => (plan.unit === 'min' ? 60 : 1);
  const say = (msg, kind = 'ok', sub) => toast(msg, kind, sub);
  const off = () => new Set(plan.machinesOff || []);
  // Rechnet nur mit den Maschinen, die in diesem Rechner ausgewählt sind
  const dbView = () => { const o = off(); return o.size ? { ...db, machines: db.machines.filter((m) => !o.has(m.id)) } : db; };

  function findOrCreateItem(name, created) {
    const f = itemByName(name); if (f) return f.id;
    const o = { id: uid(), name: name.trim(), kind: 'item' }; db.items.push(o); if (created) created.push(o.name); return o.id;
  }
  function allCategories() {
    const s = new Map();
    for (const r of db.recipes) { const k = norm(r.category); if (k && !s.has(k)) s.set(k, r.category.trim()); }
    for (const m of db.machines) for (const c of String(m.categories || '').split(',')) { const k = norm(c); if (k && !s.has(k)) s.set(k, c.trim()); }
    return [...s.values()].sort((a, b) => a.localeCompare(b, 'de'));
  }
  function renderDatalists() {
    $('#dl-items').innerHTML = [...db.items].sort((a, b) => a.name.localeCompare(b.name, 'de')).map((i) => `<option value="${esc(i.name)}"></option>`).join('');
    $('#dl-cats').innerHTML = allCategories().map((c) => `<option value="${esc(c)}"></option>`).join('');
  }

  // ---------- Render ----------
  function render() {
    root.querySelectorAll('.tabs .tab').forEach((b) => { const on = b.dataset.tab === ui.tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    const v = $('#view');
    ({ calc: renderCalc, recipes: renderRecipes, items: renderItems, machines: renderMachines, data: renderData }[ui.tab] || renderCalc)(v);
    renderDatalists();
  }
  // Neu zeichnen nach Live-Änderungen, ohne Fokus, Eingaben oder Scrollposition zu verlieren
  function rerender() {
    if (!alive) return;
    const a = document.activeElement, keep = {};
    for (const id of ['i-new-name', 'i-new-kind', 'quick-text', 'json']) { const el = $('#' + id); if (el) keep[id] = el.value; }
    let fid = null, fval, s0, s1;
    if (a && root.contains(a) && a.id) { fid = a.id; fval = a.value; try { s0 = a.selectionStart; s1 = a.selectionEnd; } catch {} }
    const sc = document.scrollingElement, scroller = root.closest('main') || main, y1 = sc.scrollTop, y2 = scroller.scrollTop;
    render(); setSave();
    for (const [id, v] of Object.entries(keep)) { const el = $('#' + id); if (el) el.value = v; }
    if (fid) { const n = root.querySelector('#' + CSS.escape(fid)); if (n) { if (fval !== undefined && n.value !== fval && n.tagName !== 'SELECT') n.value = fval; n.focus({ preventScroll: true }); try { n.setSelectionRange(s0, s1); } catch {} } }
    sc.scrollTop = y1; scroller.scrollTop = y2;
  }

  // ---------- Rechner-Auswahl ----------
  function planBarHtml() {
    const own = plans.own, sh = plans.shared;
    const opt = (p, lbl) => `<option value="${p.id}" ${cur && cur.id === p.id ? 'selected' : ''}>${esc(lbl)}</option>`;
    const curOwn = own.find((p) => cur && p.id === cur.id);
    const sharedWith = curOwn ? curOwn.shared_with : [];
    let info = '';
    if (cur && cur.readonly) {
      info = `<div class="note rr-ro">${iconSvg('lock')}<div><b>Geteilt von ${esc(cur.owner.username)}</b> – nur zum Ansehen. Du kannst Werte ausprobieren, gespeichert wird hier nichts und der Rechner von ${esc(cur.owner.username)} bleibt unverändert.
        <div class="row-actions">${ui.remoteNewer ? `<button class="btn sm primary" data-act="p-reload">${iconSvg('refresh')} Neue Version laden</button>` : ''}
        <button class="btn sm ${ui.remoteNewer ? '' : 'primary'}" data-act="p-copy">${iconSvg('copy')} Als eigene Kopie speichern</button>
        ${planDirty() ? `<button class="btn sm ghost" data-act="p-reload">Ausprobiertes verwerfen</button>` : ''}
        <button class="btn sm ghost" data-act="p-hide">Ausblenden</button></div></div></div>`;
    } else if (ui.remoteNewer) {
      info = `<div class="note warn">${iconSvg('warn')}<div>Dieser Rechner wurde in einem anderen Fenster geändert. <div class="row-actions"><button class="btn sm" data-act="p-reload">Andere Version laden</button></div></div></div>`;
    }
    return `<div class="phead rr-planhead">
        <label class="inl rr-plansel">${iconSvg('ratio')}<select class="input" id="plan-sel" data-act="plan-sel" aria-label="Rechner wählen">
          <optgroup label="Meine Rechner">${own.map((p) => opt(p, p.name)).join('')}</optgroup>
          ${sh.length ? `<optgroup label="Mit mir geteilt">${sh.map((p) => opt(p, `${p.name} · ${p.owner}`)).join('')}</optgroup>` : ''}
        </select></label>
        <div class="controls">
          ${cur && !cur.readonly ? `<span class="rr-shared">${sharedWith.length ? `${iconSvg('share')} Geteilt mit ${sharedWith.map((u) => `<b>${esc(u.username)}</b>`).join(', ')}` : '<span class="faint">Nicht geteilt</span>'}</span>
          <button class="btn sm" data-act="p-share">${iconSvg('share')} Teilen</button>` : ''}
          <button class="btn sm" data-act="p-new">${iconSvg('plus')} Neuer Rechner</button>
          ${cur && !cur.readonly ? `<button class="btn sm ghost icon" data-act="p-menu" aria-label="Weitere Aktionen" title="Weitere Aktionen">${iconSvg('more')}</button>` : ''}
        </div>
      </div>${info}`;
  }
  function renderPlanBar() { const el = $('#planbar'); if (el) el.innerHTML = planBarHtml(); setSave(); }

  async function newPlan() {
    const name = await promptDialog({ title: 'Neuer Rechner', label: 'Name', value: '', placeholder: 'z. B. Grüne Schaltkreise', confirm: 'Anlegen' });
    if (!name) return;
    const base = { ...defaultPlan(), machinesOff: [...(plan.machinesOff || [])], catDefault: { ...(plan.catDefault || {}) }, unit: plan.unit, belt: plan.belt };
    try { const r = await post('/api/ratio/plans', { name, data: base }); await refreshPlans(); ui.tab = 'calc'; await openPlan(r.id); say('Rechner angelegt', 'ok', 'Maschinenauswahl, Einheit und Band wurden übernommen.'); }
    catch (e) { say('Anlegen fehlgeschlagen', 'bad', e.message); }
  }
  async function copyPlan() {
    const name = await promptDialog({ title: 'Als eigene Kopie speichern', label: 'Name', value: cur.readonly ? `${cur.name} (von ${cur.owner.username})` : `${cur.name} (Kopie)`, confirm: 'Speichern' });
    if (!name) return;
    try { const r = await post('/api/ratio/plans', { name, data: plan }); if (cur.readonly) planSnap = J(plan); await refreshPlans(); await openPlan(r.id); say('Kopie gespeichert', 'ok', 'Das ist jetzt dein eigener Rechner.'); }
    catch (e) { say('Speichern fehlgeschlagen', 'bad', e.message); }
  }
  async function renamePlan() {
    const name = await promptDialog({ title: 'Rechner umbenennen', label: 'Name', value: cur.name });
    if (!name || name === cur.name) return;
    try { await api('PUT', `/api/ratio/plans/${cur.id}`, { name, client: CLIENT }); cur.name = name; await refreshPlans(); renderPlanBar(); }
    catch (e) { say('Umbenennen fehlgeschlagen', 'bad', e.message); }
  }
  async function deletePlan() {
    const ok = await confirmDialog({ title: 'Rechner löschen', text: `„${cur.name}“ wird gelöscht${(plans.own.find((p) => p.id === cur.id) || {}).shared_with?.length ? ' und ist dann auch für die Personen weg, mit denen du ihn geteilt hast' : ''}. Rezepte, Items und Maschinen bleiben erhalten.`, confirm: 'Löschen', danger: true });
    if (!ok) return;
    try {
      planSnap = J(plan); await del(`/api/ratio/plans/${cur.id}`); await refreshPlans();
      if (!plans.own.length) { await post('/api/ratio/plans', { name: 'Mein Rechner', data: { ...defaultPlan(), machinesOff: plan.machinesOff } }); await refreshPlans(); }
      await openPlan(plans.own[0].id); say('Rechner gelöscht');
    } catch (e) { say('Löschen fehlgeschlagen', 'bad', e.message); }
  }
  async function sharePlan() {
    let users = [];
    try { users = await get('/api/ratio/users'); } catch (e) { return say('Benutzer konnten nicht geladen werden', 'bad', e.message); }
    const body = h('div', { class: 'stack rr-sharedlg' });
    const draw = () => {
      const me = plans.own.find((p) => p.id === cur.id) || { shared_with: [] };
      const has = new Set(me.shared_with.map((u) => u.id));
      const rest = users.filter((u) => !has.has(u.id));
      body.innerHTML = `<p class="help" style="margin:0">Geteilte Personen sehen „${esc(cur.name)}“ mit allen Zielen, Quellen, Modulen und deiner Maschinenauswahl – immer in der aktuellen Fassung. Ändern können sie deinen Rechner nicht; sie können ihn höchstens als eigene Kopie speichern.</p>
        <div class="rr-sharelist">${me.shared_with.length ? me.shared_with.map((u) => `<div class="rr-shareuser">${iconSvg('user')}<span>${esc(u.username)}</span><span class="tag">kann ansehen</span><button class="btn ghost sm" data-unshare="${u.id}">Entfernen</button></div>`).join('') : '<div class="sub">Noch mit niemandem geteilt.</div>'}</div>
        ${rest.length ? `<div class="trow"><select class="input" id="share-user" aria-label="Benutzer" style="flex:1">${rest.map((u) => `<option value="${esc(u.username)}">${esc(u.username)}</option>`).join('')}</select><button class="btn primary" data-share>${iconSvg('share')} Teilen</button></div>`
          : `<div class="sub">${users.length ? 'Mit allen Benutzern geteilt.' : 'Es gibt noch keine weiteren Benutzer im Panel.'}</div>`}`;
    };
    draw();
    body.addEventListener('click', async (e) => {
      const add = e.target.closest('[data-share]'), rm = e.target.closest('[data-unshare]');
      try {
        if (add) await post(`/api/ratio/plans/${cur.id}/shares`, { username: body.querySelector('#share-user').value });
        else if (rm) await del(`/api/ratio/plans/${cur.id}/shares/${rm.dataset.unshare}`);
        else return;
        await refreshPlans(); draw(); renderPlanBar();
      } catch (err) { say('Freigabe fehlgeschlagen', 'bad', err.message); }
    });
    modal({ title: 'Rechner teilen', body, actions: [{ label: 'Fertig', cls: 'primary' }] });
  }

  // ---------- Rechner ----------
  function renderCalc(v) {
    v.innerHTML = `
    <div class="rr-stack">
    <section class="panel rr-box rr-planbar" id="planbar">${planBarHtml()}</section>
    <section class="panel rr-box">
      <div class="phead"><h2>Endprodukt und Menge</h2>
        <div class="controls">
          <div class="seg" role="group" aria-label="Einheit">
            <button data-act="unit" data-v="s" aria-pressed="${plan.unit === 's'}">pro Sekunde</button>
            <button data-act="unit" data-v="min" aria-pressed="${plan.unit === 'min'}">pro Minute</button>
          </div>
          <label class="inl">Band <select class="input" id="belt" data-act="belt">${BELTS.map((b) => `<option value="${b.v}" ${Number(plan.belt) === b.v ? 'selected' : ''}>${b.n} · ${b.v}/s</option>`).join('')}</select></label>
        </div>
      </div>
      <div class="targets">${plan.targets.map((t, i) => targetRow(t, i)).join('') || '<div class="sub">Noch kein Endprodukt gewählt.</div>'}</div>
      <div class="row-actions"><button class="btn sm" data-act="add-target">${iconSvg('plus')} Weiteres Endprodukt</button></div>
    </section>
    <details class="panel rr-box rr-det" id="machines-panel" ${ui.machOpen !== false ? 'open' : ''}>
      <summary>${iconSvg('chevron')}Verwendete Maschinen <span class="count" id="mach-count">${machCount()}</span></summary>
      <div id="mach-pick">${machPickHtml()}</div>
    </details>
    <div id="results"></div>
    </div>`;
    renderResults();
  }
  function machCount() { const o = off(); const on = db.machines.filter((m) => !o.has(m.id)).length; return `${on} von ${db.machines.length}`; }
  function machPickHtml() {
    if (!db.machines.length) return '<div class="sub">Noch keine Maschinen angelegt – unter <b>Maschinen</b> hinzufügen.</div>';
    const o = off(), groups = new Map();
    for (const m of db.machines) { const c = String(m.categories || '').split(',')[0].trim() || 'Ohne Kategorie'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(m); }
    const rows = [...groups].sort((a, b) => a[0].localeCompare(b[0], 'de')).map(([c, ms]) => `<div class="mgrp"><span class="mgrp-l">${esc(c)}</span><div class="mtogs">
      ${ms.sort((a, b) => num(a.speed) - num(b.speed)).map((m) => { const on = !o.has(m.id);
        return `<button class="mtog" data-act="m-use" data-id="${m.id}" aria-pressed="${on}" title="${esc(m.categories || '')}">${iconSvg(on ? 'check' : 'x')}${ico(m, 'machine', 'xs')}<span>${esc(m.name)}</span><i>×${nf1.format(num(m.speed))}</i></button>`; }).join('')}
      </div></div>`).join('');
    return `<p class="help" style="margin:0 0 10px">Nur ausgewählte Maschinen werden in diesem Rechner eingeplant – etwa solange du eine Stufe noch nicht erforscht hast. Gilt nur für diesen Rechner.</p>
      <div class="mgrps">${rows}</div>
      <div class="row-actions"><button class="btn ghost sm" data-act="m-use-all">Alle auswählen</button></div>`;
  }
  function targetRow(t, i) {
    const nm = t.item ? itemName(t.item) : (t.name || '');
    const ti = t.item ? db.items.find((x) => x.id === t.item) : null;
    return `<div class="trow" data-i="${i}">
      <span class="t-ico">${ti ? ico(ti) : '<span class="ri fb"></span>'}</span>
      <input class="input t-item" id="t-item-${i}" list="dl-items" value="${esc(nm)}" placeholder="Item suchen …" data-act="t-item" aria-label="Endprodukt">
      <input class="input t-rate num" id="t-rate-${i}" inputmode="decimal" value="${esc(t.rate)}" data-act="t-rate" aria-label="Menge">
      <span class="unit">${unitLbl()}</span>
      <button class="btn ghost sm" data-act="t-belt" title="Menge auf ein volles Band setzen">= 1 Band</button>
      <button class="btn ghost icon sm" data-act="t-del" aria-label="Endprodukt entfernen" title="Entfernen">${X}</button>
    </div>`;
  }
  function flowList(list, ri, isProd) {
    if (!list.length) return '<span class="faint">—</span>';
    return '<div class="flows">' + list.map((x) => {
      const v = (num(x.amount) || 0) * (isProd ? ri.mult : 1) * ri.rate * uMul();
      return `<span>${esc(itemName(x.item))}<i>${fmt(v)}</i></span>`;
    }).join('') + '</div>';
  }
  function beltsFor(f, rate) { if (f.item && f.item.kind === 'fluid') return '—'; const b = Number(plan.belt) || 15; return fmt(rate / b); }

  // ---------- Produktionsbaum ----------
  // Jedes Rezept gehört genau einer Zeile (dem Item, für das es gewählt ist); Zutaten hängen darunter,
  // jedes Item erscheint einmal – beim ersten (flachsten) Verbraucher.
  function treeModel(R) {
    const flows = new Map(R.flows.filter((f) => f.produced + f.imported + f.consumed > 1e-9).map((f) => [f.id, f]));
    const choice = plan.recipeChoice || {}, owner = new Map();
    for (const ri of R.recipes) {
      const prods = ri.r.products.map((p) => p.item).filter((id) => flows.has(id));
      // Kandidaten: Produkte, für die dieses Rezept gewählt ist (oder „Auto“); bevorzugt eines, das wirklich gebraucht wird
      const need = (id) => { const f = flows.get(id); return f.consumed + f.target > 1e-9; };
      const cand = prods.filter((id) => { const f = flows.get(id), c = choice[id]; return f.recipes.some((r) => r.id === ri.r.id) && (c === 'auto' || (c ? c === ri.r.id : f.recipes[0].id === ri.r.id)); });
      const o = cand.find(need) || prods.find(need) || cand[0] || prods[0];
      if (!owner.has(o)) owner.set(o, []); owner.get(o).push(ri);
    }
    const seen = new Set(), kids = new Map(), roots = [];
    const claim = (id) => {
      const ks = [];
      for (const ri of owner.get(id) || []) for (const g of ri.r.ingredients) if (flows.has(g.item) && !seen.has(g.item)) { seen.add(g.item); ks.push(g.item); }
      kids.set(id, ks); ks.forEach(claim);
    };
    for (const id of R.targets.keys()) if (flows.has(id) && !seen.has(id)) { seen.add(id); roots.push(id); }
    roots.slice().forEach(claim);
    for (const id of flows.keys()) if (!seen.has(id)) { seen.add(id); roots.push(id); claim(id); }
    const rows = [];
    const walk = (id, guides, last, depth) => {
      rows.push({ f: flows.get(id), recs: owner.get(id) || [], guides, last, depth });
      const ks = kids.get(id) || [];
      ks.forEach((k, i) => walk(k, depth ? guides.concat(!last) : [], i === ks.length - 1, depth + 1));
    };
    roots.forEach((id) => walk(id, [], true, 0));
    return rows;
  }
  function treeHtml(R) {
    const U = uMul(), ul = unitLbl(), belt = Number(plan.belt) || 15;
    const beltName = (BELTS.find((b) => b.v === belt) || {}).n || '';
    const rows = treeModel(R);
    let sumPow = 0, sumPol = 0, sumM = 0, powKnown = false, polKnown = false;
    const body = rows.map(({ f, recs, guides, last, depth }) => {
      const it = f.item, fluid = it.kind === 'fluid', total = f.produced + f.imported;
      const g = guides.map((on) => `<i class="tg ${on ? 'pipe' : ''}"></i>`).join('') + (depth ? `<i class="tg ${last ? 'elbow' : 'tee'}"></i>` : '');
      const sur = f.surplus > 1e-9 ? `<span class="sur" title="Überschuss">(+${fmtS(f.surplus * U)})</span> ` : '';
      const beltsC = fluid ? '<span class="faint" title="Flüssigkeit">—</span>' : `${fmtS(total / belt)}<span class="tic" title="${esc(beltName)}-Band (${belt}/s)">${iconSvg('belt')}</span>`;
      const stack = num(it.stack);
      const wag = fluid ? `${fmtS(total * U / FLUID_WAGON)}<span class="tic" title="Fluidwaggon (${nf.format(FLUID_WAGON)})">${iconSvg('fluidwagon')}</span>`
        : stack > 0 ? `${fmtS(total * U / (stack * CARGO_SLOTS))}<span class="tic" title="Güterwaggon (40 × ${stack})">${iconSvg('wagon')}</span>`
          : `<span class="faint" title="Stapelgröße unter Items eintragen">?</span><span class="tic">${iconSvg('wagon')}</span>`;
      let mach = '', pow = 0, pol = 0, hasPow = false, hasPol = false;
      if (recs.length) {
        mach = recs.map((ri) => {
          const m = ri.m, prodItem = ri.r.products.some((x) => x.item === f.id) ? it : db.items.find((x) => x.id === ri.r.products[0]?.item);
          sumM += Math.ceil(ri.machines - 1e-9);
          if (m && num(m.power) > 0) { pow += ri.machines * num(m.power); hasPow = true; }
          if (m && num(m.pollution) > 0) { pol += ri.machines * num(m.pollution); hasPol = true; }
          const mods = [ri.spB ? `<span class="mod sp" title="Tempo-Bonus">+${nf1.format(ri.spB)} %</span>` : '', ri.prB ? `<span class="mod pr" title="Produktivitäts-Bonus">+${nf1.format(ri.prB)} %</span>` : ''].join('');
          return `<div class="mrow" title="${esc(ri.r.name)} · ${fmt(ri.machines)} exakt, ${Math.ceil(ri.machines - 1e-9)} bauen"><b>${fmtS(ri.machines)}</b>${ico(prodItem, 'item', 'sm')}${m ? ico(m, 'machine', 'sm') : '<span class="tag bad">keine</span>'}${mods}</div>`;
        }).join('');
      }
      if (f.imported > 1e-9) mach += `<div class="mrow"><span class="tag ok" title="Kommt von außen (Rohstoff oder Input)">Input${recs.length ? ` ${fmtS(f.imported * U)}` : ''}</span></div>`;
      sumPow += pow; sumPol += pol; powKnown ||= hasPow; polKnown ||= hasPol;
      const open = ui.treeOpen.has(f.id);
      return `<tr class="trow-t${open ? ' open' : ''}${f.target ? ' tgt' : ''}" data-id="${f.id}">
        <td class="tx"><button class="btn ghost icon sm" data-act="tree-open" data-id="${f.id}" aria-expanded="${open}" aria-label="Details zu ${esc(it.name)}">${iconSvg('chevron')}</button></td>
        <td class="tname"><div class="tcell">${g}${ico(it)}<span class="tnm">${esc(it.name)}</span></div></td>
        <td class="n">${sur}${fmtS(total * U)}</td>
        <td class="n"><div class="nc">${beltsC}</div></td>
        <td class="n"><div class="nc">${wag}</div></td>
        <td class="tm">${mach}</td>
        <td class="n">${hasPow ? fmtPow(pow) : ''}</td>
        <td class="n">${hasPol ? fmtS(pol) : ''}</td>
      </tr>${open ? `<tr class="tdet"><td></td><td colspan="7">${treeDetail(R, f, recs)}</td></tr>` : ''}`;
    }).join('');
    return `<div class="tbl-wrap"><table class="list rr-tbl rr-tree">
      <thead><tr><th class="tx"></th><th>Baum</th><th class="n">Items${ul}</th><th class="n">Bänder</th><th class="n">Waggons${ul}</th><th>Maschinen</th><th class="n">${iconSvg('bolt')} Leistung</th><th class="n">${iconSvg('smoke')} Verschm./min</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td></td><td>Gesamt</td><td></td><td></td><td></td><td><b>${sumM}</b> Maschinen</td><td class="n">${powKnown ? fmtPow(sumPow) : ''}</td><td class="n">${polKnown ? fmtS(sumPol) : ''}</td></tr></tfoot>
    </table></div>
    ${powKnown && polKnown ? '' : `<p class="help rr-treehelp">Leistung und Verschmutzung erscheinen, sobald sie unter <b>Maschinen</b> eingetragen sind; Waggons brauchen die Stapelgröße unter <b>Items</b>. Moduleffekte auf Strom und Verschmutzung werden nicht eingerechnet.</p>`}`;
  }
  function treeDetail(R, f, recs) {
    const U = uMul(), ul = unitLbl(), it = f.item;
    const users = R.recipes.filter((ri) => ri.r.ingredients.some((g) => g.item === f.id)).map((ri) => {
      const a = ri.r.ingredients.filter((g) => g.item === f.id).reduce((s, g) => s + (num(g.amount) || 0), 0) * ri.rate * U;
      const pi = db.items.find((x) => x.id === ri.r.products[0]?.item);
      return `<span class="mchip">${ico(pi, 'item', 'xs')}${esc(ri.r.name)} <span class="sub">${fmt(a)}${ul}</span></span>`;
    }).join('');
    let src = '';
    if (f.recipes.length) {
      const cur = f.forcedInput ? 'input' : ((plan.recipeChoice || {})[f.id] || f.recipes[0].id);
      src = `<label class="field"><span>Quelle</span><select class="input" data-act="i-src" data-item="${f.id}">
        ${f.recipes.map((r) => `<option value="${r.id}" ${cur === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
        ${f.recipes.length > 1 ? `<option value="auto" ${cur === 'auto' ? 'selected' : ''}>Auto – Optimierer wählt</option>` : ''}
        <option value="input" ${cur === 'input' ? 'selected' : ''}>Von außen (Input)</option></select></label>`;
    }
    const recHtml = recs.map((ri) => {
      const r = ri.r;
      const opts = ri.fits.length ? ri.fits.map((m) => `<option value="${m.id}" ${ri.m && ri.m.id === m.id ? 'selected' : ''}>${esc(m.name)} (×${nf1.format(num(m.speed))})</option>`).join('') : '<option>keine passende Maschine</option>';
      return `<div class="tdrec">
        <div class="tdh"><b>${esc(r.name)}</b><span class="sub">${esc(r.category)} · ${nf.format(ri.time)} s · ${fmt(ri.machines)} Maschinen exakt, ${Math.ceil(ri.machines - 1e-9)} bauen</span></div>
        <div class="tdgrid">
          <label class="field"><span>Maschine</span><select class="input" data-act="r-machine" data-r="${r.id}" ${ri.fits.length ? '' : 'disabled'}>${opts}</select></label>
          <label class="field"><span>Tempo %</span><input class="input num" id="tspd-${r.id}" data-act="r-speed" data-r="${r.id}" value="${ri.spB || ''}" placeholder="0" inputmode="decimal"></label>
          <label class="field"><span>Prod. %</span><input class="input num" id="tprd-${r.id}" data-act="r-prod" data-r="${r.id}" value="${ri.prB || ''}" placeholder="0" inputmode="decimal"></label>
        </div>
        <div class="io-cols tdio"><div><h3>Verbrauch ${ul}</h3>${flowList(r.ingredients, ri, false)}</div><div><h3>Ausstoß ${ul}</h3>${flowList(r.products, ri, true)}</div></div>
      </div>`;
    }).join('');
    return `<div class="tdet-in">
      <div class="tdtop">${src}${f.surplus > 1e-9 ? `<div class="note warn">${iconSvg('warn')}<div>${fmt(f.surplus * U)}${ul} ${esc(it.name)} bleiben übrig.</div></div>` : ''}</div>
      ${recHtml}
      <div><h3>Verwendet in</h3><div class="chips">${users || (f.target ? '<span class="tag accent">Endprodukt</span>' : '<span class="sub">–</span>')}</div></div>
    </div>`;
  }

  function renderResults() {
    const el = $('#results'); if (!el) return;
    const mc = $('#mach-count'); if (mc) mc.textContent = machCount();
    const V = dbView();
    const R = computePlan(V, plan);
    if (R.empty) { el.innerHTML = `<div class="panel"><div class="empty"><p>Wähle oben ein Endprodukt und gib ein, wie viel du davon ${plan.unit === 'min' ? 'pro Minute' : 'pro Sekunde'} haben willst.</p></div></div>`; return; }
    const warn = (R.warnings || []).map((w) => `<div class="note warn">${iconSvg('warn')}<div>${esc(w)}${/Keine Maschine/.test(w) && V.machines.length < db.machines.length ? ' Eventuell ist die passende Maschine oben unter <b>Verwendete Maschinen</b> abgewählt.' : ''}</div></div>`).join('');
    if (R.error) { el.innerHTML = `<div class="rr-stack"><div class="note bad">${iconSvg('warn')}<div><b>Berechnung nicht möglich.</b> ${esc(R.error)}</div></div>${warn}${flowsPanelOnlyChoices()}</div>`; return; }
    const U = uMul(), ul = unitLbl();

    let ratioHtml;
    const rt = R.ratio;
    if (rt && rt.total <= 5000) {
      const outs = [...R.targets].map(([id, r]) => `<b>${fmt(r * rt.s * U)}${ul}</b> ${esc(itemName(id))}`).join(' + ');
      ratioHtml = `<div class="ratio-list">${R.recipes.map((ri, k) => `<span class="mchip"><b>${rt.ints[k]}×</b>${esc(ri.m ? ri.m.name : '?')} <span class="sub">${esc(ri.r.name)}</span></span>`).join('')}</div>
        <div class="ratio-out">Diese Anlage läuft ohne Leerlauf und liefert exakt ${outs} – insgesamt <b>${rt.total}</b> Maschinen.</div>
        <div class="row-actions"><button class="btn sm primary" data-act="apply-ratio" data-s="${rt.s}">Ziel auf diese Ratio setzen</button>
        ${rt.s < 1 ? '' : `<button class="btn sm ghost" data-act="scale" data-f="0.5">Ziel halbieren</button>`}
        <button class="btn sm ghost" data-act="scale" data-f="2">Ziel verdoppeln</button></div>`;
    } else {
      ratioHtml = `<div class="sub" style="margin:6px 0 10px">Keine handliche ganzzahlige Ratio (über 5000 Maschinen nötig, oder krumme Werte durch Module/Produktivität). Unten steht die aufgerundete Lösung für dein Ziel.</div>
        <div class="row-actions"><button class="btn sm ghost" data-act="scale" data-f="0.5">Ziel halbieren</button><button class="btn sm ghost" data-act="scale" data-f="2">Ziel verdoppeln</button></div>`;
    }

    const imports = R.flows.filter((f) => f.imported > 1e-9).sort((a, b) => b.imported - a.imported);
    const surplus = R.flows.filter((f) => f.surplus > 1e-9);
    const totals = [...R.totals].sort((a, b) => b[1].ceil - a[1].ceil);
    const totalCeil = totals.reduce((a, [, t]) => a + t.ceil, 0);

    const prodRows = R.recipes.map((ri) => {
      const r = ri.r, ceil = Math.ceil(ri.machines - 1e-9), util = ceil ? ri.machines / ceil * 100 : 0;
      const opts = ri.fits.length ? ri.fits.map((m) => `<option value="${m.id}" ${ri.m && ri.m.id === m.id ? 'selected' : ''}>${esc(m.name)} (×${nf1.format(num(m.speed))})</option>`).join('') : '<option>keine passende Maschine</option>';
      return `<tr>
        <td><div class="rname">${esc(r.name)}</div><div class="sub">${esc(r.category)} · ${nf.format(ri.time)} s${ri.prod ? ` · +${nf1.format(ri.prod)} % Prod.` : ''}</div></td>
        <td><select class="input" data-act="r-machine" data-r="${r.id}" aria-label="Maschine für ${esc(r.name)}" ${ri.fits.length ? '' : 'disabled'}>${opts}</select></td>
        <td class="n"><input class="input num xs" id="spd-${r.id}" data-act="r-speed" data-r="${r.id}" value="${ri.spB || ''}" placeholder="0" inputmode="decimal" aria-label="Tempo-Bonus in Prozent"></td>
        <td class="n"><input class="input num xs" id="prd-${r.id}" data-act="r-prod" data-r="${r.id}" value="${ri.prB || ''}" placeholder="0" inputmode="decimal" aria-label="Produktivitäts-Bonus in Prozent"></td>
        <td class="n big">${fmt(ri.machines)}</td>
        <td class="n"><b>${ceil}</b><span class="util ${util < 99.9 ? 'part' : ''}" title="Auslastung ${nf1.format(util)} %"><i style="width:${util}%"></i></span></td>
        <td>${flowList(r.products, ri, true)}</td>
        <td>${flowList(r.ingredients, ri, false)}</td>
      </tr>`;
    }).join('');

    const flowRows = R.flows.filter((f) => f.produced + f.imported + f.consumed > 1e-9).map((f) => {
      const total = f.produced + f.imported;
      let src;
      if (f.recipes.length) {
        const cur = f.forcedInput ? 'input' : ((plan.recipeChoice || {})[f.id] || f.recipes[0].id);
        src = `<select class="input" data-act="i-src" data-item="${f.id}" aria-label="Quelle für ${esc(f.item.name)}">
          ${f.recipes.map((r) => `<option value="${r.id}" ${cur === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
          ${f.recipes.length > 1 ? `<option value="auto" ${cur === 'auto' ? 'selected' : ''}>Auto – Optimierer wählt</option>` : ''}
          <option value="input" ${cur === 'input' ? 'selected' : ''}>Von außen (Input)</option></select>`;
      } else src = '<span class="faint">Rohstoff (kein Rezept)</span>';
      const chips = [];
      if (f.target) chips.push(`<span class="tag accent">Ziel</span>`);
      if (f.imported > 1e-9) chips.push(`<span class="tag ok">Input</span>`);
      if (f.surplus > 1e-9) chips.push(`<span class="tag warnc">Überschuss ${fmt(f.surplus * U)}</span>`);
      if (!chips.length) chips.push(`<span class="tag">Zwischenprodukt</span>`);
      return `<tr>
        <td><span class="rname">${esc(f.item.name)}</span>${f.item.kind === 'fluid' ? ' <span class="tag info">Fluid</span>' : ''}</td>
        <td>${src}</td>
        <td class="n">${fmt(total * U)}</td>
        <td class="n">${fmt(f.consumed * U)}</td>
        <td class="n">${beltsFor(f, total)}</td>
        <td><div class="chips">${chips.join('')}</div></td></tr>`;
    }).join('');

    const tablesHtml = ui.resView !== 'tables' ? '' : `
    <section class="panel">
      <div class="panel-head"><h3>Produktion</h3><div class="seg" role="group" aria-label="Ansicht"><button data-act="res-view" data-v="tree" aria-pressed="${ui.resView !== 'tables'}">Baum</button><button data-act="res-view" data-v="tables" aria-pressed="${ui.resView === 'tables'}">Tabellen</button></div><span class="sub">${R.recipes.length} Rezepte aktiv${R.inactive ? ` · ${R.inactive} vom Optimierer nicht genutzt` : ''} · Mengen in ${ul}</span></div>
      <div class="tbl-wrap"><table class="list rr-tbl">
        <thead><tr><th>Rezept</th><th>Maschine</th><th class="n">Tempo %</th><th class="n">Prod. %</th><th class="n">Exakt</th><th class="n">Bauen</th><th>Ausstoß</th><th>Verbrauch</th></tr></thead>
        <tbody>${prodRows}</tbody></table></div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>Item-Flüsse</h3><span class="sub">Quelle pro Item wählbar – „Von außen“ behandelt es als fertigen Input, z. B. vom Main-Bus</span></div>
      <div class="tbl-wrap"><table class="list rr-tbl">
        <thead><tr><th>Item</th><th>Quelle</th><th class="n">Gesamt ${ul}</th><th class="n">Verbraucht ${ul}</th><th class="n">Bänder</th><th>Status</th></tr></thead>
        <tbody>${flowRows}</tbody></table></div>
    </section>
`;
    const cats = allCategories();
    el.innerHTML = `
    <div class="rr-stack">
    ${warn}
    <div class="cards">
      <section class="panel rr-box ratio wide"><h3>Perfekte Ratio</h3>${ratioHtml}</section>
      <section class="panel rr-box"><h3>Rohstoffe und Inputs</h3>
        ${imports.length ? `<div class="kv">${imports.map((f) => `<div><span class="kvi">${ico(f.item, 'item', 'xs')}${esc(f.item.name)}</span><span>${fmt(f.imported * U)}${ul}${f.item.kind === 'fluid' ? '' : ` · ${beltsFor(f, f.imported)} B.`}</span></div>`).join('')}</div>` : '<div class="sub">Alles wird selbst hergestellt.</div>'}
      </section>
      <section class="panel rr-box"><h3>Maschinen gesamt <span class="count">${totalCeil}</span></h3>
        <div class="kv">${totals.map(([n, t]) => `<div><span>${esc(n)}</span><span>${t.ceil} <span class="faint">(${fmt(t.exact)})</span></span></div>`).join('')}</div>
      </section>
      <section class="panel rr-box"><h3>Überschuss und Nebenprodukte</h3>
        ${surplus.length ? `<div class="kv">${surplus.map((f) => `<div><span>${esc(f.item.name)}</span><span>${fmt(f.surplus * U)}${ul}</span></div>`).join('')}</div>` : '<div class="sub">Kein Überschuss – alles wird verbraucht.</div>'}
      </section>
    </div>

    ${ui.resView === 'tables' ? tablesHtml : `<section class="panel">
      <div class="panel-head"><h3>Produktionsbaum</h3><div class="seg" role="group" aria-label="Ansicht"><button data-act="res-view" data-v="tree" aria-pressed="${ui.resView !== 'tables'}">Baum</button><button data-act="res-view" data-v="tables" aria-pressed="${ui.resView === 'tables'}">Tabellen</button></div><span class="sub">${R.recipes.length} Rezepte · Klick auf den Pfeil zeigt Details und Einstellungen</span></div>
      ${treeHtml(R)}
    </section>`}

    <details class="panel rr-box rr-det" id="defaults-panel" ${ui.defaultsOpen ? 'open' : ''}>
      <summary>${iconSvg('chevron')}Standardmaschine je Kategorie</summary>
      <div class="defaults">${cats.map((c) => { const fits = machinesFor(V, c); const cur = (plan.catDefault || {})[norm(c)];
        return `<label class="field"><span>${esc(c)}</span><select class="input" data-act="cat-default" data-cat="${esc(norm(c))}" ${fits.length ? '' : 'disabled'}>
          ${fits.length ? fits.map((m) => `<option value="${m.id}" ${cur === m.id ? 'selected' : ''}>${esc(m.name)} (×${nf1.format(num(m.speed))})</option>`).join('') : '<option>keine Maschine ausgewählt</option>'}</select></label>`; }).join('')}</div>
    </details>
    </div>`;
  }
  function flowsPanelOnlyChoices() {
    const I = buildIndex(db);
    const rows = db.items.filter((i) => (I.prodBy.get(i.id) || []).length > 1 || (plan.inputs || []).includes(i.id) || (plan.recipeChoice || {})[i.id]).map((i) => {
      const rs = I.prodBy.get(i.id) || []; const cur = (plan.inputs || []).includes(i.id) ? 'input' : ((plan.recipeChoice || {})[i.id] || (rs[0] && rs[0].id));
      return `<tr><td class="rname">${esc(i.name)}</td><td><select class="input" data-act="i-src" data-item="${i.id}">${rs.map((r) => `<option value="${r.id}" ${cur === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}${rs.length > 1 ? `<option value="auto" ${cur === 'auto' ? 'selected' : ''}>Auto – Optimierer wählt</option>` : ''}<option value="input" ${cur === 'input' ? 'selected' : ''}>Von außen (Input)</option></select></td></tr>`;
    }).join('');
    return rows ? `<section class="panel"><div class="panel-head"><h3>Quellen anpassen</h3></div><div class="tbl-wrap"><table class="list rr-tbl"><tbody>${rows}</tbody></table></div></section>` : '';
  }
  const sharedNote = (what) => `<div class="note rr-shnote">${iconSvg('players')}<div>${what} sind für alle Benutzer gemeinsam. Änderungen speichern sofort und erscheinen live bei allen anderen.</div></div>`;

  // ---------- Rezepte ----------
  const editFromRecipe = (r) => ({ id: r.id, name: r.name, time: String(r.time), category: r.category || '',
    ingredients: r.ingredients.map((g) => ({ name: itemName(g.item), amount: String(g.amount) })),
    products: r.products.map((p) => ({ name: itemName(p.item), amount: String(p.amount) })) });
  const newEdit = () => ({ id: null, name: '', time: '1', category: 'Fertigung', ingredients: [{ name: '', amount: '1' }], products: [{ name: '', amount: '1' }] });
  function renderRecipes(v) {
    if (!ui.edit) ui.edit = db.recipes[0] ? editFromRecipe(db.recipes[0]) : newEdit();
    v.innerHTML = `
    <div class="rr-stack">
    ${sharedNote('Rezepte')}
    <details class="panel rr-box rr-det" ${ui.quickOpen ? 'open' : ''} id="quick-panel">
      <summary>${iconSvg('chevron')}Schnelleingabe – viele Rezepte als Text</summary>
      <p class="help">Eine Zeile pro Rezept. Unbekannte Items werden automatisch angelegt, gleichnamige Rezepte überschrieben. Flüssigkeiten danach unter <b>Items</b> umstellen. Zeilen mit <b>#</b> werden ignoriert.</p>
      <div class="code">Name: Menge Zutat + Menge Zutat =&gt; Menge Produkt + Menge Nebenprodukt ; Zeit in s ; Kategorie
Motoreinheit: 1 Stahlträger + 1 Eisenzahnrad + 2 Rohr =&gt; 1 Motoreinheit ; 10 ; Fertigung
=&gt; 1 Eisenerz ; 1 ; Abbau</div>
      <textarea class="input mono" id="quick-text" rows="8" placeholder="Rezepte hier einfügen …">${esc(ui.quickText || '')}</textarea>
      <div class="row-actions"><button class="btn sm primary" data-act="quick-apply">Rezepte übernehmen</button><button class="btn sm" data-act="quick-load">Alle Rezepte als Text laden</button></div>
    </details>
    <div class="split">
      <aside class="panel rr-box">
        <div class="phead"><h2>Rezepte <span class="count">${db.recipes.length}</span></h2><button class="btn sm primary" data-act="r-new">${iconSvg('plus')} Neu</button></div>
        <input class="input" id="r-search" type="search" placeholder="Rezept oder Item suchen …" value="${esc(ui.recipeSearch)}" data-act="r-search" aria-label="Rezepte durchsuchen">
        <div class="rlist" id="rlist">${recipeListHtml()}</div>
      </aside>
      <section class="panel rr-box" id="editor">${editorHtml()}</section>
    </div>
    </div>`;
  }
  function recipeListHtml() {
    const q = norm(ui.recipeSearch);
    const list = [...db.recipes].sort((a, b) => a.name.localeCompare(b.name, 'de')).filter((r) => !q || norm(r.name).includes(q) || r.products.concat(r.ingredients).some((x) => norm(itemName(x.item)).includes(q)));
    if (!list.length) return '<div class="sub" style="padding:8px">Nichts gefunden.</div>';
    return list.map((r) => `<button data-act="r-open" data-r="${r.id}" aria-current="${ui.edit && ui.edit.id === r.id}"><span class="rl-n">${ico(db.items.find((x) => x.id === r.products[0]?.item), 'item', 'xs')}${esc(r.name)}</span><small>${esc(r.category)} · ${nf.format(num(r.time))} s · ${r.ingredients.length} → ${r.products.length}</small></button>`).join('');
  }
  function ioRows(list, key) {
    return list.map((x, i) => `<div class="iorow">
      <input class="input amt num" id="e-${key}-a-${i}" value="${esc(x.amount)}" inputmode="decimal" data-act="e-row" data-list="${key}" data-i="${i}" data-f="amount" aria-label="Menge">
      <input class="input nm" id="e-${key}-n-${i}" list="dl-items" value="${esc(x.name)}" placeholder="Item" data-act="e-row" data-list="${key}" data-i="${i}" data-f="name" aria-label="Item">
      <button class="btn ghost icon sm" data-act="e-delrow" data-list="${key}" data-i="${i}" aria-label="Zeile entfernen" title="Entfernen">${X}</button></div>`).join('');
  }
  function editorHtml() {
    const e = ui.edit;
    const gone = e.id && !db.recipes.some((r) => r.id === e.id);
    return `<div class="phead"><h2>${e.id ? 'Rezept bearbeiten' : 'Neues Rezept'}</h2></div>
    ${gone ? `<div class="note warn" style="margin-bottom:12px">${iconSvg('warn')}<div>Dieses Rezept wurde gerade von jemand anderem gelöscht. Mit <b>Speichern</b> legst du es wieder an.</div></div>` : ''}
    <div class="fgrid">
      <label class="field"><span>Name</span><input class="input" id="e-name" value="${esc(e.name)}" data-act="e-field" data-f="name" placeholder="z. B. Eisenzahnrad"></label>
      <label class="field"><span>Zeit (Sekunden)</span><input class="input num" id="e-time" inputmode="decimal" value="${esc(e.time)}" data-act="e-field" data-f="time"></label>
      <label class="field"><span>Kategorie</span><input class="input" id="e-cat" list="dl-cats" value="${esc(e.category)}" data-act="e-field" data-f="category" placeholder="z. B. Fertigung"></label>
    </div>
    <div class="io-cols">
      <div><h3>Zutaten</h3><div class="iorows">${ioRows(e.ingredients, 'ingredients') || '<div class="sub">Keine – z. B. bei Abbau.</div>'}</div>
        <div class="row-actions"><button class="btn ghost sm" data-act="e-addrow" data-list="ingredients">${iconSvg('plus')} Zutat</button></div></div>
      <div><h3>Produkte</h3><div class="iorows">${ioRows(e.products, 'products')}</div>
        <div class="row-actions"><button class="btn ghost sm" data-act="e-addrow" data-list="products">${iconSvg('plus')} Produkt oder Nebenprodukt</button></div></div>
    </div>
    <p class="help">Die Maschine wird über die <b>Kategorie</b> zugeordnet. Unbekannte Item-Namen werden beim Speichern neu angelegt.</p>
    <div class="row-actions">
      <button class="btn primary" data-act="e-save">Speichern</button>
      ${e.id && !gone ? `<button class="btn" data-act="e-calc">Im Rechner berechnen</button><button class="btn" data-act="e-dup">Duplizieren</button><button class="btn danger" data-act="e-del" data-confirm>Löschen</button>` : ''}
    </div>`;
  }
  function saveEdit() {
    const e = ui.edit, name = e.name.trim(), time = num(e.time);
    if (!name) return say('Bitte einen Namen eingeben.', 'bad');
    if (!(time > 0)) return say('Die Zeit muss größer als 0 sein.', 'bad');
    const clean = (l) => l.filter((x) => x.name.trim());
    const ing = clean(e.ingredients), prod = clean(e.products);
    if (!prod.length) return say('Mindestens ein Produkt angeben.', 'bad');
    for (const x of ing.concat(prod)) if (!(num(x.amount) > 0)) return say(`Menge bei „${x.name}“ muss größer als 0 sein.`, 'bad');
    if (db.recipes.some((r) => norm(r.name) === norm(name) && r.id !== e.id)) return say('Ein Rezept mit diesem Namen gibt es schon.', 'bad');
    const created = [];
    const conv = (l) => l.map((x) => ({ item: findOrCreateItem(x.name, created), amount: num(x.amount) }));
    const rec = { id: e.id || uid(), name, time, category: e.category.trim() || 'Fertigung', ingredients: conv(ing), products: conv(prod) };
    const i = db.recipes.findIndex((r) => r.id === rec.id);
    if (i >= 0) db.recipes[i] = rec; else db.recipes.push(rec);
    ui.edit = editFromRecipe(rec); save(); render();
    say('Rezept gespeichert', 'ok', created.length ? `Neue Items: ${created.join(', ')}` : undefined);
  }
  function deleteRecipe(id) {
    db.recipes = db.recipes.filter((r) => r.id !== id);
    for (const k of Object.keys(plan.recipeChoice)) if (plan.recipeChoice[k] === id) delete plan.recipeChoice[k];
    delete plan.machineChoice[id]; delete plan.mods[id];
  }
  function recipeToLine(r) {
    const l = (xs) => xs.map((x) => `${x.amount} ${itemName(x.item)}`).join(' + ');
    return `${r.name}: ${l(r.ingredients)} => ${l(r.products)} ; ${r.time} ; ${r.category}`;
  }
  function applyQuick() {
    const text = $('#quick-text').value; ui.quickText = text;
    const p = parseQuick(text);
    if (!p.recipes.length && !p.errors.length) return say('Keine Rezepte gefunden.', 'bad');
    const created = []; let added = 0, updated = 0;
    for (const q of p.recipes) {
      const rec = { name: q.name, time: q.time, category: q.category,
        ingredients: q.ingredients.map((x) => ({ item: findOrCreateItem(x.name, created), amount: x.amount })),
        products: q.products.map((x) => ({ item: findOrCreateItem(x.name, created), amount: x.amount })) };
      const ex = db.recipes.find((r) => norm(r.name) === norm(q.name));
      if (ex) { Object.assign(ex, rec); updated++; } else { db.recipes.push({ id: uid(), ...rec }); added++; }
    }
    save();
    if (!p.errors.length) ui.quickText = '';
    render();
    say(`${added} neu, ${updated} aktualisiert`, p.errors.length ? 'bad' : 'ok',
      [created.length ? `${created.length} Items angelegt` : '', p.errors.length ? `${p.errors.length} Fehler: ${p.errors[0]}` : ''].filter(Boolean).join(' · ') || undefined);
  }

  // ---------- Items ----------
  function renderItems(v) {
    v.innerHTML = `<div class="rr-stack">${sharedNote('Items')}<section class="panel">
      <div class="panel-head"><h3>Items und Flüssigkeiten <span class="count">${db.items.length}</span></h3>
        <input class="input" id="i-search" type="search" placeholder="Suchen …" value="${esc(ui.itemSearch)}" data-act="i-search" aria-label="Items durchsuchen" style="max-width:240px"></div>
      <div class="panel-body">
      <form class="trow" id="i-add">
        <input class="input" id="i-new-name" placeholder="Neues Item, z. B. Silizium" style="flex:1 1 220px" aria-label="Name">
        <select class="input" id="i-new-kind" aria-label="Typ" style="width:auto"><option value="item">Item</option><option value="fluid">Flüssigkeit</option></select>
        <button class="btn primary" type="submit">${iconSvg('plus')} Anlegen</button>
      </form>${iconBar()}</div>
      <div class="tbl-wrap"><table class="list rr-tbl"><thead><tr><th class="shrink">Icon</th><th>Name</th><th>Typ</th><th>Gratis</th><th class="n" title="Für die Waggon-Anzeige im Baum">Stapel</th><th title="Interner Name im Spiel, z. B. iron-plate – darüber werden Icon-Dateien zugeordnet">Spielname</th><th class="n">Rezepte</th><th class="n">Verwendet in</th><th></th></tr></thead>
      <tbody id="i-body">${itemRowsHtml()}</tbody></table></div>
      <div class="panel-body"><p class="help" style="margin:0">Items ohne Rezept gelten im Rechner automatisch als Rohstoff. Flüssigkeiten bekommen keine Band-Angabe. <b>Gratis</b> markiert Inputs, die praktisch nichts kosten (z. B. Wasser) – der Optimierer spart dann an echten Rohstoffen statt an diesen. <b>Stapel</b> ist die Stapelgröße im Spiel (z. B. 100 für Platten) und ergibt die Waggons pro Minute im Baum.</p></div>
    </section></div>`;
  }
  function itemRowsHtml() {
    const I = buildIndex(db), q = norm(ui.itemSearch);
    return [...db.items].sort((a, b) => a.name.localeCompare(b.name, 'de')).filter((i) => !q || norm(i.name).includes(q)).map((i) => `<tr>
      <td class="shrink"><button class="ibtn" data-act="ic-one" data-kind="items" data-id="${i.id}" title="Icon ändern">${ico(i)}</button></td>
      <td><input class="input" id="in-${i.id}" value="${esc(i.name)}" data-act="i-name" data-id="${i.id}" style="min-width:180px" aria-label="Name"></td>
      <td><select class="input" data-act="i-kind" data-id="${i.id}" aria-label="Typ"><option value="item" ${i.kind !== 'fluid' ? 'selected' : ''}>Item</option><option value="fluid" ${i.kind === 'fluid' ? 'selected' : ''}>Flüssigkeit</option></select></td>
      <td><label class="check"><input type="checkbox" id="if-${i.id}" data-act="i-free" data-id="${i.id}" ${i.free ? 'checked' : ''} aria-label="Gratis-Input"></label></td>
      <td class="n"><input class="input num xs" id="ist-${i.id}" data-act="i-stack" data-id="${i.id}" value="${esc(i.stack || '')}" placeholder="–" inputmode="numeric" ${i.kind === 'fluid' ? 'disabled title="Flüssigkeit"' : ''} aria-label="Stapelgröße"></td>
      <td><input class="input mono-s" id="ig-${i.id}" data-act="i-game" data-id="${i.id}" value="${esc(i.game || '')}" placeholder="${esc(GAME[norm(i.name)] || slug(i.name))}" aria-label="Spielname"></td>
      <td class="n">${(I.prodBy.get(i.id) || []).length || '<span class="faint">Rohstoff</span>'}</td>
      <td class="n">${(I.useBy.get(i.id) || []).length}</td>
      <td class="shrink"><button class="btn ghost danger icon sm" data-act="i-del" data-id="${i.id}" data-confirm aria-label="Item löschen" title="Löschen">${iconSvg('trash')}</button></td></tr>`).join('') || '<tr><td colspan="9" class="sub">Keine Items.</td></tr>';
  }

  // ---------- Maschinen ----------
  function renderMachines(v) {
    const cats = new Map(); for (const r of db.recipes) { const k = norm(r.category); if (!cats.has(k)) cats.set(k, { name: r.category, n: 0 }); cats.get(k).n++; }
    const o = off();
    v.innerHTML = `<div class="rr-stack">${sharedNote('Maschinen')}<section class="panel">
      <div class="panel-head"><h3>Maschinen <span class="count">${db.machines.length}</span></h3><button class="btn sm primary" data-act="m-add">${iconSvg('plus')} Maschine</button></div>
      <div class="panel-body">${iconBar()}</div>
      <div class="tbl-wrap"><table class="list rr-tbl"><thead><tr><th title="Gilt nur für deinen Rechner „${esc(cur.name)}“">In „${esc(cur.name)}“</th><th class="shrink">Icon</th><th>Name</th><th class="n">Tempo</th><th class="n">Prod. %</th><th class="n" title="Leistungsaufnahme in kW">Leistung kW</th><th class="n" title="Verschmutzung pro Minute">Verschm./min</th><th>Kategorien (mit Komma getrennt)</th><th title="Interner Name im Spiel, z. B. assembling-machine-2">Spielname</th><th></th></tr></thead>
      <tbody id="m-body">${db.machines.map((m) => `<tr class="${o.has(m.id) ? 'rr-off' : ''}">
        <td class="shrink"><label class="check"><input type="checkbox" id="mu-${m.id}" data-act="m-use-cb" data-id="${m.id}" ${o.has(m.id) ? '' : 'checked'} aria-label="${esc(m.name)} im Rechner verwenden"></label></td>
        <td class="shrink"><button class="ibtn" data-act="ic-one" data-kind="machines" data-id="${m.id}" title="Icon ändern">${ico(m, 'machine')}</button></td>
        <td><input class="input" id="mn-${m.id}" value="${esc(m.name)}" data-act="m-f" data-f="name" data-id="${m.id}" style="min-width:180px" aria-label="Name"></td>
        <td class="n"><input class="input num xs" id="ms-${m.id}" value="${esc(m.speed)}" data-act="m-f" data-f="speed" data-id="${m.id}" inputmode="decimal" aria-label="Fertigungstempo"></td>
        <td class="n"><input class="input num xs" id="mp-${m.id}" value="${esc(m.prod || 0)}" data-act="m-f" data-f="prod" data-id="${m.id}" inputmode="decimal" aria-label="Basis-Produktivität"></td>
        <td class="n"><input class="input num xs" id="mw-${m.id}" value="${esc(m.power || '')}" placeholder="–" data-act="m-f" data-f="power" data-id="${m.id}" inputmode="decimal" aria-label="Leistung in kW"></td>
        <td class="n"><input class="input num xs" id="mpo-${m.id}" value="${esc(m.pollution || '')}" placeholder="–" data-act="m-f" data-f="pollution" data-id="${m.id}" inputmode="decimal" aria-label="Verschmutzung pro Minute"></td>
        <td><input class="input" id="mc-${m.id}" value="${esc(m.categories)}" data-act="m-f" data-f="categories" data-id="${m.id}" style="min-width:200px" aria-label="Kategorien"></td>
        <td><input class="input mono-s" id="mg-${m.id}" value="${esc(m.game || '')}" placeholder="${esc(GAME[norm(m.name)] || slug(m.name))}" data-act="m-f" data-f="game" data-id="${m.id}" aria-label="Spielname"></td>
        <td class="shrink"><button class="btn ghost danger icon sm" data-act="m-del" data-id="${m.id}" data-confirm aria-label="Maschine löschen" title="Löschen">${iconSvg('trash')}</button></td></tr>`).join('')}</tbody></table></div>
      <div class="panel-body rr-stack" style="gap:12px">
        <p class="help" style="margin:0">Das Häkchen vorne gilt nur für deinen aktuell geöffneten Rechner <b>${esc(cur.name)}</b>${cur.readonly ? ' (nur angesehen, wird nicht gespeichert)' : ''} – abgewählte Maschinen werden dort nicht eingeplant. <b>Tempo</b> ist das Fertigungstempo (Montagemaschine 2 = 0,75, Bergbaubohrer = 0,5 bei Abbauzeit 1). <b>Prod. %</b> ist eingebaute Produktivität, z. B. 50 für Gießerei oder EM-Werk in Space Age. Module pro Rezept stellst du im Rechner ein. <b>Leistung</b> (kW) und <b>Verschmutzung</b> (pro Minute) stehen im Spiel im Tooltip der Maschine und ergeben die Summen im Produktionsbaum.</p>
        <div><h3>Kategorien aus den Rezepten</h3>
        <div class="covered">${[...cats].sort((a, b) => a[1].name.localeCompare(b[1].name, 'de')).map(([k, c]) => { const n = machinesFor(db, k).length;
          return `<span class="mchip">${esc(c.name)} <span class="sub">${c.n} Rez.</span> ${n ? `<span class="tag ok">${n} Masch.</span>` : '<span class="tag bad">keine Maschine</span>'}</span>`; }).join('') || '<span class="sub">Noch keine Rezepte.</span>'}</div></div>
      </div>
    </section></div>`;
  }
  function setMachineUse(id, on) {
    const s = off(); if (on) s.delete(id); else s.add(id);
    plan.machinesOff = db.machines.map((m) => m.id).filter((x) => s.has(x));
    save();
  }

  // ---------- Icons hochladen ----------
  function iconBar() {
    const have = db.items.filter((i) => i.icon).length + db.machines.filter((m) => m.icon).length, all = db.items.length + db.machines.length;
    return `<div class="rr-iconbar">${iconSvg('image')}<div class="grow"><b>Icons aus deinem Spiel</b> <span class="count">${have} von ${all}</span>
      <div class="sub">Ordner <code>Factorio\\data\\base\\graphics\\icons</code> wählen, für Space Age danach zusätzlich <code>data\\space-age\\graphics\\icons</code>. Zugeordnet wird über den Spielnamen; einzelne Icons änderst du per Klick auf das Bild.</div></div>
      <button class="btn sm" data-act="ic-folder">${iconSvg('folder')} Ordner wählen</button><button class="btn sm ghost" data-act="ic-files">Dateien wählen</button></div>`;
  }
  const gameKeys = (o) => [o.game, GAME[norm(o.name)], slug(o.name)].filter(Boolean).map((x) => String(x).toLowerCase());
  function pickFiles(folder, single) {
    return new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept: 'image/png,image/webp', multiple: !single });
      if (folder) inp.webkitdirectory = true;
      inp.addEventListener('change', () => { const fs = [...inp.files]; if (single) resolve(fs[0]); else bulkIcons(fs); });
      inp.click();
    });
  }
  async function bulkIcons(files) {
    // nur echte Icon-Dateien (…/icons/…), keine Sprite-Sheets aus dem entity-Ordner
    const byStem = new Map();
    for (const f of files) {
      const rel = f.webkitRelativePath || f.name;
      if (!/\.(png|webp)$/i.test(f.name)) continue;
      if (f.webkitRelativePath && !/(^|\/)icons\//i.test(rel)) continue;
      const stem = f.name.replace(/\.[^.]+$/, '').toLowerCase();
      const prev = byStem.get(stem);
      if (!prev || rel.length < (prev.webkitRelativePath || prev.name).length) byStem.set(stem, f);
    }
    const jobs = [];
    for (const k of ['items', 'machines']) for (const o of db[k]) { const key = gameKeys(o).find((x) => byStem.has(x)); if (key) jobs.push([k, o.id, key, byStem.get(key)]); }
    if (!jobs.length) return say('Keine passenden Icons gefunden', 'bad', `${byStem.size} Bilder geprüft. Trag bei Items den Spielnamen ein (z. B. iron-plate) oder wähle den icons-Ordner.`);
    say(`${jobs.length} Icons werden hochgeladen …`, 'info');
    let ok = 0, fail = 0;
    const run = async () => { while (jobs.length) { const [k, id, key, f] = jobs.shift();
      try { const ik = await uploadIcon(f); const o = db[k].find((x) => x.id === id); if (o) { o.icon = ik; if (!o.game) o.game = key; ok++; } } catch { fail++; } } };
    await Promise.all(Array.from({ length: 6 }, run));
    save(); rerender();
    say(`${ok} Icons zugeordnet`, fail ? 'bad' : 'ok', fail ? `${fail} fehlgeschlagen` : undefined);
  }
  function iconMenu(b) {
    const k = b.dataset.kind, o = db[k].find((x) => x.id === b.dataset.id); if (!o) return;
    menu(b, [{ label: 'Bild hochladen …', icon: 'upload', onclick: async () => {
      const f = await pickFiles(false, true); if (!f) return;
      try { o.icon = await uploadIcon(f); save(); rerender(); } catch (e) { say('Icon konnte nicht gespeichert werden', 'bad', e.message); }
    } }, o.icon ? { label: 'Icon entfernen', icon: 'trash', danger: true, onclick: () => { delete o.icon; save(); rerender(); } } : null]);
  }

  // ---------- Daten ----------
  function renderData(v) {
    v.innerHTML = `<div class="rr-stack">
    <section class="panel rr-box">
      <div class="phead"><h2>Export</h2></div>
      <p class="help">Exportiert den gemeinsamen Datenbestand zusammen mit deinem geöffneten Rechner <b>${esc(cur.name)}</b> als JSON – zum Sichern oder um einen Mod-Datensatz weiterzugeben.</p>
      <div class="row-actions">
        <button class="btn" data-act="exp">${iconSvg('download')} Export erzeugen</button>
        <button class="btn" data-act="copy">${iconSvg('copy')} Kopieren</button>
        <button class="btn" data-act="dl">${iconSvg('download')} Als Datei speichern</button>
      </div>
    </section>
    <section class="panel rr-box">
      <div class="phead"><h2>Import</h2></div>
      <p class="help"><b>Zusammenführen</b> übernimmt Items, Rezepte und Maschinen aus dem JSON in den gemeinsamen Bestand. Gleichnamige Einträge werden aktualisiert, alles andere bleibt erhalten. Exporte aus der eigenständigen Version des Rechners funktionieren ebenfalls.</p>
      <textarea class="input mono" id="json" rows="10" placeholder="JSON hier einfügen oder per Export erzeugen …"></textarea>
      <label class="check" style="margin-top:10px"><input type="checkbox" id="imp-plan" checked> Enthaltenen Rechner als neuen eigenen Rechner anlegen</label>
      <div class="row-actions">
        <button class="btn primary" data-act="imp-merge">${iconSvg('upload')} Zusammenführen</button>
        ${isAdmin ? `<button class="btn danger" data-act="imp-replace">${iconSvg('upload')} Bestand ersetzen</button>` : ''}
      </div>
    </section>
    ${isAdmin ? `<section class="panel rr-box">
      <div class="phead"><h2>Gemeinsamen Bestand verwalten</h2><span class="tag">Administrator</span></div>
      <p class="help">Ersetzen betrifft alle Benutzer. Vorher wird automatisch eine Sicherung angelegt; außerdem entsteht täglich eine Sicherung, sobald jemand etwas ändert. <b>Beispieldaten</b> enthält Vanilla-Rezepte bis Chemie-Forschung inklusive Ölverarbeitung und Cracking.</p>
      <div class="row-actions">
        <button class="btn" data-act="reset-sample">Durch Beispieldaten ersetzen</button>
        <button class="btn danger" data-act="reset-empty">Alles leeren</button>
        <button class="btn ghost" data-act="backup-now">${iconSvg('saves')} Jetzt sichern</button>
      </div>
      <div class="rr-backups" id="backups"><div class="sub">Sicherungen werden geladen …</div></div>
    </section>` : `<div class="note">${iconSvg('info')}<div>Ersetzen, Leeren und Wiederherstellen des gemeinsamen Bestands können nur Administratoren.</div></div>`}
    </div>`;
    if (isAdmin) loadBackups();
  }
  async function loadBackups() {
    const el = $('#backups'); if (!el) return;
    try {
      const list = await get('/api/ratio/backups');
      if (!$('#backups')) return;
      el.innerHTML = list.length ? `<table class="list rr-tbl"><thead><tr><th>Zeitpunkt</th><th>Anlass</th><th class="n">Items</th><th class="n">Rezepte</th><th class="n">Maschinen</th><th></th></tr></thead><tbody>
        ${list.map((b) => `<tr><td>${esc(dt(b.ts))}${b.username ? ` <span class="sub">· ${esc(b.username)}</span>` : ''}</td><td>${esc(b.reason)}</td><td class="n">${b.counts.items}</td><td class="n">${b.counts.recipes}</td><td class="n">${b.counts.machines}</td>
        <td class="shrink"><button class="btn ghost sm" data-act="restore" data-id="${b.id}">Wiederherstellen</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="sub">Noch keine Sicherungen.</div>';
    } catch (e) { el.innerHTML = `<div class="sub">Sicherungen nicht verfügbar: ${esc(e.message)}</div>`; }
  }
  const parseJson = () => { const d = JSON.parse($('#json').value); const nd = d.db || d; if (!validDb(nd)) throw new Error('items, recipes und machines fehlen'); return { nd, plan: d.plan }; };
  async function importPlanFrom(p, map, label) {
    if (!p || !$('#imp-plan') || !$('#imp-plan').checked) return;
    const r = await post('/api/ratio/plans', { name: label, data: remapPlan(p, map) });
    await refreshPlans(); await openPlan(r.id); ui.tab = 'data'; render();
  }
  async function replaceAll(data, reason, map = {}, p) {
    const ok = await confirmDialog({ title: 'Gemeinsamen Bestand ersetzen', danger: true, confirm: 'Ersetzen',
      text: `Items, Rezepte und Maschinen werden für alle Benutzer durch „${reason}“ ersetzt (${data.items.length} Items, ${data.recipes.length} Rezepte, ${data.machines.length} Maschinen). Der aktuelle Stand wird vorher gesichert und lässt sich wiederherstellen.` });
    if (!ok) return;
    try {
      await flush();
      await post('/api/ratio/db/replace', { ...data, reason }); await refetchDb(false); ui.edit = null;
      say('Bestand ersetzt', 'ok', `${db.items.length} Items, ${db.recipes.length} Rezepte, ${db.machines.length} Maschinen`);
      await importPlanFrom(p, map, 'Import'); loadBackups();
    } catch (e) { say('Ersetzen fehlgeschlagen', 'bad', e.message); }
  }

  // ---------- Events (auf den Bereich begrenzt, beim Verlassen entfernt) ----------
  let resT;
  const recalc = (delay = 0) => { clearTimeout(resT); resT = setTimeout(() => { save(); renderResults(); if (cur.readonly) renderPlanBar(); }, delay); };
  function armed(btn) {
    if (!btn.hasAttribute('data-confirm')) return true;
    if (btn.dataset.armed === '1') return true;
    btn.dataset.armed = '1'; btn.dataset.label = btn.innerHTML; btn.classList.add('armed'); btn.textContent = 'Sicher? Nochmal klicken';
    setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.classList.remove('armed'); btn.innerHTML = btn.dataset.label; } }, 3000);
    return false;
  }
  const exportJson = () => JSON.stringify({ format: 'factorio-ratio', version: 1, db, plan, name: cur.name }, null, 1);
  const planChanged = () => { save(); if (cur.readonly) renderPlanBar(); };

  const onClick = (e) => {
    const tab = e.target.closest('.tabs .tab'); if (tab) { ui.tab = tab.dataset.tab; prefs.tab = ui.tab; savePrefs(); render(); return; }
    const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT' || b.tagName === 'TEXTAREA') return;
    const act = b.dataset.act;
    if (!armed(b)) return;
    const tr = b.closest('.trow'); const ti = tr ? Number(tr.dataset.i) : -1;
    switch (act) {
      case 'ic-one': iconMenu(b); break;
      case 'ic-folder': pickFiles(true); break;
      case 'ic-files': pickFiles(false); break;
      case 'res-view': ui.resView = b.dataset.v; prefs.resView = ui.resView; savePrefs(); renderResults(); break;
      case 'tree-open': { const id = b.dataset.id; if (ui.treeOpen.has(id)) ui.treeOpen.delete(id); else ui.treeOpen.add(id); renderResults(); break; }
      case 'p-new': newPlan(); break;
      case 'p-copy': copyPlan(); break;
      case 'p-share': sharePlan(); break;
      case 'p-reload': openPlan(cur.id); break;
      case 'p-hide': (async () => { try { planSnap = J(plan); await del(`/api/ratio/plans/${cur.id}/shares/${S.user.id}`); await refreshPlans(); await openPlan(plans.own[0].id); say('Ausgeblendet', 'ok', 'Der Besitzer kann ihn erneut mit dir teilen.'); } catch (err) { say('Fehlgeschlagen', 'bad', err.message); } })(); break;
      case 'p-menu': menu(b, [{ label: 'Umbenennen', icon: 'edit', onclick: renamePlan }, { label: 'Duplizieren', icon: 'copy', onclick: copyPlan }, '-', { label: 'Löschen', icon: 'trash', danger: true, onclick: deletePlan }]); break;
      case 'm-use': setMachineUse(b.dataset.id, b.getAttribute('aria-pressed') !== 'true'); $('#mach-pick').innerHTML = machPickHtml(); renderResults(); if (cur.readonly) renderPlanBar(); break;
      case 'm-use-all': plan.machinesOff = []; planChanged(); $('#mach-pick').innerHTML = machPickHtml(); renderResults(); break;
      case 'unit': { const old = plan.unit, nu = b.dataset.v; if (old !== nu) { const f = nu === 'min' ? 60 : 1 / 60; plan.targets.forEach((t) => { const r = num(t.rate); if (r > 0) t.rate = String(+(r * f).toPrecision(6)); }); } plan.unit = nu; save(); render(); break; }
      case 'add-target': plan.targets.push({ item: null, rate: plan.unit === 'min' ? '60' : '1' }); save(); render(); setTimeout(() => { const el = $(`#t-item-${plan.targets.length - 1}`); el && el.focus(); }, 0); break;
      case 't-del': plan.targets.splice(ti, 1); save(); render(); break;
      case 't-belt': { const v = (Number(plan.belt) || 15) * uMul(); plan.targets[ti].rate = String(v); $(`#t-rate-${ti}`).value = v; recalc(); break; }
      case 'apply-ratio': { const s = Number(b.dataset.s); plan.targets.forEach((t) => { const r = num(t.rate); if (r > 0) t.rate = String(+(r * s).toPrecision(8)); }); save(); render(); break; }
      case 'scale': { const f = Number(b.dataset.f); plan.targets.forEach((t) => { const r = num(t.rate); if (r > 0) t.rate = String(+(r * f).toPrecision(8)); }); save(); render(); break; }
      case 'r-new': ui.edit = newEdit(); render(); setTimeout(() => $('#e-name') && $('#e-name').focus(), 0); break;
      case 'r-open': { const r = db.recipes.find((x) => x.id === b.dataset.r); if (r) { ui.edit = editFromRecipe(r); $('#editor').innerHTML = editorHtml(); $('#rlist').innerHTML = recipeListHtml(); } break; }
      case 'e-addrow': ui.edit[b.dataset.list].push({ name: '', amount: '1' }); $('#editor').innerHTML = editorHtml(); { const l = ui.edit[b.dataset.list].length - 1; const el = $(`#e-${b.dataset.list}-n-${l}`); el && el.focus(); } break;
      case 'e-delrow': ui.edit[b.dataset.list].splice(Number(b.dataset.i), 1); $('#editor').innerHTML = editorHtml(); break;
      case 'e-save': saveEdit(); break;
      case 'e-dup': { const e2 = ui.edit; ui.edit = { ...e2, id: null, name: e2.name + ' (Kopie)', ingredients: e2.ingredients.map((x) => ({ ...x })), products: e2.products.map((x) => ({ ...x })) }; render(); break; }
      case 'e-del': deleteRecipe(ui.edit.id); ui.edit = null; save(); render(); say('Rezept gelöscht'); break;
      case 'e-calc': { const r = db.recipes.find((x) => x.id === ui.edit.id); if (r) { plan.targets = [{ item: r.products[0].item, rate: plan.unit === 'min' ? '60' : '1' }]; ui.tab = 'calc'; prefs.tab = 'calc'; savePrefs(); save(); render(); } break; }
      case 'quick-load': $('#quick-text').value = [...db.recipes].sort((a, c) => a.name.localeCompare(c.name, 'de')).map(recipeToLine).join('\n'); break;
      case 'quick-apply': applyQuick(); break;
      case 'i-del': { const id = b.dataset.id; const used = db.recipes.filter((r) => r.ingredients.concat(r.products).some((x) => x.item === id));
        if (used.length) { say('Item wird noch verwendet', 'bad', used.slice(0, 4).map((r) => r.name).join(', ') + (used.length > 4 ? ' …' : '')); break; }
        db.items = db.items.filter((i) => i.id !== id); plan.targets = plan.targets.filter((t) => t.item !== id); plan.inputs = plan.inputs.filter((x) => x !== id); delete plan.recipeChoice[id]; save(); $('#i-body').innerHTML = itemRowsHtml(); renderDatalists(); break; }
      case 'm-add': db.machines.push({ id: uid(), name: 'Neue Maschine', speed: 1, prod: 0, categories: 'Fertigung' }); save(); render(); break;
      case 'm-del': { const id = b.dataset.id; db.machines = db.machines.filter((m) => m.id !== id); for (const k of Object.keys(plan.machineChoice)) if (plan.machineChoice[k] === id) delete plan.machineChoice[k]; for (const k of Object.keys(plan.catDefault)) if (plan.catDefault[k] === id) delete plan.catDefault[k]; plan.machinesOff = (plan.machinesOff || []).filter((x) => x !== id); save(); render(); break; }
      case 'exp': $('#json').value = exportJson(); break;
      case 'copy': { const ta = $('#json'); if (!ta.value) ta.value = exportJson(); copyText(ta.value).catch(() => { ta.focus(); ta.select(); say('Text markiert – mit Strg+C kopieren', 'info'); }); break; }
      case 'dl': { const blob = new Blob([exportJson()], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: 'factorio-ratio.json' }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); break; }
      case 'imp-merge': (async () => { try { const { nd, plan: p } = parseJson();
        const { map, st } = mergeDb(db, nd, { add: true, overwrite: true }); save(); await flush(); ui.edit = null;
        say('Zusammengeführt', 'ok', `${st.added} neu, ${st.updated} aktualisiert`);
        await importPlanFrom(p, map, 'Import'); if (!p || !$('#imp-plan')?.checked) render();
      } catch (err) { say('Import fehlgeschlagen', 'bad', err.message); } })(); break;
      case 'imp-replace': try { const { nd, plan: p } = parseJson(); replaceAll({ items: nd.items, recipes: nd.recipes, machines: nd.machines }, 'Import', {}, p); } catch (err) { say('Import fehlgeschlagen', 'bad', err.message); } break;
      case 'reset-sample': { const s = sampleData(); replaceAll(s.db, 'Beispieldaten'); break; }
      case 'reset-empty': replaceAll({ items: [], recipes: [], machines: [] }, 'Leerer Bestand'); break;
      case 'backup-now': post('/api/ratio/backups').then(() => { say('Sicherung angelegt'); loadBackups(); }).catch((err) => say('Sichern fehlgeschlagen', 'bad', err.message)); break;
      case 'restore': (async () => {
        const ok = await confirmDialog({ title: 'Sicherung wiederherstellen', text: 'Der gemeinsame Bestand wird für alle Benutzer auf diesen Stand zurückgesetzt. Der aktuelle Stand wird vorher gesichert.', confirm: 'Wiederherstellen', danger: true });
        if (!ok) return;
        try { await flush(); await post(`/api/ratio/backups/${b.dataset.id}/restore`); await refetchDb(false); say('Wiederhergestellt'); loadBackups(); } catch (err) { say('Wiederherstellen fehlgeschlagen', 'bad', err.message); }
      })(); break;
    }
  };
  const onInput = (e) => {
    const t = e.target, act = t.dataset.act; if (!act) return;
    if (act === 't-rate') { const i = Number(t.closest('.trow').dataset.i); plan.targets[i].rate = t.value; recalc(250); }
    else if (act === 'e-field') ui.edit[t.dataset.f] = t.value;
    else if (act === 'e-row') ui.edit[t.dataset.list][Number(t.dataset.i)][t.dataset.f] = t.value;
    else if (act === 'r-search') { ui.recipeSearch = t.value; $('#rlist').innerHTML = recipeListHtml(); }
    else if (act === 'i-search') { ui.itemSearch = t.value; $('#i-body').innerHTML = itemRowsHtml(); }
    else if (act === 't-item') { const it = itemByName(t.value); t.classList.toggle('invalid', !!t.value && !it); if (it) { const row = t.closest('.trow'), i = Number(row.dataset.i); row.querySelector('.t-ico').innerHTML = ico(it); if (plan.targets[i].item !== it.id) { plan.targets[i].item = it.id; recalc(); } } }
  };
  const onChange = (e) => {
    const t = e.target, act = t.dataset.act; if (!act) return;
    switch (act) {
      case 'plan-sel': openPlan(t.value).catch((err) => say('Rechner konnte nicht geöffnet werden', 'bad', err.message)); break;
      case 'm-use-cb': setMachineUse(t.dataset.id, t.checked); t.closest('tr').classList.toggle('rr-off', !t.checked); break;
      case 'belt': plan.belt = Number(t.value); recalc(); break;
      case 't-item': { const it = itemByName(t.value); const i = Number(t.closest('.trow').dataset.i); if (it) { plan.targets[i].item = it.id; t.classList.remove('invalid'); recalc(); } else if (t.value) say(`„${t.value}“ gibt es nicht`, 'bad', 'Unter Items oder Rezepte anlegen.'); break; }
      case 'r-machine': plan.machineChoice[t.dataset.r] = t.value; recalc(); break;
      case 'r-speed': case 'r-prod': { const m = plan.mods[t.dataset.r] || (plan.mods[t.dataset.r] = {}); m[act === 'r-speed' ? 'speed' : 'prod'] = num(t.value) || 0; recalc(); break; }
      case 'i-src': { const id = t.dataset.item, v = t.value; plan.inputs = plan.inputs.filter((x) => x !== id);
        if (v === 'input') { plan.inputs.push(id); delete plan.recipeChoice[id]; } else plan.recipeChoice[id] = v; recalc(); break; }
      case 'cat-default': plan.catDefault[t.dataset.cat] = t.value; recalc(); break;
      case 'i-name': { const it = db.items.find((i) => i.id === t.dataset.id); if (!it) break; const nn = t.value.trim();
        if (!nn || db.items.some((i) => i.id !== it.id && norm(i.name) === norm(nn))) { say(!nn ? 'Name darf nicht leer sein.' : 'Diesen Namen gibt es schon.', 'bad'); t.value = it.name; break; }
        it.name = nn; save(); renderDatalists(); break; }
      case 'i-kind': { const it = db.items.find((i) => i.id === t.dataset.id); if (it) { it.kind = t.value; save(); } break; }
      case 'i-stack': { const it = db.items.find((i) => i.id === t.dataset.id); if (it) { const v = Math.round(num(t.value)); if (v > 0) it.stack = v; else delete it.stack; t.value = it.stack || ''; save(); } break; }
      case 'i-game': { const it = db.items.find((i) => i.id === t.dataset.id); if (it) { const v = t.value.trim(); if (v) it.game = v; else delete it.game; save(); } break; }
      case 'i-free': { const it = db.items.find((i) => i.id === t.dataset.id); if (it) { it.free = t.checked; save(); } break; }
      case 'm-f': { const m = db.machines.find((x) => x.id === t.dataset.id), f = t.dataset.f; if (!m) break;
        if (f === 'speed') { const v = num(t.value); if (!(v > 0)) { say('Tempo muss größer als 0 sein.', 'bad'); t.value = m.speed; break; } m.speed = v; }
        else if (f === 'prod') m.prod = num(t.value) || 0;
        else if (f === 'power' || f === 'pollution') { const v = num(t.value); if (v > 0) m[f] = v; else delete m[f]; }
        else if (f === 'game') { const v = t.value.trim(); if (v) m.game = v; else delete m.game; }
        else m[f] = t.value;
        save(); if (f === 'categories') render(); break; }
    }
  };
  const onToggle = (e) => { if (e.target.id === 'defaults-panel') ui.defaultsOpen = e.target.open; if (e.target.id === 'quick-panel') ui.quickOpen = e.target.open; if (e.target.id === 'machines-panel') ui.machOpen = e.target.open; };
  const onSubmit = (e) => {
    if (e.target.id !== 'i-add') return; e.preventDefault();
    const n = $('#i-new-name').value.trim(); if (!n) return;
    if (itemByName(n)) return say('Dieses Item gibt es schon.', 'bad');
    db.items.push({ id: uid(), name: n, kind: $('#i-new-kind').value }); save(); $('#i-new-name').value = ''; $('#i-body').innerHTML = itemRowsHtml(); renderDatalists(); say(`„${n}“ angelegt`);
  };
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('toggle', onToggle, true);
  root.addEventListener('submit', onSubmit);

  render();
  if (pendingChanges()) save();   // z. B. übernommene ältere eigene Daten
}
