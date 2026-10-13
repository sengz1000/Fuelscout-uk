const API_BASE = (
  process.env.FUEL_FINDER_API_BASE_URL ||
  "https://www.fuel-finder.service.gov.uk"
).replace(/\/+$/, "");

const TOKEN_URL = `${API_BASE}/api/v1/oauth/generate_access_token`;
const REFRESH_URL = `${API_BASE}/api/v1/oauth/regenerate_access_token`;
const PRICES_URL = `${API_BASE}/api/v1/pfs/fuel-prices`;

exports.handler = async function () {
  const clientId = process.env.FUEL_FINDER_CLIENT_ID;
  const clientSecret = process.env.FUEL_FINDER_CLIENT_SECRET;

  const headers = {
    "content-type": "application/json",
    "cache-control": "no-store"
  };

  try {
    if (!clientId || !clientSecret) {
      throw new Error(
        "Fuel Finder credentials are not configured."
      );
    }

    async function requestToken(url, payload) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify(payload)
      });

      const responseText = await response.text();
      let result = null;

      try {
        if (responseText.trim()) {
          result = JSON.parse(responseText);
        }
      } catch {
        if (!response.ok) {
          throw new Error(
            `Fuel Finder token request failed ` +
            `(HTTP ${response.status}). ` +
            `Response: ${responseText.slice(0, 250)}`
          );
        }

        throw new Error(
          `Fuel Finder returned invalid JSON ` +
          `(HTTP ${response.status}).`
        );
      }

      if (!response.ok || result?.success === false) {
        const detail =
          result?.message ||
          result?.error ||
          responseText.slice(0, 250) ||
          "Empty response";

        throw new Error(
          `Fuel Finder token request failed ` +
          `(HTTP ${response.status}). ${detail}`
        );
      }

      const data = result?.data || result;

      if (!data?.access_token) {
        throw new Error(
          "Fuel Finder response did not contain an access token."
        );
      }

      return data.access_token;
    }

    // Diagnostic test: use client credentials directly.
    // Refresh-token authentication is temporarily bypassed.
    const accessToken = await requestToken(TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret
    });

    const stations = [];
    let batchNumber = 1;

    while (batchNumber <= 100) {
      const response = await fetch(
        `${PRICES_URL}?batch-number=${batchNumber}`,
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: "application/json"
          }
        }
      );

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          `Fuel price request failed ` +
          `(HTTP ${response.status}): ` +
          responseText.slice(0, 250)
        );
      }

      if (!responseText.trim()) {
        throw new Error(
          `Fuel Finder returned an empty response ` +
          `for batch ${batchNumber}.`
        );
      }

      let batch;

      try {
        batch = JSON.parse(responseText);
      } catch {
        throw new Error(
          `Fuel Finder returned invalid JSON ` +
          `for batch ${batchNumber}.`
        );
      }

      if (!Array.isArray(batch) || batch.length === 0) {
        break;
      }

      stations.push(...batch);

      if (batch.length < 500) {
        break;
      }

      batchNumber++;
    }

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
        error: "FUEL_DATA_UNAVAILABLE",
        message: error.message,
        stations: []
      })
    };
  }
};

