import "dotenv/config";
const { ZAPIER_WEBHOOK_URL, SHARED_SECRET } = process.env;
if (!ZAPIER_WEBHOOK_URL) { throw new Error("ZAPIER_WEBHOOK_URL is required"); }
function normalizeLead(input) {
  const fullName = input.full_name || [input.first_name, input.last_name].filter(Boolean).join(" ").trim() || input.name;
  return {
    first_name: input.first_name || null,
    last_name: input.last_name || null,
    full_name: fullName || null,
    email: input.email || null,
    phone: input.phone || null,
    message: input.message || null,
    source: input.source || "bot",
    campaign: input.campaign || null,
    utm: input.utm || null,
    consent: input.consent ?? true,
    tags: input.tags || [],
    created_at: input.created_at || new Date().toISOString(),
    meta: input.meta || null,
    raw: input
  };
}
export async function sendLeadToZapier(lead) {
  const payload = normalizeLead(lead);
  const res = await fetch(ZAPIER_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(SHARED_SECRET ? { "X-Shared-Secret": SHARED_SECRET } : {}) },
    body: JSON.stringify(payload)
  });
  if (!res.ok) { const text = await res.text().catch(() => ""); throw new Error(`Zapier webhook failed: ${res.status} ${text}`); }
  return res.json().catch(() => ({}));
}
