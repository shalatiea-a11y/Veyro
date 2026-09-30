const MAX_MSGS=14;
const SYSTEM=(ctx)=>`Du är SkolSmart-agenten, en personlig studiecoach för en elev i årskurs 1 på gymnasiets naturvetenskapsprogram i Sverige (Biologi 1, Kemi 1, Fysik 1, Matematik 1, Svenska 1, Engelska 5, Samhällskunskap 1, Idrott och hälsa 1).
Regler:
- Du hjälper BARA med skolan: förklara ämnen, svara på frågor, läs av bilder på blad, läxor, anteckningar och scheman, hjälp med planering, prov, inlämningar och studieteknik. Är något orelaterat, avböj vänligt och styr tillbaka till skolan.
- Svara på samma språk som eleven skriver (svenska eller engelska). Håll gymnasienivå enligt svensk läroplan.
- Vid läxor och uppgifter: förklara steg för steg så eleven förstår, i stället för att bara ge färdiga svar. Ge gärna en liknande övningsfråga.
- Var kortfattad, tydlig och peppande. Använd korta stycken och punktlistor. Hitta inte på fakta; säg om du är osäker.
- Läser du en bild: skriv först kort vad du ser, och fråga om något är oläsligt.
Elevens aktuella data (datum, schema, uppgifter):
${ctx||"(ingen data)"}`;

function bad(res,code,msg){res.status(code).json({error:msg})}

export default async function handler(req,res){
 if(req.method!=="POST")return bad(res,405,"Använd POST");
 const code=process.env.ACCESS_CODE;
 if(code&&req.headers["x-access-code"]!==code)return bad(res,401,"Fel eller saknad åtkomstkod");
 const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
 const msgs=Array.isArray(body.messages)?body.messages.slice(-MAX_MSGS):[];
 if(!msgs.length)return bad(res,400,"Inga meddelanden");
 const ctx=String(body.context||"").slice(0,4000);
 try{
  const useClaude=process.env.PROVIDER==="claude"&&process.env.ANTHROPIC_API_KEY;
  const text=useClaude?await claude(msgs,ctx):await gemini(msgs,ctx);
  res.status(200).json({text});
 }catch(e){
  bad(res,502,e.message||"AI-anropet misslyckades");
 }
}

async function gemini(msgs,ctx){
 const key=process.env.GEMINI_API_KEY;
 if(!key)throw new Error("GEMINI_API_KEY saknas på servern");
 const model=process.env.GEMINI_MODEL||"gemini-2.5-flash";
 const contents=msgs.map(m=>({role:m.role==="assistant"?"model":"user",parts:[{text:String(m.text||"")}].concat((m.images||[]).map(i=>({inlineData:{mimeType:i.mime,data:i.data}})))}));
 const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:"POST",headers:{"content-type":"application/json","x-goog-api-key":key},body:JSON.stringify({systemInstruction:{parts:[{text:SYSTEM(ctx)}]},contents})});
 const j=await r.json();
 if(!r.ok)throw new Error(j.error?.message||"Gemini-fel "+r.status);
 const t=(j.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("").trim();
 if(!t)throw new Error("Tomt svar från AI:n");
 return t;
}

async function claude(msgs,ctx){
 const model=process.env.CLAUDE_MODEL||"claude-haiku-4-5-20251001";
 const messages=msgs.map(m=>({role:m.role==="assistant"?"assistant":"user",content:[...(m.images||[]).map(i=>({type:"image",source:{type:"base64",media_type:i.mime,data:i.data}})),{type:"text",text:String(m.text||"(bild)")}]}));
 const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"content-type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},body:JSON.stringify({model,max_tokens:1200,system:SYSTEM(ctx),messages})});
 const j=await r.json();
 if(!r.ok)throw new Error(j.error?.message||"Claude-fel "+r.status);
 return (j.content||[]).map(p=>p.text||"").join("").trim();
}
