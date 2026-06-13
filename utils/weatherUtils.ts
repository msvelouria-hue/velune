import type { WeatherData } from './dailyPicksTypes';

export interface OpenWeatherForecastEntry {
  dt?: number;
  main?: {
    temp?: number;
    temp_min?: number;
    temp_max?: number;
    feels_like?: number;
  };
}

export interface NwsForecastPeriod {
  name?: string;
  startTime?: string;
  endTime?: string;
  temperature?: number;
  temperatureUnit?: string;
  shortForecast?: string;
  windSpeed?: string;
  relativeHumidity?: {
    value?: number;
  };
}

export interface WeatherTemperatureContext {
  currentF: number;
  feelsLikeF: number;
  lowF: number;
  highF: number;
  effectiveCurrentF: number;
  effectiveLowF: number;
  effectiveHighF: number;
  baseOutfitTemperatureF: number;
  dailyRangeF: number;
  hasForecastRange: boolean;
  hasLargeTemperatureSwing: boolean;
  coolNowWarmLater: boolean;
  coldNowWarmerLater: boolean;
}

export type WeatherForecastSummary = Pick<WeatherData, 'lowTemperature' | 'highTemperature' | 'feelsLike' | 'forecastEntryCount' | 'lowTemperatureAt' | 'highTemperatureAt'>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function roundTemperature(value: number): number {
  return Math.round(value);
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function isFahrenheitLocale(locale = Intl.DateTimeFormat().resolvedOptions().locale): boolean {
  return locale.toLowerCase().includes('us');
}

export function convertMetricTemperature(celsius: number, useFahrenheit: boolean): number {
  return roundTemperature(useFahrenheit ? celsius * 9 / 5 + 32 : celsius);
}

export function toFahrenheit(temperature: number, unit: string | undefined): number {
  return unit === 'F' ? temperature : temperature * 9 / 5 + 32;
}

export function summarizeOpenWeatherTodayForecast({
  currentTemperature,
  currentFeelsLike,
  forecastEntries,
  convertTemperature,
  now = new Date(),
}: {
  currentTemperature: number;
  currentFeelsLike?: number;
  forecastEntries?: OpenWeatherForecastEntry[];
  convertTemperature: (temperature: number) => number;
  now?: Date;
}): WeatherForecastSummary {
  const candidates: Array<{ temperature: number; timestamp: string }> = [
    { temperature: currentTemperature, timestamp: now.toISOString() },
  ];
  const feelsLike = isFiniteNumber(currentFeelsLike) ? roundTemperature(currentFeelsLike) : undefined;
  const nowMs = now.getTime();
  const todayKey = localDayKey(now);
  const forecastLookbackMs = 3 * 60 * 60 * 1000;
  let forecastEntryCount = 0;

  for (const entry of forecastEntries || []) {
    if (!isFiniteNumber(entry.dt)) continue;

    const forecastDate = new Date(entry.dt * 1000);
    const forecastMs = forecastDate.getTime();
    if (localDayKey(forecastDate) !== todayKey) continue;
    if (forecastMs < nowMs - forecastLookbackMs) continue;

    const main = entry.main;
    if (!main) continue;

    forecastEntryCount++;
    [main.temp, main.temp_min, main.temp_max]
      .filter(isFiniteNumber)
      .forEach(value => {
        candidates.push({
          temperature: convertTemperature(value),
          timestamp: forecastDate.toISOString(),
        });
      });
  }

  const low = candidates.reduce((lowest, candidate) =>
    candidate.temperature < lowest.temperature ? candidate : lowest
  );
  const high = candidates.reduce((highest, candidate) =>
    candidate.temperature > highest.temperature ? candidate : highest
  );

  return {
    feelsLike,
    lowTemperature: roundTemperature(low.temperature),
    highTemperature: roundTemperature(high.temperature),
    forecastEntryCount,
    lowTemperatureAt: low.timestamp,
    highTemperatureAt: high.timestamp,
  };
}

function parseWindSpeedMph(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const speeds = value.match(/\d+/g)?.map(Number).filter(Number.isFinite) || [];
  if (speeds.length === 0) return undefined;

  return Math.max(...speeds);
}

export function summarizeNwsHourlyForecast({
  periods,
  now = new Date(),
}: {
  periods: NwsForecastPeriod[];
  now?: Date;
}): WeatherData | null {
  const usablePeriods = periods
    .filter(period => typeof period.temperature === 'number' && period.startTime)
    .sort((a, b) => new Date(a.startTime || '').getTime() - new Date(b.startTime || '').getTime());

  if (usablePeriods.length === 0) return null;

  const nowMs = now.getTime();
  const todayKey = localDayKey(now);
  const currentPeriod = usablePeriods.find(period => {
    const start = new Date(period.startTime || '').getTime();
    const end = new Date(period.endTime || period.startTime || '').getTime();
    return start <= nowMs && nowMs < end;
  }) || usablePeriods.find(period => new Date(period.startTime || '').getTime() >= nowMs) || usablePeriods[0];

  const todayPeriods = usablePeriods.filter(period => {
    const start = new Date(period.startTime || '');
    return localDayKey(start) === todayKey && start.getTime() >= nowMs - (60 * 60 * 1000);
  });
  const periodsForRange = todayPeriods.length > 0 ? todayPeriods : [currentPeriod];
  const low = periodsForRange.reduce((lowest, period) =>
    (period.temperature || 0) < (lowest.temperature || 0) ? period : lowest
  );
  const high = periodsForRange.reduce((highest, period) =>
    (period.temperature || 0) > (highest.temperature || 0) ? period : highest
  );
  const condition = currentPeriod.shortForecast || 'Unknown';

  return {
    temperature: roundTemperature(currentPeriod.temperature || 0),
    lowTemperature: roundTemperature(low.temperature || currentPeriod.temperature || 0),
    highTemperature: roundTemperature(high.temperature || currentPeriod.temperature || 0),
    tempUnit: currentPeriod.temperatureUnit || 'F',
    condition,
    description: condition,
    humidity: currentPeriod.relativeHumidity?.value,
    windSpeed: parseWindSpeedMph(currentPeriod.windSpeed),
    forecastEntryCount: periodsForRange.length,
    lowTemperatureAt: low.startTime,
    highTemperatureAt: high.startTime,
  };
}

export function formatWeatherTemperature(temperature: number | undefined, unit = 'C'): string {
  return isFiniteNumber(temperature) ? `${roundTemperature(temperature)}°${unit}` : '';
}

export function formatWeatherRange(weather: WeatherData | null | undefined): string {
  if (!weather) return 'Weather data unavailable';

  const unit = weather.tempUnit || 'C';
  const current = formatWeatherTemperature(weather.temperature, unit);
  const low = weather.lowTemperature;
  const high = weather.highTemperature;

  if (isFiniteNumber(low) && isFiniteNumber(high) && Math.abs(high - low) >= 2) {
    return `${current} now, ${roundTemperature(low)}-${roundTemperature(high)}°${unit} today`;
  }

  return current;
}

export function formatWeatherForDisplay(weather: WeatherData | null | undefined): string {
  if (!weather) return 'Weather data unavailable';

  const summary = formatWeatherRange(weather);
  return weather.description ? `${summary}, ${weather.description}` : summary;
}

export function formatWeatherTimestamp(isoTimestamp: string | undefined): string {
  if (!isoTimestamp) return '';

  try {
    return new Date(isoTimestamp).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function formatWeatherDiagnostics(weather: WeatherData | null | undefined): string {
  if (!weather) return '';

  const parts = [
    weather.weatherProvider,
    weather.locationName && `location: ${weather.locationName}`,
    weather.locationAccuracyMeters !== undefined && `accuracy: ~${weather.locationAccuracyMeters}m`,
    weather.forecastEntryCount !== undefined && `forecast blocks: ${weather.forecastEntryCount}`,
    weather.highTemperatureAt && `high source: ${formatWeatherTimestamp(weather.highTemperatureAt)}`,
  ].filter(Boolean);

  return parts.join('; ');
}

export function getWeatherTemperatureContext(
  weather: WeatherData | null | undefined,
  temperatureAdjustmentF = 0,
  calculatedFeelsLikeF?: number
): WeatherTemperatureContext {
  const currentF = weather ? toFahrenheit(weather.temperature, weather.tempUnit) : 68;
  const lowF = weather?.lowTemperature !== undefined
    ? toFahrenheit(weather.lowTemperature, weather.tempUnit)
    : currentF;
  const highF = weather?.highTemperature !== undefined
    ? toFahrenheit(weather.highTemperature, weather.tempUnit)
    : currentF;
  const apiFeelsLikeF = weather?.feelsLike !== undefined
    ? toFahrenheit(weather.feelsLike, weather.tempUnit)
    : undefined;
  const feelsLikeF = calculatedFeelsLikeF ?? apiFeelsLikeF ?? currentF;
  const effectiveCurrentF = feelsLikeF - temperatureAdjustmentF;
  const effectiveLowF = lowF - temperatureAdjustmentF;
  const effectiveHighF = highF - temperatureAdjustmentF;
  const dailyRangeF = Math.max(0, highF - lowF);
  const hasForecastRange = weather?.lowTemperature !== undefined || weather?.highTemperature !== undefined;
  const hasLargeTemperatureSwing = dailyRangeF >= 12 || effectiveHighF - effectiveCurrentF >= 8;
  const coolNowWarmLater = effectiveCurrentF < 64 && effectiveHighF >= 68;
  const coldNowWarmerLater = effectiveCurrentF < 50 && effectiveHighF >= 60;

  return {
    currentF,
    feelsLikeF,
    lowF,
    highF,
    effectiveCurrentF,
    effectiveLowF,
    effectiveHighF,
    baseOutfitTemperatureF: coolNowWarmLater ? effectiveHighF : effectiveCurrentF,
    dailyRangeF,
    hasForecastRange,
    hasLargeTemperatureSwing,
    coolNowWarmLater,
    coldNowWarmerLater,
  };
}

export function buildWeatherStylingGuidance(weather: WeatherData | null | undefined): string {
  if (!weather) return 'Weather unavailable; choose flexible layers if plans run long.';

  const context = getWeatherTemperatureContext(weather);
  if (context.coolNowWarmLater || context.coldNowWarmerLater) {
    if (context.highF >= 72) {
      return 'Cool now but warm by midday; summer or warm-weather main pieces are appropriate, with a removable layer for the morning.';
    }

    return 'Cool now and warmer later; build the outfit for the high and add a removable layer for the morning.';
  }
  if (context.hasLargeTemperatureSwing) {
    return 'Noticeable temperature swing; prioritize removable layers and breathable base pieces.';
  }
  if (context.effectiveHighF < 50) {
    return 'Cold all day; use warm layers, closed shoes, and weather-protective outerwear.';
  }
  if (context.effectiveCurrentF < 64) {
    return 'Cool conditions; include a warm layer that can stay on comfortably.';
  }
  if (context.effectiveHighF >= 75) {
    return 'Warm part of day; favor breathable fabrics and lighter layers.';
  }

  return 'Mild weather; a single balanced outfit should stay comfortable.';
}
