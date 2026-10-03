// api/generate.js
export const config = {
  maxDuration: 300, // مهلة أطول للصفحات الطويلة (على Vercel Hobby الحد الأقصى قد يكون أقل، النظام ياخد الأقصى المسموح)
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 16000;      // كان 8000 → رفعناه حتى ما يتقطع الرد على الصفحات الطويلة
const MAX_CONTINUATIONS = 2;   // إذا بقى الرد يتقطع، نكمّلو تلقائياً بدل ما نرجعو خطأ
const TIME_BUDGET_MS = 240000; // ما نبداوش متابعة جديدة إذا قرب انتهاء المهلة

async function callAnthropic(messages) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, messages }),
  });

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    const err = new Error("رد غير صالح من Anthropic API (كود " + response.status + "): " + rawText.slice(0, 200));
    err.status = 502;
    throw err;
  }
  if (!response.ok) {
    const err = new Error((data.error && data.error.message) || "خطأ من Anthropic API");
    err.status = response.status;
    throw err;
  }
  const block = (data.content || []).find((b) => b.type === "text");
  return { text: block ? block.text : "", stopReason: data.stop_reason };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { content } = req.body || {};
    if (!content || !Array.isArray(content) || content.length === 0) {
      return res.status(400).json({ error: "لم يصل محتوى صالح إلى السيرفر (content فارغ أو غير موجود)." });
    }

    const started = Date.now();
    const messages = [{ role: "user", content }];

    let { text, stopReason } = await callAnthropic(messages);

    // إذا انقطع الرد بسبب حد التوكنز: نطلب من النموذج يكمل من نفس النقطة ونلصق الأجزاء
    let tries = 0;
    while (stopReason === "max_tokens" && tries < MAX_CONTINUATIONS && Date.now() - started < TIME_BUDGET_MS) {
      tries++;
      const next = await callAnthropic([
        { role: "user", content },
        { role: "assistant", content: text.trimEnd() },
        {
          role: "user",
          content:
            "انقطع ردك بسبب الطول. أكمل من الحرف الذي توقفت عنده بالضبط، بدون تكرار أي جزء سابق وبدون أي مقدمة أو Markdown، حتى ينتهي الرد كاملاً.",
        },
      ]);
      text = text.trimEnd() + next.text;
      stopReason = next.stopReason;
    }

    if (stopReason === "max_tokens") {
      return res.status(422).json({
        error: "توقف التوليد لأن المحتوى طويل جداً. جرّب تبسيط وصف المنتج أو أعد المحاولة.",
      });
    }

    return res.status(200).json({ text });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || "خطأ غير متوقع فالسيرفر." });
  }
}
