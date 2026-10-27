import { randomUUID } from 'node:crypto';

const FORECAST_FEED_TYPES = new Set(['BSC', 'BSP', 'CBC', 'BFP']);
const FORECAST_UNITS = new Set(['trucks', 'bags']);
const FORECAST_ROW_COUNT = 6;
const ALLOWED_STATUSES = new Set(['SAFE', 'MODERATE', 'CRITICAL', 'EMPTY']);
const ALLOWED_REMARKS = new Set([
  'CLOSE TO EMPTY',
  'CRITICAL',
  'MODERATE',
  'SAFE',
  'EMPTY',
]);
const LENGTH_UNITS = new Set(['m', 'cm', 'mm', 'ft', 'in']);
const VOLUME_UNITS = new Set(['m3', 'L', 'ft3']);

function configurationError() {
  const error = new Error('Apps Script is not configured.');
  error.code = 'APPS_SCRIPT_CONFIG';
  error.statusCode = 503;
  return error;
}

function getAppsScriptConfig() {
  const url = process.env.APPS_SCRIPT_WEB_APP_URL;
  const token = process.env.APPS_SCRIPT_SHARED_SECRET;
  if (!url || !token) throw configurationError();

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw configurationError();
  }
  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.hostname !== 'script.google.com' ||
    !parsedUrl.pathname.startsWith('/macros/s/') ||
    !parsedUrl.pathname.endsWith('/exec')
  ) {
    throw configurationError();
  }
  return { url, token };
}

export function getAppsScriptErrorMessage(error) {
  if (error && error.code === 'APPS_SCRIPT_CONFIG') {
    return 'Google Sheets is not configured. Add APPS_SCRIPT_WEB_APP_URL and APPS_SCRIPT_SHARED_SECRET to Vercel Environment Variables, then redeploy.';
  }
  if (error && error.code === 'APPS_SCRIPT_AUTH') {
    return 'Apps Script rejected the shared secret. Check that APPS_SCRIPT_SHARED_SECRET matches the VERCEL_SHARED_SECRET script property.';
  }
  if (error && error.code === 'APPS_SCRIPT_REMOTE') {
    return 'The Apps Script request failed. Check the Apps Script deployment and executions log.';
  }
  return 'Unable to access the Google Sheet. Check the Vercel and Apps Script logs.';
}

export function logAppsScriptError(context, error) {
  console.error(context, {
    status: (error && (error.status || error.statusCode)) || null,
    code: (error && error.code) || null,
    message: (error && error.message) || null,
  });
}

async function invokeAppsScript(action, values = {}) {
  const { url, token } = getAppsScriptConfig();
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token, ...values }),
      redirect: 'follow',
    });
  } catch (cause) {
    const error = new Error('Could not reach the Apps Script web app.');
    error.code = 'APPS_SCRIPT_REMOTE';
    error.statusCode = 502;
    error.cause = cause;
    throw error;
  }

  let result;
  try {
    result = JSON.parse(await response.text());
  } catch (cause) {
    const error = new Error('Apps Script returned an invalid response.');
    error.code = 'APPS_SCRIPT_REMOTE';
    error.statusCode = 502;
    error.cause = cause;
    throw error;
  }
  if (!response.ok || !result || typeof result !== 'object') {
    const error = new Error('Apps Script returned an unsuccessful response.');
    error.code = 'APPS_SCRIPT_REMOTE';
    error.statusCode = 502;
    throw error;
  }
  if (result.error) {
    const error = new Error(String(result.error));
    error.code = result.error === 'Unauthorized request.' ? 'APPS_SCRIPT_AUTH' : 'APPS_SCRIPT_REMOTE';
    error.statusCode = 502;
    throw error;
  }
  return result;
}

function invalidRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

function validateReadings(payload) {
  if (!Array.isArray(payload) || payload.length === 0 || payload.length > 100) {
    invalidRequest('Expected a non-empty tracker payload with at most 100 readings.');
  }

  payload.forEach((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      invalidRequest('A tracker reading has an invalid format.');
    }

    const house = String(item.house || '');
    const silo = String(item.silo || '');
    const status = String(item.status || 'SAFE');
    const kg = Number(item.kg) || 0;
    const pct = Number(item.pct) || 0;
    const points = item.points === undefined ? [] : item.points;
    const remark = String(item.customRemark || '');

    if (!/^FH(?:[1-9]|1[0-9])$/.test(house) || !/^Silo[12]$/.test(silo)) {
      invalidRequest('A tracker reading contains an unknown house or silo.');
    }
    if (!Number.isFinite(kg) || kg < 0 || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      invalidRequest('A tracker reading contains an invalid weight or percentage.');
    }
    if (!ALLOWED_STATUSES.has(status)) {
      invalidRequest('A tracker reading contains an unknown status.');
    }
    if (remark && !ALLOWED_REMARKS.has(remark)) {
      invalidRequest('A tracker reading contains an unknown remark.');
    }
    if (!Array.isArray(points) || points.length > 500) {
      invalidRequest('A tracker reading contains invalid silo points.');
    }
    points.forEach((point) => {
      if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
        invalidRequest('A tracker reading contains invalid silo points.');
      }
    });
  });
}

export async function saveReadings(payload) {
  validateReadings(payload);
  return invokeAppsScript('saveReadings', { payload });
}

export async function fetchLatestState() {
  return invokeAppsScript('fetchLatestState');
}

function validateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    invalidRequest('Settings have an invalid format.');
  }
  if (!LENGTH_UNITS.has(settings.defaultLengthUnit)) {
    invalidRequest('Choose a valid default length unit.');
  }
  if (
    !Array.isArray(settings.houses) ||
    settings.houses.length > 500 ||
    !Array.isArray(settings.silos) ||
    settings.silos.length > 1000
  ) {
    invalidRequest('Settings contain too many or invalid houses or silos.');
  }
  if (JSON.stringify(settings).length > 45000) {
    invalidRequest('Settings are too large to save.');
  }

  const houseIds = new Set();
  settings.houses.forEach((house) => {
    if (!house || typeof house.id !== 'string' || !house.id.trim() || house.id.length > 100) {
      invalidRequest('Every house needs a name or ID of 1 to 100 characters.');
    }
    const id = house.id.trim().toLocaleLowerCase();
    if (houseIds.has(id)) invalidRequest('House names or IDs must be unique.');
    houseIds.add(id);
  });

  const siloIds = new Set();
  settings.silos.forEach((silo) => {
    if (!silo || typeof silo.id !== 'string' || !silo.id.trim() || silo.id.length > 100) {
      invalidRequest('Every silo needs a name or ID of 1 to 100 characters.');
    }
    const id = silo.id.trim().toLocaleLowerCase();
    if (siloIds.has(id)) invalidRequest('Silo names or IDs must be unique.');
    siloIds.add(id);
    if (!houseIds.has(String(silo.houseId || '').trim().toLocaleLowerCase())) {
      invalidRequest(`Assign silo "${silo.id}" to an existing house.`);
    }
    if (!Number.isInteger(silo.cylinderCount) || silo.cylinderCount < 3 || silo.cylinderCount > 10) {
      invalidRequest(`Silo "${silo.id}" must have 3 to 10 cylinders.`);
    }
    if (!Array.isArray(silo.cylinders) || silo.cylinders.length !== silo.cylinderCount) {
      invalidRequest(`Silo "${silo.id}" needs measurements for every cylinder.`);
    }
    silo.cylinders.forEach((cylinder, index) => {
      if (
        !cylinder ||
        !Number.isFinite(cylinder.heightM) ||
        cylinder.heightM <= 0 ||
        !Number.isFinite(cylinder.diameterM) ||
        cylinder.diameterM <= 0
      ) {
        invalidRequest(`Silo "${silo.id}" needs positive height and diameter for cylinder ${index + 1}.`);
      }
    });
    ['coneHeightM', 'volumeM3'].forEach((field) => {
      if (!Number.isFinite(silo[field]) || silo[field] <= 0) {
        invalidRequest(`Silo "${silo.id}" needs a positive ${field}.`);
      }
    });
    if (!LENGTH_UNITS.has(silo.lengthUnit) || !VOLUME_UNITS.has(silo.volumeUnit)) {
      invalidRequest(`Silo "${silo.id}" has an invalid unit.`);
    }
  });
}

export async function fetchSettings() {
  return invokeAppsScript('fetchSettings');
}

export async function saveSettings(settings) {
  validateSettings(settings);
  return invokeAppsScript('saveSettings', { payload: settings });
}

function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function getForecastDates(weekStart) {
  if (!isValidDateString(weekStart)) invalidRequest('Choose a valid forecast start date.');
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  });
}

export async function saveFeedForecast({ weekStart, rows, notes }) {
  const dates = getForecastDates(weekStart);
  if (!Array.isArray(rows) || rows.length !== FORECAST_ROW_COUNT) {
    invalidRequest(`A weekly forecast must contain ${FORECAST_ROW_COUNT} feed rows.`);
  }
  if (typeof notes !== 'string' || notes.length > 2000) {
    invalidRequest('Forecast notes must be 2,000 characters or fewer.');
  }

  rows.forEach((row) => {
    if (
      !row ||
      typeof row !== 'object' ||
      !(row.feedType === '' || FORECAST_FEED_TYPES.has(row.feedType)) ||
      !FORECAST_UNITS.has(row.unit) ||
      !Array.isArray(row.quantities) ||
      row.quantities.length !== dates.length ||
      row.quantities.some((quantity) =>
        !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1000000
      ) ||
      (!row.feedType && row.quantities.some((quantity) => quantity > 0))
    ) {
      invalidRequest('A forecast row has an invalid feed type, unit, or daily quantity.');
    }
  });

  return invokeAppsScript('saveFeedForecast', {
    payload: { weekStart, rows, notes },
  });
}

export async function fetchFeedForecast(weekStart) {
  getForecastDates(weekStart);
  return invokeAppsScript('fetchFeedForecast', { weekStart });
}
