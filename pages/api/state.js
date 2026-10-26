import { fetchLatestState, getAppsScriptErrorMessage, logAppsScriptError } from '../../lib/apps-script';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const state = await fetchLatestState();
    return res.status(200).json(state);
  } catch (error) {
    logAppsScriptError('Failed to load tracker state:', error);
    return res.status(error.statusCode || 500).json({
      error: getAppsScriptErrorMessage(error),
    });
  }
}
