import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

// dev only (the browser UI tests, e2e-web/): `?fixture=<name>` opens a fixture result through an in-memory
// History; import.meta.env.DEV is false in a build, so the hook and the fixtures are not in the bundle
const fixture = import.meta.env.DEV ? new URLSearchParams(location.search).get('fixture') : null
if (fixture) {
  void import('./lib/dev/fixture').then(async (dev) => {
    const backend = dev.useMemoryHistory()
    mount(App, { target: document.getElementById('app')! })
    await dev.openFixture(backend, fixture)
  })
} else {
  mount(App, { target: document.getElementById('app')! })
}
