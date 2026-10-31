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
        { type: 'qq-official.message', trigger: 'debounce', description: QQOFFICIAL_EVENT_DESCRIPTIONS.message },
        { type: 'qq-official.notice', trigger: 'debounce', description: QQOFFICIAL_EVENT_DESCRIPTIONS.notice },
        { type: 'qq-official.attachment', trigger: 'debounce', description: QQOFFICIAL_EVENT_DESCRIPTIONS.attachment },
        { type: 'qq-official.sent', tags: ['speak'], description: QQOFFICIAL_EVENT_DESCRIPTIONS.sent },
        { type: 'qq-official.attempt', description: QQOFFICIAL_EVENT_DESCRIPTIONS.attempt },
        { type: 'qq-official.removed', description: QQOFFICIAL_EVENT_DESCRIPTIONS.removed },
        { type: 'qq-official.acknowledged', description: QQOFFICIAL_EVENT_DESCRIPTIONS.acknowledged },
      ],
    },
  };
}

export const QQOFFICIAL = qqOfficialDefinition();
