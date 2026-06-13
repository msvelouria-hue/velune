import type { WeatherData } from './dailyPicksTypes';
import { formatWeatherDiagnostics, formatWeatherForDisplay, summarizeNwsHourlyForecast } from './weatherUtils';

interface WeatherCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

interface NwsRelativeLocation {
  properties?: {
    city?: string;
    state?: string;
  };
}

function buildNwsHeaders() {
  return {
    Accept: 'application/geo+json',
    'User-Agent': 'Vestiary outfit weather (contact: support@vestiary.app)',
  };
}

function formatLocationName(relativeLocation: NwsRelativeLocation | undefined): string | undefined {
  const city = relativeLocation?.properties?.city;
  const state = relativeLocation?.properties?.state;

  if (city && state) return `${city}, ${state}`;
  return city || state;
}

export async function fetchWeatherForCoordinates(coords: WeatherCoordinates): Promise<WeatherData | null> {
  const point = `${coords.latitude.toFixed(4)},${coords.longitude.toFixed(4)}`;
  const pointResponse = await fetch(`https://api.weather.gov/points/${point}`, {
    headers: buildNwsHeaders(),
  });

  if (!pointResponse.ok) {
    throw new Error(`NWS points error: ${pointResponse.status}`);
  }

  const pointData = await pointResponse.json();
  const hourlyUrl = pointData.properties?.forecastHourly;
  if (!hourlyUrl) {
    throw new Error('NWS points response did not include forecastHourly');
  }

  const hourlyResponse = await fetch(hourlyUrl, {
    headers: buildNwsHeaders(),
  });

  if (!hourlyResponse.ok) {
    throw new Error(`NWS hourly forecast error: ${hourlyResponse.status}`);
  }

  const hourlyData = await hourlyResponse.json();
  const weather = summarizeNwsHourlyForecast({
    periods: Array.isArray(hourlyData.properties?.periods) ? hourlyData.properties.periods : [],
  });

  if (!weather) return null;

  const weatherWithSource: WeatherData = {
    ...weather,
    weatherProvider: 'National Weather Service hourly forecast',
    locationName: formatLocationName(pointData.properties?.relativeLocation),
    locationAccuracyMeters: typeof coords.accuracy === 'number' ? Math.round(coords.accuracy) : undefined,
  };

  console.log(`Weather fetched: ${formatWeatherForDisplay(weatherWithSource)}; ${formatWeatherDiagnostics(weatherWithSource)}`);
  return weatherWithSource;
}
