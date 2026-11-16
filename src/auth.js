// Autenticación con Web Crypto (funciona igual en Cloudflare Workers y en Node 22).
// Contraseñas: PBKDF2-SHA256 con sal aleatoria. Sesiones: token opaco; en la base
// solo se guarda su hash SHA-256.

export const SESSION_COOKIE = "coti_session";
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 días

// Workers limita PBKDF2 a 100.000 iteraciones. El número queda guardado en cada hash,
// así que se puede cambiar más adelante sin invalidar contraseñas existentes.
const PBKDF2_ITERATIONS = 100000;

const enc = new TextEncoder();

function toB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Comparación en tiempo constante.
export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function randomToken(bytes = 32) {
  return toB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${toB64url(salt)}$${toB64url(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100000) return false;
  const actual = await pbkdf2(password, fromB64url(parts[3]), iterations);
  return safeEqual(actual, fromB64url(parts[4]));
}

// Hash "señuelo": un email inexistente tarda lo mismo que uno real.
let dummyHashPromise = null;
export function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(randomToken(12));
  return dummyHashPromise;
}

export async function hashToken(token) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(token)));
}

export async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
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
      if (!k) return;
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    });
  return out;
}

export function sessionCookie(token, { secure }) {
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

export function clearSessionCookie({ secure }) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

// Token desde la cookie (web) o desde "Authorization: Bearer" (app móvil).
export function extractToken(request) {
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return { token: auth.slice(7).trim(), viaCookie: false };
  const cookies = parseCookies(request.headers.get("cookie"));
  if (cookies[SESSION_COOKIE]) return { token: cookies[SESSION_COOKIE], viaCookie: true };
  return { token: null, viaCookie: false };
}
