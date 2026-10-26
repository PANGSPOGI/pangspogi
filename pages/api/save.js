import { getAppsScriptErrorMessage, logAppsScriptError, saveReadings } from '../../lib/apps-script';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const result = await saveReadings(req.body);
    return res.status(200).json(result);
  } catch (error) {
    if (!error.statusCode || error.statusCode >= 500) {
      logAppsScriptError('Failed to save tracker readings:', error);
    }
    return res.status(error.statusCode || 500).json({
      error: error.statusCode === 400 ? error.message : getAppsScriptErrorMessage(error),
    });
  }
}
