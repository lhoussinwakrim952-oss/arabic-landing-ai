import crypto from 'crypto';
import { supabase } from './supabase-config.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET || '';
    const signature = req.headers['x-signature'] || '';
    const rawBody = JSON.stringify(req.body);

    // التحقق من التوقيع الأمني
    const hmac = crypto.createHmac('sha256', secret);
    const digest = Buffer.from(hmac.update(rawBody).digest('hex'), 'utf8');
    const signatureBuffer = Buffer.from(signature, 'utf8');

    if (digest.length !== signatureBuffer.length || !crypto.timingSafeEqual(digest, signatureBuffer)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const eventName = req.body.meta.event_name;

    // عند نجاح الشراء
    if (eventName === 'order_created') {
      const customerEmail = req.body.data.attributes.user_email;
      const customData = req.body.meta.custom_data;
      const userId = customData?.user_id; // الـ ID الممرر من الزر

      // تحديد عدد النقاط المضافة (مثلاً 50 نقطة)
      const creditsToAdd = 50;

      // 1. جلب بيانات المستخدم الحالية
      let query = supabase.from('users').select('credits, id');
      if (userId) {
        query = query.eq('id', userId);
      } else {
        query = query.eq('email', customerEmail);
      }

      const { data: user, error: fetchError } = await query.single();

      if (user) {
        const updatedCredits = (user.credits || 0) + creditsToAdd;

        // 2. تحديث النقاط الجديدة فـ Supabase
        await supabase
          .from('users')
          .update({ credits: updatedCredits })
          .eq('id', user.id);

        console.log(`تم تزويد ${creditsToAdd} نقطة للمستخدم: ${customerEmail}`);
      }
    }

    return res.status(200).json({ status: 'success' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Webhook Error' });
  }
}
