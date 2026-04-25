from dbterd_server.api.service import ErdService


def test_default_path_is_allowed() -> None:
    service = ErdService(default_project_path="/a")
    assert service.is_allowed("/a") is True


def test_unknown_path_is_rejected() -> None:
    service = ErdService(default_project_path="/a")
    assert service.is_allowed("/b") is False


def test_empty_path_is_rejected() -> None:
    service = ErdService(default_project_path="/a")
    assert service.is_allowed("") is False


def test_allow_listed_path_is_permitted() -> None:
    service = ErdService(default_project_path="/a", allowed_project_paths=frozenset({"/b"}))
    assert service.is_allowed("/b") is True


def test_default_path_setter_round_trips() -> None:
    service = ErdService()
    service.default_project_path = "/x"
    assert service.default_project_path == "/x"


def test_clear_cache_does_not_explode() -> None:
    service = ErdService()
    service.clear_cache()
