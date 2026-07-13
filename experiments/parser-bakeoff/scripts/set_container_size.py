#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument("result", type=Path)
parser.add_argument("size", type=int)
args = parser.parse_args()

document = json.loads(args.result.read_text())
document["summary"]["container_image_bytes"] = args.size
args.result.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
