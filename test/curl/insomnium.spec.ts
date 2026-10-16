/**
 * Insomnium additions: the URL goes through curl's URL API (raw spaces,
 * PATH_AS_IS), and legacy TLS options are opt-in per handle.
 */
import net from 'net'
import { describe, beforeAll, afterAll, it, expect } from 'vitest'

import { Curl, CurlCode } from '../../lib'
import { createHttpsServer } from '../helper/server'

// Records each request line and answers with an empty 200. A raw socket so
// request lines an HTTP parser would reject still reach the test.
const requestLines: string[] = []
let rawServer: net.Server
let rawUrl: string

const send = (curl: Curl) =>
  new Promise<number>((resolve, reject) => {
    curl.once('end', (statusCode: number) => resolve(statusCode))
    curl.once('error', (error: Error & { code?: number }) => reject(error))
    curl.perform()
  })

const lastRequestLine = () => requestLines[requestLines.length - 1]

describe('insomnium additions', () => {
  beforeAll(async () => {
    rawServer = net.createServer((socket) => {
      socket.once('data', (chunk) => {
        requestLines.push(chunk.toString('latin1').split('\r\n')[0])
        socket.end(
          'HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
        )
      })
    })
    await new Promise<void>((resolve) =>
      rawServer.listen(0, '127.0.0.1', resolve),
    )
    rawUrl = `http://127.0.0.1:${(rawServer.address() as net.AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => rawServer.close(resolve))
  })

  // Upstream rejects these with CURLE_URL_MALFORMAT. With CURLU_ALLOW_SPACE
  // they're sent; curl 8 percent-encodes spaces in the path itself.
  it('accepts URLs with spaces', async () => {
    const curl = new Curl()
    curl.setOpt('URL', `${rawUrl}/a b?x=1 2`)
    expect(await send(curl)).toBe(200)
    expect(lastRequestLine()).toMatch(
      /^GET \/a( |%20)b\?x=1( |%20)2 HTTP\/1\.1$/,
    )
    curl.close()
  })

  it('applies PATH_AS_IS whether it is set before or after the URL', async () => {
    const normalized = new Curl()
    normalized.setOpt('URL', `${rawUrl}/a/../b`)
    await send(normalized)
    expect(lastRequestLine()).toBe('GET /b HTTP/1.1')
    normalized.close()

    const asIs = new Curl()
    asIs.setOpt('URL', `${rawUrl}/a/../b`)
    asIs.setOpt('PATH_AS_IS', true)
    await send(asIs)
    expect(lastRequestLine()).toBe('GET /a/../b HTTP/1.1')
    asIs.close()
  })

  it('carries the URL over to a duplicated handle', async () => {
    const curl = new Curl()
    curl.setOpt('URL', `${rawUrl}/dup me`)
    const dup = curl.dupHandle(false)
    curl.close()
    expect(await send(dup)).toBe(200)
    expect(lastRequestLine()).toMatch(/^GET \/dup( |%20)me HTTP\/1\.1$/)
    dup.close()
  })

  it('forgets the URL on reset', async () => {
    const curl = new Curl()
    curl.setOpt('URL', `${rawUrl}/before-reset`)
    curl.reset()
    await expect(send(curl)).rejects.toMatchObject({
      code: CurlCode.CURLE_URL_MALFORMAT,
    })
    curl.close()
  })

  it('still reports malformed URLs with the usual error', async () => {
    const curl = new Curl()
    curl.setOpt('URL', 'http://[::1')
    await expect(send(curl)).rejects.toMatchObject({
      code: CurlCode.CURLE_URL_MALFORMAT,
    })
    curl.close()
  })

  describe('setLegacyTls', () => {
    let httpsServer: ReturnType<typeof createHttpsServer>

    beforeAll(async () => {
      httpsServer = createHttpsServer()
      httpsServer.app.get('/', (_req, res) => {
        res.send('ok')
      })
      await httpsServer.listen()
    })

    afterAll(async () => {
      await httpsServer.close()
    })

    it('rejects a non-boolean argument', () => {
      const curl = new Curl()
      // @ts-expect-error checking the runtime guard
      expect(() => curl.handle.setLegacyTls(1)).toThrow(TypeError)
      curl.close()
    })

    it('still completes a normal TLS request when enabled', async () => {
      const curl = new Curl()
      curl.setOpt('URL', httpsServer.url)
      curl.setOpt('SSL_VERIFYPEER', false)
      curl.setOpt('SSL_VERIFYHOST', 0)
      curl.setLegacyTls(true)
      expect(await send(curl)).toBe(200)
      curl.close()
    })

    it('can be turned off again', () => {
      const curl = new Curl()
      expect(curl.handle.setLegacyTls(true)).toBe(CurlCode.CURLE_OK)
      expect(curl.handle.setLegacyTls(false)).toBe(CurlCode.CURLE_OK)
      curl.close()
    })
  })
})
