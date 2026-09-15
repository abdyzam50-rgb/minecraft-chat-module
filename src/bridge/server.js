import http from 'node:http';

/**
 * Local HTTP bridge between the game client and the brain.
 *
 * The in-game module (ChatTriggers, a Forge mod, whatever you have) POSTs
 * events and polls for replies. It binds to localhost by default — the API key
 * stays on this side and never goes near the client.
 *
 *   POST /event    {type:"chat"|"pathfinder"|"players"|"self"|"sent", ...}
 *   POST /events   [ ...batch of the above... ]
 *   GET  /poll     -> {actions:[...]}   queued chat lines to type
 *   GET  /health   -> {ok:true, ...}
 */
export function startBridge(ai, { log = console.log } = {}) {
  const { host, port, token } = ai.config.bridge;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    if (token && req.headers['x-auth'] !== token) {
      return send(res, 401, { error: 'bad or missing X-Auth header' });
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, {
        ok: true,
        username: ai.config.username,
        persona: ai.config.persona,
        usingApi: ai.usingApi,
        dryRun: ai.config.dryRun,
        queued: ai.outbox.length,
      });
    }

    if (req.method === 'GET' && url.pathname === '/poll') {
      return send(res, 200, { actions: ai.drain() });
    }

    if (req.method === 'POST' && (url.pathname === '/event' || url.pathname === '/events')) {
      return readBody(req, async (error, body) => {
        if (error) return send(res, 400, { error: error.message });
        const events = Array.isArray(body) ? body : [body];
        const actions = [];
        for (const event of events) {
          try {
            const action = await ai.handle(event);
            // A dry-run action is a record of what would have been said. It is
            // never queued for /poll, so returning it here would be the one
            // path that reaches the game with dry run on.
            if (action && !action.dryRun) actions.push(action);
          } catch (err) {
            log(`[bridge] error handling ${event?.type}: ${err.message}`);
          }
        }
        // Actions are also queued for /poll; returning them lets a client that
        // can wait on the response act immediately.
        send(res, 200, { ok: true, actions });
      });
    }

    send(res, 404, { error: 'not found' });
  });

  server.listen(port, host, () => {
    log(`[bridge] listening on http://${host}:${port}`);
    if (!token) log('[bridge] no token set — anything on this machine can post events');
  });

  return server;
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, callback) {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > 256 * 1024) {
      req.destroy();
      callback(new Error('payload too large'));
      return;
    }
    chunks.push(chunk);
  });
  req.on('error', callback);
  req.on('end', () => {
    try {
      callback(null, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
    } catch (error) {
      callback(new Error(`invalid JSON: ${error.message}`));
    }
  });
}
