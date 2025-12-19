/**
 * Vercel Serverless Function
 * Returns building data from CSV stored in Vercel Blob Storage
 */

const { parse } = require('csv-parse/sync');

module.exports = async (req, res) => {
    // Enable CORS
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
        console.log(`Loaded ${data.length} bytes`);
        
        const records = parse(data, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            relax_column_count: true
        });
        
        console.log(`Parsed ${records.length} records from CSV`);
        
        const buildingsMap = new Map();
        let processedCount = 0;
        let skippedCount = 0;
        
        records.forEach(row => {
            if (!row.building_polygon_wkt || row.building_polygon_wkt.trim() === '') {
                skippedCount++;
                return;
            }
            
            const polygonKey = row.building_polygon_wkt;
            
            if (!buildingsMap.has(polygonKey)) {
                buildingsMap.set(polygonKey, {
                    polygon: row.building_polygon_wkt,
                    addresses: []
                });
            }
            
            const orientationVal = row.orientation;
            buildingsMap.get(polygonKey).addresses.push({
                address: row.full_address,
                energyLabel: row.Energielabel,
                buildingYear: row.Energielabels_Bouwjaar,
                busyRoad: parseInt(row.busy_roads) === 1,
                nearGreen: parseInt(row.near_green) === 1,
                nearTrees: parseInt(row.near_trees) === 1,
                detached: parseInt(row.detached) === 1,
                slopeFactor: row.slope_factor === '' ? null : parseFloat(row.slope_factor),
                southFactor: row.south_factor === '' ? null : parseFloat(row.south_factor),
                wwr: row.wwr === '' ? null : parseFloat(row.wwr),
                orientation: orientationVal === '' ? null : parseInt(orientationVal) === 1,
                neighborhood: row.neighborhood || 'Unknown',
                longitude: parseFloat(row.longitude),
                latitude: parseFloat(row.latitude)
            });
            
            processedCount++;
        });
        
        const buildings = Array.from(buildingsMap.values());
        
        console.log(`Processed ${processedCount} addresses, ${buildings.length} buildings`);
        
        res.status(200).json(buildings);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to process data' });
    }
};

