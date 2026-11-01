import { execFile } from 'node:child_process';
import type { Plugin, ViteDevServer } from 'vite';

export type DevBridgeOptions = {
  cliPath: string;
  dslPath: string;
  viewKey: string;
  port: number;
};

export function isTrustedRequest(
  request: { method?: string; url?: string; headers: { host?: string | string[]; origin?: string | string[] } },
  port: number,
): boolean {
  return request.method === 'GET'
    && request.url === '/api/view'
    && request.headers.host === `127.0.0.1:${port}`
    && (request.headers.origin === undefined || request.headers.origin === `http://127.0.0.1:${port}`);
}

export function konturDevBridge(options: DevBridgeOptions): Plugin {
  return {
    name: 'kontur-local-cli-bridge',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?', 1)[0] !== '/api/view') {
          next();
          return;
        }
        if (request.url !== '/api/view') {
          response.statusCode = 400;
          response.end();
          return;
        }
        if (!isTrustedRequest(request, options.port)) {
          response.statusCode = request.method === 'GET' ? 403 : 405;
          response.end();
          return;
        }

        execFile(options.cliPath, ['view', options.dslPath, '--view', options.viewKey], {
          encoding: 'utf8',
          maxBuffer: 5 * 1024 * 1024,
          timeout: 30_000,
        }, (_error, stdout) => {
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          if (stdout) {
            response.statusCode = 200;
            response.end(stdout);
          } else {
            response.statusCode = 500;
            response.end(JSON.stringify({
              schemaVersion: 1,
              status: 'error',
              diagnostics: [{
                code: 'host',
                severity: 'error',
                message: 'The local Kontur CLI could not be started.',
                location: null,
              }],
            }));
          }
        });
      });
    },
  };
}
