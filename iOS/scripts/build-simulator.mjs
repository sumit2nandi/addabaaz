import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.error('An iOS simulator build requires macOS with Xcode 26+. Use the iOS simulator GitHub workflow or open this project on a Mac.');
  process.exit(1);
}
const result = spawnSync('xcodebuild', [
  '-project', 'native/App/App.xcodeproj', '-scheme', 'App',
  '-configuration', 'Debug', '-sdk', 'iphonesimulator',
  '-destination', 'generic/platform=iOS Simulator',
  '-derivedDataPath', 'build/simulator',
  'CODE_SIGNING_ALLOWED=NO', 'build'
], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
