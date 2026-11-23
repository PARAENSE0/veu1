/**
 * Endereço do servidor do jogo.
 *
 * - Vazio (padrão): o cliente usa o mesmo endereço de onde a página foi
 *   carregada. É o caso do site/PWA e do APK gerado pelo PWABuilder.
 * - Preenchido na compilação (SERVER_URL=https://seu-servidor npm run build):
 *   necessário quando o cliente roda empacotado fora do servidor, como num
 *   app Capacitor. Nesse caso, libere a origem do app em ALLOWED_ORIGINS no servidor.
 */
declare const __SERVER_URL__: string;

export const SERVER_URL: string = (typeof __SERVER_URL__ === 'string' ? __SERVER_URL__ : '').replace(/\/+$/, '');

export function apiUrl(path: string) {
  return SERVER_URL + path;
}

export function wsUrl() {
  if (SERVER_URL) return SERVER_URL.replace(/^http/, 'ws') + '/ws';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}
