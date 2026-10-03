// api/generate.js
// خاص تزيد هاد الـ config باش ترفع حد حجم الـ body عند Next.js من 1mb الافتراضي إلى 10mb.
// بدون هاد السطر، Next.js كيرفض أي طلب كبير قبل ما يوصل للكود تاعك تحت، ويرجع رد نصي
// (Request Entity Too Large) بدل JSON — وهو بالضبط الخطأ لي كنت كتشوف فالواجهة.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { content } = req.body || {};

    // تحقق بسيط من صحة البيانات قبل الإرسال لـ Anthropic — كيفادي رسائل خطأ غامضة لاحقاً
    if (!content || !Array.isArray(content) || content.length === 0) {
      return res.status(400).json({ error: "لم يصل محتوى صالح إلى السيرفر (content فارغ أو غير موجود)." });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY, // المفتاح مخبّأ هنا فالسيرفر فقط
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        // 4000 توكن ما كافيش لصفحة كاملة (hero+features+benefits+testimonials+faq+specs...)
        // فكان كيتقطع الرد فالنص ويبقى JSON غير مكتمل = صفحة فارغة. 8000 كافية لصفحة غنية بالمحتوى.
        max_tokens: 8000,
        messages: [{ role: "user", content }],
      }),
    });

    // نقرا الرد كنص أولاً، لأن Anthropic (أو أي بروكسي فالطريق) ممكن يرجع رد ماشي JSON
    // فحالات نادرة (مثلاً خطأ 502/504 من الشبكة) — هادشي كيفادي كراش JSON.parse غامض.
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

    // إذا توقف التوليد بسبب حد التوكنز (stop_reason === "max_tokens")، الرد ناقص أكيد.
    // نرجع خطأ واضح بدل ما نرجع JSON مقطوع يفشل فالـ parsing على الواجهة.
    if (data.stop_reason === "max_tokens") {
      return res.status(422).json({
        error: "توقف التوليد لأن المحتوى طويل جداً. جرّب تبسيط وصف المنتج أو أعد المحاولة.",
      });
    }

    const textBlock = (data.content || []).find((b) => b.type === "text");
    return res.status(200).json({ text: textBlock ? textBlock.text : "" });
  } catch (err) {
    // أي خطأ غير متوقع (شبكة، انقطاع، إلخ) — نرجعو دايماً JSON صالح، أبداً نص خام
    return res.status(500).json({ error: err.message || "خطأ غير متوقع فالسيرفر." });
  }
}
