// Eskiz.uz SMS gateway (notify.eskiz.uz, official Postman collection 663428/RzfmES4z):
// POST /api/auth/login (email, password) → data.token (bearer, ~30 days); POST /api/message/sms/send
// (mobile_phone 998…, message, from) → { id, status: "waiting" }. Each center uses its own Eskiz account.
// Note: Eskiz moderates texts — a production account sends only templates approved in its cabinet.

export const ESKIZ_BASE = "https://notify.eskiz.uz/api";
export const ESKIZ_DEFAULT_FROM = "4546";

export interface EskizAccount {
  login: string;
  password: string;
  from?: string | null;
}

/** Failure the queue can act on: "permanent" fails the row, "transient" retries with backoff. */
export class SmsError extends Error {
  constructor(
    public kind: "permanent" | "transient",
    message: string,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

/** Token cache per account (login + password): one login per account per process, again after a 401. */
export class EskizClient {
  private tokens = new Map<string, string>();
  constructor(
    private fetchFn: Fetch = fetch,
    private timeoutMs = 15_000,
  ) {}

  private key(a: EskizAccount) {
    return `${a.login}\u0000${a.password}`;
  }

  private async login(a: EskizAccount): Promise<string> {
    const body = new FormData();
    body.set("email", a.login);
    body.set("password", a.password);
    const res = await this.call("/auth/login", body);
    if (res.status === 401 || res.status === 422 || res.status === 400) throw new SmsError("permanent", `eskiz login refused (${res.status})`);
    if (!res.ok) throw new SmsError("transient", `eskiz login ${res.status}`);
    const json = (await res.json().catch(() => null)) as { data?: { token?: string } } | null;
    const token = json?.data?.token;
    if (!token) throw new SmsError("transient", "eskiz login: no token in the answer");
    this.tokens.set(this.key(a), token);
    return token;
  }

  private async call(path: string, body: FormData, token?: string): Promise<Response> {
    try {
      return await this.fetchFn(`${ESKIZ_BASE}${path}`, {
        method: "POST",
        body,
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new SmsError("transient", `eskiz unreachable: ${(e as Error).message}`.slice(0, 300));
    }
  }

  async send(a: EskizAccount, phone: string, text: string): Promise<{ id: string | null }> {
    const form = () => {
      const f = new FormData();
      f.set("mobile_phone", phone);
      f.set("message", text);
      f.set("from", a.from?.trim() || ESKIZ_DEFAULT_FROM);
      return f;
    };
    let token = this.tokens.get(this.key(a)) ?? (await this.login(a));
    let res = await this.call("/message/sms/send", form(), token);
    if (res.status === 401) {
      // token expired: log in once more, then give up
      this.tokens.delete(this.key(a));
      token = await this.login(a);
      res = await this.call("/message/sms/send", form(), token);
    }
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as { id?: string } | null;
      return { id: json?.id ?? null };
    }
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    // 400/422: bad phone or a text Eskiz does not accept (not an approved template) — retrying won't help
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 422) throw new SmsError("permanent", `eskiz ${res.status}: ${detail}`);
    throw new SmsError("transient", `eskiz ${res.status}: ${detail}`);
  }
}
