/**
 * AI SDK LanguageModelV3 wrapper: Gemini first, OpenAI last.
 * Used for complex multi-step Mira tool sessions and deep analysis.
 *
 * A provider failure before stream output can safely fall back. After content
 * is streamed to the user, switching providers would duplicate or corrupt
 * the conversation, so late errors remain visible (never fabricate a reply).
 */
export function geminiFirstStreamingModel(
  candidates: any[],
  openaiFallback: any,
  options: {containsSensitiveData?:boolean} = {},
): any {
  const paidApproved = Deno.env.get("GEMINI_PAID_DATA_PROCESSING_CONFIRMED") === "true";
  const allowed = Boolean(Deno.env.get("GEMINI_API_KEY")) &&
    Deno.env.get("GEMINI_DISABLED") !== "true" &&
    (!options.containsSensitiveData || paidApproved);
  const preferred = allowed ? candidates : [];
  const chain = [...preferred, ...(Deno.env.get("OPENAI_API_KEY") &&
    Deno.env.get("GEMINI_OPENAI_FALLBACK_DISABLED") !== "true" ? [openaiFallback] : [])];
  if (!chain.length) throw new Error("No approved Gemini or OpenAI model is available");
  const model = chain[0];
  let actualModelId = String(model.modelId);
  async function generate(method: "doGenerate"|"doStream", args: any) {
    let last: unknown;
    for(const candidate of chain) {
      try {
        const output = await candidate[method](args);
        if (method === "doStream") {
          const buffered=await bufferFirstStreamPart(output);
          actualModelId=String(candidate.modelId);
          return buffered;
        }
        actualModelId=String(candidate.modelId);
        return output;
      } catch (e) {
        last = e;
        console.warn("AI model provider failed before output; trying next configured provider");
      }
    }
    throw last instanceof Error ? last : new Error("AI providers unavailable");
  }
  return {
    specificationVersion:model.specificationVersion,
    provider:"hotelcare-gemini-first",
    modelId:model.modelId,
    supportedUrls:model.supportedUrls ?? {},
    get actualModelId(){return actualModelId;},
    doGenerate:(args:any)=>generate("doGenerate",args),
    doStream:(args:any)=>generate("doStream",args),
  };
}

async function bufferFirstStreamPart(result:any):Promise<any>{
  if (!result?.stream?.getReader) throw new Error("Provider produced no stream");
  const reader=result.stream.getReader();
  const prefix:any[]=[];
  for(let n=0;n<8;n++){
    const part=await reader.read();
    if(part.done) {
      if(!prefix.length)throw new Error("Provider produced empty stream");
      break;
    }
    if(part.value?.type==="error") {
      try { await reader.cancel(); } catch { /* ignored */ }
      throw new Error("Provider stream rejected before usable content");
    }
    prefix.push(part.value);
    if(["text-delta","tool-call","reasoning-delta","source"].includes(part.value?.type))break;
  }
  return {...result,stream:new ReadableStream({
    async start(controller){
      try {
        for(const part of prefix)controller.enqueue(part);
        while(true){
          const item=await reader.read();
          if(item.done)break;
          controller.enqueue(item.value);
        }
        controller.close();
      } catch(e){controller.error(e);}
    },
    cancel(reason){return reader.cancel(reason);},
  })};
}
