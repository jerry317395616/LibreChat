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
  getSsoStartUrl: jest.fn(),
}));

const { setAuthTokens } = require('~/server/services/AuthService');
const {
  exchangeFrappeToken,
  findOrCreateSsoUser,
  getSsoStartUrl,
} = require('~/server/services/IoneSsoService');
const { ioneSsoController, ioneSsoStartController } = require('./IoneSsoController');

const response = () => ({
  set: jest.fn(),
  redirect: jest.fn(),
});

describe('ioneSsoController', () => {
  beforeEach(() => jest.clearAllMocks());

  test('starts login at the configured Manager entry', () => {
    const req = { ip: '127.0.0.1' };
    const res = response();
    getSsoStartUrl.mockReturnValue('https://manager.example.com/agent');

    ioneSsoStartController(req, res);

    expect(res.redirect).toHaveBeenCalledWith(302, 'https://manager.example.com/agent');
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store, max-age=0');
  });

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

  test('returns to the non-looping recovery login when the exchange fails', async () => {
    const req = { query: { token: 'expired-token' }, ip: '127.0.0.1' };
    const res = response();
    exchangeFrappeToken.mockRejectedValue(new Error('expired'));

    await ioneSsoController(req, res);

    expect(setAuthTokens).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/login?error=auth_failed&redirect=false');
  });
});
