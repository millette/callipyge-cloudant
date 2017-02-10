'use strict'

// core
const url = require('url')

// npm
const h2o2 = require('h2o2')

exports.register = (server, pluginOptions, next) => {
  console.log('pluginOptions:', pluginOptions)

  // url.parse(
  // const dbUrl = `https://${pluginOptions.username}:${pluginOptions.password}@${pluginOptions.username}.cloudant.com/${pluginOptions.dbName}`
  // console.log('dbUrl:', dbUrl)

  server.register(h2o2)
    .then(() => {
      const proxy = (route, options) => {
        if (!options) { options = {} }
        // const dbUrl = `https://${pluginOptions.username}:${pluginOptions.password}@${pluginOptions.username}.cloudant.com/${pluginOptions.dbName}`
        const urlObject = url.parse(`https://${pluginOptions.username}.cloudant.com/${pluginOptions.dbName}`)
        if (options.auth) {
          urlObject.auth = [pluginOptions.username, pluginOptions.password].join(':')
        }
        delete options.auth
        const dbUrl = url.format(urlObject)
        console.log('dbUrl:', dbUrl)
        if (!options.uri) { options.uri = dbUrl }

        return server.root._handlers.proxy(route, options)
      }
      const decorate = function (options) {
        console.log('DECORATING CA')
        console.log('options:', options)
        proxy(this.request.route, options)(this.request, this)
      }

      console.log('REGISTERING CA')
      server.handler('cloudant', proxy)
      server.decorate('reply', 'cloudant', decorate)
      next()
    })
    .catch(next)
}

exports.register.attributes = { pkg: require('./package.json') }
