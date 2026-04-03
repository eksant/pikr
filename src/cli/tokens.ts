/** Lightweight token estimator — 1 token ≈ 4 chars. No tiktoken dependency. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
