const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const GROQ_MODEL = 'qwen/qwen3.8-27b';
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
      typeof reading.house !== 'string' ||
      !/^(?:CH|FH)[1-9]\d{0,3}$/i.test(reading.house) ||
      typeof reading.silo !== 'string' ||
      !reading.silo.trim() ||
      reading.silo.length > 100 ||
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

    const house = reading.house.toUpperCase();
    const silo = reading.silo.trim();
    const key = `${house}-${silo.toLocaleLowerCase()}`;
    if (seenReadings.has(key)) {
      requestError('The image reader returned duplicate silo data. Please try another photo.', 502);
    }
    seenReadings.add(key);

    return {
      house: house,
      silo: silo,
      mark: reading.mark,
      fillLevelPercent: reading.mark === 'unreadable' ? null : reading.fillLevelPercent,
      confidence: reading.confidence,
    };
  });

  return { date: result.date, time: result.time, readings };
}

function extractOutputText(response) {
  const choice = response.choices && response.choices[0];
  const content = choice && choice.message && choice.message.content;
  return typeof content === 'string' ? content : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    if (!process.env.GROQ_API_KEY) {
      requestError('Groq reading is not configured. Add GROQ_API_KEY to the server environment, or use on-device OCR.', 503);
    }

    const image = validateImageDataUrl(req.body && req.body.imageDataUrl);
    const prompt = [
      'Return only a valid JSON object with exactly these top-level fields: date, time, readings.',
      'Each reading must contain house (the exact house label such as FH1 or CH1), silo (the exact silo label shown on the form), mark (level, empty, full, or unreadable), fillLevelPercent (number), and confidence (number from 0 to 1).',
      'Read this photo of one page of a printed silo inventory form.',
      'Read the house and silo labels exactly as printed. A house label uses FH or CH followed by a number; a house can have any number of configured silos.',
      'House labels use either the FH or CH prefix followed by a positive number. Read only labels visible in the photo; preserve the prefix.',
      'Read the handwritten report date and time. Return date as YYYY-MM-DD and time as 24-hour HH:mm. Use an empty string if either cannot be read.',
      'For every visible silo, determine its mark:',
      '- level: a hand-drawn horizontal or curved feed surface; estimate its vertical position as fillLevelPercent, where 0 is the very bottom of the silo and 100 is the very top.',
      '- empty: the word EMPTY, or no visible hand-drawn horizontal/curved feed line inside an otherwise readable silo; use fillLevelPercent 0.',
      '- full: the word FULL or a clearly full silo; use fillLevelPercent 100.',
      '- unreadable: a cross-out, obscured silo, or unclear photo; use fillLevelPercent 0.',
      'Ignore feed-type notes and small open/closed marks above the silo. A crossed-out silo is unreadable, not empty.',
      'A blank silo with no feed line is empty. Do not treat the printed silo outline or section seams as feed lines.',
      'Do not invent unreadable house numbers or silos. Confidence is a number from 0 to 1 for the reading mark and level.',
    ].join('\n');

    let response;
    try {
      response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${image.mimeType};base64,${image.data}`,
                    detail: 'high',
                  },
                },
              ],
            }],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_completion_tokens: 4096,
          }),
          signal: AbortSignal.timeout(55000),
        }
      );
    } catch (error) {
      console.error('Groq silo image recognition request failed:', error.message);
      requestError('Could not reach Groq. Please try again.', 502);
    }

    let providerResult;
    try {
      providerResult = await response.json();
    } catch (error) {
      console.error('Groq silo image recognition returned invalid JSON:', error.message);
      requestError('Groq returned an invalid response. Please try again.', 502);
    }
    if (!response.ok) {
      const providerError = providerResult && providerResult.error;
      console.error('Groq silo image recognition request was rejected:', {
        status: response.status,
        code: providerError && providerError.code,
        type: providerError && providerError.type,
        message: providerError && providerError.message,
      });
      if (response.status === 401) {
        requestError('Groq rejected the API key. Check the GROQ_API_KEY server setting.', 502);
      }
      if (response.status === 429) {
        requestError('Groq rate or usage limit reached. Check your Groq console limits, or use on-device OCR.', 502);
      }
      if (response.status === 413) {
        requestError('The photo is too large for Groq. Choose a smaller photo, or use on-device OCR.', 502);
      }
      requestError('Groq could not process this photo. Check the API key, account limits, and model access, then try again.', 502);
    }

    let recognized;
    try {
      const outputText = extractOutputText(providerResult);
      if (!outputText) throw new Error('Groq returned no text.');
      recognized = JSON.parse(outputText);
    } catch (error) {
      console.error('Groq silo image recognition returned invalid reading data:', error.message);
      requestError('Groq could not read this form. Please try a clearer photo.', 502);
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
