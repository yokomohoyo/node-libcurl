// A prebuilt binary needs nothing else, so the vcpkg dependencies (a long
// source build on Windows) are only set up when building from source.
const { execFileSync } = require('child_process')
const path = require('path')

const nodePreGyp = require.resolve('@mapbox/node-pre-gyp/bin/node-pre-gyp')
const run = (script, args = []) =>
  execFileSync(process.execPath, [script, ...args], { stdio: 'inherit' })

const fromSource = ['true', 'node-libcurl'].includes(
  process.env.npm_config_build_from_source,
)

if (!fromSource) {
  try {
    run(nodePreGyp, ['install'])
    process.exit(0)
  } catch {
    if (process.env.npm_config_fallback_to_build === 'false') {
      process.exit(1)
    }
    console.log('node-libcurl: no prebuilt binary, building from source')
  }
}

run(path.join(__dirname, 'vcpkg-setup.js'))
run(nodePreGyp, ['install', '--build-from-source'])
