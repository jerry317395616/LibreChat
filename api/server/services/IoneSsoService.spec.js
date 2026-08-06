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
const { exchangeFrappeToken, findOrCreateSsoUser, normalizeUsername } = require('./IoneSsoService');

describe('IoneSsoService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      IONE_SSO_FRAPPE_URL: 'https://manager.example.com',
      IONE_SSO_SHARED_SECRET: 'a'.repeat(64),
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('exchanges a token without exposing it in the request URL', async () => {
    const token = 'A'.repeat(64);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { subject: 'Administrator', email: 'admin@example.com' },
      }),
    });

    await expect(exchangeFrappeToken(token)).resolves.toMatchObject({
      subject: 'Administrator',
      email: 'admin@example.com',
    });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url.toString()).not.toContain(token);
    expect(JSON.parse(options.body)).toEqual({ token });
    expect(options.headers['X-I-ONE-SSO-Secret']).toBe('a'.repeat(64));
  });

  test('reuses an existing email account and verifies it', async () => {
    findUser.mockResolvedValue({ _id: 'existing', emailVerified: false, name: 'Admin' });
    updateUser.mockResolvedValue({ _id: 'existing', emailVerified: true, name: 'Admin' });

    const user = await findOrCreateSsoUser({
      subject: 'Administrator',
      email: 'ADMIN@example.com',
      name: 'Admin',
    });

    expect(updateUser).toHaveBeenCalledWith('existing', { emailVerified: true });
    expect(createUser).not.toHaveBeenCalled();
    expect(user.emailVerified).toBe(true);
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
