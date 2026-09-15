import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  const token =
    req.cookies?.session ||
    (req.headers.authorization || '').replace(/^Bearer\s+/,'') ||
    null;

  if (!token) return res.status(401).json({ error: 'no_token' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}
