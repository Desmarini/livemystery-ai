export const config = {
  path: '/api/health',
};

export default async () => Response.json({
  service: 'livemystery-ai',
  deployment: 'netlify-foundation',
  status: 'ok',
});
