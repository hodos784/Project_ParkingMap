(function () {
  "use strict";

  var GU_URL = "data/gu_parking.geojson";
  var DONG_URL = "data/dong_parking.geojson";
  var LOTS_URL = "data/parking_lots_seoul.geojson";

  var BIN = 2500;          // 2,500면 단위로 끊어서 색상 진하기 표시
  var MARKER_ZOOM = 15;    // 이 줌 레벨부터 개별 주차장 위치 표시
  var CITY_ZOOM = 12;      // 이 줌 레벨보다 아래로 내려가면 자치구 뷰로 자동 복귀
  var DRILL_ZOOM = 13;     // 스크롤로 이 줌 레벨 이상 확대하면 지도 중심이 속한 구로 자동 드릴다운

  var SEOUL_CENTER = [37.5665, 126.978];
  var SEOUL_ZOOM = 11;

  // ---------- map & base tiles (OpenStreetMap) ----------
  var map = L.map("map", {
    zoomControl: false,
    doubleClickZoom: false, // native dblclick-zoom is replaced by our gu/dong drill-down
    scrollWheelZoom: true,  // mouse-wheel / trackpad scroll zoom
    wheelPxPerZoomLevel: 90, // slightly less twitchy than Leaflet's default 60
  }).setView(SEOUL_CENTER, SEOUL_ZOOM);
  L.control.zoom({ position: "bottomleft" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  // ---------- sequential color ramp: one hue (accent green), light -> dark ----------
  // magnitude is bucketed into BIN(=2,500면) steps before mapping to lightness,
  // so the fill genuinely steps rather than reading as continuous.
  function greenFor(t) {
    t = Math.max(0, Math.min(1, t));
    var s = 22 + t * 40; // 22% -> 62% saturation
    var l = 90 - t * 66; // 90% -> 24% lightness
    return "hsl(165, " + s.toFixed(1) + "%, " + l.toFixed(1) + "%)";
  }

  function binValue(v) {
    return Math.floor((v || 0) / BIN) * BIN;
  }

  // builds a color-getter scaled to the min/max *within the given feature set*
  function makeScale(features, propGetter) {
    var bins = features
      .map(function (f) {
        var v = propGetter(f);
        return v == null ? null : binValue(v);
      })
      .filter(function (v) {
        return v != null;
      });
    var min = bins.length ? Math.min.apply(null, bins) : 0;
    var max = bins.length ? Math.max.apply(null, bins) : BIN;
    if (max === min) max = min + BIN;
    return {
      min: min,
      max: max,
      color: function (v) {
        if (v == null) return "#cccccc";
        var b = binValue(v);
        var t = (b - min) / (max - min);
        return greenFor(t);
      },
    };
  }

  // ---------- point-in-polygon (used to figure out which gu the map center is over
  // when the user zooms in with the scroll wheel instead of double-clicking) ----------
  function rayCast(pt, ring) {
    var x = pt[0], y = pt[1];
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1];
      var xj = ring[j][0], yj = ring[j][1];
      var intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function polyContains(pt, rings) {
    if (!rayCast(pt, rings[0])) return false;
    for (var k = 1; k < rings.length; k++) {
      if (rayCast(pt, rings[k])) return false; // inside a hole
    }
    return true;
  }

  function pointInFeature(pt, geometry) {
    if (!geometry) return false;
    if (geometry.type === "Polygon") return polyContains(pt, geometry.coordinates);
    if (geometry.type === "MultiPolygon") {
      return geometry.coordinates.some(function (rings) {
        return polyContains(pt, rings);
      });
    }
    return false;
  }

  function guAtLngLat(lng, lat) {
    for (var i = 0; i < guFeatures.length; i++) {
      if (pointInFeature([lng, lat], guFeatures[i].geometry)) return guFeatures[i];
    }
    return null;
  }

  function fmt(n) {
    return (n || 0).toLocaleString("ko-KR");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }

  // ---------- HUD ----------
  var hudTitle = document.getElementById("hudTitle");
  var hudSpaces = document.getElementById("hudSpaces");
  var hudSpacesLbl = document.getElementById("hudSpacesLbl");
  var backBtn = document.getElementById("backBtn");
  var hint = document.getElementById("hint");
  var legendTitle = document.getElementById("legendTitle");
  var rampEl = document.getElementById("ramp");
  var rampMin = document.getElementById("rampMin");
  var rampMax = document.getElementById("rampMax");

  function setHud(title, spaces, label) {
    hudTitle.textContent = title;
    hudSpaces.textContent = spaces == null ? "–" : fmt(spaces) + "면";
    hudSpacesLbl.textContent = label;
  }

  function setLegend(title, scale) {
    legendTitle.textContent = title;
    rampEl.style.background =
      "linear-gradient(to right, " + greenFor(0) + ", " + greenFor(1) + ")";
    rampMin.textContent = fmt(scale.min) + "면";
    rampMax.textContent = fmt(scale.max) + "면+";
  }

  // ---------- click vs. double-click (map's own dblclick zoom is disabled above) ----------
  function bindClickAndDblClick(layer, onClick, onDblClick) {
    var t = null;
    layer.on("click", function (e) {
      if (t) return; // this click is part of a dblclick sequence already scheduled
      t = setTimeout(function () {
        t = null;
        onClick(e);
      }, 260);
    });
    layer.on("dblclick", function (e) {
      if (t) {
        clearTimeout(t);
        t = null;
      }
      L.DomEvent.stopPropagation(e);
      onDblClick(e);
    });
  }

  // ---------- state ----------
  var mode = "city"; // "city" | "gu"
  var currentGu = null;
  var guLayer = null;
  var dongLayer = null;
  var lotsCluster = null;
  var guFeatures = [];
  var dongFeatures = [];
  var lotFeatures = [];
  var citySpacesTotal = 0;
  var guScale = null;

  function guName(f) {
    return f.properties.name;
  }
  function guSpaces(f) {
    return f.properties.total_spaces;
  }
  function dongName(f) {
    return f.properties.name;
  }
  function dongSpaces(f) {
    return f.properties.total_spaces;
  }

  // ---------- gu (city-wide) layer ----------
  function buildGuLayer() {
    guScale = makeScale(guFeatures, guSpaces);
    guLayer = L.geoJSON(
      { type: "FeatureCollection", features: guFeatures },
      {
        className: "gu-outline",
        style: function (f) {
          return {
            className: "gu-outline",
            color: "#ffffff",
            weight: 1.4,
            fillColor: guScale.color(guSpaces(f)),
            fillOpacity: 0.88,
          };
        },
        onEachFeature: function (f, layer) {
          layer.on("mouseover", function () {
            layer.setStyle({ weight: 2.4 });
          });
          layer.on("mouseout", function () {
            layer.setStyle({ weight: 1.4 });
          });
          bindClickAndDblClick(
            layer,
            function (e) {
              L.popup({ maxWidth: 220 })
                .setLatLng(e.latlng)
                .setContent(
                  '<div class="pop-name">' + esc(guName(f)) + "</div>" +
                    '<div class="pop-row">주차 가능면수 · <b>' + fmt(guSpaces(f)) + "면</b></div>"
                )
                .openOn(map);
            },
            function () {
              drillIntoGu(f);
            }
          );
        },
      }
    ).addTo(map);
  }

  function showCity() {
    mode = "city";
    currentGu = null;
    if (dongLayer) {
      map.removeLayer(dongLayer);
      dongLayer = null;
    }
    if (guLayer) map.addLayer(guLayer);
    backBtn.hidden = true;
    hint.textContent = "행정구를 클릭하면 면수가 표시됩니다 · 더블클릭하면 동별로 확대됩니다";
    setHud("서울 전체", citySpacesTotal, "총 주차가능면수 (25개 자치구)");
    setLegend("자치구별 주차면수", guScale);
    map.setView(SEOUL_CENTER, SEOUL_ZOOM);
  }

  // opts.fly (default true): fit the view to the gu's dong bounds. Pass false when
  // the switch was caused by the user panning (they've already framed the view
  // themselves — forcing a flyTo would fight the drag).
  function drillIntoGu(f, opts) {
    var fly = !opts || opts.fly !== false;
    mode = "gu";
    currentGu = guName(f);
    if (guLayer) map.removeLayer(guLayer);
    if (dongLayer) {
      map.removeLayer(dongLayer);
      dongLayer = null;
    }

    var subset = dongFeatures.filter(function (d) {
      return d.properties.gu === currentGu;
    });
    var dScale = makeScale(subset, dongSpaces);

    dongLayer = L.geoJSON(
      { type: "FeatureCollection", features: subset },
      {
        style: function (d) {
          return {
            color: "#ffffff",
            weight: 1,
            fillColor: dScale.color(dongSpaces(d)),
            fillOpacity: 0.88,
          };
        },
        onEachFeature: function (d, layer) {
          layer.on("mouseover", function () {
            layer.setStyle({ weight: 2 });
          });
          layer.on("mouseout", function () {
            layer.setStyle({ weight: 1 });
          });
          bindClickAndDblClick(
            layer,
            function (e) {
              L.popup({ maxWidth: 220 })
                .setLatLng(e.latlng)
                .setContent(
                  '<div class="pop-name">' + esc(dongName(d)) + "</div>" +
                    '<div class="pop-row">' + esc(currentGu) + "</div>" +
                    '<div class="pop-row">주차 가능면수 · <b>' + fmt(dongSpaces(d)) + "면</b></div>"
                )
                .openOn(map);
            },
            function () {
              map.flyToBounds(layer.getBounds(), { maxZoom: MARKER_ZOOM + 1, duration: 0.6 });
            }
          );
        },
      }
    ).addTo(map);

    backBtn.hidden = false;
    hint.textContent = "동을 클릭하면 면수가 표시됩니다 · 더 확대하면 개별 주차장이 표시됩니다";
    setHud(currentGu, guSpaces(f), "총 주차가능면수 (" + subset.length + "개 동)");
    setLegend(currentGu + " 동별 주차면수", dScale);

    if (fly && dongLayer.getBounds().isValid()) {
      map.flyToBounds(dongLayer.getBounds(), { padding: [24, 24], duration: 0.6 });
    }
  }

  backBtn.addEventListener("click", showCity);

  // ---------- individual parking lots (shown once zoomed in) ----------
  function buildLotsLayer() {
    lotsCluster = L.markerClusterGroup({
      maxClusterRadius: 40,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: function (c) {
        var n = c.getChildCount();
        var size = n < 10 ? 30 : 38;
        return L.divIcon({
          html:
            '<div class="pm-cluster" style="width:' + size + "px;height:" + size +
            "px;font-size:" + size * 0.36 + 'px;">' + n + "</div>",
          className: "",
          iconSize: [size, size],
        });
      },
    });

    lotFeatures.forEach(function (f) {
      var p = f.properties || {};
      var coords = f.geometry.coordinates; // [lng, lat]
      var cat = p.category === "민영" ? "private" : "public";
      var icon = L.divIcon({
        className: "",
        html: '<div class="pm-pin ' + cat + '"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 14],
        popupAnchor: [0, -14],
      });
      var m = L.marker([coords[1], coords[0]], { icon: icon });
      var badgeCls = cat === "private" ? "private" : "public";
      m.bindPopup(
        '<div class="pop-name">' + esc(p.name) + "</div>" +
          '<div class="pop-row">' + esc(p.address || (p.gu + " " + p.dong)) + "</div>" +
          '<div class="pop-row">주차면수 · <b>' + fmt(p.spaces) + "면</b></div>" +
          '<div class="pop-row">' + esc(p.gu) + " " + esc(p.dong) + " · " + esc(p.type) + "</div>" +
          '<span class="pop-badge ' + badgeCls + '">' + esc(p.category) + "</span>",
        { maxWidth: 260 }
      );
      lotsCluster.addLayer(m);
    });
  }

  function updateLotsVisibility() {
    var shouldShow = map.getZoom() >= MARKER_ZOOM;
    var isShown = map.hasLayer(lotsCluster);
    if (shouldShow && !isShown) map.addLayer(lotsCluster);
    if (!shouldShow && isShown) map.removeLayer(lotsCluster);
  }

  map.on("zoomend", function () {
    updateLotsVisibility();
    if (mode === "gu" && map.getZoom() < CITY_ZOOM) {
      showCity();
      return;
    }
    // scroll-zoom (or pinch) past DRILL_ZOOM while still on the city view: drill into
    // whichever gu the map is now centered on, same as a double-click would.
    if (mode === "city" && map.getZoom() >= DRILL_ZOOM) {
      var c = map.getCenter();
      var f = guAtLngLat(c.lng, c.lat);
      if (f) drillIntoGu(f);
    }
  });

  // dragging while a gu's dongs are on screen: if the pan carries the map center
  // into a different gu, swap the dong set shown to match (without fighting the
  // user's own drag by re-flying the view).
  map.on("moveend", function () {
    if (mode !== "gu") return;
    var c = map.getCenter();
    var f = guAtLngLat(c.lng, c.lat);
    if (f && guName(f) !== currentGu) {
      drillIntoGu(f, { fly: false });
    }
  });

  // ---------- boot ----------
  Promise.all([
    fetch(GU_URL).then(function (r) { return r.json(); }),
    fetch(DONG_URL).then(function (r) { return r.json(); }),
    fetch(LOTS_URL).then(function (r) { return r.json(); }),
  ])
    .then(function (results) {
      guFeatures = results[0].features || [];
      dongFeatures = results[1].features || [];
      lotFeatures = (results[2].features || []).filter(function (f) {
        return f.geometry && f.geometry.type === "Point";
      });

      citySpacesTotal = guFeatures.reduce(function (sum, f) {
        return sum + (guSpaces(f) || 0);
      }, 0);

      buildGuLayer();
      buildLotsLayer();
      showCity();
      updateLotsVisibility();
    })
    .catch(function (err) {
      hint.textContent = "데이터를 불러오지 못했습니다.";
      console.error(err);
    });
})();