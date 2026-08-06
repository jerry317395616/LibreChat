jest.mock(
  '@librechat/data-schemas',
  () => ({
    logger: { warn: jest.fn() },
  }),
  { virtual: true },
);
jest.mock('~/server/services/AuthService', () => ({
  setAuthTokens: jest.fn(),
}));
jest.mock('~/server/services/IoneSsoService', () => ({
  exchangeFrappeToken: jest.fn(),
  findOrCreateSsoUser: jest.fn(),
}));

const { setAuthTokens } = require('~/server/services/AuthService');
const { exchangeFrappeToken, findOrCreateSsoUser } = require('~/server/services/IoneSsoService');
const { ioneSsoController } = require('./IoneSsoController');

const response = () => ({
  set: jest.fn(),
  redirect: jest.fn(),
});

describe('ioneSsoController', () => {
  beforeEach(() => jest.clearAllMocks());

  test('exchanges the one-time token and creates a LibreChat session', async () => {
    const req = { query: { token: 'valid-token' }, ip: '127.0.0.1' };
    const res = response();
    const profile = { subject: 'Administrator', email: 'admin@example.com' };
    const user = { _id: 'mongo-user-id' };
    exchangeFrappeToken.mockResolvedValue(profile);
    findOrCreateSsoUser.mockResolvedValue(user);

    await ioneSsoController(req, res);

    expect(exchangeFrappeToken).toHaveBeenCalledWith('valid-token');
    expect(findOrCreateSsoUser).toHaveBeenCalledWith(profile);
    expect(setAuthTokens).toHaveBeenCalledWith(user._id, res, null, req);
    expect(res.redirect).toHaveBeenCalledWith('/c/new');
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store, max-age=0');
  });

  test('returns to local login when the exchange fails', async () => {
    const req = { query: { token: 'expired-token' }, ip: '127.0.0.1' };
    const res = response();
    exchangeFrappeToken.mockRejectedValue(new Error('expired'));

    await ioneSsoController(req, res);

    expect(setAuthTokens).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/login?error=sso_failed');
  });
});
