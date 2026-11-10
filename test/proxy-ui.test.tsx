// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { MagpieSettings } from '../src/client/SettingsPage.js'
import { buttonByText, expandLine, fakeApi, flush, inputValue, ok, settingsView } from './client-support/fake-api.js'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const LINE_ID = 'a1b2c3d4'
const directLine = (extra: Record<string, unknown> = {}) => ({
  lines: [{ id: LINE_ID, baseUrl: 'https://magpie.abworks.cn/v1', accessMode: 'direct', complete: true, key: { configured: true, writable: true }, ...extra }],
  activeLineId: LINE_ID,
})
const baseSave = { id: LINE_ID, baseUrl: 'https://magpie.abworks.cn/v1', accessMode: 'direct' }

test('本机代理前缀：填写后随保存发出，清空时发送空串', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    // 1. 新填写前缀 → 请求体只多出 proxy
    const view = directLine()
    const fake = fakeApi({ 'GET settings': () => ok(settingsView(view)), 'GET cards': () => ok({ status: 'ok', cards: [] }), 'POST settings': () => ok(settingsView(view)) })
    await act(async () => root.render(h(MagpieSettings, { api: fake.api }))); await flush()
    act(() => expandLine(host, LINE_ID))
    const proxy = host.querySelector('input[data-proxy]') as HTMLInputElement
    expect(proxy).toBeTruthy()
    act(() => inputValue(proxy, 'http://127.0.0.1:18801/bili/openai'))
    await act(async () => buttonByText(host, '保存')!.click()); await flush()
    expect(fake.calls.filter(call => call.method === 'POST').at(-1)?.body).toEqual({ lines: [{ ...baseSave, proxy: 'http://127.0.0.1:18801/bili/openai' }] })

    // 2. 已保存前缀 → 面板回填，清空后保存发送空串
    const saved = directLine({ proxy: 'http://127.0.0.1:18801/bili/openai' })
    const fake2 = fakeApi({ 'GET settings': () => ok(settingsView(saved)), 'GET cards': () => ok({ status: 'ok', cards: [] }), 'POST settings': () => ok(settingsView(saved)) })
    await act(async () => root.render(h(MagpieSettings, { api: fake2.api }))); await flush()
    act(() => expandLine(host, LINE_ID))
    const current = host.querySelector('input[data-proxy]') as HTMLInputElement
    expect(current.value).toBe('http://127.0.0.1:18801/bili/openai')
    act(() => inputValue(current, ''))
    await act(async () => buttonByText(host, '保存')!.click()); await flush()
    expect(fake2.calls.filter(call => call.method === 'POST').at(-1)?.body).toEqual({ lines: [{ ...baseSave, proxy: '' }] })
  } finally { act(() => root.unmount()); host.remove() }
})
