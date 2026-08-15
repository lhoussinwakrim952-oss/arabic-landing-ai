export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { content } = req.body;

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

    const data = await response.json();

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
    return res.status(500).json({ error: err.message });
  }
}
