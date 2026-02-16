"""
Brunswick-specific GIS patterns and collectors
"""
import logging
from typing import Dict, List
import requests
from datetime import datetime
from .gis_formats import GISFormatHandler

class BrunswickGISCollector:
    def __init__(self):
        self.logger = logging.getLogger(self.__class__.__name__)
        self.format_handler = GISFormatHandler()
        
        # Brunswick-specific GIS endpoints
        self.base_url = "https://gis.brunswickme.org/arcgis/rest/services"
        
        # Layer IDs and names
        self.layers = {
            "parcels": {
                "id": "Parcels/MapServer/0",
                "fields": [
                    "OBJECTID", "PARCEL_ID", "ADDRESS", "OWNER_NAME",
                    "LAND_VALUE", "BUILDING_VALUE", "TOTAL_VALUE"
                ]
            },
            "zoning": {
                "id": "Zoning/MapServer/0",
                "fields": [
                    "ZONE_ID", "ZONE_NAME", "DESCRIPTION", "PERMITTED_USES"
                ]
            },
            "flood_zones": {
                "id": "FloodZones/MapServer/0",
                "fields": [
                    "FLD_ZONE", "ZONE_SUBTY", "SFHA_TF", "STATIC_BFE"
                ]
            },
            "utilities": {
                "id": "Utilities/MapServer/0",
                "fields": [
                    "UTILITY_TYPE", "STATUS", "MATERIAL", "INSTALLATION_DATE"
                ]
            },
            "land_use": {
                "id": "LandUse/MapServer/0",
                "fields": [
                    "LU_CODE", "LU_DESC", "OVERLAY_DISTRICT"
                ]
            }
        }
        
    def collect(self, layer_types: List[str] = None) -> Dict:
        """
        Collect GIS data for Brunswick
        
        Args:
            layer_types: Types of layers to collect, or None for all
        """
        try:
            self.logger.info("Collecting Brunswick GIS data")
            
            metadata = {
                'collection_date': datetime.now().isoformat(),
                'layer_types': layer_types
            }
            
            # If no specific types requested, collect all
            if not layer_types:
                layer_types = list(self.layers.keys())
            
            collected_data = {}
            
            for layer_type in layer_types:
                if layer_type not in self.layers:
                    continue
                    
                layer_info = self.layers[layer_type]
                layer_data = self._collect_layer(layer_info)
                
                if layer_data:
                    collected_data[layer_type] = layer_data
            
            return {
                'success': True,
                'data': collected_data,
                'metadata': metadata
            }
            
        except Exception as e:
            self.logger.error(f"Error collecting Brunswick GIS data: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'metadata': metadata
            }
    
    def _collect_layer(self, layer_info: Dict) -> List[Dict]:
        """Collect data for a specific layer"""
        try:
            url = f"{self.base_url}/{layer_info['id']}"
            
            # Build query parameters
            params = {
                'f': 'json',
                'where': '1=1',
                'outFields': ','.join(layer_info['fields']),
                'returnGeometry': 'true',
                'geometryPrecision': 6,
                'outSR': '4326'  # Return in WGS84
            }
            
            # Make request
            response = requests.get(url + "/query", params=params)
            data = response.json()
            
            # Process response
            features = []
            for feature in data.get('features', []):
                processed_feature = self._process_feature(feature, layer_info)
                if processed_feature:
                    features.append(processed_feature)
            
            return features
            
        except Exception as e:
            self.logger.error(f"Error collecting layer: {str(e)}")
            return []
    
    def _process_feature(self, feature: Dict, layer_info: Dict) -> Dict:
        """Process a feature from Brunswick's GIS"""
        try:
            # Extract attributes
            attributes = feature.get('attributes', {})
            
            # Convert field names to our standard format
            properties = self._standardize_fields(attributes, layer_info['fields'])
            
            # Extract geometry
            geometry = feature.get('geometry', {})
            
            return {
                'type': 'Feature',
                'geometry': geometry,
                'properties': properties
            }
            
        except Exception as e:
            self.logger.error(f"Error processing feature: {str(e)}")
            return None
    
    def _standardize_fields(self, attributes: Dict, fields: List[str]) -> Dict:
        """Standardize field names to match our system"""
        try:
            standard_fields = {
                'PARCEL_ID': 'parcel_id',
                'ADDRESS': 'address',
                'OWNER_NAME': 'owner_name',
                'LAND_VALUE': 'land_value',
                'BUILDING_VALUE': 'building_value',
                'TOTAL_VALUE': 'total_value',
                'ZONE_NAME': 'zone_name',
                'PERMITTED_USES': 'permitted_uses',
                'FLD_ZONE': 'flood_zone',
                'STATIC_BFE': 'base_flood_elevation',
                'UTILITY_TYPE': 'utility_type',
                'LU_CODE': 'land_use_code',
                'LU_DESC': 'land_use_description'
            }
            
            result = {}
            for field in fields:
                if field in attributes:
                    standard_name = standard_fields.get(field, field.lower())
                    result[standard_name] = attributes[field]
            
            return result
            
        except Exception as e:
            self.logger.error(f"Error standardizing fields: {str(e)}")
            return {}
