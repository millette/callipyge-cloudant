'use strict'

// core
const url = require('url')

// npm
const h2o2 = require('h2o2')
const wreck = require('wreck')

const reserved = ['_session']

exports.register = (server, pluginOptions, next) => server.register(h2o2)
  .then(() => {
    const proxy = (route, options) => {
      const auth = options && options.auth
      options = {
        mapUri: function (request, callback) {
          const urlObject = url.parse(`https://${pluginOptions.username}.cloudant.com/${pluginOptions.dbName}/`)
          if (auth) { urlObject.auth = [pluginOptions.username, pluginOptions.password].join(':') }

          if (request.params.afterdb) {
            if (reserved.indexOf(request.params.afterdb) !== -1) {
              request.params.afterdb = '/' + request.params.afterdb
            }
            urlObject.pathname = url.resolve(urlObject.pathname, request.params.afterdb)
          }
          urlObject.query = Object.assign({}, request.query)
          delete urlObject.query.only
          callback(null, url.format(urlObject), { accept: 'application/json' })
        },
        onResponse: function (err, res, request, reply, settings, ttl) {
          if (err) { return reply(err) }

          wreck.read(res, { json: true }, function (err, payload) {
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
          })
        }
      }

      return server.root._handlers.proxy(route, options)
    }
    const decorate = function (options) {
      proxy(this.request.route, options)(this.request, this)
    }

    server.handler('cloudant', proxy)
    server.decorate('reply', 'cloudant', decorate)
    next()
  })
  .catch(next)

exports.register.attributes = { pkg: require('./package.json') }
