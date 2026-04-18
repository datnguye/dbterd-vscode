"""Dump the ErdPayload JSON Schema to stdout. Consumed by /sync-contract."""

import json
import sys

from dbterd_server.schemas import ErdPayload


def main() -> None:
    schema = ErdPayload.model_json_schema()
    json.dump(schema, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
