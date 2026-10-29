# Regenerates src/lib/design/sdrf-vocab.json, the small vocabularies the SDRF editor offers without the
# network: instrument models, cleavage agents, dissociation and acquisition methods (PSI-MS), labels
# (PSI-MS label free, SILAC; PRIDE TMT/iTRAQ), and a curated list of common organisms (NCBITaxon).
# Accessions are looked up in OLS4 (https://www.ebi.ac.uk/ols4), so a renamed term shows up here.
import json, urllib.parse, urllib.request

def term(label, ontology):
    url = 'https://www.ebi.ac.uk/ols4/api/search?' + urllib.parse.urlencode({'q': label, 'ontology': ontology, 'rows': 10, 'fieldList': 'label,obo_id'})
    for d in json.load(urllib.request.urlopen(url, timeout=20))['response']['docs']:
        if d['label'].lower() == label.lower():
            return {'label': d['label'], 'accession': d['obo_id']}
    raise SystemExit(f'{label} not found in {ontology}')

INSTRUMENTS = ['Q Exactive', 'Q Exactive Plus', 'Q Exactive HF', 'Q Exactive HF-X', 'Orbitrap Fusion', 'Orbitrap Fusion Lumos',
               'Orbitrap Eclipse', 'Orbitrap Exploris 240', 'Orbitrap Exploris 480', 'Orbitrap Astral', 'LTQ Orbitrap XL',
               'LTQ Orbitrap Velos', 'Orbitrap Elite', 'timsTOF Pro', 'timsTOF Pro 2', 'timsTOF HT', 'TripleTOF 5600',
               'TripleTOF 6600', 'ZenoTOF 7600']
ENZYMES = ['Trypsin', 'Trypsin/P', 'Lys-C', 'Lys-C/P', 'Arg-C', 'Asp-N', 'Chymotrypsin', 'glutamyl endopeptidase', 'Lys-N',
           'unspecific cleavage', 'no cleavage']
DISSOCIATION = ['beam-type collision-induced dissociation', 'collision-induced dissociation', 'electron transfer dissociation',
                'electron-transfer/higher-energy collision dissociation']
ACQUISITION = ['data-dependent acquisition', 'data-independent acquisition']
TMT = ['TMT126', 'TMT127N', 'TMT127C', 'TMT128N', 'TMT128C', 'TMT129N', 'TMT129C', 'TMT130N', 'TMT130C', 'TMT131', 'TMT131N',
       'TMT131C', 'TMT132N', 'TMT132C', 'TMT133N', 'TMT133C', 'TMT134N', 'TMT134C', 'TMT135N']
ORGANISMS = ['Homo sapiens', 'Mus musculus', 'Rattus norvegicus', 'Bos taurus', 'Sus scrofa', 'Gallus gallus', 'Danio rerio',
             'Drosophila melanogaster', 'Caenorhabditis elegans', 'Saccharomyces cerevisiae', 'Schizosaccharomyces pombe',
             'Escherichia coli', 'Bacillus subtilis', 'Arabidopsis thaliana', 'Oryza sativa', 'Zea mays', 'Plasmodium falciparum',
             'Mycobacterium tuberculosis', 'Severe acute respiratory syndrome coronavirus 2']

vocab = {
    'comment[instrument]': [term(t, 'ms') for t in INSTRUMENTS],
    'comment[cleavage agent details]': [term(t, 'ms') for t in ENZYMES],
    'comment[dissociation method]': [term(t, 'ms') for t in DISSOCIATION],
    'comment[proteomics data acquisition method]': [term(t, 'ms') for t in ACQUISITION],
    'comment[label]': [term('label free sample', 'ms')] + [term(t, 'pride') for t in TMT]
                      + [term(f'SILAC {k} reagent', 'ms') for k in ('light', 'medium', 'heavy')],
    'characteristics[organism]': [term(t, 'ncbitaxon') for t in ORGANISMS],
    'technology type': [{'label': 'proteomic profiling by mass spectrometry', 'accession': ''}],
}
json.dump(vocab, open('src/lib/design/sdrf-vocab.json', 'w'), indent=1)
print({k: len(v) for k, v in vocab.items()})
