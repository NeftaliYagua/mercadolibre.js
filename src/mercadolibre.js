;


(function(cookie, XAuth) {

    var Store = function() {
        this.map = {};

        return this;
    };

    Store.localStorageAvailable = (function() {
        try {
            return ('localStorage' in window) && window.localStorage !== null;
        } catch (e) {
            return false;
        }
    })();

    if (Store.localStorageAvailable) {
        Store.prototype.get = function(key) {
            return window.localStorage.getItem(key);
        };

        Store.prototype.set = function(key, value) {
            window.localStorage.setItem(key, value);
        };

        /**
         * Crypted storage
         * */
         Store.prototype.getSecure = function(key, secret) {
            var crypto = this.get(key);

            if (secret && secret != "" && crypto) {
              var value = this._decrypt(secret, crypto);
              var length = parseInt(this.get(key + ".length"));

              return value.substring(0, length);
            }

            return undefined;
          }

          Store.prototype.setSecure = function(key, value, options) {
            options = options || {};

            var domain = options.domain ? options.domain : window.location.hostname;

            var secret = this._generateSecret();

            var data = JSON.stringify(value.data);

            var crypto = this._encrypt(secret, data);

            value.data = crypto;
            this.set(key, JSON.stringify(value));
            
            return {secret:secret, length:data.length};

          }

          Store.prototype._encrypt = function(secret, message) {
            var crypto = DESCipher.des(secret, message, 1/*encrypt=true*/, 0/*vector ? 1 : 0*/, null/*vector*/);
            crypto = DESExtras.stringToHex(crypto);
            return crypto;
          }

          Store.prototype._decrypt = function(secret, crypto) {
            var message = DESExtras.hexToString(crypto);
            message = DESCipher.des(secret, message, 0/*encrypt=false*/, 0/*vector=false*/, null/*vector*/);
            return message;
          }

          Store.prototype._generateSecret = function() {
            var v = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
                 'a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z',
                 '1','2','3','4','5','6','7','8','9','0']

            for(var j, x, i = v.length; i; j = parseInt(Math.random() * i), x = v[--i], v[i] = v[j], v[j] = x);

            var secret = v.slice(0,8).join("");

            return secret;
          }
  

    } else {
        Store.prototype.get = function(key) {
            return this.map[key];
        };

        Store.prototype.set = function(key, value) {
            this.map[key] = value;
        };

    }

    var Sroc = window.Sroc;

    var MercadoLibre = {
        baseURL : "https://api.mercadolibre.com",
        authorizationURL : "http://auth.mercadolibre.com/authorization",
        authorizationStateURL : "https://www.mercadolibre.com/jms/SITE/oauth/authorization/state",
        //authorizationStateURL : "https://auth.mercadolibre.com.ar/authorization/index",
  
        AUTHORIZATION_STATE : "authorization_state",
        
        options: {},
        hash : {},
        callbacks : {},
        pendingCallbacks: [],
        store : new Store(),
        appInfo : null,
        isAuthorizationStateAvaible : false,
        authorizationState: {},
        authorizationStateAvailableCallbacks : [],
        authorizationStateCallbackInProgress : false,
        synchronizationInProgress : false,
        showLogin: true,
        messages: (window.postMessage && window.localStorage && window.JSON),
        initialized: false,
        initCallbacks: [],
        _partial: function (func /* , 0..n args */ ) {
          var args = Array.prototype.slice.call(arguments, 1);
          var self = this;
          return function () {
            var allArguments = args.concat(Array.prototype.slice.call(arguments));
            return func.apply(self, allArguments);
          };
        },
        //initialization: set base domains an url. Initialize XAuth on base window
        init : function(options) {
            this.options = options;

            this.messages = (window.postMessage && window.localStorage && window.JSON);

            if (this.options.sandbox) 
                this.baseURL = this.baseURL.replace(/api\./, "sandbox.");
            
            if (this.options.test) 
                this.baseURL = this.baseURL.replace(/https\./, "http.");
            
            if (!this.options.xauth_domain)
              this.options.xauth_domain = "static.mlstatic.com";

            if (this.options.xauth_domain_fallback && !this.messages) 
              this.options.xauth_domain = this.options.xauth_domain_fallback;
              
            if (!this.options.xd_url)
              this.options.xd_url = "/xd.html";
            if (typeof(this.options.show_login) != "undefined")
              this.showLogin = this.options.show_login;
            
            XAuth.data.n = this.options.xauth_domain;
            XAuth.data.xdp = this.options.xd_url;
            XAuth.data.port = this.options.xauth_port;
            if (window.self == window.top)
              XAuth.init();
            this.initialized =true;
            while (this.initCallbacks.length > 0) {
              var callback = this.initCallbacks.shift();
              try {
                callback();
              } catch(e){};
            }
        },
        
        waitForInit: function(callback) {
          if (this.initialized)
            callback();
          else
            this.initCallbacks.push(callback);
        },
        //Is the authState still valid?
        _isExpired: function(authState) {
          //credentials are expired if not present or expired
          if (authState == null) {
            return true;
          }
          if (typeof(authState.authorization_info) == "undefined")
            return true;
			
          var expirationTime = authState.authorization_info.expires_in;
          if (expirationTime) {
            var dateToExpire = new Date(parseInt(expirationTime));
            var now = new Date();
            if (dateToExpire <= now) {
              return true;
            }
          }
          return false;
        },
      _decryptAuthorizationState: function(state) {
          var retVal = this.store._decrypt(this.secret.secret, state);
          var length = parseInt(this.secret.length);
          retVal = retVal.substring(0, length);
          retVal = JSON.parse(retVal);
          return retVal;
        },

        //Synchronizes auth state with localStorage in iFrame or auth FE
        _synchronizeAuthorizationState:function(tryRemote){
          if (!this.initialized){ 
            this.initCallbacks.push(this._partial(this._synchronizeAuthorizationState, tryRemote));
            return;
          }
            
          var key = this._getKey();
          var obj = this;
          if (this.messages) {	
            //retrieves data from remote localStorage
            XAuth.retrieve({
            retrieve: [ key ],
            callback: function(value) {
              obj._updateSecret();
              var notify = true;
              if (tryRemote && (value.tokens[key] == null || ((obj.secret == null || obj.secret == "")&& cookie("mlsecret") == null)) ) {
                //no data from iFrame - call login_status api
                obj._getRemoteAuthorizationState();
              } else {
                //save authState in local variable
                var authState = null
                if (typeof(value.tokens[key]) != "undefined") {
                  //decrypt
                  var authState = null;
                  try{ 
                  authState = value.tokens[key].data;
                    authState = obj._decryptAuthorizationState(authState);
                    authState.expiration = authState.expire;
                  } catch (e) {
                    authState = null;
                  }
                  if (obj._isExpired(authState)  && tryRemote) {
                    obj._getRemoteAuthorizationState();
                    notify = false;
                  }
                }
                if (notify) {
                  obj.authorizationState[key] = authState;
                  obj._onAuthorizationStateAvailable(authState);
                }
              }
              }
            });
          } else {
            //open xd iframe
            obj._getRemoteAuthorizationState();
          }
        },

        /**
         * gets authorization state from auth FE
         */
        _getRemoteAuthorizationState : function() {
          if (!this.initialized){ 
            this.initCallbacks.push(this._getRemoteAutorizationState);
            return;
          }

          //if already in progress dismiss call and wait
          if (!this.authorizationStateCallbackInProgress) {
            this.authorizationStateCallbackInProgress = true;
            if (this.appInfo == null) {
                this._getApplicationInfo(this._authorize);
            } else {
                this._authorize();
            }
          }
        },

        _getApplicationInfo : function(callback) {
          if (!this.initialized){ 
            this.initCallbacks.push(this._partial(this._getApplicationInfo, callback));
            return;
          }

            var self = this;
            this.get("/applications/" + this.options.client_id, {},
              function(response) {
                self.appInfo = response[2];
                if (callback) callback();
            });
        },

        _onAuthorizationStateAvailable : function(authorizationState) {
          //all callbacks waiting for authorizationState
          this.authorizationStateCallbackInProgress = false;
          this.isAuthorizationStateAvaible = true;
          //there is a new auth state, session changed
          this._triggerSessionChange();
          while (this.authorizationStateAvailableCallbacks.length > 0){
            var callback = this.authorizationStateAvailableCallbacks.shift();
            callback(authorizationState);
          }
        },

        getLoginStatus : function(callback) {
          if (!this.initialized){ 
            this.initCallbacks.push(this._partial(this.getLoginStatus, callback));
            return;
          }

          if (this.isAuthorizationStateAvaible)
          {
              var key = this._getKey();
              if (this.authorizationState[key] != null && !this._isExpired(this.authorizationState[key]))
              {
                  callback(this.authorizationState[key])
              }
              else
              {
                //expired credentials, resynchronyze pushing this action
                this.isAuthorizationStateAvaible = false;
                this.authorizationStateAvailableCallbacks.push(callback);
                this._synchronizeAuthorizationState(true);
              }
          }
          else
          {
              this.authorizationStateAvailableCallbacks.push(callback);
              this._synchronizeAuthorizationState(true);
          }

        },

        _expireToken: function(key) {
          if (!this.initialized){ 
            this.initCallbacks.push(this._partial(this._expireToken, key));
            return;
          }

          XAuth.expire({key:key});
          MercadoLibre.authorizationState[key] = null;
        },
        tokenIssue: function(response) {
          return response[0] != 200 && (
              (response[2].error != null && (
                (Object.prototype.toString.call( response[2].error ) === '[object Array]' && response[2].error[0].match(/.*(token|OAuth).*/)) ||
                (typeof( response[2].error ) === 'string'&& response[2].error.match(/.*(token|OAuth).*/)))) ||
              (response[2].message != null && response[2].message.match(/.*(token|OAuth).*/)) || response[0] == 403)
        },
		//wraps a request to intercept the response
        _wrap: function (url, method, params, options, callback) {
          var key = this._getKey();
          var self=this;
          var wrapper = function(response) {
            //check if token is invalid
            var properCallback = self._partial(callback, response);
            var success = function() {
              //se pudo loguear, vuelvo a llamar al get
              if (method == "get")
                Sroc.get( self._url(url), params, self._wrap( url, method, params, {}, callback));
              else if (method == "post") {}
            };
            var failure = function () {
              properCallback();
            };
            //invalid token error
            if (self.tokenIssue(response)) {
              if (!self.authorizationStateCallbackInProgress && self.isAuthorizationStateAvaible) {
                self.isAuthorizationStateAvaible = false;
                //delete token
                self._expireToken(key);
              }
              //get authentication state and then resend get call
              if (options.retry)
                self.withLogin(success, failure, self.showLogin);
              else
                failure();
            } else {
              properCallback();
            }
          };
          return wrapper;
        },
 
        get : function(url, params, callback, next) {
          if (!this.initialized){ 
            this.initCallbacks.push(this._partial(this.get, url, params, callback, next));
            return;
          }

          //no cache params
          if (!next)
            next = this._wrap(url,"get", params, {retry:true}, callback);

          Sroc.get(this._url(url), params, next);
        },

        post : function(url, params, callback) {
          if (!this.initialized){ 
            this.initCallbacks.push(this._partial(this.post, url, params, callback));
            return;
          }

          var self=this;
          var call = function() {
            Sroc.post(self._url(url), params, self._wrap(url, "post", params, {}, callback));
          }
          this.withLogin(call, callback, self.showLogin);
        },

        remove : function(url, params, callback) {
          if (!this.initialized){ 
            this.initCallbacks.push(this._partial(this.remove, url, params, callback));
            return;
          }

          if (!params) {
            params = {};
          }
          Sroc.remove(this._url(url), params, this._wrap(url, "delete", params, {}, callback));
        },

        getToken : function() {
          var key = this._getKey();
          var authorizationState = this.authorizationState[key];
          if (authorizationState != null) {
            var token = authorizationState.authorization_info.access_token;
            var expirationTime = authorizationState.authorization_info.expires_in;
            if (token && expirationTime) {
                var dateToExpire = new Date(parseInt(expirationTime));
                var now = new Date();
                if (dateToExpire <= now) {
                    token = null;
                }
            }
            return (token && token.length > 0) ? token : null;
          } else {
            return null;
          }
        },
        withLogin : function(successCallback, failureCallback, forceLogin) {
          if (!this.initialized){ 
            this.initCallbacks.push(this._partial(this.withLogin, successCallback, failureCallback, forceLogin));
            return;
          }

            var self = this;
            this.getLoginStatus(function(authorizationState){
                if(authorizationState.state == 'AUTHORIZED'){
                    successCallback();
                }else if(forceLogin){
                    self.pendingCallbacks.push(successCallback);
                    self.login();
                }else{
                    if (failureCallback) {
                      failureCallback();
                    }
                }
            });
        },

        login : function() {
          if (!this.initialized){ 
            this.initCallbacks.push(this.login);
            return;
          }

            this._popup(this._authorizationURL(true));
        },
        _iframe: function(url, id) {
          if (!id)
            id = "xauthIFrame";
          var iframe = $("#" + id);
          if (!iframe || iframe.length == 0) {
            var elem = window.document.createElement("iframe");
            var r = elem.style;
            r.position = "absolute";
            r.left = r.top = "-999px";
            elem.id = id;
            window.document.body.appendChild(elem);
            elem.src = url;
          } else
            iframe[0].src=url;
          
        },
        _authorize: function () {
          MercadoLibre._iframe(MercadoLibre._authorizationStateURL());
        },
        bind : function(event, callback) {
            if (typeof (this.callbacks[event]) == "undefined")
                this.callbacks[event] = [];
            this.callbacks[event].push(callback);
        },

        trigger : function(event, args) {
            var callbacks = this.callbacks[event];

            if (typeof (callbacks) == "undefined") {
                return;
            }
            for ( var i = 0; i < callbacks.length; i++) {
                callbacks[i].apply(null, args);
            }
        },

        logout : function() {
          //expire xauth key
          XAuth.expire({key:this._getKey()});
          this.authorizationState[this._getKey()]=null;
          //logout from meli
          this._iframe(this._logoutURL(), "logoutFrame");
          this._triggerSessionChange();
        },

        _triggerSessionChange : function() {
            this.trigger("session.change", [ this.getToken() ? true : false ]);
        },
        getSession: function() {
          return this.authorizationState[this._getKey()];
        },
        
        _url : function(url) {
            url = this.baseURL + url;
            var urlParams = "";

            var token = this.getToken();

            if (token) {
                var append = url.indexOf("?") > -1 ? "&" : "?";

                url += append + "access_token=" + token;
            }
            if (urlParams.length > 0) {
                append = url.indexOf("?") > -1 ? "&" : "?";
                url += append + urlParams;
            }

            return url;
        },

        _parseHash : function() {
            var localHash = window.location.hash;

            if (localHash.length == 0) {
                return;
            }
            localHash = localHash.substr(1);
            if (localHash.length == 0) {
                return;
            }
            var self = this;


            if (localHash[0] == '%' || localHash[0] == '{')
              self.hash=JSON.parse(unescape(localHash));
            else {
              var pairs = localHash.split("&");

              for ( var i = 0; i < pairs.length; i++) {
                  var pair = null;

                  if (pair = pairs[i].match(/([A-Za-z_\-]+)=(.*)$/)) {
                      self.hash[pair[1]] = pair[2];
                  }
              }
            }
        },
        _notifyParent: function(message) {
          var p = window.opener || window.parent;
          if (typeof(p) == "undefined") return;
          if (!this.messages) {
            
            if (message.class == "meli::loginComplete") 
              p._loginComplete(message.secret);
            else if (message.class == "meli::authComplete") 
              p._authComplete(message.secret);
            else if (message.class == "meli::logout") 
              p._logoutComplete();
            else if (message.class == "meli::close") 
              p._logoutComplete();
            
          } else p.postMessage(JSON.stringify({cmd:message.class, data:message.secret}), "*");
        },
        // Check if we're returning from a redirect
        // after authentication inside an iframe.
        _checkPostAuthorization : function() {
            var p = window.opener || window.parent;
			
            if (this.hash.state && this.hash.state == "iframe") {
              //returning from authorization (login)
              if (!this.hash.error) {	
                //TODO: Should remove this parsing
                this.options = {client_id:
                    RegExp("(APP_USR\\-)(\\d+)(\\-)").exec(this.hash.access_token)[2]
                  }
                var key = this._getKey();
                //save in local storage the hash data
                var authorizationState =  {
                    state: 'AUTHORIZED',
                    authorization_info: {
                        access_token: this.hash.access_token,
                        expires_in: new Date(new Date().getTime() + parseInt(this.hash.expires_in) * 1000).getTime(),
                        user_id: this.hash.user_id
                    }
                };
                var secret = this.store.setSecure(key, {
                  key : key,
                  data : authorizationState,
                  expire : authorizationState.authorization_info.expires_in,
                  extend : [ "*" ]
                });
              }
              this._notifyParent({class:"meli::loginComplete", secret:secret});
            } else if (this.hash.state) {
              //from Authorization State
              authorizationState = this.hash;
              var key = this.hash.client_id + this.AUTHORIZATION_STATE;
              if (!this.hash.authorization_info && (this.hash.state == "UNKNOWN" || this.hash.state=="NOT_AUTHORIZED")) {
                this.hash.authorization_info =  {
                  access_token: null,
                  expires_in: new Date(new Date().getTime() + parseInt(10800) * 1000).getTime(),
                  user_id: null
                }
              } else if (this.hash.authorization_info) {
                var expiration = new Date().getTime() + (this.hash.authorization_info ? this.hash.authorization_info.expires_in* 1000 : 0);
                this.hash.authorization_info.expires_in = expiration;
              }
              var secret = this.store.setSecure(key, {
                key : key,
                data : authorizationState,
                expire : expiration ,
                extend : [ "*" ]
              });
              this._notifyParent({class:"meli::authComplete", secret:secret});
            } else if (this.hash.action == "logout") {
              this._notifyParent({class:"meli::logout"});
            }
        },

        _loginComplete : function(secret) {
           if (this._popupWindow) {
              var isModal = false;
              try {
                isModal = this._popupWindow.type && this._popupWindow.type == "modal";
              }catch (e) {}
                if (isModal) {
                        this._popupWindow.hide();
                        this._popupWindow = null;
                }
                else 
                        this._popupWindow.postMessage(JSON.stringify({cmd:"meli::close"}), "*");
           }
           //update our authorization credentials
           var self = this;
           this.authorizationStateAvailableCallbacks.push(function(authState) {
              self._triggerSessionChange();

              while (self.pendingCallbacks.length > 0)
                  (self.pendingCallbacks.shift())();
           });
           this._storeSecret(secret);
           this._synchronizeAuthorizationState(false);
          
        },
        _logoutComplete : function () {
          this._storeSecret("");
          $('#logoutFrame').remove();
        },
        _authComplete : function(secret) {
           //update our authorization credentials
           var self = this;
           this.authorizationStateAvailableCallbacks.push(function(authState) {
              self._triggerSessionChange();
           });
           this._storeSecret(secret);
           this._synchronizeAuthorizationState(false);
        },
        _storeSecret: function(secret) {
          //set cookie
          cookie("mlsecret", JSON.stringify(secret), {domain:document.domain, path:"/"});
          this.secret = secret;
        },

        _popup : function(url) {
            if (!this._popupWindow || this._popupWindow.closed) {
                var width = 830;
                var height = 510;
                var left = parseInt((screen.availWidth - width) / 2);
                var top = parseInt((screen.availHeight - height) / 2);
                if (this.options.login_function)
                  this._popupWindow = this.options.login_function(url).show();
                else
                  this._popupWindow = (window.open(url, "", "toolbar=no,status=no,location=yes,menubar=no,resizable=no,scrollbars=no,width=" + width + ",height=" + height + ",left=" + left + ",top=" + top + "screenX=" + left + ",screenY=" + top));
                this._popup.on
            } else {
              if (this._popupWindow.focus)
                this._popupWindow.focus();
            }
        },
        _getKey: function() {
          var key = null;
          try {
            key = this.options.client_id + this.AUTHORIZATION_STATE;
          } catch (Error) {
            key = "";
          }
          return key;
          
        },
        _updateSecret : function() {
          try {
            this.secret = JSON.parse(cookie("mlsecret"));
          } catch (e) {
            this.secret = null;
          }
        },
        _authorizationStateURL: function() {
          return this.authorizationStateURL.replace("SITE", this.appInfo.site_id.toLowerCase()) + "?client_id=" + this.options.client_id + "&redirect_uri=" + encodeURIComponent(this._xd_url()) + "&response_type=token";
        },
        _authorizationURL : function(interactive) {
            return this.authorizationURL + "?redirect_uri=" + encodeURIComponent(this._xd_url()) + "&response_type=token" + "&client_id=" + this.options.client_id + "&state=iframe" + "&display=popup" + "&interactive=" + (interactive ? 1 : 0);
        },
        _logoutURL: function() {
            return "http://www.mercadolibre.com.ar/jm/logout?urlTo=" + encodeURIComponent(this._xd_url()+"#action=logout");
        },
        _xd_url: function() {
			return "http://" + this.options.xauth_domain + (this.options.xauth_port ? ":" + this.options.xauth_port : "") + this.options.xd_url;
		}
        
    };

    MercadoLibre._parseHash();

    MercadoLibre._checkPostAuthorization();

    window.MercadoLibre = MercadoLibre;

})(cookie, XAuth);
