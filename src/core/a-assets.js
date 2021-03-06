var ANode = require('./a-node');
// var bind = require('../utils/bind');
var debug = require('../utils/debug');
var registerElement = require('./a-register-element').registerElement;
var THREE = require('../lib/three');

var fileLoader = new THREE.FileLoader();
var warn = debug('core:a-assets:warn');

/**
 * Asset management system. Handles blocking on asset loading.
 */
module.exports = registerElement('a-assets', {
    prototype: Object.create(ANode.prototype, {
        createdCallback: {
            value: function () {
                this.isAssets = true;
                this.fileLoader = fileLoader;
                this.timeout = null;
                this.loders = []
            }
        },

        attachedCallback: {
            value: function () {
                if (!this.parentNode.isScene) {
                    throw new Error('<a-assets> must be a child of a <a-scene>.');
                }
                // loadderAssets.call(this)
            }
        },

        detachedCallback: {
            value: function () {
                if (this.timeout) { clearTimeout(this.timeout); }
            }
        },

        getChildEntities: {
            value: function () {
                var children = this.children;
                var childEntities = [];

                for (var i = 0; i < children.length; i++) {
                    var child = children[i];
                    if (child instanceof AEntity) {
                        childEntities.push(child);
                    }
                }
                console.log(childEntities)
                return childEntities;
            }
        },

        reload: {
            value: function () {
                // this.innerHTML += el
                // console.log(el)
                loadderAssets.call(this)
                // this.emit('child-attached', { el: el });
            }
        },

        load: {
            value: function () {
                ANode.prototype.load.call(this, null, function waitOnFilter(el) {
                    return el.isAssetItem && el.hasAttribute('src');
                });
            }
        }
    })
});

function loadderAssets() {
    var self = this;
    var i;
    var loaded = {};
    var mediaEl;
    var mediaEls;
    var imgEl;
    var imgEls;
    var timeout;

    // Wait for <img>s.
    imgEls = this.querySelectorAll('img');
    for (i = 0; i < imgEls.length; i++) {
        imgEl = fixUpMediaElement(imgEls[i]);
        if (imgEls[i].attributes.scene.value == undefined) {
            throw new Error("Todos os assets tem que pssuir a cena.");
        }

        //Checa se esse asstes ja foi baixado e se nao faz o download
        if (!imgEls[i].isChecked) {
            //Caso nao exista cena ele vai crirar uma
            if (loaded[imgEls[i].attributes.scene.value] == undefined) loaded[imgEls[i].attributes.scene.value] = []

            imgEls[i].isChecked = true
            loaded[imgEls[i].attributes.scene.value].push(new Promise(function (resolve, reject) {
                // Set in cache because we won't be needing to call three.js loader if we have.
                // a loaded media element.
                
               THREE.Cache.files[imgEls[i].getAttribute('src')] = imgEl;

                if(imgEl.complete == true) {
                  resolve({ path: [imgEl] })
                } else {
                  imgEl.onload = resolve;
                  imgEl.onerror = reject;
                }
            }));
        }
    }

    // Wait for <audio>s and <video>s.
    mediaEls = this.querySelectorAll('audio, video');
    for (i = 0; i < mediaEls.length; i++) {

        mediaEl = fixUpMediaElement(mediaEls[i]);

        if (!mediaEl.src && !mediaEl.srcObject) {
            warn('Audio/video asset has neither `src` nor `srcObject` attributes.');
        }
        // se a midia voltar como undefined o modo preloading nao esta ativado
        if (!mediaEl.hasAttribute('autoplay') && mediaEl.getAttribute('preload') !== 'auto') {
        } else {


            //Checa se esse asstes ja foi baixado e se nao faz o download
            if (!mediaEls[i].isChecked) {
                //Caso nao exista cena ele vai crirar uma
                if (loaded[mediaEls[i].attributes.scene.value] == undefined) {
                    loaded[mediaEls[i].attributes.scene.value] = []
                }
                mediaEls[i].isChecked = true
                loaded[mediaEls[i].attributes.scene.value].push(mediaElementLoaded(mediaEl));
            }
        }
    }

    // Trigger loaded for scene to start rendering.
    var loopLoaded = Object.keys(loaded)

    for (i = 0; i < loopLoaded.length; i++) {
        Promise.all(loaded[loopLoaded[i]]).then(e => emitter(self, e));
    }


    // Timeout to start loading anyways.
    timeout = parseInt(this.getAttribute('timeout'), 10) || 3000;
    this.timeout = setTimeout(function () {
        if (self.hasLoaded) { return; }
        warn('Asset loading timed out in ', timeout, 'ms');
        self.emit('timeout');
        self.load();
    }, timeout);
}

function emitter(self, event) {
    self.loders.push(event[0].path[0].attributes.scene.value)
    self.emit('sceneLoaded', { scene: event[0].path[0].attributes.scene.value, assets: event })
}


/**
 * Preload using XHRLoader for any type of asset.
 */
registerElement('a-asset-item', {
    prototype: Object.create(ANode.prototype, {
        createdCallback: {
            value: function () {
                this.data = null;
                this.isAssetItem = true;
            }
        },

        attachedCallback: {
            value: function () {
                var self = this;
                var src = this.getAttribute('src');
                fileLoader.setResponseType(
                    this.getAttribute('response-type') || inferResponseType(src));
                fileLoader.load(src, function handleOnLoad(response) {
                    self.data = response;
                    /*
                      Workaround for a Chrome bug. If another XHR is sent to the same url before the
                      previous one closes, the second request never finishes.
                      setTimeout finishes the first request and lets the logic triggered by load open
                      subsequent requests.
                      setTimeout can be removed once the fix for the bug below ships:
                      https://bugs.chromium.org/p/chromium/issues/detail?id=633696&q=component%3ABlink%3ENetwork%3EXHR%20&colspec=ID%20Pri%20M%20Stars%20ReleaseBlock%20Component%20Status%20Owner%20Summary%20OS%20Modified
                    */
                    setTimeout(function load() { ANode.prototype.load.call(self); });
                }, function handleOnProgress(xhr) {
                    self.emit('progress', {
                        loadedBytes: xhr.loaded,
                        totalBytes: xhr.total,
                        xhr: xhr
                    });
                }, function handleOnError(xhr) {
                    self.emit('error', { xhr: xhr });
                });
            }
        }
    })
});

/**
 * Create a Promise that resolves once the media element has finished buffering.
 *
 * @param {Element} el - HTMLMediaElement.
 * @returns {Promise}
 */
function mediaElementLoaded(el) {
    if (!el.hasAttribute('autoplay') && el.getAttribute('preload') !== 'auto') {
        return;
    }

    // If media specifies autoplay or preload, wait until media is completely buffered.
    return new Promise(function (resolve, reject) {

        if (el.readyState === 4) { return resolve({ path: [el] }); }  // Already loaded.
        if (el.error) { return reject(); }  // Error.

        el.addEventListener('loadeddata', e => checkfinish(e), false);

        el.addEventListener('progress', e => checkProgress(e), false);
        el.addEventListener('error', reject, false);

        // console.log({e:el})

        function checkfinish(e) {
            var secondsBuffered = 0;
            for (var i = 0; i < e.path[0].buffered.length; i++) {
                secondsBuffered += e.path[0].buffered.end(i) - e.path[0].buffered.start(i);
            }

            //   console.log(`${e.path[0].attributes.id.value} ${secondsBuffered} - ${e.path[0].duration}`)
            if (secondsBuffered < e.path[0].duration) {
                el.parentElement.addEventListener('sound-loaded', e => {

                    //   console.log(e.detail.attrValue.src)
                    if (e.detail.attrValue.src == `#${el.id}`) {
                        // console.log(e)
                        resolve({ path: [el] });
                    }
                }, false);

            } else {
                resolve({ path: [el] });
            }
        }

        function checkProgress(e) {
            // Add up the seconds buffered.
            var secondsBuffered = 0;
            for (var i = 0; i < el.buffered.length; i++) {
                secondsBuffered += el.buffered.end(i) - el.buffered.start(i);
            }

            // resolve({path:[el]});
            // Compare seconds buffered to media duration.

            if (secondsBuffered >= el.duration) {
                // Set in cache because we won't be needing to call three.js loader if we have.
                // a loaded media element.
                // Store video elements only. three.js loader is used for audio elements.
                // See assetParse too.
                if (el.tagName === 'VIDEO') {
                    THREE.Cache.files[el.getAttribute('src')] = el;
                }

                resolve(e);
            }
        }
    });
}

/**
 * Automatically add attributes to media elements where convenient.
 * crossorigin, playsinline.
 */
function fixUpMediaElement(mediaEl) {
    // Cross-origin.
    var newMediaEl = setCrossOrigin(mediaEl);

    // Plays inline for mobile.
    if (newMediaEl.tagName && newMediaEl.tagName.toLowerCase() === 'video') {
        newMediaEl.setAttribute('playsinline', '');
        newMediaEl.setAttribute('webkit-playsinline', '');
    }

    if (newMediaEl !== mediaEl) {
        mediaEl.parentNode.appendChild(newMediaEl);
        mediaEl.parentNode.removeChild(mediaEl);
    }
    return newMediaEl;
}

/**
 * Automatically set `crossorigin` if not defined on the media element.
 * If it is not defined, we must create and re-append a new media element <img> and
 * have the browser re-request it with `crossorigin` set.
 *
 * @param {Element} Media element (e.g., <img>, <audio>, <video>).
 * @returns {Element} Media element to be used to listen to for loaded events.
 */
function setCrossOrigin(mediaEl) {
    var newMediaEl;
    var src;

    // Already has crossorigin set.
    if (mediaEl.hasAttribute('crossorigin')) { return mediaEl; }

    src = mediaEl.getAttribute('src');

    if (src !== null) {
        // Does not have protocol.
        if (src.indexOf('://') === -1) { return mediaEl; }

        // Determine if cross origin is actually needed.
        if (extractDomain(src) === window.location.host) { return mediaEl; }
    }

    warn('Cross-origin element (e.g., <img>) was requested without `crossorigin` set. ' +
        'A-Frame will re-request the asset with `crossorigin` attribute set. ' +
        'Please set `crossorigin` on the element (e.g., <img crossorigin="anonymous">)', src);
    mediaEl.crossOrigin = 'anonymous';
    newMediaEl = mediaEl.cloneNode(true);
    return newMediaEl;
}

/**
 * Extract domain out of URL.
 *
 * @param {string} url
 * @returns {string}
 */
function extractDomain(url) {
    // Find and remove protocol (e.g., http, ftp, etc.) to get domain.
    var domain = url.indexOf('://') > -1 ? url.split('/')[2] : url.split('/')[0];

    // Find and remove port number.
    return domain.substring(0, domain.indexOf(':'));
}

/**
 * Infer response-type attribute from src.
 * Default is text (default XMLHttpRequest.responseType)
 * and arraybuffer for .glb files.
 *
 * @param {string} src
 * @returns {string}
 */
function inferResponseType(src) {
    var fileName = getFileNameFromURL(src);
    var dotLastIndex = fileName.lastIndexOf('.');
    if (dotLastIndex >= 0) {
        var extension = fileName.slice(dotLastIndex, src.search(/\?|#|$/));
        if (extension === '.glb') {
            return 'arraybuffer';
        }
    }
    return 'text';
}
module.exports.inferResponseType = inferResponseType;

/**
 * Extract filename from URL
 *
 * @param {string} url
 * @returns {string}
 */
function getFileNameFromURL(url) {
    var parser = document.createElement('a');
    parser.href = url;
    var query = parser.search.replace(/^\?/, '');
    var filePath = url.replace(query, '').replace('?', '');
    return filePath.substring(filePath.lastIndexOf('/') + 1);
}
module.exports.getFileNameFromURL = getFileNameFromURL;
