const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const VALID_HOUSE_NUMBERS = new Set([
  1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
]);

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateImageDataUrl(value) {
  if (typeof value !== 'string') requestError('Choose a silo reading image to upload.', 400);
  const match = value.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) requestError('Upload a JPEG, PNG, or WebP image.', 400);
  const imageBytes = Buffer.from(match[1], 'base64');
  if (imageBytes.length === 0 || imageBytes.length > MAX_IMAGE_BYTES) {
    requestError('The image is empty or too large. Choose a smaller photo.', 400);
  }
  return value;
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
      !VALID_HOUSE_NUMBERS.has(reading.houseNumber) ||
      !['Silo1', 'Silo2'].includes(reading.silo) ||
      !['level', 'empty', 'full', 'unreadable'].includes(reading.mark) ||
      (reading.fillLevelPercent !== null &&
        (!Number.isFinite(reading.fillLevelPercent) ||
          reading.fillLevelPercent < 0 ||
          reading.fillLevelPercent > 100)) ||
      (reading.mark === 'unreadable'
        ? reading.fillLevelPercent !== null
        : reading.fillLevelPercent === null) ||
      (reading.mark === 'empty' && reading.fillLevelPercent !== 0) ||
      (reading.mark === 'full' && reading.fillLevelPercent !== 100) ||
      !Number.isFinite(reading.confidence) ||
      reading.confidence < 0 ||
      reading.confidence > 1
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
      fillLevelPercent: reading.fillLevelPercent,
      confidence: reading.confidence,
    };
  });

  return { date: result.date, time: result.time, readings };
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  const textBlocks = [];
  (Array.isArray(response.output) ? response.output : []).forEach((item) => {
    (item && Array.isArray(item.content) ? item.content : []).forEach((content) => {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        textBlocks.push(content.text);
      }
    });
  });
  return textBlocks.join('');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      requestError('Image reading is not configured. Add OPENAI_API_KEY to the server environment.', 503);
    }

    const imageDataUrl = validateImageDataUrl(req.body && req.body.imageDataUrl);
    const prompt = [
      'Read this photo of one page of a printed silo inventory form.',
      'The form has six house groups and two silos per house. Read only house and silo labels visible on the page.',
      'Valid house numbers are 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, and 19; there is no FH07.',
      'Read the handwritten report date and time. Return date as YYYY-MM-DD and time as 24-hour HH:mm. Use an empty string if either cannot be read.',
      'For every visible silo, determine its mark:',
      '- level: a hand-drawn horizontal or curved feed surface; estimate its vertical position as fillLevelPercent, where 0 is the very bottom of the silo and 100 is the very top.',
      '- empty: the word EMPTY or a clearly empty silo; use fillLevelPercent 0.',
      '- full: the word FULL or a clearly full silo; use fillLevelPercent 100.',
      '- unreadable: a cross-out, missing mark, or unclear reading; use null.',
      'Ignore feed-type notes and small open/closed marks above the silo. A crossed-out silo is unreadable, not empty.',
      'Do not invent unreadable house numbers or silos. Confidence is a number from 0 to 1 for the reading mark and level.',
    ].join('\n');

    let response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-6-astra',
          input: [{
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: imageDataUrl, detail: 'high' },
            ],
          }],
          text: {
            format: {
              type: 'json_schema',
              name: 'silo_reading',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['date', 'time', 'readings'],
                properties: {
                  date: { type: 'string' },
                  time: { type: 'string' },
                  readings: {
                    type: 'array',
                    maxItems: 12,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: [
                        'houseNumber',
                        'silo',
                        'mark',
                        'fillLevelPercent',
                        'confidence',
                      ],
                      properties: {
                        houseNumber: {
                          type: 'integer',
                          enum: [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
                        },
                        silo: { type: 'string', enum: ['Silo1', 'Silo2'] },
                        mark: {
                          type: 'string',
                          enum: ['level', 'empty', 'full', 'unreadable'],
                        },
                        fillLevelPercent: {
                          type: ['number', 'null'],
                        },
                        confidence: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        signal: AbortSignal.timeout(55000),
      });
    } catch (error) {
      console.error('Silo image recognition request failed:', error.message);
      requestError('Could not reach the image-reading service. Please try again.', 502);
    }

    let providerResult;
    try {
      providerResult = await response.json();
    } catch (error) {
      console.error('Silo image recognition returned invalid JSON:', error.message);
      requestError('The image-reading service returned an invalid response. Please try again.', 502);
    }
    if (!response.ok) {
      console.error('Silo image recognition request was rejected:', {
        status: response.status,
        code: providerResult && providerResult.error && providerResult.error.code,
      });
      requestError('The image-reading service could not process this photo. Please try again.', 502);
    }

    let recognized;
    try {
      recognized = JSON.parse(extractOutputText(providerResult));
    } catch (error) {
      console.error('Silo image recognition returned invalid reading data:', error.message);
      requestError('The image-reading service could not read this form. Please try a clearer photo.', 502);
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
