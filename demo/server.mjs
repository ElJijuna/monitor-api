import { createReadStream } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const requestedPort = Number(process.argv[process.argv.indexOf('--port') + 1]);
const port = Number.isSafeInteger(requestedPort) ? requestedPort : 4177;
const reports = [];

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

function resolveStaticPath(pathname) {
  const relative = pathname === '/' ? 'demo/index.html' : pathname.slice(1);
  const resolved = resolve(root, normalize(relative));

  return resolved.startsWith(root) ? resolved : null;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname === '/api/fetch') {
      sendJson(response, 200, { ok: true, source: 'fetch' });

      return;
    }

    if (url.pathname === '/api/xhr') {
      sendJson(response, 201, { ok: true, source: 'xhr', body: await readBody(request) });

      return;
    }

    if (url.pathname === '/api/report') {
      reports.push(JSON.parse(await readBody(request)));
      sendJson(response, 202, { accepted: true, count: reports.length });

      return;
    }

    if (url.pathname === '/api/reports') {
      sendJson(response, 200, { reports });

      return;
    }

    const filePath = resolveStaticPath(url.pathname);

    if (!filePath) {
      sendJson(response, 403, { error: 'Forbidden' });

      return;
    }

    await access(filePath);
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': mime[extname(filePath)] ?? 'application/octet-stream',
    });
    createReadStream(filePath).pipe(response);
  } catch {
    const fallback = join(root, 'demo/index.html');

    if (request.url === '/') {
      response.writeHead(200, { 'content-type': mime['.html'] });
      response.end(await readFile(fallback, 'utf8'));

      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`monitor-api demo listening on http://127.0.0.1:${port}`);
});
