export interface CalendarSignatureEvent {
  id?: string;
  title?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  location?: string;
  allDay?: boolean;
}

export interface CachedOutfitLike {
  calendarEvents?: CalendarSignatureEvent[];
}

export interface CoarseLocationCoords {
  latitude?: number | null;
  longitude?: number | null;
}

const LOCATION_BUCKET_SIZE_DEGREES = 0.5;

const normalizeDateValue = (value?: string | Date): string => {
  if (!value) return '';

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return typeof value === 'string' ? value : '';
  }

  return parsed.toISOString();
};

const formatDatePart = (value: number): string => value.toString().padStart(2, '0');

const buildLocationBucket = (value: number): number =>
  Math.round(value / LOCATION_BUCKET_SIZE_DEGREES);

const normalizeCalendarEvent = (event: CalendarSignatureEvent) => ({
  id: event.id || '',
  title: event.title || '',
  startDate: normalizeDateValue(event.startDate),
  endDate: normalizeDateValue(event.endDate),
  location: event.location || '',
  allDay: Boolean(event.allDay),
});

export const buildCalendarSignature = (events: CalendarSignatureEvent[] = []): string => {
  const uniqueEvents = new Map<string, ReturnType<typeof normalizeCalendarEvent>>();

  events.forEach((event) => {
    const normalized = normalizeCalendarEvent(event);
    const key = JSON.stringify(normalized);
    uniqueEvents.set(key, normalized);
  });

  return JSON.stringify(
    Array.from(uniqueEvents.values()).sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    )
  );
};

export const extractCalendarEventsFromOutfits = (outfits: CachedOutfitLike[] = []): CalendarSignatureEvent[] =>
  outfits.flatMap((outfit) => outfit.calendarEvents || []);

export const buildLocalDateKey = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = formatDatePart(date.getMonth() + 1);
  const day = formatDatePart(date.getDate());

  return `${year}-${month}-${day}`;
};

export const buildCoarseLocationSignature = (
  coords?: CoarseLocationCoords | null
): string | null => {
  if (
    typeof coords?.latitude !== 'number' ||
    typeof coords?.longitude !== 'number' ||
    Number.isNaN(coords.latitude) ||
    Number.isNaN(coords.longitude)
  ) {
    return null;
  }

  const latitudeBucket = buildLocationBucket(coords.latitude);
  const longitudeBucket = buildLocationBucket(coords.longitude);

  return `${latitudeBucket}:${longitudeBucket}`;
};
