// Minimal Odoo external API client over JSON-RPC.
//
// Odoo exposes the same "external API" over both XML-RPC and JSON-RPC.
// JSON-RPC is used here because it needs nothing beyond `fetch` - no XML
// parsing library, which keeps this dependency-free and easy to run in a
// serverless function.
//
// Auth model: db + username + API key. There's no persistent session -
// every call re-authenticates (cheap) and then calls object.execute_kw.
// Generate an API key in Odoo under the user's profile -> Account Security.

interface OdooConfig {
  url: string;
  db: string;
  username: string;
  apiKey: string;
}

function getConfig(): OdooConfig {
  const url = process.env.ODOO_URL;
  const db = process.env.ODOO_DB;
  const username = process.env.ODOO_USERNAME;
  const apiKey = process.env.ODOO_API_KEY;

  if (!url || !db || !username || !apiKey) {
    throw new Error(
      "Odoo is not configured. Set ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY.",
    );
  }

  return { url: url.replace(/\/$/, ""), db, username, apiKey };
}

let requestId = 0;

async function jsonRpcCall<T>(
  baseUrl: string,
  service: "common" | "object",
  method: string,
  args: unknown[],
): Promise<T> {
  const res = await fetch(`${baseUrl}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: ++requestId,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Odoo request failed: HTTP ${res.status}`);
  }

  const body = await res.json();
  if (body.error) {
    const message =
      body.error.data?.message ?? body.error.message ?? "Unknown Odoo error";
    throw new Error(`Odoo error: ${message}`);
  }

  return body.result as T;
}

async function authenticate(config: OdooConfig): Promise<number> {
  const uid = await jsonRpcCall<number>(config.url, "common", "authenticate", [
    config.db,
    config.username,
    config.apiKey,
    {},
  ]);

  if (!uid) {
    throw new Error(
      "Odoo authentication failed - check ODOO_DB/ODOO_USERNAME/ODOO_API_KEY.",
    );
  }

  return uid;
}

/** Low-level: call any method on any model the configured user can access. */
export async function executeKw<T>(
  model: string,
  method: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {},
): Promise<T> {
  const config = getConfig();
  const uid = await authenticate(config);

  return jsonRpcCall<T>(config.url, "object", "execute_kw", [
    config.db,
    uid,
    config.apiKey,
    model,
    method,
    args,
    kwargs,
  ]);
}

/** Convenience wrapper around the common search_read pattern. */
export async function searchRead<T>(
  model: string,
  domain: unknown[],
  fields: string[],
  options: { limit?: number; offset?: number; order?: string } = {},
): Promise<T[]> {
  return executeKw<T[]>(model, "search_read", [domain], {
    fields,
    ...options,
  });
}
