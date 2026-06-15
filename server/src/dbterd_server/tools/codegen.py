"""Dump the /erd contract JSON Schema to stdout. Consumed by /sync-contract.

The webview needs a TS interface per top-level contract model. A synthetic
`_Contract` model references every exported contract model as a field, so a
single `model_json_schema()` puts them all (plus their nested types) into one
shared `$defs` block — json2ts then emits one interface per `$def`.
"""

import json
import sys

from pydantic import BaseModel

from dbterd_server.schemas import ErdPayload, ErdProgress


class _Contract(BaseModel):
    # Synthetic root so every contract model lands in a shared `$defs` block;
    # json2ts emits one TS interface per `$def`. This wrapper itself is an
    # unused export in the generated file — the webview imports the inner models.
    payload: ErdPayload
    progress: ErdProgress


def main() -> None:
    schema = _Contract.model_json_schema()
    json.dump(schema, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
