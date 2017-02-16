# Callipyge-cloudant readme

Proxy to cloudant couchdb hosting service. Builds on h2o2.

## Example usage

```
'use strict'

// npm
const Hapi = require('hapi')
const callipygeCloudant = require('callipyge-cloudant')

const server = new Hapi.Server()

server.connection({ port: 5050, host: 'localhost' })

server.register([{
  register: callipygeCloudant,
  options: {
    username: process.env.CLOUDANT_USERNAME,
    password: process.env.CLOUDANT_PASSWORD,
    dbName: process.env.CLOUDANT_DATABASE
  }
}])
  .then(server.start)
  .then(() => {
    // now do something interesting
  })
  .catch(console.error)
```

## Provides
### Server methods
server.methods.cloudant.post(doc, auth)

### Decorations
reply and handler: cloudant

## See also
This module is used in [callipyge-core][].

[callipyge-core]: <https://github.com/millette/callipyge-core>
