// For licensing see accompanying LICENSE file.
// Copyright (C) 2026 Apple Inc. All Rights Reserved.

/**
 * Builds the Swift C bindings in foundation-models-c/ and copies the dylib to lib/.
 *
 *   node scripts/build-native.ts [--configuration debug|release]
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const root = join(import.meta.dirname, '..');
const packageDir = join(root, 'foundation-models-c');

const { values } = parseArgs({ options: { configuration: { type: 'string', default: 'release' } } });
const configuration = values.configuration;
if (configuration !== 'debug' && configuration !== 'release') {
  fail(`--configuration must be debug or release, not ${configuration}`);
}

function fail(message: string): never {
  console.error(`build-native: ${message}`);
  process.exit(1);
}

function run(command: string, args: string[], cwd = root): string {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string };
    fail(`\`${command} ${args.join(' ')}\` failed:\n${stdout}${stderr}`);
  }
}

if (process.platform !== 'darwin') fail('The Foundation Models framework is only available on macOS.');
// Darwin 25 is macOS 26.
if (Number(release().split('.')[0]) < 25) fail('macOS 26.0 or later is required.');

const developerDir = run('xcode-select', ['-p']);
if (developerDir.includes('CommandLineTools')) {
  fail(
    `The active developer directory is the Command Line Tools (${developerDir}), but a full Xcode is required.\n` +
      'Install Xcode, open it once to accept the license, then run `sudo xcode-select --switch /Applications/Xcode.app`.',
  );
}
const xcodeMajor = Number(/Xcode\s+(\d+)/.exec(run('xcodebuild', ['-version']))?.[1]);
if (!(xcodeMajor >= 26)) fail('Xcode 26.0 or later is required.');

// `Attachment` and `SystemLanguageModel.variant` only exist in the macOS 27 SDK.
const sdkMajor = Number(run('xcrun', ['--sdk', 'macosx', '--show-sdk-version']).split('.')[0]);
const swiftFlags = sdkMajor >= 27 ? ['-Xswiftc', '-DFM_HAS_MACOS_27_SDK'] : [];

console.log(`Building foundation-models-c (${configuration}, macOS ${sdkMajor} SDK)…`);
run('swift', ['build', '-c', configuration, '--product', 'FoundationModels', ...swiftFlags], packageDir);
const binPath = run('swift', ['build', '-c', configuration, '--show-bin-path'], packageDir);

mkdirSync(join(root, 'lib'), { recursive: true });
copyFileSync(join(binPath, 'libFoundationModels.dylib'), join(root, 'lib', 'libFoundationModels.dylib'));
console.log('Copied libFoundationModels.dylib to lib/.');
