const API_BASE = process.env.FUEL_FINDER_API_BASE_URL;
const CLIENT_ID = process.env.FUEL_FINDER_CLIENT_ID;
const CLIENT_SECRET = process.env.FUEL_FINDER_CLIENT_SECRET;

const TOKEN_PATH = "/api/v1/oauth/generate_access_token";
const PRICES_PATH = "/api/v1/pfs/fuel-prices";

const TIMEOUT_MS = 15000;
const MAX_BATCHES = 100;

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function response(statusCode, body) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body),
  };
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

async function readJsonSafely(res) {
  const text = await res.text();

  if (!text) {
    return {
      data: null,
      raw: "",
    };
  }

  try {
    return {
      data: JSON.parse(text),
      raw: text,
    };
  } catch {
    return {
      data: null,
      raw: text,
    };
  }
}

async function getAccessToken() {
  if (!API_BASE || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "Missing configuration. Check FUEL_FINDER_API_BASE_URL, " +
      "FUEL_FINDER_CLIENT_ID and FUEL_FINDER_CLIENT_SECRET " +
      "in Netlify environment variables."
    );
  }

  const baseUrl = API_BASE.replace(/\/+$/, "");
  const tokenUrl = `${baseUrl}${TOKEN_PATH}`;

  console.log("Fuel Finder authentication started.");

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
      throw new Error("Fuel Finder token request timed out.");
    }

    throw new Error(
      "Could not connect to the Fuel Finder token endpoint."
    );
  }

  const result = await readJsonSafely(res);

  // Never log credentials, tokens, or the complete response body.
  console.log("Fuel Finder token response:", {
    status: res.status,
    contentType: res.headers.get("content-type"),
    validJson: result.data !== null,
    responseLength: result.raw.length,
  });

  if (!res.ok) {
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
    throw new Error(
      "Fuel Finder responded successfully but no access token was found."
    );
  }

  console.log("Fuel Finder authentication succeeded.");

  return accessToken;
}

async function getPriceBatch(batchNumber, accessToken) {
  const baseUrl = API_BASE.replace(/\/+$/, "");
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

  const result = await readJsonSafely(res);

  if (!res.ok) {
    console.error("Fuel Finder price request failed:", {
      status: res.status,
      batchNumber,
    });

    throw new Error(
      `Fuel Finder prices request failed with HTTP ${res.status}.`
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

  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  if (Array.isArray(payload.stations)) {
    return payload.stations;
  }

  if (Array.isArray(payload.results)) {
    return payload.results;
  }

  if (Array.isArray(payload.fuel_prices)) {
    return payload.fuel_prices;
  }

  return [];
}

async function getAllPrices(accessToken) {
  const allPrices = [];

  for (let batchNumber = 1; batchNumber <= MAX_BATCHES; batchNumber++) {
    const payload = await getPriceBatch(batchNumber, accessToken);
    const records = extractRecords(payload);

    if (records.length === 0) {
      break;
    }

    allPrices.push(...records);

    // Stop when the API returns fewer than a full batch.
    if (records.length < 500) {
      break;
    }
  }

  return allPrices;
}

exports.handler = async function (event) {
  if (event.httpMethod !== "GET") {
    return response(405, {
      success: false,
      error: "Method not allowed. Use GET.",
    });
  }

  try {
    const accessToken = await getAccessToken();
    const prices = await getAllPrices(accessToken);

    return response(200, {
      success: true,
      count: prices.length,
      data: prices,
    });
  } catch (error) {
    console.error("FuelScout prices function failed:", error.message);

    return response(502, {
      success: false,
      error: error.message,
    });
  }
};
