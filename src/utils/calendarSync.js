import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

export const isCalendarConnected = async () => {
  const { status } = await Calendar.getCalendarPermissionsAsync();
  return status === 'granted';
};

export const requestCalendarPermissions = async () => {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === 'granted';
};

// Aliases so we don't break GlassSidebar imports
export const isGoogleCalendarConnected = isCalendarConnected;
export const isMicrosoftCalendarConnected = isCalendarConnected;

export const getConnectedCalendarsPrompt = async () => {
  const hasPermission = await isCalendarConnected();
  if (!hasPermission) {
    return '\n[System Note: Device Calendar permission is not granted. Tell the user to connect the Device Calendar in the sidebar.]';
  }

  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const visibleCalendars = calendars.filter(c => c.allowsModifications || c.title.toLowerCase().includes('primary'));
    const calendarIds = visibleCalendars.map(c => c.id);

    if (calendarIds.length === 0) {
      return '\n[System Note: No readable calendars found on the device.]';
    }

    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 7); // Fetch next 7 days

    const events = await Calendar.getEventsAsync(calendarIds, start, end);
    
    if (!events || events.length === 0) {
      return '\n[System Note: Connected calendars were checked successfully. There are no calendar events scheduled for the next 7 days.]';
    }

    let combinedEvents = `\n\nUser's Upcoming Calendar Events (Next 7 Days):\n--- Device Calendar Events ---\n`;
    
    events.forEach(event => {
      const startDate = new Date(event.startDate).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      combinedEvents += `- ${event.title} (${startDate})\n`;
    });

    combinedEvents += '\nCRITICAL RULE: Do not schedule tasks during these booked time slots. If the user asks about the calendar, answer from this event list.\n';
    return combinedEvents;

  } catch (err) {
    console.log('[CalendarSync] Failed to fetch device events:', err);
    return `\n[System Note: Failed to fetch calendar events: ${err.message}]`;
  }
};
