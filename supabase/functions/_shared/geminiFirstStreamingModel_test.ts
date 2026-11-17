import {geminiFirstStreamingModel} from "./geminiFirstStreamingModel.ts";
Deno.test("Gemini primary answers without using OpenAI",async()=>{
  const gKey=Deno.env.get("GEMINI_API_KEY"),oKey=Deno.env.get("OPENAI_API_KEY");
  const paid=Deno.env.get("GEMINI_PAID_DATA_PROCESSING_CONFIRMED");
  Deno.env.set("GEMINI_API_KEY","test");Deno.env.set("OPENAI_API_KEY","test");
  Deno.env.set("GEMINI_PAID_DATA_PROCESSING_CONFIRMED","true");
  let openCalls=0;
  const mk=(name:string,handler:()=>Promise<any>)=>({specificationVersion:"v3",modelId:name,provider:name,
    doGenerate:handler,doStream:handler});
  const model=geminiFirstStreamingModel([
    mk("gemini",async()=>({text:"gemini success"}))],
    mk("openai",async()=>{openCalls++;return {text:"openai"};}),{containsSensitiveData:true});
  try {
    const result=await model.doGenerate({});
    if(result.text!=="gemini success"||openCalls!==0)throw new Error("Provider priority not respected");
  }finally{
    gKey===undefined?Deno.env.delete("GEMINI_API_KEY"):Deno.env.set("GEMINI_API_KEY",gKey);
    oKey===undefined?Deno.env.delete("OPENAI_API_KEY"):Deno.env.set("OPENAI_API_KEY",oKey);
    paid===undefined?Deno.env.delete("GEMINI_PAID_DATA_PROCESSING_CONFIRMED"):Deno.env.set("GEMINI_PAID_DATA_PROCESSING_CONFIRMED",paid);
  }
});
Deno.test("Provider failure falls back in order",async()=>{
  const gKey=Deno.env.get("GEMINI_API_KEY"),oKey=Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("GEMINI_API_KEY","test");Deno.env.set("OPENAI_API_KEY","test");
  let hits:string[]=[];
  const fake=(id:string,ok:boolean)=>({specificationVersion:"v3",modelId:id,
    doGenerate:async()=>{hits.push(id);if(!ok)throw Error("unavailable");return {ok:true};},
    doStream:async()=>{hits.push(id);if(!ok)throw Error("unavailable");return {
      stream:new ReadableStream({start(c){c.enqueue({type:"text-delta",textDelta:"ok"});c.close();}}),
    };}});
  try{
    const model=geminiFirstStreamingModel([fake("gemini1",false),fake("gemini2",true)],fake("openai",true));
    await model.doStream({});
    if(hits.join(",")!=="gemini1,gemini2")throw Error("OpenAI called before Gemini alternatives");
  }finally{
    gKey===undefined?Deno.env.delete("GEMINI_API_KEY"):Deno.env.set("GEMINI_API_KEY",gKey);
    oKey===undefined?Deno.env.delete("OPENAI_API_KEY"):Deno.env.set("OPENAI_API_KEY",oKey);
  }
});
