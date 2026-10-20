// api/free-trial.js
//   GET  /api/free-trial  -> { turnstileSiteKey }  (مفتاح عام فقط، لعرض التحقق الإضافي)
//   POST /api/free-trial  -> يطلب منح التوليد المجاني (مرة واحدة فقط لكل مستخدم مؤهل)
//
// المنح نفسه يتم داخل Postgres (دالة claim_free_trial) في معاملة ذرّية؛ هذا الملف فقط:
//   1) يتحقق من JWT وتأكيد البريد
//   2) يجمّع إشارات الجهاز/الشبكة ويجزّئها (HMAC مُملّح)
//   3) يتحقق من Turnstile عند الاشتباه
import { getUser, rpc, hmac, clientIp } from "./_lib/sb.js";

const DUP_MESSAGE =
  "لقد استفدت من التجربة المجانية من قبل على هذا الجهاز. للحصول على صفحات هبوط إضافية، اختر الباقة المناسبة لك.";

const ID_RE = /^[A-Za-z0-9_-]{16,128}$/;

async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !token) return false;
  try {
    const body = new URLSearchParams({ secret, response: String(token).slice(0, 2048) });
    if (ip) body.set("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const j = await r.json();
    return !!(j && j.success);
  } catch (e) {
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({ turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!process.env.TRIAL_HASH_SALT) {
      console.error("free-trial: TRIAL_HASH_SALT is not set");
      return res.status(500).json({ error: "إعدادات الخادم غير مكتملة." });
    }

    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "سجّل الدخول أولاً." });

    // البريد يجب أن يكون مؤكداً قبل تفعيل الرصيد المجاني (وتُعاد الفحص داخل SQL أيضاً).
    if (!user.email_confirmed_at) {
      return res.status(200).json({ status: "email_not_confirmed" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const did = ID_RE.test(String(body.did || "")) ? String(body.did) : null;
    const fp = ID_RE.test(String(body.fp || "")) ? String(body.fp) : null;
    const ip = clientIp(req);
    const ua = String(req.headers["user-agent"] || "").slice(0, 300);

    const canVerify = !!(process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SITE_KEY);
    const verified = body.turnstileToken ? await verifyTurnstile(body.turnstileToken, ip) : false;

    const { result, error } = await rpc("claim_free_trial", {
      p_user_id: user.id,
      p_fp: hmac("fp", fp),
      p_did: hmac("did", did),
      p_ip: hmac("ip", ip),
      p_ua: hmac("ua", ua),
      p_verified: verified,
      p_can_verify: canVerify,
    });
    if (error) {
      console.error("claim_free_trial failed:", error);
      return res.status(500).json({ error: "تعذّر التحقق الآن. أعد المحاولة بعد قليل." });
    }

    const status = result && result.status;
    const out = { status, credits: result && typeof result.credits === "number" ? result.credits : undefined };

    if (status === "denied_duplicate") out.message = DUP_MESSAGE;
    if (status === "needs_verification") out.turnstileSiteKey = process.env.TURNSTILE_SITE_KEY;
    if (status === "pending_review") {
      out.message = "نحتاج إلى مراجعة سريعة لطلبك قبل تفعيل التجربة المجانية. إن تأخر الأمر تواصل مع الدعم.";
    }
    return res.status(200).json(out);
  } catch (err) {
    console.error("free-trial error:", err);
    return res.status(500).json({ error: "خطأ غير متوقع فالسيرفر." });
  }
}
