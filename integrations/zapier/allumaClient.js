import "dotenv/config";
const { ALLUMA_API_BASE, ALLUMA_API_KEY } = process.env;
if (!ALLUMA_API_BASE) throw new Error("ALLUMA_API_BASE is required");
if (!ALLUMA_API_KEY) throw new Error("ALLUMA_API_KEY is required");
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function mapToAlluma(input){
  return {
    first_name: input.first_name || null,
    last_name: input.last_name || null,
    full_name: input.full_name || null,
    email: input.email || null,
    phone: input.phone || null,
    message: input.message || null,
    consent: input.consent ?? true,
    campaign: input.campaign || null,
    source: input.source || "zapier",
    utm: input.utm || null,
    tags: input.tags || [],
    meta: input.meta || null,
    created_at: input.created_at || new Date().toISOString(),
  };
}
export async function createLeadInAlluma(raw){
  const payload = mapToAlluma(raw);
  const url = `${ALLUMA_API_BASE.replace(/\/+$/,"")}/v1/leads`;
  let attempt=0,lastErr; const maxAttempts=4;
  while(attempt<maxAttempts){
    attempt++;
    try{
      const res = await fetch(url,{ method:"POST", headers:{ "Authorization":`Bearer ${ALLUMA_API_KEY}`, "Content-Type":"application/json" }, body:JSON.stringify(payload)});
      if(res.ok) return res.json().catch(()=>({}));
      const text = await res.text().catch(()=> "");
      if(res.status===429 || res.status>=500) throw new Error(`Alluma ${res.status}: ${text}`);
      return Promise.reject(new Error(`Alluma error ${res.status}: ${text}`));
    }catch(err){ lastErr=err; const delay=500*(2**(attempt-1)); if(attempt<maxAttempts) await sleep(delay); }
  }
  throw lastErr || new Error("Failed to call Alluma");
}
