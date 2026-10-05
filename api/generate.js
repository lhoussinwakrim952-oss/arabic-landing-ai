// api/generate.js
// نفس الكود القديم + تحقق من تسجيل الدخول (باش ماشي أي واحد يقدر يخسّر رصيد Anthropic).
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

async function getUser(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!m) return null;
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "سجّل الدخول أولاً ثم أعد المحاولة." });
    if (tooMany(user.id)) return res.status(429).json({ error: "طلبات كثيرة في وقت قصير. انتظر قليلاً ثم أعد المحاولة." });

    const { content } = req.body || {};

    if (!content || !Array.isArray(content) || content.length === 0) {
      return res.status(400).json({ error: "لم يصل محتوى صالح إلى السيرفر (content فارغ أو غير موجود)." });
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
      return res.status(502).json({
        error: "رد غير صالح من Anthropic API (كود " + response.status + "): " + rawText.slice(0, 200),
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: (data.error && data.error.message) || "خطأ من Anthropic API",
      });
    }

    if (data.stop_reason === "max_tokens") {
      return res.status(422).json({
        error: "توقف التوليد لأن المحتوى طويل جداً. جرّب تبسيط وصف المنتج أو أعد المحاولة.",
      });
    }

    const textBlock = (data.content || []).find((b) => b.type === "text");
    return res.status(200).json({ text: textBlock ? textBlock.text : "" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "خطأ غير متوقع فالسيرفر." });
  }
}
