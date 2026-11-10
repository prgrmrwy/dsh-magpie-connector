import { afterEach, expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { GatewayTransport, isLoopbackBaseUrl, validateIdentity } from '../src/host/transport.js'
import { effectiveBaseUrl, normalizeBaseUrl, normalizeProxy } from '../src/host/settings.js'
import { createGateway, json } from './support/gateway.js'
import { LINE_ID, line, lineCredentials, memoryStore } from './support/line.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f() })

test('spec Scenario "本机代理前缀拼接在网关地址之前"', () => {
  expect(normalizeProxy('http://127.0.0.1:18801/bili/openai/')).toBe('http://127.0.0.1:18801/bili/openai')
  expect(normalizeProxy('http://127.0.0.1:18801')).toBe('http://127.0.0.1:18801')
  expect(effectiveBaseUrl({ baseUrl: 'https://magpie.abworks.cn/v1', proxy: 'http://127.0.0.1:18801/bili/openai' }))
    .toBe('http://127.0.0.1:18801/bili/openai/https://magpie.abworks.cn/v1')
  expect(effectiveBaseUrl({ baseUrl: 'https://magpie.abworks.cn/v1' })).toBe('https://magpie.abworks.cn/v1')
  expect(() => normalizeProxy('http://user:pw@127.0.0.1:18801/x')).toThrow()
  expect(() => normalizeProxy('file:///tmp/socket')).toThrow()
  expect(() => normalizeProxy('http://127.0.0.1:18801/x?y=1')).toThrow()
})

test('spec Scenario "回环地址可以携带 Access 凭证"', async () => {
  const g = await createGateway(); const t = new GatewayTransport()
  cleanup.push(g.close, () => t.dispose())
  g.handlers.set('GET /v1/models', json({ data: [] }))
  const identity = { baseUrl: g.baseUrl, key: 'mk-placeholder', accessClientId: 'id.example', accessClientSecret: 'secret', accessMode: 'cloudflare' as const }
  const response = await t.request(identity, 'GET', '/models')
  expect(response.status).toBe(200); await response.text()
  expect(g.requests.at(-1)?.headers['cf-access-client-id']).toBe('id.example')
})

test('spec Scenario "非回环地址仍要求 HTTPS"', async () => {
  const t = new GatewayTransport(); cleanup.push(() => t.dispose())
  const credentials = { key: 'k', accessClientId: 'i', accessClientSecret: 's' }
  expect(() => validateIdentity({ ...credentials, baseUrl: 'http://magpie.example.com/v1' })).toThrow('MAGPIE_ACCESS_HTTPS_REQUIRED')
  expect(() => validateIdentity({ ...credentials, baseUrl: 'https://magpie.example.com/v1' })).not.toThrow()
  // 无 Access 凭证的直连线路不受这条规则约束（与既有行为一致）
  expect(() => validateIdentity({ baseUrl: 'http://magpie.example.com/v1', key: 'k' })).not.toThrow()
})

test('spec Scenario "请求发往代理前缀拼接后的地址"', async () => {
  const g = await createGateway(); const t = new GatewayTransport()
  cleanup.push(g.close, () => t.dispose())
  const baseUrl = effectiveBaseUrl({ baseUrl: 'https://magpie.abworks.cn/v1', proxy: `http://127.0.0.1:${g.port}/bili/openai` })
  expect(isLoopbackBaseUrl(baseUrl)).toBe(true)
  g.handlers.set('GET /bili/openai/https://magpie.abworks.cn/v1/models', json({ data: [] }))
  const response = await t.request({ baseUrl, key: 'mk-placeholder' }, 'GET', '/models')
  expect(response.status).toBe(200); await response.text()
  expect(g.requests.at(-1)?.path).toBe('/bili/openai/https://magpie.abworks.cn/v1/models')
})

test('spec Scenario "直接写进地址的前缀形式仍然兼容"', async () => {
  const g = await createGateway(); const t = new GatewayTransport()
  cleanup.push(g.close, () => t.dispose())
  const baseUrl = normalizeBaseUrl(`http://127.0.0.1:${g.port}/bili/openai/https://magpie.abworks.cn/v1`)
  g.handlers.set('GET /bili/openai/https://magpie.abworks.cn/v1/models', json({ data: [] }))
  const response = await t.request({ baseUrl, key: 'mk-placeholder' }, 'GET', '/models')
  expect(response.status).toBe(200); await response.text()
  expect(g.requests.at(-1)?.path).toBe('/bili/openai/https://magpie.abworks.cn/v1/models')
})

test('spec Scenario "保存时回环代理豁免 HTTPS，非回环仍被拒绝"', async () => {
  const g = await createGateway(); cleanup.push(g.close)
  const credentials = lineCredentials('K1')
  const runtime = new MagpieRuntime(credentials.service, memoryStore([line('https://magpie.abworks.cn/v1')]))
  cleanup.push(() => runtime.dispose())
  const prefix = `http://127.0.0.1:${g.port}/bili/openai`
  const credentialsBody = { accessMode: 'cloudflare' as const, accessClientId: 'cf-id', accessClientSecret: 'cf-secret' }
  const accepted = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: 'https://magpie.abworks.cn/v1', proxy: prefix, ...credentialsBody }] })
  expect(accepted.status).toBe(200)
  const view = await (await runtime.settings()).json() as { lines: { baseUrl?: string; proxy?: string }[] }
  expect(view.lines[0]?.baseUrl).toBe('https://magpie.abworks.cn/v1')
  expect(view.lines[0]?.proxy).toBe(prefix)
  const rejected = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: 'https://magpie.abworks.cn/v1', proxy: 'http://proxy.invalid/bili/openai', ...credentialsBody }] })
  expect(rejected.status).toBe(400)
  // 清空前缀后回到直连地址
  const cleared = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: 'https://magpie.abworks.cn/v1', proxy: '', accessMode: 'direct', accessClientId: null, accessClientSecret: null }] })
  expect(cleared.status).toBe(200)
  expect(((await (await runtime.settings()).json()) as { lines: { proxy?: string }[] }).lines[0]?.proxy).toBeUndefined()
})
