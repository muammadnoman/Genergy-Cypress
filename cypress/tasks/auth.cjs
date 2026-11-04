const identity = require('../config/staging-auth.json');
let cached;

async function apiToken(timeout = 20000) {
  if (cached && cached.expires > Date.now() + 60000) return cached.token;
  if (!process.env.UM_EMAIL || !process.env.UM_PASSWORD) throw new Error('Configure private UM login first.');
  const response = await fetch(`https://cognito-idp.${identity.region}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: identity.clientId,
      AuthParameters: { USERNAME: process.env.UM_EMAIL, PASSWORD: process.env.UM_PASSWORD },
    }),
    signal: AbortSignal.timeout(timeout),
  });
  const body = await response.json();
  if (!response.ok || !body.AuthenticationResult?.IdToken) {
    throw new Error(`Staging API authentication failed (${response.status}); check account/challenge configuration.`);
  }
  cached = { token: body.AuthenticationResult.IdToken, expires: Date.now() + body.AuthenticationResult.ExpiresIn * 1000 };
  return cached.token;
}

module.exports = { apiToken };
