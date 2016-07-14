import querystring from 'query-string'
import oauth from 'oauth-1.0a'

export default class {
	constructor( config ) {

		if ( ! config.url ) {
			throw new error( 'Please specify a url in the config object.' )
		}
		this.config = {
			credentials: {},
 			brokerURL: 'https://app.wp-api.org/',
 			...config,
		}

	}

	getConsumerToken() {
		if ( ! this.config.brokerCredentials ) {
			throw new error( 'Config does not include a brokerCredentials value.' )
		}

		this.config.credentials.client = this.config.brokerCredentials.client
		return this.post( this.config.brokerURL + 'broker/connect', {
			server_url: this.config.url,
		} ).then( data => {

			if ( data.status && data.status === 'error' ) {
				throw { message: 'Broker error: ' + data.message, code: data.type }
			}
			this.config.credentials.client = {
				public: data.client_token,
				secret: data.client_secret,
			}

			return data
		} )
	}

	getRequestToken() {

		if ( ! this.config.callbackURL ) {
			throw new error( 'Config does not include a callbackURL value.' )
		}
		return this.post( this.config.url + 'oauth1/request', {
			callback_url: this.config.callbackURL,
		} ).then( data => {
			var redirectURL = this.config.url + 'oauth1/authorize?' + querystring.stringify({
				oauth_token: data.oauth_token,
				oauth_callback: this.config.callbackURL,
			})

			this.config.credentials.token = {
				secret: data.oauth_token_secret,
			}

			return { redirectURL: redirectURL, token: data }
		} )
	}

	getAccessToken( oauthVerifier ) {
		return this.post( this.config.url + 'oauth1/access', {
			oauth_verifier: oauthVerifier,
		} ).then( data => {
			this.config.credentials.token = {
				public: data.oauth_token,
				secret: data.oauth_token_secret,
			}

			return this.config.credentials.token
		} )
	}

	authorize( next ) {

		var args = {}
		var savedCredentials = window.localStorage.getItem( 'requestTokenCredentials' )
		if ( window.location.href.indexOf( '?' ) ) {
			args = querystring.parse( window.location.href.split('?')[1] )
		}

		if ( ! this.config.credentials.client ) {
			return this.getConsumerToken().then( this.authorize.bind( this ) )
		}

		if ( this.config.credentials.token && this.config.credentials.token.public ) {
			return Promise.resolve("Success")
		}

		if ( savedCredentials ) {
			this.config.credentials = JSON.parse( savedCredentials )
			window.localStorage.removeItem( 'requestTokenCredentials' )
		}

		if ( ! this.config.credentials.token ) {
			return this.getRequestToken().then( this.authorize.bind( this ) )
		} else if ( ! this.config.credentials.token.public && ! savedCredentials ) {
			window.localStorage.setItem( 'requestTokenCredentials', JSON.stringify( this.config.credentials ) )
			window.location = next.redirectURL
			throw 'Redirect to authrization page...'
		} else if ( ! this.config.credentials.token.public && args.oauth_token ) {
			this.config.credentials.token.public = args.oauth_token
			return this.getAccessToken( args.oauth_verifier )
		}
	}

	saveCredentials() {
		window.localStorage.setItem( 'tokenCredentials', JSON.stringify( this.config.credentials ) )
	}

	removeCredentials() {
		delete this.config.credentials.token
		window.localStorage.remoteItem( 'tokenCredentials' )
	}

	restoreCredentials() {
		var savedCredentials = window.localStorage.getItem( 'tokenCredentials' )
		if ( savedCredentials ) {
			this.config.credentials = JSON.parse( savedCredentials )
		}
		return this
	}

	get( url, data ) {
		url = url += ! data ? '' : ( '?' + querystring.stringify( data ) )
		return this.request( 'GET', url )
	}

	post( url, data ) {
		return this.request( 'POST', url, data )
	}

	del( url, data, callback ) {
		return this.request( 'DELETE', url, data )
	}

	request( method, url, data = null ) {

		if ( this.config.credentials.client ) {
			this.oauth = new oauth({
				consumer: this.config.credentials.client,
				signature_method: 'HMAC-SHA1'
			})
		}

		if ( url.indexOf( 'http' ) !== 0 ) {
			url = this.config.url + 'wp-json' + url
		}

		if ( this.oauth ) {
			var oauthData = this.oauth.authorize( {
				method: method,
				url: url,
				data: data
			}, this.config.credentials.token ? this.config.credentials.token : null )
		}

		var headers = {
			Accept: 'application/json',
			'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
		}

		if ( this.oauth ) {
			headers = {...headers, ...this.oauth.toHeader( oauthData )}
		}

		return fetch( url, {
			method: method,
			headers: headers,
			mode: 'cors',
			body: ['GET','HEAD'].indexOf( method ) > -1 ? null : querystring.stringify( data )
		} )
		.then( response => {
			if ( response.headers.get( 'Content-Type' ) && response.headers.get( 'Content-Type' ).indexOf( 'x-www-form-urlencoded' ) > -1 ) {
				return response.text().then( text => {
					return querystring.parse( text )
				})
			}
			return response.text().then( text => {

				try {
					var json = JSON.parse( text )
				} catch( e ) {
					throw { message: text, code: response.status }
				}

				if ( response.status >= 300) {
					throw json
				} else {
					return json
				}
			})
		} )
	}
}