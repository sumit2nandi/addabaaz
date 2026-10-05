// Stable error contract shared by provider-specific social identity verifiers.
export class SocialError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'SocialError';
    this.code = code;
  }
}
