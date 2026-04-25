"""Manifest field extractors. Kept separate from the adapter so the dict shape
of `original_file_path` / `metadata` lives in one place."""

from typing import Any


def index_original_file_paths(manifest: Any) -> dict[str, str]:
    if manifest is None:
        return {}
    nodes = getattr(manifest, "nodes", None) or {}
    index: dict[str, str] = {}
    for unique_id, node in nodes.items():
        path = getattr(node, "original_file_path", None)
        if isinstance(path, str) and path:
            index[unique_id] = path
    return index


def extract_metadata(manifest: Any) -> dict[str, Any]:
    md = getattr(manifest, "metadata", None)
    if md is None:
        return {"generated_at": "", "project_name": ""}
    return {
        "generated_at": str(getattr(md, "generated_at", "") or ""),
        "project_name": str(getattr(md, "project_name", "") or ""),
    }
