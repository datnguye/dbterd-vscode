# jaffle-shop fixture

Minimal copy of the public [jaffle-shop](https://github.com/dbt-labs/jaffle-shop) dbt project used by the extension's end-to-end tests.

Only `target/manifest.json` and `target/catalog.json` are checked in — that's all `dbterd` needs to render an ERD. A trimmed `dbt_project.yml` is kept so the directory parses as a dbt project, but `dbt compile` is not runnable from here.

Regenerate the artefacts by cloning jaffle-shop and running:

```bash
dbt deps && dbt compile && dbt docs generate
```

then copying `target/manifest.json` and `target/catalog.json` back into this folder.
