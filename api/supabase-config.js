// Vercel Serverless Function
// GET /api/supabase-config
// يعيد فقط الـ Project URL والـ Publishable (anon) Key من متغيرات البيئة على Vercel.
// هذا المفتاح مصمم أصلاً ليكون عاماً (public) من جهة العميل، وحمايته الحقيقية تأتي
// من RLS في قاعدة البيانات — لكن هذا المسار يمنع كتابته مباشرة داخل ملف HTML.
//
// أضف في Vercel > Settings > Environment Variables:
//   SUPABASE_URL = https://wnrvayqnitlpkpksbxzf.supabase.co
//   SUPABASE_PUBLISHABLE_KEY = sb_publishable_EO8NW4tTEgONC0eg3Rx3KQ_nnvfFAlD
//
// ملاحظة: إذا كانت دالة /api/generate الحالية عندك مكتوبة بصيغة "export default"
// (ES Modules) بدلاً من "module.exports"، غيّر السطر الأخير في هذا الملف ليطابق
// نفس الصيغة حتى يعمل على نفس الإعداد (vercel.json / package.json "type").

module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || "";

  if (!url || !key) {
    res.status(500).json({ error: "Supabase environment variables are not configured on the server." });
    return;
  }

  res.status(200).json({ url, key });
};
