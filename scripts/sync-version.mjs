// Copies package.json's version into src-tauri/Cargo.toml. Runs automatically
// via npm's "version" lifecycle hook (see package.json) whenever you run
// `npm version <patch|minor|major>`, so Cargo.toml never drifts from the
// version npm just bumped. tauri.conf.json needs no such step — its "version"
// field points straight at package.json, which Tauri reads natively.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));

const cargoPath = `${root}/src-tauri/Cargo.toml`;
const cargoToml = readFileSync(cargoPath, 'utf8');
const versionLine = /^version = "[^"]+"/m;
if (!versionLine.test(cargoToml)) {
  throw new Error(`Could not find a top-level "version" line in ${cargoPath}`);
}
writeFileSync(cargoPath, cargoToml.replace(versionLine, `version = "${version}"`));
console.log(`Synced src-tauri/Cargo.toml to version ${version}`);
