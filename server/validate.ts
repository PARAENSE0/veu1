/** Validação de todas as mensagens recebidas pelo WebSocket (zod). */
import { z } from 'zod';
import type { ClientMsg } from '../shared/protocol';

const num = z.number().finite();
const cmd = z.object({
  seq: z.number().int().nonnegative(),
  mx: num.min(-1).max(1),
  mz: num.min(-1).max(1),
  yaw: num.min(-10).max(10),
  pitch: num.min(-2).max(2),
  b: z.number().int().min(0).max(3),
});

const ability = z.enum(['rastro', 'eco', 'ruptura', 'parasita', 'golpe']);
const eco = z.enum(['passos', 'porta', 'radio', 'alarme', 'presenca']);

export const clientMsg = z.discriminatedUnion('t', [
  z.object({ t: z.literal('auth'), token: z.string().min(10).max(120) }),
  z.object({ t: z.literal('room:create'), name: z.string().max(32), public: z.boolean(), map: z.string().max(32) }),
  z.object({ t: z.literal('room:join'), code: z.string().min(4).max(8) }),
  z.object({ t: z.literal('room:quick') }),
  z.object({ t: z.literal('room:leave') }),
  z.object({ t: z.literal('room:list') }),
  z.object({ t: z.literal('room:ready'), ready: z.boolean() }),
  z.object({ t: z.literal('room:settings'), public: z.boolean().optional(), map: z.string().max(32).optional(), name: z.string().max(32).optional() }),
  z.object({ t: z.literal('room:start') }),
  z.object({ t: z.literal('room:kick'), id: z.string().max(64) }),
  z.object({ t: z.literal('room:chat'), text: z.string().min(1).max(200) }),
  z.object({ t: z.literal('match:loaded') }),
  z.object({ t: z.literal('in'), cmds: z.array(cmd).min(1).max(8) }),
  z.object({
    t: z.literal('act'),
    a: z.enum(['interact', 'flashlight', 'use', 'drop', 'attack', 'ability', 'fire', 'reload', 'weapon']),
    on: z.boolean().optional(),
    slot: z.number().int().min(0).max(7).optional(),
    id: ability.optional(),
    variant: eco.optional(),
  }),
  z.object({ t: z.literal('spectate'), dir: z.union([z.literal(1), z.literal(-1)]) }),
  z.object({ t: z.literal('rtc'), to: z.string().max(64), data: z.unknown() }),
  z.object({ t: z.literal('ping'), c: num }),
]);

export function parseClientMsg(raw: string): ClientMsg | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = clientMsg.safeParse(data);
  return r.success ? (r.data as ClientMsg) : null;
}

/** Remove caracteres de controle e limita tamanho de textos livres (chat, nomes de sala). */
export function cleanText(s: string, max: number): string {
  return s
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, '')
    .trim()
    .slice(0, max);
}
