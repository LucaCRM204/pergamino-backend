const map = (() => {
  const env = process.env.LEAD_API_KEYS || "";
  const dict = {};
  env.split(";").map(s=>s.trim()).filter(Boolean).forEach(p=>{
    const [provider,key] = p.split(":");
    if(provider && key) dict[key] = provider;
  });
  return dict;
})();

module.exports = function intakeAuth(req,res,next){
  const key = req.headers["x-api-key"] || "";
  const provider = map[key];
  if(!provider) return res.status(401).json({ error: "API key inválida" });
  req.provider = provider;
  next();
};
