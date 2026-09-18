const map = L.map('map').setView([37.5665, 126.9780], 11);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

function getColor(v) {
  return v > 300000 ? '#08306b' :
         v > 150000 ? '#2171b5' :
         v > 80000  ? '#6baed6' :
         v > 30000  ? '#bdd7e7' :
                       '#eff3ff';
}

let guLayer, dongLayer, lotLayer;

// --- 구 레이어 ---
fetch('data/gu_parking.geojson')
  .then(r => r.json())
  .then(geo => {
    guLayer = L.geoJSON(geo, {
      style: f => ({
        fillColor: getColor(f.properties.total_spaces || 0),
        weight: 1, color: '#555', fillOpacity: 0.7
      }),
      onEachFeature: (f, layer) => {
        layer.bindPopup(`<b>${f.properties.name}</b><br>총 주차면수: ${(f.properties.total_spaces || 0).toLocaleString()}면`);
        layer.on('click', () => map.fitBounds(layer.getBounds()));
      }
    }).addTo(map);
  });

// --- 동 레이어 (준비만 해두고 확대 시 표시) ---
fetch('data/dong_parking.geojson')
  .then(r => r.json())
  .then(geo => {
    dongLayer = L.geoJSON(geo, {
      style: () => ({ weight: 1, color: '#555', fillOpacity: 0 }),
      onEachFeature: (f, layer) => {
        layer.bindPopup(`<b>${f.properties.gu} ${f.properties.name}</b><br>총 주차면수: ${(f.properties.total_spaces || 0).toLocaleString()}면`);
      }
    });
  });

// --- 개별 주차장 마커 레이어 (준비만 해두고 더 확대 시 표시) ---
fetch('data/parking_lots_seoul.geojson')
  .then(r => r.json())
  .then(geo => {
    lotLayer = L.geoJSON(geo, {
      pointToLayer: (f, latlng) => L.marker(latlng),
      onEachFeature: (f, layer) => {
        layer.bindPopup(`<b>${f.properties.name}</b><br>${f.properties.spaces}면<br><small>${f.properties.address || ''}</small>`);
      }
    });
  });

// --- 줌 레벨에 따라 레이어 전환 ---
map.on('zoomend', () => {
  const zoom = map.getZoom();

  if (zoom >= 16) {
    if (guLayer && map.hasLayer(guLayer)) map.removeLayer(guLayer);
    if (dongLayer && map.hasLayer(dongLayer)) map.removeLayer(dongLayer);
    if (lotLayer && !map.hasLayer(lotLayer)) lotLayer.addTo(map);
  } else if (zoom >= 13) {
    if (guLayer && map.hasLayer(guLayer)) map.removeLayer(guLayer);
    if (lotLayer && map.hasLayer(lotLayer)) map.removeLayer(lotLayer);
    if (dongLayer && !map.hasLayer(dongLayer)) dongLayer.addTo(map);
  } else {
    if (dongLayer && map.hasLayer(dongLayer)) map.removeLayer(dongLayer);
    if (lotLayer && map.hasLayer(lotLayer)) map.removeLayer(lotLayer);
    if (guLayer && !map.hasLayer(guLayer)) guLayer.addTo(map);
  }
});