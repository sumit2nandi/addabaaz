// Real RSA-signed fixtures behind mocked Google endpoints. No production bypass.
import { clientId, email, jwk, token } from '../google-fixture.mjs';
export async function mockGoogle(context, { autoSignIn = true, claims = {}, config = { clientId, allowedEmails: [email] }, failScript = false } = {}) {
  await context.exposeBinding('__testGoogleCredential', (_source, nonce) => token(nonce, claims));
  await context.route('**/config/admin-auth.json*', route => route.fulfill({ json: config }));
  await context.route('https://www.googleapis.com/oauth2/v3/certs', route => route.fulfill({ json: { keys: [jwk] } }));
  await context.route('https://accounts.google.com/gsi/client', route => {
    if (failScript) return route.abort();
    return route.fulfill({ contentType: 'application/javascript', body: `
      let options;
      window.google = { accounts: { id: {
        initialize(value) { options = value; },
        renderButton(container) {
          const button = document.createElement('button');
          button.textContent = 'Sign in with Google';
          button.onclick = async () => options.callback({ credential: await window.__testGoogleCredential(options.nonce) });
          container.append(button);
          ${autoSignIn ? 'setTimeout(() => button.click(), 0);' : ''}
        },
        disableAutoSelect() {}
      } } };
    ` });
  });
}
