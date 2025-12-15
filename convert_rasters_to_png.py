"""
Convert DLST GeoTIFF rasters to PNG for web display.
Outputs PNG images and a JSON file with WGS84 bounds for Leaflet.
"""

import numpy as np
import rasterio
from rasterio.warp import calculate_default_transform, reproject, Resampling
from PIL import Image
import json
from pathlib import Path


def convert_raster_to_png(input_path: Path, output_dir: Path, year: int):
    """Convert a GeoTIFF to PNG with heat colormap and get WGS84 bounds."""
    
    # First, reproject to WGS84 to get accurate bounds
    with rasterio.open(input_path) as src:
        # Calculate transform for WGS84
        dst_crs = 'EPSG:4326'
        transform, width, height = calculate_default_transform(
            src.crs, dst_crs, src.width, src.height, *src.bounds
        )
        
        # Get the bounds in WGS84
        kwargs = src.meta.copy()
        kwargs.update({
            'crs': dst_crs,
            'transform': transform,
            'width': width,
            'height': height
        })
        
        # Reproject to get WGS84 data
        data_wgs84 = np.zeros((height, width), dtype=np.float32)
        reproject(
            source=rasterio.band(src, 1),
            destination=data_wgs84,
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=transform,
            dst_crs=dst_crs,
            resampling=Resampling.bilinear
        )
        
        # Calculate WGS84 bounds
        # Transform gives us the affine transform, we need to calculate corners
        west = transform.c  # x origin
        north = transform.f  # y origin
        east = west + transform.a * width
        south = north + transform.e * height  # e is negative
        
        bounds = {
            'south': south,
            'west': west,
            'north': north,
            'east': east
        }
        
        print(f"{year} WGS84 bounds: [[{south}, {west}], [{north}, {east}]]")
        
        # Get data statistics (excluding nodata)
        nodata = src.nodata if src.nodata is not None else -9999
        valid_data = data_wgs84[data_wgs84 != nodata]
        valid_data = valid_data[~np.isnan(valid_data)]
        
        if len(valid_data) > 0:
            vmin, vmax = np.percentile(valid_data, [2, 98])
            print(f"{year} Value range: {valid_data.min():.2f} to {valid_data.max():.2f}")
            print(f"{year} Display range (2-98%): {vmin:.2f} to {vmax:.2f}")
        else:
            vmin, vmax = 0, 1
        
        # Create RGBA image with heat colormap
        # Normalize data to 0-1
        normalized = np.clip((data_wgs84 - vmin) / (vmax - vmin), 0, 1)
        
        # Create heat colormap (blue -> yellow -> red for temperature)
        # Using a perceptually good temperature colormap
        rgba = np.zeros((height, width, 4), dtype=np.uint8)
        
        # Heat colormap: cool (blue) to hot (red)
        # Blue (cold) -> Cyan -> Green -> Yellow -> Orange -> Red (hot)
        for i in range(height):
            for j in range(width):
                val = normalized[i, j]
                if data_wgs84[i, j] == nodata or np.isnan(data_wgs84[i, j]):
                    rgba[i, j] = [0, 0, 0, 0]  # Transparent
                else:
                    # Temperature colormap
                    if val < 0.25:
                        # Blue to Cyan
                        t = val / 0.25
                        r, g, b = int(0), int(255 * t), 255
                    elif val < 0.5:
                        # Cyan to Green/Yellow
                        t = (val - 0.25) / 0.25
                        r, g, b = int(255 * t), 255, int(255 * (1 - t))
                    elif val < 0.75:
                        # Yellow to Orange
                        t = (val - 0.5) / 0.25
                        r, g, b = 255, int(255 * (1 - t * 0.35)), 0
                    else:
                        # Orange to Red
                        t = (val - 0.75) / 0.25
                        r, g, b = 255, int(165 * (1 - t)), 0
                    
                    rgba[i, j] = [r, g, b, 200]  # Semi-transparent
        
        # Save PNG
        img = Image.fromarray(rgba, 'RGBA')
        
        # Scale up for better display
        scale = 20
        img_scaled = img.resize((width * scale, height * scale), Image.NEAREST)
        
        output_path = output_dir / f'dlst_{year}.png'
        img_scaled.save(output_path, 'PNG')
        print(f"Saved: {output_path} ({img_scaled.size[0]}x{img_scaled.size[1]})")
        
        return bounds, {'min': float(vmin), 'max': float(vmax)}


def main():
    input_dir = Path(__file__).parent / "cleaned"
    output_dir = Path(__file__).parent / "public"
    output_dir.mkdir(exist_ok=True)
    
    metadata = {}
    
    for year in [2024, 2025]:
        input_path = input_dir / f"DLST_{year}_average.tif"
        print(f"\nProcessing {year}...")
        bounds, stats = convert_raster_to_png(input_path, output_dir, year)
        metadata[str(year)] = {
            'bounds': bounds,
            'stats': stats
        }
    
    # Save metadata JSON
    metadata_path = output_dir / 'dlst_metadata.json'
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"\nSaved metadata: {metadata_path}")
    
    print("\nDone! Files ready for web deployment.")


if __name__ == "__main__":
    main()

