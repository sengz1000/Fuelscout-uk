const API_BASE = (
  process.env.FUEL_FINDER_API_BASE_URL ||
  "https://www.fuel-finder.service.gov.uk"
).replace(/\/+$/, "");

const TOKEN_URL =
  `${API_BASE}/api/v1/oauth/generate_access_token`;

const PRICES_URL =
  `${API_BASE}/api/v1/pfs/fuel-prices`;

const REQUEST_TIMEOUT_MS = 15000;
const MAX_BATCHES = 100;

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

// Fetch with a timeout so requests cannot wait indefinitely.
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        "Fuel Finder request timed out after 15 seconds."
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Parse JSON while handling empty or invalid responses.
async function readJson(response, operation) {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(
      `${operation} returned an empty response (HTTP ${response.status}).`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${operation} returned invalid JSON (HTTP ${response.status}).`
    );
  }
}

// Obtain an OAuth access token.
async function requestToken(clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "fuelFinder.read"
  });

  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body: body.toString()
  });

  const result = await readJson(
    response,
    "Fuel Finder authentication"
  );

  if (!response.ok || result.success === false) {
    throw new Error(
      `Fuel Finder authentication failed (HTTP ${response.status}).`
    );
  }

  const data = result.data || result;

  if (!data.access_token) {
    throw new Error(
      "Fuel Finder did not return an access token."
    );
  }

  return data.access_token;
}

// Retrieve one batch of fuel prices.
async function requestBatch(accessToken, batchNumber) {
  const url = new URL(PRICES_URL);

  url.searchParams.set(
    "batch-number",
    String(batchNumber)
  );

  const response = await fetchWithTimeout(url.toString(), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/json"
    }
  });

  const result = await readJson(
    response,
    `Fuel price batch ${batchNumber}`
  );

  if (!response.ok) {
    throw new Error(
      `Fuel price request failed (HTTP ${response.status}) for batch ${batchNumber}.`
    );
  }

  let batch = result;

  if (!Array.isArray(batch)) {
    batch =
      result.data ||
      result.stations ||
      result.results;
  }

  if (!Array.isArray(batch)) {
    throw new Error(
      `Unexpected response format for batch ${batchNumber}.`
    );
  }

  return batch;
}

exports.handler = async function () {
  try {
    const clientId =
      process.env.FUEL_FINDER_CLIENT_ID;

    const clientSecret =
      process.env.FUEL_FINDER_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        "Fuel Finder credentials are not configured."
      );
    }

    // Step 1: Authenticate.
    const accessToken = await requestToken(
      clientId,
      clientSecret
    );

    // Step 2: Retrieve prices.
    const stations = [];

    for (
      let batchNumber = 1;
      batchNumber <= MAX_BATCHES;
      batchNumber++
    ) {
      const batch = await requestBatch(
        accessToken,
        batchNumber
      );

      if (batch.length === 0) {
        break;
      }

      stations.push(...batch);

      // Stop when the API returns a partial batch.
      if (batch.length < 500) {
        break;
      }
    }

    // Step 3: Return successful results.
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        count: stations.length,
        stations
      })
    };

  } catch (error) {
    console.error(
      "FuelScout prices error:",
      error.message
    );

    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        success: false,
        error: "FUEL_DATA_UNAVAILABLE",
        message:
          "Live fuel prices could not be retrieved. Please try again later.",
        stations: []
      })
    };
  }
};
  
 
   
