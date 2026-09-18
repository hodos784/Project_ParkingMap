const VWORLD_KEY = "590391A6-092B-4FDF-BF48-0D94CAFB720D";

const map = L.map('map').setView([37.5665, 126.9780], 11);

// --- 배경지도: VWorld 백지도(gray) - 색칠한 구역이 잘 보이도록 무채색 지도 사용 ---
L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/white/{z}/{y}/{x}.png`, {
  attribution: '&copy; VWorld (국토교통부 국토지리정보원)',
  maxZoom: 19
}).addTo(map);

function getColor(v) {
  return v > 300000 ? '#084081' :
         v > 200000 ? '#0868ac' :
         v > 150000 ? '#2b8cbe' :
         v > 100000 ? '#4eb3d3' :
         v > 50000  ? '#7bccc4' :
         v > 20000  ? '#a8ddb5' :
         v > 0      ? '#ccebc5' :
                       '#f0f0f0';
}

let guGeoData = null, dongGeoData = null;
let guLayer, dongLayer, lotLayer;
let currentDongGu = undefined; // 현재 동 레이어가 어느 구 기준으로 그려졌는지 기억

function highlightFeature(e) {
  const layer = e.target;
  layer.setStyle({ weight: 3, color: '#333', fillOpacity: 0.9 });
  layer.bringToFront();
}

// --- 점(위경도)이 폴리곤 안에 있는지 판정 ---
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
      style: f => ({ fillColor: getColor(f.properties.total_spaces || 0), weight: 1.5, color: '#fff', fillOpacity: 0.8 }),
      onEachFeature: (f, layer) => {
        layer.bindPopup(`<b>${f.properties.name}</b><br>총 주차면수: ${(f.properties.total_spaces || 0).toLocaleString()}면`);
        layer.on('mouseover', highlightFeature);
        layer.on('mouseout', e => guLayer.resetStyle(e.target));
        layer.on('click', () => map.fitBounds(layer.getBounds())); // 클릭하면 그 구로 확대
      }
    }).addTo(map);
  });

// --- 동 데이터는 미리 받아만 두고, 필요할 때 구별로 걸러서 그림 ---
fetch('data/dong_parking.geojson')
  .then(r => r.json())
  .then(geo => { dongGeoData = geo; });

function showDongLayerForGu(guName) {
  if (!dongGeoData || guName === currentDongGu) return; // 이미 같은 구 기준이면 다시 안 그림
  if (dongLayer) map.removeLayer(dongLayer);
  const filtered = {
    type: 'FeatureCollection',
    features: guName ? dongGeoData.features.filter(f => f.properties.gu === guName) : dongGeoData.features
  };
  dongLayer = L.geoJSON(filtered, {
    style: f => ({ fillColor: getColor(f.properties.total_spaces || 0), weight: 1, color: '#fff', fillOpacity: 0.75 }),
    onEachFeature: (f, layer) => {
      layer.bindPopup(`<b>${f.properties.gu} ${f.properties.name}</b><br>총 주차면수: ${(f.properties.total_spaces || 0).toLocaleString()}면`);
      layer.on('mouseover', highlightFeature);
      layer.on('mouseout', e => dongLayer.resetStyle(e.target));
    }
  }).addTo(map);
  currentDongGu = guName;
}

// --- 개별 주차장 마커 레이어 ---
fetch('data/parking_lots_seoul.geojson')
  .then(r => r.json())
  .then(geo => {
    lotLayer = L.geoJSON(geo, {
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 6, fillColor: '#e34a33', color: '#fff', weight: 1.5, fillOpacity: 0.9 }),
      onEachFeature: (f, layer) => {
        layer.bindPopup(`<b>${f.properties.name}</b><br>${f.properties.spaces}면<br><small>${f.properties.address || ''}</small>`);
      }
    });
  });

// --- 줌 레벨에 따라 레이어 전환 (클릭 없이 스크롤만으로도 작동) ---
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
    showDongLayerForGu(guHere); // 지금 보고 있는 위치의 구만 자동으로 걸러서 표시
  } else {
    if (dongLayer && map.hasLayer(dongLayer)) map.removeLayer(dongLayer);
    if (lotLayer && map.hasLayer(lotLayer)) map.removeLayer(lotLayer);
    if (guLayer && !map.hasLayer(guLayer)) guLayer.addTo(map);
    currentDongGu = undefined; // 다시 구 단위로 돌아오면 초기화
  }
});

// --- 범례 ---
const legend = L.control({ position: 'bottomright' });
legend.onAdd = function () {
  const div = L.DomUtil.create('div', 'legend');
  const grades = [0, 20000, 50000, 100000, 150000, 200000, 300000];
  div.innerHTML = '<b>총 주차면수</b><br>';
  for (let i = 0; i < grades.length; i++) {
    const from = grades[i], to = grades[i + 1];
    div.innerHTML += `<i style="background:${getColor(from + 1)}"></i> ${from.toLocaleString()}${to ? '&ndash;' + to.toLocaleString() : '+'}<br>`;
  }
  return div;
};
legend.addTo(map);