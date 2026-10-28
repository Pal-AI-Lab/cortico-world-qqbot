import type { WorldDefinition } from 'cortico/world.ts';
import { QQOFFICIAL_DEFAULTS, QQOFFICIAL_ID, type QQOfficialConfigSection } from './config.ts';
import { QQOfficialWorld, type QQOfficialWorldOptions } from './world.ts';
import { qqOfficialTools } from './tools.ts';
import { QQOFFICIAL_EVENT_DESCRIPTIONS, QQOFFICIAL_TOOL_SUMMARIES } from './strings.ts';

export function qqOfficialDefinition(options: Pick<QQOfficialWorldOptions, 'modelLanguage'> = {}): WorldDefinition<QQOfficialConfigSection> {
  return {
    id: QQOFFICIAL_ID, label: 'QQ Bot',
    defaults: () => structuredClone(QQOFFICIAL_DEFAULTS),
    create: (context) => new QQOfficialWorld({ context, ...options }),
    describe: {
      tools: qqOfficialTools(QQOFFICIAL_DEFAULTS.modelLanguage, async () => '').map(({ name, description, parameters, tags }) => ({
        name, description, parameters, tags, summary: QQOFFICIAL_TOOL_SUMMARIES[name],
      })),
      events: [
        { type: 'qqbot.message', trigger: 'debounce', description: QQOFFICIAL_EVENT_DESCRIPTIONS.message },
        { type: 'qqbot.notice', trigger: 'debounce', description: QQOFFICIAL_EVENT_DESCRIPTIONS.notice },
        { type: 'qqbot.attachment', trigger: 'debounce', description: QQOFFICIAL_EVENT_DESCRIPTIONS.attachment },
        { type: 'qqbot.sent', tags: ['speak'], description: QQOFFICIAL_EVENT_DESCRIPTIONS.sent },
        { type: 'qqbot.attempt', description: QQOFFICIAL_EVENT_DESCRIPTIONS.attempt },
        { type: 'qqbot.removed', description: QQOFFICIAL_EVENT_DESCRIPTIONS.removed },
        { type: 'qqbot.acknowledged', description: QQOFFICIAL_EVENT_DESCRIPTIONS.acknowledged },
      ],
    },
  };
}

export const QQOFFICIAL = qqOfficialDefinition();
