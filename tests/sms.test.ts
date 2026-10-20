import { afterEach, describe, expect, it, vi } from 'vitest';
import { Webhook } from 'standardwebhooks';
import { NextRequest } from 'next/server';
import { codeMessage, maskPhone, sendCode, smsConfig, verifyHook, type SmsConfig } from '../src/lib/sms';

// A made-up secret in Supabase's format.
const SECRET = 'v1,whsec_' + Buffer.from('a test secret that is long enough!').toString('base64');
const BODY = JSON.stringify({ user: { id: 'u1', phone: '2348031234567' }, sms: { otp: '482915' } });

function signed(body = BODY, secret = SECRET, when = new Date()) {
  const wh = new Webhook(secret.replace(/^v1,/, ''));
  return new Headers({
    'webhook-id': 'msg_1',
    'webhook-timestamp': String(Math.floor(when.getTime() / 1000)),
    'webhook-signature': wh.sign('msg_1', when, body),
  });
}

const cfg: SmsConfig = { hookSecret: SECRET, apiKey: 'k', senderId: 'CrystalBall', baseUrl: 'https://termii.test', channel: 'dnd' };

describe('Send SMS hook', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('accepts a call signed by Supabase and refuses forged, tampered or stale ones', () => {
    expect(verifyHook(SECRET, BODY, signed()).sms.otp).toBe('482915');
    const other = 'v1,whsec_' + Buffer.from('somebody else entirely, guessing').toString('base64');
    expect(() => verifyHook(SECRET, BODY, signed(BODY, other))).toThrow();
    expect(() => verifyHook(SECRET, BODY.replace('482915', '000000'), signed())).toThrow();
    expect(() => verifyHook(SECRET, BODY, signed(BODY, SECRET, new Date(Date.now() - 10 * 60000)))).toThrow();
    expect(() => verifyHook(SECRET, BODY, new Headers())).toThrow();
  });

  it('sends the code to Termii on the DND route, with the number in the format Termii wants', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'ok', message_id_str: 'abc', balance: 99 }), { status: 200 }));
    const out = await sendCode(cfg, '+234 803 123 4567', '482915', fetcher as any);
    expect(out.messageId).toBe('abc');
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://termii.test/api/sms/send');
    expect(JSON.parse(init.body)).toEqual({
      api_key: 'k', to: '2348031234567', from: 'CrystalBall', sms: codeMessage('482915'), type: 'plain', channel: 'dnd',
    });
    expect(codeMessage('482915').length).toBeLessThanOrEqual(160);   // one text, one charge
  });

  it('treats a Termii refusal as a failure', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Insufficient balance' }), { status: 400 }));
    await expect(sendCode(cfg, '2348031234567', '1', fetcher as any)).rejects.toThrow('Insufficient balance');
  });

  it('never logs a whole phone number, and needs all three settings before it will run', () => {
    expect(maskPhone('2348031234567')).toBe('234****567');
    expect(smsConfig({ SEND_SMS_HOOK_SECRET: 's', TERMII_API_KEY: 'k' })).toBeNull();
    expect(smsConfig({ SEND_SMS_HOOK_SECRET: 's', TERMII_API_KEY: 'k', TERMII_SENDER_ID: 'X', TERMII_BASE_URL: 'https://x.termii.com/' }))
      .toMatchObject({ baseUrl: 'https://x.termii.com', channel: 'dnd' });
  });

  it('end to end: a signed call sends a text; an unsigned call sends nothing', async () => {
    vi.stubEnv('SEND_SMS_HOOK_SECRET', SECRET);
    vi.stubEnv('TERMII_API_KEY', 'k');
    vi.stubEnv('TERMII_SENDER_ID', 'CrystalBall');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'ok', message_id: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const { POST } = await import('../src/app/api/hooks/send-sms/route');
    const req = (headers: Headers) => new NextRequest('https://www.crystalballfc.com/api/hooks/send-sms', { method: 'POST', body: BODY, headers });

    const ok = await POST(req(signed()));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({});
    expect(fetcher).toHaveBeenCalledTimes(1);

    const forged = await POST(req(new Headers({ 'webhook-id': 'x', 'webhook-timestamp': '1', 'webhook-signature': 'v1,nope' })));
    expect(forged.status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(1);

    fetcher.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const down = await POST(req(signed()));
    expect(down.status).toBe(502);
    expect((await down.json()).error.message).toMatch(/couldn't send a code/);
  });
});
