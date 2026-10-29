# Regenerates src/lib/design/sdrf-templates.json (the column sets of the SDRF editor's templates) from the
# templates bundled with sdrf-pipelines (https://github.com/bigbio/sdrf-templates).
# Run with the Python of sdrf-pipelines: <uv tool dir>/sdrf-pipelines/bin/python scripts/sdrf-templates.py
import glob, json, os, yaml, sdrf_pipelines

D = os.path.join(os.path.dirname(sdrf_pipelines.__file__), 'sdrf', 'sdrf-templates')
T = {y['name']: y for y in (yaml.safe_load(open(f)) for f in glob.glob(D + '/*/*/*.yaml'))}

def cols(name):
    y = T[name]
    out = {c['name']: c for c in cols(y['extends'].split('@')[0])} if y.get('extends') else {}
    for c in y.get('columns') or []:
        onts = [o for v in c.get('validators') or [] if v.get('validator_name') == 'ontology' for o in v.get('params', {}).get('ontologies', [])]
        prev = out.get(c['name'], {})
        out[c['name']] = {'name': c['name'], 'requirement': c.get('requirement', prev.get('requirement', 'optional')), 'ontologies': onts or prev.get('ontologies', [])}
    return list(out.values())

KEEP = ['ms-proteomics', 'dia-acquisition', 'human', 'vertebrates', 'invertebrates', 'plants', 'cell-lines']
res = {'source': f'sdrf-pipelines {sdrf_pipelines.__version__} sdrf-templates (https://github.com/bigbio/sdrf-templates); regenerate with scripts/sdrf-templates.py', 'templates': [
    {'name': k, 'version': str(T[k].get('version', '')), 'description': T[k].get('description', '').split('. ')[0], 'layer': T[k].get('layer', ''), 'columns': cols(k)} for k in KEEP]}
json.dump(res, open('src/lib/design/sdrf-templates.json', 'w'), indent=1)
