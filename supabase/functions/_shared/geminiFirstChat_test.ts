import { chatGeminiFirst } from "./geminiFirstChat.ts";
Deno.test("valid Gemini tool result bypasses OpenAI", async()=>{
  const old = globalThis.fetch, key=Deno.env.get("GEMINI_API_KEY");
  Deno.env.set("GEMINI_API_KEY","example-not-real");
  let openai=0,gemini=0;
  globalThis.fetch=(async (url:string)=>{
    if(String(url).includes("api.openai.com")){openai++;throw new Error("OpenAI should not run");}
    gemini++;
    return new Response(JSON.stringify({model:"gemini-3.5-flash-lite",choices:[{message:{tool_calls:[
      {function:{name:"send_data",arguments:'{"value":1}'}}]}}]}),{status:200});
  }) as typeof fetch;
  try {
    const res=await chatGeminiFirst({model:"gpt-4o-mini",messages:[],tool_choice:{type:"function",function:{name:"send_data"}}});
    if(!res.ok||openai!==0||gemini!==1||res.headers.get("x-hotelcare-ai-provider")!=="gemini")
      throw new Error("Gemini-first ordering failed");
  } finally {
    globalThis.fetch=old;
    key===undefined?Deno.env.delete("GEMINI_API_KEY"):Deno.env.set("GEMINI_API_KEY",key);
  }
});
Deno.test("invalid Gemini function response is rejected before fallback",async()=>{
  const old=globalThis.fetch,geminiKey=Deno.env.get("GEMINI_API_KEY"),
    openaiKey=Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("GEMINI_API_KEY","test");
  Deno.env.set("OPENAI_API_KEY","test");
  let gemini=0,openai=0;
  globalThis.fetch=(async(url:string)=>{
    if(String(url).includes("generativelanguage")) {
      gemini++;return new Response(JSON.stringify({choices:[{message:{content:"not a tool"}}]}),{status:200});
    }
    openai++;return new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:"send_data",arguments:"{}"}}]}}]}),{status:200});
  }) as typeof fetch;
  try {
    const res=await chatGeminiFirst({model:"gpt-4o-mini",messages:[],tool_choice:{type:"function",function:{name:"send_data"}}});
    if(!res.ok||openai!==1||gemini<1)throw new Error("Missing expected fallback");
  } finally {
    globalThis.fetch=old;
    geminiKey===undefined?Deno.env.delete("GEMINI_API_KEY"):Deno.env.set("GEMINI_API_KEY",geminiKey);
    openaiKey===undefined?Deno.env.delete("OPENAI_API_KEY"):Deno.env.set("OPENAI_API_KEY",openaiKey);
  }
});
