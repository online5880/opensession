import blessed from 'blessed';
import { listActiveSessions, getSessionEvents, subscribeToSessionEvents } from './supabase.js';

export async function startTui(client, options = {}) {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'OpenSession TUI Dashboard'
  });

  const layout = blessed.layout({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%'
  });

  const header = blessed.box({
    parent: layout,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    content: ' OpenSession TUI Dashboard ',
    style: {
      fg: 'white',
      bg: 'blue',
      bold: true
    },
    border: {
      type: 'line'
    }
  });

  const sessionList = blessed.list({
    parent: layout,
    top: 3,
    left: 0,
    width: '30%',
    height: '100%-3',
    label: ' Active Sessions ',
    border: {
      type: 'line'
    },
    style: {
      selected: {
        bg: 'magenta'
      },
      border: {
        fg: 'cyan'
      }
    },
    keys: true,
    mouse: true
  });

  const eventLog = blessed.log({
    parent: layout,
    top: 3,
    left: '30%',
    width: '70%',
    height: '100%-3',
    label: ' Session Events ',
    border: {
      type: 'line'
    },
    style: {
      border: {
        fg: 'yellow'
      }
    },
    scrollable: true,
    alwaysScroll: true,
    mouse: true
  });

  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    content: ' [R] Refresh | [Q] Quit | [↑/↓] Select Session ',
    style: {
      fg: 'black',
      bg: 'white'
    }
  });

  let sessions = [];
  let selectedSessionId = null;
  let unsubscribeRealtime = null;

  async function refreshSessions() {
    try {
      header.setContent(` Loading sessions... `);
      screen.render();
      
      const activeSessions = await listActiveSessions(client);
      sessions = activeSessions || [];
      
      sessionList.setItems(sessions.map(s => `${s.actor} (${s.id.slice(0, 8)})`));
      header.setContent(` OpenSession TUI Dashboard | Total: ${sessions.length} `);
      screen.render();
    } catch (error) {
      header.setContent(` Error: ${error.message} `);
      screen.render();
    }
  }

  async function loadInitialEvents() {
    if (!selectedSessionId) return;

    try {
      const events = await getSessionEvents(client, selectedSessionId);
      eventLog.clear();
      if (events && events.length > 0) {
        events.forEach(e => {
          eventLog.log(`[${new Date(e.created_at).toLocaleTimeString()}] ${e.type}: ${JSON.stringify(e.payload)}`);
        });
      } else {
        eventLog.log(' No events found for this session.');
      }
      screen.render();
    } catch (error) {
      eventLog.log(` Error loading events: ${error.message}`);
      screen.render();
    }
  }

  sessionList.on('select', async (item, index) => {
    const session = sessions[index];
    if (!session) return;

    selectedSessionId = session.id;
    eventLog.setContent(` Loading events for ${session.id}... \n`);
    screen.render();

    if (unsubscribeRealtime) {
      unsubscribeRealtime();
      unsubscribeRealtime = null;
    }
    
    await loadInitialEvents();
    
    // Set up Realtime subscription for the selected session
    unsubscribeRealtime = subscribeToSessionEvents(client, selectedSessionId, (newEvent) => {
      // Append the new event to the log instantly
      eventLog.log(`[${new Date(newEvent.created_at).toLocaleTimeString()}] ${newEvent.type}: ${JSON.stringify(newEvent.payload)}`);
      screen.render();
    });
  });

  screen.key(['escape', 'q', 'C-c'], () => {
    if (unsubscribeRealtime) unsubscribeRealtime();
    process.exit(0);
  });
  screen.key(['r'], () => refreshSessions());

  await refreshSessions();
  screen.render();
}
