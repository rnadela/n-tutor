import { afterEach, describe, expect, it, vi } from 'vitest';
import { MailDispatchError, MailService, resolveMailConfig } from './mail.service.js';

function serviceWith(env: Record<string, string>): MailService {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    return new MailService();
  } finally {
    process.env = saved;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('transport resolution', () => {
  it('defaults to the log transport', () => {
    expect(resolveMailConfig({}).transport).toBe('log');
  });

  it('refuses to default to log in production', () => {
    expect(() => resolveMailConfig({ NODE_ENV: 'production' })).toThrow(
      /MAIL_TRANSPORT must be set explicitly/,
    );
    // Stated explicitly, `log` stays an operator's choice.
    expect(
      resolveMailConfig({
        NODE_ENV: 'production',
        MAIL_TRANSPORT: 'log',
        MAIL_FROM: 'no-reply@example.test',
      }).transport,
    ).toBe('log');
  });

  it('refuses to default the sender in production', () => {
    expect(() => resolveMailConfig({ NODE_ENV: 'production', MAIL_TRANSPORT: 'log' })).toThrow(
      /MAIL_FROM must be set/,
    );
  });

  it('refuses a non-positive timeout, which would abort every send', () => {
    expect(() => resolveMailConfig({ MAIL_TIMEOUT_MS: '0' })).toThrow(
      /must be a positive whole number/,
    );
    expect(() => resolveMailConfig({ MAIL_TIMEOUT_MS: '-1' })).toThrow(
      /must be a positive whole number/,
    );
  });

  it('refuses an unrecognised transport rather than falling back', () => {
    expect(() => resolveMailConfig({ MAIL_TRANSPORT: 'smtp' })).toThrow(/MAIL_TRANSPORT must be/);
  });

  it('refuses http without a URL and a key', () => {
    expect(() => resolveMailConfig({ MAIL_TRANSPORT: 'http' })).toThrow(/requires both/);
    expect(() =>
      resolveMailConfig({ MAIL_TRANSPORT: 'http', MAIL_API_URL: 'https://mail.test' }),
    ).toThrow(/requires both/);
  });

  it('accepts a fully configured http transport', () => {
    const config = resolveMailConfig({
      MAIL_TRANSPORT: 'http',
      MAIL_API_URL: 'https://mail.test',
      MAIL_API_KEY: 'key',
      MAIL_TIMEOUT_MS: '2500',
    });
    expect(config).toMatchObject({
      transport: 'http',
      apiUrl: 'https://mail.test',
      timeoutMs: 2500,
    });
  });
});

describe('the log transport', () => {
  it('actually emits the message', async () => {
    const mail = serviceWith({ MAIL_TRANSPORT: 'log', MAIL_FROM: 'no-reply@example.test' });
    const emitted: string[] = [];
    vi.spyOn(mail['logger'], 'log').mockImplementation((message: unknown) => {
      emitted.push(String(message));
    });

    await mail.send({ to: 'parent@example.test', subject: 'Reset', text: 'link' });

    expect(emitted).toHaveLength(1);
    expect(JSON.parse(emitted[0]!)).toMatchObject({
      event: 'mail.send',
      from: 'no-reply@example.test',
      to: 'parent@example.test',
      subject: 'Reset',
    });
  });
});

describe('the http transport', () => {
  const httpMail = () =>
    serviceWith({
      MAIL_TRANSPORT: 'http',
      MAIL_API_URL: 'https://mail.test/send',
      MAIL_API_KEY: 'key',
      MAIL_FROM: 'no-reply@example.test',
    });

  it('posts the message as JSON with a bearer key', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    await httpMail().send({ to: 'parent@example.test', subject: 'Reset', text: 'link' });

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://mail.test/send');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer key');
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'no-reply@example.test',
      to: 'parent@example.test',
      subject: 'Reset',
      text: 'link',
    });
  });

  it('raises MailDispatchError on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 502 })),
    );

    await expect(
      httpMail().send({ to: 'parent@example.test', subject: 'Reset', text: 'link' }),
    ).rejects.toBeInstanceOf(MailDispatchError);
  });

  it('raises MailDispatchError when fetch itself throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    await expect(
      httpMail().send({ to: 'parent@example.test', subject: 'Reset', text: 'link' }),
    ).rejects.toBeInstanceOf(MailDispatchError);
  });
});
