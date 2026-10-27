import {
  fetchFeedForecast,
  getAppsScriptErrorMessage,
  logAppsScriptError,
  saveFeedForecast,
} from '../../lib/apps-script';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const forecast = await fetchFeedForecast(
        String(req.query.weekStart || ''),
        String(req.query.farmId || 'mango-farm')
      );
      return res.status(200).json(forecast);
    } catch (error) {
      if (!error.statusCode || error.statusCode >= 500) {
        logAppsScriptError('Failed to load feed forecast:', error);
      }
      return res.status(error.statusCode || 500).json({
        error: error.statusCode === 400
          ? error.message
          : getAppsScriptErrorMessage(error),
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const result = await saveFeedForecast(req.body || {});
      return res.status(200).json(result);
    } catch (error) {
      if (!error.statusCode || error.statusCode >= 500) {
        logAppsScriptError('Failed to save feed forecast:', error);
      }
      return res.status(error.statusCode || 500).json({
        error: error.statusCode === 400
          ? error.message
          : getAppsScriptErrorMessage(error),
      });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed.' });
}
