import "dotenv/config";
import express from "express";
import { createLeadInAlluma } from "./allumaClient.js";
const { PORT = 3001, SHARED_SECRET } = process.env;
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req,res,next)=>{ if(SHARED_SECRET){ const got=req.header("X-Shared-Secret"); if(got!==SHARED_SECRET) return res.status(401).json({error:"invalid shared secret"});} next(); });
app.post("/zap/catch", async (req,res)=>{ try{ const lead=req.body||{}; const result=await createLeadInAlluma(lead); return res.status(201).json({ ok:true, alluma: result}); } catch(e){ console.error("zap/catch error:", e.message); return res.status(500).json({ ok:false, error:e.message}); }});
app.listen(PORT, ()=>{ console.log(`[zap→alluma test] listening on :${PORT}`); });
