// eslint-disable-next-line import/no-extraneous-dependencies
import nock from 'nock'
import fetch from 'node-fetch'
import AbortController from 'abort-controller'
import { createHttpMiddleware } from '../../sdk-middleware-http'
import { createAuthMiddlewareForClientCredentialsFlow } from '../src/index'
import { createClient } from '../../sdk-client'
import createAuthMiddlewareBase from '../src/base-auth-flow'
import * as buildRequests from '../src/build-requests'
import store from '../src/utils'

function createTestRequest(options) {
  return {
    url: '',
    method: 'GET',
    body: null,
    headers: {},
    ...options,
  }
}

function createTestResponse(options) {
  return {
    ...options,
  }
}

function createTestMiddlewareOptions(options) {
  return {
    host: 'https://auth.europe-west1.gcp.commercetools.com',
    projectKey: 'foo',
    credentials: {
      clientId: '123',
      clientSecret: 'secret',
    },
    fetch,
    ...options,
  }
}

function createBaseMiddleware(options, next, refreshOptions) {
  const params = {
    request: createTestRequest(),
    response: createTestResponse(),
    pendingTasks: [],
    ...buildRequests.buildRequestForClientCredentialsFlow(
      createTestMiddlewareOptions()
    ),
    requestState: store(false),
    tokenCache: store({}),
    fetch,
    ...options,
  }
  return createAuthMiddlewareBase(params, next, refreshOptions)
}

describe('Base Auth Flow', () => {
  beforeEach(() => {
    nock.cleanAll()
  })

  test('throw without `fetch` passed and globally available', () => {
    const middlewareOptions = createTestMiddlewareOptions({ fetch: undefined })

    expect(() => {
      createBaseMiddleware(middlewareOptions, () => {})
    }).toThrow(
      new Error(
        '`fetch` is not available. Please pass in `fetch` as an option or have it globally available.'
      )
    )
  })

  test('throw if timeout was passed and getAbortController was not', () => {
    const middlewareOptions = createTestMiddlewareOptions({ timeout: 8000 })

    const next = () => {}
    expect(() => {
      createBaseMiddleware(middlewareOptions, next)
    }).toThrow(
      new Error(
        '`AbortController` is not available. Please pass in `getAbortController` as an option or have AbortController globally available when using timeout.'
      )
    )
  })

  test('throw if getAbortController is passed but its value is undefined', () => {
    const middlewareOptions = createTestMiddlewareOptions({
      timeout: 8000,
      getAbortController: undefined,
    })

    const next = () => {}
    expect(() => {
      createBaseMiddleware(middlewareOptions, next)
    }).toThrow(
      new Error(
        '`AbortController` is not available. Please pass in `getAbortController` as an option or have AbortController globally available when using timeout.'
      )
    )
  })

  test('throw if getAbortController is passed and timeout was not', () => {
    const middlewareOptions = createTestMiddlewareOptions({
      timeout: '8000',
      getAbortController: () => new AbortController(),
    })

    expect(() => {
      createBaseMiddleware(middlewareOptions, () => {})
    }).toThrow(
      new Error(
        'The passed value for timeout is not a number, please provide a timeout of type number.'
      )
    )
  })

  test('do not throw if timeout and getAbortController are correctly passed', () => {
    const middlewareOptions = createTestMiddlewareOptions({
      timeout: 8000,
      getAbortController: () => new AbortController(),
    })

    expect(() => {
      createBaseMiddleware(middlewareOptions, () => {})
    }).not.toThrow()
  })

  it('should timeout a request with an error', () => {
    const projectKey = process.env.CTP_PROJECT_KEY
    const userConfig = {
      host: 'https://auth.europe-west1.gcp.commercetools.com',
      projectKey,
      credentials: {
        clientId: process.env.CTP_CLIENT_ID,
        clientSecret: process.env.CTP_CLIENT_SECRET,
      },
      timeout: 10, // timeout set to 10ms
      getAbortController: () => new AbortController(),
      scope: [`view_project_settings:${projectKey}`],
      fetch,
    }

    const client = createClient({
      middlewares: [
        createAuthMiddlewareForClientCredentialsFlow(userConfig),
        createHttpMiddleware({
          host: 'https://api.europe-west1.gcp.commercetools.com',
          fetch,
        }),
      ],
    })

    return client
      .execute({
        uri: `/${projectKey}`,
        method: 'GET',
      })
      .catch((error) => {
        expect(error.type).toEqual('aborted')
        expect(error.message).toEqual('The user aborted a request.')
      })
  })

  it('should execute a request if request completed within the set timeout', () => {
    const projectKey = process.env.CTP_PROJECT_KEY
    const userConfig = {
      host: 'https://auth.europe-west1.gcp.commercetools.com',
      projectKey,
      credentials: {
        clientId: process.env.CTP_CLIENT_ID,
        clientSecret: process.env.CTP_CLIENT_SECRET,
      },
      timeout: 3000, // tomeout set to 3sec
      getAbortController: () => new AbortController(),
      scope: [`view_project_settings:${projectKey}`],
      fetch,
    }

    const client = createClient({
      middlewares: [
        createAuthMiddlewareForClientCredentialsFlow(userConfig),
        createHttpMiddleware({
          host: 'https://api.europe-west1.gcp.commercetools.com',
          fetch,
        }),
      ],
    })

    return client
      .execute({
        uri: `/${projectKey}`,
        method: 'GET',
      })
      .then(({ body }) => {
        expect(body.key).toEqual(projectKey)
      })
  })

  describe('::repeater', () => {
    it('should reject response if project is suspended', () => {
      const projectKey = process.env.SUS_PROJECT_KEY
      const userConfig = {
        host: 'https://auth.europe-west1.gcp.commercetools.com',
        projectKey,
        credentials: {
          clientId: process.env.SUS_CLIENT_ID,
          clientSecret: process.env.SUS_CLIENT_SECRET,
        },
        timeout: 3000, // timeout set to 10ms
        getAbortController: () => new AbortController(),
        retryConfig: {
          maxRetries: 2,
          retryDelay: 300,
          backoff: false,
        },
        scope: [`view_project_settings:${projectKey}`],
        fetch,
      }

      const client = createClient({
        middlewares: [
          createAuthMiddlewareForClientCredentialsFlow(userConfig),
          createHttpMiddleware({
            host: 'https://api.europe-west1.gcp.commercetools.com',
            fetch,
          }),
        ],
      })

      return client
        .execute({
          uri: `/${projectKey}`,
          method: 'GET',
        })
        .catch((error) => {
          expect(error.statusCode).toEqual(400)
          expect(error.message).toEqual('invalid_scope')
        })
    })

    test('should retry if project was suspended', () => {
      const projectKey = process.env.SUS_PROJECT_KEY
      const userConfig = {
        host: 'https://auth.europe-west1.gcp.commercetools.com',
        projectKey,
        credentials: {
          clientId: process.env.SUS_CLIENT_ID,
          clientSecret: process.env.SUS_CLIENT_SECRET,
        },
        timeout: 3000, // timeout set to 10ms
        getAbortController: () => new AbortController(),
        retryConfig: {
          maxRetries: 3,
          retryDelay: 30,
          backoff: true,
        },
        tokenCache: store({}),
        scope: [`view_project_settings:${projectKey}`],
        fetch,
      }

      const client = createClient({
        middlewares: [
          createAuthMiddlewareForClientCredentialsFlow(userConfig),
          createHttpMiddleware({
            host: 'https://api.europe-west1.gcp.commercetools.com',
            fetch,
          }),
        ],
      })

      return client
        .execute({
          uri: `/${projectKey}`,
          method: 'GET',
        })
        .catch((error) => {
          expect(userConfig.tokenCache.get()).toBe(null)
          expect(error.statusCode).toEqual(400)
          expect(error.headers).toBeUndefined()
          expect(error.originalRequest).toBeDefined()
          expect(error.retryCount).toBe(3) // same value as the maxRetries
          expect(error.message).toBe(`invalid_scope`)
        })
    })

    test('should set tokenCache to null if project is suspended', () => {
      const projectKey = process.env.SUS_PROJECT_KEY
      const userConfig = {
        host: 'https://auth.europe-west1.gcp.commercetools.com',
        projectKey,
        credentials: {
          clientId: process.env.SUS_CLIENT_ID,
          clientSecret: process.env.SUS_CLIENT_SECRET,
        },
        timeout: 3000, // timeout set to 10ms
        getAbortController: () => new AbortController(),
        retryConfig: {
          maxRetries: 3,
          retryDelay: 30,
          backoff: true,
        },
        tokenCache: store({}),
        scope: [`view_project_settings:${projectKey}`],
        fetch,
      }

      // before executing the request tokenCache should have default value
      expect(userConfig.tokenCache.get()).toStrictEqual({})
      const client = createClient({
        middlewares: [
          createAuthMiddlewareForClientCredentialsFlow(userConfig),
          createHttpMiddleware({
            host: 'https://api.europe-west1.gcp.commercetools.com',
            fetch,
          }),
        ],
      })

      return client
        .execute({
          uri: `/${projectKey}`,
          method: 'GET',
        })
        .catch((error) => {
          // after executing request tokenCache should be null
          expect(userConfig.tokenCache.get()).toBe(null)
          expect(error.statusCode).toEqual(400)
          expect(error.message).toBe(`invalid_scope`)
        })
    })
  })

  test('reject if request was not processed within the set timeout', () =>
    new Promise((resolve, reject) => {
      const response = createTestResponse({
        resolve,
        reject: (error) => {
          expect(error.message).toBe('request timeout')
          expect(error.body).toEqual({ message: 'request timeout' })
          resolve()
        },
      })
      const next = () => {
        reject(
          new Error(
            'This function should never be called, the response was rejected'
          )
        )
      }
      const middlewareOptions = createTestMiddlewareOptions({
        timeout: 10, // timeout the request by 10ms
        getAbortController: new AbortController(),
      })
      nock(middlewareOptions.host)
        .filteringRequestBody(/.*/, '*')
        .post('/oauth/token', '*')
        .reply(504, { message: 'request timeout' }) // <-- JSON error response

      createBaseMiddleware({ response }, next)
    }))

  test('call next if request is within the limits of timeout', () =>
    new Promise((resolve) => {
      const response = createTestResponse({
        resolve,
        reject: (error) => {
          expect(error.message).toMatch('socket timeout')
          resolve()
        },
      })

      const next = (req) => {
        expect(req).toHaveProperty('headers.Authorization', 'Bearer xxx')
        resolve()
      }

      const middlewareOptions = createTestMiddlewareOptions({
        timeout: 10000, // timeout the request by 10s
        getAbortController: () => new AbortController(),
        headers: {
          Authorization: 'Bearer xxx',
        },
      })

      nock(middlewareOptions.host)
        .filteringRequestBody((body) => {
          expect(body).toBe('grant_type=client_credentials')
          return '*'
        })
        .post('/oauth/token', '*')
        .delay(100)
        .reply(200, {
          access_token: 'xxx',
          expires_in: 100,
        })
      createBaseMiddleware({ request: middlewareOptions, response }, next)
    }))

  test('get a new auth token if not present in request headers', () =>
    new Promise((resolve) => {
      const next = (req) => {
        expect(req).toHaveProperty('headers.Authorization', 'Bearer xxx')
        resolve()
      }
      const middlewareOptions = createTestMiddlewareOptions()

      nock(middlewareOptions.host)
        .filteringRequestBody((body) => {
          expect(body).toBe('grant_type=client_credentials')
          return '*'
        })
        .post('/oauth/token', '*')
        .reply(200, {
          access_token: 'xxx',
          expires_in: 100,
        })
      createBaseMiddleware({}, next)
    }))

  test('reject if network error occur while fetching token', () =>
    new Promise((resolve, reject) => {
      const response = createTestResponse({
        resolve,
        reject: (error) => {
          expect(error.message).toMatch('socket timeout')
          resolve()
        },
      })
      const next = () => {
        reject(new Error('this method should not be called.'))
      }
      const middlewareOptions = createTestMiddlewareOptions()

      nock(middlewareOptions.host)
        .filteringRequestBody((body) => {
          expect(body).toBe('grant_type=client_credentials')
          return '*'
        })
        .post('/oauth/token', '*')
        .replyWithError('socket timeout')
      createBaseMiddleware({ response }, next)
    }))

  test('reject if auth request fails (JSON error response)', () =>
    new Promise((resolve, reject) => {
      const response = createTestResponse({
        resolve,
        reject: (error) => {
          expect(error.message).toBe('Oops')
          expect(error.body).toEqual({ message: 'Oops' })
          resolve()
        },
      })
      const next = () => {
        reject(
          new Error(
            'This function should never be called, the response was rejected'
          )
        )
      }
      const middlewareOptions = createTestMiddlewareOptions()
      nock(middlewareOptions.host)
        .filteringRequestBody(/.*/, '*')
        .post('/oauth/token', '*')
        .reply(400, { message: 'Oops' }) // <-- JSON error response

      createBaseMiddleware({ response }, next)
    }))

  test('reject if auth request fails (non JSON error response)', () =>
    new Promise((resolve, reject) => {
      const response = createTestResponse({
        resolve,
        reject: (error) => {
          expect(error.message).toBe('Oops')
          expect(error.body).toBeUndefined()
          resolve()
        },
      })
      const next = () => {
        reject(
          new Error(
            'This function should never be called, the response was rejected'
          )
        )
      }
      const middlewareOptions = createTestMiddlewareOptions()
      nock(middlewareOptions.host)
        .filteringRequestBody(/.*/, '*')
        .post('/oauth/token', '*')
        .reply(400, 'Oops') // <-- non JSON error response

      createBaseMiddleware({ response }, next)
    }))

  test('retrieve a new token if previous one expired', () =>
    new Promise((resolve) => {
      const middlewareOptions = createTestMiddlewareOptions()
      let requestCount = 0
      nock(middlewareOptions.host)
        .persist() // <-- use the same interceptor for all requests
        .log(() => {
          requestCount += 1
        }) // keep track of the request count
        .filteringRequestBody(/.*/, '*')
        .post('/oauth/token', '*')
        .reply(200, () => ({
          access_token: 'xxx',
          // Return the first 2 requests with an expired token
          expires_in:
            requestCount < 2
              ? 1 // <-- to ensure it expires
              : Date.now() + 60 * 60 * 24,
        }))

      const next = () => {
        expect(requestCount).toBe(2)
        resolve()
      }
      const tokenCache = store({})
      const requestState = store(false)
      // Third call:
      // - we simulate that the request has a token set in the headers
      // - the previous token is still valid, no more requests
      const call3 = () => {
        expect(requestCount).toBe(2)
        createBaseMiddleware({ requestState, tokenCache }, next)
      }
      // Second call:
      // - we simulate that the request has a token set in the headers
      // - the previous token was expired though, so we need to refetch it
      const call2 = () => {
        expect(requestCount).toBe(1)
        createBaseMiddleware({ requestState, tokenCache }, call3)
      }
      // First call:
      // - there is no token yet
      // - a new token is fetched
      createBaseMiddleware({ requestState, tokenCache }, call2)
    }))

  test('use refresh token to fetch a new token if no token or is expired', () =>
    new Promise((resolve) => {
      const spy = jest.spyOn(buildRequests, 'buildRequestForRefreshTokenFlow')
      const middlewareOptions = createTestMiddlewareOptions()
      let requestCount = 0
      nock(middlewareOptions.host)
        .persist() // <-- use the same interceptor for all requests
        .log(() => {
          requestCount += 1
        }) // keep track of the request count
        .filteringRequestBody(/.*/, '*')
        .post('/oauth/token', '*')
        .reply(200, () => ({
          access_token: 'xxx',
          refresh_token: 'foobar123',
          // Return the first request with an expired token
          expires_in:
            requestCount < 2
              ? 1 // <-- to ensure it expires
              : Date.now() + 60 * 60 * 24,
        }))

      const next = () => {
        expect(requestCount).toBe(2)
        expect(spy).toHaveBeenCalledTimes(2)
        spy.mockReset()
        spy.mockRestore()
        resolve()
      }
      const tokenCache = store({ refreshToken: 'foobar123' })
      const requestState = store(false)
      // Third call:
      // - we simulate that the request has a token set in the headers
      // - the previous token is still valid, no more requests
      const call3 = () => {
        expect(requestCount).toBe(2)
        expect(spy).toHaveBeenCalledTimes(2)
        createBaseMiddleware({ requestState, tokenCache }, next)
      }
      // Second call:
      // - we simulate that the request has an expired token set in the headers
      // - the previous token was expired though, so we need to refetch it
      const call2 = () => {
        expect(requestCount).toBe(1)
        expect(spy).toHaveBeenCalledTimes(1)
        createBaseMiddleware(
          { requestState, tokenCache },
          call3,
          middlewareOptions
        )
      }
      // First call:
      // - there is no token
      // - a new token is fetched with refreshToken
      createBaseMiddleware(
        { requestState, tokenCache },
        call2,
        middlewareOptions
      )
    }))

  test(
    'do not get a new token if one is already present in request headers ' +
      'but it does not match one of the cached tokens',
    () =>
      new Promise((resolve, reject) => {
        const response = createTestResponse({
          resolve,
          reject,
        })
        const middlewareOptions = createTestMiddlewareOptions()
        let requestCount = 0
        nock(middlewareOptions.host)
          .persist() // <-- use the same interceptor for all requests
          .log(() => {
            requestCount += 1
          }) // keep track of the request count
          .filteringRequestBody(/.*/, '*')
          .post('/oauth/token', '*')
          .reply(200, {
            access_token: 'xxx',
            expires_in: Date.now() + 60 * 60 * 24,
          })

        const next = () => {
          expect(requestCount).toBe(1)
          resolve()
        }
        const tokenCache = store({})
        const requestState = store(false)
        // Second call:
        // - we simulate that the request has a token set in the headers
        // which does not match any of the cached tokens. In this case
        // do not refetch and keep going.
        const call2 = (rq) => {
          const requestWithHeaders = {
            ...rq,
            headers: {
              Authorization: 'Bearer yyy',
            },
          }
          createBaseMiddleware({ request: requestWithHeaders }, next)
          createAuthMiddlewareBase(
            {
              request: requestWithHeaders,
              response,
              pendingTasks: [],
              ...buildRequests.buildRequestForClientCredentialsFlow(
                middlewareOptions
              ),
              requestState,
              tokenCache,
            },
            next
          )
        }
        // First call:
        // - there is no token yet
        // - a new token is fetched
        createBaseMiddleware({}, call2)
      })
  )

  test('ensure to fetch new token only once and keep track of pending tasks', () =>
    new Promise((resolve) => {
      const middlewareOptions = createTestMiddlewareOptions()
      let requestCount = 0
      nock(middlewareOptions.host)
        .persist() // <-- use the same interceptor for all requests
        .log(() => {
          requestCount += 1
        }) // keep track of the request count
        .filteringRequestBody(/.*/, '*')
        .post('/oauth/token', '*')
        .reply(200, {
          access_token: 'xxx',
          expires_in: Date.now() + 60 * 60 * 24,
        })

      let nextCount = 0
      const next = () => {
        nextCount += 1
        if (nextCount === 6) {
          expect(requestCount).toBe(1)
          resolve()
        }
      }
      const pendingTasks = []
      const tokenCache = store({})
      const requestState = store(false)
      // Execute multiple requests at once.
      // This should queue all of them until the token has been fetched.
      createBaseMiddleware({ pendingTasks, tokenCache, requestState }, next)
      createBaseMiddleware({ pendingTasks, tokenCache, requestState }, next)
      createBaseMiddleware({ pendingTasks, tokenCache, requestState }, next)
      createBaseMiddleware({ pendingTasks, tokenCache, requestState }, next)
      createBaseMiddleware({ pendingTasks, tokenCache, requestState }, next)
      createBaseMiddleware({ pendingTasks, tokenCache, requestState }, next)
      createBaseMiddleware({ pendingTasks, tokenCache, requestState }, next)
    }))

  test('should change requestState to false when createAuthMiddlewareBase fails', async () => {
    const middlewareOptions = createTestMiddlewareOptions()
    let requestCount = 0

    nock(middlewareOptions.host)
      .persist() // <-- use the same interceptor for all requests
      .log(() => {
        requestCount += 1
      }) // keep track of the request count
      .filteringRequestBody(/.*/, '*')
      .post('/oauth/token', '*')
      .delay(2000) // <-- Delay the response
      .reply(401, {
        message: 'invalid_client',
        error: 'invalid_client',
      })

    const requestState = store(false)
    const pendingTasks = []

    const startCreateBaseMiddleware = () =>
      new Promise((resolve, reject) => {
        expect(requestState.get()).toBe(false)

        // fire off promise returning function and change requestState to true
        // we do not await the response before the assertion since we set
        // `reqeustState` to `false` after the promise is fulfilled or rejected.
        const start = createBaseMiddleware({
          response: { resolve, reject },
          pendingTasks,
          requestState,
        })

        expect(requestState.get()).toBe(true)
        expect(requestCount).toBe(1) // Make sure that nock runned the mocked request

        return start
      })

    try {
      // await promise failure which should set `requestState` to `false`
      await startCreateBaseMiddleware()
    } catch (error) {
      expect(requestState.get()).toBe(false)
    }
  })

  test('if a token has been fetched, use it for the new incoming requests', () =>
    new Promise((resolve) => {
      const middlewareOptions = createTestMiddlewareOptions()
      let requestCount = 0
      nock(middlewareOptions.host)
        .persist() // <-- use the same interceptor for all requests
        .log(() => {
          requestCount += 1
        }) // keep track of the request count
        .filteringRequestBody(/.*/, '*')
        .post('/oauth/token', '*')
        .reply(200, {
          access_token: 'xxx',
          expires_in: Date.now() + 60 * 60 * 24,
        })
      const pendingTasks = []
      const tokenCache = store({})
      const requestState = store(false)
      const next = (rq2) => {
        // 2. Should not get a new token
        expect(requestCount).toBe(1)
        expect(rq2).toEqual(
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'Bearer xxx',
            }),
          })
        )
        resolve()
      }
      // 2. Should not get a new token
      const call2 = createBaseMiddleware(
        { pendingTasks, tokenCache, requestState },
        next
      )
      createBaseMiddleware({ pendingTasks, tokenCache, requestState }, call2)
    }))

  describe('client id token cache', () => {
    let tokenCache
    const createCacheKey = (options) =>
      `${options.clientId}-${options.projectKey}-${options.host}`

    beforeEach(() => {
      tokenCache = {
        cache: {},
        get(client) {
          return this.cache[client]
        },
        set(value, client) {
          this.cache[client] = value
        },
      }
    })

    test('it stores token in token cache in context of token cache key', () =>
      new Promise((resolve) => {
        const tokenCacheKeyOptions = {
          clientId: 'clientId',
          projectKey: 'projectKey',
          host: 'host',
        }
        const tokenCacheKey = createCacheKey(tokenCacheKeyOptions)
        const customTokenCache = {
          cache: {},
          get(cacheKey) {
            return this.cache[createCacheKey(cacheKey)]
          },
          set(token, cacheKey) {
            this.cache[createCacheKey(cacheKey)] = token
          },
        }
        const next = (req) => {
          expect(req).toHaveProperty('headers.Authorization', 'Bearer xxx')
          expect(customTokenCache.get(tokenCacheKey)).toEqual(
            expect.objectContaining({
              token: 'xxx',
            })
          )
          resolve()
        }

        const middlewareOptions = createTestMiddlewareOptions()

        nock(middlewareOptions.host)
          .filteringRequestBody((body) => {
            expect(body).toBe('grant_type=client_credentials')
            return '*'
          })
          .post('/oauth/token', '*')
          .reply(200, {
            access_token: 'xxx',
            expires_in: 100,
          })
        createBaseMiddleware(
          { tokenCache: customTokenCache, tokenCacheKey },
          next
        )
      }))

    test('ensure to fetch new token only once for each client and keep track of pending tasks in context of client instance of middleware', () =>
      new Promise((resolve) => {
        const middlewareOptions = createTestMiddlewareOptions()
        let requestCount = 0

        const tokenCacheKeyOne = {
          clientId: 'clientIdOne',
          projectKey: 'projectKey',
          host: 'host',
        }
        const tokenCacheKeyTwo = {
          clientId: 'clientIdTwo',
          projectKey: 'projectKey',
          host: 'host',
        }
        nock(middlewareOptions.host)
          .persist() // <-- use the same interceptor for all requests
          .log(() => {
            requestCount += 1
          }) // keep track of the request count
          .filteringRequestBody(/.*/, '*')
          .post('/oauth/token', '*')
          .reply(200, {
            access_token: 'xxx',
            expires_in: Date.now() + 60 * 60 * 24,
          })

        let nextCount = 0
        const next = () => {
          nextCount += 1
          if (nextCount === 6) {
            expect(requestCount).toBe(2)
            // assert that shared cached has been populated
            expect(tokenCache.get(tokenCacheKeyOne)).toEqual(
              expect.objectContaining({
                token: 'xxx',
              })
            )
            expect(tokenCache.get(tokenCacheKeyTwo)).toEqual(
              expect.objectContaining({
                token: 'xxx',
              })
            )
            resolve()
          }
        }
        // configure 2 instances of separate clients
        const pendingTasksClientOne = []
        const requestStateClientOne = store(false)
        const pendingTasksClientTwo = []
        const requestStateClientTwo = store(false)
        // Execute multiple requests at once.
        // This should queue all of them for each client
        createBaseMiddleware(
          {
            pendingTasks: pendingTasksClientOne,
            tokenCache,
            requestState: requestStateClientOne,
            tokenCacheKey: tokenCacheKeyOne,
          },
          next
        )
        createBaseMiddleware(
          {
            pendingTasks: pendingTasksClientOne,
            tokenCache,
            requestState: requestStateClientOne,
            tokenCacheKey: tokenCacheKeyOne,
          },
          next
        )
        createBaseMiddleware(
          {
            pendingTasks: pendingTasksClientTwo,
            tokenCache,
            requestState: requestStateClientTwo,
            tokenCacheKey: tokenCacheKeyTwo,
          },
          next
        )
        createBaseMiddleware(
          {
            pendingTasks: pendingTasksClientTwo,
            tokenCache,
            requestState: requestStateClientTwo,
            tokenCacheKey: tokenCacheKeyTwo,
          },
          next
        )
        createBaseMiddleware(
          {
            pendingTasks: pendingTasksClientTwo,
            tokenCache,
            requestState: requestStateClientTwo,
            tokenCacheKey: tokenCacheKeyTwo,
          },
          next
        )
        createBaseMiddleware(
          {
            pendingTasks: pendingTasksClientTwo,
            tokenCache,
            requestState: requestStateClientTwo,
            tokenCacheKey: tokenCacheKeyTwo,
          },
          next
        )
        createBaseMiddleware(
          {
            pendingTasks: pendingTasksClientOne,
            tokenCache,
            requestState: requestStateClientOne,
            tokenCacheKey: tokenCacheKeyOne,
          },
          next
        )
      }))
  })
})
