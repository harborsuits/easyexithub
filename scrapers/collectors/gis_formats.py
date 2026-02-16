"""
Additional GIS format handlers
"""
import logging
from typing import Dict, List
import geopandas as gpd
import requests
import zipfile
import io
from pathlib import Path
import xml.etree.ElementTree as ET
import fiona
import rasterio
from shapely.geometry import shape, mapping

class GISFormatHandler:
    def __init__(self):
        self.logger = logging.getLogger(self.__class__.__name__)
        
    def handle_mapserver(self, url: str, layer_id: str) -> List[Dict]:
        """Handle MapServer format"""
        try:
            # MapServer REST endpoint
            params = {
                'f': 'json',
                'where': '1=1',
                'outFields': '*',
                'returnGeometry': 'true'
            }
            
            response = requests.get(f"{url}/{layer_id}/query", params=params)
            data = response.json()
            
            return self._convert_to_standard_format(data, 'mapserver')
            
        except Exception as e:
            self.logger.error(f"Error handling MapServer: {str(e)}")
            return []

    def handle_geoserver(self, url: str, layer_name: str) -> List[Dict]:
        """Handle GeoServer WFS"""
        try:
            params = {
                'service': 'WFS',
                'version': '2.0.0',
                'request': 'GetFeature',
                'typeName': layer_name,
                'outputFormat': 'application/json'
            }
            
            response = requests.get(url, params=params)
            data = response.json()
            
            return self._convert_to_standard_format(data, 'geoserver')
            
        except Exception as e:
            self.logger.error(f"Error handling GeoServer: {str(e)}")
            return []

    def handle_osm(self, bbox: tuple) -> List[Dict]:
        """Handle OpenStreetMap data"""
        try:
            # Use Overpass API
            overpass_url = "http://overpass-api.de/api/interpreter"
            
            # Create query for buildings and properties
            query = f"""
                [out:json][timeout:25];
                (
                    way["building"]({bbox[1]},{bbox[0]},{bbox[3]},{bbox[2]});
                    relation["building"]({bbox[1]},{bbox[0]},{bbox[3]},{bbox[2]});
                );
                out body;
                >;
                out skel qt;
            """
            
            response = requests.post(overpass_url, data=query)
            data = response.json()
            
            return self._convert_to_standard_format(data, 'osm')
            
        except Exception as e:
            self.logger.error(f"Error handling OSM: {str(e)}")
            return []

    def handle_kml(self, kml_content: str) -> List[Dict]:
        """Handle KML/KMZ format"""
        try:
            # Parse KML
            root = ET.fromstring(kml_content)
            
            # Find all placemarks
            placemarks = root.findall(".//{http://www.opengis.net/kml/2.2}Placemark")
            
            features = []
            for placemark in placemarks:
                feature = self._parse_kml_placemark(placemark)
                if feature:
                    features.append(feature)
            
            return features
            
        except Exception as e:
            self.logger.error(f"Error handling KML: {str(e)}")
            return []

    def handle_shapefile(self, file_path: str) -> List[Dict]:
        """Handle Shapefile format"""
        try:
            # Read shapefile using geopandas
            gdf = gpd.read_file(file_path)
            
            # Convert to GeoJSON
            geojson = gdf.to_json()
            
            return self._convert_to_standard_format(geojson, 'shapefile')
            
        except Exception as e:
            self.logger.error(f"Error handling Shapefile: {str(e)}")
            return []

    def _convert_to_standard_format(self, data: Dict, source_type: str) -> List[Dict]:
        """Convert various formats to standard format"""
        try:
            features = []
            
            if source_type == 'mapserver':
                for feature in data.get('features', []):
                    features.append({
                        'geometry': feature.get('geometry'),
                        'properties': feature.get('attributes', {})
                    })
                    
            elif source_type == 'geoserver':
                features = data.get('features', [])
                
            elif source_type == 'osm':
                for element in data.get('elements', []):
                    if element.get('type') in ['way', 'relation']:
                        features.append({
                            'geometry': self._create_geometry(element),
                            'properties': element.get('tags', {})
                        })
                        
            elif source_type == 'shapefile':
                features = data.get('features', [])
            
            return features
            
        except Exception as e:
            self.logger.error(f"Error converting format: {str(e)}")
            return []

    def _parse_kml_placemark(self, placemark: ET.Element) -> Dict:
        """Parse KML placemark element"""
        try:
            properties = {}
            geometry = None
            
            # Get name and description
            name = placemark.find(".//{http://www.opengis.net/kml/2.2}name")
            if name is not None:
                properties['name'] = name.text
                
            desc = placemark.find(".//{http://www.opengis.net/kml/2.2}description")
            if desc is not None:
                properties['description'] = desc.text
            
            # Get geometry
            polygon = placemark.find(".//{http://www.opengis.net/kml/2.2}Polygon")
            if polygon is not None:
                coords = polygon.find(".//{http://www.opengis.net/kml/2.2}coordinates")
                if coords is not None:
                    geometry = self._parse_kml_coordinates(coords.text)
            
            return {
                'geometry': geometry,
                'properties': properties
            }
            
        except Exception as e:
            self.logger.error(f"Error parsing KML placemark: {str(e)}")
            return None

    def _create_geometry(self, element: Dict) -> Dict:
        """Create geometry from OSM element"""
        try:
            if element['type'] == 'way':
                return {
                    'type': 'Polygon',
                    'coordinates': [element.get('nodes', [])]
                }
            return None
        except Exception as e:
            self.logger.error(f"Error creating geometry: {str(e)}")
            return None

    def _parse_kml_coordinates(self, coord_string: str) -> Dict:
        """Parse KML coordinate string"""
        try:
            coords = []
            for point in coord_string.strip().split():
                lon, lat, _ = point.split(',')
                coords.append([float(lon), float(lat)])
            
            return {
                'type': 'Polygon',
                'coordinates': [coords]
            }
        except Exception as e:
            self.logger.error(f"Error parsing coordinates: {str(e)}")
            return None
