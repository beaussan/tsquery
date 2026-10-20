import type { Node, SourceFile } from 'typescript/ast';
import type { Printer } from 'typescript/sync';

import { isSourceFile } from 'typescript/ast/is';
import { withAPI } from './native-api.js';

export type PrinterOptions = Parameters<Printer['printNode']>[1];

/** Print parsed or synthesized native nodes without modifying their positions. */
export function print(
  source: Node | SourceFile,
  options: PrinterOptions = {}
): string {
  const supportedOptions = new Set([
    'preserveSourceNewlines',
    'neverAsciiEscape',
    'terminateUnterminatedLiterals'
  ]);
  for (const key of Object.keys(options)) {
    if (!supportedOptions.has(key)) {
      throw new TypeError(`Unsupported native printer option: ${key}`);
    }
  }
  return withAPI((api) =>
    isSourceFile(source)
      ? api.printer.printFile(source, options).trim()
      : api.printer.printNode(source, options)
  );
}
