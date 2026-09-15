// integrations/zapier/metaWebhookRelay.js
const express = require("express");

const { META_VERIFY_TOKEN, ZAPIER_WEBHOOK_URL, SHARED_SECRET } = process.env;
if (!ZAPIER_WEBHOOK_URL) throw new Error("ZAPIER_WEBHOOK_URL is required");

const router = express.Router();
router.use(express.json({ limit: "1mb" }));

// GET /meta/webhook (verificación Meta)
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// POST /meta/webhook (eventos leadgen)
router.post("/webhook", async (req, res) => {
  try {
    if (req.body?.object !== "page") return res.sendStatus(204);

    const promises = [];
    for (const entry of req.body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== "leadgen") continue;

        const normalized = {
          source: "meta",
          meta: {
            lead_id: change.value?.leadgen_id || change.value?.lead_id,
            form_id: change.value?.form_id,
            page_id: entry.id,
            adgroup_id: change.value?.adgroup_id,
            ad_id: change.value?.ad_id,
            created_time: change.value?.created_time,
          },
          created_at: new Date().toISOString(),
        };

        promises.push(
          fetch(ZAPIER_WEBHOOK_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(SHARED_SECRET ? { "X-Shared-Secret": SHARED_SECRET } : {}),
            },
            body: JSON.stringify(normalized),
          })
        );
      }
    }

    await Promise.all(promises);
    return res.sendStatus(200);
  } catch (e) {
    console.error("meta/webhook error:", e.message);
    return res.sendStatus(500);
  }
});

module.exports = router;
