const { randomBytes } = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
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
  const hostHeader = String(process.env.IONE_SSO_FRAPPE_HOST || '').trim();
  const sharedSecret = String(process.env.IONE_SSO_SHARED_SECRET || '').trim();
  if (!baseUrl || sharedSecret.length < 32) {
    throw new Error('I-ONE SSO is not configured');
  }

  const endpoint = new URL(SSO_ENDPOINT, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new Error('I-ONE SSO URL is invalid');
  }
  if (/[\r\n]/.test(hostHeader)) {
    throw new Error('I-ONE SSO host header is invalid');
  }
  return { endpoint, hostHeader, sharedSecret };
};

const postJson = ({ endpoint, headers, hostHeader, payload, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const client = endpoint.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);
    const request = client.request(
      endpoint,
      {
        method: 'POST',
        headers: {
          ...headers,
          ...(hostHeader ? { Host: hostHeader } : {}),
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
          if (responseBody.length > 1024 * 1024) {
            request.destroy(new Error('I-ONE SSO response is too large'));
          }
        });
        response.on('end', () => {
          resolve({ body: responseBody, status: response.statusCode || 500 });
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('I-ONE SSO request timed out')));
    request.on('error', reject);
    request.end(body);
  });

const exchangeFrappeToken = async (token) => {
  if (!TOKEN_PATTERN.test(String(token || ''))) {
    throw new Error('I-ONE SSO token is invalid');
  }

  const { endpoint, hostHeader, sharedSecret } = getSsoConfig();
  const configuredTimeout = Number(process.env.IONE_SSO_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : DEFAULT_TIMEOUT_MS;
  const response = await postJson({
    endpoint,
    hostHeader,
    headers: {
      'Content-Type': 'application/json',
      'X-I-ONE-SSO-Secret': sharedSecret,
    },
    payload: { token },
    timeoutMs,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Frappe rejected I-ONE SSO (${response.status})`);
  }
  let responseBody;
  try {
    responseBody = JSON.parse(response.body);
  } catch {
    throw new Error('Frappe returned invalid I-ONE SSO JSON');
  }
  const profile = responseBody?.message;
  if (!profile || typeof profile.email !== 'string' || typeof profile.subject !== 'string') {
    throw new Error('Frappe returned an invalid I-ONE SSO profile');
  }
  return profile;
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
  postJson,
};
