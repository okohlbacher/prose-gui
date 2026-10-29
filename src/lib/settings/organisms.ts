// The organisms New search can download a database for: UniProt reference proteomes (one protein per gene),
// the common model organisms first. Any other proteome by its id (UP…, on uniprot.org/proteomes).

export const ORGANISMS: { id: string; name: string }[] = [
  { id: 'UP000005640', name: 'Human (Homo sapiens)' },
  { id: 'UP000000589', name: 'Mouse (Mus musculus)' },
  { id: 'UP000002494', name: 'Rat (Rattus norvegicus)' },
  { id: 'UP000002311', name: 'Yeast (Saccharomyces cerevisiae S288C)' },
  { id: 'UP000000625', name: 'E. coli K-12' },
  { id: 'UP000006548', name: 'Arabidopsis thaliana' },
  { id: 'UP000000437', name: 'Zebrafish (Danio rerio)' },
  { id: 'UP000000803', name: 'Fruit fly (Drosophila melanogaster)' },
  { id: 'UP000001940', name: 'C. elegans' },
  { id: 'UP000001570', name: 'Bacillus subtilis 168' },
  { id: 'UP000009136', name: 'Cattle (Bos taurus)' },
  { id: 'UP000008227', name: 'Pig (Sus scrofa)' },
]
