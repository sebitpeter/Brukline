import { z } from 'zod';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Query strings: '' and 'ALL' mean "no filter" (select boxes send them). */
export function parseQuery(schema, query) {
  const clean = Object.fromEntries(Object.entries(query || {}).filter(([, v]) => v !== '' && v !== 'ALL'));
  return parse(schema, clean);
}

export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, `${first.path.join('.') || 'input'}: ${first.message}`);
  }
  return r.data;
}

// Shared Zod pieces
export const id = z.string().min(1).max(40);
export const optText = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
export const reqText = (max = 200) => z.string().trim().min(1, 'is required').max(max);
export const minor = z.number().int().min(0).max(1e15);
export const dateStr = z.coerce.date();

/** Parse a PATCH body: like parse(schema.partial()) but keeps only keys the client actually sent (ignores defaults). */
export function parsePatch(schema, data) {
  const out = parse(schema.partial(), data || {});
  return Object.fromEntries(Object.entries(out).filter(([k]) => Object.prototype.hasOwnProperty.call(data || {}, k)));
}
