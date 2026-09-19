(function () {
  "use strict";

  var DATA_URL = "data/parking_lots_seoul.geojson";

  var sidebar = document.getElementById("sidebar");
  var menuBtn = document.getElementById("menuBtn");
  menuBtn.addEventListener("click", function () {
    sidebar.classList.toggle("open");
  });

  var map = L.map("map", { zoomControl: false, attributionControl: true }).setView(
    [37.5665, 126.978],
    11
  );
  L.control.zoom({ position: "bottomleft" }).addTo(map);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  }).addTo(map);

  var cluster = L.markerClusterGroup({
    maxClusterRadius: 46,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: function (c) {
      var n = c.getChildCount();
      var size = n < 10 ? 32 : n < 50 ? 40 : 48;
      return L.divIcon({
        html:
          '<div class="pm-cluster" style="width:' +
          size +
          "px;height:" +
          size +
          "px;font-size:" +
          size * 0.34 +
          'px;">' +
          n +
          "</div>",
        className: "",
        iconSize: [size, size],
      });
    },
  });
  map.addLayer(cluster);

  var ALL = []; // flattened records: {n, s, a, t, c, g, d, dt, lat, lng}
  var state = { q: "", cat: "all", type: "all", gu: "all" };

  function fmt(n) {
    return (n || 0).toLocaleString("ko-KR");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }

  function makeIcon(cat) {
    var cls = cat === "민영" ? "private" : "public";
    return L.divIcon({
      className: "",
      html: '<div class="pm-pin ' + cls + '"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 14],
      popupAnchor: [0, -14],
    });
  }

  function popupHtml(p) {
    var badgeCls = p.c === "민영" ? "private" : "public";
    return (
      '<div class="pop-name">' + esc(p.n) + "</div>" +
      '<div class="pop-row">' + esc(p.a || p.g + " " + p.d) + "</div>" +
      '<div class="pop-row">주차면수 · <b>' + fmt(p.s) + "면</b></div>" +
      '<div class="pop-row">' + esc(p.g) + " " + esc(p.d) + " · " + esc(p.t) + "</div>" +
      (p.dt ? '<div class="pop-row" style="opacity:.7">데이터 기준일 ' + esc(p.dt) + "</div>" : "") +
      '<span class="pop-badge ' + badgeCls + '">' + esc(p.c) + "</span>"
    );
  }

  function passes(p) {
    if (state.cat !== "all" && p.c !== state.cat) return false;
    if (state.type !== "all" && p.t !== state.type) return false;
    if (state.gu !== "all" && p.g !== state.gu) return false;
    if (state.q) {
      var hay = (p.n + " " + p.a + " " + p.g + " " + p.d).toLowerCase();
      if (hay.indexOf(state.q.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function render() {
    cluster.clearLayers();
    var listEl = document.getElementById("list");
    listEl.innerHTML = "";
    var count = 0,
      spaces = 0;
    var frag = document.createDocumentFragment();
    var shown = [];

    for (var i = 0; i < ALL.length; i++) {
      var p = ALL[i];
      if (!passes(p)) continue;
      count++;
      spaces += p.s || 0;
      shown.push(p);
    }

    shown.sort(function (a, b) {
      return b.s - a.s;
    });

    var mk = [];
    for (var j = 0; j < shown.length; j++) {
      var p2 = shown[j];
      var m = L.marker([p2.lat, p2.lng], { icon: makeIcon(p2.c) });
      m.bindPopup(popupHtml(p2), { maxWidth: 260 });
      mk.push(m);
    }
    cluster.addLayers(mk);

    document.getElementById("statCount").textContent = fmt(count);
    document.getElementById("statSpaces").textContent = fmt(spaces);
    document.getElementById("listTitle").textContent =
      "목록 · 면수 많은 순 (" + fmt(count) + "건)";

    var top = shown.slice(0, 120);
    if (top.length === 0) {
      var d = document.createElement("div");
      d.className = "empty";
      d.textContent = "조건에 맞는 주차장이 없습니다.";
      frag.appendChild(d);
    }
    top.forEach(function (p3) {
      var b = document.createElement("button");
      b.className = "row";
      b.innerHTML =
        '<span class="rn">' + esc(p3.n) + "</span>" +
        '<span class="rm"><span class="tag' + (p3.c === "민영" ? " priv" : "") + '"></span>' +
        esc(p3.g) + " " + esc(p3.d) + " · " + fmt(p3.s) + "면 · " + esc(p3.t) + "</span>";
      b.addEventListener("click", function () {
        map.setView([p3.lat, p3.lng], 17, { animate: true });
        setTimeout(function () {
          L.popup({ maxWidth: 260 }).setLatLng([p3.lat, p3.lng]).setContent(popupHtml(p3)).openOn(map);
        }, 350);
        if (window.innerWidth <= 760) sidebar.classList.remove("open");
      });
      frag.appendChild(b);
    });
    if (shown.length > 120) {
      var more = document.createElement("div");
      more.className = "empty";
      more.textContent = "+ " + fmt(shown.length - 120) + "건 더 (지도에는 모두 표시됨)";
      frag.appendChild(more);
    }
    listEl.appendChild(frag);
  }

  // GeoJSON FeatureCollection -> flat records
  function flatten(geojson) {
    return (geojson.features || [])
      .filter(function (f) {
        return f.geometry && f.geometry.type === "Point";
      })
      .map(function (f) {
        var p = f.properties || {};
        var coords = f.geometry.coordinates; // [lng, lat]
        return {
          n: p.name,
          s: Number(p.spaces) || 0,
          a: p.address || "",
          t: p.type || "",
          c: p.category || "",
          g: (p.gu || "").replace("(근사)", ""),
          d: (p.dong || "").replace("(근사)", ""),
          dt: p.data_date || "",
          lat: coords[1],
          lng: coords[0],
        };
      });
  }

  function boot(geojson) {
    ALL = flatten(geojson);

    var gus = Array.from(new Set(ALL.map(function (p) { return p.g; })))
      .filter(Boolean)
      .sort(function (a, b) { return a.localeCompare(b, "ko"); });
    var sel = document.getElementById("guSel");
    gus.forEach(function (g) {
      var o = document.createElement("option");
      o.value = g;
      o.textContent = g;
      sel.appendChild(o);
    });

    document.getElementById("q").addEventListener("input", function (e) {
      state.q = e.target.value.trim();
      render();
    });
    document.getElementById("typeSel").addEventListener("change", function (e) {
      state.type = e.target.value;
      render();
    });
    sel.addEventListener("change", function (e) {
      state.gu = e.target.value;
      if (e.target.value === "all") {
        map.setView([37.5665, 126.978], 11);
      }
      render();
    });
    document.querySelectorAll("#catChips .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll("#catChips .chip").forEach(function (c) {
          c.classList.remove("active");
        });
        chip.classList.add("active");
        state.cat = chip.getAttribute("data-cat");
        render();
      });
    });

    render();
  }

  fetch(DATA_URL)
    .then(function (r) { return r.json(); })
    .then(boot)
    .catch(function (err) {
      document.getElementById("list").innerHTML =
        '<div class="empty">데이터를 불러오지 못했습니다.</div>';
      console.error(err);
    });
})();