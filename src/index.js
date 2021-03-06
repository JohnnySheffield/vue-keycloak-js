import Keycloak from 'keycloak-js'

let installed = false

export default {
  install: function (Vue, params = {}) {
    if (installed) return
    installed = true

    const defaultParams = {
      config: window.__BASEURL__ ? `${window.__BASEURL__}/config` : '/config',
      init: {onLoad: 'login-required'}
    }
    const options = Object.assign({}, defaultParams, params)
    if (assertOptions(options).hasError) throw new Error(`Invalid options given: ${assertOptions(options).error}`)

    const watch = new Vue({
      data () {
        return {
          ready: false,
          authenticated: false,
          userName: null,
          fullName: null,
          token: null,
          logoutFn: null
        }
      }
    })
    getConfig(options.config)
      .then(config => {
        init(config, watch, options)
        Object.defineProperty(Vue.prototype, '$keycloak', {
          get () {
            return watch
          }
        })
      })
      .catch(err => {
        console.log(err)
      })
  }
}

function init (config, watch, options) {
  const keycloak = Keycloak({
    'realm': config['authRealm'],
    'url': config['authUrl'],
    'clientId': config['authClientId']
  })

  watch.$once('ready', function (cb) {
    cb && cb()
  })

  keycloak.init(options.init)
  keycloak.onReady = function (authenticated) {
    updateWatchVariables(authenticated)
    watch.ready = true
    typeof options.onReady === 'function' && watch.$emit('ready', options.onReady.bind(this, keycloak))
  }
  keycloak.onAuthSuccess = function () {
    // Check token validity every 10 seconds (10 000 ms) and, if necessary, update the token.
    // Refresh token if it's valid for less then 60 seconds
    const updateTokenInterval = setInterval(() => keycloak.updateToken(60), 10000)
    watch.logoutFn = () => {
      clearInterval(updateTokenInterval)
      keycloak.logout({
        'redirectUri': config['logoutRedirectUri']
      })
    }
  }
  keycloak.onAuthRefreshSuccess = function () {
    updateWatchVariables(true)
  }
  keycloak.onAuthRefreshError = function () {
    console.error('Error while trying to refresh the token')
  }
  keycloak.onAuthError = function (errorData) {
    console.error('Error during authentication: ' + JSON.stringify(errorData));
  }

  function updateWatchVariables (isAuthenticated = false) {
    watch.authenticated = isAuthenticated
    if (isAuthenticated) {
      watch.token = keycloak.token
      watch.userName = keycloak.tokenParsed['preferred_username']
      watch.fullName = keycloak.tokenParsed['name']
    }
  }
}

function assertOptions (options) {
  const {config, init, onReady} = options
  if (typeof config !== 'string' && !_isObject(config)) {
    return {hasError: true, error: `'config' option must be a string or an object. Found: '${config}'`}
  }
  if (!_isObject(init) || typeof init.onLoad !== 'string') {
    return {hasError: true, error: `'init' option must be an object with an 'onLoad' property. Found: '${init}'`}
  }
  if (onReady && typeof onReady !== 'function') {
    return {hasError: true, error: `'onReady' option must be a function. Found: '${onReady}'`}
  }
  return {
    hasError: false,
    error: null
  }
}

function _isObject (obj) {
  return obj !== null && typeof obj === 'object' && Object.prototype.toString.call(obj) !== '[object Array]'
}

function getConfig (config) {
  if (_isObject(config)) return Promise.resolve(config)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', config)
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          resolve(JSON.parse(xhr.responseText))
        } else {
          reject(Error(xhr.statusText))
        }
      }
    }
    xhr.send()
  })
}
