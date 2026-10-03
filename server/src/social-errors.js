// Stable error contract shared by provider-specific social identity verifiers.
export class SocialError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SocialError';
    this.code = code;
  }
}
