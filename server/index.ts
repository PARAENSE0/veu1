/**
 * Ponto de entrada do servidor.
 * Variáveis de ambiente:
 *   PORT            porta HTTP/WS (padrão 8080)
 *   HOST            interface (padrão 0.0.0.0)
 *   DATA_FILE       arquivo do FileStore (padrão ./data/db.json)
 *   TRUST_PROXY     "1" se estiver atrás de proxy reverso (usa X-Forwarded-For)
 *   ALLOWED_ORIGINS lista separada por vírgula de origens aceitas no WebSocket
 *   ANDROID_ASSETLINKS conteúdo JSON do assetlinks.json gerado pelo PWABuilder
 *   ICE_SERVERS     JSON com servidores STUN/TURN para a voz, ex.:
 *                   [{"urls":"turn:turn.exemplo.com:3478","username":"u","credential":"s"}]
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';

const here = dirname(fileURLToPath(import.meta.url));

const app = await createApp({
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  dataFile: process.env.DATA_FILE ?? join(process.cwd(), 'data', 'db.json'),
  publicDir: join(here, 'public'),
  trustProxy: process.env.TRUST_PROXY === '1',
  assetLinks: process.env.ANDROID_ASSETLINKS ? JSON.stringify(JSON.parse(process.env.ANDROID_ASSETLINKS)) : undefined,
  iceServers: process.env.ICE_SERVERS ? JSON.parse(process.env.ICE_SERVERS) : undefined,
  allowedOrigins: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : undefined,
});

const shutdown = async () => {
  console.log('[véu] encerrando...');
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
