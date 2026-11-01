"""python scripts/validate-build-ifc.py path/to/file.ifc [...]
Requires ifcopenshell and pytest (for EXPRESS rules). Read-only; exits nonzero on errors.
"""
import json
import sys
import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.validate

failed = False
for path in sys.argv[1:]:
    model = ifcopenshell.open(path)
    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(model, logger, express_rules=True)
    geometry_errors = []
    shapes = 0
    for product in model.by_type('IfcProduct'):
        if not product.Representation:
            continue
        try:
            ifcopenshell.geom.create_shape(ifcopenshell.geom.settings(), product)
            shapes += 1
        except Exception as error:
            geometry_errors.append({'id': product.id(), 'error': str(error)})
    print(json.dumps({'file': path, 'schema': model.schema, 'shapes': shapes,
                      'schema_errors': logger.statements, 'geometry_errors': geometry_errors}, default=str))
    failed |= bool(logger.statements or geometry_errors)
sys.exit(1 if failed else 0)
