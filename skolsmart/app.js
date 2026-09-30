const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const uid=()=>Math.random().toString(36).slice(2,10);
const shuf=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
const DAYS=["Mån","Tis","Ons","Tor","Fre","Lör","Sön"];
const DAYS_LONG=["Måndag","Tisdag","Onsdag","Torsdag","Fredag","Lördag","Söndag"];
const TYPES={prov:"Prov",inlamning:"Inlämning",lexa:"Läxa",jobb:"Jobb",annat:"Övrigt"};
const COLORS=["#4f46e5","#16a34a","#dc2626","#d97706","#0891b2","#c026d3","#65a30d","#e11d48"];
const KEY="skolsmart:v1";

const iso=d=>{const z=n=>String(n).padStart(2,"0");return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate())};
const fromIso=s=>new Date(s+"T00:00:00");
const todayIso=()=>iso(new Date());
const dayIdx=d=>(d.getDay()+6)%7;
const daysBetween=(a,b)=>Math.round((fromIso(b)-fromIso(a))/864e5);
const fmtDate=s=>fromIso(s).toLocaleDateString("sv-SE",{weekday:"short",day:"numeric",month:"short"});

const SEED_Q=[
 ["Biologi","Ekologi",1,"Vad är en population?","Alla individer av en art i ett område",["Alla arter i ett område","En art i hela världen","Ett ekosystem"],"Population = en art, ett område. Flera populationer bildar ett samhälle."],
 ["Biologi","Ekologi",2,"Vad menas med 10%-regeln?","Ca 10% av energin förs vidare till nästa trofinivå",["10% av arterna dör varje år","Växter använder 10% av solljuset","Rovdjur äter 10% av bytet"],"Resten går åt till rörelse, värme och avfall."],
 ["Biologi","Ekologi",3,"Vad är en trofisk kaskadeffekt?","En förändring högt upp i näringskedjan som fortplantar sig neråt",["Att energi ökar uppåt","Att alla nivåer minskar lika mycket","Ett annat ord för fotosyntes"],"T.ex. färre rovdjur ger fler växtätare och mindre växtlighet."],
 ["Biologi","Cellandning",1,"Var sker cellandningen?","I mitokondrierna",["I kloroplasterna","I cellkärnan","I cellväggen"],"Kloroplaster används i fotosyntesen."],
 ["Biologi","Cellandning",2,"Vilka ämnen bildas vid cellandning?","Koldioxid, vatten och energi",["Socker och syre","Kväve och vatten","Protein och energi"],"Socker + syre → koldioxid + vatten + energi."],
 ["Kemi","Atomen",1,"Vad visar atomnumret?","Antalet protoner",["Antalet neutroner","Protoner + neutroner","Antalet skal"],"Atomnumret bestämmer grundämnet."],
 ["Kemi","Atomen",2,"Vad är en isotop?","Samma grundämne med olika antal neutroner",["Olika grundämnen med samma masstal","En jon","En molekyl"],"Samma antal protoner, olika masstal."],
 ["Kemi","Atomen",3,"Hur många elektroner ryms i tredje skalet i Bohrs modell (upp till nr 20)?","8",["2","18","32"],"Skalen fylls 2, 8, 8, 2 i den förenklade modellen."],
 ["Kemi","Joner",1,"Vilken laddning har en jon från grupp 1?","+1",["−1","+2","0"],"Grupp 1 avger en valenselektron."],
 ["Kemi","Joner",2,"Vad blir formeln för kalcium (Ca²⁺) och klor (Cl⁻)?","CaCl₂",["CaCl","Ca₂Cl","CaCl₃"],"Laddningarna ska ta ut varandra."],
 ["Samhällskunskap","Riksdagen",1,"Hur många ledamöter har riksdagen?","349",["300","329","400"],"De väljs vart fjärde år."],
 ["Samhällskunskap","Riksdagen",2,"Vilken procentspärr gäller för att komma in i riksdagen?","4 %",["2 %","1 %","10 %"],"Spärren motverkar splittring."],
];

let S=load();
function load(){
 let d=null;try{d=JSON.parse(localStorage.getItem(KEY))}catch(e){}
 if(d&&d.v===1)return d;
 const subjects=["Biologi","Kemi","Samhällskunskap","Idrott och hälsa","Svenska","Engelska"].map((n,i)=>({id:uid(),name:n,color:COLORS[i%COLORS.length]}));
 const sid=n=>subjects.find(s=>s.name===n)?.id;
 const questions=SEED_Q.map(([s,t,l,q,a,w,e])=>({id:uid(),subjectId:sid(s),topic:t,level:l,q,a,wrong:w,exp:e}));
 return {v:1,subjects,lessons:[],tasks:[],questions,skill:{},settings:{notify:false},notified:{}};
}
function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}
const subj=id=>S.subjects.find(s=>s.id===id)||{name:"Allmänt",color:"#6b7089"};
const subjOptions=sel=>S.subjects.map(s=>`<option value="${s.id}"${s.id===sel?" selected":""}>${esc(s.name)}</option>`).join("");

/* ---------- dialog ---------- */
const dlg=$("#dlg");
function openDlg(html,onSubmit){
 dlg.innerHTML=`<form method="dialog">${html}</form>`;
 const f=$("form",dlg);
 f.onsubmit=e=>{e.preventDefault();const r=onSubmit&&onSubmit(new FormData(f),e.submitter);if(r!==false){dlg.close();render()}};
 $$("[data-close]",dlg).forEach(b=>b.onclick=()=>dlg.close());
 dlg.showModal();
 return f;
}

/* ---------- routing ---------- */
const VIEWS={idag:vIdag,schema:vSchema,uppgifter:vUppgifter,plan:vPlan,test:vTest};
function render(){
 const key=(location.hash||"#idag").slice(1).split("/")[0];
 const v=VIEWS[key]?key:"idag";
 $$("#tabs a").forEach(a=>a.classList.toggle("on",a.dataset.v===v));
 $("#app").innerHTML=VIEWS[v]();
 bind(v);
 save();
}
window.addEventListener("hashchange",()=>{render();scrollTo(0,0)});

/* ---------- helpers for lists ---------- */
function dueChip(t){
 const d=daysBetween(todayIso(),t.due);
 if(t.done)return `<span class="chip" style="--c:var(--good)">Klar</span>`;
 if(d<0)return `<span class="chip late">Försenad ${-d} d</span>`;
 if(d===0)return `<span class="chip late">Idag${t.time?" "+esc(t.time):""}</span>`;
 if(d===1)return `<span class="chip soon">Imorgon${t.time?" "+esc(t.time):""}</span>`;
 return `<span class="chip${d<=3?" soon":""}">${fmtDate(t.due)} · ${d} d</span>`;
}
function taskRow(t){
 const s=subj(t.subjectId);
 return `<div class="item${t.done?" done":""}"><button class="chk${t.done?" on":""}" data-tog="${t.id}" aria-label="Markera klar">${t.done?"✓":""}</button><div class="grow" data-edit="${t.id}" style="cursor:pointer"><div class="title">${esc(t.title)}</div><div class="sub"><span class="dot" style="background:${s.color};display:inline-block;margin:0 6px 0 0"></span>${esc(s.name)} · ${TYPES[t.type]}</div></div>${dueChip(t)}</div>`;
}
function lessonRow(l){
 const s=subj(l.subjectId);
 return `<div class="item" data-editl="${l.id}" style="cursor:pointer"><span class="dot" style="background:${s.color}"></span><span class="time">${esc(l.start)}–${esc(l.end)}</span><div class="grow"><div class="title">${esc(l.kind==="work"?(l.title||"Jobb"):s.name)}</div>${l.room?`<div class="sub">${esc(l.room)}</div>`:""}</div>${l.kind==="work"?`<span class="chip" style="--c:var(--warn)">Jobb</span>`:""}</div>`;
}

/* ---------- Idag ---------- */
function vIdag(){
 const now=new Date(),td=todayIso(),di=dayIdx(now);
 const lessons=S.lessons.filter(l=>l.day===di).sort((a,b)=>a.start.localeCompare(b.start));
 const open=S.tasks.filter(t=>!t.done).sort((a,b)=>(a.due+(a.time||"")).localeCompare(b.due+(b.time||"")));
 const late=open.filter(t=>t.due<td),soon=open.filter(t=>t.due>=td).slice(0,6);
 const steps=[];S.tasks.forEach(t=>(t.plan||[]).forEach((p,i)=>{if(p.date<=td&&!p.done&&!t.done)steps.push({t,p,i})}));
 return `<div><h1>Hej! 👋</h1><p class="sub">${DAYS_LONG[di]} ${now.toLocaleDateString("sv-SE",{day:"numeric",month:"long"})}</p></div>
 ${late.length?`<section class="card"><h2 style="color:var(--bad)">Försenat</h2>${late.map(taskRow).join("")}</section>`:""}
 <section class="card"><h2>Schema idag</h2>${lessons.length?lessons.map(lessonRow).join(""):`<div class="empty">Inget schemalagt idag. Lägg till lektioner under Schema.</div>`}</section>
 <section class="card"><h2>Att göra härnäst</h2>${soon.length?soon.map(taskRow).join(""):`<div class="empty">Inget på gång. Njut! 🎉</div>`}</section>
 ${steps.length?`<section class="card"><h2>Dagens studieplan</h2>${steps.map(({t,p,i})=>`<div class="item"><button class="chk" data-step="${t.id}:${i}" aria-label="Klar"></button><div class="grow"><div class="title">${esc(p.text)}</div><div class="sub">${esc(t.title)}</div></div></div>`).join("")}</section>`:""}
 <button class="fab" data-add="task" aria-label="Ny uppgift">+</button>`;
}

/* ---------- Schema ---------- */
let schemaDay=dayIdx(new Date());
function vSchema(){
 const ls=S.lessons.filter(l=>l.day===schemaDay).sort((a,b)=>a.start.localeCompare(b.start));
 return `<div><h1>Schema</h1><p class="sub">Skola och jobb, vecka för vecka.</p></div>
 <div class="days">${DAYS.map((d,i)=>`<button class="btn sm${i===schemaDay?" on":""}" data-day="${i}">${d}</button>`).join("")}</div>
 <section class="card"><h2>${DAYS_LONG[schemaDay]}</h2>${ls.length?ls.map(lessonRow).join(""):`<div class="empty">Inget inlagt.</div>`}</section>
 <div class="row"><button class="btn pri grow" data-add="lesson">+ Lektion / jobbpass</button><button class="btn" data-subjects>Ämnen</button></div>`;
}
function lessonForm(l){
 l=l||{day:schemaDay,start:"08:30",end:"09:30",kind:"lesson",subjectId:S.subjects[0]?.id};
 const f=openDlg(`<h2>${l.id?"Ändra":"Nytt"} pass</h2>
 <label>Typ<select name="kind"><option value="lesson"${l.kind==="lesson"?" selected":""}>Lektion</option><option value="work"${l.kind==="work"?" selected":""}>Jobb</option></select></label>
 <label>Ämne<select name="subjectId">${subjOptions(l.subjectId)}</select></label>
 <label>Titel (jobb)<input name="title" value="${esc(l.title||"")}" placeholder="t.ex. Kassa"></label>
 <label>Dag<select name="day">${DAYS_LONG.map((d,i)=>`<option value="${i}"${i===l.day?" selected":""}>${d}</option>`).join("")}</select></label>
 <div class="grid2"><label>Start<input type="time" name="start" value="${l.start}" required></label><label>Slut<input type="time" name="end" value="${l.end}" required></label></div>
 <label>Sal / plats<input name="room" value="${esc(l.room||"")}"></label>
 <div class="row"><button class="btn pri grow">Spara</button>${l.id?`<button class="btn danger" value="del">Ta bort</button>`:""}<button type="button" class="btn" data-close>Avbryt</button></div>`,(fd,sub)=>{
  if(sub&&sub.value==="del"){S.lessons=S.lessons.filter(x=>x.id!==l.id);return}
  const o={id:l.id||uid(),kind:fd.get("kind"),subjectId:fd.get("subjectId"),title:fd.get("title").trim(),day:+fd.get("day"),start:fd.get("start"),end:fd.get("end"),room:fd.get("room").trim()};
  if(o.end<=o.start){alert("Sluttiden måste vara efter starttiden.");return false}
  const i=S.lessons.findIndex(x=>x.id===o.id);i<0?S.lessons.push(o):S.lessons[i]=o;schemaDay=o.day;
 });
}
function subjectsForm(){
 openDlg(`<h2>Ämnen</h2>${S.subjects.map(s=>`<div class="row"><span class="dot" style="background:${s.color}"></span><span class="grow">${esc(s.name)}</span><button type="button" class="btn sm danger" data-delsub="${s.id}">Ta bort</button></div>`).join("")}
 <label>Nytt ämne<input name="name" placeholder="t.ex. Matematik"></label>
 <div class="row"><button class="btn pri grow">Lägg till</button><button type="button" class="btn" data-close>Stäng</button></div>`,fd=>{
  const n=fd.get("name").trim();if(n)S.subjects.push({id:uid(),name:n,color:COLORS[S.subjects.length%COLORS.length]});
 });
 $$("[data-delsub]",dlg).forEach(b=>b.onclick=()=>{if(confirm("Ta bort ämnet? Kopplade pass och uppgifter blir 'Allmänt'.")){S.subjects=S.subjects.filter(s=>s.id!==b.dataset.delsub);dlg.close();render()}});
}

/* ---------- Uppgifter ---------- */
let filter="open";
function vUppgifter(){
 let ts=S.tasks.slice().sort((a,b)=>(a.due+(a.time||"")).localeCompare(b.due+(b.time||"")));
 if(filter==="open")ts=ts.filter(t=>!t.done);else if(filter==="done")ts=ts.filter(t=>t.done);else ts=ts.filter(t=>!t.done&&t.type===filter);
 return `<div><h1>Uppgifter & prov</h1><p class="sub">Läxor, inlämningar, prov och jobb på ett ställe.</p></div>
 <div class="days">${[["open","Aktiva"],["prov","Prov"],["inlamning","Inlämning"],["jobb","Jobb"],["done","Klara"]].map(([k,n])=>`<button class="btn sm${filter===k?" on":""}" data-filter="${k}">${n}</button>`).join("")}</div>
 <section class="card">${ts.length?ts.map(taskRow).join(""):`<div class="empty">Inget här än. Tryck på + för att lägga till.</div>`}</section>
 <button class="fab" data-add="task" aria-label="Ny uppgift">+</button>`;
}
function taskForm(t){
 t=t||{type:"lexa",due:todayIso(),subjectId:S.subjects[0]?.id,remind:"60"};
 openDlg(`<h2>${t.id?"Ändra":"Ny"} uppgift</h2>
 <label>Titel<input name="title" value="${esc(t.title||"")}" required placeholder="t.ex. Biologiprov: ekologi"></label>
 <div class="grid2"><label>Typ<select name="type">${Object.entries(TYPES).map(([k,n])=>`<option value="${k}"${k===t.type?" selected":""}>${n}</option>`).join("")}</select></label>
 <label>Ämne<select name="subjectId">${subjOptions(t.subjectId)}</select></label></div>
 <div class="grid2"><label>Datum<input type="date" name="due" value="${t.due}" required></label><label>Tid (valfritt)<input type="time" name="time" value="${t.time||""}"></label></div>
 <label>Påminn mig<select name="remind">${[["","Ingen"],["0","När det är dags"],["30","30 min innan"],["60","1 timme innan"],["1440","1 dag innan"]].map(([v,n])=>`<option value="${v}"${String(t.remind??"")===v?" selected":""}>${n}</option>`).join("")}</select></label>
 <label>Ämnesområden (för studieplan/test, kommaseparerade)<input name="topics" value="${esc((t.topics||[]).join(", "))}" placeholder="Ekologi, Cellandning"></label>
 <label>Anteckning<textarea name="note" rows="2">${esc(t.note||"")}</textarea></label>
 <div class="row"><button class="btn pri grow">Spara</button>${t.id?`<button class="btn danger" value="del">Ta bort</button>`:""}<button type="button" class="btn" data-close>Avbryt</button></div>`,(fd,sub)=>{
  if(sub&&sub.value==="del"){S.tasks=S.tasks.filter(x=>x.id!==t.id);return}
  const topics=fd.get("topics").split(",").map(x=>x.trim()).filter(Boolean);
  const o=Object.assign({},t,{id:t.id||uid(),title:fd.get("title").trim(),type:fd.get("type"),subjectId:fd.get("subjectId"),due:fd.get("due"),time:fd.get("time"),remind:fd.get("remind"),topics,note:fd.get("note").trim(),done:!!t.done});
  if(o.due!==t.due){delete S.notified[o.id]}
  const i=S.tasks.findIndex(x=>x.id===o.id);i<0?S.tasks.push(o):S.tasks[i]=o;
  if(o.type==="prov"&&o.topics.length&&!(o.plan||[]).length)o.plan=makePlan(o);
 });
}

/* ---------- Studieplan ---------- */
function makePlan(t){
 const td=todayIso(),n=daysBetween(td,t.due);
 if(n<1||!t.topics.length)return [];
 const days=[];for(let i=0;i<n;i++){const d=fromIso(td);d.setDate(d.getDate()+i);days.push(iso(d))}
 const study=days.length>1?days.slice(0,-1):days,steps=[];
 study.forEach((d,i)=>{const tp=t.topics[i%t.topics.length];steps.push({date:d,text:`Plugga ${tp} och gör ett test`,done:false})});
 if(days.length>1)steps.push({date:days[days.length-1],text:"Repetition av allt du missat + snabbtest",done:false});
 return steps;
}
function vPlan(){
 const provs=S.tasks.filter(t=>t.type==="prov"&&!t.done&&t.due>=todayIso()).sort((a,b)=>a.due.localeCompare(b.due));
 if(!provs.length)return `<div><h1>Studieplan</h1></div><section class="card"><div class="empty">Lägg in ett prov under Uppgifter, med ämnesområden, så bygger SkolSmart en plan dag för dag.</div></section><button class="fab" data-add="task" aria-label="Nytt prov">+</button>`;
 return `<div><h1>Studieplan</h1><p class="sub">Dag för dag fram till varje prov.</p></div>`+provs.map(t=>{
  const plan=t.plan||[],dn=plan.filter(p=>p.done).length,s=subj(t.subjectId);
  return `<section class="card"><div class="row between"><div><h2>${esc(t.title)}</h2><div class="sub">${esc(s.name)} · ${fmtDate(t.due)} · ${daysBetween(todayIso(),t.due)} dagar kvar</div></div><button class="btn sm" data-replan="${t.id}">Bygg om</button></div>
  ${plan.length?`<div class="bar"><div style="width:${dn/plan.length*100}%"></div></div>`+plan.map((p,i)=>`<div class="item${p.done?" done":""}"><button class="chk${p.done?" on":""}" data-step="${t.id}:${i}">${p.done?"✓":""}</button><div class="grow"><div class="title">${esc(p.text)}</div><div class="sub">${fmtDate(p.date)}</div></div></div>`).join(""):`<div class="empty">Ingen plan än. Ange ämnesområden i provet (tryck på det under Uppgifter) och tryck Bygg om.</div>`}
  <button class="btn" data-testfor="${t.id}">🎯 Testa mig inför provet</button></section>`}).join("");
}

/* ---------- Adaptiva tester ---------- */
let T=null;
function skill(sid,topic){const k=sid+"|"+topic;return S.skill[k]||(S.skill[k]={lvl:1.5,n:0,ok:0,last:null})}
function pickNext(pool,asked){
 const cand=pool.filter(q=>!asked.includes(q.id));if(!cand.length)return null;
 const scored=cand.map(q=>{const sk=skill(q.subjectId,q.topic);const missed=sk.last===false?-.4:0;const fresh=sk.n===0?-.3:0;return {q,s:Math.abs(q.level-sk.lvl)+missed+fresh+Math.random()*.6}});
 scored.sort((a,b)=>a.s-b.s);return scored[0].q;
}
function vTest(){
 if(T&&T.done)return testResult();
 if(T)return testAsk();
 const cnt=id=>S.questions.filter(q=>q.subjectId===id).length;
 const rows=S.subjects.filter(s=>cnt(s.id)).map(s=>{
  const topics=[...new Set(S.questions.filter(q=>q.subjectId===s.id).map(q=>q.topic))];
  return `<div class="item"><span class="dot" style="background:${s.color}"></span><div class="grow"><div class="title">${esc(s.name)}</div>${topics.map(tp=>{const sk=skill(s.id,tp);const p=sk.n?Math.round(sk.ok/sk.n*100):null;return `<div class="meter"><span>${esc(tp)}</span><div class="bar"><div style="width:${p??0}%"></div></div><span class="sub">${p===null?"–":p+"%"}</span></div>`}).join("")}</div><button class="btn sm pri" data-starttest="${s.id}">Starta</button></div>`}).join("");
 return `<div><h1>Tester</h1><p class="sub">Frågorna anpassas efter var du ligger: klarar du en fråga får du svårare, missar du får du lättare och det du missat kommer tillbaka.</p></div>
 <section class="card"><h2>Din nivå per ämnesområde</h2>${rows||`<div class="empty">Inga frågor än. Lägg till egna nedan.</div>`}</section>
 <div class="row"><button class="btn pri grow" data-addq>+ Lägg till frågor</button></div>`;
}
function startTest(sid,topics){
 const pool=S.questions.filter(q=>q.subjectId===sid&&(!topics||!topics.length||topics.includes(q.topic)));
 if(!pool.length){alert("Inga frågor för det här ämnet/området än. Lägg till frågor först.");return}
 T={sid,pool,asked:[],n:0,max:Math.min(10,pool.length),ok:0,miss:[],cur:null,ans:null,done:false};
 T.cur=pickNext(pool,T.asked);T.asked.push(T.cur.id);render();
}
function testAsk(){
 const q=T.cur,sk=skill(q.subjectId,q.topic);
 if(!T.opts)T.opts=shuf([q.a,...q.wrong]);
 const lvl=["Lätt","Medel","Svår"][q.level-1]||"Medel";
 return `<div class="row between"><span class="sub">Fråga ${T.n+1} av ${T.max}</span><span class="chip">${esc(q.topic)} · ${lvl}</span></div>
 <div class="bar"><div style="width:${T.n/T.max*100}%"></div></div>
 <section class="card"><div class="q">${esc(q.q)}</div><div class="opts">${T.opts.map(o=>`<button class="btn opt${T.ans!==null?(o===q.a?" ok":o===T.ans?" no":""):""}" data-ans="${esc(o)}"${T.ans!==null?" disabled":""}>${esc(o)}</button>`).join("")}</div>
 ${T.ans!==null?`<div class="sub"><b>${T.ans===q.a?"Rätt!":"Fel."}</b> ${esc(q.exp||"")}</div><button class="btn pri" data-next>${T.n+1>=T.max?"Se resultat":"Nästa"}</button>`:""}</section>
 <button class="btn sm" data-quit>Avsluta test</button>`;
}
function testResult(){
 const pct=T.max?Math.round(T.ok/T.max*100):0;
 return `<div><h1>Resultat</h1></div><section class="card"><div class="big">${T.ok}/${T.max}</div><div>${pct}% rätt. ${pct>=85?"Starkt jobbat.":pct>=60?"Bra, men träna på det du missade.":"Repetera begreppen och kör igen."}</div>
 ${T.miss.length?`<h2>Det här missade du</h2>`+T.miss.map(q=>`<div class="item"><div><div class="title">${esc(q.q)}</div><div class="sub">Rätt svar: ${esc(q.a)}. ${esc(q.exp||"")}</div></div></div>`).join(""):""}
 <div class="row"><button class="btn pri grow" data-again>Ett test till</button><button class="btn" data-quit>Klar</button></div></section>`;
}
function questionForm(){
 openDlg(`<h2>Lägg till frågor</h2>
 <div class="grid2"><label>Ämne<select name="subjectId">${subjOptions()}</select></label><label>Område<input name="topic" required placeholder="t.ex. Ekologi"></label></div>
 <label>Svårighet<select name="level"><option value="1">Lätt</option><option value="2" selected>Medel</option><option value="3">Svår</option></select></label>
 <label>Frågor, en per rad: fråga | rätt svar | fel1 | fel2 | fel3 | förklaring (valfri)<textarea name="lines" rows="6" required placeholder="Vad är atomnummer? | Antal protoner | Antal neutroner | Antal skal | Masstalet"></textarea></label>
 <div class="row"><button class="btn pri grow">Lägg till</button><button type="button" class="btn" data-close>Avbryt</button></div>`,fd=>{
  let added=0;
  fd.get("lines").split("\n").forEach(line=>{
   const p=line.split("|").map(x=>x.trim());
   if(p.length>=3&&p[0]&&p[1]){S.questions.push({id:uid(),subjectId:fd.get("subjectId"),topic:fd.get("topic").trim(),level:+fd.get("level"),q:p[0],a:p[1],wrong:p.slice(2,5).filter(Boolean),exp:p[5]||""});added++}
  });
  if(!added){alert("Ingen fråga hittades. Ange minst fråga | rätt svar | ett fel svar.");return false}
 });
}

/* ---------- settings + notifications ---------- */
function settingsForm(){
 const supported="Notification" in window;
 openDlg(`<h2>Inställningar</h2>
 <label>Påminnelser<select name="notify"${supported?"":" disabled"}><option value="0"${S.settings.notify?"":" selected"}>Av</option><option value="1"${S.settings.notify?" selected":""}>På</option></select></label>
 <p class="sub">${supported?"Påminnelser visas när appen är öppen eller körs i bakgrunden. Riktiga push-notiser när appen är helt stängd kräver en server och kommer i en senare version.":"Din webbläsare stöder inte notiser."}</p>
 <div class="row"><button class="btn pri grow">Spara</button><button type="button" class="btn danger" data-wipe>Rensa all data</button></div>`,async fd=>{
  const on=fd.get("notify")==="1";
  if(on&&Notification.permission!=="granted"){const r=await Notification.requestPermission();S.settings.notify=r==="granted"}else S.settings.notify=on;
  save();
 });
 $("[data-wipe]",dlg).onclick=()=>{if(confirm("Ta bort ALL data?")){localStorage.removeItem(KEY);location.reload()}};
}
async function checkReminders(){
 if(!S.settings.notify||!("Notification" in window)||Notification.permission!=="granted")return;
 const now=Date.now();let changed=false;
 for(const t of S.tasks){
  if(t.done||t.remind===""||t.remind==null)continue;
  const at=new Date(t.due+"T"+(t.time||"08:00")+":00").getTime()-(+t.remind)*60000;
  if(now>=at&&now<at+864e5&&!S.notified[t.id]){
   S.notified[t.id]=now;changed=true;
   const body=`${TYPES[t.type]} · ${fmtDate(t.due)}${t.time?" kl "+t.time:""}`;
   try{const reg=await navigator.serviceWorker?.getRegistration();reg?reg.showNotification(t.title,{body,icon:"icon.svg",tag:t.id}):new Notification(t.title,{body})}catch(e){}
  }
 }
 if(changed)save();
}

/* ---------- event binding ---------- */
function bind(v){
 $$("[data-tog]").forEach(b=>b.onclick=()=>{const t=S.tasks.find(x=>x.id===b.dataset.tog);t.done=!t.done;render()});
 $$("[data-edit]").forEach(b=>b.onclick=()=>taskForm(S.tasks.find(x=>x.id===b.dataset.edit)));
 $$("[data-editl]").forEach(b=>b.onclick=()=>lessonForm(S.lessons.find(x=>x.id===b.dataset.editl)));
 $$("[data-step]").forEach(b=>b.onclick=()=>{const[id,i]=b.dataset.step.split(":");const p=S.tasks.find(x=>x.id===id).plan[+i];p.done=!p.done;render()});
 $$("[data-add]").forEach(b=>b.onclick=()=>b.dataset.add==="task"?taskForm():lessonForm());
 $$("[data-day]").forEach(b=>b.onclick=()=>{schemaDay=+b.dataset.day;render()});
 $$("[data-filter]").forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render()});
 $$("[data-subjects]").forEach(b=>b.onclick=subjectsForm);
 $$("[data-replan]").forEach(b=>b.onclick=()=>{const t=S.tasks.find(x=>x.id===b.dataset.replan);if(!t.topics?.length){taskForm(t);return}t.plan=makePlan(t);render()});
 $$("[data-testfor]").forEach(b=>b.onclick=()=>{const t=S.tasks.find(x=>x.id===b.dataset.testfor);location.hash="test";startTest(t.subjectId,t.topics)});
 $$("[data-starttest]").forEach(b=>b.onclick=()=>startTest(b.dataset.starttest));
 $$("[data-addq]").forEach(b=>b.onclick=questionForm);
 $$("[data-ans]").forEach(b=>b.onclick=()=>{
  const q=T.cur,right=b.dataset.ans===q.a,sk=skill(q.subjectId,q.topic);
  T.ans=b.dataset.ans;sk.n++;sk.last=right;
  if(right){sk.ok++;T.ok++;sk.lvl=Math.min(3,sk.lvl+.4)}else{sk.lvl=Math.max(1,sk.lvl-.5);T.miss.push(q)}
  render();
 });
 $$("[data-next]").forEach(b=>b.onclick=()=>{
  T.n++;
  if(T.n>=T.max){T.done=true}else{T.cur=pickNext(T.pool,T.asked);if(!T.cur){T.max=T.n;T.done=true}else{T.asked.push(T.cur.id);T.ans=null;T.opts=null}}
  render();
 });
 $$("[data-again]").forEach(b=>b.onclick=()=>{const s=T.sid;T=null;startTest(s)});
 $$("[data-quit]").forEach(b=>b.onclick=()=>{T=null;render()});
}
$("#btn-settings").onclick=settingsForm;

if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
render();
checkReminders();setInterval(checkReminders,30000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden){render();checkReminders()}});
