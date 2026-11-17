import { containsLikelySensitiveData } from "./lowCostAi.ts";
/**
 * Gemini Google Search grounding first for Mira's public-world lookups.
 * Preserve citations only when the provider returns grounding evidence;
 * otherwise use the existing OpenAI web-search fallback.
 */
export async function fetchGeminiFirstWebSearch(url:string,request:RequestInit):Promise<Response>{
  if(typeof request.body!=="string")throw new Error("Expected search JSON body");
  const openaiBody=JSON.parse(request.body);
  const prompt=String(openaiBody.input??"").slice(0,6000);
  const key=Deno.env.get("GEMINI_API_KEY");
  if(key && Deno.env.get("GEMINI_DISABLED")!=="true" &&
     (!containsLikelySensitiveData(prompt) || Deno.env.get("GEMINI_PAID_DATA_PROCESSING_CONFIRMED")==="true")){
    const models=[...new Set([Deno.env.get("GEMINI_MODEL")||"gemini-3.5-flash-lite",
      Deno.env.get("GEMINI_SECONDARY_MODEL")||"gemini-3.5-flash"])];
    for(const model of models){
      try {
        const res=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+
          encodeURIComponent(model)+":generateContent",{
          method:"POST",
          headers:{"Content-Type":"application/json","x-goog-api-key":key},
          signal:AbortSignal.timeout(25_000),
          body:JSON.stringify({
            contents:[{role:"user",parts:[{text:prompt}]}],
            tools:[{google_search:{}}],
            generationConfig:{maxOutputTokens:3000},
          }),
        });
        if(!res.ok){console.warn("Gemini grounded search failed",res.status);continue;}
        const output=await res.json();
        const candidate=output?.candidates?.[0];
        const answer=String((candidate?.content?.parts??[]).map((p:any)=>p.text??"").join("")).trim();
        const sources=(candidate?.groundingMetadata?.groundingChunks??[])
          .map((chunk:any)=>chunk?.web)
          .filter((w:any)=>typeof w?.uri==="string"&&/^https:\/\//i.test(w.uri))
          .slice(0,5);
        // No unsourced, guessed public listings are allowed from this path.
        if(!answer||!sources.length)continue;
        const citations=sources.map((x:any)=>"- "+String(x.title||"Source").slice(0,100)+": "+x.uri).join("\n");
        const text=answer+"\n\nSources:\n"+citations;
        return new Response(JSON.stringify({
          status:"completed",model,
          output_text:text,
          output:[{type:"message",content:[{type:"output_text",text}]}],
          usage:{input_tokens:Number(output?.usageMetadata?.promptTokenCount??0),
            output_tokens:Number(output?.usageMetadata?.candidatesTokenCount??0)},
        }),{status:200,headers:{"Content-Type":"application/json","x-hotelcare-ai-provider":"gemini"}});
      }catch{console.warn("Gemini grounded search temporarily unavailable");}
    }
  }
  if(!Deno.env.get("OPENAI_API_KEY")||Deno.env.get("GEMINI_OPENAI_FALLBACK_DISABLED")==="true")
    return new Response(JSON.stringify({error:"Both grounded-search providers unavailable"}),{status:503});
  return fetch(url,request);
}
