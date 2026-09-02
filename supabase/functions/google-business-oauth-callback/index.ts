import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const html=(s:string)=>new Response(s,{headers:{"Content-Type":"text/html; charset=utf-8"}});
const b64=(a:Uint8Array)=>{let s="";for(const b of a)s+=String.fromCharCode(b);return btoa(s)};
const unb64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function aesKey(){const raw=Deno.env.get("GOOGLE_BUSINESS_TOKEN_KEY");if(!raw)throw new Error("GOOGLE_BUSINESS_TOKEN_KEY missing");let bytes:Uint8Array;try{bytes=unb64(raw)}catch{bytes=new TextEncoder().encode(raw)};if(bytes.length!==32)bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));return crypto.subtle.importKey("raw",bytes,{name:"AES-GCM"},false,["encrypt","decrypt"])}
async function enc(v:string){const iv=crypto.getRandomValues(new Uint8Array(12));const out=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},await aesKey(),new TextEncoder().encode(v)));return `${b64(iv)}.${b64(out)}`}

Deno.serve(async(req)=>{
 try{
  const u=new URL(req.url), state=u.searchParams.get("state"), code=u.searchParams.get("code"), oauthError=u.searchParams.get("error");
  if(!state) return html("Invalid Google authorization state.");
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:st}=await admin.from("google_business_oauth_states").select("*").eq("state",state).gt("expires_at",new Date().toISOString()).maybeSingle();
  if(!st) return html("This Google authorization link expired. Return to HotelCare and try again.");
  await admin.from("google_business_oauth_states").delete().eq("state",state);
  const dest=new URL(st.return_url);
  if(oauthError){dest.searchParams.set("google_business","error");dest.searchParams.set("reason",oauthError);return Response.redirect(dest.toString(),302)}
  if(!code) return html("Google did not return an authorization code.");
  const clientId=Deno.env.get("GOOGLE_BUSINESS_CLIENT_ID"), secret=Deno.env.get("GOOGLE_BUSINESS_CLIENT_SECRET");
  if(!clientId||!secret||!Deno.env.get("GOOGLE_BUSINESS_TOKEN_KEY")) return html("HotelCare Google Business credentials are not configured.");
  const redirectUri=`${Deno.env.get("SUPABASE_URL")}/functions/v1/google-business-oauth-callback`;
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:clientId,client_secret:secret,redirect_uri:redirectUri,grant_type:"authorization_code"})});
  if(!r.ok){console.error("Google token exchange",r.status,(await r.text()).slice(0,300));dest.searchParams.set("google_business","error");dest.searchParams.set("reason","token_exchange");return Response.redirect(dest.toString(),302)}
  const tok=await r.json();
  const accountName=`oauth/${st.user_id}`;
  const {data:existing}=await admin.from("google_business_connections").select("id,refresh_token_ciphertext").eq("organization_id",st.organization_id).eq("google_account_name",accountName).maybeSingle();
  const refreshCipher=tok.refresh_token?await enc(String(tok.refresh_token)):existing?.refresh_token_ciphertext;
  if(!refreshCipher){dest.searchParams.set("google_business","error");dest.searchParams.set("reason","no_refresh_token");return Response.redirect(dest.toString(),302)}
  const accessCipher=tok.access_token?await enc(String(tok.access_token)):null;
  const expiresAt=tok.expires_in?new Date(Date.now()+Number(tok.expires_in)*1000).toISOString():null;
  const row={organization_id:st.organization_id,connected_by:st.user_id,google_account_name:accountName,google_account_display_name:"Google Business Profile",refresh_token_ciphertext:refreshCipher,access_token_ciphertext:accessCipher,access_token_expires_at:expiresAt,scopes:String(tok.scope||"https://www.googleapis.com/auth/business.manage").split(" ").filter(Boolean),status:"active",last_error:null,updated_at:new Date().toISOString()};
  const {error:saveErr}=await admin.from("google_business_connections").upsert(row,{onConflict:"organization_id,google_account_name"});
  if(saveErr)throw saveErr;
  dest.searchParams.set("google_business","connected");
  return Response.redirect(dest.toString(),302);
 }catch(e){console.error(e);return html("Google authorization could not be completed. Return to HotelCare and try again.")}
});