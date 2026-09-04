export const documentSecurityHeaders = {
  "Content-Security-Policy":
    "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://checkout.stripe.com",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.stripe.com")',
};
