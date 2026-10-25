const enc = new TextEncoder();

export const SESSION_COOKIE = 'irs_s';
export const SESSION_TTL_MS = 86_400_000;
export const TICKET_TTL_MS = 5 * 60_000;

export interface Session { sid: string; issuedAt: number }

const DIGITS = /^\d{1,16}$/;
const SIG = /^[0-9a-f]{32}$/;

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function sha256Hex(data: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(data)));
}

export function newSid(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export async function signSession(secret: string, s: Session): Promise<string> {
  const body = `${s.sid}.${s.issuedAt}`;
  return `${body}.${(await hmacHex(secret, `s|${body}`)).slice(0, 32)}`;
}

export async function verifySession(secret: string, token: string | null, now: number): Promise<Session | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [sid, issued, sig] = parts;
  if (!/^[0-9a-f]{32}$/.test(sid) || !DIGITS.test(issued) || !SIG.test(sig)) return null;
  const issuedAt = Number(issued);
  if (now - issuedAt > SESSION_TTL_MS || issuedAt - now > 60_000) return null;
  const want = (await hmacHex(secret, `s|${sid}.${issuedAt}`)).slice(0, 32);
  return safeEqual(sig, want) ? { sid, issuedAt } : null;
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400; Secure`;
}

/** The eight 16-bit groups of an IPv6 address (`::` and a dotted IPv4 tail expanded), or null. */
function v6Groups(addr: string): number[] | null {
  let a = addr;
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (dotted) {
    const b = dotted.slice(1).map(Number);
    if (b.some(n => n > 255)) return null;
    a = `${a.slice(0, dotted.index)}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (groups.length !== 8 || !groups.every(g => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map(g => parseInt(g, 16));
}

/**
 * The part of a client address that names one visitor for the per-IP limits. IPv4 is the whole
 * address. IPv6 is its /64: every IPv6 host holds at least a /64, so keying on the full address
 * would hand one machine 2^64 fresh buckets. An IPv4-mapped address (`::ffff:a.b.c.d`) is its IPv4.
 */
export function ipBucket(ip: string): string {
  const addr = ip.trim().replace(/^\[(.*)\]$/, '$1').split('%')[0].toLowerCase();
  if (!addr.includes(':')) return addr;
  const g = v6Groups(addr);
  if (!g) return addr;
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) {
    return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
  }
  return `${g.slice(0, 4).map(x => x.toString(16)).join(':')}::/64`;
}

/** SHA-256(ip|UTCdate|secret), where ip is the visitor's bucket (`ipBucket`). The raw IP is never kept. */
export async function ipHash(secret: string, ip: string, day: string): Promise<string> {
  return (await sha256Hex(`${ipBucket(ip)}|${day}|${secret}`)).slice(0, 24);
}

export async function signTicket(secret: string, sid: string, turn: number, request: string, now: number): Promise<string> {
  const body = `${turn}.${now}`;
  return `${body}.${(await hmacHex(secret, `t|${sid}|${body}|${request}`)).slice(0, 32)}`;
}

export async function verifyTicket(
  secret: string, ticket: string, sid: string, request: string, now: number,
): Promise<{ id: string } | null> {
  const parts = ticket.split('.');
  if (parts.length !== 3) return null;
  const [turn, ts, sig] = parts;
  if (!DIGITS.test(turn) || !DIGITS.test(ts) || !SIG.test(sig)) return null;
  const at = Number(ts);
  if (now - at > TICKET_TTL_MS || at - now > 60_000) return null;
  const want = (await hmacHex(secret, `t|${sid}|${turn}.${at}|${request}`)).slice(0, 32);
  return safeEqual(sig, want) ? { id: sig } : null;
}
