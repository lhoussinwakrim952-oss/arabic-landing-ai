// api/_lib/sb.js
// مساعدات مشتركة للخادم فقط (المجلد يبدأ بـ _ فلا يتحول إلى Serverless Function).
// المفاتيح السرية تُقرأ من متغيرات البيئة ولا تصل أبداً للمتصفح.
import crypto from "crypto";

function cfg() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url, key };
}

function serviceHeaders(key) {
  const h = { "Content-Type": "application/json", apikey: key };
  // المفاتيح القديمة (JWT) تحتاج Authorization، والجديدة (sb_secret_) لا.
  if (key.startsWith("eyJ")) h.Authorization = `Bearer ${key}`;
  return h;
}

// يتحقق من JWT المستخدم ويعيد بياناته (بما فيها email_confirmed_at).
export async function getUser(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!m) return null;
  const { url, key } = cfg();
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${m[1]}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  } catch (e) {
    return null;
  }
}

// استدعاء دالة RPC بصلاحية service role.
export async function rpc(fnName, params) {
  const { url, key } = cfg();
  if (!url || !key) return { error: { status: 500, body: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" } };
  const resp = await fetch(`${url}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: serviceHeaders(key),
    body: JSON.stringify(params),
  });
  const text = await resp.text();
  if (!resp.ok) return { error: { status: resp.status, body: text } };
  let result = text;
  try { result = JSON.parse(text); } catch (_) {}
  return { result };
}

// HMAC مُملّح: لا نخزّن IP ولا بصمة خام، ولا يمكن عكس القيمة بدون TRIAL_HASH_SALT.
export function hmac(label, value) {
  const salt = process.env.TRIAL_HASH_SALT || "";
  if (!salt || !value) return null;
  return crypto.createHmac("sha256", salt).update(label + ":" + String(value)).digest("hex");
}

export function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || String(req.headers["x-real-ip"] || "") || (req.socket && req.socket.remoteAddress) || "";
}
