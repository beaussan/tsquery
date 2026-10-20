import type { SourceFile } from './index.js';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { withAPI } from './native-api.js';

/** Return all source files in the program, including resolved imports and libraries. */
export function project(configFilePath: string): Array<SourceFile> {
  const fullPath = findConfig(configFilePath);
  if (!fullPath) return [];
  return withAPI((api) => {
    const parsed = api.parseConfigFile(fullPath);
    const program = api.createProgram(parsed.fileNames, parsed.options);
    try {
      return program.getSourceFileNames().flatMap((fileName) => {
        const sourceFile = program.getSourceFile(fileName);
        return sourceFile ? [sourceFile] : [];
      });
    } finally {
      program.dispose();
    }
  });
}

/** Return the root files selected by the project's configuration. */
export function files(configFilePath: string): Array<string> {
  const fullPath = findConfig(configFilePath);
  return fullPath
    ? withAPI((api) => api.parseConfigFile(fullPath).fileNames)
    : [];
}

function findConfig(configFilePath: string): string | undefined {
  try {
    const fullPath = path.resolve(configFilePath);
    const configPath = fs.statSync(fullPath).isDirectory()
      ? path.join(fullPath, 'tsconfig.json')
      : fullPath;
    fs.accessSync(configPath);
    return configPath;
  } catch {
    return undefined;
  }
}
