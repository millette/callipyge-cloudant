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
      if (!options) { options = {} }

      const urlObject = url.parse(`https://${pluginOptions.username}.cloudant.com/${pluginOptions.dbName}/`)
      if (options.auth) {
        urlObject.auth = [pluginOptions.username, pluginOptions.password].join(':')
      }

      options = {
        mapUri: function (request, callback) {
          if (request.params.afterdb) {
            if (reserved.indexOf(request.params.afterdb) !== -1) {
              request.params.afterdb = '/' + request.params.afterdb
            }
            urlObject.pathname = url.resolve(urlObject.pathname, request.params.afterdb)
          }
          urlObject.query = request.query
          const dbUrl = url.format(urlObject)
          // console.log('dbUrl:', dbUrl)
          // console.log('doing some aditional stuff before redirecting')
          callback(null, dbUrl, { accept: 'application/json' })
        },
        onResponse: function (err, res, request, reply, settings, ttl) {
          // console.log('receiving the response from the upstream.', settings, ttl)
          if (err) { return reply(err) }
          wreck.read(res, { json: true }, function (err, payload) {
            // console.log('some payload manipulation if you want to.')
            if (err) { return reply(err) }
            switch (payload.rows && request.query.only) {
              case 'docs':
                payload = payload.rows.map((row) => row.doc || row)
              break

              case 'rows':
                payload = payload.rows
              break
            }
            reply(payload).headers = res.headers
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
