import { prisma } from '../lib/db.js';
import { getProvider } from './providers.js';

/**
 * Send one message to a client and log it. The row is written first (QUEUED) and then
 * updated to SENT/FAILED, so there is an audit trail even if the provider call crashes.
 */
export async function sendToClient({ companyId, sentById, client, shipmentId = null, docId = null, kind, body, channel }) {
  const ch = (channel || client.channel) === 'WHATSAPP' ? 'WHATSAPP' : 'SMS';
  const provider = getProvider(ch);
  if (!client.phone) {
    return prisma.message.create({ data: { companyId, clientId: client.id, shipmentId, docId, to: '-', channel: ch, provider: provider.name, kind, body, status: 'FAILED', error: 'Client has no phone number', sentById } });
  }
  const msg = await prisma.message.create({ data: { companyId, clientId: client.id, shipmentId, docId, to: client.phone, channel: ch, provider: provider.name, kind, body, status: 'QUEUED', sentById } });
  let r;
  try {
    r = await provider.send({ to: client.phone, body, channel: ch });
  } catch (e) {
    r = { ok: false, error: e.message };
  }
  return prisma.message.update({
    where: { id: msg.id },
    data: r.ok ? { status: 'SENT', providerMessageId: r.providerMessageId ?? null, sentAt: new Date() } : { status: 'FAILED', error: String(r.error || 'Unknown error').slice(0, 500) },
  });
}
