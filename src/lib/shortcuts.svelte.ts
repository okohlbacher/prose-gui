// The state of the keyboard shortcuts: the overlay is open; the single-key shortcuts are on (kept on this computer).

const KEY = 'prose.characterShortcuts'

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

let open = $state(false)
let characterKeys = $state(stored())

export const shortcuts = {
  get open() {
    return open
  },
  set open(v: boolean) {
    open = v
  },
  get characterKeys() {
    return characterKeys
  },
  set characterKeys(v: boolean) {
    characterKeys = v
    try {
      localStorage.setItem(KEY, v ? 'on' : 'off')
    } catch {
      // (blocked storage: on for this session only)
    }
  },
}
