import { createHmac, randomBytes } from "node:crypto";

const REQUEST_TOKEN = "https://api.smugmug.com/services/oauth/1.0a/getRequestToken";
const AUTHORIZE = "https://api.smugmug.com/services/oauth/1.0a/authorize";
const ACCESS_TOKEN = "https://api.smugmug.com/services/oauth/1.0a/getAccessToken";
const API = "https://api.smugmug.com";

function encode(value: string) {
  return encodeURIComponent(value)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function sign(opts: {
  method: string;
  url: string;
  extra?: Record<string, string>;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  callback?: string;
  verifier?: string;
}) {
  const oauth: Record<string, string> = {
    oauth_consumer_key: opts.consumerKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
  };
  if (opts.token) oauth.oauth_token = opts.token;
  if (opts.callback) oauth.oauth_callback = opts.callback;
  if (opts.verifier) oauth.oauth_verifier = opts.verifier;
  const all = { ...opts.extra, ...oauth };
  const base = Object.keys(all)
    .sort()
    .map((k) => `${encode(k)}=${encode(all[k]!)}`)
    .join("&");
  const sigBase = `${opts.method.toUpperCase()}&${encode(opts.url)}&${encode(base)}`;
  const key = `${encode(opts.consumerSecret)}&${encode(opts.tokenSecret ?? "")}`;
  oauth.oauth_signature = createHmac("sha1", key).update(sigBase).digest("base64");
  return oauth;
}

function header(oauth: Record<string, string>) {
  return `OAuth ${Object.keys(oauth)
    .sort()
    .map((k) => `${encode(k)}="${encode(oauth[k]!)}"`)
    .join(", ")}`;
}

function form(text: string) {
  const out: Record<string, string> = {};
  for (const part of text.split("&")) {
    if (!part) continue;
    const [k, v] = part.split("=");
    if (k) out[decodeURIComponent(k)] = decodeURIComponent((v ?? "").replace(/\+/g, " "));
  }
  return out;
}

async function oauthFetch(opts: {
  method?: string;
  url: string;
  extra?: Record<string, string>;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  callback?: string;
  verifier?: string;
  accept?: string;
}) {
  const method = opts.method ?? "GET";
  const oauth = sign({ ...opts, method });
  const res = await fetch(opts.url, {
    method,
    headers: {
      Authorization: header(oauth),
      Accept: opts.accept ?? "application/x-www-form-urlencoded",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 280) || `SmugMug ${res.status}`);
  return text;
}

export async function getRequestToken(input: {
  consumerKey: string;
  consumerSecret: string;
  callback: string;
}) {
  const text = await oauthFetch({
    url: REQUEST_TOKEN,
    consumerKey: input.consumerKey,
    consumerSecret: input.consumerSecret,
    callback: input.callback,
  });
  const data = form(text);
  if (!data.oauth_token || !data.oauth_token_secret) {
    throw new Error("SmugMug did not return a request token.");
  }
  return { token: data.oauth_token, secret: data.oauth_token_secret };
}

export function authorizeUrl(token: string) {
  const q = new URLSearchParams({
    oauth_token: token,
    Access: "Full",
    Permissions: "Read",
    username: "whittgoldsmith",
  });
  return `${AUTHORIZE}?${q.toString()}`;
}

export async function getAccessToken(input: {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
  verifier: string;
}) {
  const text = await oauthFetch({
    url: ACCESS_TOKEN,
    consumerKey: input.consumerKey,
    consumerSecret: input.consumerSecret,
    token: input.token,
    tokenSecret: input.tokenSecret,
    verifier: input.verifier,
  });
  const data = form(text);
  if (!data.oauth_token || !data.oauth_token_secret) {
    throw new Error("SmugMug did not return an access token.");
  }
  return { token: data.oauth_token, secret: data.oauth_token_secret };
}

export async function fetchAuthUser(input: {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}) {
  const url = `${API}/api/v2!authuser`;
  const text = await oauthFetch({
    url,
    consumerKey: input.consumerKey,
    consumerSecret: input.consumerSecret,
    token: input.token,
    tokenSecret: input.tokenSecret,
    accept: "application/json",
  });
  const data = JSON.parse(text) as { Response?: { User?: { NickName?: string; Name?: string } } };
  const user = data.Response?.User;
  return {
    nickName: user?.NickName || "whittgoldsmith",
    name: user?.Name || "Whitt Goldsmith",
  };
}
