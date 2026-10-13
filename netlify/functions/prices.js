const API_BASE = process.env.FUEL_FINDER_API_BASE_URL;
const CLIENT_ID = process.env.FUEL_FINDER_CLIENT_ID;
const CLIENT_SECRET = process.env.FUEL_FINDER_CLIENT_SECRET;

const TOKEN_PATH = "/api/v1/oauth/generate_access_token";
const PRICES_PATH = "/api/v1/pfs/fuel-prices";

const TIMEOUT_MS = 15000;
const MAX_BATCHES = 100;

const RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function sendResponse(statusCode, body) {
  return {
    statusCode,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify(body),
  };
}

function redactSensitiveData(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(
      /("(?:client_secret|access_token|refresh_token|client_id)"\s*:\s*)"[^"]*"/gi,
      '$1"[REDACTED]"'
    )
    .replace(
      /("(?:authorization|cookie|set-cookie)"\s*:\s*)"[^"]*"/gi,
      '$1"[REDACTED]"'
    )
    .replace(
      /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
      "$1[REDACTED]"
    );
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponse(res) {
  const raw = await res.text();

  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      // The response was not valid JSON.
    }
  }

  return { raw, data };
}

function getConfiguration() {
  if (!API_BASE || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "Missing environment variables. Check " +
      "FUEL_FINDER_API_BASE_URL, FUEL_FINDER_CLIENT_ID, " +
      "and FUEL_FINDER_CLIENT_SECRET in Netlify."
    );
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(API_BASE);
  } catch {
    throw new Error(
      "FUEL_FINDER_API_BASE_URL is not a valid URL."
    );
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error(
      "FUEL_FINDER_API_BASE_URL must use HTTPS."
    );
  }

  return {
    baseUrl: API_BASE.replace(/\/+$/, ""),
  };
}

async function getAccessToken(baseUrl) {
  const tokenUrl = `${baseUrl}${TOKEN_PATH}`;

  console.log("Starting Fuel Finder authentication.");

  let res;

  try {
    res = await fetchWithTimeout(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        "Fuel Finder authentication request timed out."
      );
    }

    console.error("Fuel Finder connection failed:", {
      errorName: error.name,
    });

    throw new Error(
      "Could not connect to the Fuel Finder authentication endpoint."
    );
  }

  const result = await readResponse(res);

  console.log("Fuel Finder token endpoint diagnostic:", {
    httpStatus: res.status,
    contentType: res.headers.get("content-type"),
    responseLength: result.raw.length,
    validJson: result.data !== null,
  });

  if (!res.ok) {
    console.error("Fuel Finder authentication rejection:", {
      httpStatus: res.status,
      response: redactSensitiveData(result.raw).slice(0, 1000),
    });

    throw new Error(
      `Fuel Finder authentication failed with HTTP ${res.status}.`
    );
  }

  if (!result.data) {
    throw new Error(
      "Fuel Finder returned an empty or invalid JSON response."
    );
  }

  const payload = result.data.data || result.data;
  const accessToken = payload.access_token;

  if (!accessToken) {
    console.error(
      "Fuel Finder response did not contain an access token."
    );

    throw new Error(
      "Fuel Finder did not return an access token."
    );
  }

  console.log("Fuel Finder authentication succeeded.");

  return accessToken;
}

async function getPriceBatch(baseUrl, batchNumber, accessToken) {
  const url = new URL(`${baseUrl}${PRICES_PATH}`);

  url.searchParams.set("batch-number", String(batchNumber));

  let res;

  try {
    res = await fetchWithTimeout(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        `Fuel Finder price request timed out on batch ${batchNumber}.`
      );
    }

    throw new Error(
      `Could not connect to Fuel Finder prices on batch ${batchNumber}.`
    );
  }

  const result = await readResponse(res);

  if (!res.ok) {
    console.error("Fuel Finder price endpoint rejection:", {
      httpStatus: res.status,
      batchNumber,
      response: redactSensitiveData(result.raw).slice(0, 1000),
    });

    throw new Error(
      `Fuel Finder price request failed with HTTP ${res.status}.`
    );
  }

  if (!result.data) {
    throw new Error(
      `Fuel Finder returned invalid JSON for batch ${batchNumber}.`
    );
  }

  return result.data;
}

function extractRecords(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const possibleArrays = [
    payload.data,
    payload.stations,
    payload.results,
    payload.fuel_prices,
  ];

  for (const item of possibleArrays) {
    if (Array.isArray(item)) {
      return item;
    }
  }

  return [];
}

async function getAllPrices(baseUrl, accessToken) {
  const allPrices = [];

  for (
    let batchNumber = 1;
    batchNumber <= MAX_BATCHES;
    batchNumber++
  ) {
    const payload = await getPriceBatch(
      baseUrl,
      batchNumber,
      accessToken
    );

    const records = extractRecords(payload);

    if (records.length === 0) {
      break;
    }

    allPrices.push(...records);

    if (records.length < 500) {
      break;
    }
  }

  return allPrices;
}

exports.handler = async function (event) {
  if (event.httpMethod !== "GET") {
    return sendResponse(405, {
      success: false,
      error: "Method not allowed. Use GET.",
    });
  }

  try {
    const { baseUrl } = getConfiguration();

    const accessToken = await getAccessToken(baseUrl);

    const prices = await getAllPrices(
      baseUrl,
      accessToken
    );

    return sendResponse(200, {
      success: true,
      count: prices.length,
      data: prices,
    });
  } catch (error) {
    console.error("FuelScout prices function failed:", {
      message: error.message,
    });

    return sendResponse(502, {
      success: false,
      error: error.message,
    });
  }
};
