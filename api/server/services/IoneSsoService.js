const { randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { logger } = require('@librechat/data-schemas');
const { SystemRoles } = require('librechat-data-provider');
const { findUser, createUser, updateUser } = require('~/models');
const { getAppConfig } = require('~/server/services/Config');

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{48,160}$/;
const DEFAULT_TIMEOUT_MS = 15000;
const SSO_ENDPOINT = '/api/method/ione_agent.sso.consume_login_token';

const getSsoConfig = () => {
  const baseUrl = String(process.env.IONE_SSO_FRAPPE_URL || '').trim();
  const sharedSecret = String(process.env.IONE_SSO_SHARED_SECRET || '').trim();
  if (!baseUrl || sharedSecret.length < 32) {
    throw new Error('I-ONE SSO is not configured');
  }

  const endpoint = new URL(SSO_ENDPOINT, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new Error('I-ONE SSO URL is invalid');
  }
  return { endpoint, sharedSecret };
};

const exchangeFrappeToken = async (token) => {
  if (!TOKEN_PATTERN.test(String(token || ''))) {
    throw new Error('I-ONE SSO token is invalid');
  }

  const { endpoint, sharedSecret } = getSsoConfig();
  const controller = new AbortController();
  const configuredTimeout = Number(process.env.IONE_SSO_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-I-ONE-SSO-Secret': sharedSecret,
      },
      body: JSON.stringify({ token }),
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Frappe rejected I-ONE SSO (${response.status})`);
    }
    const body = await response.json();
    const profile = body?.message;
    if (!profile || typeof profile.email !== 'string' || typeof profile.subject !== 'string') {
      throw new Error('Frappe returned an invalid I-ONE SSO profile');
    }
    return profile;
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeUsername = (profile) => {
  const candidate = String(profile.username || profile.email.split('@')[0] || 'ione-user')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.@-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return candidate.length >= 2 ? candidate.slice(0, 80) : `ione-${candidate || 'user'}`;
};

const findOrCreateSsoUser = async (profile) => {
  const email = String(profile.email || '')
    .trim()
    .toLowerCase();
  const subject = String(profile.subject || '').trim();
  if (!email || !subject) {
    throw new Error('I-ONE SSO profile is incomplete');
  }

  let user = await findUser({ email });
  if (user) {
    const updates = {};
    if (!user.emailVerified) {
      updates.emailVerified = true;
    }
    if (!user.name && profile.name) {
      updates.name = String(profile.name).trim();
    }
    if (Object.keys(updates).length > 0) {
      user = await updateUser(user._id, updates);
    }
    return user;
  }

  const appConfig = await getAppConfig();
  const userData = {
    provider: 'ione',
    idOnTheSource: subject,
    email,
    username: normalizeUsername(profile),
    name: String(profile.name || email).trim(),
    role: SystemRoles.USER,
    emailVerified: true,
    password: bcrypt.hashSync(randomBytes(48).toString('base64url'), 10),
  };

  try {
    return await createUser(userData, appConfig?.balance, true, true);
  } catch (error) {
    if (error?.code === 11000) {
      user = await findUser({ email });
      if (user) {
        return user;
      }
    }
    logger.error('[IoneSsoService] Failed to create SSO user', {
      email,
      error: error?.message,
    });
    throw error;
  }
};

module.exports = {
  TOKEN_PATTERN,
  exchangeFrappeToken,
  findOrCreateSsoUser,
  getSsoConfig,
  normalizeUsername,
};
