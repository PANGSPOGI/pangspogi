import {
  createFarm,
  deleteFarm,
  fetchFarms,
  getAppsScriptErrorMessage,
  logAppsScriptError,
} from '../../lib/apps-script';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      return res.status(200).json(await fetchFarms());
    } catch (error) {
      if (!error.statusCode || error.statusCode >= 500) {
        logAppsScriptError('Failed to load farms:', error);
      }
      return res.status(error.statusCode || 500).json({
        error: getAppsScriptErrorMessage(error),
      });
    }
  }

  if (req.method === 'POST') {
    try {
      return res.status(200).json(await createFarm(req.body || {}));
    } catch (error) {
      if (!error.statusCode || error.statusCode >= 500) {
        logAppsScriptError('Failed to create farm:', error);
      }
      return res.status(error.statusCode || 500).json({
        error: error.statusCode === 400 ? error.message : getAppsScriptErrorMessage(error),
      });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const farmId = Array.isArray(req.query.farmId) ? '' : req.query.farmId;
      return res.status(200).json(await deleteFarm(farmId));
    } catch (error) {
      if (!error.statusCode || error.statusCode >= 500) {
        logAppsScriptError('Failed to delete farm:', error);
      }
      return res.status(error.statusCode || 500).json({
        error: error.statusCode === 400 ? error.message : getAppsScriptErrorMessage(error),
      });
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed.' });
}
