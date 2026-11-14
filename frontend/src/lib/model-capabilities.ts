const EMBEDDING_MODEL_PREFIXES = [
  'all-minilm',
  'bge-',
  'bge_',
  'e5-',
  'e5_',
  'gte-',
  'gte_',
  'jina-embeddings',
  'nomic-bert',
  'sentence-transformers',
];

/**
 * Provider-prefixed cloud model ids (mirrors the server's cloud router).
 * These are served by the cloud engine when a key exists, but they never
 * appear in /v1/models, so the installed-model pruning logic must not treat
 * them as missing.
 */
const CLOUD_MODEL_PREFIXES = [
  'openai/',
  'anthropic/',
  'google/',
  'openrouter/',
  'atlascloud/',
  'gpt-',
  'o1-',
  'o3-',
  'o4-',
  'chatgpt-',
  'claude-',
  'gemini-',
  'minimax-',
];

export function isCloudModelId(modelId: string): boolean {
  const name = (modelId || '').trim().toLowerCase();
  if (!name) return false;
  return CLOUD_MODEL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function isEmbedOnlyModel(modelId: string): boolean {
  const name = (modelId || '').trim().toLowerCase();
  const leaf = name.slice(name.lastIndexOf('/') + 1).split(':')[0];
  return (
    leaf.includes('embed') ||
    leaf.includes('minilm') ||
    EMBEDDING_MODEL_PREFIXES.some((prefix) => leaf.startsWith(prefix))
  );
}
