import { QQOFFICIAL } from './definition.ts';

/** API 5 fallback: the host reads console() instead of webUi(). */
export default {
  ...QQOFFICIAL,
  create(context: Parameters<typeof QQOFFICIAL.create>[0]) {
    const world = QQOFFICIAL.create(context);
    return Object.assign(world, { console: world.webUi!.bind(world) });
  },
};
