import { Webhook } from 'standardwebhooks';

// Login codes by text message. Supabase calls our Send SMS hook (/api/hooks/send-sms) with the code;
// we check the call really came from Supabase, then hand the text to Termii.

export type SmsConfig = {
  hookSecret: string;   // Supabase → Authentication → Hooks → Send SMS → secret, as shown ("v1,whsec_...")
  apiKey: string;       // Termii dashboard → API key
  senderId: string;     // Termii-approved sender ID, e.g. "CrystalBall" (3 to 11 letters or numbers)
  baseUrl: string;      // Termii dashboard → your base URL
  channel: 'dnd' | 'generic';
};

export function smsConfig(env: Record<string, string | undefined> = process.env): SmsConfig | null {
  const { SEND_SMS_HOOK_SECRET, TERMII_API_KEY, TERMII_SENDER_ID } = env;
  if (!SEND_SMS_HOOK_SECRET || !TERMII_API_KEY || !TERMII_SENDER_ID) return null;
  return {
    hookSecret: SEND_SMS_HOOK_SECRET,
    apiKey: TERMII_API_KEY,
    senderId: TERMII_SENDER_ID,
    baseUrl: (env.TERMII_BASE_URL || 'https://v3.api.termii.com').replace(/\/+$/, ''),
    // The DND route reaches numbers on Do Not Disturb, which most Nigerian lines are. Only use generic for testing.
    channel: env.TERMII_CHANNEL === 'generic' ? 'generic' : 'dnd',
  };
}

export type HookPayload = { user: { id: string; phone?: string }; sms: { otp: string } };

/** Throws if the request wasn't signed by Supabase with our secret, or is more than 5 minutes old. */
export function verifyHook(secret: string, body: string, headers: Headers): HookPayload {
  const wh = new Webhook(secret.replace(/^v1,/, ''));
  const payload = wh.verify(body, {
    'webhook-id': headers.get('webhook-id') ?? '',
    'webhook-timestamp': headers.get('webhook-timestamp') ?? '',
    'webhook-signature': headers.get('webhook-signature') ?? '',
  }) as HookPayload;
  if (!payload?.sms?.otp || !payload?.user?.phone) throw new Error('bad_payload');
  return payload;
}

export function codeMessage(otp: string): string {
  // Must match the sample message approved with the Termii sender ID, word for word. The 10 minutes is
  // Supabase → Authentication → Sign In / Providers → Phone → SMS OTP Expiry (600 seconds).
  return `Your Crystal Ball FC verification code is ${otp}. This code expires in 10 minutes. Do not share it with anyone.`;
}

/** Shows enough of a number to trace a problem in the logs, never the whole number. */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length > 6 ? `${d.slice(0, 3)}****${d.slice(-3)}` : '****';
}

export async function sendCode(cfg: SmsConfig, phone: string, otp: string, fetcher: typeof fetch = fetch) {
  const res = await fetcher(`${cfg.baseUrl}/api/sms/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: cfg.apiKey,
      to: phone.replace(/\D/g, ''),   // Termii wants 2348031234567, no +
      from: cfg.senderId,
      sms: codeMessage(otp),
      type: 'plain',
      channel: cfg.channel,
    }),
    signal: AbortSignal.timeout(4000),   // Supabase gives the hook 5 seconds in all
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || (data.code && data.code !== 'ok')) {
    throw new Error(`termii ${res.status}: ${data.message ?? 'no message'}`);
  }
  return { messageId: String(data.message_id_str ?? data.message_id ?? ''), balance: data.balance };
}
