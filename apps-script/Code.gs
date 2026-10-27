const SPREADSHEET_ID = '1Tq4-mxOc9JF6PIZCOBglV0jUCM-wCPLbJPvRcfMVjTU';
const READINGS_SHEET = 'Readings';
const FORECAST_SHEET = 'FeedForecasts';
const SETTINGS_SHEET = 'SiloSettings';
const READINGS_HEADERS = [
  'Timestamp',
  'Date',
  'Time',
  'House',
  'Silo',
  'KG',
  'PCT',
  'Status',
  'Age',
  'PlacementDate',
  'CustomRemark',
  'PointsJSON',
];
const FORECAST_HEADERS = [
  'Timestamp',
  'ForecastId',
  'WeekStart',
  'DeliveryDate',
  'FeedType',
  'Quantity',
  'Notes',
  'RowNumber',
  'Unit',
];
const FORECAST_FEED_TYPES = ['BSC', 'BSP', 'CBC', 'BFP'];
const FORECAST_UNITS = ['trucks', 'bags'];

function doGet() {
  return jsonOutput_({ status: 'READY', message: 'Send a POST request to use this spreadsheet API.' });
}

function doPost(event) {
  try {
    const request = JSON.parse(event.postData.contents || '{}');
    const configuredSecret = PropertiesService.getScriptProperties()
      .getProperty('VERCEL_SHARED_SECRET');
    if (!configuredSecret || request.token !== configuredSecret) {
      return jsonOutput_({ error: 'Unauthorized request.' });
    }

    let result;
    switch (request.action) {
      case 'saveReadings':
        result = saveReadings_(request.payload);
        break;
      case 'fetchLatestState':
        result = fetchLatestState_();
        break;
      case 'fetchSettings':
        result = fetchSettings_();
        break;
      case 'saveSettings':
        result = saveSettings_(request.payload);
        break;
      case 'saveFeedForecast':
        result = saveFeedForecast_(request.payload);
        break;
      case 'fetchFeedForecast':
        result = fetchFeedForecast_(request.weekStart);
        break;
      default:
        return jsonOutput_({ error: 'Unknown action.' });
    }
    return jsonOutput_(result);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonOutput_({ error: 'The spreadsheet request could not be completed.' });
  }
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(name, headers) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  return sheet;
}

function literalText_(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function saveReadings_(payload) {
  if (!Array.isArray(payload) || payload.length === 0 || payload.length > 100) {
    throw new Error('Invalid readings payload.');
  }

  const sheet = getSheet_(READINGS_SHEET, READINGS_HEADERS);
  const timestamp = new Date();
  const rows = payload.map(function(item) {
    if (!item || typeof item !== 'object') throw new Error('Invalid reading.');
    return [
      timestamp,
      literalText_(item.date),
      literalText_(item.time),
      literalText_(item.house),
      literalText_(item.silo),
      Number(item.kg) || 0,
      Number(item.pct) || 0,
      literalText_(item.status || 'SAFE'),
      literalText_(item.age === undefined ? '' : item.age),
      literalText_(item.placementDate),
      literalText_(item.customRemark),
      JSON.stringify(item.points || []),
    ];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, READINGS_HEADERS.length)
    .setValues(rows);

  const placements = {};
  payload.forEach(function(item) {
    if (item.placementDate) placements[String(item.house || '')] = String(item.placementDate);
  });
  PropertiesService.getScriptProperties().setProperty('PLACEMENT_DATES', JSON.stringify(placements));
  return { status: 'SUCCESS' };
}

function fetchLatestState_() {
  const properties = PropertiesService.getScriptProperties();
  let placementDates = {};
  try {
    placementDates = JSON.parse(properties.getProperty('PLACEMENT_DATES') || '{}');
  } catch (error) {
    console.error('Could not parse stored placement dates.');
  }

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(READINGS_SHEET);
  const savedSettings = fetchSettings_().settings;
  const configuredSilos = {};
  if (savedSettings && Array.isArray(savedSettings.silos)) {
    savedSettings.silos.forEach(function(silo) {
      const prefix = String(silo.houseId || '') + '-';
      const siloId = String(silo.id || '');
      const displayName = siloId.toLowerCase().indexOf(prefix.toLowerCase()) === 0
        ? siloId.slice(prefix.length)
        : siloId;
      configuredSilos[String(silo.houseId || '') + '|' + displayName] = silo;
    });
  }
  const farmData = {};
  const customRemarks = {};
  const customAges = {};
  let lastSavedDate = '';
  let lastSavedTime = '';

  if (sheet && sheet.getLastRow() > 1) {
    const lastRowNumber = sheet.getLastRow();
    const startRow = Math.max(2, lastRowNumber - 4999);
    const data = sheet.getRange(startRow, 1, lastRowNumber - startRow + 1, READINGS_HEADERS.length)
      .getValues();
    const lastRow = data[data.length - 1];
    lastSavedDate = String(lastRow[1] || '');
    lastSavedTime = String(lastRow[2] || '');

    for (let i = data.length - 1; i >= 0; i--) {
      const row = data[i];
      const house = String(row[3] || '');
      const siloName = String(row[4] || '');
      const kg = Number(row[5]) || 0;
      const pct = Number(row[6]) || 0;
      const status = String(row[7] || 'SAFE');
      const age = row[8];
      const placementDate = String(row[9] || '');
      const remark = String(row[10] || '');

      if (!placementDates[house] && placementDate) placementDates[house] = placementDate;
      if (!customRemarks[house] && remark) customRemarks[house] = remark;
      if (customAges[house] === undefined && age !== '') customAges[house] = age;

      const siloConfiguration = configuredSilos[house + '|' + siloName];
      const isLegacyHouseSilo = /^FH(?:[1-9]|1[0-9])$/.test(house) && /^Silo[12]$/.test(siloName);
      if (!siloConfiguration && !isLegacyHouseSilo) continue;
      if (!farmData[house]) farmData[house] = [];
      if (farmData[house].some(function(silo) {
        return silo.name === siloName;
      })) continue;

      let points = [];
      try {
        points = JSON.parse(row[11] || '[]');
      } catch (error) {
        console.error('Could not parse silo points for ' + house + '.');
      }

      const houseNumber = Number.parseInt(house.replace(/^FH/, ''), 10);
      const maxCapacity = siloConfiguration && Number(siloConfiguration.capacityKg) > 0
        ? Number(siloConfiguration.capacityKg)
        : houseNumber <= 12
          ? (siloName === 'Silo1' ? 20238.5 : 16158.5)
          : 21522;
      farmData[house].push({
        name: siloName,
        maxCap: maxCapacity,
        currentKg: kg,
        currentPct: pct,
        status: status,
        isEmpty: status === 'EMPTY' || kg === 0,
        points: Array.isArray(points) ? points : [],
      });
    }
  }

  Object.keys(farmData).forEach(function(house) {
    farmData[house].sort(function(left, right) {
      return left.name.localeCompare(right.name);
    });
  });
  return {
    placementDates: placementDates,
    farmData: farmData,
    customRemarks: customRemarks,
    customAges: customAges,
    lastSavedDate: lastSavedDate,
    lastSavedTime: lastSavedTime,
  };
}

function fetchSettings_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SETTINGS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return { settings: null };
  const rawSettings = sheet.getRange(2, 1).getValue();
  if (!rawSettings) return { settings: null };
  try {
    return { settings: JSON.parse(String(rawSettings)) };
  } catch (error) {
    console.error('Could not parse saved silo settings.');
    throw new Error('Saved silo settings are invalid. Review the SiloSettings sheet.');
  }
}

function saveSettings_(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Settings have an invalid format.');
  }
  if (['m', 'cm', 'mm', 'ft', 'in'].indexOf(settings.defaultLengthUnit) < 0) {
    throw new Error('Choose a valid default length unit.');
  }
  if (!Array.isArray(settings.houses) || settings.houses.length > 500 ||
      !Array.isArray(settings.silos) || settings.silos.length > 1000) {
    throw new Error('Settings contain too many or invalid houses or silos.');
  }

  const houseIds = Object.create(null);
  settings.houses.forEach(function(house) {
    if (!house || typeof house.id !== 'string' || !house.id.trim() || house.id.length > 100) {
      throw new Error('Every house needs a name or ID of 1 to 100 characters.');
    }
    const id = house.id.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(houseIds, id)) {
      throw new Error('House names or IDs must be unique.');
    }
    houseIds[id] = true;
  });

  const siloIds = Object.create(null);
  settings.silos.forEach(function(silo) {
    if (!silo || typeof silo.id !== 'string' || !silo.id.trim() || silo.id.length > 100) {
      throw new Error('Every silo needs a name or ID of 1 to 100 characters.');
    }
    const id = silo.id.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(siloIds, id)) {
      throw new Error('Silo names or IDs must be unique.');
    }
    siloIds[id] = true;
    if (!houseIds[String(silo.houseId || '').trim().toLowerCase()]) {
      throw new Error('Assign every silo to an existing house.');
    }
    if (!Number.isInteger(silo.cylinderCount) || silo.cylinderCount < 3 || silo.cylinderCount > 10) {
      throw new Error('The cylinder count must be a whole number from 3 to 10.');
    }
    if (!Array.isArray(silo.cylinders) || silo.cylinders.length !== silo.cylinderCount) {
      throw new Error('Provide measurements for every silo cylinder.');
    }
    if (!Number.isFinite(silo.capacityKg) || silo.capacityKg <= 0) {
      throw new Error('Every silo needs a positive maximum feed capacity in kilograms.');
    }
    silo.cylinders.forEach(function(cylinder, index) {
      if (!cylinder || !Number.isFinite(cylinder.heightM) || cylinder.heightM <= 0 ||
          !Number.isFinite(cylinder.diameterM) || cylinder.diameterM <= 0) {
        throw new Error('Cylinder ' + (index + 1) + ' needs positive height and diameter.');
      }
    });
    ['coneHeightM', 'volumeM3'].forEach(function(field) {
      if (!Number.isFinite(silo[field]) || silo[field] <= 0) {
        throw new Error('Silo dimensions and volume must be positive numbers.');
      }
    });
    if (['m', 'cm', 'mm', 'ft', 'in'].indexOf(silo.lengthUnit) < 0 ||
        ['m3', 'L', 'ft3'].indexOf(silo.volumeUnit) < 0) {
      throw new Error('A silo has an invalid length or volume unit.');
    }
  });

  if (settings.feeds !== undefined) {
    if (!Array.isArray(settings.feeds) || settings.feeds.length > 20) {
      throw new Error('Feed sizes have an invalid format.');
    }
    const feedIds = Object.create(null);
    settings.feeds.forEach(function(feed) {
      if (!feed || ['BSC', 'BSP', 'CBC', 'BFP'].indexOf(feed.id) < 0 ||
          Object.prototype.hasOwnProperty.call(feedIds, feed.id) ||
          !Number.isFinite(feed.size) || feed.size < 0) {
        throw new Error('Each feed needs a valid size in millimeters.');
      }
      feedIds[feed.id] = true;
    });
  }

  const serializedSettings = JSON.stringify(settings);
  if (serializedSettings.length > 45000) throw new Error('Settings are too large to save.');
  const sheet = getSheet_(SETTINGS_SHEET, ['SettingsJSON']);
  sheet.getRange(2, 1).setValue(serializedSettings);
  return { status: 'SUCCESS', settings: settings };
}

function isValidDateString_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function getForecastDates_(weekStart) {
  if (!isValidDateString_(weekStart)) throw new Error('Choose a valid forecast start date.');
  const start = new Date(weekStart + 'T00:00:00.000Z');
  return Array.from({ length: 7 }, function(_, offset) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  });
}

function normalizeSheetDate_(value, timezone) {
  if (value instanceof Date) return Utilities.formatDate(value, timezone, 'yyyy-MM-dd');
  return String(value || '').slice(0, 10);
}

function saveFeedForecast_(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid forecast.');
  const dates = getForecastDates_(payload.weekStart);
  if (!Array.isArray(payload.rows) || payload.rows.length !== 6) {
    throw new Error('A weekly forecast must contain six rows.');
  }
  if (typeof payload.notes !== 'string' || payload.notes.length > 2000) {
    throw new Error('Forecast notes are too long.');
  }

  const forecastId = Utilities.getUuid();
  const timestamp = new Date();
  const rows = [];
  payload.rows.forEach(function(row, rowIndex) {
    if (
      !row ||
      (row.feedType !== '' && FORECAST_FEED_TYPES.indexOf(row.feedType) < 0) ||
      FORECAST_UNITS.indexOf(row.unit) < 0 ||
      !Array.isArray(row.quantities) ||
      row.quantities.length !== dates.length
    ) {
      throw new Error('A forecast row is invalid.');
    }
    row.quantities.forEach(function(quantity, dayIndex) {
      if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1000000 ||
          (!row.feedType && quantity > 0)) {
        throw new Error('A forecast quantity is invalid.');
      }
      rows.push([
        timestamp,
        forecastId,
        literalText_(payload.weekStart),
        dates[dayIndex],
        literalText_(row.feedType),
        quantity,
        literalText_(payload.notes),
        rowIndex + 1,
        literalText_(row.unit),
      ]);
    });
  });

  const sheet = getSheet_(FORECAST_SHEET, FORECAST_HEADERS);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, FORECAST_HEADERS.length)
    .setValues(rows);
  return { status: 'SUCCESS', savedAt: timestamp.toISOString() };
}

function fetchFeedForecast_(weekStart) {
  const dates = getForecastDates_(weekStart);
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(FORECAST_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) {
    return { weekStart: weekStart, rows: [], notes: '', savedAt: '' };
  }

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, FORECAST_HEADERS.length)
    .getValues();
  const timezone = spreadsheet.getSpreadsheetTimeZone();
  let latestForecastId = '';
  let savedAt = '';
  for (let i = data.length - 1; i >= 0; i--) {
    if (normalizeSheetDate_(data[i][2], timezone) === weekStart) {
      latestForecastId = String(data[i][1]);
      savedAt = data[i][0] instanceof Date ? data[i][0].toISOString() : String(data[i][0] || '');
      break;
    }
  }
  if (!latestForecastId) {
    return { weekStart: weekStart, rows: [], notes: '', savedAt: '' };
  }

  const forecastRows = Array.from({ length: 6 }, function() {
    return { feedType: '', unit: 'trucks', quantities: Array(7).fill(0) };
  });
  let notes = '';
  data.forEach(function(entry) {
    if (String(entry[1]) !== latestForecastId) return;
    const rowIndex = Number(entry[7]) - 1;
    const dayIndex = dates.indexOf(normalizeSheetDate_(entry[3], timezone));
    if (rowIndex < 0 || rowIndex >= 6 || dayIndex < 0) return;
    const feedType = String(entry[4] || '');
    const unit = String(entry[8] || 'trucks');
    if ((feedType && FORECAST_FEED_TYPES.indexOf(feedType) < 0) ||
        FORECAST_UNITS.indexOf(unit) < 0) return;
    forecastRows[rowIndex].feedType = feedType;
    forecastRows[rowIndex].unit = unit;
    forecastRows[rowIndex].quantities[dayIndex] = Number(entry[5]) || 0;
    if (!notes && entry[6]) notes = String(entry[6]);
  });
  return { weekStart: weekStart, rows: forecastRows, notes: notes, savedAt: savedAt };
}
