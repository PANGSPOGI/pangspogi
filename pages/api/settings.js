import {
  fetchSettings,
  getAppsScriptErrorMessage,
  logAppsScriptError,
  saveSettings,
} from '../../lib/apps-script';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      return res.status(200).json(await fetchSettings(String(req.query.farmId || 'mango-farm')));
    } catch (error) {
      if (!error.statusCode || error.statusCode >= 500) {
        logAppsScriptError('Failed to load settings:', error);
      }
      return res.status(error.statusCode || 500).json({
        error: getAppsScriptErrorMessage(error),
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      return res.status(200).json(await saveSettings(
        body.settings || {},
        String(body.farmId || 'mango-farm')
      ));
    } catch (error) {
      if (!error.statusCode || error.statusCode >= 500) {
        logAppsScriptError('Failed to save settings:', error);
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
