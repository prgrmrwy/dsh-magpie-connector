// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { apply } from '../src/client/index.js'
import { fakeApi } from './client-support/fake-api.js'
import { fakeLocale } from './client-support/fake-locale.js'

const SLOTS = ['settings.section', 'settings.section.icon', 'sidebar.footer.action', 'conversation.input.right']
type Registered = { name: string; inject?: () => unknown }

const disposers: (() => void)[] = []
afterEach(() => { for (const dispose of disposers.splice(0).reverse()) dispose(); document.body.replaceChildren() })

const run = (config: unknown, registered: Registered[]): void => {
  apply({
    slots: {
      inject: (_name: string, start: () => unknown) => start(),
      register: (options: Registered) => { registered.push(options); return () => {} },
    },
    locale: fakeLocale().service,
    get: () => undefined,
    effect: (effect: () => () => void) => { disposers.push(effect()) },
  } as never, config)
}

it('survives the row configuration DSH hands every client face', () => {
  const registered: Registered[] = []
  expect(() => run({ someRow: true }, registered)).not.toThrow()
  expect(registered.map(entry => entry.name)).toEqual(SLOTS)
  // The configuration object must never stand in for the API again: an injected
  // `api` that is not a function crashes the slot on its first request, which is
  // exactly what left the settings page blank (`slot entry crashed in
  // 'settings.section': TypeError: api is not a function`).
  for (const entry of registered) {
    const injected = entry.inject?.() as { api?: unknown } | undefined
    if (injected !== undefined && 'api' in injected) expect(typeof injected.api).toBe('function')
  }
})

it('still accepts the fake api the tests hand in', () => {
  const registered: Registered[] = []
  const fake = fakeApi({}).api
  expect(() => run(fake, registered)).not.toThrow()
  const settings = registered.find(entry => entry.name === 'settings.section')
  expect((settings?.inject?.() as { api: unknown }).api).toBe(fake)
})
