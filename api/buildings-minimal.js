/**
 * Vercel Serverless Function - Minimal Building Data
 * Returns only essential data for rendering and heatmap calculation
 */

const { parse } = require('csv-parse/sync');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    
    try {
        const blobUrl = process.env.BLOB_CSV_URL;
        
        if (!blobUrl) {
            throw new Error('BLOB_CSV_URL environment variable not set');
        }
        
        console.log('Fetching CSV from Blob Storage...');
        const response = await fetch(blobUrl);
        const data = await response.text();
        
        const records = parse(data, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            relax_column_count: true
        });
        
        console.log(`Parsed ${records.length} records`);
        
        const buildingsMap = new Map();
        
        records.forEach(row => {
            if (!row.building_polygon_wkt || row.building_polygon_wkt.trim() === '') {
                return;
            }
            
            const polygonKey = row.building_polygon_wkt;
            
            if (!buildingsMap.has(polygonKey)) {
                // Store minimal data per building
                const slopeVal = parseFloat(row.slope_factor);
                const southVal = parseFloat(row.south_factor);
                const wwrVal = parseFloat(row.wwr);
                const firstAddr = {
                    energyLabel: row.Energielabel,
                    buildingYear: parseInt(row.Energielabels_Bouwjaar),
                    busyRoad: parseInt(row.busy_roads) === 1,
                    nearGreen: parseInt(row.near_green) === 1,
                    slopeFactor: isNaN(slopeVal) ? null : slopeVal,
                    southFactor: isNaN(southVal) ? null : southVal,
                    wwr: isNaN(wwrVal) ? null : wwrVal,
                    neighborhood: row.neighborhood || 'Unknown',
                    latitude: parseFloat(row.latitude),
                    longitude: parseFloat(row.longitude)
                };
                
                buildingsMap.set(polygonKey, {
                    id: polygonKey.substring(0, 50),
                    polygon: row.building_polygon_wkt,
                    latitude: firstAddr.latitude,
                    longitude: firstAddr.longitude,
                    neighborhood: firstAddr.neighborhood,
                    addressCount: 0,
                    // Aggregate data for heatmap
                    worstEnergyRank: getEnergyRank(firstAddr.energyLabel),
                    oldestYear: firstAddr.buildingYear,
                    onBusyRoad: firstAddr.busyRoad,
                    nearGreen: firstAddr.nearGreen,
                    maxSlopeFactor: firstAddr.slopeFactor,
                    maxSouthFactor: firstAddr.southFactor,
                    maxWwr: firstAddr.wwr,
                    // Track missing data
                    missingEnergy: !firstAddr.energyLabel || firstAddr.energyLabel === '',
                    missingYear: isNaN(firstAddr.buildingYear),
                    missingSlope: firstAddr.slopeFactor === null,
                    missingSouth: firstAddr.southFactor === null,
                    missingWwr: firstAddr.wwr === null
                });
            }
            
            const building = buildingsMap.get(polygonKey);
            building.addressCount++;
            
            // Update aggregates
            const energyRank = getEnergyRank(row.Energielabel);
            if (energyRank < building.worstEnergyRank) {
                building.worstEnergyRank = energyRank;
            }
            // If any address has energy label, building is not missing energy
            if (row.Energielabel && row.Energielabel !== '') {
                building.missingEnergy = false;
            }
            
            const year = parseInt(row.Energielabels_Bouwjaar);
            if (!isNaN(year)) {
                if (year < building.oldestYear || isNaN(building.oldestYear)) {
                    building.oldestYear = year;
                }
                building.missingYear = false;
            }
            
            if (parseInt(row.busy_roads) === 1) {
                building.onBusyRoad = true;
            }
            
            if (parseInt(row.near_green) === 1) {
                building.nearGreen = true;
            }
            
            const slopeFactor = parseFloat(row.slope_factor);
            if (!isNaN(slopeFactor)) {
                if (building.maxSlopeFactor === null || slopeFactor > building.maxSlopeFactor) {
                    building.maxSlopeFactor = slopeFactor;
                }
                building.missingSlope = false;
            }
            
            const southFactor = parseFloat(row.south_factor);
            if (!isNaN(southFactor)) {
                if (building.maxSouthFactor === null || southFactor > building.maxSouthFactor) {
                    building.maxSouthFactor = southFactor;
                }
                building.missingSouth = false;
            }
            
            const wwr = parseFloat(row.wwr);
            if (!isNaN(wwr)) {
                if (building.maxWwr === null || wwr > building.maxWwr) {
                    building.maxWwr = wwr;
                }
                building.missingWwr = false;
            }
        });
        
        const buildings = Array.from(buildingsMap.values());
        console.log(`Returning ${buildings.length} buildings (minimal data)`);
        
        res.status(200).json(buildings);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to process data' });
    }
};

function getEnergyRank(label) {
    const ranking = {
        'A++++': 8, 'A+++': 7, 'A++': 6, 'A+': 5, 'A': 4,
        'B': 3, 'C': 2, 'D': 1, 'E': 0, 'F': -1, 'G': -2
    };
    return ranking[label] ?? 0;
}

