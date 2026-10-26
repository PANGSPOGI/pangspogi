const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const VALID_HOUSE_NUMBERS = [
  1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
];

export const config = {
  maxDuration: 60,
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
};

function requestError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateImageDataUrl(value) {
  if (typeof value !== 'string') requestError('Choose a silo reading image to upload.', 400);
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) requestError('Upload a JPEG, PNG, or WebP image.', 400);
  const imageBytes = Buffer.from(match[2], 'base64');
  if (imageBytes.length === 0 || imageBytes.length > MAX_IMAGE_BYTES) {
    requestError('The image is empty or too large. Choose a smaller photo.', 400);
  }
  return { mimeType: match[1], data: match[2] };
}

function validateRecognition(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    requestError('The image reader returned an invalid result. Please try another photo.', 502);
  }
  if (
    typeof result.date !== 'string' ||
    (result.date !== '' && !isValidDate(result.date)) ||
    typeof result.time !== 'string' ||
    (result.time !== '' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result.time)) ||
    !Array.isArray(result.readings) ||
    result.readings.length > 12
  ) {
    requestError('The image reader returned invalid date, time, or silo data. Please try again.', 502);
  }

  const seenReadings = new Set();
  const readings = result.readings.map((reading) => {
    if (
      !reading ||
      typeof reading !== 'object' ||
      !VALID_HOUSE_NUMBERS.includes(reading.houseNumber) ||
      !['Silo1', 'Silo2'].includes(reading.silo) ||
      !['level', 'empty', 'full', 'unreadable'].includes(reading.mark) ||
      !Number.isFinite(reading.fillLevelPercent) ||
      reading.fillLevelPercent < 0 ||
      reading.fillLevelPercent > 100 ||
      !Number.isFinite(reading.confidence) ||
      reading.confidence < 0 ||
      reading.confidence > 1 ||
      (reading.mark === 'empty' && reading.fillLevelPercent !== 0) ||
      (reading.mark === 'full' && reading.fillLevelPercent !== 100)
    ) {
      requestError('The image reader returned invalid silo data. Please try another photo.', 502);
    }

    const key = `${reading.houseNumber}-${reading.silo}`;
    if (seenReadings.has(key)) {
      requestError('The image reader returned duplicate silo data. Please try another photo.', 502);
    }
    seenReadings.add(key);

    return {
      house: `FH${reading.houseNumber}`,
      silo: reading.silo,
      mark: reading.mark,
      fillLevelPercent: reading.mark === 'unreadable' ? null : reading.fillLevelPercent,
      confidence: reading.confidence,
    };
  });

  return { date: result.date, time: result.time, readings };
}

function extractOutputText(response) {
  const parts = response.candidates && response.candidates[0] &&
    response.candidates[0].content && response.candidates[0].content.parts;
  return Array.isArray(parts)
    ? parts.map((part) => typeof part.text === 'string' ? part.text : '').join('')
    : '';
}

function getGeminiSchema() {
  return {
    type: 'OBJECT',
    properties: {
      date: { type: 'STRING' },
      time: { type: 'STRING' },
      readings: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            houseNumber: { type: 'INTEGER' },
            silo: { type: 'STRING', enum: ['Silo1', 'Silo2'] },
            mark: {
              type: 'STRING',
              enum: ['level', 'empty', 'full', 'unreadable'],
            },
            fillLevelPercent: { type: 'NUMBER' },
            confidence: { type: 'NUMBER' },
          },
          required: ['houseNumber', 'silo', 'mark', 'fillLevelPercent', 'confidence'],
        },
      },
    },
    required: ['date', 'time', 'readings'],
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    if (!process.env.GEMINI_API_KEY) {
      requestError('Gemini reading is not configured. Add GEMINI_API_KEY to the server environment, or use on-device OCR.', 503);
    }

    const image = validateImageDataUrl(req.body && req.body.imageDataUrl);
    const prompt = [
      'Read this photo of one page of a printed silo inventory form.',
      'The form has six house groups and two silos per house. Read only house and silo labels visible on the page.',
      'Valid house numbers are 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, and 19; there is no FH07.',
      'Read the handwritten report date and time. Return date as YYYY-MM-DD and time as 24-hour HH:mm. Use an empty string if either cannot be read.',
      'For every visible silo, determine its mark:',
      '- level: a hand-drawn horizontal or curved feed surface; estimate its vertical position as fillLevelPercent, where 0 is the very bottom of the silo and 100 is the very top.',
      '- empty: the word EMPTY or a clearly empty silo; use fillLevelPercent 0.',
      '- full: the word FULL or a clearly full silo; use fillLevelPercent 100.',
      '- unreadable: a cross-out, missing mark, or unclear reading; use fillLevelPercent 0.',
      'Ignore feed-type notes and small open/closed marks above the silo. A crossed-out silo is unreadable, not empty.',
      'Do not invent unreadable house numbers or silos. Confidence is a number from 0 to 1 for the reading mark and level.',
    ].join('\n');

    let response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': process.env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inlineData: { mimeType: image.mimeType, data: image.data } },
              ],
            }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: getGeminiSchema(),
              temperature: 0.1,
              maxOutputTokens: 8192,
            },
          }),
          signal: AbortSignal.timeout(55000),
        }
      );
    } catch (error) {
      console.error('Gemini silo image recognition request failed:', error.message);
      requestError('Could not reach Gemini. Please try again.', 502);
    }

    let providerResult;
    try {
      providerResult = await response.json();
    } catch (error) {
      console.error('Gemini silo image recognition returned invalid JSON:', error.message);
      requestError('Gemini returned an invalid response. Please try again.', 502);
    }
    if (!response.ok) {
      const providerError = providerResult && providerResult.error;
      console.error('Gemini silo image recognition request was rejected:', {
        status: response.status,
        code: providerError && providerError.code,
        providerStatus: providerError && providerError.status,
        message: providerError && providerError.message,
      });
      if (
        response.status === 401 ||
        (response.status === 400 && /api.?key|key not valid/i.test((providerError && providerError.message) || ''))
      ) {
        requestError('Gemini rejected the API key. Check the GEMINI_API_KEY server setting.', 502);
      }
      if (response.status === 429) {
        requestError('Gemini free-tier quota or rate limit reached. Wait and try again, or use on-device OCR.', 502);
      }
      if (response.status === 403) {
        requestError('Gemini API access is not available for this key or project. Check the Gemini API settings, or use on-device OCR.', 502);
      }
      requestError('Gemini could not process this photo. Check the API key and Gemini API access, then try again.', 502);
    }

    let recognized;
    try {
      const outputText = extractOutputText(providerResult);
      if (!outputText) throw new Error('Gemini returned no text.');
      recognized = JSON.parse(outputText);
    } catch (error) {
      console.error('Gemini silo image recognition returned invalid reading data:', error.message);
      requestError('Gemini could not read this form. Please try a clearer photo.', 502);
    }

    return res.status(200).json(validateRecognition(recognized));
  } catch (error) {
    if (error.statusCode >= 500) {
      console.error('Failed to read silo report image:', error.message);
    }
    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Unable to read the silo report image.',
    });
  }
}
