'use strict'

// core
const url = require('url')

// npm
const h2o2 = require('h2o2')
const wreck = require('wreck')
const joi = require('joi')
// const got = require('got')

// self
const pkg = require('./package.json')

const pluginSchema = joi.object({
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
  joi.assert(pluginOptions, pluginSchema, 'Invalid plugin options registering ' + pkg.name)

  const dbUrl = (auth) => {
    const urlObject = url.parse(`https://${pluginOptions.username}.cloudant.com/${pluginOptions.dbName}/`)
    if (auth) { urlObject.auth = [pluginOptions.username, pluginOptions.password].join(':') }
    return urlObject
  }

  const cloudantPost = function (auth, doc) {
    const u = dbUrl(auth)
    if (u.auth) {
      auth = u.auth
      delete u.auth
    }
    const u2 = url.format(u)
    console.log('cloudantPost:', u2, auth, doc)
    return { ok: true }
  }

  server.method('cloudant.post', cloudantPost)

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
    next()
  })
  .catch(next)
}

exports.register.attributes = { pkg }
