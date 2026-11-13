/**
 * index.ts — barrel for the trimmed accessibility stand-in (see `semantic-tokens.ts` and
 * `resolveToken.ts` for why this is a shim rather than a lift of LevelUp's palette system).
 */
export { tokenCssVar, tokenVar } from './semantic-tokens'
export type { SemanticToken } from './semantic-tokens'
export { resolveToken } from './resolveToken'
