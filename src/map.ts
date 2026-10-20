import type { Node, NodeArray, SourceFile } from 'typescript/ast';
import type { NodeTransformer, Selector, VisitResult } from './index.js';

import { cloneNode, createNodeArray } from 'typescript/ast/factory';
import { isSourceFile } from 'typescript/ast/is';
import { visitEachChild } from 'typescript/ast/visitor';
import { ast, match, parse, print } from './index.js';
import { withAPI } from './native-api.js';

/** Transform matching nodes, then print and reparse to restore parent pointers. */
export function map(
  sourceFile: SourceFile,
  selector: string | Selector,
  nodeTransformer: NodeTransformer
): SourceFile {
  return withAPI(() => {
    const matches = new Set(match(sourceFile, parse.ensure(selector)));
    const transformed = createTransformer((node) =>
      matches.has(node) ? nodeTransformer(node) : node
    )()(sourceFile);
    if (!isSourceFile(transformed)) {
      throw new TypeError('A SourceFile transformer must return a SourceFile.');
    }
    return ast(print(transformed));
  });
}

/** Adapt native single-node visitors to TSQuery's list replacement callbacks. */
export function createTransformer(nodeTransformer: NodeTransformer) {
  return () =>
    (rootNode: Node): Node => {
      function visit(node: Node): VisitResult<Node | undefined> {
        const replacement = nodeTransformer(node);
        if (replacement !== node) {
          return isNodeList(replacement)
            ? replacement.map((value) => prepareReplacement(value, node))
            : replacement && prepareReplacement(replacement, node);
        }
        let expansions: Map<Node, readonly Node[]> | undefined;
        const visited = visitEachChild(node, (child) => {
          const result = visit(child);
          if (!isNodeList(result)) return result;
          if (result.length <= 1) return result[0];
          let isListMember = false;
          node.forEachChild(
            () => undefined,
            (nodes) => {
              if (nodes.includes(child)) isListMember = true;
              return undefined;
            }
          );
          if (!isListMember) {
            throw new TypeError('Multiple replacements require a node list.');
          }
          (expansions ??= new Map()).set(child, result);
          return child;
        });
        // Native update factories do not retain the original text ranges.
        const updated = visited === node ? node : preserveRange(visited, node);
        if (!expansions) return updated;
        const replacements = expansions;
        // The factory clone reads the public child fields. Substitute expanded lists
        // there without mutating the native tree or depending on its private fields.
        return cloneNode(
          new Proxy(updated, {
            get(target, key) {
              const value: unknown = Reflect.get(target, key, target);
              if (!Array.isArray(value)) return value;
              const nodes = value as Node[];
              if (!nodes.some((child) => replacements.has(child))) return value;
              const original = value as unknown as NodeArray<Node>;
              const list = createNodeArray(
                nodes.flatMap((child) => replacements.get(child) ?? [child]),
                original.pos,
                original.end
              );
              list.hasTrailingComma = original.hasTrailingComma;
              return list;
            }
          })
        );
      }
      const result = visit(rootNode);
      if (isNodeList(result)) {
        if (result.length > 1)
          throw new TypeError('Cannot replace the root with multiple nodes.');
        return result[0] ?? rootNode;
      }
      return result ?? rootNode;
    };
}

function isNodeList(
  value: VisitResult<Node | undefined>
): value is readonly Node[] {
  return Array.isArray(value);
}

function preserveRange<T extends Node>(node: T, original: Node): T {
  return Object.assign(node, {
    pos: original.pos,
    end: original.end,
    flags: original.flags
  });
}

function prepareReplacement(node: Node, original: Node): Node {
  const anchor = original.pos >= 0 ? original.getStart() : 0;
  function prepare(value: Node): Node {
    const visited = visitEachChild(value, prepare);
    if (value.pos < 0) {
      // The native encoder normalizes negative ranges to zero. Anchor new nodes
      // to the replaced span to avoid picking up comments at file offset zero.
      return Object.assign(cloneNode(visited), { pos: anchor, end: anchor });
    }
    return visited === value ? value : preserveRange(visited, value);
  }
  const prepared = prepare(node);
  return node.pos < 0
    ? Object.assign(prepared, { pos: original.pos, end: original.end })
    : prepared;
}
