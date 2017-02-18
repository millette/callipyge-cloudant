'use strict'

// core
const url = require('url')

// npm
const h2o2 = require('h2o2')
const wreck = require('wreck')
const joi = require('joi')
const got = require('got')
const boom = require('boom')

// self
const pkg = require('./package.json')

const defaultTransform = (doc) => doc

const pluginSchema = joi.object({
  transform: joi.func().arity(1),
  username: joi.string().required(),
  password: joi.string().required(),
  dbName: joi.string().required()
})

// FIXME: only auth (bool) is allowed in options
// Should allow for all h2o2 options
// except the few that conflict with mapUri
const proxySchema = joi.object({
  auth: joi.boolean()
})

const reserved = ['_session']

exports.register = (server, pluginOptions, next) => {
  if (!pluginOptions) { pluginOptions = {} }
  if (!pluginOptions.transform) { pluginOptions.transform = defaultTransform }
  joi.assert(pluginOptions, pluginSchema, 'Invalid plugin options registering ' + pkg.name)

  const getDoc = function (request, reply) {
    if (!request.params.docid && !request.query.from) { return reply({}) }

    reply(
      request.server.inject({ allowInternals: true, url: ['', 'cloudant.private', request.params.docid || request.query.from].join('/') })
        .then((a) => {
          if (a.statusCode <= 100 || a.statusCode >= 400) {
            return boom.create(a.statusCode, a.result.reason, a.result)
          }
          a.result = pluginOptions.transform(a.result)
          if (request.query.from) {
            delete a.result._id
            delete a.result._rev
            a.result.title = 'Copy of ' + a.result.title
          }
          return a.result
        })
    )
  }

  const getAllDocs = function (request, reply) {
    reply(
      request.server.inject({ allowInternals: true, url: '/cloudant.private/_all_docs?include_docs=true&only=docs' })
        .then((a) => a.statusCode > 100 && a.statusCode < 400
          ? a.result.map(pluginOptions.transform)
          : boom.create(a.statusCode, a.result.reason, a.result)
        )
    )
  }

  const dbUrl = (auth) => {
    const urlObject = url.parse(`https://${pluginOptions.username}.cloudant.com/${pluginOptions.dbName}/`)
    if (auth) { urlObject.auth = [pluginOptions.username, pluginOptions.password].join(':') }
    return urlObject
  }

  const cloudantPost = function (doc, auth) {
    const u = dbUrl(auth)
    if (u.auth) {
      auth = u.auth
      delete u.auth
    }
    const u2 = url.format(u) + '/'

    const options = {
      json: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(doc)
    }
    if (auth) { options.auth = auth }
    return got.post(u2, options)
      .then((x) => x.body)
      .catch((e) => boom.wrap(e, e.statusCode))
  }

  const cloudantCreateIndex = function (index, auth) {
    const u = dbUrl(auth)
    if (u.auth) {
      auth = u.auth
      delete u.auth
    }
    const u2 = url.format(u) + '/_index'

    const options = {
      json: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(index)
    }
    if (auth) { options.auth = auth }
    return got.post(u2, options)
      .then((x) => x.body)
      .catch((e) => boom.wrap(e, e.statusCode))
  }

  const cloudantFind = function (query, auth) {
    const u = dbUrl(auth)
    if (u.auth) {
      auth = u.auth
      delete u.auth
    }
    const u2 = url.format(u) + '/_find'

    const options = {
      json: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(query)
    }
    if (auth) { options.auth = auth }
    return got.post(u2, options)
      .then((x) => x.body)
      .catch((e) => boom.wrap(e, e.statusCode))
  }

  server.method('cloudant.createIndex', cloudantCreateIndex)
  server.method('cloudant.find', cloudantFind)
  server.method('cloudant.post', cloudantPost)
  server.method('cloudant.getDoc', getDoc)
  server.method('cloudant.getAllDocs', getAllDocs)

  server.register(h2o2).then(() => {
    const cloudant = (route, options) => {
      // FIXME: only auth (bool) is allowed in options
      if (!options) { options = {} }
      joi.assert(options, proxySchema, 'Invalid cloudant handler options in ' + pkg.name)
      const auth = options.auth
      // FIXME: currently overrides all h2o2 options...

      const mapUri = function (request, callback) {
        const urlObject = dbUrl(auth)
        if (request.params.cloudant) {
          if (reserved.indexOf(request.params.cloudant) !== -1) {
            request.params.cloudant = '/' + request.params.cloudant
          }
          urlObject.pathname = url.resolve(urlObject.pathname, request.params.cloudant)
        }
        urlObject.query = Object.assign({}, request.query)
        delete urlObject.query.only
        callback(null, url.format(urlObject), { accept: 'application/json' })
      }

      const onResponse = function (err, res, request, reply, settings, ttl) {
        if (err) { return reply(err) }
        const respond = function (err, payload) {
          if (err) { return reply(err) }
          if (res.statusCode < 100 || res.statusCode >= 400) {
            // FIXME: Might want to keep this header or remove it entirely
            if (!auth) { delete res.headers['www-authenticate'] }
          } else if (payload.rows && request.query.only &&
            (request.query.only === 'docs' || request.query.only === 'rows')) {
            payload = payload.rows
            if (request.query.only === 'docs') { payload = payload.map((row) => row.doc || row) }
          }
          reply(payload)
            .code(res.statusCode)
            .message(res.statusMessage)
            .headers = res.headers
        }
        wreck.read(res, { json: true }, respond)
      }
      return server.root._handlers.proxy(route, { mapUri, onResponse })
    }
    const decorate = function (options) { cloudant(this.request.route, options)(this.request, this) }
    server.handler('cloudant', cloudant)
    server.decorate('reply', 'cloudant', decorate)

    server.route([
      {
        // FIXME: should handle any http method but h2o2 complains
        method: 'get',
        path: '/cloudant.public/{cloudant*}',
        handler: { cloudant: false },
        config: { isInternal: true }
      },

      {
        // FIXME: should handle any http method but h2o2 complains
        method: 'get',
        path: '/cloudant.private/{cloudant*}',
        handler: { cloudant: { auth: true } },
        config: { isInternal: true }
      }
    ])

    next()
  })
  .catch(next)
}

exports.register.attributes = { pkg }
