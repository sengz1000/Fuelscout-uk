// FuelScout UK data adapter. This endpoint intentionally returns no prices until
// an authorised live provider has been configured. Do not invent or scrape prices.
exports.handler = async function () {
  return {
    statusCode: 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify({
      error: 'FUEL_DATA_NOT_CONFIGURED',
      message: 'Connect an authorised UK Fuel Finder-compatible data feed before launch.',
      stations: []
    })
  };
};
