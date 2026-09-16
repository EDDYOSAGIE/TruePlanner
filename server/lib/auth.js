const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'checkin_session';
const TOKEN_EXPIRY = '30d';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set — refusing to issue insecure sessions.');
  }
  return secret;
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function issueToken(userId) {
  return jwt.sign({ userId }, getSecret(), { expiresIn: TOKEN_EXPIRY });
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// Express middleware — attaches req.userId if the session cookie is valid,
// otherwise responds 401. Apply this to every route that touches user data.
function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  try {
    const payload = jwt.verify(token, getSecret());
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid' });
  }
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  issueToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth
};
