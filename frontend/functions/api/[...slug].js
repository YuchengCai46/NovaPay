// Pages Function - proxy all API requests to the Worker
export const onRequest = async (context) => {
  const { request, env } = context;
  const slug = context.params.slug;
  const path = '/api/' + slug.join('/');
  
  const url = new URL(path, 'http://novapay-api.caiyucheng32.workers.dev');
  url.protocol = 'http:';
  
  const proxyResponse = await fetch(url.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  
  return new Response(proxyResponse.body, {
    status: proxyResponse.status,
    headers: {
      ...Object.fromEntries(proxyResponse.headers),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    }
  });
};
