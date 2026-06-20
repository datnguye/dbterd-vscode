"""Integration coverage on a large, fully-connected real-world project.

The `big_project` fixture is a redacted real dbt project (96 connected models,
149 single-column FK relationship tests, a 14-edge hub, a 122-column table). Its
identifiers are all generic tokens (model_NNN, col_NNN) with no real names. It
exercises the build pipeline at a scale the small jaffle_shop fixture can't:
endpoint reconciliation, FK flagging, and the no-island guarantee across
hundreds of edges.
"""

from pathlib import Path

from fastapi.testclient import TestClient

from dbterd_server.api.app import create_app
from dbterd_server.api.service import ErdService
from dbterd_server.erd import builder
from dbterd_server.erd.cache import ErdCache


def _client_for(project_path: str) -> TestClient:
    service = ErdService(default_project_path=project_path)
    return TestClient(create_app(service=service))


def test_builds_a_large_connected_graph(big_project: Path, cache: ErdCache) -> None:
    result = builder.build_erd(str(big_project), cache)
    assert result.catalog_missing is False
    assert result.payload.metadata.dbt_project_name == "proj_001"
    assert len(result.payload.nodes) >= 90
    assert len(result.payload.edges) >= 140


def test_every_model_and_column_has_a_description(big_project: Path, cache: ErdCache) -> None:
    result = builder.build_erd(str(big_project), cache)
    for node in result.payload.nodes:
        assert node.description, f"{node.id} is missing a description"
        for column in node.columns:
            assert column.description, f"{node.id}.{column.name} is missing a description"


def test_every_edge_endpoint_resolves_to_a_node(big_project: Path, cache: ErdCache) -> None:
    result = builder.build_erd(str(big_project), cache)
    node_ids = {n.id for n in result.payload.nodes}
    for edge in result.payload.edges:
        assert edge.from_id in node_ids, f"from_id {edge.from_id!r} unresolved"
        assert edge.to_id in node_ids, f"to_id {edge.to_id!r} unresolved"


def test_no_unconnected_islands(big_project: Path, cache: ErdCache) -> None:
    result = builder.build_erd(str(big_project), cache)
    connected = {e.from_id for e in result.payload.edges} | {e.to_id for e in result.payload.edges}
    islands = [n.id for n in result.payload.nodes if n.id not in connected]
    assert islands == [], f"fixture is meant to be island-free, found {islands}"


def test_from_side_columns_are_flagged_across_the_graph(big_project: Path, cache: ErdCache) -> None:
    result = builder.build_erd(str(big_project), cache)
    nodes_by_id = {n.id: n for n in result.payload.nodes}
    for edge in result.payload.edges:
        from_node = nodes_by_id[edge.from_id]
        fk_col = next((c for c in from_node.columns if c.name == edge.from_column), None)
        assert fk_col is not None, f"{edge.from_column} missing from {edge.from_id}"
        assert fk_col.is_foreign_key is True


def test_referenced_parent_columns_exist(big_project: Path, cache: ErdCache) -> None:
    result = builder.build_erd(str(big_project), cache)
    nodes_by_id = {n.id: n for n in result.payload.nodes}
    for edge in result.payload.edges:
        to_node = nodes_by_id[edge.to_id]
        assert any(c.name == edge.to_column for c in to_node.columns), (
            f"{edge.to_column} missing from referenced node {edge.to_id}"
        )


def test_all_edges_are_foreign_keys(big_project: Path, cache: ErdCache) -> None:
    result = builder.build_erd(str(big_project), cache)
    assert all(edge.relationship_type == "fk" for edge in result.payload.edges)


def test_hub_table_keeps_all_incoming_edges(big_project: Path, cache: ErdCache) -> None:
    result = builder.build_erd(str(big_project), cache)
    incoming: dict[str, int] = {}
    for edge in result.payload.edges:
        incoming[edge.to_id] = incoming.get(edge.to_id, 0) + 1
    busiest = max(incoming.values())
    assert busiest >= 10, f"expected a hub with many incoming edges, max was {busiest}"


def test_build_is_cached_for_the_big_project(big_project: Path, cache: ErdCache) -> None:
    first = builder.build_erd(str(big_project), cache)
    second = builder.build_erd(str(big_project), cache)
    assert first is second


def test_endpoint_serves_the_big_project(big_project: Path) -> None:
    response = _client_for(str(big_project)).get("/erd")
    assert response.status_code == 200
    body = response.json()
    assert len(body["nodes"]) >= 90
    assert len(body["edges"]) >= 140
    assert body["metadata"]["dbt_project_name"] == "proj_001"
