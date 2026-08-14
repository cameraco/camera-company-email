const EXPORT_FILES = {
  customers: {
    path: process.env.DROPBOX_CUSTOMERS_PATH || "/Sales Tracking/Access Sales and Inventory Reporting/customers.csv",
    filename: "customers.csv",
  },
  sales: {
    path: process.env.DROPBOX_EXPORT_PATH || "/Sales Tracking/Access Sales and Inventory Reporting/sales_export.csv",
    filename: "sales_export.csv",
  },
};
const zlib = require("zlib");

exports.handler = async function handler(event) {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { Allow: "GET" },
      body: "Method not allowed",
    };
  }

  const requestedExport = (event.queryStringParameters && event.queryStringParameters.export) || "customers";
  const exportFile = EXPORT_FILES[requestedExport];
  if (!exportFile) {
    return {
      statusCode: 400,
      body: `Unknown export requested: ${requestedExport}`,
    };
  }

  try {
    await verifyEmailAccess(event);
    const accessToken = await getDropboxAccessToken();
    const response = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Dropbox-API-Arg": JSON.stringify({ path: exportFile.path }),
      },
    });

    if (!response.ok) {
      const detail = await response.text();
      return {
        statusCode: response.status,
        body: `Dropbox download failed: ${detail}`,
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const compressed = zlib.gzipSync(buffer);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFile.filename}"`,
        "Content-Encoding": "gzip",
        "Cache-Control": "no-store",
      },
      body: compressed.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      body: error.message || "Unexpected Dropbox error",
    };
  }
};

async function verifyEmailAccess(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const username = event.headers["x-cc-username"] || event.headers["X-CC-Username"] || "";
  const token = (
    event.headers["x-cc-auth-token"] ||
    event.headers["X-CC-Auth-Token"] ||
    authHeader.replace(/^Bearer\s+/i, "")
  ).trim();
  if (!token || !username) {
    const error = new Error("Your sign-in token was not sent to the Dropbox loader. Please refresh, sign out, and sign in again.");
    error.statusCode = 401;
    throw error;
  }

  const url = "https://firestore.googleapis.com/v1/projects/camera-company-accounts/databases/(default)/documents/accountUsers/" + encodeURIComponent(username);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const error = new Error("Could not verify email app access. Please sign out and sign in again.");
    error.statusCode = 403;
    throw error;
  }

  const profile = await response.json();
  const emailAccess = ((profile.fields || {}).emailAccess || {}).booleanValue;
  if (!emailAccess) {
    const error = new Error("Your account does not have Camera Company Email access yet.");
    error.statusCode = 403;
    throw error;
  }
}

async function getDropboxAccessToken() {
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;

  if (appKey && appSecret && refreshToken) {
    return refreshDropboxAccessToken(appKey, appSecret, refreshToken);
  }

  if (process.env.DROPBOX_ACCESS_TOKEN) {
    return process.env.DROPBOX_ACCESS_TOKEN;
  }

  throw new Error("Missing Dropbox environment variables.");
}

async function refreshDropboxAccessToken(appKey, appSecret, refreshToken) {
  if (!appKey || !appSecret || !refreshToken) {
    throw new Error("Missing Dropbox environment variables.");
  }

  const credentials = Buffer.from(`${appKey}:${appSecret}`).toString("base64");
  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Dropbox token refresh failed: ${detail}`);
  }

  const data = await response.json();
  return data.access_token;
}
