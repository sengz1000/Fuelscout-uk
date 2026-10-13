const API_BASE = (
  process.env.FUEL_FINDER_API_BASE_URL ||
  "https://www.fuel-finder.service.gov.uk"
).replace(/\/+$/, "");

const TOKEN_URL = `${API_BASE}/api/v1/oauth/generate_access_token`;
const PRICES_URL = `${API_BASE}/api/v1/pfs/fuel-prices`;

exports.handler = async function () {
  const clientId = process.env.FUEL_FINDER_CLIENT_ID;
  const clientSecret = process.env.FUEL_FINDER_CLIENT_SECRET;

  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  try {
    // 1. Check that the required credentials exist.
    if (!clientId || !clientSecret) {
      throw new Error(
        "Fuel Finder Client ID or Client Secret is missing."
      );
    }

    // 2. Request an OAuth 2.0 access token.
    async function requestToken() {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "fuelFinder.read"
      });

      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json"
        },
        body: body.toString()
      });

      const responseText = await response.text();

      let result;

      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error(
          `Token endpoint returned invalid or empty JSON (HTTP ${response.status}).`
        );
      }

      if (!response.ok) {
        const detail =
          result.error_description ||
          result.message ||
          result.error ||
          "Authentication failed.";

        throw new Error(
          `Fuel Finder token request failed (HTTP ${response.status}): ${detail}`
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

    const accessToken = await requestToken();

    // 3. Retrieve fuel prices in batches.
    const stations = [];
    let batchNumber = 1;

    while (batchNumber <= 100) {
      const url = new URL(PRICES_URL);

      url.searchParams.set(
        "batch-number",
        String(batchNumber)
      );

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/json"
        }
      });

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          `Fuel price request failed (HTTP ${response.status}) for batch ${batchNumber}.`
        );
      }

      if (!responseText.trim()) {
        throw new Error(
          `Fuel Finder returned an empty response for batch ${batchNumber}.`
        );
      }

      let batch;

      try {
        batch = JSON.parse(responseText);
      } catch {
        throw new Error(
          `Fuel Finder returned invalid JSON for batch ${batchNumber}.`
        );
      }

      // Support either an array or an object containing the results.
      if (!Array.isArray(batch)) {
        batch =
          batch.data ||
          batch.stations ||
          batch.results;
      }

      if (!Array.isArray(batch)) {
        throw new Error(
          `Unexpected fuel price response format for batch ${batchNumber}.`
        );
      }

      if (batch.length === 0) {
        break;
      }

      stations.push(...batch);

      // Stop when the final batch contains fewer than 500 records.
      if (batch.length < 500) {
        break;
      }

      batchNumber++;
    }

    // 4. Return the retrieved prices.
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
    // 5. Log the error without exposing credentials or tokens.
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
