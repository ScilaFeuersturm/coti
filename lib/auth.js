// Autenticación: contraseñas con scrypt (crypto nativo) y sesiones opacas.
// En la base solo se guarda el hash SHA-256 del token, nunca el token en sí.

const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;

const SESSION_COOKIE = "coti_session";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 días

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p)
  });
  return crypto.timingSafeEqual(expected, actual);
}

// Hash "señuelo" para que un email inexistente tarde lo mismo que uno real.
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(crypto.randomBytes(12).toString("hex"));
  return dummyHashPromise;
}

function newSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseCookies(header) {
  const out = {};
  String(header || "")
    .split(";")
    .forEach((part) => {
      const idx = part.indexOf("=");
      if (idx === -1) return;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) {
        try {
          out[k] = decodeURIComponent(v);
        } catch {
          out[k] = v;
        }
      }
    });
  return out;
}

function sessionCookie(token, { secure }) {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

function clearSessionCookie({ secure }) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

// Devuelve { token, viaCookie } desde la cookie o desde "Authorization: Bearer" (app móvil).
function extractToken(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return { token: auth.slice(7).trim(), viaCookie: false };
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE]) return { token: cookies[SESSION_COOKIE], viaCookie: true };
  return { token: null, viaCookie: false };
}

// Limitador simple en memoria para intentos de login/registro.
class RateLimiter {
  constructor({ max, windowMs }) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }
  hit(key) {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || now - entry.start > this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }
  reset(key) {
    this.hits.delete(key);
  }
}

module.exports = {
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  dummyHash,
  newSessionToken,
  hashToken,
  sessionCookie,
  clearSessionCookie,
  extractToken,
  RateLimiter
};
