export function stagingEnvironment(build, source = process.env) {
  const env = { ...source };
  delete env.CLOUDFLARE_ENV;
  delete env.VITE_AUTH_ENABLED;
  if (build) {
    env.CLOUDFLARE_ENV = "staging";
    env.VITE_AUTH_ENABLED = "true";
  }
  return env;
}
