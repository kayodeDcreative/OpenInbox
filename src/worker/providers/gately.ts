// Gately (https://usegately.com), transactional email API. Same endpoint the Motsi API uses:
// POST /api/v1/email/send with a Bearer key. A 207 means some recipients failed.
//
// Gately has no domain or webhook API we rely on: sending domains are verified in the Gately
// dashboard, so addDomain/checkDomain report "verified" and the UI says so. The key is checked on
// the first send, because there is no cheap authenticated read call to validate it with.
//
// Only to/from/subject/text/html are sent for a plain message. cc, bcc, reply_to, headers and
// attachments are added only when present; confirm Gately accepts them before relying on those.
import {
  formatFrom,
  httpError,
  ProviderError,
  threadingHeaders,
  toBase64,
  type DomainSetup,
  type OutgoingMessage,
  type ProviderAdapter,
  type SendResult,
} from './types';

export interface GatelyConfig {
  apiKey: string;
}

export class GatelyAdapter implements ProviderAdapter {
  readonly type = 'gately' as const;

  constructor(
    private config: GatelyConfig,
    private base = 'https://api.usegately.com',
  ) {}

  async validate() {
    return { note: 'Key saved. Gately has no key check, so it is tried on the first email you send. Verify each sending domain in the Gately dashboard.' };
  }

  async addDomain(): Promise<DomainSetup> {
    return { externalId: null, status: 'verified', records: [], message: 'Verify this domain in the Gately dashboard.' };
  }

  async checkDomain(): Promise<DomainSetup> {
    return { externalId: null, status: 'verified', records: [], message: 'Verify this domain in the Gately dashboard.' };
  }

  async send(m: OutgoingMessage): Promise<SendResult> {
    const recipients = (list: OutgoingMessage['to']) => (list.length === 1 ? formatFrom(list[0]!) : list.map(formatFrom));
    const res = await fetch(`${this.base}/api/v1/email/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: formatFrom(m.from),
        to: recipients(m.to),
        subject: m.subject,
        text: m.text,
        html: m.html ?? undefined,
        ...(m.cc.length ? { cc: recipients(m.cc) } : {}),
        ...(m.bcc.length ? { bcc: recipients(m.bcc) } : {}),
        ...(m.replyTo ? { reply_to: formatFrom(m.replyTo) } : {}),
        headers: threadingHeaders(m),
        ...(m.attachments.length
          ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: toBase64(a.content), content_type: a.contentType })) }
          : {}),
      }),
    });
    if (!res.ok) throw await httpError('Gately', res);
    const body = (await res.json().catch(() => null)) as { success?: boolean; failed?: number; id?: string; message_id?: string } | null;
    // 207 = partial failure; treat it as failed so the send pipeline can retry or report it.
    if (res.status === 207 || body?.failed || body?.success === false) throw new ProviderError('Gately: the message was not delivered to every recipient.', true, res.status);
    return { providerMessageId: body?.id ?? body?.message_id ?? null };
  }
}
