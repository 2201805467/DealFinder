// Explicit opt-in source verification. Never imported by application or tests.
if (process.argv.includes('--live')) {
  const endpoints = [
    'https://www.cheapshark.com/api/1.0/stores',
    'https://www.cheapshark.com/api/1.0/deals?pageSize=20&pageNumber=0',
    'https://www.gamerpower.com/api/giveaways',
  ];
  for (const endpoint of endpoints) {
    const start = Date.now();
    try {
      const r = await fetch(endpoint, {
        headers: {
          'User-Agent': 'DealFinder/0.1 PortfolioDemo',
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
      const body = await r.text();
      if (Buffer.byteLength(body) > 4 * 1024 * 1024)
        throw Error('Oversized response');
      let value;
      try {
        value = JSON.parse(body);
      } catch {
        value = null;
      }
      console.log(
        JSON.stringify({
          endpoint,
          status: r.status,
          durationMs: Date.now() - start,
          headers: {
            date: r.headers.get('date'),
            cacheControl: r.headers.get('cache-control'),
            totalPages: r.headers.get('x-total-page-count'),
            retryAfter: r.headers.get('retry-after'),
          },
          count: Array.isArray(value) ? value.length : null,
          keys:
            Array.isArray(value) && value.length
              ? Object.keys(value[0])
              : Object.keys(value ?? {}),
          sample: Array.isArray(value) ? value.slice(0, 2) : value,
        }),
      );
    } catch (e) {
      console.log(
        JSON.stringify({ endpoint, error: e.name, details: e.message }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  process.exit(0);
}
const url =
  'https://apidocs.cheapshark.com/api/collections/530355/RWTspajP?environment=530355-45dba261-4cf3-4cf2-aaa8-cc00b8ae4533&segregateAuth=true&versionTag=latest';
const response = await fetch(url, {
  headers: { 'User-Agent': 'DealFinder/0.1 PortfolioDemo' },
  signal: AbortSignal.timeout(20000),
});
const json = await response.json();
console.log(
  JSON.stringify({
    status: response.status,
    keys: Object.keys(json),
    description: json.collection?.info?.description ?? json.info?.description,
  }),
);
function walk(items) {
  for (const item of items ?? []) {
    if (item.request)
      console.log(
        JSON.stringify({
          name: item.name,
          url: item.request.url,
          description: item.request.description,
        }),
      );
    else if (item.description)
      console.log(
        JSON.stringify({ section: item.name, description: item.description }),
      );
    if (item.item) walk(item.item);
  }
}
walk(json.collection?.item ?? json.item);
