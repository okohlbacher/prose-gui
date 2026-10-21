// The AppImage smoke test (native/scripts/smoke-appimage.sh runs it; not one of the *.spec.ts of e2e/run.sh).
// The AppImage runs from an empty environment (e2e/appimage-app.sh) and searches the example with PeptDeep
// with the ProSE it bundles. Besides the result, the test reads which files the processes have mapped
// (/proc/<pid>/maps): the app and WebKit's processes, and ProSE while it searches, load their libraries from
// the AppImage or from the system, never from SMOKE_FORBIDDEN (the build machine's sysroot and OpenMS build,
// colon-separated), and ProSE loads its own closure with one OpenMP runtime.
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'
import { appReady, clearSearches, dataHome, invoke, openFirstPsm, runExample } from './lib.ts'

const forbidden = (process.env.SMOKE_FORBIDDEN ?? '').split(':').filter(Boolean)

/** The files a process has mapped (libraries, the executable), or [] once it has ended. */
function mappedFiles(pid: number): string[] {
  try {
    const lines = readFileSync(`/proc/${pid}/maps`, 'utf8').split('\n')
    return [...new Set(lines.map((l) => l.split(/\s+/).slice(5).join(' ')).filter((p) => p.startsWith('/')))]
  } catch {
    return []
  }
}

/** The processes whose executable lies below `dir`: pid and executable. */
function processesBelow(dir: string): { pid: number; exe: string }[] {
  const found: { pid: number; exe: string }[] = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const exe = readlinkSync(`/proc/${entry}/exe`)
      if (exe.startsWith(dir + '/')) found.push({ pid: Number(entry), exe })
    } catch {
      // ended, or not ours
    }
  }
  return found
}

const offending = (files: string[]) => files.filter((f) => forbidden.some((p) => f === p || f.startsWith(p + '/')))
const sharedLibraries = (files: string[]) => files.filter((f) => /\.so(\.\d+)*$/.test(f))

describe('the AppImage', () => {
  /** The folder the AppImage was extracted to (…/appimage_extracted_<digest>). */
  let appRoot = ''

  let toolInfo: { result?: any; failure?: string } = {}
  const marker = '/usr/lib/ProSE/resources/prose/bin/ProSE'

  before(async () => {
    await appReady()
    toolInfo = await invoke('tool_info')
    const path: string = toolInfo.result?.path ?? ''
    if (path.endsWith(marker)) appRoot = path.slice(0, -marker.length)
  })

  afterEach(() => clearSearches())

  it('runs from an environment without the development toolchain', () => {
    const env = readFileSync(join(dataHome(), 'appimage-env.txt'), 'utf8')
    console.log(env.trim())
    // (LD_LIBRARY_PATH is never kept from the driver's environment; appimage-app.sh sets it only to the
    // folder of the host's missing libGLESv2.so.2, see smoke-appimage.sh)
    expect(env).not.toMatch(/^kept: .*\b(LD_LIBRARY_PATH|PROSE_BIN|PKG_CONFIG_PATH|XDG_DATA_DIRS|GIO_EXTRA_MODULES)\b/m)
  })

  it('finds its bundled ProSE, with ONNX (the build manifest and the PeptDeep models)', async () => {
    const { result, failure } = toolInfo
    expect(failure).toBeUndefined()
    console.log('tool_info', JSON.stringify(result))
    expect(result.path.endsWith(marker)).toBe(true)
    expect(appRoot).toMatch(/appimage_extracted_[0-9a-f]+$/)
    expect(result.onnx).toBe(true)
    expect(result.version).not.toBe('')
  })

  it('searches the example with PeptDeep: 1,790 PSMs, the PeptDeep mirror, ProSE with its own libraries', async () => {
    expect(appRoot).toMatch(/appimage_extracted_/)
    // ProSE's mapped files, read while it runs
    const proseMaps = new Set<string>()
    const proseExes = new Set<string>()
    const poll = setInterval(() => {
      for (const p of processesBelow(appRoot)) {
        if (!p.exe.endsWith('/bin/ProSE')) continue
        proseExes.add(p.exe)
        for (const f of mappedFiles(p.pid)) proseMaps.add(f)
      }
    }, 100)
    try {
      await runExample({ peptdeep: true })
    } finally {
      clearInterval(poll)
    }
    await expect($('[data-testid="psm-count"]')).toHaveText(expect.stringContaining('1,790'))
    await openFirstPsm()
    await expect($('[data-testid="bottom-label"]')).toHaveText(expect.stringContaining('PeptDeep'))
    expect((await $$('[data-testid="bottom-peaks"]')).length).toBeGreaterThan(0)
    expect(await $$('[data-testid="bottom-status"]')).toHaveLength(0)

    const bundleLib = `${appRoot}/usr/lib/ProSE/resources/prose/lib/`
    const libs = sharedLibraries([...proseMaps])
    console.log(`ProSE ${[...proseExes].join(', ')} mapped ${libs.length} libraries:`)
    console.log('  from the bundle: ' + libs.filter((f) => f.startsWith(bundleLib)).map((f) => f.slice(bundleLib.length)).join(' '))
    console.log('  from elsewhere: ' + libs.filter((f) => !f.startsWith(bundleLib)).join(' '))
    expect(proseExes.size).toBeGreaterThan(0)
    for (const lib of ['libOpenMS.so', 'libonnxruntime.so.1', 'libarrow.so.2400', 'libgomp.so.1', 'libstdc++.so.6', 'libgcc_s.so.1']) {
      expect(libs).toContain(bundleLib + lib)
    }
    // one OpenMP runtime, the bundle's
    expect(libs.filter((f) => /\/lib(gomp|omp|iomp5)\.so/.test(f))).toEqual([bundleLib + 'libgomp.so.1'])
    // every library outside the bundle is glibc's (bundle-prose.sh's exclude list), or one of its gconv
    // charset modules
    for (const f of libs.filter((f) => !f.startsWith(bundleLib) && !/\/gconv\/[^/]+\.so$/.test(f))) {
      expect(f.split('/').pop()).toMatch(/^(ld-linux-x86-64\.so\.2|lib(c|m|mvec|dl|pthread|rt|resolv)\.so\.\d+)$/)
    }
    expect(offending([...proseMaps])).toEqual([])
  })

  it('the app and WebKit run on the AppImage’s libraries, none of the build machine’s', () => {
    expect(appRoot).toMatch(/appimage_extracted_/)
    const processes = processesBelow(appRoot)
    const names = processes.map((p) => p.exe.slice(appRoot.length))
    console.log('processes of the AppImage: ' + names.join(', '))
    expect(names).toContain('/usr/bin/prose-desktop')
    expect(names.some((n) => n.endsWith('/WebKitWebProcess'))).toBe(true)
    expect(names.some((n) => n.endsWith('/WebKitNetworkProcess'))).toBe(true)
    for (const p of processes) {
      const files = mappedFiles(p.pid)
      expect(offending(files)).toEqual([])
      if (p.exe.endsWith('/usr/bin/prose-desktop') || p.exe.endsWith('/WebKitWebProcess')) {
        expect(files).toContain(`${appRoot}/usr/lib/libwebkit2gtk-4.1.so.0`)
      }
    }
    const app = processes.find((p) => p.exe.endsWith('/usr/bin/prose-desktop'))!
    const outside = sharedLibraries(mappedFiles(app.pid)).filter((f) => !f.startsWith(appRoot + '/'))
    console.log(`the app maps ${outside.length} libraries of the system: ${outside.map((f) => f.split('/').pop()).join(' ')}`)
    expect(existsSync(`${appRoot}/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitWebProcess`)).toBe(true)
  })
})
