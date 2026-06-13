import { describe, expect, it } from '@jest/globals';
import {
  buildWeatherStylingGuidance,
  formatWeatherForDisplay,
  getWeatherTemperatureContext,
  summarizeNwsHourlyForecast,
  summarizeOpenWeatherTodayForecast,
} from '../weatherUtils';

describe('weatherUtils', () => {
  it('summarizes the rest of today instead of only the current temperature', () => {
    const now = new Date('2026-05-20T08:00:00-07:00');
    const forecast = summarizeOpenWeatherTodayForecast({
      currentTemperature: 54,
      currentFeelsLike: 53,
      now,
      convertTemperature: value => Math.round(value),
      forecastEntries: [
        {
          dt: Math.floor(new Date('2026-05-20T12:00:00-07:00').getTime() / 1000),
          main: { temp: 70, temp_min: 68, temp_max: 74 },
        },
        {
          dt: Math.floor(new Date('2026-05-20T21:00:00-07:00').getTime() / 1000),
          main: { temp: 63, temp_min: 61, temp_max: 65 },
        },
        {
          dt: Math.floor(new Date('2026-05-21T12:00:00-07:00').getTime() / 1000),
          main: { temp: 80, temp_min: 78, temp_max: 82 },
        },
      ],
    });

    expect(forecast).toEqual(expect.objectContaining({
      feelsLike: 53,
      lowTemperature: 54,
      highTemperature: 74,
      forecastEntryCount: 2,
    }));
  });

  it('summarizes NWS hourly periods into a current and high/low range', () => {
    const now = new Date('2026-05-20T08:30:00-07:00');
    const weather = summarizeNwsHourlyForecast({
      now,
      periods: [
        {
          startTime: '2026-05-20T08:00:00-07:00',
          endTime: '2026-05-20T09:00:00-07:00',
          temperature: 55,
          temperatureUnit: 'F',
          shortForecast: 'Mostly Cloudy',
          windSpeed: '5 to 10 mph',
          relativeHumidity: { value: 74 },
        },
        {
          startTime: '2026-05-20T14:00:00-07:00',
          endTime: '2026-05-20T15:00:00-07:00',
          temperature: 78,
          temperatureUnit: 'F',
          shortForecast: 'Sunny',
        },
      ],
    });

    expect(weather).toEqual(expect.objectContaining({
      temperature: 55,
      lowTemperature: 55,
      highTemperature: 78,
      windSpeed: 10,
      forecastEntryCount: 2,
    }));
  });

  it('treats a cool morning and warm midday as removable-layer weather', () => {
    const weather = {
      temperature: 54,
      feelsLike: 53,
      lowTemperature: 54,
      highTemperature: 74,
      tempUnit: 'F',
      condition: 'Clear',
      description: 'clear sky',
    };

    const context = getWeatherTemperatureContext(weather);

    expect(context.coolNowWarmLater).toBe(true);
    expect(context.baseOutfitTemperatureF).toBe(74);
    expect(formatWeatherForDisplay(weather)).toBe('54°F now, 54-74°F today, clear sky');
    expect(buildWeatherStylingGuidance(weather)).toContain('removable layer');
  });
});
