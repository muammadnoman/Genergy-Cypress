const identity = require('../config/staging-auth.json');
const tokens = new Map();

function credentials(user) {
  let config;
  try {
    config = require('../config/user.json');
  } catch {
    throw new Error('Create a valid private cypress/config/user.json for staging login.');
  }
  const { defaultUser, users } = config ?? {};
  user ??= defaultUser;
  if (!users || typeof user !== 'string') throw new Error('Configure a default staging user in cypress/config/user.json.');
  if (!Object.hasOwn(users, user)) throw new Error('Select a staging user defined in cypress/config/user.json.');
  const { email, password } = users[user] ?? {};
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    throw new Error('The selected user in cypress/config/user.json needs an email and password.');
  }
  return { email, password };
}

async function apiToken(timeout = 20000, user) {
  const { email, password } = credentials(user);
  const cached = tokens.get(user);
  if (cached && cached.expires > Date.now() + 60000) return cached.token;
  const response = await fetch(`https://cognito-idp.${identity.region}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: identity.clientId,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
    signal: AbortSignal.timeout(timeout),
  });
  const body = await response.json();
  if (!response.ok || !body.AuthenticationResult?.IdToken) {
    throw new Error(`Staging API authentication failed (${response.status}); check account/challenge configuration.`);
  }
  const { IdToken: token, ExpiresIn: lifetime } = body.AuthenticationResult;
  tokens.set(user, { token, expires: Date.now() + lifetime * 1000 });
  return token;
}

module.exports = { apiToken, credentials };
