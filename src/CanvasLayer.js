/**
 * Copyright 2012 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Extends OverlayView to provide a canvas "Layer".
 * @author Brendan Kenny
 */

/**
 * Simple bind for functions with no args for bind-less browsers (Safari).
 * @param {Object} thisArg The this value used for the target function.
 * @param {function} func The function to be bound.
 */
function simpleBindShim(thisArg, func) {
  return function() {
    func.apply(thisArg);
  };
}

/**
 * A map layer that provides a canvas over the slippy map and a callback
 * system for efficient animation. Requires canvas and CSS 2D transform
 * support.
 * @constructor
 * @extends google.maps.OverlayView
 */
class CanvasLayer extends google.maps.OverlayView {
  constructor(options) {
    super();

    /**
     * If true, canvas is in a map pane and the OverlayView is fully functional.
     * See google.maps.OverlayView.onAdd for more information.
     * @type {boolean}
     * @private
     */
    this.isAdded_ = false;

    /**
     * If true, each update will immediately schedule the next.
     * @type {boolean}
     * @private
     */
    this.isAnimated_ = false;

    /**
     * The name of the MapPane in which this layer will be displayed.
     * @type {string}
     * @private
     */
    this.paneName_ = CanvasLayer.DEFAULT_PANE_NAME_;

    /**
     * A user-supplied function called whenever an update is required. Null or
     * undefined if a callback is not provided.
     * @type {?function=}
     * @private
     */
    this.updateHandler_ = null;

    /**
     * A user-supplied function called whenever an update is required and the
     * map has been resized since the last update. Null or undefined if a
     * callback is not provided.
     * @type {?function}
     * @private
     */
    this.resizeHandler_ = null;

    /**
     * The LatLng coordinate of the top left of the current view of the map. Will
     * be null when this.isAdded_ is false.
     * @type {google.maps.LatLng}
     * @private
     */
    this.topLeft_ = null;

    /**
     * The map-pan event listener. Will be null when this.isAdded_ is false. Will
     * be null when this.isAdded_ is false.
     * @type {?function}
     * @private
     */
    this.centerListener_ = null;

    /**
     * The map-resize event listener. Will be null when this.isAdded_ is false.
     * @type {?function}
     * @private
     */
    this.resizeListener_ = null;

    /**
     * If true, the map size has changed and this.resizeHandler_ must be called
     * on the next update.
     * @type {boolean}
     * @private
     */
    this.needsResize_ = true;

    /**
     * A browser-defined id for the currently requested callback. Null when no
     * callback is queued.
     * @type {?number}
     * @private
     */
    this._rafId = null;

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.top = 0;
    canvas.style.left = 0;
    canvas.style.pointerEvents = "none";
    // canvas.style.border = '1px solid yellow';
    // canvas.style.boxSizing = 'border-box';

    /**
     * The canvas element.
     * @type {!HTMLCanvasElement}
     */
    this.canvas = canvas;

    /**
     * The CSS width of the canvas, which may be different than the width of the
     * backing store.
     * @private {number}
     */
    this.canvasCssWidth_ = null;

    /**
     * The CSS height of the canvas, which may be different than the height of
     * the backing store.
     * @private {number}
     */
    this.canvasCssHeight_ = null;

    /**
     * A value for scaling the CanvasLayer resolution relative to the CanvasLayer
     * display size.
     * @private {number}
     */
    this.resolutionScale_ = 1;

    this.resizeFunction_ = simpleBindShim(this, this.resize_);

    this.centerFunction_ = simpleBindShim(this, this.center_);

    this.idleFunction_ = simpleBindShim(this, this.idle_);

    this.zoomFunction_ = simpleBindShim(this, this.zoom_);

    this.requestUpdateFunction_ = simpleBindShim(this, this.update_);

    // set provided options, if any
    if (options) {
      this.setOptions(options);
    }
  }

  /**
   * The default MapPane to contain the canvas.
   * @type {string}
   * @const
   * @private
   */
  static get DEFAULT_PANE_NAME_() {
    return "overlayLayer";
  }

  /**
   * Transform CSS property name, with vendor prefix if required. If browser
   * does not support transforms, property will be ignored.
   * @type {string}
   * @const
   * @private
   */
  static get CSS_TRANSFORM_() {
    const div = document.createElement("div");
    const transformProps = [
      "transform",
      "WebkitTransform",
      "MozTransform",
      "OTransform",
      "msTransform"
    ];
    for (let i = 0; i < transformProps.length; i++) {
      const prop = transformProps[i];
      if (div.style[prop] !== undefined) {
        return prop;
      }
    }
    // return unprefixed version by default
    return transformProps[0];
  }

  /**
   * The cancelAnimationFrame function, with vendor-prefixed fallback. Does not
   * fall back to clearTimeout as some platforms implement requestAnimationFrame
   * but not cancelAnimationFrame, and the cost is an extra frame on onRemove.
   * MUST be called with window as thisArg.
   * @type {function}
   * @param {number=} requestId The id of the frame request to cancel.
   * @private
   */
  cancelAnimFrame_() {
    const fn =
      window.cancelAnimationFrame ||
      window.webkitCancelAnimationFrame ||
      window.mozCancelAnimationFrame ||
      window.oCancelAnimationFrame ||
      window.msCancelAnimationFrame ||
      function(requestId) {};
    fn();
  }

  /**
   * Sets any options provided. See CanvasLayerOptions for more information.
   * @param {CanvasLayerOptions} options The options to set.
   */
  setOptions(options) {
    if (options.animate !== undefined) {
      this.setAnimate(options.animate);
    }

    if (options.paneName !== undefined) {
      this.setPaneName(options.paneName);
    }

    if (options.updateHandler !== undefined) {
      this.setUpdateHandler(options.updateHandler);
    }

    if (options.wipeHandler !== undefined) {
      this.setWipeHandler(options.wipeHandler);
    }

    if (options.resizeHandler !== undefined) {
      this.setResizeHandler(options.resizeHandler);
    }

    if (options.resolutionScale !== undefined) {
      this.setResolutionScale(options.resolutionScale);
    }

    if (options.map !== undefined) {
      this.setMap(options.map);
    }
  }

  /**
   * Set the animated state of the layer. If true, updateHandler will be called
   * repeatedly, once per frame. If false, updateHandler will only be called when
   * a map property changes that could require the canvas content to be redrawn.
   * @param {boolean} animate Whether the canvas is animated.
   */
  setAnimate(animate) {
    this.isAnimated_ = !!animate;

    if (this.isAnimated_) {
      this.scheduleUpdate();
    }
  }

  /**
   * @return {boolean} Whether the canvas is animated.
   */
  isAnimated() {
    return this.isAnimated_;
  }

  /**
   * Set the MapPane in which this layer will be displayed, by name. See
   * {@code google.maps.MapPanes} for the panes available.
   * @param {string} paneName The name of the desired MapPane.
   */
  setPaneName(paneName) {
    this.paneName_ = paneName;

    this.setPane_();
  }

  /**
   * @return {string} The name of the current container pane.
   */
  getPaneName() {
    return this.paneName_;
  }

  /**
   * Adds the canvas to the specified container pane. Since this is guaranteed to
   * execute only after onAdd is called, this is when paneName's existence is
   * checked (and an error is thrown if it doesn't exist).
   * @private
   */
  setPane_() {
    if (!this.isAdded_) {
      return;
    }

    // onAdd has been called, so panes can be used
    const panes = this.getPanes();
    if (!panes[this.paneName_]) {
      throw new Error('"' + this.paneName_ + '" is not a valid MapPane name.');
    }

    panes[this.paneName_].appendChild(this.canvas);
  }

  /**
   * Set a function that will be called whenever the parent map and the overlay's
   * canvas have been resized. If opt_resizeHandler is null or unspecified, any
   * existing callback is removed.
   * @param {?function=} opt_resizeHandler The resize callback function.
   */
  setResizeHandler(opt_resizeHandler) {
    this.resizeHandler_ = opt_resizeHandler;
  }

  /**
   * Sets a value for scaling the canvas resolution relative to the canvas
   * display size. This can be used to save computation by scaling the backing
   * buffer down, or to support high DPI devices by scaling it up (by e.g.
   * window.devicePixelRatio).
   * @param {number} scale
   */
  setResolutionScale(scale) {
    if (typeof scale === "number") {
      this.resolutionScale_ = scale;
      this.resize_();
    }
  }

  /**
   * Set a function that will be called when a repaint of the canvas is required.
   * If opt_updateHandler is null or unspecified, any existing callback is
   * removed.
   * @param {?function=} opt_updateHandler The update callback function.
   */
  setUpdateHandler(opt_updateHandler) {
    this.updateHandler_ = opt_updateHandler;
  }

  setWipeHandler(wipeHandler) {
    this.wipeHandler_ = wipeHandler;
  }

  /**
   * @inheritDoc
   */
  onAdd() {
    if (this.isAdded_) {
      return;
    }

    this.isAdded_ = true;
    this.setPane_();

    this.resizeListener_ = google.maps.event.addListener(
      this.getMap(),
      "resize",
      this.resizeFunction_
    );
    this.centerListener_ = google.maps.event.addListener(
      this.getMap(),
      "center_changed",
      this.centerFunction_
    );
    this.idleListener_ = google.maps.event.addListener(
      this.getMap(),
      "idle",
      this.idleFunction_
    );
    this.zoomListener_ = google.maps.event.addListener(
      this.getMap(),
      "zoom_changed",
      this.zoomFunction_
    );

    this.resize_();
    this.repositionCanvas_();
  }

  /**
   * @inheritDoc
   */
  onRemove() {
    if (!this.isAdded_) {
      return;
    }

    this.isAdded_ = false;
    this.topLeft_ = null;

    // remove canvas and listeners for pan and resize from map
    this.canvas.parentElement.removeChild(this.canvas);
    if (this.zoomListener_) {
      google.maps.event.removeListener(this.zoomListener_);
      this.zoomListener_ = null;
    }
    if (this.idleListener_) {
      google.maps.event.removeListener(this.idleListener_);
      this.idleListener_ = null;
    }
    if (this.centerListener_) {
      google.maps.event.removeListener(this.centerListener_);
      this.centerListener_ = null;
    }
    if (this.resizeListener_) {
      google.maps.event.removeListener(this.resizeListener_);
      this.resizeListener_ = null;
    }

    // cease canvas update callbacks
    if (this._rafId) {
      window.cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /**
   * The internal callback for resize events that resizes the canvas to keep the
   * map properly covered.
   * @private
   */
  resize_() {
    if (!this.isAdded_) {
      return;
    }

    var map = this.getMap();
    var mapWidth = map.getDiv().offsetWidth;
    var mapHeight = map.getDiv().offsetHeight;

    var newWidth = mapWidth * this.resolutionScale_;
    var newHeight = mapHeight * this.resolutionScale_;
    var oldWidth = this.canvas.width;
    var oldHeight = this.canvas.height;

    // resizing may allocate a new back buffer, so do so conservatively
    if (oldWidth !== newWidth || oldHeight !== newHeight) {
      this.canvas.width = newWidth;
      this.canvas.height = newHeight;

      this.needsResize_ = true;
      this.scheduleUpdate();
    }

    // reset styling if new sizes don't match; resize of data not needed
    if (
      this.canvasCssWidth_ !== mapWidth ||
      this.canvasCssHeight_ !== mapHeight
    ) {
      this.canvasCssWidth_ = mapWidth;
      this.canvasCssHeight_ = mapHeight;
      this.canvas.style.width = mapWidth + "px";
      this.canvas.style.height = mapHeight + "px";
    }
  }

  /**
   * @inheritDoc
   */
  draw() {
    if (this.zooming) {
      this.repositionCanvas_({ counteractDraggable: true });
    }
  }

  idle_() {
    this.zooming = false;
    this.repositionCanvas_({ wipe: true });
  }

  center_() {
    this._prevCenter = this._center;
    this._center = this.getMap().getCenter();
  }

  /**
   * Internal callback for map view changes. Since the Maps API moves the overlay
   * along with the map, this function calculates the opposite translation to
   * keep the canvas in place.
   * @private
   */
  repositionCanvas_(options) {
    // TODO(bckenny): *should* only be executed on RAF, but in current browsers
    //     this causes noticeable hitches in map and overlay relative
    //     positioning.

    var map = this.getMap();

    // topLeft can't be calculated from map.getBounds(), because bounds are
    // clamped to -180 and 180 when completely zoomed out. Instead, calculate
    // left as an offset from the center, which is an unwrapped LatLng.
    var bounds = map.getBounds();
    var top = bounds.getNorthEast().lat();
    var center = (this._center = map.getCenter());
    this._zoom = map.getZoom();
    var scale = Math.pow(2, this._zoom);
    var left = bounds.getSouthWest().lng();
    this.worldViewPixelWidth_ = this.canvasCssWidth_ / scale;
    this.topLeft_ = new google.maps.LatLng(top, left);

    // Canvas position relative to draggable map's container depends on
    // overlayView's projection, not the map's. Have to use the center of the
    // map for this, not the top left, for the same reason as above.
    var projection = this.getProjection();
    var halfW = this.canvasCssWidth_ / 2;
    var halfH = this.canvasCssHeight_ / 2;
    var offsetX = -Math.round(halfW);
    var offsetY = -Math.round(halfH);
    var counteractDraggable = options && options.counteractDraggable;
    if (counteractDraggable) {
      var divCenter = projection.fromLatLngToDivPixel(
        projection.fromContainerPixelToLatLng({
          x: halfW,
          y: halfH
        })
      );
      offsetX -= divCenter.x;
      offsetY -= divCenter.y;
    }
    this.canvas.style[CanvasLayer.CSS_TRANSFORM_] =
      "translate(" + offsetX + "px," + offsetY + "px)";

    var wipe = options && options.wipe;
    if (wipe && this.wipeHandler_) {
      this.wipeHandler_();
    }
    this.scheduleUpdate();
  }

  zoom_() {
    this._prevZoom = this._zoom;
    this._zoom = this.getMap().getZoom();
    this.zooming = true;
    this.repositionCanvas_();
  }

  /**
   * Internal callback that serves as main animation scheduler via
   * requestAnimationFrame. Calls resize and update callbacks if set, and
   * schedules the next frame if overlay is animated.
   * @private
   */
  update_() {
    this._rafId = null;

    if (!this.isAdded_) {
      return;
    }

    if (this.isAnimated_) {
      this.scheduleUpdate();
    }

    if (this.needsResize_ && this.resizeHandler_) {
      this.needsResize_ = false;
      this.resizeHandler_();
    }

    if (this.updateHandler_) {
      this.updateHandler_();
    }
  }

  /**
   * A convenience method to get the current LatLng coordinate of the top left of
   * the current view of the map.
   * @return {google.maps.LatLng} The top left coordinate.
   */
  getTopLeft() {
    return this.topLeft_;
  }

  getWorldViewPixelWidth() {
    return this.worldViewPixelWidth_;
  }

  /**
   * Schedule a requestAnimationFrame callback to updateHandler. If one is
   * already scheduled, there is no effect.
   */
  scheduleUpdate() {
    if (this.isAdded_ && !this._rafId) {
      this._rafId = window.requestAnimationFrame(this.requestUpdateFunction_);
    }
  }
}
