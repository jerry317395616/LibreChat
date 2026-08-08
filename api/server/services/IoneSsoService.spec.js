const http = require('node:http');

jest.mock(
  '@librechat/data-schemas',
  () => ({
    logger: { error: jest.fn() },
  }),
  { virtual: true },
);
jest.mock('librechat-data-provider', () => ({ SystemRoles: { USER: 'USER' } }), { virtual: true });
jest.mock('~/models', () => ({
  findUser: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
}));
jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn(),
}));

const { findUser, createUser, updateUser } = require('~/models');
const { getAppConfig } = require('~/server/services/Config');
const {
  exchangeFrappeToken,
  findOrCreateSsoUser,
  getSsoStartUrl,
  normalizeUsername,
} = require('./IoneSsoService');

describe('IoneSsoService', () => {
  const originalEnv = process.env;
  let server;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      IONE_SSO_SHARED_SECRET: 'a'.repeat(64),
    };
  });

  afterEach(
    () =>
      new Promise((resolve) => {
        if (!server) {
          return resolve();
        }
        server.close(resolve);
        server = null;
      }),
  );

  afterAll(() => {
    process.env = originalEnv;
  });

  test('exchanges a token without exposing it in the request URL', async () => {
    const token = 'A'.repeat(64);
    let captured;
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        captured = { body, headers: req.headers, url: req.url };
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            message: { subject: 'Administrator', email: 'admin@example.com' },
          }),
        );
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.IONE_SSO_FRAPPE_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.IONE_SSO_FRAPPE_HOST = 'manager.example.com';

    await expect(exchangeFrappeToken(token)).resolves.toMatchObject({
      subject: 'Administrator',
      email: 'admin@example.com',
    });

    expect(captured.url).not.toContain(token);
    expect(JSON.parse(captured.body)).toEqual({ token });
    expect(captured.headers['x-i-one-sso-secret']).toBe('a'.repeat(64));
    expect(captured.headers.host).toBe('manager.example.com');
  });

  test('accepts only a secure browser-facing SSO URL', () => {
    process.env.IONE_SSO_PUBLIC_URL = 'https://manager.example.com/agent';
    expect(getSsoStartUrl()).toBe('https://manager.example.com/agent');

    process.env.IONE_SSO_PUBLIC_URL = 'http://manager.example.com/agent';
    expect(() => getSsoStartUrl()).toThrow('I-ONE SSO public URL is invalid');
  });

  test('reuses an existing email account and verifies it', async () => {
    findUser.mockResolvedValue({
      _id: 'existing',
      provider: 'ione',
      idOnTheSource: 'Administrator',
      email: 'admin@example.com',
      emailVerified: false,
      name: 'Admin',
    });
    updateUser.mockResolvedValue({
      _id: 'existing',
      provider: 'ione',
      idOnTheSource: 'Administrator',
      email: 'admin@example.com',
      emailVerified: true,
      name: 'Admin',
    });

    const user = await findOrCreateSsoUser({
      subject: 'Administrator',
      email: 'ADMIN@example.com',
      name: 'Admin',
    });

    expect(updateUser).toHaveBeenCalledWith('existing', { emailVerified: true });
    expect(createUser).not.toHaveBeenCalled();
    expect(user.emailVerified).toBe(true);
  });

  test('binds an existing local account to its Manager identity', async () => {
    findUser.mockResolvedValueOnce(null).mockResolvedValueOnce({
      _id: 'existing',
      provider: 'local',
      email: 'user@example.com',
      emailVerified: false,
      name: 'Old Name',
    });
    updateUser.mockImplementation(async (_id, updates) => ({ _id: 'existing', ...updates }));

    await findOrCreateSsoUser({
      subject: 'user@example.com',
      email: 'user@example.com',
      name: 'Manager User',
    });

    expect(updateUser).toHaveBeenCalledWith('existing', {
      provider: 'ione',
      idOnTheSource: 'user@example.com',
      emailVerified: true,
      name: 'Manager User',
    });
  });

  test('creates a verified SSO-only account with a hashed random password', async () => {
    findUser.mockResolvedValue(null);
    getAppConfig.mockResolvedValue({ balance: { enabled: false } });
    createUser.mockImplementation(async (data) => ({ _id: 'new', ...data }));

    const user = await findOrCreateSsoUser({
      subject: 'user@example.com',
      email: 'user@example.com',
      name: 'Test User',
    });

    expect(user.provider).toBe('ione');
    expect(user.emailVerified).toBe(true);
    expect(user.password).toMatch(/^\$2[aby]\$/);
  });

  test('normalizes Frappe usernames for LibreChat', () => {
    expect(normalizeUsername({ username: ' Zhang San ', email: 'z@example.com' })).toBe(
      'zhang_san',
    );
  });
});
