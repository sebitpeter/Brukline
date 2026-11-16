// Messaging provider abstraction. Each provider exposes:
//   name: string
//   send({ to, body }) -> { ok, providerMessageId?, error? }
// Selection comes from .env: SMS_PROVIDER and WHATSAPP_PROVIDER.
// With no keys configured everything falls back to "console", which only logs
// (the message is still saved to the messages table so the app is fully usable).

export const consoleProvider = {
  name: 'console',
  async send({ to, body, channel }) {
    console.log(`[mock ${channel}] -> ${to}: ${body}`);
    return { ok: true, providerMessageId: `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` };
  },
};

export function africasTalkingProvider(env = process.env, fetchImpl = fetch) {
  const username = env.AT_USERNAME;
  const apiKey = env.AT_API_KEY;
  const sandbox = username === 'sandbox';
  const url = sandbox ? 'https://api.sandbox.africastalking.com/version1/messaging' : 'https://api.africastalking.com/version1/messaging';
  return {
    name: 'africastalking',
    async send({ to, body }) {
      const form = new URLSearchParams({ username, to, message: body });
      if (env.AT_SENDER_ID) form.set('from', env.AT_SENDER_ID);
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      const r = data?.SMSMessageData?.Recipients?.[0];
      if (!res.ok || !r) return { ok: false, error: data?.SMSMessageData?.Message || `HTTP ${res.status}` };
      // statusCode 100-102 = processed/sent/queued
      const ok = [100, 101, 102].includes(Number(r.statusCode));
      return ok ? { ok, providerMessageId: r.messageId } : { ok, error: r.status || 'Rejected' };
    },
  };
}

export function twilioWhatsAppProvider(env = process.env, fetchImpl = fetch) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_WHATSAPP_FROM; // e.g. +14155238886 (sandbox)
  return {
    name: 'twilio',
    async send({ to, body }) {
      const form = new URLSearchParams({ From: `whatsapp:${from}`, To: `whatsapp:${to}`, Body: body });
      const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, providerMessageId: data.sid } : { ok: false, error: data.message || `HTTP ${res.status}` };
    },
  };
}

export function metaWhatsAppProvider(env = process.env, fetchImpl = fetch) {
  const token = env.META_WA_TOKEN;
  const phoneId = env.META_WA_PHONE_NUMBER_ID;
  const version = env.META_WA_API_VERSION || 'v21.0';
  return {
    name: 'meta',
    async send({ to, body }) {
      // NOTE: free-form text only delivers inside the 24h customer-service window.
      // For cold outbound messages Meta requires an approved template (see README).
      const res = await fetchImpl(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace('+', ''), type: 'text', text: { body } }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, providerMessageId: data?.messages?.[0]?.id } : { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    },
  };
}

/** Pick the provider for a channel based on env. Falls back to console when keys are missing. */
export function getProvider(channel, env = process.env, fetchImpl = fetch) {
  if (channel === 'WHATSAPP') {
    const p = (env.WHATSAPP_PROVIDER || 'console').toLowerCase();
    if (p === 'twilio' && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM) return twilioWhatsAppProvider(env, fetchImpl);
    if (p === 'meta' && env.META_WA_TOKEN && env.META_WA_PHONE_NUMBER_ID) return metaWhatsAppProvider(env, fetchImpl);
    return consoleProvider;
  }
  const p = (env.SMS_PROVIDER || 'console').toLowerCase();
  if (p === 'africastalking' && env.AT_USERNAME && env.AT_API_KEY) return africasTalkingProvider(env, fetchImpl);
  return consoleProvider;
}
