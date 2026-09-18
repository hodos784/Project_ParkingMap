const VWORLD_KEY = "590391A6-092B-4FDF-BF48-0D94CAFB720D";

const map = L.map('map').setView([37.5665, 126.9780], 11);

// --- 배경지도: VWorld 백지도 ---
L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/white/{z}/{y}/{x}.png`, {
  attribution: '&copy; VWorld (국토교통부 국토지리정보원)',
  maxZoom: 19
}).addTo(map);

// --- 구 색상: 큰 단위(2만~30만+) ---
function getGuColor(v) {
  return v > 300000 ? '#084081' :
         v > 200000 ? '#0868ac' :
         v > 150000 ? '#2b8cbe' :
         v > 100000 ? '#4eb3d3' :
         v > 50000  ? '#7bccc4' :
         v > 20000  ? '#a8ddb5' :
         v > 0      ? '#ccebc5' :
                       '#f0f0f0';
}
const GU_GRADES = [0, 20000, 50000, 100000, 150000, 200000, 300000];

// --- 동/개별 주차장 색상: 2,500 단위로 촘촘하게 ---
const DONG_PALETTE = ['#f7fbff','#deebf7','#c6dbef','#9ecae1','#6baed6','#4292c6','#2171b5','#08519c','#08306b','#041e42'];
const DONG_STEP = 2500;
function getDongColor(v) {
  if (v == null) return '#f0f0f0';
  const idx = Math.min(Math.floor(v / DONG_STEP), DONG_PALETTE.length - 1);
  return DONG_PALETTE[idx];
}

let guGeoData = null, dongGeoData = null;
let guLayer, dongLayer, lotLayer;
let currentDongGu = undefined;

function highlightFeature(e) {
  const layer = e.target;
  layer.setStyle({ weight: 3, color: '#333', fillOpacity: 0.9 });
  layer.bringToFront();
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function pointInGeometry(point, geometry) {
  if (geometry.type === 'Polygon') return pointInRing(point, geometry.coordinates[0]);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(poly => pointInRing(point, poly[0]));
  return false;
}
function findGuAtLatLng(lat, lng) {
  if (!guGeoData) return null;
  const f = guGeoData.features.find(f => pointInGeometry([lng, lat], f.geometry));
  return f ? f.properties.name : null;
}

// --- 구 레이어 ---
fetch('data/gu_parking.geojson')
  .then(r => r.json())
  .then(geo => {
    guGeoData = geo;
    guLayer = L.geoJSON(geo, {
      style: f => ({ fillColor: getGuColor(f.properties.total_spaces || 0), weight: 1.5, color: '#fff', fillOpacity: 0.8 }),
      onEachFeature: (f, layer) => {
        layer.bindPopup(`<b>${f.properties.name}</b><br>총 주차면수: ${(f.properties.total_spaces || 0).toLocaleString()}면`);
        layer.on('mouseover', highlightFeature);
        layer.on('mouseout', e => guLayer.resetStyle(e.target));
        layer.on('click', () => map.fitBounds(layer.getBounds()));
      }
    }).addTo(map);
  });

fetch('data/dong_parking.geojson')
  .then(r => r.json())
  .then(geo => { dongGeoData = geo; });

function showDongLayerForGu(guName) {
  if (!dongGeoData || guName === currentDongGu) return;
  if (dongLayer) map.removeLayer(dongLayer);
  const filtered = {
    type: 'FeatureCollection',
    features: guName ? dongGeoData.features.filter(f => f.properties.gu === guName) : dongGeoData.features
  };
  dongLayer = L.geoJSON(filtered, {
    style: f => ({ fillColor: getDongColor(f.properties.total_spaces), weight: 1, color: '#fff', fillOpacity: 0.75 }),
    onEachFeature: (f, layer) => {
      layer.bindPopup(`<b>${f.properties.gu} ${f.properties.name}</b><br>총 주차면수: ${(f.properties.total_spaces || 0).toLocaleString()}면`);
      layer.on('mouseover', highlightFeature);
      layer.on('mouseout', e => dongLayer.resetStyle(e.target));
    }
  }).addTo(map);
  currentDongGu = guName;
}

// --- 개별 주차장 마커: P 아이콘 + 클러스터링 ---
const parkingIcon = L.divIcon({
  className: 'parking-marker',
  html: '<div class="parking-pin">P</div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  popupAnchor: [0, -13]
});

fetch('data/parking_lots_seoul.geojson')
  .then(r => r.json())
  .then(geo => {
    lotLayer = L.markerClusterGroup({ maxClusterRadius: 50 });
    const points = L.geoJSON(geo, {
      pointToLayer: (f, latlng) => L.marker(latlng, { icon: parkingIcon }),
      onEachFeature: (f, layer) => {
        layer.bindPopup(`<b>${f.properties.name}</b><br>${f.properties.spaces}면<br><small>${f.properties.address || ''}</small>`);
      }
    });
    lotLayer.addLayer(points);
  });

// --- 범례 ---
const legend = L.control({ position: 'bottomright' });
legend.onAdd = function () {
  this._div = L.DomUtil.create('div', 'legend');
  return this._div;
};
legend.addTo(map);

function updateLegend(mode) {
  const div = legend._div;
  if (mode === 'gu') {
    let html = '<b>총 주차면수 (구)</b><br>';
    for (let i = 0; i < GU_GRADES.length; i++) {
      const from = GU_GRADES[i], to = GU_GRADES[i + 1];
      html += `<i style="background:${getGuColor(from + 1)}"></i> ${from.toLocaleString()}${to ? '&ndash;' + to.toLocaleString() : '+'}<br>`;
    }
    div.innerHTML = html;
  } else {
    let html = '<b>총 주차면수 (동, 2,500 단위)</b><br>';
    for (let i = 0; i < DONG_PALETTE.length; i++) {
      const from = i * DONG_STEP;
      const isLast = i === DONG_PALETTE.length - 1;
      html += `<i style="background:${DONG_PALETTE[i]}"></i> ${from.toLocaleString()}${isLast ? '+' : '&ndash;' + (from + DONG_STEP - 1).toLocaleString()}<br>`;
    }
    div.innerHTML = html;
  }
}
updateLegend('gu');

// --- 줌 레벨에 따라 레이어 전환 ---
map.on('zoomend moveend', () => {
  const zoom = map.getZoom();
  const center = map.getCenter();

  if (zoom >= 16) {
    if (guLayer && map.hasLayer(guLayer)) map.removeLayer(guLayer);
    if (dongLayer && map.hasLayer(dongLayer)) map.removeLayer(dongLayer);
    if (lotLayer && !map.hasLayer(lotLayer)) lotLayer.addTo(map);
  } else if (zoom >= 13) {
    if (guLayer && map.hasLayer(guLayer)) map.removeLayer(guLayer);
    if (lotLayer && map.hasLayer(lotLayer)) map.removeLayer(lotLayer);
    const guHere = findGuAtLatLng(center.lat, center.lng);
    showDongLayerForGu(guHere);
    updateLegend('dong');
  } else {
    if (dongLayer && map.hasLayer(dongLayer)) map.removeLayer(dongLayer);
    if (lotLayer && map.hasLayer(lotLayer)) map.removeLayer(lotLayer);
    if (guLayer && !map.hasLayer(guLayer)) guLayer.addTo(map);
    currentDongGu = undefined;
    updateLegend('gu');
  }
});