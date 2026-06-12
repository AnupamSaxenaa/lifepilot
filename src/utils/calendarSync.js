import * as Calendar from 'expo-calendar';

/**
 * Check if calendar permissions are granted
 * Note: In Expo SDK 56, we should use requestCalendarPermissionsAsync for both checking and requesting
 */
export const isCalendarConnected = async () => {
  try {
    const { status, granted } = await Calendar.getCalendarPermissions();
    console.log('[CalendarSync] Permission status:', { status, granted });
    return status === 'granted';
  } catch (err) {
    console.error('[CalendarSync] Permission check failed:', err);
    return false;
  }
};

/**
 * Request calendar permissions from user
 * This is the same as isCalendarConnected because requestCalendarPermissionsAsync
 * handles both checking and requesting
 */
export const requestCalendarPermissions = async () => {
  try {
    console.log('[CalendarSync] Requesting calendar permission...');
    const { status, granted, canAskAgain } = await Calendar.requestCalendarPermissions();
    console.log('[CalendarSync] Permission result:', { status, granted, canAskAgain });
    
    return status === 'granted';
  } catch (err) {
    console.error('[CalendarSync] Permission request failed:', err);
    console.error('[CalendarSync] Error details:', err.message);
    return false;
  }
};

// Aliases for backward compatibility
export const isGoogleCalendarConnected = isCalendarConnected;
export const isMicrosoftCalendarConnected = isCalendarConnected;

/**
 * Fetch today's events - main entry point
 * @param {string} userId - User ID (not currently used, but kept for future extension)
 * @returns {Promise<string>} - Formatted calendar events or error message
 */
export const fetchTodayEvents = async (userId) => {
  return await getConnectedCalendarsPrompt();
};

/**
 * Get all calendar events and format them for AI context
 */
export const getConnectedCalendarsPrompt = async () => {
  // Check permission with detailed logging
  console.log('[CalendarSync] Starting getConnectedCalendarsPrompt...');
  const hasPermission = await isCalendarConnected();
  console.log('[CalendarSync] Has permission:', hasPermission);
  
  if (!hasPermission) {
    console.log('[CalendarSync] No calendar permission - returning note');
    return '\n[System Note: Device Calendar permission is not granted. Tell the user to connect the Device Calendar in the sidebar.]';
  }

  try {
    console.log('[CalendarSync] Fetching calendars...');
    // Fetch ALL calendars (not just modifiable ones)
    const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
    console.log('[CalendarSync] Found calendars:', calendars.length);
    console.log('[CalendarSync] Calendar details:', calendars.map(c => ({ id: c.id, title: c.title, source: c.source })));
    
    if (calendars.length === 0) {
      console.log('[CalendarSync] No calendars on device');
      return '\n[System Note: No calendars found on the device. Please add a calendar account in device settings.]';
    }

    // Use ALL calendars, not just modifiable ones (user may have read-only work calendars)
    const calendarIds = calendars.map(c => c.id);
    console.log('[CalendarSync] Using calendar IDs:', calendarIds);

    // Fetch events from today + next 7 days
    const start = new Date();
    start.setHours(0, 0, 0, 0); // Start of today
    
    const end = new Date();
    end.setDate(end.getDate() + 7);
    end.setHours(23, 59, 59, 999); // End of day 7 days from now

    console.log('[CalendarSync] Fetching events from', start.toISOString(), 'to', end.toISOString());
    
    const events = await Calendar.listEvents(calendarIds, start, end);
    console.log('[CalendarSync] Found events:', events?.length || 0);
    
    if (events && events.length > 0) {
      console.log('[CalendarSync] Event titles:', events.map(e => e.title));
    }
    
    if (!events || events.length === 0) {
      return '\n[System Note: Connected calendars were checked successfully. There are no calendar events scheduled for the next 7 days.]';
    }

    // Sort events by start date
    const sortedEvents = events.sort((a, b) => 
      new Date(a.startDate) - new Date(b.startDate)
    );

    let combinedEvents = `\n\n📅 User's Upcoming Calendar Events (Next 7 Days):\n--- Device Calendar Events ---\n`;
    
    sortedEvents.forEach(event => {
      const startDate = new Date(event.startDate);
      const endDate = new Date(event.endDate);
      
      // Format: "Mon, Jun 12 - 2:00 PM to 3:00 PM"
      const dateStr = startDate.toLocaleString('en-US', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric' 
      });
      
      const startTimeStr = startDate.toLocaleString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
      
      const endTimeStr = endDate.toLocaleString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
      
      // Include calendar name for context
      const calendarName = calendars.find(c => c.id === event.calendarId)?.title || 'Unknown';
      
      combinedEvents += `- ${event.title}\n`;
      combinedEvents += `  📍 ${dateStr} | ${startTimeStr} - ${endTimeStr}\n`;
      combinedEvents += `  📋 Calendar: ${calendarName}\n`;
      
      if (event.location) {
        combinedEvents += `  🗺️ Location: ${event.location}\n`;
      }
      
      if (event.notes) {
        combinedEvents += `  📝 Notes: ${event.notes.slice(0, 100)}${event.notes.length > 100 ? '...' : ''}\n`;
      }
      
      combinedEvents += '\n';
    });

    combinedEvents += '\n⚠️ CRITICAL RULE: Do NOT schedule tasks during these booked time slots. Always respect calendar events and avoid conflicts.\n';
    combinedEvents += '\n💡 If the user asks about their calendar or schedule, answer from this event list.\n';
    
    console.log('[CalendarSync] Returning calendar context with', sortedEvents.length, 'events');
    return combinedEvents;

  } catch (err) {
    console.error('[CalendarSync] Failed to fetch device events:', err);
    console.error('[CalendarSync] Error name:', err.name);
    console.error('[CalendarSync] Error message:', err.message);
    console.error('[CalendarSync] Error stack:', err.stack);
    
    // Return more specific error message
    let errorMsg = err.message;
    if (err.message.includes('permission')) {
      errorMsg = 'Calendar permission may have been revoked. Please check app settings.';
    } else if (err.message.includes('not available')) {
      errorMsg = 'Calendar API is not available on this device.';
    }
    
    return `\n[System Note: Failed to fetch calendar events: ${errorMsg}]`;
  }
};
