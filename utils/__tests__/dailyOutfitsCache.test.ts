import { describe, expect, it } from '@jest/globals';
import {
  buildCalendarSignature,
  buildCoarseLocationSignature,
  buildLocalDateKey,
  extractCalendarEventsFromOutfits,
} from '../dailyOutfitsCache';

describe('dailyOutfitsCache', () => {
  it('treats the same calendar context as stable regardless of outfit duplication or ordering', () => {
    const morningMeeting = {
      id: 'evt-1',
      title: 'Morning Meeting',
      startDate: '2026-04-08T09:00:00.000Z',
      endDate: '2026-04-08T10:00:00.000Z',
      location: 'Studio',
      allDay: false,
    };
    const dinner = {
      id: 'evt-2',
      title: 'Dinner',
      startDate: '2026-04-08T18:00:00.000Z',
      endDate: '2026-04-08T19:30:00.000Z',
      location: 'Town',
      allDay: false,
    };

    const outfits = [
      { calendarEvents: [morningMeeting, dinner] },
      { calendarEvents: [dinner, morningMeeting] },
    ];

    expect(buildCalendarSignature(extractCalendarEventsFromOutfits(outfits))).toBe(
      buildCalendarSignature([dinner, morningMeeting])
    );
  });

  it('changes when a calendar event is removed', () => {
    const before = buildCalendarSignature([
      {
        id: 'evt-1',
        title: 'Morning Meeting',
        startDate: '2026-04-08T09:00:00.000Z',
        endDate: '2026-04-08T10:00:00.000Z',
      },
      {
        id: 'evt-2',
        title: 'Dinner',
        startDate: '2026-04-08T18:00:00.000Z',
        endDate: '2026-04-08T19:30:00.000Z',
      },
    ]);

    const after = buildCalendarSignature([
      {
        id: 'evt-1',
        title: 'Morning Meeting',
        startDate: '2026-04-08T09:00:00.000Z',
        endDate: '2026-04-08T10:00:00.000Z',
      },
    ]);

    expect(after).not.toBe(before);
  });

  it('builds the day key from the local calendar day', () => {
    const localMorning = new Date(2026, 3, 8, 9, 30, 0, 0);

    expect(buildLocalDateKey(localMorning)).toBe('2026-04-08');
  });

  it('uses a coarse location signature so nearby coordinates stay stable', () => {
    const sanFrancisco = buildCoarseLocationSignature({
      latitude: 37.7749,
      longitude: -122.4194,
    });
    const nearbySanFrancisco = buildCoarseLocationSignature({
      latitude: 37.81,
      longitude: -122.41,
    });
    const sydney = buildCoarseLocationSignature({
      latitude: -33.8688,
      longitude: 151.2093,
    });

    expect(nearbySanFrancisco).toBe(sanFrancisco);
    expect(sydney).not.toBe(sanFrancisco);
  });

  it('returns null for a coarse location signature when coordinates are missing', () => {
    expect(buildCoarseLocationSignature()).toBeNull();
    expect(buildCoarseLocationSignature({ latitude: 1.2 })).toBeNull();
    expect(buildCoarseLocationSignature({ longitude: 151.2 })).toBeNull();
  });

  it('normalizes Date objects and ISO strings into the same calendar signature', () => {
    const dateObjectSignature = buildCalendarSignature([
      {
        id: 'evt-1',
        title: 'Morning Meeting',
        startDate: new Date('2026-04-08T09:00:00.000Z'),
        endDate: new Date('2026-04-08T10:00:00.000Z'),
      },
    ]);

    const isoStringSignature = buildCalendarSignature([
      {
        id: 'evt-1',
        title: 'Morning Meeting',
        startDate: '2026-04-08T09:00:00.000Z',
        endDate: '2026-04-08T10:00:00.000Z',
      },
    ]);

    expect(dateObjectSignature).toBe(isoStringSignature);
  });
});
