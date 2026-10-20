// api/generate.js
// تحقق من تسجيل الدخول + تحقق من الرصيد وخصمه من الخادم قبل استدعاء Anthropic.
// مفتاح ANTHROPIC_API_KEY يبقى هنا فقط (Environment Variable) ولا يصل للمتصفح.
//
// التغيير الوحيد عن النسخة السابقة: الخصم صار هنا (ذرّياً، قبل التوليد) مع إرجاع النقطة
// تلقائياً إذا فشل التوليد. بهذا لا يمكن تخطي الخصم باستدعاء /api/generate مباشرة.
import { getUser, rpc } from "./_lib/sb.js";

// كل طلب توليد يحمل jobId من المتصفح. النتيجة تُحفظ في جدول generation_jobs،
// فإذا انقطع الاتصال (طفي الشاشة) يجلبها المتصفح لاحقاً من /api/job بدل ضياعها.
// إذا لم يكن الجدول موجوداً بعد أو لم يصل jobId، يعمل الكود كما كان بدون حفظ.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

const calls = new Map(); // rate limit بسيط لكل مستخدم (فالذاكرة)
function tooMany(userId) {
  const now = Date.now();
  const arr = (calls.get(userId) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (arr.length >= 40) { calls.set(userId, arr); return true; }
  arr.push(now);
  calls.set(userId, arr);
  if (calls.size > 5000) calls.clear();
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let reserved = null; // { admin, trial, credits }
  let userId = null;
  let jobId = null; // null = بدون حفظ النتيجة

  async function finishJob(status, result, error, http, code) {
    if (!jobId) return;
    try {
      await rpc("job_finish", { p_id: jobId, p_status: status, p_result: result || null, p_error: error || null, p_http: http || null, p_code: code || null });
    } catch (e) {}
  }
  // يرجع النقطة (إن وُجدت) ويسجل فشل المهمة ثم يرسل الخطأ.
  async function failWith(status, body) {
    await refund();
    await finishJob("failed", null, body.error, status, body.code);
    return res.status(status).json(body);
  }

  async function refund() {
    if (reserved && !reserved.admin && userId) {
      try { await rpc("refund_generation_credit", { p_user_id: userId, p_trial: !!reserved.trial }); } catch (e) {}
    }
    reserved = null;
  }

  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "سجّل الدخول أولاً ثم أعد المحاولة." });
    userId = user.id;
    if (tooMany(user.id)) return res.status(429).json({ error: "طلبات كثيرة في وقت قصير. انتظر قليلاً ثم أعد المحاولة." });

    const { content } = req.body || {};

    if (!content || !Array.isArray(content) || content.length === 0) {
      return res.status(400).json({ error: "لم يصل محتوى صالح إلى السيرفر (content فارغ أو غير موجود)." });
    }

    // تسجيل المهمة. إذا وصل نفس jobId مرة ثانية (إعادة إرسال) نرجع حالتها بدون خصم جديد.
    const wantedId = req.body && req.body.jobId;
    if (typeof wantedId === "string" && UUID.test(wantedId)) {
      const b = await rpc("job_begin", { p_id: wantedId, p_user: user.id });
      if (!b.error && b.result) {
        if (b.result.state === "forbidden") return res.status(403).json({ error: "طلب غير مسموح." });
        if (b.result.state === "exists") {
          if (b.result.status === "done") return res.status(200).json(b.result.result);
          if (b.result.status === "failed") return res.status(b.result.http_status || 500).json({ error: b.result.error, code: b.result.code });
          return res.status(202).json({ pending: true });
        }
        jobId = wantedId; // state === "new"
      } else if (b.error) {
        console.error("job_begin failed (continuing without job tracking):", b.error);
      }
    }

    // حجز نقطة (ذرّي) قبل أي استدعاء للذكاء الاصطناعي. الأدمن مستثنى.
    const c = await rpc("consume_generation_credit", { p_user_id: user.id });
    if (c.error) {
      console.error("consume_generation_credit failed:", c.error);
      return failWith(500, { error: "تعذّر التحقق من رصيدك. أعد المحاولة بعد قليل." });
    }
    if (!c.result || !c.result.ok) {
      return failWith(402, {
        code: "no_credits",
        error: "انتهى رصيدك. اختر الباقة المناسبة لمتابعة توليد صفحات الهبوط.",
      });
    }
    reserved = { admin: !!c.result.admin, trial: !!c.result.trial_consumed, credits: c.result.credits };
    if (jobId && !reserved.admin) {
      try { await rpc("job_mark_reserved", { p_id: jobId, p_trial: reserved.trial }); } catch (e) {}
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 8000,
        messages: [{ role: "user", content }],
      }),
    });

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      return failWith(502, {
        error: "رد غير صالح من Anthropic API (كود " + response.status + "): " + rawText.slice(0, 200),
      });
    }

    if (!response.ok) {
      return failWith(response.status, {
        error: (data.error && data.error.message) || "خطأ من Anthropic API",
      });
    }

    if (data.stop_reason === "max_tokens") {
      return failWith(422, {
        error: "توقف التوليد لأن المحتوى طويل جداً. جرّب تبسيط وصف المنتج أو أعد المحاولة.",
      });
    }

    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock || !textBlock.text) {
      return failWith(502, { error: "لم يصل رد نصي من المحرك. لم يتم خصم أي نقطة." });
    }

    const out = {
      text: textBlock.text,
      admin: reserved.admin,
      credits: reserved.admin ? null : reserved.credits,
      trialConsumed: reserved.trial,
    };
    reserved = null; // نجح التوليد: الخصم نهائي
    await finishJob("done", out); // نحفظ النتيجة قبل الرد، فتبقى متاحة حتى لو انقطع الاتصال
    return res.status(200).json(out);
  } catch (err) {
    return failWith(500, { error: err.message || "خطأ غير متوقع فالسيرفر." });
  }
}
