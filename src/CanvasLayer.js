/**
 * Copyright 2012 - 2018 Google Inc. All Rights Reserved.
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
 * @author Brendan Kenny, Naoaki Yamada
 */

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
    this._isAdded = false;

    /**
     * If true, each update will immediately schedule the next.
     * @type {boolean}
     * @private
     */
    this._isAnimated = false;

    /**
     * The name of the MapPane in which this layer will be displayed.
     * @type {string}
     * @private
     */
    this._paneName = CanvasLayer.DEFAULT_PANE_NAME;

    /**
     * A user-supplied function called whenever an update is required. Null or
     * undefined if a callback is not provided.
     * @type {?function=}
     * @private
     */
    this._updateFn = null;

    /**
     * A user-supplied function called whenever an update is required and the
     * map has been resized since the last update. Null or undefined if a
     * callback is not provided.
     * @type {?function}
     * @private
     */
    this._resizeFn = null;

    /**
     * The LatLng coordinate of the top left of the current view of the map. Will
     * be null when this._isAdded is false.
     * @type {google.maps.LatLng}
     * @private
     */
    this._topLeft = null;

    /**
     * The map-pan event listener. Will be null when this._isAdded is false. Will
     * be null when this._isAdded is false.
     * @type {?function}
     * @private
     */
    this._onCenterChangedListener = null;

    /**
     * The map-idle event listener. Will be null when this._isAdded is false. Will
     * be null when this._isAdded is false.
     * @type {?function}
     * @private
     */
    this._onIdleListener = null;

    /**
     * The map-resize event listener. Will be null when this._isAdded is false.
     * @type {?function}
     * @private
     */
    this._onResizeListener = null;

    /**
     * If true, the map size has changed and this._resizeFn must be called
     * on the next update.
     * @type {boolean}
     * @private
     */
    this._needsResize = true;

    /**
     * A browser-defined id for the currently requested callback. Null when no
     * callback is queued.
     * @type {?number}
     * @private
     */
    this._rafId = null;

    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = 0;
    canvas.style.left = 0;
    canvas.style.pointerEvents = 'none';
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
    this._cssWidth = null;

    /**
     * The CSS height of the canvas, which may be different than the height of
     * the backing store.
     * @private {number}
     */
    this._cssHeight = null;

    /**
     * A value for scaling the CanvasLayer resolution relative to the CanvasLayer
     * display size.
     * @private {number}
     */
    this._resolutionScale = 1;

    this._onResize = this._onResize.bind(this);
    this._onCenterChanged = this._onCenterChanged.bind(this);
    this._onZoomChanged = this._onZoomChanged.bind(this);
    this._onIdle = this._onIdle.bind(this);
    this._update = this._update.bind(this);

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
  static get DEFAULT_PANE_NAME() {
    return 'overlayLayer';
  }

  /**
   * Transform CSS property name, with vendor prefix if required. If browser
   * does not support transforms, property will be ignored.
   * @type {string}
   * @const
   * @private
   */
  static get CSS_TRANSFORM() {
    return 'transform';
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
    this._isAnimated = !!animate;
    if (this._isAnimated) {
      this.scheduleUpdate();
    }
  }

  /**
   * @return {boolean} Whether the canvas is animated.
   */
  isAnimated() {
    return this._isAnimated;
  }

  /**
   * Set the MapPane in which this layer will be displayed, by name. See
   * {@code google.maps.MapPanes} for the panes available.
   * @param {string} paneName The name of the desired MapPane.
   */
  setPaneName(paneName) {
    this._paneName = paneName;
    this._setPane();
  }

  /**
   * @return {string} The name of the current container pane.
   */
  getPaneName() {
    return this._paneName;
  }

  /**
   * Adds the canvas to the specified container pane. Since this is guaranteed to
   * execute only after onAdd is called, this is when paneName's existence is
   * checked (and an error is thrown if it doesn't exist).
   * @private
   */
  _setPane() {
    if (!this._isAdded) {
      return;
    }

    // onAdd has been called, so panes can be used
    const panes = this.getPanes();
    if (!panes[this._paneName]) {
      throw new Error('"' + this._paneName + '" is not a valid MapPane name.');
    }

    panes[this._paneName].appendChild(this.canvas);
  }

  /**
   * Set a function that will be called whenever the parent map and the overlay's
   * canvas have been resized. If handler is null or unspecified, any
   * existing callback is removed.
   * @param {?function=} handler The resize callback function.
   */
  setResizeHandler(handler) {
    this._resizeFn = handler;
  }

  /**
   * Sets a value for scaling the canvas resolution relative to the canvas
   * display size. This can be used to save computation by scaling the backing
   * buffer down, or to support high DPI devices by scaling it up (by e.g.
   * window.devicePixelRatio).
   * @param {number} scale
   */
  setResolutionScale(scale) {
    if (typeof scale === 'number') {
      this._resolutionScale = scale;
      this._onResize();
    }
  }

  /**
   * Set a function that will be called when a repaint of the canvas is required.
   * If handler is null or unspecified, any existing callback is
   * removed.
   * @param {?function=} handler The update callback function.
   */
  setUpdateHandler(handler) {
    this._updateFn = handler;
  }

  /**
   * Set a function that will be called when wiping canvas is required.
   * If handler is null or unspecified, any existing callback is
   * removed.
   * @param {?function=} handler The wipe callback function.
   */
  setWipeHandler(handler) {
    this._wipeHandler = handler;
  }

  /**
   * @inheritDoc
   */
  onAdd() {
    if (this._isAdded) {
      return;
    }

    this._isAdded = true;
    this._setPane();

    this._onResizeListener = google.maps.event.addListener(
      this.getMap(),
      'resize',
      this._onResize
    );
    this._onCenterChangedListener = google.maps.event.addListener(
      this.getMap(),
      'center_changed',
      this._onCenterChanged
    );
    this._onZoomChangedListener = google.maps.event.addListener(
      this.getMap(),
      'zoom_changed',
      this._onZoomChanged
    );
    this._onIdleListener = google.maps.event.addListener(
      this.getMap(),
      'idle',
      this._onIdle
    );

    this._onResize();
    this._layoutCanvas();
  }

  /**
   * @inheritDoc
   */
  onRemove() {
    if (!this._isAdded) {
      return;
    }

    this._isAdded = false;
    this._topLeft = null;

    // remove canvas and listeners for pan and resize from map
    this.canvas.parentElement.removeChild(this.canvas);
    if (this._zoomListener) {
      google.maps.event.removeListener(this._zoomListener);
      this._zoomListener = null;
    }
    if (this._idleListener) {
      google.maps.event.removeListener(this._idleListener);
      this._idleListener = null;
    }
    if (this._onCenterChangedListener) {
      google.maps.event.removeListener(this._onCenterChangedListener);
      this._onCenterChangedListener = null;
    }
    if (this._onResizeListener) {
      google.maps.event.removeListener(this._onResizeListener);
      this._onResizeListener = null;
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
  _onResize() {
    if (!this._isAdded) {
      return;
    }

    const map = this.getMap();
    const mapWidth = map.getDiv().offsetWidth;
    const mapHeight = map.getDiv().offsetHeight;

    const newWidth = mapWidth * this._resolutionScale;
    const newHeight = mapHeight * this._resolutionScale;
    const oldWidth = this.canvas.width;
    const oldHeight = this.canvas.height;

    // resizing may allocate a new back buffer, so do so conservatively
    if (oldWidth !== newWidth || oldHeight !== newHeight) {
      this.canvas.width = newWidth;
      this.canvas.height = newHeight;

      this._needsResize = true;
      this.scheduleUpdate();
    }

    // reset styling if new sizes don't match; resize of data not needed
    if (this._cssWidth !== mapWidth || this._cssHeight !== mapHeight) {
      this._cssWidth = mapWidth;
      this._cssHeight = mapHeight;
      this.canvas.style.width = mapWidth + 'px';
      this.canvas.style.height = mapHeight + 'px';
    }
  }

  /**
   * @inheritDoc
   */
  draw() {
    if (this.zooming) {
      this._layoutCanvas({ counteractDraggable: true });
    }
  }

  _onIdle() {
    this.zooming = false;
    this._layoutCanvas({ wipe: true });
  }

  _onCenterChanged() {
    this._prevCenter = this._center;
    this._center = this.getMap().getCenter();
  }

  /**
   * Internal callback for map view changes. Since the Maps API moves the overlay
   * along with the map, this function calculates the opposite translation to
   * keep the canvas in place.
   * @private
   */
  _layoutCanvas(options) {
    // TODO(bckenny): *should* only be executed on RAF, but in current browsers
    //     this causes noticeable hitches in map and overlay relative
    //     positioning.

    const map = this.getMap();

    // topLeft can't be calculated from map.getBounds(), because bounds are
    // clamped to -180 and 180 when completely zoomed out. Instead, calculate
    // left as an offset from the center, which is an unwrapped LatLng.
    const bounds = map.getBounds();
    const top = bounds.getNorthEast().lat();
    const left = bounds.getSouthWest().lng();
    this._zoom = map.getZoom();
    const scale = Math.pow(2, this._zoom);
    this._worldViewPixelWidth = this._cssWidth / scale;
    this._topLeft = new google.maps.LatLng(top, left);

    // Canvas position relative to draggable map's container depends on
    // overlayView's projection, not the map's. Have to use the center of the
    // map for this, not the top left, for the same reason as above.
    const projection = this.getProjection();
    const halfW = this._cssWidth / 2;
    const halfH = this._cssHeight / 2;
    let offsetX = -Math.round(halfW);
    let offsetY = -Math.round(halfH);

    // If draw() is invoked on zooming, counteract draggable container offset.
    const counteractDraggable = options && options.counteractDraggable;
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
    this.canvas.style[CanvasLayer.CSS_TRANSFORM] =
      'translate(' + offsetX + 'px,' + offsetY + 'px)';

    const wipe = options && options.wipe;
    if (wipe && this._wipeHandler) {
      this._wipeHandler();
    }
    this.scheduleUpdate();
  }

  _onZoomChanged() {
    this._prevZoom = this._zoom;
    this._zoom = this.getMap().getZoom();
    this.zooming = true;
    this._layoutCanvas();
  }

  /**
   * Internal callback that serves as main animation scheduler via
   * requestAnimationFrame. Calls resize and update callbacks if set, and
   * schedules the next frame if overlay is animated.
   * @private
   */
  _update() {
    this._rafId = null;
    if (!this._isAdded) {
      return;
    }
    if (this._isAnimated) {
      this.scheduleUpdate();
    }
    if (this._needsResize && this._resizeFn) {
      this._needsResize = false;
      this._resizeFn();
    }
    if (this._updateFn) {
      this._updateFn();
    }
  }

  /**
   * A convenience method to get the current LatLng coordinate of the top left of
   * the current view of the map.
   * @return {google.maps.LatLng} The top left coordinate.
   */
  getTopLeft() {
    return this._topLeft;
  }

  getWorldViewPixelWidth() {
    return this._worldViewPixelWidth;
  }

  /**
   * Schedule a requestAnimationFrame callback to updateHandler. If one is
   * already scheduled, there is no effect.
   */
  scheduleUpdate() {
    if (this._isAdded && !this._rafId) {
      this._rafId = window.requestAnimationFrame(this._update);
    }
  }
}
