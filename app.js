/**
 * OPEN HEAT AMSTERDAM
 * Interactive building heat readiness visualization
 * 
 * An open-source, open-data project by:
 * - AMS Institute
 * - Gemeente Amsterdam  
 * - MADE Living Lab (WUR)
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    BOUNDS: {
        southwest: [52.2784, 4.7283],
        northeast: [52.4311, 5.0641]
    },
    CENTER: [52.3676, 4.9041],
    DEFAULT_ZOOM: 13,
    MIN_ZOOM: 13,
    MAX_ZOOM: 20,
    MIN_LOAD_TIME: 1000,
    ENERGY_RANKING: {
        'A++++': 8, 'A+++': 7, 'A++': 6, 'A+': 5, 'A': 4,
        'B': 3, 'C': 2, 'D': 1, 'E': 0, 'F': -1, 'G': -2
    },
    DLST_BOUNDS: [
        [52.24607426809743, 4.685825351769769],
        [52.462172688706374, 5.1180221929876595]
    ]
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const state = {
    // Map
    map: null,
    buildingsData: [],
    buildingLayers: [],
    buildingLayerGroup: null,
    
    // Selection
    selectedBuilding: null,
    currentHighlightedLayer: null,
    
    // Heatmap
    heatmapEnabled: false,
    energyOperator: '<=',
    energyValue: 'C',
    energyWeight: 0.25,
    yearOperator: '<=',
    yearValue: 1900,
    yearWeight: 0.25,
    busyRoadWeight: 0.25,
    slopeWeight: 0.25,
    
    // Regional overlay
    regionalHeatmapEnabled: false,
    regionalHeatmapLayer: null,
    
    // DLST overlay
    dlstOverlays: {},
    activeDlstYear: null
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', initMap);

function initMap() {
    state.map = L.map('map', {
        maxBounds: [CONFIG.BOUNDS.southwest, CONFIG.BOUNDS.northeast],
        maxBoundsViscosity: 1.0,
        minZoom: CONFIG.MIN_ZOOM,
        maxZoom: CONFIG.MAX_ZOOM,
        preferCanvas: true,
        renderer: L.canvas({ tolerance: 5 }),
        zoomControl: false
    }).setView(CONFIG.CENTER, CONFIG.DEFAULT_ZOOM);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(state.map);
    
    state.buildingLayerGroup = L.layerGroup().addTo(state.map);
    
    setupPanel();
    setupSearch();
    loadBuildings();
}

// ============================================================================
// DATA LOADING
// ============================================================================

async function loadBuildings() {
    const startTime = Date.now();
    createPixelText();
    
    try {
        const response = await fetch('/api/buildings-minimal');
        state.buildingsData = await response.json();
        
        console.log(`Loaded ${state.buildingsData.length} buildings`);
        renderBuildings();
        
        const elapsed = Date.now() - startTime;
        setTimeout(() => {
            document.getElementById('loading').classList.add('hidden');
        }, Math.max(0, CONFIG.MIN_LOAD_TIME - elapsed));
        
    } catch (error) {
        console.error('Error loading buildings:', error);
        setTimeout(() => {
            document.getElementById('loading').innerHTML = 
                '<div style="color: #CD5C5C; text-align: center;"><h2>Error</h2><p>Please refresh</p></div>';
        }, CONFIG.MIN_LOAD_TIME);
    }
}

// ============================================================================
// BUILDING RENDERING
// ============================================================================

function renderBuildings() {
    state.buildingsData.forEach((building) => {
        try {
            const geoJSON = wktToGeoJSON(building.polygon);
            if (!geoJSON) return;
            
            const polygon = L.geoJSON(geoJSON, {
                style: getDefaultStyle(),
                onEachFeature: (_, layer) => setupBuildingEvents(layer, building)
            });
            
            polygon.addTo(state.buildingLayerGroup);
            state.buildingLayers.push({ building, layer: polygon });
        } catch (error) {
            console.error('Error rendering building:', error);
        }
    });
    
    console.log(`Rendered ${state.buildingLayers.length} buildings`);
}

function getDefaultStyle() {
    return { fillColor: '#ff0000', fillOpacity: 0.6, color: '#cc0000', weight: 2 };
}

function setupBuildingEvents(layer, building) {
    layer.bindTooltip(`${building.addressCount} address(es) - Click for details`, { sticky: true });
    layer.on('mouseover', () => handleHover(layer, true));
    layer.on('mouseout', () => handleHover(layer, false));
    layer.on('click', (e) => selectBuilding(building, layer, e.latlng));
    layer.buildingData = building;
}

function handleHover(layer, isHovering) {
    if (state.currentHighlightedLayer === layer) return;
    
    if (isHovering) {
        layer.setStyle({ fillColor: '#ffff00', fillOpacity: 0.9, color: '#ff6600', weight: 4 });
        layer.bringToFront();
    } else {
        const building = layer.buildingData;
        layer.setStyle(state.heatmapEnabled && building ? getHeatmapStyle(building) : getDefaultStyle());
    }
}

// ============================================================================
// BUILDING SELECTION & DETAILS
// ============================================================================

async function selectBuilding(building, layer, latlng) {
    state.selectedBuilding = building;
    
    // Reset previous highlight
    if (state.currentHighlightedLayer && state.currentHighlightedLayer !== layer) {
        const prev = state.currentHighlightedLayer.buildingData;
        state.currentHighlightedLayer.setStyle(
            state.heatmapEnabled && prev ? getHeatmapStyle(prev) : getDefaultStyle()
        );
    }
    
    // Highlight selected
    layer.setStyle({ fillColor: '#0066ff', fillOpacity: 0.7, color: '#0044cc', weight: 3 });
    state.currentHighlightedLayer = layer;
    
    state.map.setView(latlng, 18, { animate: true, duration: 0.5 });
    showBuildingView();
    await loadBuildingDetails(building);
}

async function loadBuildingDetails(building) {
    const content = document.getElementById('building-content');
    content.innerHTML = '<div style="color: #FFD700; text-align: center; padding: 40px;">Loading...</div>';
    
    try {
        const response = await fetch(`/api/building-details?polygon=${encodeURIComponent(building.polygon)}`);
        building.addresses = await response.json();
        renderBuildingInfo(building);
    } catch (error) {
        console.error('Error loading details:', error);
        content.innerHTML = '<div style="color: #CD5C5C; text-align: center; padding: 40px;">Error loading details</div>';
    }
}

function renderBuildingInfo(building) {
    const content = document.getElementById('building-content');
    const worstLabel = getEnergyLabelFromRank(building.worstEnergyRank);
    
    let html = `
        <div class="building-info">
            <div class="building-summary">
                <h3>Overview</h3>
                <div class="summary-stat"><strong>Addresses</strong><span>${building.addresses.length}</span></div>
                ${state.heatmapEnabled ? `
                    <div class="summary-stat"><strong>Worst Label</strong><span>${worstLabel}</span></div>
                    <div class="summary-stat"><strong>Oldest</strong><span>${building.oldestYear}</span></div>
                    <div class="summary-stat"><strong>Busy Road</strong><span>${building.onBusyRoad ? 'Yes' : 'No'}</span></div>
                ` : ''}
            </div>
            <div class="addresses-list">
                ${building.addresses.map(addr => `
                    <div class="address-card">
                        <div class="address-title">${addr.address}</div>
                        <div class="address-detail"><span class="label">Energy Label</span><span class="value">${addr.energyLabel}</span></div>
                        <div class="address-detail"><span class="label">Building Year</span><span class="value">${addr.buildingYear}</span></div>
                        <div class="address-detail"><span class="label">Busy Road</span><span class="value">${addr.busyRoad ? 'Yes' : 'No'}</span></div>
                    </div>
                `).join('')}
            </div>
        </div>`;
    
    content.innerHTML = html;
}

function getEnergyLabelFromRank(rank) {
    const labels = { 8: 'A++++', 7: 'A+++', 6: 'A++', 5: 'A+', 4: 'A', 3: 'B', 2: 'C', 1: 'D', 0: 'E', '-1': 'F', '-2': 'G' };
    return labels[rank] || 'Unknown';
}

// ============================================================================
// PANEL MANAGEMENT
// ============================================================================

function setupPanel() {
    const els = {
        energyOperator: document.getElementById('energy-operator'),
        energyValue: document.getElementById('energy-value'),
        energyWeight: document.getElementById('energy-weight'),
        energyWeightValue: document.getElementById('energy-weight-value'),
        yearOperator: document.getElementById('year-operator'),
        yearValue: document.getElementById('year-value'),
        yearWeight: document.getElementById('year-weight'),
        yearWeightValue: document.getElementById('year-weight-value'),
        busyRoadWeight: document.getElementById('busy-road-weight'),
        busyRoadWeightValue: document.getElementById('busy-road-weight-value'),
        slopeWeight: document.getElementById('slope-weight'),
        slopeWeightValue: document.getElementById('slope-weight-value'),
        totalWeight: document.getElementById('total-weight'),
        warning: document.getElementById('weight-warning'),
        applyBtn: document.getElementById('apply-heatmap'),
        backBtn: document.getElementById('back-to-heatmap')
    };
    
    const updateWeights = () => {
        state.energyOperator = els.energyOperator.value;
        state.energyValue = els.energyValue.value;
        state.energyWeight = parseFloat(els.energyWeight.value);
        state.yearOperator = els.yearOperator.value;
        state.yearValue = parseInt(els.yearValue.value);
        state.yearWeight = parseFloat(els.yearWeight.value);
        state.busyRoadWeight = parseFloat(els.busyRoadWeight.value);
        state.slopeWeight = parseFloat(els.slopeWeight.value);
        
        els.energyWeightValue.textContent = state.energyWeight.toFixed(2);
        els.yearWeightValue.textContent = state.yearWeight.toFixed(2);
        els.busyRoadWeightValue.textContent = state.busyRoadWeight.toFixed(2);
        els.slopeWeightValue.textContent = state.slopeWeight.toFixed(2);
        
        const total = state.energyWeight + state.yearWeight + state.busyRoadWeight + state.slopeWeight;
        els.totalWeight.textContent = total.toFixed(2);
        els.warning.classList.toggle('hidden', total <= 1.0);
        els.applyBtn.disabled = total > 1.0;
    };
    
    ['energyOperator', 'energyValue', 'yearOperator'].forEach(id => 
        els[id].addEventListener('change', updateWeights));
    ['energyWeight', 'yearValue', 'yearWeight', 'busyRoadWeight', 'slopeWeight'].forEach(id => 
        els[id].addEventListener('input', updateWeights));
    
    els.applyBtn.addEventListener('click', applyHeatmap);
    els.backBtn.addEventListener('click', showHeatmapView);
    
    setupOverlayControls();
}

function showHeatmapView() {
    document.getElementById('heatmap-view').classList.remove('hidden');
    document.getElementById('building-view').classList.add('hidden');
    document.getElementById('panel-title').textContent = 'Configuration';
    document.getElementById('back-to-heatmap').classList.add('hidden');
}

function showBuildingView() {
    document.getElementById('heatmap-view').classList.add('hidden');
    document.getElementById('building-view').classList.remove('hidden');
    document.getElementById('panel-title').textContent = 'Details';
    document.getElementById('back-to-heatmap').classList.remove('hidden');
}

// ============================================================================
// HEATMAP
// ============================================================================

function applyHeatmap() {
    state.heatmapEnabled = true;
    state.buildingLayers.forEach(({ building, layer }) => layer.setStyle(getHeatmapStyle(building)));
    
    console.log(`Heatmap applied: Energy ${state.energyOperator} ${state.energyValue}, Year ${state.yearOperator} ${state.yearValue}`);
    
    if (state.regionalHeatmapEnabled && state.regionalHeatmapLayer) {
        state.map.removeLayer(state.regionalHeatmapLayer);
        state.regionalHeatmapLayer = null;
        createRegionalHeatmap();
    }
}

function getHeatmapStyle(building) {
    const score = calculateBuildingScore(building);
    const color = getHeatColor(score);
    return { fillColor: color, fillOpacity: 0.7, color: darkenColor(color, 0.3), weight: 2 };
}

function calculateBuildingScore(building) {
    const energyScore = matchesEnergyCriteria(building) ? 1.0 : 0.0;
    const yearScore = matchesYearCriteria(building) ? 1.0 : 0.0;
    const busyRoadScore = building.onBusyRoad ? 1.0 : 0.0;
    const slopeScore = building.maxSlopeFactor || 0.5; // Already 0-1 range
    
    return (energyScore * state.energyWeight) + 
           (yearScore * state.yearWeight) + 
           (busyRoadScore * state.busyRoadWeight) +
           (slopeScore * state.slopeWeight);
}

function matchesEnergyCriteria(building) {
    const buildingRank = building.worstEnergyRank;
    const thresholdRank = CONFIG.ENERGY_RANKING[state.energyValue] ?? 0;
    return state.energyOperator === '<=' ? buildingRank <= thresholdRank : buildingRank >= thresholdRank;
}

function matchesYearCriteria(building) {
    return state.yearOperator === '<=' ? building.oldestYear <= state.yearValue : building.oldestYear >= state.yearValue;
}

function getHeatColor(score) {
    return `rgb(255, ${Math.round(255 * (1 - score))}, 0)`;
}

function darkenColor(color, factor) {
    const match = color.match(/\d+/g);
    if (!match) return color;
    return `rgb(${Math.round(match[0] * (1 - factor))}, ${Math.round(match[1] * (1 - factor))}, ${Math.round(match[2] * (1 - factor))})`;
}

// ============================================================================
// OVERLAY CONTROLS
// ============================================================================

function setupOverlayControls() {
    // Regional heatmap
    document.getElementById('regional-heatmap-btn')?.addEventListener('click', toggleRegionalHeatmap);
    document.getElementById('regional-opacity')?.addEventListener('input', (e) => {
        const opacity = parseFloat(e.target.value);
        document.getElementById('regional-opacity-value').textContent = `${Math.round(opacity * 100)}%`;
        if (state.regionalHeatmapLayer) state.regionalHeatmapLayer.setStyle({ fillOpacity: opacity });
    });
    
    // DLST
    document.getElementById('dlst-2024-btn')?.addEventListener('click', () => toggleDlstOverlay(2024));
    document.getElementById('dlst-2025-btn')?.addEventListener('click', () => toggleDlstOverlay(2025));
    document.getElementById('dlst-opacity')?.addEventListener('input', (e) => {
        const opacity = parseFloat(e.target.value);
        document.getElementById('dlst-opacity-value').textContent = `${Math.round(opacity * 100)}%`;
        if (state.activeDlstYear && state.dlstOverlays[state.activeDlstYear]) {
            state.dlstOverlays[state.activeDlstYear].setOpacity(opacity);
        }
    });
}

// ============================================================================
// REGIONAL HEATMAP
// ============================================================================

function toggleRegionalHeatmap() {
    const btn = document.getElementById('regional-heatmap-btn');
    const container = document.getElementById('regional-opacity-container');
    
    if (state.regionalHeatmapEnabled) {
        if (state.regionalHeatmapLayer) state.map.removeLayer(state.regionalHeatmapLayer);
        state.regionalHeatmapLayer = null;
        state.regionalHeatmapEnabled = false;
        btn.classList.remove('active');
        container.classList.add('hidden');
    } else {
        createRegionalHeatmap();
    }
}

async function createRegionalHeatmap() {
    const btn = document.getElementById('regional-heatmap-btn');
    const container = document.getElementById('regional-opacity-container');
    
    if (!state.heatmapEnabled) {
        alert('Please apply building heatmap weights first');
        return;
    }
    
    if (!neighborhoodsGeoJSON) {
        await loadNeighborhoodsGeoJSON();
        if (!neighborhoodsGeoJSON) {
            alert('Failed to load neighborhood boundaries');
            return;
        }
    }
    
    const scores = calculateNeighborhoodScores();
    const opacity = parseFloat(document.getElementById('regional-opacity').value);
    
    state.regionalHeatmapLayer = L.geoJSON(neighborhoodsGeoJSON, {
        style: (feature) => getRegionalStyle(feature, scores, opacity),
        onEachFeature: (feature, layer) => bindRegionalPopup(feature, layer, scores)
    }).addTo(state.map);
    
    state.regionalHeatmapEnabled = true;
    btn.classList.add('active');
    container.classList.remove('hidden');
}

function calculateNeighborhoodScores() {
    const scores = new Map();
    
    neighborhoodsGeoJSON.features.forEach(feature => {
        const bounds = L.geoJSON(feature).getBounds();
        const buildings = state.buildingLayers.filter(({ building }) => 
            building.latitude >= bounds.getSouth() && building.latitude <= bounds.getNorth() &&
            building.longitude >= bounds.getWest() && building.longitude <= bounds.getEast()
        );
        
        if (buildings.length > 0) {
            const buildingScores = buildings.map(({ building }) => calculateBuildingScore(building));
            const meanScore = buildingScores.reduce((a, b) => a + b, 0) / buildingScores.length;
            scores.set(feature.properties.Buurtcode, { 
                score: meanScore, 
                count: buildings.length, 
                name: feature.properties.Buurtnaam 
            });
        }
    });
    
    return scores;
}

function getRegionalStyle(feature, scores, opacity) {
    const data = scores.get(feature.properties.Buurtcode);
    if (data) {
        return { fillColor: getHeatColor(data.score), fillOpacity: opacity, color: '#333', weight: 2 };
    }
    return { fillColor: '#e0e0e0', fillOpacity: opacity * 0.4, color: '#999', weight: 1 };
}

function bindRegionalPopup(feature, layer, scores) {
    const data = scores.get(feature.properties.Buurtcode);
    const name = feature.properties.Buurtnaam;
    
    layer.bindPopup(data
        ? `<div style="font-family: Courier New; padding: 10px;">
            <strong style="color: #FFD700;">${name}</strong><br>
            <span style="color: #666;">Score:</span> <strong style="color: #FF8C00;">${data.score.toFixed(3)}</strong><br>
            <span style="color: #666;">Buildings:</span> <strong style="color: #FF8C00;">${data.count}</strong>
           </div>`
        : `<div style="font-family: Courier New; padding: 10px;">
            <strong style="color: #999;">${name}</strong><br>
            <span style="color: #666;">No data</span>
           </div>`
    );
}

// ============================================================================
// DLST (LAND SURFACE TEMPERATURE) OVERLAY
// ============================================================================

function toggleDlstOverlay(year) {
    const btn = document.getElementById(`dlst-${year}-btn`);
    const container = document.getElementById('dlst-opacity-container');
    
    if (state.activeDlstYear === year) {
        removeDlstOverlay(year);
        state.activeDlstYear = null;
        btn.classList.remove('active');
        container.classList.add('hidden');
        return;
    }
    
    if (state.activeDlstYear !== null) {
        removeDlstOverlay(state.activeDlstYear);
        document.getElementById(`dlst-${state.activeDlstYear}-btn`).classList.remove('active');
    }
    
    addDlstOverlay(year);
    state.activeDlstYear = year;
    btn.classList.add('active');
    container.classList.remove('hidden');
}

function addDlstOverlay(year) {
    const opacity = parseFloat(document.getElementById('dlst-opacity').value);
    
    if (state.dlstOverlays[year]) {
        state.dlstOverlays[year].setOpacity(opacity);
        state.dlstOverlays[year].addTo(state.map);
        state.dlstOverlays[year].bringToFront();
        return;
    }
    
    const overlay = L.imageOverlay(`/dlst_${year}.png`, CONFIG.DLST_BOUNDS, {
        opacity, interactive: false, zIndex: 650
    });
    
    overlay.addTo(state.map);
    overlay.bringToFront();
    state.dlstOverlays[year] = overlay;
}

function removeDlstOverlay(year) {
    if (state.dlstOverlays[year]) state.map.removeLayer(state.dlstOverlays[year]);
}

// ============================================================================
// SEARCH
// ============================================================================

function setupSearch() {
    const input = document.getElementById('address-search');
    const results = document.getElementById('search-results');
    let timeout;
    
    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(timeout);
        
        if (query.length < 3) {
            results.classList.add('hidden');
            return;
        }
        
        timeout = setTimeout(() => performSearch(query, results), 300);
    });
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) results.classList.add('hidden');
    });
}

async function performSearch(query, container) {
    const queryLower = query.toLowerCase();
    const matches = [];
    
    // Client-side search
    state.buildingLayers.forEach(({ building, layer }) => {
        if (building.neighborhood?.toLowerCase().includes(queryLower)) {
            matches.push({
                building, layer,
                address: `${building.neighborhood} (${building.addressCount} addresses)`,
                neighborhood: building.neighborhood
            });
        }
    });
    
    if (matches.length >= 10) {
        renderSearchResults(matches.slice(0, 10), container);
        return;
    }
    
    // Server-side search
    try {
        const response = await fetch(`/api/search-addresses?q=${encodeURIComponent(query)}`);
        const results = await response.json();
        
        results.forEach(result => {
            const found = state.buildingLayers.find(({ building }) => building.polygon === result.polygon);
            if (found && !matches.find(m => m.building === found.building)) {
                matches.push({ ...found, address: result.address, neighborhood: result.neighborhood });
            }
        });
    } catch (error) {
        console.error('Search error:', error);
    }
    
    renderSearchResults(matches.slice(0, 10), container);
}

function renderSearchResults(matches, container) {
    if (matches.length === 0) {
        container.innerHTML = '<div class="search-result-item" style="color: #666;">No results found</div>';
        container.classList.remove('hidden');
        return;
    }
    
    container.innerHTML = matches.map(({ building, address, neighborhood }) => `
        <div class="search-result-item" data-id="${building.polygon.substring(0, 50)}">
            <div class="search-result-address">${address || `Building (${building.addressCount} addresses)`}</div>
            <div class="search-result-meta">${neighborhood || building.neighborhood || ''}</div>
        </div>
    `).join('');
    
    container.classList.remove('hidden');
    
    container.querySelectorAll('.search-result-item').forEach((item, i) => {
        item.addEventListener('click', () => {
            const { building, layer } = matches[i];
            selectBuilding(building, layer, L.latLng(building.latitude, building.longitude));
            container.classList.add('hidden');
            document.getElementById('address-search').value = '';
        });
    });
}

// ============================================================================
// WKT PARSING
// ============================================================================

function wktToGeoJSON(wkt) {
    try {
        if (wkt.startsWith('MULTIPOLYGON')) {
            return { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: parseMultiPolygon(wkt) }, properties: {} };
        }
        if (wkt.startsWith('POLYGON')) {
            return { type: 'Feature', geometry: { type: 'Polygon', coordinates: parsePolygon(wkt) }, properties: {} };
        }
        return null;
    } catch (error) {
        console.error('WKT parse error:', error);
        return null;
    }
}

function parseMultiPolygon(wkt) {
    const str = wkt.replace('MULTIPOLYGON (((', '').replace(')))', '').trim();
    return [str.split(')),((').map(ring => parseCoords(ring))];
}

function parsePolygon(wkt) {
    const str = wkt.replace('POLYGON ((', '').replace('))', '').trim();
    return str.split('),(').map(ring => parseCoords(ring));
}

function parseCoords(str) {
    return str.split(',').map(coord => {
        const [lon, lat] = coord.trim().split(' ');
        return [parseFloat(lon), parseFloat(lat)];
    });
}

// ============================================================================
// LOADING SCREEN
// ============================================================================

const PIXEL_PATTERNS = {
    'O': [[1,1,1],[1,0,1],[1,0,1],[1,0,1],[1,1,1]],
    'P': [[1,1,1],[1,0,1],[1,1,1],[1,0,0],[1,0,0]],
    'E': [[1,1,1],[1,0,0],[1,1,1],[1,0,0],[1,1,1]],
    'N': [[1,0,1],[1,1,1],[1,1,1],[1,0,1],[1,0,1]],
    'H': [[1,0,1],[1,0,1],[1,1,1],[1,0,1],[1,0,1]],
    'A': [[0,1,0],[1,0,1],[1,1,1],[1,0,1],[1,0,1]],
    'T': [[1,1,1],[0,1,0],[0,1,0],[0,1,0],[0,1,0]],
    'M': [[1,0,1],[1,1,1],[1,1,1],[1,0,1],[1,0,1]],
    'S': [[1,1,1],[1,0,0],[1,1,1],[0,0,1],[1,1,1]],
    'R': [[1,1,0],[1,0,1],[1,1,0],[1,0,1],[1,0,1]],
    'D': [[1,1,0],[1,0,1],[1,0,1],[1,0,1],[1,1,0]],
    ' ': [[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]]
};

function createPixelText() {
    const container = document.querySelector('.grid-text');
    const lines = ["OPEN HEAT", "AMSTERDAM"];
    const grid = [];
    let maxCols = 0;
    
    lines.forEach((line, lineIdx) => {
        const startRow = lineIdx * 6;
        let col = 0;
        
        for (const char of line) {
            const pattern = PIXEL_PATTERNS[char] || PIXEL_PATTERNS[' '];
            for (let row = 0; row < 5; row++) {
                if (!grid[startRow + row]) grid[startRow + row] = [];
                for (let c = 0; c < pattern[0].length; c++) {
                    grid[startRow + row][col + c] = pattern[row][c];
                }
            }
            col += pattern[0].length + 1;
        }
        maxCols = Math.max(maxCols, col);
    });
    
    const pixels = [];
    for (let row = 0; row < lines.length * 6; row++) {
        for (let col = 0; col < maxCols; col++) {
            const pixel = document.createElement('div');
            pixel.className = 'grid-pixel' + (grid[row]?.[col] === 1 ? ' active' : '');
            pixels.push(pixel);
        }
    }
    
    container.style.gridTemplateColumns = `repeat(${maxCols}, 12px)`;
    container.style.gridTemplateRows = `repeat(${lines.length * 6}, 12px)`;
    pixels.forEach(p => container.appendChild(p));
}
