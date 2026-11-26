import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { DEFAULT_IMAGE_POLICY, mapCatalog } from '../src/host/catalog.js'
import { acceptsImagesFor, updateImageDefault, updateImageModel, withImageInput } from '../src/host/image-input.js'
import { SettingsController } from '../src/host/routes.js'
import { MagpieRuntime } from '../src/host/runtime.js'
import { MAX_IMAGE_MODELS, SettingsStore, validateImageDefault, validateImageOverrides } from '../src/host/settings.js'

const catalog = () => mapCatalog({ data: [{ id: 'opendesign/deepseek-v4.1-flash' }, { id: 'deepseek/deepseek-v4-pro', modalities: { input: ['text'] } }] })
const undeclared = 'opendesign/deepseek-v4.1-flash'
const declared = 'deepseek/deepseek-v4-pro'
const policy = (overrides: Record<string, boolean>, fallback = true) => ({ default: fallback, overrides })

it('accepts images on a model the gateway left undeclared', () => {
  const models = catalog()
  expect(acceptsImagesFor(models[0]!, DEFAULT_IMAGE_POLICY)).toBe(true)
  expect(withImageInput(models[0]!, DEFAULT_IMAGE_POLICY).inputModalities).toEqual(['text', 'image'])
})

it('lets one model except itself, and forgets the exception when it stops differing', () => {
  const models = catalog()
  const excepted = updateImageModel({}, { model: undeclared, image: false }, models, true)
  expect(excepted).toEqual({ [undeclared]: false })
  expect(updateImageModel(excepted, { model: undeclared, image: false }, models, true)).toEqual(excepted)
  expect(acceptsImagesFor(models[0]!, policy(excepted))).toBe(false)
  expect(withImageInput(models[0]!, policy(excepted)).inputModalities).toEqual(['text'])
  // Back in line with the default: no key is kept for it.
  expect(updateImageModel(excepted, { model: undeclared, image: true }, models, true)).toEqual({})
  expect(acceptsImagesFor(models[0]!, DEFAULT_IMAGE_POLICY)).toBe(true)
})

it('stores nothing for a model that already agrees with the default', () => {
  const models = catalog()
  expect(updateImageModel({}, { model: undeclared, image: true }, models, true)).toEqual({})
  expect(updateImageModel({}, { model: undeclared, image: false }, models, false)).toEqual({})
})

it('never overrides a gateway declaration, whichever way the default points', () => {
  const models = catalog()
  const forced = updateImageModel({}, { model: declared, image: true }, models, false)
  expect(forced).toEqual({ [declared]: true })
  expect(acceptsImagesFor(models[1]!, policy(forced, false))).toBe(false)
  expect(withImageInput(models[1]!, policy(forced, false)).inputModalities).toEqual(['text'])
})

it('rejects malformed input and models the catalog does not list', () => {
  const models = catalog()
  for (const input of [null, [], { model: undeclared }, { model: undeclared, image: 'yes' }, { model: undeclared, image: true, extra: 1 }, { model: 'gone', image: true }, { model: '', image: true }])
    expect(() => updateImageModel({}, input, models, true)).toThrow()
})

it('loads the policy leniently and refuses a malformed declaration', () => {
  expect(validateImageDefault(undefined)).toBe(true)
  expect(validateImageDefault(true)).toBe(true)
  expect(validateImageDefault(false)).toBe(false)
  for (const bad of ['true', 1, null]) expect(() => validateImageDefault(bad)).toThrow()
  expect(validateImageOverrides(undefined)).toEqual({})
  expect(validateImageOverrides({ [undeclared]: false })).toEqual({ [undeclared]: false })
  for (const bad of [[], 'x', 1, { '': true }, { [undeclared]: 'yes' }, { [undeclared]: 1 }, Object.fromEntries(Array.from({ length: MAX_IMAGE_MODELS + 1 }, (_, i) => [`m${i}`, true]))])
    expect(() => validateImageOverrides(bad)).toThrow()
})

it('drops the exceptions a new default already explains', () => {
  expect(updateImageDefault(false, { [undeclared]: true, [declared]: false })).toEqual({ [undeclared]: true })
  expect(updateImageDefault(true, { [undeclared]: true, [declared]: false })).toEqual({ [declared]: false })
  expect(updateImageDefault(true, {})).toEqual({})
})

const credentials = () => ({ describe: async () => ({ configured: false, writable: true }), resolve: async () => undefined, set: vi.fn(), unset: vi.fn() }) as never

it('settings report the policy, store an exception, and reset it with the default', async () => {
  const models = catalog()
  const store = new SettingsStore()
  const runtime = new MagpieRuntime(credentials(), store)
  runtime.current.catalog = models
  const settings = new SettingsController(runtime)
  type View = { imageDefault?: boolean; groups: { models: { id: string; image: boolean }[] }[] }
  const viewOf = async (input: Record<string, unknown>) => await (await settings.handle(input)).json() as View
  const flags = (view: View) => view.groups.flatMap(group => group.models).map(model => [model.id, model.image])

  expect(flags(await viewOf({}))).toEqual([[undeclared, true], [declared, false]])
  expect((await viewOf({})).imageDefault).toBe(true)

  // One exception while the default stays on.
  expect(flags(await viewOf({ imageModel: { model: undeclared, image: false } }))).toEqual([[undeclared, false], [declared, false]])
  expect(store.value.imageOverrides).toEqual({ [undeclared]: false })

  // The default goes off: the exception is no longer meaningful and is dropped.
  const off = await viewOf({ imageDefault: false })
  expect(off.imageDefault).toBe(false)
  expect(flags(off)).toEqual([[undeclared, false], [declared, false]])
  expect(store.value.imageOverrides).toEqual({})

  // With the default off, an opt-in is what gets stored.
  expect(flags(await viewOf({ imageModel: { model: undeclared, image: true } }))).toEqual([[undeclared, true], [declared, false]])
  expect(store.value.imageOverrides).toEqual({ [undeclared]: true })

  expect((await settings.handle({ imageDefault: 'yes' })).status).toBe(400)
  expect((await settings.handle({ imageModel: { model: 'gone', image: true } })).status).toBe(400)
  await runtime.dispose()
})

it('refuses an override table past the read limit instead of losing every choice', () => {
  const models = mapCatalog({ data: Array.from({ length: MAX_IMAGE_MODELS + 2 }, (_, i) => ({ id: `vendor/m${i}` })) })
  let overrides: Record<string, boolean> = {}
  for (let i = 0; i < MAX_IMAGE_MODELS; i += 1) overrides = updateImageModel(overrides, { model: `vendor/m${i}`, image: false }, models, true)
  expect(Object.keys(overrides)).toHaveLength(MAX_IMAGE_MODELS)
  expect(() => updateImageModel(overrides, { model: `vendor/m${MAX_IMAGE_MODELS}`, image: false }, models, true)).toThrow('Invalid imageOverrides')
})

it('keeps the saved policy when a controller write would cross the limit', async () => {
  const models = mapCatalog({ data: Array.from({ length: MAX_IMAGE_MODELS + 1 }, (_, i) => ({ id: `vendor/m${i}` })) })
  const store = new SettingsStore()
  const runtime = new MagpieRuntime(credentials(), store)
  runtime.current.catalog = models
  const settings = new SettingsController(runtime)
  for (let i = 0; i < MAX_IMAGE_MODELS; i += 1) {
    expect((await settings.handle({ imageModel: { model: `vendor/m${i}`, image: false } })).status).toBe(200)
  }
  const kept = { ...store.value.imageOverrides }
  expect(Object.keys(kept)).toHaveLength(MAX_IMAGE_MODELS)

  const rejected = await settings.handle({ imageModel: { model: `vendor/m${MAX_IMAGE_MODELS}`, image: false } })
  expect(rejected.status).toBe(400)
  expect(await rejected.json()).toEqual({ error: 'Invalid imageOverrides' })
  expect(store.value.imageOverrides).toEqual(kept)
  expect(runtime.imagePolicy).toEqual({ default: true, overrides: kept })
  await runtime.dispose()
})

it('applies a default change and a model exception from the same request', async () => {
  const models = catalog()
  const store = new SettingsStore()
  const runtime = new MagpieRuntime(credentials(), store)
  runtime.current.catalog = models
  const settings = new SettingsController(runtime)
  type View = { imageDefault?: boolean; groups: { models: { id: string; image: boolean }[] }[] }

  const response = await settings.handle({ imageDefault: false, imageModel: { model: undeclared, image: true } })
  expect(response.status).toBe(200)
  const view = await response.json() as View
  expect(view.imageDefault).toBe(false)
  expect(view.groups.flatMap(group => group.models).map(model => [model.id, model.image])).toEqual([[undeclared, true], [declared, false]])
  expect(store.value.imageDefault).toBe(false)
  expect(store.value.imageOverrides).toEqual({ [undeclared]: true })
  await runtime.dispose()
})

it('reports which models the gateway declared, so only those switches lock', async () => {
  const models = catalog()
  const store = new SettingsStore()
  const runtime = new MagpieRuntime(credentials(), store)
  runtime.current.catalog = models
  const settings = new SettingsController(runtime)
  type View = { groups: { models: { id: string; image: boolean; imageDeclared?: boolean }[] }[] }
  const flags = (view: View) => view.groups.flatMap(group => group.models).map(model => [model.id, model.imageDeclared])

  expect(flags(await (await settings.handle({})).json() as View)).toEqual([[undeclared, false], [declared, true]])
  expect(flags(await (await runtime.settings()).json() as View)).toEqual([[undeclared, false], [declared, true]])
  await runtime.dispose()
})

it('both the default and the exception survive a restart of the settings file', async () => {
  const models = catalog()
  const path = join(mkdtempSync(join(tmpdir(), 'magpie-image-')), 'settings.json')
  const first = new MagpieRuntime(credentials(), new SettingsStore(path))
  first.current.catalog = models
  const settings = new SettingsController(first)
  expect((await settings.handle({ imageDefault: false })).status).toBe(200)
  expect((await settings.handle({ imageModel: { model: undeclared, image: true } })).status).toBe(200)
  await first.dispose()

  const restarted = new MagpieRuntime(credentials(), new SettingsStore(path))
  expect(restarted.imagePolicy).toEqual({ default: false, overrides: { [undeclared]: true } })
  expect(acceptsImagesFor(models[0]!, restarted.imagePolicy)).toBe(true)
  expect(acceptsImagesFor(models[1]!, restarted.imagePolicy)).toBe(false)
  expect(withImageInput(models[0]!, restarted.imagePolicy).inputModalities).toEqual(['text', 'image'])
  await restarted.dispose()
})
