import { formatWeatherForDisplay } from './weatherUtils';
import { buildDressCodeReasoning } from './dressCode';

interface PremiumReasoningSource {
  reasoning?: string;
  occasion?: string;
  freshnessReasoning?: string;
}

interface PremiumWeatherReasoningInput {
  temperature: number;
  feelsLike?: number;
  lowTemperature?: number;
  highTemperature?: number;
  tempUnit?: string;
  description: string;
}

interface PremiumEventReasoningInput {
  title: string;
}

const DEFAULT_STYLE_REASONING = 'Selected to create a balanced look for today';
const DEFAULT_FRESHNESS_REASONING =
  'Built around wardrobe rotation so the outfit still feels fresh today';

function normalizeReasoningText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildPremiumOutfitReasoning(
  outfit: PremiumReasoningSource,
  weather: PremiumWeatherReasoningInput | null,
  events: PremiumEventReasoningInput[],
  dressCode?: string | null
) {
  const eventReasoning = events.length > 0 ? events.map(event => event.title).join(', ') : 'No special events today';
  const dressCodeReasoning = buildDressCodeReasoning(dressCode);

  return {
    weather: weather
      ? formatWeatherForDisplay({ ...weather, condition: weather.description })
      : 'Weather data unavailable',
    events: dressCodeReasoning ? `${eventReasoning}; Dress code: ${dressCodeReasoning}` : eventReasoning,
    style:
      normalizeReasoningText(outfit.reasoning) ||
      normalizeReasoningText(outfit.occasion) ||
      DEFAULT_STYLE_REASONING,
    freshness:
      normalizeReasoningText(outfit.freshnessReasoning) || DEFAULT_FRESHNESS_REASONING,
  };
}
