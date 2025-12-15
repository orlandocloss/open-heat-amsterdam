"""
Average DLST raster data by year (2024 and 2025)
Creates one averaged raster per year from monthly data.
"""

import numpy as np
import rasterio
from pathlib import Path

def average_rasters_by_year(input_dir: Path, output_dir: Path, year: int):
    """Average all rasters for a given year into a single output raster."""
    
    # Find all files for this year
    pattern = f"DLST_{year}_*_RD_clean.tif"
    files = sorted(input_dir.glob(pattern))
    
    if not files:
        print(f"No files found for year {year}")
        return
    
    print(f"Found {len(files)} files for {year}:")
    for f in files:
        print(f"  - {f.name}")
    
    # Read all rasters and stack them
    arrays = []
    profile = None
    
    for filepath in files:
        with rasterio.open(filepath) as src:
            if profile is None:
                profile = src.profile.copy()
            arrays.append(src.read(1))  # Read first band
    
    # Stack arrays and compute mean, ignoring nodata values
    stacked = np.stack(arrays, axis=0).astype(np.float32)
    
    # Get nodata value from profile
    nodata = profile.get('nodata', -9999)
    
    # Replace nodata with NaN for proper averaging
    stacked = np.where(stacked == nodata, np.nan, stacked)
    
    # Also handle any existing NaN values
    # Calculate mean across the stack (axis 0), ignoring NaN values
    with np.errstate(all='ignore'):  # Suppress warnings for all-NaN slices
        averaged = np.nanmean(stacked, axis=0)
    
    # Count how many valid values contributed to each pixel
    valid_counts = np.sum(~np.isnan(stacked), axis=0)
    print(f"  Pixel coverage: min={valid_counts.min()}, max={valid_counts.max()} months")
    
    # Keep NaN as the nodata value for output
    nodata = np.nan
    
    # Update profile for output
    profile.update(dtype=rasterio.float32, nodata=np.nan)
    
    # Write output
    output_path = output_dir / f"DLST_{year}_average.tif"
    with rasterio.open(output_path, 'w', **profile) as dst:
        dst.write(averaged.astype(np.float32), 1)
    
    print(f"Created: {output_path}")
    return output_path


def main():
    input_dir = Path(__file__).parent / "cleaned"
    output_dir = input_dir  # Save in same directory
    
    print("Averaging DLST rasters by year...\n")
    
    for year in [2024, 2025]:
        average_rasters_by_year(input_dir, output_dir, year)
        print()
    
    print("Done!")


if __name__ == "__main__":
    main()

