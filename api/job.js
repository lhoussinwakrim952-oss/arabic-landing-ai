// api/job.js
// يعيد حالة/نتيجة مهمة توليد (processing | done | failed | not_found) للمستخدم صاحبها فقط.
import { getUser, rpc } from "./_lib/sb.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Cache-Control", "no-store");
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: "سجّل الدخول أولاً." });
    const id = String((req.query && req.query.id) || "");
    if (!UUID.test(id)) return res.status(400).json({ error: "معرّف غير صالح." });
    const r = await rpc("job_get", { p_id: id, p_user: user.id });
    if (r.error) return res.status(500).json({ error: "تعذّر قراءة حالة التوليد." });
    return res.status(200).json(r.result);
  } catch (e) {
    return res.status(500).json({ error: "خطأ غير متوقع." });
  }
}
