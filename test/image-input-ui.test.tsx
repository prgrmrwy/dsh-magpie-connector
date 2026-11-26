// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MagpieSettings } from '../src/client/SettingsPage.js'
import { zh } from '../src/client/locales.js'
import { fakeApi, flush, ok, settingsView } from './client-support/fake-api.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const groups = [{
  provider: 'vendor',
  models: [
    { id: 'vendor/undeclared', name: 'Undeclared', visible: true, image: true },
    { id: 'vendor/declared-image', name: 'Declared Image', visible: true, image: true, imageDeclared: true },
    { id: 'vendor/declared-text', name: 'Declared Text', visible: true, image: false, imageDeclared: true },
  ],
}]

async function render() {
  const fake = fakeApi({
    'GET settings': () => ok(settingsView({ groups, visibleModels: { vendor: ['vendor/undeclared', 'vendor/declared-image', 'vendor/declared-text'] } })),
    'GET cards': () => ok({ status: 'ok', cards: [] }),
    'POST settings': request => ok(settingsView({ groups, ...(request.body as object) })),
  })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api })))
  await flush()
  return fake
}

const image = (id: string) => host.querySelector(`[data-model="${id}"] input[data-role="image"]`) as HTMLInputElement
const wrap = (id: string) => host.querySelector(`[data-model="${id}"] label.dmg-image`) as HTMLLabelElement

test('an undeclared model keeps an editable image switch', async () => {
  const fake = await render()
  const box = image('vendor/undeclared')
  expect(box.disabled).toBe(false)
  expect(box.checked).toBe(true)
  expect(wrap('vendor/undeclared').getAttribute('data-image-declared')).toBe('false')

  await act(async () => { box.click() })
  await flush()
  const posted = fake.calls.find(call => call.method === 'POST' && call.path === 'settings')?.body as { imageModel?: { model: string; image: boolean } }
  expect(posted.imageModel).toEqual({ model: 'vendor/undeclared', image: false })
})

test('an explicit image declaration locks the switch and says the gateway decides', async () => {
  await render()
  const box = image('vendor/declared-image')
  expect(box.disabled).toBe(true)
  expect(box.checked).toBe(true)
  expect(wrap('vendor/declared-image').getAttribute('data-image-declared')).toBe('true')
  expect(box.getAttribute('aria-label')).toBe(zh.imageInputDeclared.replace('{label}', 'Declared Image'))
})

test('an explicit text-only declaration locks the switch and says the gateway decides', async () => {
  await render()
  const box = image('vendor/declared-text')
  expect(box.disabled).toBe(true)
  expect(box.checked).toBe(false)
  expect(wrap('vendor/declared-text').getAttribute('data-image-declared')).toBe('true')
  expect(box.getAttribute('aria-label')).toBe(zh.imageInputDeclared.replace('{label}', 'Declared Text'))
})
