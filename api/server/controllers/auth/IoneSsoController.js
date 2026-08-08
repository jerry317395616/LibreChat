const { logger } = require('@librechat/data-schemas');
const { setAuthTokens } = require('~/server/services/AuthService');
const {
  exchangeFrappeToken,
  findOrCreateSsoUser,
  getSsoStartUrl,
} = require('~/server/services/IoneSsoService');

const setPrivateResponseHeaders = (res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Referrer-Policy', 'no-referrer');
};

const ioneSsoStartController = (req, res) => {
  setPrivateResponseHeaders(res);
  try {
    return res.redirect(302, getSsoStartUrl());
  } catch (error) {
    logger.warn('[IoneSsoController] SSO start failed', {
      error: error?.message,
      ip: req.ip,
    });
    return res.redirect('/login?error=auth_failed&redirect=false');
  }
};

const ioneSsoController = async (req, res) => {
  setPrivateResponseHeaders(res);
  try {
    const profile = await exchangeFrappeToken(req.query?.token);
    const user = await findOrCreateSsoUser(profile);
    await setAuthTokens(user._id, res, null, req);
    return res.redirect('/c/new');
  } catch (error) {
    logger.warn('[IoneSsoController] SSO login failed', {
      error: error?.message,
      ip: req.ip,
    });
    return res.redirect('/login?error=auth_failed&redirect=false');
  }
};

module.exports = {
  ioneSsoController,
  ioneSsoStartController,
  setPrivateResponseHeaders,
};
