import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from material_fields import ground_fields
ground_fields(Path(sys.argv[sys.argv.index('--')+1]))
