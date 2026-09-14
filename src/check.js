import { ContextStore } from './context/store.js';
import { loadKnowledge } from './knowledge.js';

/**
 * One real request against whichever provider is configured.
 *
 * Exercises the whole path — config, system prompt, knowledge file, schema,
 * transport, parsing — rather than a bare ping, so a pass means the bot will
 * actually work rather than just that the key is valid.
 */
export async function checkProvider(ai) {
  const store = new ContextStore();
  store.updateSelf({ username: ai.config.username, ...ai.config.self });
  store.updateNearby([{ name: 'xX_DreamSlayer_Xx', distance: 3 }]);
  store.addChat({
    sender: 'xX_DreamSlayer_Xx',
    content: `${ai.config.username} wsg`,
    channel: 'all',
    system: false,
    raw: '',
  });

  const trigger = {
    kind: 'mention',
    subject: 'xX_DreamSlayer_Xx',
    severity: 1,
    conversational: true,
    opener: true,
    channel: 'all',
    evidence: `xX_DreamSlayer_Xx just called my name — "${ai.config.username} wsg" — nothing else in it.`,
  };

  const knowledge = loadKnowledge(ai.config);
  const started = Date.now();
  const decision = await ai.responder.decide(store, trigger, Date.now(), { avoid: [] });
  return { ...decision, ms: Date.now() - started, knowledgeChars: knowledge.length };
}
