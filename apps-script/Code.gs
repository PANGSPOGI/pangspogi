const SPREADSHEET_ID = '1Tq4-mxOc9JF6PIZCOBglV0jUCM-wCPLbJPvRcfMVjTU';
const READINGS_SHEET = 'Readings';
const FORECAST_SHEET = 'FeedForecasts';
const SETTINGS_SHEET = 'SiloSettings';
const FARMS_SHEET = 'Farms';
const DEFAULT_FARM_ID = 'mango-farm';
const SETTINGS_HEADERS = ['FarmId', 'FarmName', 'SettingsJSON'];
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
  'FarmId',
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
  'FarmId',
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

    ensureFarmStore_();
    let result;
    switch (request.action) {
      case 'fetchFarms':
        result = fetchFarms_();
        break;
      case 'createFarm':
        result = createFarm_(request.payload || {});
        break;
      case 'saveReadings':
        result = saveReadings_(request.payload, request.farmId);
        break;
      case 'fetchLatestState':
        result = fetchLatestState_(request.farmId);
        break;
      case 'fetchSettings':
        result = fetchSettings_(request.farmId);
        break;
      case 'saveSettings':
        result = saveSettings_(request.payload, request.farmId);
        break;
      case 'saveFeedForecast':
        result = saveFeedForecast_(request.payload, request.farmId);
        break;
      case 'fetchFeedForecast':
        result = fetchFeedForecast_(request.weekStart, request.farmId);
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
  } else {
    const existingHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    if (existingHeaders.length < headers.length) {
      sheet.getRange(1, existingHeaders.length + 1, 1, headers.length - existingHeaders.length)
        .setValues([headers.slice(existingHeaders.length)]);
    }
  }
  return sheet;
}

function getSettingsSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(SETTINGS_SHEET) || spreadsheet.insertSheet(SETTINGS_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(SETTINGS_HEADERS);
    return sheet;
  }
  const firstHeader = String(sheet.getRange(1, 1).getValue() || '');
  if (firstHeader === 'SettingsJSON') {
    const oldSettings = sheet.getLastRow() > 1 ? sheet.getRange(2, 1).getValue() : '';
    sheet.getRange(1, 1, 1, SETTINGS_HEADERS.length).setValues([SETTINGS_HEADERS]);
    if (oldSettings) {
      sheet.getRange(2, 1, 1, SETTINGS_HEADERS.length)
        .setValues([[DEFAULT_FARM_ID, 'Mango Farm', String(oldSettings)]]);
    }
    return sheet;
  }
  if (firstHeader !== SETTINGS_HEADERS[0]) {
    throw new Error('The SiloSettings sheet has an unrecognized header.');
  }
  if (sheet.getLastColumn() < SETTINGS_HEADERS.length) {
    const missingHeaders = SETTINGS_HEADERS.slice(sheet.getLastColumn());
    sheet.getRange(1, sheet.getLastColumn() + 1, 1, missingHeaders.length)
      .setValues([missingHeaders]);
  }
  return sheet;
}

function ensureFarmStore_() {
  const sheet = getSheet_(FARMS_SHEET, ['FarmId', 'Name', 'CreatedAt']);
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues()
    : [];
  if (!rows.some(function(row) { return String(row[0]) === DEFAULT_FARM_ID; })) {
    sheet.appendRow([DEFAULT_FARM_ID, 'Mango Farm', new Date()]);
  }
  getSettingsSheet_();
  getSheet_(READINGS_SHEET, READINGS_HEADERS);
  getSheet_(FORECAST_SHEET, FORECAST_HEADERS);
}

function normalizeFarmId_(farmId) {
  const value = farmId ? String(farmId) : DEFAULT_FARM_ID;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new Error('Choose a valid farm.');
  const farms = getSheet_(FARMS_SHEET, ['FarmId', 'Name', 'CreatedAt']);
  const rows = farms.getLastRow() > 1
    ? farms.getRange(2, 1, farms.getLastRow() - 1, 3).getValues()
    : [];
  if (!rows.some(function(row) { return String(row[0]) === value; })) {
    throw new Error('The selected farm does not exist.');
  }
  return value;
}

function fetchFarms_() {
  const sheet = getSheet_(FARMS_SHEET, ['FarmId', 'Name', 'CreatedAt']);
  const farms = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues().map(function(row) {
      return {
        id: String(row[0] || ''),
        name: String(row[1] || ''),
        createdAt: row[2] instanceof Date ? row[2].toISOString() : String(row[2] || ''),
      };
    }).filter(function(farm) { return farm.id && farm.name; })
    : [];
  return { farms: farms, defaultFarmId: DEFAULT_FARM_ID };
}

function createFarm_(payload) {
  const name = String(payload.name || '').trim();
  if (!name || name.length > 80) throw new Error('Farm names must be between 1 and 80 characters.');
  const farmsSheet = getSheet_(FARMS_SHEET, ['FarmId', 'Name', 'CreatedAt']);
  const farms = farmsSheet.getLastRow() > 1
    ? farmsSheet.getRange(2, 1, farmsSheet.getLastRow() - 1, 3).getValues()
    : [];
  if (farms.some(function(row) { return String(row[1]).trim().toLowerCase() === name.toLowerCase(); })) {
    throw new Error('A farm with this name already exists.');
  }
  if (!payload.settings || typeof payload.settings !== 'object') {
    throw new Error('Add the farm houses before continuing.');
  }
  const id = Utilities.getUuid();
  farmsSheet.appendRow([id, literalText_(name), new Date()]);
  try {
    const result = saveSettings_(payload.settings, id);
    return { status: 'SUCCESS', farm: { id: id, name: name }, settings: result.settings };
  } catch (error) {
    farmsSheet.deleteRow(farmsSheet.getLastRow());
    throw error;
  }
}

function literalText_(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function saveReadings_(payload, requestedFarmId) {
  const farmId = normalizeFarmId_(requestedFarmId);
  if (!Array.isArray(payload) || payload.length === 0 || payload.length > 1000) {
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
      farmId,
    ];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, READINGS_HEADERS.length)
    .setValues(rows);

  const placements = {};
  payload.forEach(function(item) {
    if (item.placementDate) placements[String(item.house || '')] = String(item.placementDate);
  });
  const placementProperty = farmId === DEFAULT_FARM_ID
    ? 'PLACEMENT_DATES'
    : 'PLACEMENT_DATES_' + farmId;
  PropertiesService.getScriptProperties().setProperty(placementProperty, JSON.stringify(placements));
  return { status: 'SUCCESS' };
}

function fetchLatestState_(requestedFarmId) {
  const farmId = normalizeFarmId_(requestedFarmId);
  const properties = PropertiesService.getScriptProperties();
  let placementDates = {};
  try {
    const placementProperty = farmId === DEFAULT_FARM_ID
      ? 'PLACEMENT_DATES'
      : 'PLACEMENT_DATES_' + farmId;
    placementDates = JSON.parse(properties.getProperty(placementProperty) || '{}');
  } catch (error) {
    console.error('Could not parse stored placement dates.');
  }

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(READINGS_SHEET);
  const savedSettings = fetchSettings_(farmId).settings;
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
    for (let i = data.length - 1; i >= 0; i--) {
      const row = data[i];
      const rowFarmId = String(row[12] || DEFAULT_FARM_ID);
      if (rowFarmId !== farmId) continue;
      if (!lastSavedDate) {
        lastSavedDate = String(row[1] || '');
        lastSavedTime = String(row[2] || '');
      }
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

function fetchSettings_(requestedFarmId) {
  const farmId = normalizeFarmId_(requestedFarmId);
  const sheet = getSettingsSheet_();
  if (sheet.getLastRow() < 2) return { settings: null };
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, SETTINGS_HEADERS.length).getValues();
  const row = rows.find(function(entry) {
    return String(entry[0] || DEFAULT_FARM_ID) === farmId;
  });
  if (!row || !row[2]) return { settings: null };
  try {
    return { settings: JSON.parse(String(row[2])) };
  } catch (error) {
    console.error('Could not parse saved silo settings for farm ' + farmId + '.');
    throw new Error('Saved silo settings are invalid. Review the SiloSettings sheet.');
  }
}

function saveSettings_(settings, requestedFarmId) {
  const farmId = normalizeFarmId_(requestedFarmId);
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
  const sheet = getSettingsSheet_();
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, SETTINGS_HEADERS.length).getValues()
    : [];
  const existingIndex = rows.findIndex(function(row) {
    return String(row[0] || DEFAULT_FARM_ID) === farmId;
  });
  const settingsRow = [farmId, farmName_(farmId), serializedSettings];
  if (existingIndex >= 0) {
    sheet.getRange(existingIndex + 2, 1, 1, SETTINGS_HEADERS.length).setValues([settingsRow]);
  } else {
    sheet.appendRow(settingsRow);
  }
  return { status: 'SUCCESS', settings: settings };
}

function farmName_(farmId) {
  const farms = getSheet_(FARMS_SHEET, ['FarmId', 'Name', 'CreatedAt']);
  const rows = farms.getLastRow() > 1
    ? farms.getRange(2, 1, farms.getLastRow() - 1, 2).getValues()
    : [];
  const farm = rows.find(function(row) { return String(row[0]) === farmId; });
  return farm ? String(farm[1] || '') : '';
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

function saveFeedForecast_(payload, requestedFarmId) {
  const farmId = normalizeFarmId_(requestedFarmId);
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
        farmId,
      ]);
    });
  });

  const sheet = getSheet_(FORECAST_SHEET, FORECAST_HEADERS);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, FORECAST_HEADERS.length)
    .setValues(rows);
  return { status: 'SUCCESS', savedAt: timestamp.toISOString() };
}

function fetchFeedForecast_(weekStart, requestedFarmId) {
  const farmId = normalizeFarmId_(requestedFarmId);
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
    const rowFarmId = String(data[i][9] || DEFAULT_FARM_ID);
    if (rowFarmId === farmId && normalizeSheetDate_(data[i][2], timezone) === weekStart) {
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
