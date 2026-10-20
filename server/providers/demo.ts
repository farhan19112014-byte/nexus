import { ProviderError, type LLMProvider } from './types';

/** The demo "provider" is not a language model; requests are answered by shared/demoBrain. */
export class DemoProvider implements LLMProvider {
  readonly id = 'demo'; readonly model = null; readonly supportsStreaming = false;
  configured() { return { ok: true, note: 'Scripted demo responses only — configure an LLM for real conversation.' }; }
  label() { return 'Demo brain (scripted — not an LLM)'; }
  async complete(): Promise<string> { throw new ProviderError('demo provider has no completion API', 'internal', 500); }
  async stream(): Promise<string> { throw new ProviderError('demo provider has no completion API', 'internal', 500); }
}
