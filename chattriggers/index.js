/// <reference types="../CTAutocomplete" />
/**
 * MCChatAI — the in-game half.
 *
 * Drop this folder in .minecraft/config/ChatTriggers/modules/MCChatAI/, run
 * `mcchat` on the same machine, then `/ct reload`.
 *
 * It streams chat, nearby players and pathfinder state to the local brain and
 * types whatever the brain sends back. No API key ever touches the client.
 *
 * Written against ChatTriggers 2.x on 1.8.9. Other CT versions may need small
 * tweaks to the Player/World calls.
 */

const HOST = 'http://127.0.0.1:8787';
const TOKEN = ''; // must match bridge.token in your config

// --- how "someone is blocking my pathfinder" is detected -------------------
const BLOCK_DISTANCE = 4.0;   // blocks
const BLOCK_CONE = 0.55;      // dot product: how directly in front they must be
const STALL_TICKS = 20;       // ~1s of no movement while someone is in front
const POLL_TICKS = 10;        // how often to ask the brain for replies

let enabled = true;
let stalledTicks = 0;
let lastPos = null;
let tick = 0;

// A macro can call this directly: MCChatAI.pathfinder("blocked", "SomePlayer")
export function pathfinder(state, blockedByName, distance) {
  post('/event', {
    type: 'pathfinder',
    state: state,
    blockedBy: blockedByName ? { name: blockedByName, distance: distance || null } : null,
  });
}

// --------------------------------------------------------------------------

const URL = Java.type('java.net.URL');
const Thread = Java.type('java.lang.Thread');
const Scanner = Java.type('java.util.Scanner');

function request(method, path, payload, onDone) {
  new Thread(function () {
    try {
      const connection = new URL(HOST + path).openConnection();
      connection.setRequestMethod(method);
      connection.setConnectTimeout(2000);
      connection.setReadTimeout(12000);
      connection.setRequestProperty('Content-Type', 'application/json');
      if (TOKEN) connection.setRequestProperty('X-Auth', TOKEN);

      if (payload !== null && payload !== undefined) {
        connection.setDoOutput(true);
        const out = connection.getOutputStream();
        out.write(new java.lang.String(JSON.stringify(payload)).getBytes('UTF-8'));
        out.flush();
        out.close();
      }

      const scanner = new Scanner(connection.getInputStream(), 'UTF-8').useDelimiter('\\A');
      const body = scanner.hasNext() ? scanner.next() : '{}';
      scanner.close();
      if (onDone) onDone(JSON.parse(body));
    } catch (error) {
      // Brain not running, or it restarted. Stay quiet rather than spamming chat.
    }
  }).start();
}

function post(path, payload) {
  request('POST', path, payload, null);
}

/** Everything the brain sends back gets typed on the main thread. */
function drain() {
  request('GET', '/poll', null, function (response) {
    if (!response || !response.actions) return;
    response.actions.forEach(function (action) {
      const delay = Math.max(1, Math.round((action.delayMs || 800) / 50)); // ms -> ticks
      Client.scheduleTask(delay, function () {
        if (!enabled) return;
        ChatLib.say(action.command);
      });
    });
  });
}

// --- chat ------------------------------------------------------------------

register('chat', function (event) {
  if (!enabled) return;
  try {
    const line = ChatLib.getChatMessage(event, true);
    post('/event', { type: 'chat', raw: line });
  } catch (error) {
    // ignore malformed lines
  }
}).setCriteria('${*}');

// --- world snapshot + pathfinder heuristic ---------------------------------

function lookVector() {
  const yaw = (Player.getYaw() + 90) * Math.PI / 180;
  return { x: Math.cos(yaw), z: Math.sin(yaw) };
}

/** Nearest player standing inside the cone in front of us. */
function playerInFront() {
  const look = lookVector();
  const players = World.getAllPlayers();
  let best = null;

  for (let i = 0; i < players.length; i++) {
    const other = players[i];
    const name = other.getName();
    if (name === Player.getName()) continue;

    const dx = other.getX() - Player.getX();
    const dz = other.getZ() - Player.getZ();
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance > BLOCK_DISTANCE || distance < 0.1) continue;

    const dot = (dx / distance) * look.x + (dz / distance) * look.z;
    if (dot < BLOCK_CONE) continue;
    if (!best || distance < best.distance) best = { name: name, distance: distance };
  }
  return best;
}

register('tick', function () {
  if (!enabled) return;
  tick++;

  const pos = { x: Player.getX(), y: Player.getY(), z: Player.getZ() };
  const moved = lastPos
    ? Math.abs(pos.x - lastPos.x) + Math.abs(pos.y - lastPos.y) + Math.abs(pos.z - lastPos.z)
    : 1;
  lastPos = pos;

  const blocker = playerInFront();
  if (blocker && moved < 0.02) {
    stalledTicks++;
    if (stalledTicks === STALL_TICKS) {
      // Stalled with someone directly in front — report it once per stall.
      pathfinder('blocked', blocker.name, blocker.distance);
    }
  } else {
    if (stalledTicks >= STALL_TICKS) pathfinder('running', null);
    stalledTicks = 0;
  }

  if (tick % POLL_TICKS === 0) drain();

  if (tick % 40 === 0) {
    const players = World.getAllPlayers();
    const nearby = [];
    for (let i = 0; i < players.length && nearby.length < 12; i++) {
      const other = players[i];
      if (other.getName() === Player.getName()) continue;
      const dx = other.getX() - Player.getX();
      const dz = other.getZ() - Player.getZ();
      nearby.push({ name: other.getName(), distance: Math.sqrt(dx * dx + dz * dz) });
    }
    post('/events', [
      { type: 'players', nearby: nearby },
      { type: 'self', username: Player.getName(), health: Player.getHP() },
    ]);
  }
});

// --- commands --------------------------------------------------------------

register('command', function (argument) {
  if (argument === 'off') {
    enabled = false;
    ChatLib.chat('&c[MCChatAI] off');
  } else if (argument === 'on') {
    enabled = true;
    ChatLib.chat('&a[MCChatAI] on');
  } else {
    ChatLib.chat('&e[MCChatAI] ' + (enabled ? 'on' : 'off') + ' — /mcchat on|off');
  }
}).setName('mcchat');

ChatLib.chat('&a[MCChatAI] loaded — talking to ' + HOST);
