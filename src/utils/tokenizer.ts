import { getEncoding, Tiktoken } from 'js-tiktoken';

let enc: Tiktoken | undefined;

export function countTokens(text: string): number {
  if (!enc) enc = getEncoding('cl100k_base');
  return enc.encode(text).length;
}
