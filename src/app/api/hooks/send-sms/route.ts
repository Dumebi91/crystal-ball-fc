import { NextResponse, type NextRequest } from 'next/server';
import { maskPhone, sendCode, smsConfig, verifyHook } from '@/lib/sms';

// Supabase's Send SMS hook. Supabase → Authentication → Hooks → Send SMS → HTTPS,
// URL https://www.crystalballfc.com/api/hooks/send-sms. Supabase signs each call; anything unsigned is refused.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Supabase shows `message` to the person logging in, so keep it plain.
const fail = (http_code: number, message: string) =>
  NextResponse.json({ error: { http_code, message } }, { status: http_code });

export async function POST(request: NextRequest) {
  const cfg = smsConfig();
  if (!cfg) {
    console.error('send-sms: SEND_SMS_HOOK_SECRET, TERMII_API_KEY or TERMII_SENDER_ID is not set');
    return fail(500, "We couldn't send a code right now. Please try again shortly.");
  }

  const body = await request.text();
  let payload;
  try {
    payload = verifyHook(cfg.hookSecret, body, request.headers);
  } catch {
    return fail(401, 'Unauthorised');
  }

  const phone = payload.user.phone!;
  try {
    const sent = await sendCode(cfg, phone, payload.sms.otp);
    console.log(`send-sms: sent to ${maskPhone(phone)}, Termii id ${sent.messageId}, balance ${sent.balance ?? '?'}`);
    return NextResponse.json({});
  } catch (e) {
    console.error(`send-sms: failed for ${maskPhone(phone)}: ${(e as Error).message}`);
    return fail(502, "We couldn't send a code right now. Please try again shortly.");
  }
}
