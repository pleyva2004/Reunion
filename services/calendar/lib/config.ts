function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  get appUrl() {
    return required('APP_URL').replace(/\/$/, '');
  },
  get google() {
    return {
      clientId: required('GOOGLE_CLIENT_ID'),
      clientSecret: required('GOOGLE_CLIENT_SECRET'),
      redirectUri: required('GOOGLE_REDIRECT_URI'),
    };
  },
  get stateSigningKey() {
    return required('STATE_SIGNING_KEY');
  },
  get internalApiKey() {
    return required('INTERNAL_API_KEY');
  },
  get allowedTestEmails(): Set<string> {
    const raw = process.env.ALLOWED_TEST_EMAILS ?? '';
    return new Set(
      raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
  },
  get butterbase() {
    return {
      appId: required('BUTTERBASE_APP_ID'),
      apiKey: required('BUTTERBASE_API_KEY'),
      baseUrl: process.env.BUTTERBASE_BASE_URL ?? 'https://api.butterbase.ai',
    };
  },
};

export const GOOGLE_FREEBUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';
export const GOOGLE_USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
