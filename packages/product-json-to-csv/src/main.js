/* @flow */
import type {
  ApiConfigOptions,
  Category,
  Channel,
  CustomerGroup,
  LoggerOptions,
  ParserConfigOptions,
  Price,
  ProductProjection,
  ProductType,
  ResolvedProductProjection,
  State,
  TaxCategory,
  TypeReference,
  Variant,
} from 'types/product'
import type { Client, ClientRequest, SuccessResult } from 'types/sdk'

import { createClient } from '@commercetools/sdk-client'
import { createRequestBuilder } from '@commercetools/api-request-builder'
import { createHttpMiddleware } from '@commercetools/sdk-middleware-http'
import { createAuthMiddlewareForClientCredentialsFlow } from '@commercetools/sdk-middleware-auth'
import { createUserAgentMiddleware } from '@commercetools/sdk-middleware-user-agent'
import highland from 'highland'
import fetch from 'node-fetch'
import PromiseBlueBird from 'bluebird'
import JSONStream from 'JSONStream'
import { memoize, map, get, pick, chunk, flatten } from 'lodash'
import ProductMapping from './map-product-data'
import { writeToSingleCsvFile, writeToZipFile } from './writer'
import pkg from '../package.json'

export default class ProductJsonToCsv {
  // Set flowtype annotations
  accessToken: string
  apiConfig: ApiConfigOptions
  categoriesCache: Object
  channelsCache: Object
  customerGroupsCache: Object
  client: Client
  parserConfig: ParserConfigOptions
  logger: LoggerOptions
  fetchReferences: Function
  _resolveReferences: Function
  _productMapping: Object

  constructor(
    apiConfig: ApiConfigOptions,
    parserConfig: ParserConfigOptions,
    logger: LoggerOptions,
    accessToken: string
  ) {
    this.apiConfig = apiConfig
    this.client = createClient({
      middlewares: [
        createAuthMiddlewareForClientCredentialsFlow({
          ...this.apiConfig,
          fetch,
        }),
        createUserAgentMiddleware({
          libraryName: pkg.name,
          libraryVersion: pkg.version,
        }),
        createHttpMiddleware({
          host: this.apiConfig.apiUrl,
          fetch,
        }),
      ],
    })

    const defaultConfig = {
      categoryBy: 'name', // key, externalId or namedPath supported
      categoryOrderHintBy: 'name', // key, externalId or name supported
      delimiter: ',',
      fillAllRows: false,
      onlyMasterVariants: false,
      language: 'en',
      languages: ['en'],
      multiValueDelimiter: ';',
      encoding: 'utf8',
    }

    this.parserConfig = { ...defaultConfig, ...parserConfig }
    this.logger = {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
      ...logger,
    }
    this.categoriesCache = {}
    this.channelsCache = {}
    this.customerGroupsCache = {}
    this.accessToken = accessToken

    const mappingParams = {
      ...pick(this.parserConfig, [
        'fillAllRows',
        'categoryBy',
        'language',
        'languages',
        'multiValueDelimiter',
        'onlyMasterVariants',
      ]),
      // create shortcuts for ltext attributes only when not doing a full export
      createShortcuts: !!this.parserConfig.headerFields,
    }
    this._productMapping = new ProductMapping(mappingParams)
  }

  run(input: stream$Readable, output: stream$Writable) {
    const productStream = this.parse(input, output)
    const { headerFields } = this.parserConfig
    const config = pick(this.parserConfig, ['delimiter', 'encoding'])

    if (headerFields)
      writeToSingleCsvFile(
        productStream,
        output,
        this.logger,
        headerFields,
        config
      )
    else writeToZipFile(productStream, output, this.logger, config)
  }

  parse(input: stream$Readable, output: stream$Writable): stream$Readable {
    this.logger.info('Starting conversion')
    let productCount = 0

    return (
      highland(input)
        .through(JSONStream.parse('*'))
        .flatMap((product: ProductProjection): ProductProjection =>
          highland(this._resolveReferences(product))
        )
        .doto(() => {
          productCount += 1
          this.logger.debug(`Resolved references of ${productCount} products`)
        })
        // prepare the product objects for csv format
        .map((product: ResolvedProductProjection): ResolvedProductProjection =>
          this._productMapping.run(product)
        )
        .flatten()
        .doto(() => {
          this.logger.debug(`Done with conversion of ${productCount} products`)
        })
        .stopOnError((err: Error) => {
          this.logger.error(err)
          output.emit('error', err)
        })
    )
  }

  _resolveReferences(product: ProductProjection): ProductProjection {
    // ReferenceTypes that need to be resolved:
    // **ProductType
    // **Categories [array]
    // **TaxCategory
    // **State
    // **CategoryOrderHints
    // **Variant prices

    return PromiseBlueBird.all([
      this._resolveProductType(product.productType),
      this._resolveTaxCategory(product.taxCategory),
      this._resolveState(product.state),
      this._resolveCategories(product.categories),
      this._resolveCategoryOrderHints(product.categoryOrderHints),
      this._resolveVariantReferences(product.masterVariant),
      PromiseBlueBird.map(
        product.variants,
        (variant: Variant) => this._resolveVariantReferences(variant),
        { concurrency: 3 }
      ),
    ]).then(
      ([
        productType,
        taxCategory,
        state,
        categories,
        categoryOrderHints,
        masterVariant,
        variants,
      ]: Array<Object>): ResolvedProductProjection => ({
        ...product,
        ...productType,
        ...taxCategory,
        ...state,
        ...categories,
        ...categoryOrderHints,
        masterVariant,
        variants,
      })
    )
  }

  async _resolveVariantReferences(variant: Variant): Promise<Variant> {
    if (!variant) return variant

    return {
      ...variant,
      prices: await this._resolvePriceReferences(variant.prices || []),
    }
  }

  async _resolvePriceReferences(prices: Array<Price>): Object {
    // get channel ids from given prices and filter out undefined values
    const channelIds: Array<string> = prices
      .map((price: Price) => get(price, 'channel.id'))
      .filter(Boolean)
    const customerGroupIds: Array<string> = prices
      .map((price: Price) => get(price, 'customerGroup.id'))
      .filter(Boolean)

    if (!channelIds.length && !customerGroupIds.length) return prices

    const CHUNK_SIZE = 150
    // resolve channels by their ids
    let channelsById: Object = {}
    if (channelIds.length > CHUNK_SIZE) {
      channelsById = await chunk(channelIds, CHUNK_SIZE).reduce(
        async (acc: Object, currentIds: Array<string>): Promise<{}> => ({
          ...(await acc),
          ...(await this._getChannelsById(currentIds)),
        }),
        PromiseBlueBird.resolve({})
      )
    } else {
      channelsById = await this._getChannelsById(channelIds)
    }

    // resolve customerGroups by their ids
    let customerGroupsById: Object = {}
    if (customerGroupIds.length > CHUNK_SIZE) {
      customerGroupsById = await chunk(customerGroupIds, CHUNK_SIZE).reduce(
        async (acc: Object, currentIds: Array<string>): Promise<{}> => ({
          ...(await acc),
          ...(await this._getCustomerGroupsById(currentIds)),
        }),
        PromiseBlueBird.resolve({})
      )
    } else {
      customerGroupsById = await this._getCustomerGroupsById(customerGroupIds)
    }
    // add channel and customerGroup objects to prices
    return prices.map((price: Price): Price => {
      let resolvedPrice
      if (price.channel && channelsById[price.channel.id]) {
        resolvedPrice = {
          ...price,
          channel: channelsById[price.channel.id],
        }
      }
      if (price.customerGroup && customerGroupsById[price.customerGroup.id]) {
        resolvedPrice = {
          ...price,
          ...resolvedPrice,
          customerGroup: customerGroupsById[price.customerGroup.id],
        }
      }
      return resolvedPrice || price
    })
  }

  static _pickAndConcatResults(results: SuccessResult[]): any[] {
    return flatten(results.map((res: SuccessResult): any[] => res.body.results))
  }

  async _getChannelsById(ids: Array<string>): Promise<Array<Object>> {
    const notCachedIds = ids.filter((id: string) => !this.channelsCache[id])

    // fetch unknown channels from API
    if (notCachedIds.length) {
      const predicate = `id in ("${notCachedIds.join('", "')}")`
      const channelService = this._createService('channels')
      const uri = channelService.where(predicate).build()

      const results = ProductJsonToCsv._pickAndConcatResults(
        await this.fetchReferences(uri)
      )
      results.forEach((result: Channel) => {
        // we should keep old channels in the cache because we can resolve
        // multiple products in parallel and we don't want to fetch same channels
        // multiple times
        this.channelsCache[result.id] = result
      })
    }

    // pick only requested channels from cache
    return pick(this.channelsCache, ids)
  }

  async _getCustomerGroupsById(ids: Array<string>): Promise<Array<Object>> {
    const notCachedIds = ids.filter(
      (id: string) => !this.customerGroupsCache[id]
    )

    // fetch unknown customerGroups from API
    if (notCachedIds.length) {
      const predicate = `id in ("${notCachedIds.join('", "')}")`
      const customerGroupService = this._createService('customerGroups')
      const uri = customerGroupService.where(predicate).build()
      const results = ProductJsonToCsv._pickAndConcatResults(
        await this.fetchReferences(uri)
      )

      results.forEach((result: CustomerGroup) => {
        // we should keep old customerGroups in the cache because we can resolve
        // multiple products in parallel and we don't want to fetch same customerGroups
        // multiple times
        this.customerGroupsCache[result.id] = result
      })
    }

    // pick only requested customerGroups from cache
    return pick(this.customerGroupsCache, ids)
  }

  _resolveProductType(productTypeReference: TypeReference): Object {
    if (!productTypeReference) return {}

    const productTypeService = this._createService('productTypes')
    const uri = productTypeService.byId(productTypeReference.id).build()
    return this.fetchReferences(uri).then(
      ([{ body }]: SuccessResult): {
        productType: ProductType,
      } => ({ productType: body })
    )
  }

  _resolveTaxCategory(taxCategoryReference: TypeReference): Object {
    if (!taxCategoryReference) return {}

    const taxCategoryService = this._createService('taxCategories')
    const uri = taxCategoryService.byId(taxCategoryReference.id).build()
    return this.fetchReferences(uri).then(
      ([{ body }]: SuccessResult): {
        taxCategory: TaxCategory,
      } => ({ taxCategory: body })
    )
  }

  _resolveState(stateReference: TypeReference): Object {
    if (!stateReference) return {}

    const stateService = this._createService('states')
    const uri = stateService.byId(stateReference.id).build()
    return this.fetchReferences(uri).then(
      ([{ body }]: SuccessResult): {
        state: State,
      } => ({ state: body })
    )
  }

  _resolveCategories(
    categoriesReference: Array<TypeReference>
  ): Array<Category> | {} {
    if (!categoriesReference || !categoriesReference.length) return {}

    const categoryIds: Array<string> = map(categoriesReference, 'id')

    return this._getCategories(categoryIds).then(
      (categories: Array<Category>): { categories: Array<Category> } => {
        if (this.parserConfig.categoryBy !== 'namedPath') return { categories }
        return PromiseBlueBird.map(
          categories,
          (cat: Category): Promise<Category> => this._resolveAncestors(cat)
        ).then((categoriesWithParents: Array<Category>): Object => ({
          categories: categoriesWithParents,
        }))
      }
    )
  }

  _resolveCategoryOrderHints(categoryOrderHintsReference: Object): Object {
    if (
      !categoryOrderHintsReference ||
      !Object.keys(categoryOrderHintsReference).length
    )
      return { categoryOrderHints: undefined }

    const catIdentifier = this.parserConfig.categoryOrderHintBy
    const lang = this.parserConfig.language
    const categoryIds = Object.keys(categoryOrderHintsReference)
    return this._getCategories(categoryIds).then(
      (resolvedCategories: Array<Category>): Object => {
        const categoryOrderHints = {}
        resolvedCategories.forEach((category: Category) => {
          const catRef =
            catIdentifier === 'name'
              ? category[catIdentifier][lang]
              : category[catIdentifier]
          categoryOrderHints[catRef] = categoryOrderHintsReference[category.id]
        })
        return { categoryOrderHints }
      }
    )
  }

  _resolveAncestors(category: Category): Promise<Category> {
    const getParent = (cat: Category): Promise<Category> => {
      if (!cat.parent) return PromiseBlueBird.resolve(cat)

      return (
        this._getCategories([cat.parent.id])
          .then((resolvedCategory: Object): Promise<Category> =>
            getParent(resolvedCategory[0])
          )
          // $FlowFixMe[incompatible-return]
          .then((parent: Object): Promise<Category> => ({ ...cat, parent }))
      )
    }
    return getParent(category)
  }

  // This method decides if to get the categories from cache or API
  _getCategories(ids: Array<string>): Promise<Array<Object>> {
    const notCachedIds = []
    const cachedCategories = []
    ids.forEach((id: string) => {
      if (this.categoriesCache[id])
        cachedCategories.push(this.categoriesCache[id])
      else notCachedIds.push(id)
    })
    if (!notCachedIds.length) return PromiseBlueBird.resolve(cachedCategories)

    const predicate = `id in ("${notCachedIds.join('", "')}")`
    const categoriesService = this._createService('categories')
    const uri = categoriesService.where(predicate).build()
    return this.fetchReferences(uri).then(
      (res: SuccessResult[]): Array<Category> => {
        const results = ProductJsonToCsv._pickAndConcatResults(res)
        results.forEach((result: Category) => {
          cachedCategories.push(result)
          this.categoriesCache[result.id] = result
        })
        return cachedCategories
      }
    )
  }

  _createService(serviceType: string): Object {
    const service = createRequestBuilder({
      projectKey: this.apiConfig.projectKey,
    })[serviceType]

    return service
  }
}

ProductJsonToCsv.prototype.fetchReferences = memoize(function _fetchReferences(
  uri: string
): Promise<SuccessResult> {
  const request: ClientRequest = {
    uri,
    method: 'GET',
  }
  if (this.accessToken)
    request.headers = {
      Authorization: `Bearer ${this.accessToken}`,
    }
  return this.client.process(
    request,
    (res: SuccessResult): Promise<SuccessResult> => PromiseBlueBird.resolve(res)
  )
})
