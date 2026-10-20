// WebdriverIO through tauri-driver (which starts WebKitWebDriver) against the debug build of the app.
// Started by e2e/run.sh, inside native/scripts/in-env.sh and under xvfb-run.
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const application = resolve(root, 'src-tauri/target/debug/prose-desktop')
const driverPort = 4444

let driver: ChildProcess | undefined

function stopDriver() {
  driver?.kill()
  driver = undefined
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  hostname: '127.0.0.1',
  port: driverPort,
  specs: [resolve(root, 'e2e/*.spec.ts')],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      // tauri-driver turns this into the WebKitWebDriver options of the app binary
      'tauri:options': { application },
    } as WebdriverIO.Capabilities,
  ],
  reporters: ['spec'],
  framework: 'mocha',
  mochaOpts: { ui: 'bdd', timeout: 120000 },
  logLevel: 'warn',
  waitforTimeout: 10000,

  // one tauri-driver for the run; it listens on driverPort and spawns WebKitWebDriver per session
  beforeSession() {
    driver = spawn('tauri-driver', ['--port', String(driverPort)], { stdio: ['ignore', process.stdout, process.stderr] })
    driver.on('error', (e) => {
      console.error('tauri-driver failed to start:', e)
      process.exit(1)
    })
    // WebdriverIO connects at once: give the driver a moment to listen
    return new Promise<void>((done) => setTimeout(done, 1500))
  },
  afterSession: stopDriver,
}

process.on('exit', stopDriver)
process.on('SIGINT', () => {
  stopDriver()
  process.exit(130)
})
process.on('SIGTERM', () => {
  stopDriver()
  process.exit(143)
})
