"""
Collector for GIS and interactive map data
"""
import logging
import sys
from datetime import datetime
from typing import Dict, List, Optional, Any
from pathlib import Path
import requests
import json
import os

from .base_collector import BaseCollector

# Check for GIS dependencies
GEOPANDAS_AVAILABLE = False
try:
    import geopandas as gpd
    from shapely.geometry import Point, Polygon
    GEOPANDAS_AVAILABLE = True
except ImportError:
    logging.warning("GIS dependencies not available. Install with: pip install -r requirements-gis.txt")

# Try to import database service, but don't fail if not available
try:
    from ..services.db_service import DatabaseService
    DB_SERVICE_AVAILABLE = True
except ImportError:
    DB_SERVICE_AVAILABLE = False
    logging.warning("Database service not available")

class GISCollector(BaseCollector):
    def __init__(self):
        super().__init__()
        # Track dependency status
        self.gis_dependencies_available = GEOPANDAS_AVAILABLE
        
        # Set up database service if available
        if DB_SERVICE_AVAILABLE:
            self.db_service = DatabaseService()
        
        # Set up paths
        self.raw_data_path = Path(__file__).parent.parent.parent / 'data' / 'raw_files' / 'gis'
        self.raw_data_path.mkdir(parents=True, exist_ok=True)
        
        # Sample data path
        self.sample_data_path = Path(__file__).parent.parent.parent / 'data' / 'sample_data' / 'gis'
        
        # Log dependency status
        if not self.gis_dependencies_available:
            self.logger.warning(
                "GIS dependencies not available. Using sample data mode. "
                "Install dependencies with: pip install -r requirements-gis.txt"
            )
        
    def collect(self, town: str, layer_types: List[str] = None) -> Dict:
        """
        Collect GIS data from interactive maps
        
        Args:
            town: Name of town
            layer_types: Types of layers to collect (zoning, parcels, etc.)
        """
        try:
            self.logger.info(f"Collecting GIS data for {town}")
            
            geo_metadata = {
                'town': town,
                'collection_date': datetime.now().isoformat(),
                'layer_types': layer_types,
                'using_sample_data': not self.gis_dependencies_available
            }
            
            # If GIS dependencies aren't available, return sample data
            if not self.gis_dependencies_available:
                return self._get_sample_data(town)
            
            # Collect different types of GIS data
            parcel_data = self._collect_parcel_data(town)
            zoning_data = self._collect_zoning_data(town)
            flood_data = self._collect_flood_data(town)
            
            # Combine all GIS data
            gis_data = {
                'parcels': parcel_data,
                'zoning': zoning_data,
                'flood_zones': flood_data
            }
            
            # Save raw data
            self._save_raw_data(town, gis_data)
            
            return {
                'success': True,
                'data': gis_data,
                'metadata': geo_metadata
            }
            
        except Exception as e:
            self.logger.error(f"Error collecting GIS data: {str(e)}")
            # Return sample data if there was an error
            if not geo_metadata.get('using_sample_data'):
                self.logger.info("Falling back to sample data due to error")
                return self._get_sample_data(town)
            return {
                'success': False,
                'error': str(e),
                'metadata': geo_metadata
            }
    
    def _get_sample_data(self, town: str) -> Dict[str, Any]:
        """
        Get sample GIS data when dependencies are not available or errors occur
        
        Args:
            town: Name of town
            
        Returns:
            Dictionary with sample GIS data
        """
        self.logger.info(f"Using sample GIS data for {town}")
        
        # Try to load town-specific sample data
        sample_file = self.sample_data_path / f"{town.lower()}_gis_sample.json"
        
        # If town-specific sample doesn't exist, use generic sample
        if not sample_file.exists():
            sample_file = self.sample_data_path / "generic_gis_sample.json"
        
        # If no sample files exist, return generated sample data
        if not sample_file.exists():
            return self._generate_sample_data(town)
        
        # Load sample data from file
        try:
            with open(sample_file, 'r') as f:
                sample_data = json.load(f)
                
            self.logger.info(f"Loaded sample data from {sample_file}")
            
            # Add metadata
            sample_data['metadata'] = {
                'town': town,
                'collection_date': datetime.now().isoformat(),
                'using_sample_data': True,
                'sample_source': str(sample_file)
            }
            
            return sample_data
            
        except Exception as e:
            self.logger.error(f"Error loading sample data: {str(e)}")
            return self._generate_sample_data(town)
    
    def _generate_sample_data(self, town: str) -> Dict[str, Any]:
        """Generate sample GIS data programmatically"""
        self.logger.info(f"Generating sample GIS data for {town}")
        
        # Create generic sample data with basic structure
        sample_data = {
            'success': True,
            'data': {
                'parcels': [
                    {
                        'properties': {
                            'PARCEL_ID': f"{town[:2].upper()}001",
                            'OWNER': 'SAMPLE OWNER',
                            'ADDRESS': '123 MAIN ST',
                            'ACRES': 1.5,
                            'ZONING': 'RESIDENTIAL'
                        },
                        'geometry_type': 'Polygon',
                        'coordinates': [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]
                    },
                    {
                        'properties': {
                            'PARCEL_ID': f"{town[:2].upper()}002",
                            'OWNER': 'EXAMPLE CORP',
                            'ADDRESS': '456 OAK AVE',
                            'ACRES': 2.8,
                            'ZONING': 'COMMERCIAL'
                        },
                        'geometry_type': 'Polygon',
                        'coordinates': [[[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]]]
                    }
                ],
                'zoning': [
                    {
                        'properties': {
                            'ZONE_ID': 'R1',
                            'ZONE_DESC': 'Residential Low Density',
                            'MIN_LOT_SIZE': '20000 sq ft'
                        },
                        'geometry_type': 'Polygon',
                        'coordinates': [[[0, 0], [0, 5], [5, 5], [5, 0], [0, 0]]]
                    }
                ],
                'flood_zones': [
                    {
                        'properties': {
                            'ZONE_ID': 'AE',
                            'FLOOD_ELEV': '15 ft',
                            'RISK_LEVEL': 'High'
                        },
                        'geometry_type': 'Polygon',
                        'coordinates': [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]
                    }
                ]
            },
            'metadata': {
                'town': town,
                'collection_date': datetime.now().isoformat(),
                'using_sample_data': True,
                'sample_source': 'programmatically_generated'
            }
        }
        
        # Create sample data directory if it doesn't exist
        self.sample_data_path.mkdir(parents=True, exist_ok=True)
        
        # Save the generated sample for future use
        try:
            sample_file = self.sample_data_path / f"{town.lower()}_gis_sample.json"
            with open(sample_file, 'w') as f:
                json.dump(sample_data, f, indent=2)
            self.logger.info(f"Saved generated sample data to {sample_file}")
        except Exception as e:
            self.logger.warning(f"Could not save generated sample data: {str(e)}")
        
        return sample_data
    
    def _save_raw_data(self, town: str, data: Dict) -> None:
        """Save raw GIS data to file"""
        try:
            output_file = self.raw_data_path / f"{town.lower()}_gis_data.json"
            with open(output_file, 'w') as f:
                json.dump(data, f, indent=2)
            self.logger.info(f"Saved raw GIS data to {output_file}")
        except Exception as e:
            self.logger.error(f"Error saving raw GIS data: {str(e)}")
    
    def _collect_parcel_data(self, town: str) -> List[Dict]:
        """Collect parcel boundary and attribute data"""
        try:
            # Check dependencies
            if not self.gis_dependencies_available:
                self.logger.warning("Cannot collect parcel data without GIS dependencies")
                return []
                
            # Handle different GIS systems
            if self._is_arcgis(town):
                return self._collect_from_arcgis(town, 'parcels')
            elif self._is_qgis(town):
                return self._collect_from_qgis(town, 'parcels')
            else:
                return self._collect_from_generic_gis(town, 'parcels')
        except Exception as e:
            self.logger.error(f"Error collecting parcel data: {str(e)}")
            return []
    
    def _collect_zoning_data(self, town: str) -> List[Dict]:
        """Collect zoning boundaries and regulations"""
        try:
            # Check dependencies
            if not self.gis_dependencies_available:
                self.logger.warning("Cannot collect zoning data without GIS dependencies")
                return []
                
            if self._is_arcgis(town):
                return self._collect_from_arcgis(town, 'zoning')
            elif self._is_qgis(town):
                return self._collect_from_qgis(town, 'zoning')
            else:
                return self._collect_from_generic_gis(town, 'zoning')
        except Exception as e:
            self.logger.error(f"Error collecting zoning data: {str(e)}")
            return []
    
    def _collect_flood_data(self, town: str) -> List[Dict]:
        """Collect flood zone boundaries"""
        try:
            # Check dependencies
            if not self.gis_dependencies_available:
                self.logger.warning("Cannot collect flood data without GIS dependencies")
                return []
                
            if self._is_arcgis(town):
                return self._collect_from_arcgis(town, 'flood')
            elif self._is_qgis(town):
                return self._collect_from_qgis(town, 'flood')
            else:
                return self._collect_from_generic_gis(town, 'flood')
        except Exception as e:
            self.logger.error(f"Error collecting flood data: {str(e)}")
            return []
    
    def _is_arcgis(self, town: str) -> bool:
        """Check if town uses ArcGIS"""
        # Will check URL patterns and API endpoints
        return False
    
    def _is_qgis(self, town: str) -> bool:
        """Check if town uses QGIS"""
        # Will check URL patterns and API endpoints
        return False
    
    def _collect_from_arcgis(self, town: str, layer_type: str) -> List[Dict]:
        """Collect data from ArcGIS server"""
        try:
            # Example ArcGIS REST API call
            # Will implement actual API calls based on town's endpoints
            api_url = f"https://{town}.maps.arcgis.com/rest/services/{layer_type}/MapServer"
            
            # Get layer info
            response = requests.get(f"{api_url}?f=json")
            layer_info = response.json()
            
            # Get features
            features_url = f"{api_url}/0/query"
            params = {
                'where': '1=1',
                'outFields': '*',
                'returnGeometry': 'true',
                'f': 'geojson'
            }
            
            response = requests.get(features_url, params=params)
            features = response.json()
            
            return self._process_geojson(features)
            
        except Exception as e:
            self.logger.error(f"Error collecting from ArcGIS: {str(e)}")
            return []
    
    def _collect_from_qgis(self, town: str, layer_type: str) -> List[Dict]:
        """Collect data from QGIS server"""
        try:
            # Example QGIS Server WFS request
            # Will implement actual WFS calls based on town's endpoints
            api_url = f"https://{town}.maps.qgis.com/wfs"
            
            params = {
                'SERVICE': 'WFS',
                'VERSION': '2.0.0',
                'REQUEST': 'GetFeature',
                'TYPENAME': layer_type,
                'OUTPUTFORMAT': 'application/json'
            }
            
            response = requests.get(api_url, params=params)
            features = response.json()
            
            return self._process_geojson(features)
            
        except Exception as e:
            self.logger.error(f"Error collecting from QGIS: {str(e)}")
            return []
    
    def _collect_from_generic_gis(self, town: str, layer_type: str) -> List[Dict]:
        """Collect data from other GIS servers"""
        try:
            # Will implement based on specific GIS system
            return []
        except Exception as e:
            self.logger.error(f"Error collecting from generic GIS: {str(e)}")
            return []
    
    def _process_geojson(self, geojson_data: Dict) -> List[Dict]:
        """Process GeoJSON data into structured format"""
        try:
            results = []
            
            for feature in geojson_data.get('features', []):
                # Extract properties
                properties = feature.get('properties', {})
                
                # Extract geometry
                geometry = feature.get('geometry', {})
                
                # Combine into result
                result = {
                    'properties': properties,
                    'geometry_type': geometry.get('type'),
                    'coordinates': geometry.get('coordinates'),
                }
                
                results.append(result)
            
            return results
            
        except Exception as e:
            self.logger.error(f"Error processing GeoJSON: {str(e)}")
            return []
